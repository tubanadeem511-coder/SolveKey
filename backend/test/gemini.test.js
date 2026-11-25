import assert from "node:assert/strict";
import { test } from "node:test";
import { AIConfigurationError, askJSON, chat, toGeminiParts } from "../src/agents/gemini.js";

async function withGeminiResponse(responseText, run) {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  let request;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: responseText }] }, finishReason: "STOP" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await run(() => request);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
}

test("converts report vision content to Gemini inline image parts", () => {
  assert.deepEqual(
    toGeminiParts([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      { type: "text", text: "Classify this civic issue." },
    ]),
    [
      { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
      { text: "Classify this civic issue." },
    ],
  );
});

test("chat rejects an unset Gemini key without making a network request", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "replace-with-test-key";
  try {
    await assert.rejects(
      chat({ system: "System prompt", messages: [{ role: "user", content: "Hello" }] }),
      AIConfigurationError,
    );
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("chat sends conversation history to the selected Gemini model", async () => {
  await withGeminiResponse("Gemini response", async (getRequest) => {
    const answer = await chat({
      system: "Keep answers concise.",
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Follow-up" },
      ],
    });
    const request = getRequest();
    assert.equal(answer, "Gemini response");
    assert.match(request.url, /models\/gemini-3\.5-flash-lite:generateContent/);
    assert.deepEqual(request.body.contents.map((entry) => entry.role), ["user", "model", "user"]);
    assert.equal(request.body.systemInstruction.parts[0].text, "Keep answers concise.");
  });
});

test("JSON agent requests send base64 image parts and require JSON output", async () => {
  await withGeminiResponse('{"category":"garbage"}', async (getRequest) => {
    const output = await askJSON({
      skill: "waste-classifier",
      instruction: 'Return {"category": string}',
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
        { type: "text", text: "Classify this civic issue." },
      ],
    });
    const request = getRequest();
    assert.deepEqual(output, { category: "garbage" });
    assert.equal(request.body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(request.body.contents[0].parts[0], {
      inlineData: { mimeType: "image/png", data: "aGVsbG8=" },
    });
  });
});
