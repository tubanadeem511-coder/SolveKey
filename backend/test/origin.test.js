import assert from "node:assert/strict";
import test from "node:test";
import { createOriginGuard } from "../src/origin.js";

function invoke(guard, method, origin) {
  let nextCalled = false;
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const request = { method, get: () => origin };
  guard(request, response, () => { nextCalled = true; });
  return { nextCalled, response };
}

test("allows a mutation from the configured frontend origin", () => {
  const guard = createOriginGuard("https://SolveKey.example");
  const result = invoke(guard, "POST", "https://SolveKey.example");
  assert.equal(result.nextCalled, true);
  assert.equal(result.response.statusCode, null);
});

test("rejects a mutation from another origin", () => {
  const guard = createOriginGuard("https://SolveKey.example");
  const result = invoke(guard, "POST", "https://attacker.example");
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.statusCode, 403);
  assert.deepEqual(result.response.body, { error: "Untrusted origin" });
});

test("allows originless non-browser API clients", () => {
  const guard = createOriginGuard("https://SolveKey.example");
  const result = invoke(guard, "PATCH", undefined);
  assert.equal(result.nextCalled, true);
  assert.equal(result.response.statusCode, null);
});

test("does not apply the origin check to read-only requests", () => {
  const guard = createOriginGuard("https://SolveKey.example");
  const result = invoke(guard, "GET", "https://attacker.example");
  assert.equal(result.nextCalled, true);
  assert.equal(result.response.statusCode, null);
});
