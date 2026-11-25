import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { auth } from "./auth.js";
import { reports } from "./reports.js";
import { stats } from "./stats.js";
import { assistant } from "./assistant.js";
import { notifications } from "./notifications-route.js";
import { rewards } from "./rewards.js";
import { createOriginGuard } from "./origin.js";
import { localUploadsPath } from "./storage.js";
import { assertDatabaseUrl, q } from "./db.js";
import { startReportWorker } from "./report-worker.js";
import { assertJwtSecret } from "./startup.js";
import jwt from "jsonwebtoken";

assertDatabaseUrl();
assertJwtSecret();

const app = express();
app.set("trust proxy", 1); // Railway sits behind a proxy
const server = http.createServer(app);
const origin = process.env.FRONTEND_URL || "http://localhost:3000";
const io = new Server(server, { cors: { origin, credentials: true } });
app.set("io", io);

if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === "change-me") {
    throw new Error("Production requires a unique JWT_SECRET of at least 32 characters");
  }
  if (new URL(origin).protocol !== "https:") {
    throw new Error("Production FRONTEND_URL must use HTTPS");
  }
}

app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(createOriginGuard(origin));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: "draft-7",
}));
const strictLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts, please wait a few minutes" },
  standardHeaders: "draft-7",
});
app.post("/api/auth/login", strictLimiter);
app.post("/api/auth/register", strictLimiter);
app.use("/api/auth", auth);
app.use("/uploads", express.static(localUploadsPath, { fallthrough: false, index: false, maxAge: "1d" }));
app.use("/api/reports", reports);
app.use("/api/stats", stats);
app.use("/api/assistant", assistant);
app.use("/api/notifications", notifications);
app.use("/api/rewards", rewards);
app.get("/health", async (_req, res, next) => {
  try {
    await q("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

io.use(async (socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";
  const tokenCookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("token="));
  if (!tokenCookie) return next();
  try {
    const token = jwt.verify(decodeURIComponent(tokenCookie.slice("token=".length)), process.env.JWT_SECRET);
    const { rows } = await q(`SELECT id,role,department_id FROM users WHERE id=$1`, [token.id]);
    if (!rows.length) return next(new Error("Unauthorized"));
    socket.data.user = rows[0];
    return next();
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") {
      return next(new Error("Unauthorized"));
    }
    return next(error);
  }
});

io.on("connection", (socket) => {
  const user = socket.data.user;
  if (user?.id) socket.join(`user:${user.id}`);
  console.log("socket connected", socket.id);

  socket.on("report:join", async (reportId, acknowledge) => {
    const respond = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!user?.id || !Number.isInteger(reportId) || reportId < 1) {
      respond({ ok: false, error: "Authentication and a valid report id are required" });
      return;
    }
    try {
      const { rows } = await q(`SELECT user_id,department_id FROM reports WHERE id=$1`, [reportId]);
      if (!rows.length) {
        respond({ ok: false, error: "Report not found" });
        return;
      }
      const report = rows[0];
      const allowed = user.role === "admin" ||
        user.id === report.user_id ||
        (user.role === "department" && user.department_id && user.department_id === report.department_id);
      if (!allowed) {
        respond({ ok: false, error: "Forbidden" });
        return;
      }
      for (const room of socket.rooms) {
        if (room.startsWith("report:")) socket.leave(room);
      }
      socket.join(`report:${reportId}`);
      respond({ ok: true });
    } catch (error) {
      console.error("Could not join report chat room", error);
      respond({ ok: false, error: "Could not join report chat" });
    }
  });
  socket.on("report:leave", (reportId) => {
    if (Number.isInteger(reportId) && reportId > 0) socket.leave(`report:${reportId}`);
  });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("SolveKey request failed", error);
  res.status(500).json({ error: "Internal server error" });
});

async function startServer() {
  try {
    await q("SELECT 1");
    console.log("Database connection OK");
  } catch (error) {
    const hints = {
      ENOTFOUND: "Use the Supabase Session pooler string.",
      ENETUNREACH: "Use the Supabase Session pooler string.",
      ETIMEDOUT: "Use the Supabase Session pooler string.",
      "42P01": "Run npm run migrate:local.",
      "28P01": "Check the password, or use postgres.<project-ref> as the pooler username.",
    };
    const code = error?.code || "unknown";
    const hint = hints[code];
    console.error(
      `Database connection failed (${code}): ${error?.message || "Unknown error"}` +
      (hint ? ` Hint: ${hint}` : "")
    );
  }

  const stopReportWorker = startReportWorker(io);
  server.on("close", stopReportWorker);
  server.listen(process.env.PORT || 4000, () => console.log("SolveKey API running"));
}

startServer().catch((error) => {
  console.error("Could not start SolveKey API", error);
  process.exitCode = 1;
});
