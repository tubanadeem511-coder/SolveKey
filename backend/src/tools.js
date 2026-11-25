import { pool, q } from "./db.js";
import { REPORT_CATEGORIES } from "./report-categories.js";

const categories = new Set(REPORT_CATEGORIES);

export async function findNearbyReports({ lat, lng, category, radius_m = 100, excludeReportId }) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      !categories.has(category) || !Number.isFinite(radius_m) || radius_m < 1 || radius_m > 5000 ||
      (excludeReportId !== undefined &&
        (!Number.isInteger(excludeReportId) || excludeReportId < 1 || excludeReportId > 2_147_483_647))) {
    throw new Error("Invalid nearby-report search parameters");
  }
  const { rows } = await q(
    `SELECT id, category, status, description,
      (6371000 * acos(GREATEST(-1,LEAST(1, cos(radians($1))*cos(radians(lat))*cos(radians(lng)-radians($2))
        + sin(radians($1))*sin(radians(lat)))))) AS distance_m
     FROM reports
     WHERE category = $3 AND status <> 'resolved' AND duplicate_of IS NULL
       AND ($4::int IS NULL OR id <> $4)
     ORDER BY distance_m ASC LIMIT 5`,
    [lat, lng, category, excludeReportId ?? null]
  );
  return rows.filter((r) => r.distance_m <= radius_m);
}

export async function getDepartment({ category }) {
  if (!categories.has(category)) throw new Error("Invalid civic issue category");
  const { rows } = await q(`SELECT * FROM departments WHERE $1 = ANY(categories) LIMIT 1`, [category]);
  return rows[0] || null;
}

export async function createTicket({ report_id, department_id }) {
  if (!Number.isInteger(report_id) || report_id < 1 ||
      !Number.isInteger(department_id) || department_id < 1) {
    throw new Error("Invalid ticket assignment");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: reportRows } = await client.query(
      `SELECT id,category,duplicate_of FROM reports WHERE id=$1 FOR UPDATE`,
      [report_id]
    );
    if (!reportRows.length || reportRows[0].duplicate_of !== null) {
      throw new Error("Report does not exist or is already merged");
    }
    const { rows: departmentRows } = await client.query(
      `SELECT id,categories FROM departments WHERE id=$1`,
      [department_id]
    );
    if (!departmentRows.length || !departmentRows[0].categories.includes(reportRows[0].category)) {
      throw new Error("Department is not responsible for this report category");
    }
    await client.query(
      `UPDATE reports SET department_id=$2,status='reported' WHERE id=$1`,
      [report_id, department_id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { ticket: `ECO-${report_id}`, department_id };
}

export async function searchReports({ query, category, status, limit = 20 }) {
  if (typeof query !== "string" || query.trim().length < 1 || query.trim().length > 120 ||
      (category && !categories.has(category)) ||
      (status && !["pending", "reported", "in_progress", "resolved"].includes(status)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid report search parameters");
  }
  const { rows } = await q(
    `SELECT id,category,severity,status,description,summary,address,lat,lng,created_at
     FROM reports
     WHERE duplicate_of IS NULL
       AND concat_ws(' ',category,description,summary,address) ILIKE '%' || $1 || '%'
       AND ($2::text IS NULL OR category=$2)
       AND ($3::text IS NULL OR status=$3)
     ORDER BY created_at DESC LIMIT $4`,
    [query.trim(), category ?? null, status ?? null, limit]
  );
  return rows;
}
