import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pool, q } from "../src/db.js";

const api = process.env.SolveKey_API_URL || "http://localhost:4000";
const fixture = process.argv[2];
const mediaTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const image = fixture ? await fs.readFile(fixture) : Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lD8AAAAASUVORK5CYII=",
  "base64"
);
const mediaType = fixture
  ? mediaTypes[path.extname(fixture).toLowerCase()]
  : "image/png";
if (!mediaType) throw new Error("Pass a .jpg, .png, or .webp image");

async function request(url, options = {}) {
  const response = await fetch(`${api}${url}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${url}: ${JSON.stringify(body)}`);
  return { body, response };
}

let reportId;
try {
  const email = `pipeline-test-${Date.now()}@example.test`;
  const { response: registered } = await request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Pipeline Test", email, password: "Pipeline-test-123!" }),
  });
  const cookie = registered.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Registration did not return an auth cookie");

  const { body: report } = await request("/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      lat: 24.5 + Math.random() * 0.8,
      lng: 66.7 + Math.random() * 0.8,
      image_base64: image.toString("base64"),
      media_type: mediaType,
    }),
  });
  reportId = report.id;
  if (!report.image_url) throw new Error("Submitted image was not stored");

  const deadline = Date.now() + 180_000;
  let trace = [];
  while (Date.now() < deadline) {
    ({ body: trace } = await request(`/api/reports/${reportId}/trace`));
    if (trace.some((entry) => entry.agent_name === "ReportWriter")) break;
    const { rows: jobs } = await q(
      `SELECT status,attempts,last_error FROM report_jobs WHERE report_id=$1`,
      [reportId]
    );
    if (jobs[0]?.status === "failed") {
      throw new Error(`Pipeline failed after ${jobs[0].attempts} attempts: ${jobs[0].last_error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!trace.some((entry) => entry.agent_name === "ReportWriter")) {
    throw new Error("Timed out waiting for ReportWriter");
  }

  const { rows } = await q(`SELECT summary FROM reports WHERE id=$1`, [reportId]);
  if (!rows[0]?.summary) throw new Error("Report summary was not saved");
  console.log(`Pipeline passed for report ${reportId}`);
} finally {
  await pool.end();
}
