import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import test from "node:test";
import { assistant } from "../src/assistant.js";
import { pool } from "../src/db.js";

async function withAssistantServer(run, { geminiStatus = 200 } = {}) {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousSecret = process.env.JWT_SECRET;
  const originalFetch = globalThis.fetch;
  const originalQuery = pool.query;
  const geminiRequests = [];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.JWT_SECRET = "test-assistant-jwt-secret";
  pool.query = async (sql) => ({
    rows: sql.includes("SELECT id,role,department_id FROM users")
      ? [{ id: 7, role: "citizen", department_id: null }]
      : [],
  });
  globalThis.fetch = async (url, options) => {
    if (new URL(String(url)).hostname === "127.0.0.1") {
      return originalFetch(url, options);
    }
    geminiRequests.push(JSON.parse(options.body));
    const body = geminiStatus === 200
      ? { candidates: [{ content: { role: "model", parts: [{ text: "Image analysis response" }] }, finishReason: "STOP" }] }
      : { error: { message: "Mock Gemini failure" } };
    return new Response(JSON.stringify(body), { status: geminiStatus, headers: { "content-type": "application/json" } });
  };

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  app.use("/api/assistant", assistant);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    const token = jwt.sign({ id: 7, role: "citizen" }, process.env.JWT_SECRET);
    await run({
      geminiRequests,
      request: (body) => originalFetch(`http://127.0.0.1:${address.port}/api/assistant/chat`, {
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
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("assistant chat preserves text-only requests", async () => {
  await withAssistantServer(async ({ request, geminiRequests }) => {
    const response = await request({ messages: [{ role: "user", content: "How do I report a pothole?" }] });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: "Image analysis response" });
    assert.deepEqual(geminiRequests[0].contents[0].parts, [{ text: "How do I report a pothole?" }]);
  });
});

test("assistant chat sends a validated image to Gemini as inline data", async () => {
  const images = [
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ["image/webp", Buffer.from("RIFF\x00\x00\x00\x00WEBP")],
  ];
  await withAssistantServer(async ({ request, geminiRequests }) => {
    for (const [mediaType, image] of images) {
      const imageBase64 = image.toString("base64");
      const response = await request({
        messages: [{ role: "user", content: "What civic issue is visible?" }],
        image_base64: imageBase64,
        media_type: mediaType,
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { answer: "Image analysis response" });
      assert.deepEqual(geminiRequests.at(-1).contents[0].parts, [
        { text: "What civic issue is visible?" },
        { inlineData: { mimeType: mediaType, data: imageBase64 } },
      ]);
    }
    assert.match(geminiRequests[0].systemInstruction.parts[0].text, /road or footpath damage, public waste, water supply/);
  });
});

test("assistant chat rejects invalid and oversized images without calling Gemini", async () => {
  await withAssistantServer(async ({ request, geminiRequests }) => {
    const invalid = await request({
      messages: [{ role: "user", content: "Analyze this." }],
      image_base64: Buffer.from("not a PNG").toString("base64"),
      media_type: "image/png",
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "The image must be valid JPEG, PNG, or WEBP data." });

    const oversized = await request({
      messages: [{ role: "user", content: "Analyze this." }],
      image_base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
      media_type: "image/png",
    });
    const oversizedBody = await oversized.json();
    assert.equal(oversized.status, 413, JSON.stringify(oversizedBody));
    assert.deepEqual(oversizedBody, { error: "Chat images must be 5 MB or smaller." });
    assert.equal(geminiRequests.length, 0);
  });
});

test("assistant chat returns a generic error when Gemini fails", async () => {
  await withAssistantServer(async ({ request }) => {
    const response = await request({
      messages: [{ role: "user", content: "How do I report damaged streetlights?" }],
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "The AI assistant could not complete this request." });
  }, { geminiStatus: 500 });
});
