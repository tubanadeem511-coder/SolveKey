import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "./async-route.js";
import { requireAuth } from "./auth.js";
import { pool, q } from "./db.js";
import { createNotification } from "./notifications.js";

export const rewards = Router();

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin role required" });
  return next();
}

rewards.get("/", asyncRoute(async (_req, res) => {
  const { rows } = await q(
    `SELECT id,name,description,points_cost,stock,created_at
     FROM rewards WHERE active=TRUE ORDER BY points_cost,id`
  );
  res.json(rows);
}));

rewards.get("/mine", requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await q(
    `SELECT redemption.id,redemption.reward_id,reward.name,reward.description,
            redemption.points_spent,redemption.status,redemption.created_at,redemption.updated_at
     FROM reward_redemptions redemption
     JOIN rewards reward ON reward.id=redemption.reward_id
     WHERE redemption.user_id=$1
     ORDER BY redemption.created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
}));

rewards.post("/", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().min(5).max(1000),
    points_cost: z.number().int().positive().max(1_000_000),
    stock: z.number().int().nonnegative().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { rows } = await q(
    `INSERT INTO rewards (name,description,points_cost,stock,created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id,name,description,points_cost,stock,active,created_at`,
    [
      parsed.data.name,
      parsed.data.description,
      parsed.data.points_cost,
      parsed.data.stock ?? null,
      req.user.id,
    ]
  );
  res.status(201).json(rows[0]);
}));

rewards.post("/:id/redeem", requireAuth, asyncRoute(async (req, res) => {
  const rewardId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!rewardId.success) return res.status(400).json({ error: "Invalid reward id" });

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows: rewardRows } = await client.query(
      `SELECT id,name,points_cost,stock FROM rewards WHERE id=$1 AND active=TRUE FOR UPDATE`,
      [rewardId.data]
    );
    if (!rewardRows.length) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(404).json({ error: "Reward not found" });
    }
    const reward = rewardRows[0];
    if (reward.stock === 0) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(409).json({ error: "Reward is out of stock" });
    }

    const { rows: users } = await client.query(
      `UPDATE users SET points=points-$2,
       level=CASE
         WHEN points-$2 >= 500 THEN 'Hero'
         WHEN points-$2 >= 200 THEN 'Champion'
         WHEN points-$2 >= 50 THEN 'Guardian'
         ELSE 'Citizen'
       END
       WHERE id=$1 AND points >= $2
       RETURNING id,points,level`,
      [req.user.id, reward.points_cost]
    );
    if (!users.length) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(409).json({ error: "Not enough points for this reward" });
    }

    const { rows } = await client.query(
      `INSERT INTO reward_redemptions (reward_id,user_id,points_spent)
       VALUES ($1,$2,$3)
       RETURNING id,reward_id,user_id,points_spent,status,created_at`,
      [reward.id, req.user.id, reward.points_cost]
    );
    if (reward.stock !== null) {
      await client.query(`UPDATE rewards SET stock=stock-1 WHERE id=$1`, [reward.id]);
    }
    await client.query(
      `INSERT INTO point_events (user_id,reason,points) VALUES ($1,$2,$3)`,
      [req.user.id, `reward_redemption:${rows[0].id}`, -reward.points_cost]
    );
    const notification = await createNotification({
      userId: req.user.id,
      type: "reward_redemption",
      title: "Reward redemption submitted",
      body: `Your request for ${reward.name} is pending fulfillment.`,
      payload: { redemptionId: rows[0].id, rewardId: reward.id },
      executor: client,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    const io = req.app.get("io");
    io?.to(`user:${req.user.id}`).emit("notification:new", notification);
    io?.to(`user:${req.user.id}`).emit("points:updated", users[0]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

rewards.get("/redemptions", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await q(
    `SELECT redemption.id,redemption.user_id,users.name AS user_name,users.email AS user_email,
            reward.name AS reward_name,redemption.points_spent,redemption.status,redemption.created_at
     FROM reward_redemptions redemption
     JOIN users ON users.id=redemption.user_id
     JOIN rewards reward ON reward.id=redemption.reward_id
     ORDER BY redemption.created_at DESC LIMIT 200`
  );
  res.json(rows);
}));

rewards.patch("/redemptions/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const redemptionId = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(["fulfilled", "cancelled"]) }).safeParse(req.body);
  if (!redemptionId.success || !parsed.success) return res.status(400).json({ error: "Invalid redemption update" });

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const { rows: redemptions } = await client.query(
      `SELECT id,user_id,reward_id,points_spent,status FROM reward_redemptions WHERE id=$1 FOR UPDATE`,
      [redemptionId.data]
    );
    if (!redemptions.length) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(404).json({ error: "Redemption not found" });
    }
    const redemption = redemptions[0];
    if (redemption.status !== "pending") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res.status(409).json({ error: "Only pending redemptions can be updated" });
    }
    const { rows } = await client.query(
      `UPDATE reward_redemptions SET status=$2,updated_at=now()
       WHERE id=$1 RETURNING id,status,updated_at`,
      [redemption.id, parsed.data.status]
    );
    if (parsed.data.status === "cancelled") {
      await client.query(
        `UPDATE users SET points=points+$2,
         level=CASE
           WHEN points+$2 >= 500 THEN 'Hero'
           WHEN points+$2 >= 200 THEN 'Champion'
           WHEN points+$2 >= 50 THEN 'Guardian'
           ELSE 'Citizen'
         END
         WHERE id=$1`,
        [redemption.user_id, redemption.points_spent]
      );
      await client.query(
        `INSERT INTO point_events (user_id,reason,points) VALUES ($1,$2,$3)`,
        [redemption.user_id, `reward_refund:${redemption.id}`, redemption.points_spent]
      );
      await client.query(`UPDATE rewards SET stock=stock+1 WHERE id=$1 AND stock IS NOT NULL`, [redemption.reward_id]);
    }
    const notification = await createNotification({
      userId: redemption.user_id,
      type: "reward_redemption",
      title: parsed.data.status === "fulfilled" ? "Reward fulfilled" : "Reward request cancelled",
      body: parsed.data.status === "fulfilled"
        ? "Your reward request has been fulfilled."
        : "Your reward request was cancelled and the points were refunded.",
      payload: { redemptionId: redemption.id, status: parsed.data.status },
      executor: client,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    req.app.get("io")?.to(`user:${redemption.user_id}`).emit("notification:new", notification);
    res.json(rows[0]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
