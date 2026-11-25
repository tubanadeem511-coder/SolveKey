import assert from "node:assert/strict";
import test from "node:test";
import { backfillReportAnalysis } from "../scripts/backfill-report-analysis.js";

function makeReport(id, category, status) {
  return {
    id,
    category,
    description: `Stored description for report ${id}`,
    severity: null,
    department_id: null,
    summary: null,
    status,
    duplicate_of: null,
    other_data: `preserve-${id}`,
  };
}

function makeDatabase(initialReports) {
  const rows = new Map(initialReports.map((report) => [report.id, { ...report }]));
  const queriedIds = [];
  const updatedIds = [];
  const statements = [];
  const database = {
    query: async (sql, params) => {
      statements.push(sql);
      queriedIds.push(params[0]);
      return { rows: rows.has(params[0]) ? [{ ...rows.get(params[0]) }] : [] };
    },
    connect: async () => ({
      query: async (sql, params) => {
        statements.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        const id = params[0];
        const report = rows.get(id);
        if (sql.includes("FOR UPDATE")) return { rows: report ? [{ ...report }] : [] };
        if (sql.startsWith("UPDATE reports")) {
          assert.match(sql, /SET severity=COALESCE\(severity,\$2\)/);
          assert.match(sql, /department_id=COALESCE\(department_id,\$3\)/);
          assert.match(sql, /summary=COALESCE\(summary,\$4\)/);
          const setClause = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
          assert.doesNotMatch(setClause, /\bstatus\s*=/i);
          assert.doesNotMatch(setClause, /\bduplicate_of\s*=/i);
          if (!report || report.duplicate_of !== null ||
              report.category !== params[4] || report.description !== params[5] ||
              report.status !== params[6]) {
            return { rows: [], rowCount: 0 };
          }
          for (const [index, field] of ["severity", "department_id", "summary"].entries()) {
            if (report[field] === null) report[field] = params[index + 1];
          }
          updatedIds.push(id);
          return { rows: [{ id }], rowCount: 1 };
        }
        return { rows: report ? [{ ...report }] : [], rowCount: report ? 1 : 0 };
      },
      release() {},
    }),
  };
  return { database, rows, queriedIds, updatedIds, statements };
}

test("backfill updates only approved missing fields and preserves statuses and unrelated records", async () => {
  const initial = [
    makeReport(5, "broken_road", "in_progress"),
    makeReport(6, "electricity_issue", "reported"),
    makeReport(7, "garbage", "in_progress"),
    makeReport(8, "sewerage_drainage", "reported"),
    makeReport(9, "pothole", "reported"),
  ];
  const { database, rows, queriedIds, updatedIds } = makeDatabase(initial);
  const untouched = new Map([[6, { ...rows.get(6) }], [9, { ...rows.get(9) }]]);
  const analyzed = [];

  const results = await backfillReportAnalysis({
    database,
    analyze: async (report) => {
      analyzed.push({ id: report.id, category: report.category, description: report.description });
      return {
        severity: report.id % 5 + 1,
        department_id: report.id + 100,
        summary: `Analysis summary for report ${report.id}`,
      };
    },
  });

  assert.deepEqual(queriedIds, [5, 7, 8]);
  assert.deepEqual(analyzed.map(({ id }) => id), [5, 7, 8]);
  assert.deepEqual(updatedIds, [5, 7, 8]);
  assert.deepEqual(results.map(({ id, result, status, populatedFields }) => ({
    id, result, status, populatedFields,
  })), [
    { id: 5, result: "updated", status: "in_progress", populatedFields: ["severity", "department_id", "summary"] },
    { id: 7, result: "updated", status: "in_progress", populatedFields: ["severity", "department_id", "summary"] },
    { id: 8, result: "updated", status: "reported", populatedFields: ["severity", "department_id", "summary"] },
  ]);
  for (const id of [5, 7, 8]) {
    const report = rows.get(id);
    assert.ok(report.severity >= 1 && report.severity <= 5);
    assert.ok(report.department_id > 0);
    assert.ok(report.summary);
    assert.equal(report.status, initial.find((item) => item.id === id).status);
    assert.equal(report.other_data, `preserve-${id}`);
  }
  for (const [id, report] of untouched) assert.deepEqual(rows.get(id), report);
});

test("backfill skips a report whose status no longer matches the approved preconditions", async () => {
  const initial = [
    makeReport(5, "broken_road", "in_progress"),
    makeReport(7, "garbage", "in_progress"),
    makeReport(8, "sewerage_drainage", "resolved"),
  ];
  const { database, rows, updatedIds } = makeDatabase(initial);
  let analyzeCount = 0;

  const results = await backfillReportAnalysis({
    database,
    analyze: async () => {
      analyzeCount += 1;
      return { severity: 3, department_id: 1, summary: "Generated summary" };
    },
  });

  assert.deepEqual(updatedIds, [5, 7]);
  assert.equal(analyzeCount, 2);
  assert.deepEqual(results[2], {
    id: 8,
    result: "skipped",
    reason: "report data did not match the approved preconditions",
  });
  assert.equal(rows.get(8).status, "resolved");
  assert.equal(rows.get(8).severity, null);
});
