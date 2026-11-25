import assert from "node:assert/strict";
import test from "node:test";
import { validateReportImage } from "../src/storage.js";

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lD8AAAAASUVORK5CYII=";

test("accepts a correctly typed PNG image", () => {
  assert.doesNotThrow(() => validateReportImage(onePixelPng, "image/png"));
});

test("rejects malformed base64 and mismatched image signatures", () => {
  assert.throws(() => validateReportImage("not base64", "image/png"), /base64/);
  assert.throws(() => validateReportImage(onePixelPng, "image/jpeg"), /does not match/);
});

test("rejects images larger than the server upload limit", () => {
  const oversized = Buffer.alloc(1_500_001, 0).toString("base64");
  assert.throws(() => validateReportImage(oversized, "image/png"), /1.5 MB/);
});
