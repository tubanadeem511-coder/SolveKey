import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";
import { analyzeStoredReport } from "../src/agents/orchestrator.js";

const targets = new Map([
  [5, { category: "broken_road", status: "in_progress" }],
  [7, { category: "garbage", status: "in_progress" }],
  [8, { category: "sewerage_drainage", status: "reported" }],
]);
const analysisFields = ["severity", "department_id", "summary"];
const selectFields = `id,category,description,severity,department_id,summary,status,duplicate_of,lat,lng,address`;

function isExpectedReport(report, id) {
  const expected = targets.get(id);
  return Boolean(report && expected &&
    report.id === id &&
    report.category === expected.category &&
    report.status === expected.status &&
    report.duplicate_of === null &&
    typeof report.description === "string" &&
    report.description.trim() &&
    (report.severity === null || (Number.isInteger(report.severity) && report.severity >= 1 && report.severity <= 5)) &&
    (report.department_id === null || (Number.isInteger(report.department_id) && report.department_id > 0)) &&
    (report.summary === null || (typeof report.summary === "string" && report.summary.trim())));
}

function hasMissingAnalysis(report) {
  return analysisFields.some((field) => report[field] === null);
}

function unchangedPreconditions(before, current) {
  return current &&
    current.id === before.id &&
    current.category === before.category &&
    current.description === before.description &&
    current.status === before.status &&
    current.duplicate_of === null &&
    analysisFields.every((field) => before[field] === null || current[field] === before[field]);
}

function validateAnalysis(analysis) {
  if (!analysis ||
      !Number.isInteger(analysis.severity) || analysis.severity < 1 || analysis.severity > 5 ||
      !Number.isInteger(analysis.department_id) || analysis.department_id < 1 ||
      typeof analysis.summary !== "string" || !analysis.summary.trim()) {
    throw new Error("Report analysis did not produce valid severity, department, and summary values");
  }
}

export async function backfillReportAnalysis({ database = pool, analyze = analyzeStoredReport } = {}) {
  const results = [];

  for (const id of targets.keys()) {
    const { rows } = await database.query(`SELECT ${selectFields} FROM reports WHERE id=$1`, [id]);
    const before = rows[0];
    if (!isExpectedReport(before, id)) {
      results.push({ id, result: "skipped", reason: "report data did not match the approved preconditions" });
      continue;
    }
    if (!hasMissingAnalysis(before)) {
      results.push({ id, result: "skipped", reason: "analysis fields are already populated" });
      continue;
    }

    const analysis = await analyze(before);
    validateAnalysis(analysis);
    const client = await database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const { rows: lockedRows } = await client.query(
        `SELECT ${selectFields} FROM reports WHERE id=$1 FOR UPDATE`,
        [id]
      );
      const current = lockedRows[0];
      if (!isExpectedReport(current, id) ||
          !unchangedPreconditions(before, current) ||
          !hasMissingAnalysis(current)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        results.push({ id, result: "skipped", reason: "report changed before the update" });
        continue;
      }

      const update = await client.query(
        `UPDATE reports
         SET severity=COALESCE(severity,$2),
             department_id=COALESCE(department_id,$3),
             summary=COALESCE(summary,$4)
         WHERE id=$1 AND category=$5 AND description=$6 AND status=$7
           AND duplicate_of IS NULL
           AND (severity IS NULL OR department_id IS NULL OR summary IS NULL)
         RETURNING id`,
        [id, analysis.severity, analysis.department_id, analysis.summary.trim(),
          before.category, before.description, before.status]
      );
      if (update.rowCount !== 1) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        results.push({ id, result: "skipped", reason: "report no longer met the update conditions" });
        continue;
      }

      const { rows: verifiedRows } = await client.query(
        `SELECT ${selectFields} FROM reports WHERE id=$1`,
        [id]
      );
      const after = verifiedRows[0];
      const preserved = unchangedPreconditions(before, after);
      const complete = analysisFields.every((field) => after?.[field] !== null && after?.[field] !== undefined);
      if (!preserved || !complete) {
        throw new Error(`Post-update verification failed for report #${id}`);
      }

      await client.query("COMMIT");
      transactionOpen = false;
      results.push({
        id,
        result: "updated",
        status: after.status,
        populatedFields: analysisFields.filter((field) => before[field] === null),
      });
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = await backfillReportAnalysis();
    console.log(JSON.stringify(results));
  } catch (error) {
    console.error("Report analysis backfill failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
