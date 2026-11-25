import assert from "node:assert/strict";
import { once } from "node:events";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import test from "node:test";
import { reports } from "../src/reports.js";
import { REPORT_CATEGORIES } from "../src/report-categories.js";
import { pool } from "../src/db.js";

async function withReportsServer(run, {
  classification,
  geminiStatus = 200,
  authUsers = [{ id: 7, role: "citizen", department_id: null }],
  traceReport = { user_id: 7, department_id: 4 },
  mineReports = [{
    id: 25,
    report_number: "SK-2026-000025",
    category: "pothole",
    status: "reported",
  }],
  trackingReport = {
    report_number: "SK-2026-0123456789ABCDEF0123456789ABCDEF",
    issue: "Pothole on public road",
    description: "A pothole is visible on the public road.",
    summary: "Pothole on public road",
    category: "pothole",
    location: "Test location",
    status: "pending",
    created_at: "2026-11-23T00:00:00.000Z",
    updated_at: "2026-11-23T00:00:00.000Z",
    department_name: "KMC Roads",
  },
} = {}) {
  const environmentKeys = [
    "JWT_SECRET",
    "GEMINI_API_KEY",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const clientStatements = [];
  const geminiRequests = [];
  const uploads = [];
  let connectCount = 0;
  let traceLogQueryCount = 0;
  let trackingQueryCount = 0;
  let currentTrackingReport = trackingReport;
  let nextReportId = 25;
  let insertedReport;

  process.env.JWT_SECRET = "test-report-route-secret";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  pool.query = async (query, params = []) => {
    if (query.includes("WHERE r.user_id=$1")) {
      return { rows: mineReports };
    }
    if (query.includes("WHERE r.report_number=$1")) {
      trackingQueryCount += 1;
      return params[0] === currentTrackingReport?.report_number
        ? { rows: [currentTrackingReport] }
        : { rows: [] };
    }
    if (query.includes("SELECT id,role,department_id FROM users")) {
      const user = authUsers.find(({ id }) => id === params[0]);
      return { rows: user ? [user] : [] };
    }
    if (query.includes("SELECT user_id,department_id FROM reports WHERE id=$1")) {
      return params[0] === 25 && traceReport ? { rows: [traceReport] } : { rows: [] };
    }
    if (query.includes("SELECT agent_name,input,output,created_at FROM agent_logs WHERE report_id=$1")) {
      traceLogQueryCount += 1;
      return {
        rows: [{
          agent_name: "VisionAgent",
          input: { description: "Test report" },
          output: { category: "pothole" },
          created_at: new Date().toISOString(),
        }],
      };
    }
    return { rows: [] };
  };
  pool.connect = async () => {
    connectCount += 1;
    return {
      query: async (query, params) => {
        clientStatements.push({ query, params });
        if (query.includes("INSERT INTO reports")) {
          const id = nextReportId++;
          const createdAt = new Date().toISOString();
          insertedReport = {
            id,
            report_number: `SK-${createdAt.slice(0, 4)}-${String(id).padStart(6, "0")}`,
            user_id: 7,
            image_url: params[1],
            lat: params[2],
            lng: params[3],
            address: params[4],
            category: params[5],
            severity: null,
            status: "pending",
            description: params[6],
            department_id: null,
            duplicate_of: null,
            upvotes: 0,
            created_at: createdAt,
          };
          currentTrackingReport = {
            report_number: insertedReport.report_number,
            issue: insertedReport.description,
            description: insertedReport.description,
            summary: null,
            category: insertedReport.category,
            location: insertedReport.address || "Location not provided",
            status: insertedReport.status,
            created_at: createdAt,
            updated_at: createdAt,
            department_name: null,
          };
          return { rows: [insertedReport], rowCount: 1 };
        }
        if (query.includes("SELECT id,user_id,status,department_id FROM reports WHERE id=$1 FOR UPDATE")) {
          return {
            rows: currentTrackingReport
              ? [{ id: params[0], user_id: null, status: currentTrackingReport.status, department_id: null }]
              : [],
          };
        }
        if (query.includes("UPDATE reports SET status=$2 WHERE id=$1")) {
          currentTrackingReport = { ...currentTrackingReport, status: params[1] };
          return { rows: [], rowCount: 1 };
        }
        if (query.includes("UPDATE users")) {
          return { rows: [{ id: 7, points: 10, level: "Citizen" }] };
        }
        if (/SELECT\s+\(SELECT COUNT/.test(query)) {
          return { rows: [{ reports: 1, resolved_reports: 0, votes: 0, points: 10 }] };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
  };
  globalThis.fetch = async (url, options) => {
    if (new URL(String(url)).hostname === "127.0.0.1") return originalFetch(url, options);
    const host = new URL(String(url)).hostname;
    if (host.includes("googleapis.com")) {
      geminiRequests.push(JSON.parse(options.body));
      const body = geminiStatus === 200
        ? { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(classification) }] }, finishReason: "STOP" }] }
        : { error: { message: "Mock Gemini failure" } };
      return new Response(JSON.stringify(body), { status: geminiStatus, headers: { "content-type": "application/json" } });
    }
    assert.equal(host, "api.cloudinary.com");
    uploads.push(options);
    assert.ok(options.body instanceof FormData);
    return new Response(JSON.stringify({ secure_url: "https://images.example.test/report.png" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/reports", reports);
  app.set("io", { emit() {}, to: () => ({ emit() {} }) });
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    const token = jwt.sign({ id: 7, role: "citizen" }, process.env.JWT_SECRET);
    await run({
      clientStatements,
      geminiRequests,
      uploads,
      getConnectCount: () => connectCount,
      getTraceLogQueryCount: () => traceLogQueryCount,
      getTrackingQueryCount: () => trackingQueryCount,
      setTrackingStatus: (status) => {
        currentTrackingReport = { ...currentTrackingReport, status };
      },
      getInsertedReport: () => insertedReport,
      listRequest: (category) =>
        originalFetch(`http://127.0.0.1:${address.port}/api/reports?category=${encodeURIComponent(category)}`),
      mineRequest: () =>
        originalFetch(`http://127.0.0.1:${address.port}/api/reports/mine`, {
          headers: { cookie: `token=${token}` },
        }),
      trackRequest: (reportNumber) =>
        originalFetch(`http://127.0.0.1:${address.port}/api/reports/track/${encodeURIComponent(reportNumber)}`),
      statusRequest: ({ userId = 9, reportId = 25, status = "in_progress" } = {}) =>
        originalFetch(`http://127.0.0.1:${address.port}/api/reports/${reportId}/status`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: `token=${jwt.sign({ id: userId }, process.env.JWT_SECRET)}`,
          },
          body: JSON.stringify({ status }),
        }),
      traceRequest: ({ userId = 7, authenticated = true, reportId = 25 } = {}) => {
        const headers = {};
        if (authenticated) {
          headers.cookie = `token=${jwt.sign({ id: userId, role: "citizen" }, process.env.JWT_SECRET)}`;
        }
        return originalFetch(`http://127.0.0.1:${address.port}/api/reports/${reportId}/trace`, { headers });
      },
      request: (body) => originalFetch(`http://127.0.0.1:${address.port}/api/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}`,
        },
        body: JSON.stringify(body),
      }),
    });
  } finally {
    globalThis.fetch = originalFetch;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const validSubmission = {
  lat: 24.86,
  lng: 67,
  address: "Test location",
  image_base64: validPng,
  media_type: "image/png",
};

test("authenticated report list returns each stored report number", async () => {
  await withReportsServer(async ({ mineRequest }) => {
    const response = await mineRequest();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body[0].report_number, "SK-2026-000025");
  });
});

