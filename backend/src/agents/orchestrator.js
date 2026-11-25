import { q } from "../db.js";
import { askJSON } from "./gemini.js";
import { loadImageForVision } from "../storage.js";
import { createNotification } from "../notifications.js";
import { findNearbyReports, getDepartment, createTicket } from "../tools.js";
import { REPORT_CATEGORIES } from "../report-categories.js";

export class CivicIssueRejectedError extends Error {
  constructor() {
    super("This image does not appear to show a civic issue. Upload a photo of a public-area problem involving roads, footpaths, public waste, water, drainage, streetlights, or electrical infrastructure.");
    this.name = "CivicIssueRejectedError";
  }
}

async function log(reportId, agent, input, output) {
  await q(`INSERT INTO agent_logs (report_id, agent_name, input, output) VALUES ($1,$2,$3,$4)`,
    [reportId, agent, JSON.stringify(input), JSON.stringify(output)]);
}

async function askValidatedJSON({ agent, skill, instruction, content, isValid, retryHint }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let output;
    try {
      output = await askJSON({
        skill,
        instruction: attempt === 0 ? instruction : `${instruction}\nYour previous response was invalid. ${retryHint}`,
        content,
      });
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      if (attempt === 1) throw new Error(`${agent} returned invalid JSON after one retry`);
      continue;
    }

    if (isValid(output)) return output;
    if (attempt === 1) throw new Error(`${agent} returned invalid data after one retry`);
  }
  throw new Error(`${agent} returned invalid data after one retry`);
}

async function getWeather(lat, lng) {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) throw new Error(`Open-Meteo returned HTTP ${r.status}`);
    const j = await r.json();
    if (!j.current || typeof j.current !== "object") throw new Error("Open-Meteo response did not include current weather");
    return j.current;
  } catch (error) {
    console.warn("Weather context unavailable for report analysis", error);
    return { unavailable: true };
  }
}

async function classifyImage(report, suppliedImage, suppliedMediaType) {
  let image;
  let classification;
  try {
    image = suppliedImage
      ? { imageBase64: suppliedImage, mediaType: suppliedMediaType }
      : await loadImageForVision(report.image_url);
    classification = await askValidatedJSON({
      agent: "VisionAgent",
      skill: "waste-classifier",
      instruction: 'Return {"civic_relevant": boolean, "category": string or null, "description": string (max 25 words)}',
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType || "image/jpeg", data: image.imageBase64 } },
        { type: "text", text: "Determine whether this image shows a civic issue appropriate for a municipal report. Do not force an unrelated image into a civic category." },
      ],
      isValid: (value) => value && typeof value === "object" &&
        typeof value.civic_relevant === "boolean" &&
        (value.civic_relevant
          ? REPORT_CATEGORIES.includes(value.category) &&
            typeof value.description === "string" &&
            value.description.trim().length > 0 &&
            value.description.trim().split(/\s+/).length <= 25
          : true),
      retryHint: `civic_relevant must be a boolean; relevant images need category exactly one of ${REPORT_CATEGORIES.join(", ")}; unrelated images need category null; description must be at most 25 words.`,
    });
  } catch {
    throw new Error("Civic image classification is unavailable");
  }

  if (!classification.civic_relevant) throw new CivicIssueRejectedError();
  return classification;
}

export async function classifyCivicImage(imageBase64, mediaType) {
  return classifyImage(null, imageBase64, mediaType);
}

async function runPriorityAgent(report, vision) {
  const weather = await getWeather(report.lat, report.lng);
  const priority = await askValidatedJSON({
    agent: "PriorityAgent",
    skill: "urgency-rules",
    instruction: 'Return {"severity": 1-5, "reason": string}',
    content: `Category: ${vision.category}\nDescription: ${vision.description}\nWeather: ${JSON.stringify(weather)}`,
    isValid: (value) => value && typeof value === "object" &&
      Number.isInteger(value.severity) && value.severity >= 1 && value.severity <= 5,
    retryHint: "severity must be an integer from 1 through 5.",
  });
  await log(report.id, "PriorityAgent", { category: vision.category, weather }, priority);
  return priority;
}

async function runRoutingAgent(report, vision) {
  return getDepartment({ category: vision.category });
}

async function runReportWriter(report, vision, severity) {
  const location = report.address || `${report.lat}, ${report.lng}`;
  const written = await askValidatedJSON({
    agent: "ReportWriter",
    skill: "report-writer",
    instruction: 'Return {"summary": string}. Follow the skill format: one-line title, location, severity, two-sentence summary, and requested action.',
    content: `Category: ${vision.category}\nDescription: ${vision.description}\nLocation: ${location}\nSeverity: ${severity}`,
    isValid: (value) => value && typeof value === "object" &&
      typeof value.summary === "string" && value.summary.trim().length > 0 && value.summary.length <= 4000,
    retryHint: "summary must be a non-empty string of at most 4000 characters.",
  });
  await log(report.id, "ReportWriter", { category: vision.category, location, severity }, written);
  return written.summary.trim();
}

