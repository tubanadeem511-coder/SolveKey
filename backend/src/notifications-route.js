import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "./async-route.js";
import { requireAuth } from "./auth.js";
import { q } from "./db.js";

export const notifications = Router();

notifications.get("/", requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await q(
    `SELECT id,type,title,body,payload,read_at,created_at
     FROM notifications WHERE user_id=$1
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}));

notifications.patch("/read-all", requireAuth, asyncRoute(async (req, res) => {
  const { rowCount } = await q(
    `UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`,
    [req.user.id]
  );
  res.json({ ok: true, updated: rowCount });
}));

notifications.patch("/:id/read", requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid notification id" });
  const { rows } = await q(
    `UPDATE notifications SET read_at=COALESCE(read_at,now())
     WHERE id=$1 AND user_id=$2
     RETURNING id,read_at`,
    [parsed.data, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Notification not found" });
  res.json(rows[0]);
}));
