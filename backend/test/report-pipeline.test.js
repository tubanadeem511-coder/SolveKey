import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../src/db.js";
import { runPipeline } from "../src/agents/orchestrator.js";

test("pipeline reuses prevalidated classification instead of sending the image to Vision again", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const geminiRequests = [];
  const clientStatements = [];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  pool.query = async (query, params) => {
    if (query.includes("SELECT id, category, status, description")) return { rows: [] };
    if (query.includes("SELECT * FROM departments")) {
      return { rows: [{ id: 12, name: "KMC Roads", categories: ["damaged_footpath"] }] };
    }
    if (query.includes("INSERT INTO agent_logs")) return { rows: [], rowCount: 1 };
    if (query.includes("UPDATE reports")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  pool.connect = async () => ({
    query: async (query, params) => {
      clientStatements.push({ query, params });
      if (query.includes("SELECT id,category,duplicate_of FROM reports")) {
        return { rows: [{ id: 25, category: "damaged_footpath", duplicate_of: null }] };
      }
      if (query.includes("SELECT id,categories FROM departments")) {
        return { rows: [{ id: 12, categories: ["damaged_footpath"] }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.open-meteo.com")) {
      return new Response(JSON.stringify({ current: { temperature_2m: 20, precipitation: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    geminiRequests.push(JSON.parse(options.body));
    const text = geminiRequests.length === 1
      ? JSON.stringify({ severity: 3, reason: "A road hazard." })
      : JSON.stringify({ summary: "Pothole on public road\nLocation: 24.86, 67\nSeverity: 3\nRepair the road surface." });
    return new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await runPipeline({
      report: {
        id: 25,
        user_id: null,
        image_url: "https://images.example.test/report.png",
        lat: 24.86,
        lng: 67,
        address: null,
        category: "damaged_footpath",
        description: "A damaged footpath is visible on the public road.",
        classification_prevalidated: true,
      },
      io: { emit() {} },
    });

    assert.deepEqual(result, { duplicate: false });
    assert.equal(geminiRequests.length, 2);
    assert.ok(geminiRequests.every((request) =>
      !JSON.stringify(request.contents).includes("inlineData")));
    assert.ok(clientStatements.some(({ query }) => query.includes("UPDATE reports SET department_id")));
  } finally {
    globalThis.fetch = originalFetch;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("duplicate reports retain the correct category department assignment", async () => {
  const originalQuery = pool.query;
  const statements = [];
  const events = [];
  pool.query = async (query, params) => {
    statements.push({ query, params });
    if (query.includes("WHERE category = $3")) {
      return { rows: [{ id: 24, distance_m: 18 }] };
    }
    if (query.includes("SELECT * FROM departments")) {
      return {
        rows: [{
          id: 14,
          name: "KMC Sanitation",
          categories: ["overflowing_dustbin"],
        }],
      };
    }
    return { rows: [], rowCount: 1 };
  };

  try {
    const result = await runPipeline({
      report: {
        id: 25,
        user_id: null,
        image_url: "https://images.example.test/report.png",
        lat: 24.86,
        lng: 67,
        address: null,
        category: "overflowing_dustbin",
        description: "A public dustbin is overflowing.",
        classification_prevalidated: true,
      },
      io: { emit: (event, payload) => events.push({ event, payload }) },
    });

    assert.deepEqual(result, { duplicate: true, duplicateOf: 24 });
    assert.ok(statements.some(({ query, params }) =>
      query.includes("SET duplicate_of=$2,status='duplicate',department_id=$3") &&
      params[0] === 25 && params[1] === 24 && params[2] === 14));
    assert.ok(statements.some(({ query, params }) =>
      query.includes("INSERT INTO agent_logs") && params[1] === "RoutingAgent"));
    assert.deepEqual(events, [{
      event: "report:updated",
      payload: {
        id: 25,
        status: "duplicate",
        duplicate_of: 24,
        category: "overflowing_dustbin",
        department: "KMC Sanitation",
      },
    }]);
  } finally {
    pool.query = originalQuery;
  }
});
