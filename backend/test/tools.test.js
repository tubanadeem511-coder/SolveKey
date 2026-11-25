import assert from "node:assert/strict";
import test from "node:test";
import { createTicket, findNearbyReports, getDepartment, searchReports } from "../src/tools.js";
import { REPORT_CATEGORIES } from "../src/report-categories.js";
import { pool } from "../src/db.js";

test("rejects invalid coordinates, categories, and radii before querying the database", async () => {
  await assert.rejects(() => findNearbyReports({ lat: 100, lng: 0, category: "garbage" }), /Invalid nearby-report/);
  await assert.rejects(() => findNearbyReports({ lat: 24, lng: 67, category: "unknown" }), /Invalid nearby-report/);
  await assert.rejects(() => findNearbyReports({ lat: 24, lng: 67, category: "garbage", radius_m: 0 }), /Invalid nearby-report/);
  await assert.rejects(() => findNearbyReports({ lat: 24, lng: 67, category: "garbage", excludeReportId: 0 }), /Invalid nearby-report/);
  await assert.rejects(() => getDepartment({ category: "unknown" }), /Invalid civic issue/);
});

test("the 12 configured categories route to exactly the four seeded departments", async () => {
  const expected = {
    "K-Electric": ["street_light", "electricity_issue"],
    "Karachi Water Board": ["water_leakage", "water_supply", "sewerage_drainage"],
    "KMC Roads": ["pothole", "broken_road", "damaged_footpath"],
    "KMC Sanitation": ["garbage", "overflowing_dustbin", "waste_collection", "dirty_street"],
  };
  const originalQuery = pool.query;
  const departments = Object.entries(expected).map(([name, categories], index) => ({
    id: index + 1,
    name,
    categories,
  }));
  pool.query = async (query, params) => {
    assert.match(query, /ANY\(categories\)/);
    const department = departments.find(({ categories }) => categories.includes(params[0]));
    return { rows: department ? [department] : [] };
  };

  try {
    const expectedCategories = Object.values(expected).flat();
    assert.equal(REPORT_CATEGORIES.length, 12);
    assert.equal(new Set(REPORT_CATEGORIES).size, 12);
    assert.deepEqual([...REPORT_CATEGORIES].sort(), [...expectedCategories].sort());
    for (const [name, categories] of Object.entries(expected)) {
      for (const category of categories) {
        assert.equal((await getDepartment({ category })).name, name);
      }
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("nearby search excludes the current report but retains other matching reports", async () => {
  const originalQuery = pool.query;
  let capturedQuery = "";
  let capturedParams = [];
  pool.query = async (query, params) => {
    capturedQuery = query;
    capturedParams = params;
    const candidates = [
      { id: 42, distance_m: 0 },
      { id: 43, distance_m: 35 },
    ];
    return { rows: candidates.filter((candidate) => candidate.id !== params[3]) };
  };

  try {
    const matches = await findNearbyReports({
      lat: 24.86,
      lng: 67.0,
      category: "pothole",
      excludeReportId: 42,
    });

    assert.match(capturedQuery, /AND \(\$4::int IS NULL OR id <> \$4\)/);
    assert.deepEqual(capturedParams, [24.86, 67.0, "pothole", 42]);
    assert.deepEqual(matches, [{ id: 43, distance_m: 35 }]);
  } finally {
    pool.query = originalQuery;
  }
});

test("nearby search remains compatible without an excluded report ID", async () => {
  const originalQuery = pool.query;
  let capturedParams;
  pool.query = async (_query, params) => {
    capturedParams = params;
    return { rows: [{ id: 51, distance_m: 20 }] };
  };

  try {
    const matches = await findNearbyReports({ lat: 24.86, lng: 67.0, category: "garbage" });

    assert.deepEqual(capturedParams, [24.86, 67.0, "garbage", null]);
    assert.deepEqual(matches, [{ id: 51, distance_m: 20 }]);
  } finally {
    pool.query = originalQuery;
  }
});

test("ticket assignment still advances a report to reported", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    query: async (query, params) => {
      statements.push({ query, params });
      if (query.includes("SELECT id,category,duplicate_of")) {
        return { rows: [{ id: 81, category: "garbage", duplicate_of: null }] };
      }
      if (query.includes("SELECT id,categories FROM departments")) {
        return { rows: [{ id: 3, categories: ["garbage"] }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;

  try {
    assert.deepEqual(await createTicket({ report_id: 81, department_id: 3 }), {
      ticket: "ECO-81",
      department_id: 3,
    });
    assert.ok(statements.some(({ query, params }) =>
      query.includes("UPDATE reports SET department_id=$2,status='reported'") &&
      params[0] === 81 && params[1] === 3));
    assert.ok(statements.some(({ query }) => query === "COMMIT"));
  } finally {
    pool.connect = originalConnect;
  }
});

test("rejects invalid MCP ticket assignments and report searches", async () => {
  await assert.rejects(() => createTicket({ report_id: 0, department_id: 1 }), /Invalid ticket assignment/);
  await assert.rejects(() => searchReports({ query: "", limit: 20 }), /Invalid report search/);
  await assert.rejects(() => searchReports({ query: "pothole", status: "unrecognized" }), /Invalid report search/);
});