export async function analyzeStoredReport(report) {
  if (!REPORT_CATEGORIES.includes(report.category) ||
      typeof report.description !== "string" || !report.description.trim()) {
    throw new Error("Stored report is missing a valid category or description");
  }
  const vision = { category: report.category, description: report.description };
  const priority = await runPriorityAgent(report, vision);
  const dept = await runRoutingAgent(report, vision);
  await log(report.id, "RoutingAgent", { category: vision.category }, { dept });
  if (!dept) throw new Error("No department is configured for the report category");
  const summary = await runReportWriter(report, vision, priority.severity);
  return { severity: priority.severity, department_id: dept.id, summary };
}

// Orchestrator: runs Vision -> Duplicate -> Priority -> Routing -> ReportWriter
export async function runPipeline({ report, imageBase64, mediaType, io }) {
  const id = report.id;
  try {
    // 1. Vision Agent
    const storedClassification = report.classification_prevalidated === true &&
      REPORT_CATEGORIES.includes(report.category) &&
      typeof report.description === "string" && report.description.trim()
      ? { civic_relevant: true, category: report.category, description: report.description }
      : null;
    const vision = storedClassification || await classifyImage(report, imageBase64, mediaType);
    if (!storedClassification) {
      await log(id, "VisionAgent", { hasImage: true }, vision);
      await q(`UPDATE reports SET category=$2, description=$3 WHERE id=$1`, [id, vision.category, vision.description]);
    }

    // 2. Duplicate Detector (uses MCP-exposed tool logic)
    const dups = await findNearbyReports({
      lat: report.lat,
      lng: report.lng,
      category: vision.category,
      excludeReportId: id,
    });
    if (dups.length) {
      const dept = await runRoutingAgent(report, vision);
      if (!dept) throw new Error("No department is configured for the report category");
      await log(id, "RoutingAgent", { category: vision.category }, { dept, ticket: null });
      await log(id, "DuplicateAgent", { lat: report.lat, lng: report.lng }, { duplicates: dups });
      await q(
        `UPDATE reports SET duplicate_of=$2,status='duplicate',department_id=$3 WHERE id=$1`,
        [id, dups[0].id, dept.id]
      );
      await q(`UPDATE reports SET upvotes = upvotes + 1 WHERE id=$1`, [dups[0].id]);
      io?.emit("report:updated", {
        id,
        status: "duplicate",
        duplicate_of: dups[0].id,
        category: vision.category,
        department: dept.name,
      });
      if (report.user_id) {
        await createNotification({
          userId: report.user_id,
          type: "report_duplicate",
          title: "Your report was merged",
          body: `Your report was merged with nearby report #${dups[0].id}.`,
          payload: { reportId: id, duplicateOf: dups[0].id },
          io,
        });
      }
      return { duplicate: true, duplicateOf: dups[0].id };
    }
    await log(id, "DuplicateAgent", { lat: report.lat, lng: report.lng }, { duplicates: dups });

    // 3. Priority Agent
    const priority = await runPriorityAgent(report, vision);
    await q(`UPDATE reports SET severity=$2 WHERE id=$1`, [id, priority.severity]);

    // 4. Routing Agent
    const dept = await runRoutingAgent(report, vision);
    const ticket = dept ? await createTicket({ report_id: id, department_id: dept.id }) : null;
    await log(id, "RoutingAgent", { category: vision.category }, { dept, ticket });

    // 5. Report Writer
    const summary = await runReportWriter(report, vision, priority.severity);
    await q(`UPDATE reports SET summary=$2,status='reported' WHERE id=$1`, [id, summary]);

    io?.emit("report:updated", {
      id,
      status: "reported",
      category: vision.category,
      severity: priority.severity,
      department: dept?.name ?? null,
    });
    if (report.user_id) {
      await createNotification({
        userId: report.user_id,
        type: "report_analysis",
        title: "Report analysis complete",
        body: `Your report #${id} was classified and routed${dept?.name ? ` to ${dept.name}` : ""}.`,
        payload: { reportId: id, category: vision.category, severity: priority.severity },
        io,
      });
    }
    return { duplicate: false };
  } catch (err) {
    console.error("Pipeline failed", err);
    try {
      await log(id, "Orchestrator", {}, { error: String(err) });
    } catch (logError) {
      console.error("Could not persist pipeline failure trace", logError);
    }
    throw err;
  }
}
