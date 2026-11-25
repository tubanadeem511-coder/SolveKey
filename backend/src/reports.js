import { Router } from "express";
import { z } from "zod";
import { pool, q } from "./db.js";
import { optionalAuth, requireAuth } from "./auth.js";
import { asyncRoute } from "./async-route.js";
import { uploadReportImage, validateReportImage } from "./storage.js";
import { awardPoints } from "./points.js";
import { createNotification } from "./notifications.js";
import { CivicIssueRejectedError, classifyCivicImage } from "./agents/orchestrator.js";
import { REPORT_CATEGORIES } from "./report-categories.js";

export const reports = Router();
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const statuses = ["pending", "reported", "in_progress", "resolved", "duplicate"];
const reportNumberPattern = /^SK-\d{4}-(?:\d{6,}|[A-F0-9]{32})$/i;

reports.get("/", optionalAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({
    department_id: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    category: z.enum(REPORT_CATEGORIES).optional(),
    status: z.enum(statuses).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid report filters" });
  }
  let departmentId = parsed.data.department_id ?? null;
  if (req.user?.role === "department") {
    if (!req.user.department_id) return res.status(403).json({ error: "Department account is not assigned to a department" });
    departmentId = req.user.department_id;
  }
  const { rows } = await q(`SELECT r.id,r.lat,r.lng,r.category,r.severity,r.status,r.description,r.summary,r.image_url,
      r.department_id,d.name AS department_name,r.upvotes,r.created_at,
      EXISTS (SELECT 1 FROM report_votes vote WHERE vote.report_id=r.id AND vote.user_id=$5) AS has_upvoted
    FROM reports r LEFT JOIN departments d ON d.id=r.department_id
    WHERE r.duplicate_of IS NULL
      AND ($1::int IS NULL OR r.department_id=$1)
      AND ($2::text IS NULL OR r.category=$2)
      AND ($3::text IS NULL OR r.status=$3)
      AND ($4::text IS NULL OR concat_ws(' ',r.category,r.description,r.summary,r.address,d.name) ILIKE '%' || $4 || '%')
    ORDER BY r.created_at DESC LIMIT 200`,
  [departmentId, parsed.data.category ?? null, parsed.data.status ?? null, parsed.data.q ?? null, req.user?.id ?? null]);
  res.json(rows);
}));

