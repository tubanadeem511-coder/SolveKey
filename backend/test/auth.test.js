import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import test from "node:test";
import { auth } from "../src/auth.js";
import { pool } from "../src/db.js";

test("register returns 201 and sets an httpOnly token cookie", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalQuery = pool.query;
  process.env.JWT_SECRET = "test-jwt-secret";
  pool.query = async () => ({
    rows: [{ id: 1, name: "Test User", email: "test@example.com", role: "citizen", points: 0 }],
  });

  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email: "test@example.com", password: "password123" }),
    });

    assert.equal(response.status, 201);
    assert.match(response.headers.get("set-cookie") || "", /HttpOnly/i);
    assert.deepEqual(await response.json(), {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      role: "citizen",
      points: 0,
    });
  } finally {
    pool.query = originalQuery;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("session bootstrap is nullable while protected profile requests remain unauthorized", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalQuery = pool.query;
  process.env.JWT_SECRET = "test-jwt-secret";
  pool.query = async (text) => {
    if (text.includes("SELECT id,role,department_id FROM users")) {
      return { rows: [{ id: 1, role: "citizen", department_id: null }] };
    }
    if (text.includes("SELECT id,name,email,role,points,level FROM users")) {
      return {
        rows: [{ id: 1, name: "Test User", email: "test@example.com", role: "citizen", points: 0, level: "Newcomer" }],
      };
    }
    if (text.includes("FROM user_badges")) return { rows: [] };
    throw new Error(`Unexpected auth query: ${text}`);
  };

  const app = express();
  app.use(cookieParser());
  app.use("/api/auth", auth);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

    const anonymousSession = await fetch(`${baseUrl}/session`);
    assert.equal(anonymousSession.status, 200);
    assert.deepEqual(await anonymousSession.json(), { user: null });

    const anonymousProfile = await fetch(`${baseUrl}/me`);
    assert.equal(anonymousProfile.status, 401);

    const token = jwt.sign({ id: 1, role: "citizen" }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const authenticatedSession = await fetch(`${baseUrl}/session`, {
      headers: { cookie: `token=${encodeURIComponent(token)}` },
    });
    assert.equal(authenticatedSession.status, 200);
    assert.deepEqual(await authenticatedSession.json(), {
      user: {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        role: "citizen",
        points: 0,
        level: "Newcomer",
        department_id: null,
        badges: [],
      },
    });

    const authenticatedProfile = await fetch(`${baseUrl}/me`, {
      headers: { cookie: `token=${encodeURIComponent(token)}` },
    });
    assert.equal(authenticatedProfile.status, 200);
    assert.deepEqual(await authenticatedProfile.json(), {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      role: "citizen",
      points: 0,
      level: "Newcomer",
      department_id: null,
      badges: [],
    });
  } finally {
    pool.query = originalQuery;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
