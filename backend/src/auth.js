import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { q } from "./db.js";
import { asyncRoute } from "./async-route.js";

export const auth = Router();
const cookieOpts = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 3600 * 1000,
};
const sign = (u) => jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: "7d" });

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin role required" });
  return next();
}

export function requireAuth(req, res, next) {
  let token;
  try {
    token = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  q(`SELECT id,role,department_id FROM users WHERE id=$1`, [token.id])
    .then(({ rows }) => {
      if (!rows.length) return res.status(401).json({ error: "Unauthorized" });
      req.user = rows[0];
      return next();
    })
    .catch(next);
}

export function optionalAuth(req, _res, next) {
  const tokenValue = req.cookies?.token;
  if (!tokenValue) return next();

  let token;
  try {
    token = jwt.verify(tokenValue, process.env.JWT_SECRET);
  } catch {
    return next();
  }
  q(`SELECT id,role,department_id FROM users WHERE id=$1`, [token.id])
    .then(({ rows }) => {
      if (rows.length) req.user = rows[0];
      next();
    })
    .catch(next);
}

async function getAuthUser(user) {
  const { rows } = await q(`SELECT id,name,email,role,points,level FROM users WHERE id=$1`, [user.id]);
  const { rows: badges } = await q(
    `SELECT badge.code,badge.name,badge.description,user_badges.earned_at
     FROM user_badges JOIN badges badge ON badge.id=user_badges.badge_id
     WHERE user_badges.user_id=$1 ORDER BY user_badges.earned_at`,
    [user.id]
  );
  return { ...rows[0], department_id: user.department_id, badges };
}

auth.post("/register", asyncRoute(async (req, res) => {
  const p = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  if (Buffer.byteLength(p.data.password, "utf8") > 72) {
    return res.status(400).json({ error: "Password must not exceed 72 UTF-8 bytes" });
  }
  const hash = await bcrypt.hash(p.data.password, 12);
  try {
    const { rows } = await q(`INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,role,points`,
      [p.data.name, p.data.email.toLowerCase(), hash]);
    res.cookie("token", sign(rows[0]), cookieOpts).status(201).json(rows[0]);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Email already registered" });
    throw error;
  }
}));

auth.post("/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const parsed = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(72),
  }).safeParse({ email, password });
  if (!parsed.success || Buffer.byteLength(parsed.data.password, "utf8") > 72) {
    return res.status(400).json({ error: "Valid email and password are required" });
  }
  const { rows } = await q(`SELECT * FROM users WHERE email=$1`, [parsed.data.email.toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(parsed.data.password, u.password_hash))) return res.status(401).json({ error: "Invalid credentials" });
  res.cookie("token", sign(u), cookieOpts).json({ id: u.id, name: u.name, email: u.email, role: u.role, points: u.points });
}));

auth.post("/logout", (_req, res) => res.clearCookie("token", cookieOpts).json({ ok: true }));
auth.get("/session", optionalAuth, asyncRoute(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: await getAuthUser(req.user) });
}));
auth.get("/me", requireAuth, asyncRoute(async (req, res) => {
  res.json(await getAuthUser(req.user));
}));

auth.get("/staff", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [users, departments] = await Promise.all([
    q(`SELECT id,name,email,role,department_id FROM users ORDER BY name,id`),
    q(`SELECT id,name FROM departments ORDER BY name`),
  ]);
  res.json({ users: users.rows, departments: departments.rows });
}));

auth.patch("/staff/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({
    role: z.enum(["citizen", "department", "admin"]),
    department_id: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid staff update" });
  const departmentId = parsed.data.role === "department" ? parsed.data.department_id : null;
  if (parsed.data.role === "department" && !departmentId) {
    return res.status(400).json({ error: "Department accounts require a department assignment" });
  }
  if (departmentId) {
    const { rowCount } = await q(`SELECT id FROM departments WHERE id=$1`, [departmentId]);
    if (!rowCount) return res.status(400).json({ error: "Department not found" });
  }
  if (id.data === req.user.id && parsed.data.role !== "admin") {
    const { rows } = await q(`SELECT COUNT(*)::int AS count FROM users WHERE role='admin'`);
    if (rows[0].count <= 1) return res.status(409).json({ error: "Cannot demote the last administrator" });
  }
  const { rows } = await q(
    `UPDATE users SET role=$2,department_id=$3 WHERE id=$1
     RETURNING id,name,email,role,department_id`,
    [id.data, parsed.data.role, departmentId ?? null]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  res.json(rows[0]);
}));