reports.get("/mine", requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await q(`SELECT r.id,r.report_number,r.lat,r.lng,r.category,r.severity,r.status,r.description,r.image_url,
      r.department_id,d.name AS department_name,r.upvotes,r.created_at
    FROM reports r LEFT JOIN departments d ON d.id=r.department_id
    WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [req.user.id]);
  res.json(rows);
}));

reports.get("/track/:reportNumber", asyncRoute(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const parsed = z.string()
    .regex(reportNumberPattern)
    .safeParse(req.params.reportNumber);
  if (!parsed.success) return res.status(404).json({ error: "Report not found" });

  const { rows } = await q(
    `SELECT r.report_number,
        COALESCE(NULLIF(r.summary,''), NULLIF(r.description,''), 'Civic issue report') AS issue,
        r.description,r.summary,r.category,
        COALESCE(NULLIF(r.address,''), 'Location not provided') AS location,
        r.status,r.created_at,r.updated_at,d.name AS department_name
     FROM reports r
     LEFT JOIN departments d ON d.id=r.department_id
     WHERE r.report_number=$1`,
    [parsed.data.toUpperCase()]
  );
  if (!rows.length) return res.status(404).json({ error: "Report not found" });
  res.json(rows[0]);
}));

reports.post("/", requireAuth, asyncRoute(async (req, res) => {
  const p = z.object({
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    address: z.string().trim().max(500).optional(),
    image_base64: z.string().min(1).max(2_000_000),
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid input" });

  try {
    validateReportImage(p.data.image_base64, p.data.media_type);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid report image" });
  }

  let classification;
  try {
    classification = await classifyCivicImage(p.data.image_base64, p.data.media_type);
  } catch (error) {
    if (error instanceof CivicIssueRejectedError) {
      return res.status(422).json({ error: error.message });
    }
    return res.status(502).json({ error: "Unable to validate report image. Please try again." });
  }

  let imageUrl;
  try {
    imageUrl = await uploadReportImage(p.data.image_base64, p.data.media_type);
  } catch (err) {
    console.error("Report image upload failed", err);
    return res.status(502).json({ error: "Unable to store report image" });
  }

  const io = req.app.get("io");
  const client = await pool.connect();
  let transactionOpen = false;
  let report;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows } = await client.query(
      `INSERT INTO reports (user_id,image_url,lat,lng,address,category,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,report_number,user_id,image_url,lat,lng,address,category,severity,status,description,
         department_id,duplicate_of,upvotes,created_at`,
      [req.user.id, imageUrl, p.data.lat, p.data.lng, p.data.address || null, classification.category, classification.description]
    );
    report = rows[0];
    await client.query(
      `INSERT INTO agent_logs (report_id,agent_name,input,output) VALUES ($1,'VisionAgent',$2,$3)`,
      [
        report.id,
        JSON.stringify({ hasImage: true, submissionPrecheck: true }),
        JSON.stringify({ ...classification, submissionPrecheck: true }),
      ]
    );
    await awardPoints(req.user.id, 10, "report", client, io);
    await client.query(`INSERT INTO report_jobs (report_id) VALUES ($1)`, [report.id]);
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  io.emit("report:new", { id: report.id, lat: report.lat, lng: report.lng });
  res.status(201).json(report);
}));

reports.patch("/:id/status", requireAuth, asyncRoute(async (req, res) => {
  if (!["department", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const parsedId = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
  const p = z.object({ status: z.enum(["reported", "in_progress", "resolved"]) }).safeParse(req.body);
  if (!parsedId.success || !p.success) return res.status(400).json({ error: "Invalid input" });
  const id = parsedId.data;

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows } = await client.query(
      `SELECT id,user_id,status,department_id FROM reports WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(404).json({ error: "Report not found" });
    }

    const report = rows[0];
    if (req.user.role === "department" &&
        (!req.user.department_id || report.department_id !== req.user.department_id)) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(403).json({ error: "Report is outside your department" });
    }
    await client.query(`UPDATE reports SET status=$2 WHERE id=$1`, [id, p.data.status]);
    if (p.data.status === "resolved" && report.user_id) {
      const reason = `report_resolved:${id}`;
      const awarded = await client.query(
        `SELECT 1 FROM point_events WHERE user_id=$1 AND reason=$2 LIMIT 1`,
        [report.user_id, reason]
      );
      if (!awarded.rowCount) await awardPoints(report.user_id, 20, reason, client, req.app.get("io"));
    }
    if (report.user_id && report.status !== p.data.status) {
      await createNotification({
        userId: report.user_id,
        type: "report_status",
        title: "Report status updated",
        body: `Your report #${id} is now ${p.data.status.replaceAll("_", " ")}.`,
        payload: { reportId: id, status: p.data.status },
        executor: client,
        io: req.app.get("io"),
      });
    }

    await client.query("COMMIT");
    transactionOpen = false;
    req.app.get("io")?.emit("report:updated", { id, status: p.data.status });
    return res.json({ ok: true });
  } catch (err) {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Report status rollback failed", rollbackError);
      }
    }
    console.error("Report status update failed", err);
    return res.status(500).json({ error: "Unable to update report status" });
  } finally {
    client?.release();
  }
}));