test("report creation accepts civic images and queues the preclassified report", async () => {
  await withReportsServer(async ({
    request, clientStatements, geminiRequests, uploads, getInsertedReport,
  }) => {
    const response = await request(validSubmission);
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.status, "pending");
    assert.equal(body.id, 25);
    assert.match(body.report_number, /^SK-\d{4}-\d{6,}$/);
    assert.equal(body.category, "pothole");
    assert.equal(body.description, "A pothole is visible on the public road.");
    assert.equal(geminiRequests.length, 1);
    assert.equal(uploads.length, 1);

    const insert = clientStatements.find(({ query }) => query.includes("INSERT INTO reports"));
    assert.ok(insert);
    assert.match(insert.query, /INSERT INTO reports \(user_id,image_url/);
    assert.match(insert.query, /RETURNING id,report_number/);
    assert.equal(insert.params[5], "pothole");
    assert.equal(insert.params[6], "A pothole is visible on the public road.");
    const visionLog = clientStatements.find(({ query }) => query.includes("INSERT INTO agent_logs"));
    assert.ok(visionLog);
    const visionOutput = JSON.parse(visionLog.params[2]);
    assert.equal(visionOutput.civic_relevant, true);
    assert.equal(visionOutput.submissionPrecheck, true);
    assert.ok(clientStatements.some(({ query }) => query.includes("UPDATE users")));
    assert.ok(clientStatements.some(({ query }) => query.includes("INSERT INTO report_jobs")));
    assert.ok(clientStatements.some(({ query }) => query === "COMMIT"));
    assert.deepEqual(getInsertedReport(), body);

    const secondResponse = await request(validSubmission);
    const secondBody = await secondResponse.json();
    assert.equal(secondResponse.status, 201);
    assert.notEqual(secondBody.report_number, body.report_number);
  }, {
    classification: {
      civic_relevant: true,
      category: "pothole",
      description: "A pothole is visible on the public road.",
    },
  });
});

