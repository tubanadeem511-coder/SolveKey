import assert from "node:assert/strict";
import test from "node:test";
import { assertJwtSecret } from "../src/startup.js";

test("startup guard throws when JWT_SECRET is missing", () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(assertJwtSecret, /JWT_SECRET is required in every environment/);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
