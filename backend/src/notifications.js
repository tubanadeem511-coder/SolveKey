import { q } from "./db.js";

function queryWith(executor, text, params) {
  return typeof executor === "function"
    ? executor(text, params)
    : executor.query(text, params);
}

export async function createNotification({
  userId,
  type,
  title,
  body,
  payload = {},
  executor = q,
  io = null,
}) {
  const { rows } = await queryWith(executor,
    `INSERT INTO notifications (user_id,type,title,body,payload)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id,type,title,body,payload,read_at,created_at`,
    [userId, type, title, body, JSON.stringify(payload)]
  );
  const notification = rows[0];
  io?.to(`user:${userId}`).emit("notification:new", notification);
  return notification;
}