test("report category filters accept only the configured categories", async () => {
  await withReportsServer(async ({ listRequest }) => {
    for (const category of REPORT_CATEGORIES) {
      const response = await listRequest(category);
      assert.equal(response.status, 200, category);
    }
    assert.equal((await listRequest("road_damage")).status, 400);
    assert.equal((await listRequest("unknown")).status, 400);
  });
});

test("a submitted report can be tracked before and after a status update", async () => {
  await withReportsServer(async ({ request, trackRequest, statusRequest }) => {
    const submission = await request(validSubmission);
    const created = await submission.json();

    assert.equal(submission.status, 201);
    assert.match(created.report_number, /^SK-\d{4}-\d{6,}$/);

    const firstTrackingResponse = await trackRequest(created.report_number);
    assert.equal(firstTrackingResponse.status, 200);
    assert.equal((await firstTrackingResponse.json()).status, "pending");

    const updateResponse = await statusRequest({ reportId: created.id, status: "in_progress" });
    assert.equal(updateResponse.status, 200);

    const updatedTrackingResponse = await trackRequest(created.report_number);
    assert.equal(updatedTrackingResponse.status, 200);
    assert.equal((await updatedTrackingResponse.json()).status, "in_progress");
  }, {
    authUsers: [
      { id: 7, role: "citizen", department_id: null },
      { id: 9, role: "admin", department_id: null },
    ],
    classification: {
      civic_relevant: true,
      category: "pothole",
      description: "A pothole is visible on the public road.",
    },
  });
});

test("public tracking returns safe report details and reads the current database status", async () => {
  await withReportsServer(async ({
    trackRequest, setTrackingStatus, getTrackingQueryCount,
  }) => {
    const firstResponse = await trackRequest("sk-2026-0123456789abcdef0123456789abcdef");
    const firstBody = await firstResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("cache-control"), "no-store");
    assert.equal(firstBody.status, "pending");
    assert.equal(firstBody.report_number, "SK-2026-0123456789ABCDEF0123456789ABCDEF");
    assert.equal(firstBody.department_name, "KMC Roads");
    assert.deepEqual(Object.keys(firstBody).sort(), [
      "category",
      "created_at",
      "department_name",
      "description",
      "issue",
      "location",
      "report_number",
      "status",
      "summary",
      "updated_at",
    ]);

    setTrackingStatus("in_progress");
    const updatedResponse = await trackRequest("SK-2026-0123456789ABCDEF0123456789ABCDEF");
    assert.equal((await updatedResponse.json()).status, "in_progress");
    assert.equal(getTrackingQueryCount(), 2);

    const missingResponse = await trackRequest("SK-2026-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: "Report not found" });
    const invalidResponse = await trackRequest("25");
    assert.equal(invalidResponse.status, 404);
    assert.deepEqual(await invalidResponse.json(), { error: "Report not found" });
    assert.equal(getTrackingQueryCount(), 3);
  });
});

test("unrelated images are rejected before upload, insertion, rewards, or job creation", async () => {
  await withReportsServer(async ({ request, clientStatements, geminiRequests, uploads, getConnectCount }) => {
    const response = await request(validSubmission);
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.match(body.error, /does not appear to show a civic issue/i);
    assert.equal(geminiRequests.length, 1);
    assert.equal(uploads.length, 0);
    assert.equal(getConnectCount(), 0);
    assert.equal(clientStatements.length, 0);
  }, {
    classification: {
      civic_relevant: false,
      category: "electricity_issue",
      description: "A household cooking appliance.",
    },
  });
});

test("report trace is available only to the owner, assigned department staff, and admins", async () => {
  const authUsers = [
    { id: 7, role: "citizen", department_id: null },
    { id: 8, role: "citizen", department_id: null },
    { id: 9, role: "admin", department_id: null },
    { id: 10, role: "department", department_id: 4 },
    { id: 11, role: "department", department_id: 5 },
  ];
  await withReportsServer(async ({ traceRequest, getTraceLogQueryCount }) => {
    for (const userId of [7, 9, 10]) {
      const response = await traceRequest({ userId });
      assert.equal(response.status, 200);
      assert.equal((await response.json())[0].agent_name, "VisionAgent");
    }

    assert.equal((await traceRequest({ userId: 8 })).status, 403);
    assert.equal((await traceRequest({ userId: 11 })).status, 403);
    assert.equal((await traceRequest({ authenticated: false })).status, 401);
    assert.equal((await traceRequest({ reportId: 999 })).status, 404);
    assert.equal(getTraceLogQueryCount(), 3);
  }, { authUsers });
});
