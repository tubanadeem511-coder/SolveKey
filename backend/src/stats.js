import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { asyncRoute } from "./async-route.js";
import { q } from "./db.js";

export const stats = Router();

stats.get("/", requireAuth, asyncRoute(async (req, res) => {
  if (!["department", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsedDepartmentId = req.query.department_id === undefined
    ? null
    : z.coerce.number().int().positive().safeParse(req.query.department_id);
  if (parsedDepartmentId && !parsedDepartmentId.success) {
    return res.status(400).json({ error: "Invalid department_id" });
  }
  let departmentId = parsedDepartmentId ? parsedDepartmentId.data : null;
  if (req.user.role === "department") {
    if (!req.user.department_id) return res.status(403).json({ error: "Department account is not assigned to a department" });
    departmentId = req.user.department_id;
  }

  const [summary, categories, departments] = await Promise.all([
    q(`SELECT
        COUNT(*) FILTER (WHERE r.status NOT IN ('resolved','duplicate'))::int AS open,
        COUNT(*) FILTER (WHERE r.status='resolved')::int AS resolved,
        COALESCE(ROUND(AVG(r.severity)::numeric, 1), 0)::float AS average_severity
      FROM reports r
      WHERE r.duplicate_of IS NULL AND ($1::int IS NULL OR r.department_id=$1)`, [departmentId]),
    q(`SELECT COALESCE(r.category,'unclassified') AS category, COUNT(*)::int AS count
      FROM reports r
      WHERE r.duplicate_of IS NULL AND ($1::int IS NULL OR r.department_id=$1)
      GROUP BY r.category ORDER BY count DESC, category ASC`, [departmentId]),
    q(`SELECT id,name FROM departments ORDER BY name`),
  ]);

  res.json({
    ...summary.rows[0],
    by_category: categories.rows,
    departments: departments.rows,
  });
}));