reports.get("/:id/trace", requireAuth, asyncRoute(async (req, res) => {
  const reportId = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
  if (!reportId.success) return res.status(400).json({ error: "Invalid report id" });
  const { rows: reportRows } = await q(`SELECT user_id,department_id FROM reports WHERE id=$1`, [reportId.data]);
  if (!reportRows.length) return res.status(404).json({ error: "Report not found" });
  const report = reportRows[0];
  if (req.user.role !== "admin" &&
      req.user.id !== report.user_id &&
      !(req.user.role === "department" && req.user.department_id === report.department_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { rows } = await q(`SELECT agent_name,input,output,created_at FROM agent_logs WHERE report_id=$1 ORDER BY id`, [reportId.data]);
  res.json(rows);
}));

reports.get("/:id/messages", requireAuth, asyncRoute(async (req, res) => {
  const parsedReportId = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
  if (!parsedReportId.success) return res.status(400).json({ error: "Invalid report id" });
  const reportId = parsedReportId.data;
  const { rows: reportRows } = await q(`SELECT user_id,department_id FROM reports WHERE id=$1`, [reportId]);
  if (!reportRows.length) return res.status(404).json({ error: "Report not found" });
  const report = reportRows[0];
  if (req.user.role !== "admin" &&
      req.user.id !== report.user_id &&
      !(req.user.role === "department" && req.user.department_id === report.department_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { rows } = await q(
    `SELECT m.id,m.report_id,m.sender_user_id,u.name AS sender_name,u.role AS sender_role,m.body,m.created_at
     FROM report_messages m JOIN users u ON u.id=m.sender_user_id
     WHERE m.report_id=$1 ORDER BY m.id DESC LIMIT 100`,
    [reportId]
  );
  res.json(rows.reverse());
}));

reports.post("/:id/messages", requireAuth, asyncRoute(async (req, res) => {
  const parsedReportId = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsedReportId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid message input" });
  }
  const reportId = parsedReportId.data;
  const { rows: reportRows } = await q(`SELECT user_id,department_id FROM reports WHERE id=$1`, [reportId]);
  if (!reportRows.length) return res.status(404).json({ error: "Report not found" });
  const report = reportRows[0];
  const isReporter = req.user.id === report.user_id;
  const isAssignedDepartment = req.user.role === "department" &&
    req.user.department_id && req.user.department_id === report.department_id;
  if (req.user.role !== "admin" && !isReporter && !isAssignedDepartment) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { rows: insertedRows } = await q(
    `INSERT INTO report_messages (report_id,sender_user_id,body)
     VALUES ($1,$2,$3)
     RETURNING id,report_id,sender_user_id,body,created_at`,
    [reportId, req.user.id, parsed.data.body]
  );
  const { rows } = await q(
    `SELECT m.id,m.report_id,m.sender_user_id,u.name AS sender_name,u.role AS sender_role,m.body,m.created_at
     FROM report_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.id=$1`,
    [insertedRows[0].id]
  );
  const message = rows[0];
  const io = req.app.get("io");
  io?.to(`report:${reportId}`).emit("chat:message", message);

  if (report.user_id && !isReporter) {
    await createNotification({
      userId: report.user_id,
      type: "report_message",
      title: "New message about your report",
      body: `A message was added to report #${reportId}.`,
      payload: { reportId },
      io,
    });
  } else if (report.department_id && isReporter) {
    const { rows: staff } = await q(
      `SELECT id FROM users WHERE role='department' AND department_id=$1`,
      [report.department_id]
    );
    for (const member of staff) {
      await createNotification({
        userId: member.id,
        type: "report_message",
        title: "New citizen message",
        body: `A message was added to report #${reportId}.`,
        payload: { reportId },
        io,
      });
    }
  }
  res.status(201).json(message);
}));

reports.post("/:id/upvote", requireAuth, asyncRoute(async (req, res) => {
  const parsedReportId = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
  if (!parsedReportId.success) return res.status(400).json({ error: "Invalid report id" });
  const reportId = parsedReportId.data;

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows: reportRows } = await client.query(
      `SELECT id,user_id FROM reports WHERE id=$1 AND duplicate_of IS NULL FOR UPDATE`,
      [reportId]
    );
    if (!reportRows.length) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(404).json({ error: "Report not found" });
    }
    if (reportRows[0].user_id === req.user.id) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(409).json({ error: "You cannot upvote your own report" });
    }
    const vote = await client.query(
      `INSERT INTO report_votes (user_id,report_id) VALUES ($1,$2)
       ON CONFLICT (user_id,report_id) DO NOTHING RETURNING id`,
      [req.user.id, reportId]
    );
    if (!vote.rowCount) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(409).json({ error: "You have already upvoted this report" });
    }
    const { rows } = await client.query(
      `UPDATE reports SET upvotes=upvotes+1 WHERE id=$1 RETURNING upvotes`,
      [reportId]
    );
    await awardPoints(req.user.id, 2, `upvote:${reportId}`, client, req.app.get("io"));
    await client.query("COMMIT");
    transactionOpen = false;
    res.json({ ok: true, upvotes: rows[0].upvotes });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

reports.get("/leaderboard/top", asyncRoute(async (_req, res) => {
  const { rows } = await q(`SELECT id,name,points,level FROM users ORDER BY points DESC LIMIT 20`);
  res.json(rows);
}));
