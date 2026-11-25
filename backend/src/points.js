import { q } from "./db.js";

function queryWith(executor, text, params) {
  return typeof executor === "function"
    ? executor(text, params)
    : executor.query(text, params);
}

export async function awardPoints(userId, points, reason, executor = q, io = null) {
  const { rows } = await queryWith(executor,
    `UPDATE users
     SET points=points+$2,
       level=CASE
         WHEN points+$2 >= 500 THEN 'Hero'
         WHEN points+$2 >= 200 THEN 'Champion'
         WHEN points+$2 >= 50 THEN 'Guardian'
         ELSE 'Citizen'
       END
     WHERE id=$1
     RETURNING id,points,level`,
    [userId, points]
  );
  if (!rows.length) throw new Error(`Cannot award points to missing user ${userId}`);
  await queryWith(executor,
    `INSERT INTO point_events (user_id,reason,points) VALUES ($1,$2,$3)`,
    [userId, reason, points]
  );

  const user = rows[0];
  const { rows: statsRows } = await queryWith(executor,
    `SELECT
       (SELECT COUNT(*)::int FROM reports WHERE user_id=$1) AS reports,
       (SELECT COUNT(*)::int FROM reports WHERE user_id=$1 AND status='resolved') AS resolved_reports,
       (SELECT COUNT(*)::int FROM report_votes WHERE user_id=$1) AS votes,
       (SELECT points FROM users WHERE id=$1) AS points`,
    [userId]
  );
  const stats = statsRows[0];
  const earnedBadges = [];
  const checks = [
    ["first_report", stats.reports >= 1],
    ["five_reports", stats.reports >= 5],
    ["first_resolution", stats.resolved_reports >= 1],
    ["helpful_neighbor", stats.votes >= 5],
    ["century_club", stats.points >= 100],
  ];

  for (const [code, eligible] of checks) {
    if (!eligible) continue;
    const { rows: badgeRows } = await queryWith(executor,
      `INSERT INTO user_badges (user_id,badge_id)
       SELECT $1,id FROM badges WHERE code=$2
       ON CONFLICT (user_id,badge_id) DO NOTHING
       RETURNING badge_id`,
      [userId, code]
    );
    if (!badgeRows.length) continue;

    const { rows: definitionRows } = await queryWith(executor,
      `SELECT name FROM badges WHERE id=$1`,
      [badgeRows[0].badge_id]
    );
    const badgeName = definitionRows[0]?.name || "a new badge";
    await queryWith(executor,
      `INSERT INTO notifications (user_id,type,title,body,payload)
       VALUES ($1,'badge_earned','New badge earned', $2, $3)`,
      [userId, `You earned the ${badgeName} badge.`, JSON.stringify({ badge: code })]
    );
    earnedBadges.push(code);
  }

  await queryWith(executor,
    `INSERT INTO notifications (user_id,type,title,body,payload)
     VALUES ($1,'points_earned','Community points earned',$2,$3)`,
    [userId, `You earned ${points} points for community activity.`, JSON.stringify({ points, reason })]
  );

  if (io) {
    const { rows: notificationRows } = await queryWith(executor,
      `SELECT id,type,title,body,payload,read_at,created_at
       FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2`,
      [userId, earnedBadges.length + 1]
    );
    for (const notification of notificationRows) {
      io.to(`user:${userId}`).emit("notification:new", notification);
    }
    if (earnedBadges.length) {
      io.to(`user:${userId}`).emit("badge:earned", { badges: earnedBadges });
    }
    io.to(`user:${userId}`).emit("points:updated", user);
  }

  return user;
}
