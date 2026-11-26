import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(
  process.env.SKILLS_DIR || path.join(MODULE_DIR, "../../skills")
);
let client;

export class AIConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.includes("replace-with-")) {
    throw new AIConfigurationError("AI analysis is not configured. Set GEMINI_API_KEY in the backend environment to enable it.");
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) throw new TypeError("Gemini content must be a string or content-block array");

  return content.map((block) => {
    if (block?.type === "text" && typeof block.text === "string") {
      return { text: block.text };
    }
    if (block?.type === "image" && block.source?.type === "base64" &&
        typeof block.source.media_type === "string" && typeof block.source.data === "string") {
      return {
        inlineData: {
          mimeType: block.source.media_type,
          data: block.source.data,
        },
      };
    }
    throw new TypeError("Unsupported Gemini content block");
  });
}

export function loadSkill(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid Skill name");
  const skillPath = path.join(SKILLS_DIR, name, "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf8");
  if (!skill.trim()) throw new Error(`Skill ${name} is empty`);
  return skill;
}

export async function askJSON({ skill, instruction, content }) {
  const system = `${loadSkill(skill)}\n\n${instruction}\nRespond ONLY with valid JSON, no markdown.`;
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: toGeminiParts(content) }],
    config: {
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
      systemInstruction: system,
    },
  });
  const out = res.text;
  if (typeof out !== "string" || !out.trim()) throw new Error("Gemini returned no JSON content");
  return JSON.parse(out.replace(/```json|```/g, "").trim());
}

export async function chat({ system, messages }) {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: messages.map(({ role, content }) => ({
      role: role === "assistant" ? "model" : "user",
      parts: toGeminiParts(content),
    })),
    config: {
      maxOutputTokens: 800,
      systemInstruction: system,
    },
  });
  if (typeof res.text !== "string" || !res.text.trim()) throw new Error("Gemini returned no text content");
  return res.text;
}
