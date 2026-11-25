"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import { AccessGate } from "./AccessGate";
import { api } from "../lib/api";
import type { AgentLog, SubmittedReport } from "../lib/api";
import { reportCategoryLabel } from "../lib/report-categories";
import type { ReportUpdatedEvent } from "../lib/socket";
import { socket } from "../lib/socket";
import { useAuth } from "./AuthProvider";

const MAX_IMAGE_BYTES = 1_500_000;
const ANALYSIS_TIMEOUT_MS = 180_000;
const MAX_ANALYSIS_ATTEMPTS = 3;
const ANALYSIS_STEPS = [
  { agent: "VisionAgent", label: "Classifying your photo" },
  { agent: "DuplicateAgent", label: "Checking for nearby reports" },
  { agent: "PriorityAgent", label: "Assessing urgency" },
  { agent: "RoutingAgent", label: "Finding the right department" },
  { agent: "ReportWriter", label: "Preparing your complaint summary" },
];

interface CompressedPhoto {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
}

type SubmissionState =
  | { kind: "idle" }
  | { kind: "analysing"; report: SubmittedReport; startedAt: number }
  | { kind: "complete"; report: SubmittedReport; category: string; severity: number; department: string | null }
  | { kind: "duplicate"; report: SubmittedReport; duplicateOf: number | null; category: string | null; department: string | null }
  | { kind: "failed"; report: SubmittedReport; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentOutput(logs: AgentLog[], name: string): Record<string, unknown> | null {
  const log = logs.find((entry) => entry.agent_name === name);
  return log ? isRecord(log.output) ? log.output : null : null;
}

function duplicateReportId(logs: AgentLog[]): number | null {
  const duplicates = agentOutput(logs, "DuplicateAgent")?.duplicates;
  if (!Array.isArray(duplicates) || !isRecord(duplicates[0])) return null;
  return typeof duplicates[0].id === "number" ? duplicates[0].id : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function isTemporaryProviderUnavailable(error: string): boolean {
  return /\b503\b/.test(error) && /\bUNAVAILABLE\b/i.test(error);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be opened. Try a JPEG, PNG, or WebP photo."));
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Your browser could not compress this image."));
    }, "image/jpeg", quality);
  });
}

async function compressImage(file: File): Promise<Blob> {
  const image = await loadImage(file);
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const maxDimension = 1920;
  const initialScale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is not available in this browser.");

  const qualities = [0.86, 0.74, 0.62, 0.5, 0.38, 0.28];
  for (let resizeAttempt = 0; resizeAttempt < 7; resizeAttempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const compressed = await canvasToJpeg(canvas, quality);
      if (compressed.size < MAX_IMAGE_BYTES) return compressed;
    }

    width = Math.max(1, Math.floor(width * 0.75));
    height = Math.max(1, Math.floor(height * 0.75));
  }

  throw new Error("This photo could not be compressed below 1.5 MB. Please choose another image.");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The compressed photo could not be prepared for upload."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The compressed photo could not be prepared for upload."));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("The compressed photo had an invalid format."));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function displayCategory(category: string): string {
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ReportTrackingActions({
  reportNumber,
  status,
  category,
  department,
}: {
  reportNumber: string;
  status: string;
  category?: string | null;
  department?: string | null;
}) {
  const [copyMessage, setCopyMessage] = useState("");

  async function copyReportNumber() {
    try {
      await navigator.clipboard.writeText(reportNumber);
      setCopyMessage("Report number copied.");
    } catch {
      setCopyMessage("Could not copy the report number. Please select and copy it.");
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-cyan-100 bg-[#F3FBFC] p-4 dark:border-slate-700 dark:bg-[#07162F]">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Report Number</p>
      <p className="mt-1 break-all font-mono text-lg font-bold tracking-wide text-[#012667] dark:text-white">
        {reportNumber}
      </p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Status: <span className="font-semibold text-[#012667] dark:text-white">{displayCategory(status)}</span>
      </p>
      {category !== undefined && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Category: <span className="font-semibold text-[#012667] dark:text-white">{reportCategoryLabel(category)}</span>
        </p>
      )}
      {category !== undefined && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Assigned department: <span className="font-semibold text-[#012667] dark:text-white">{department || "Awaiting assignment"}</span>
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-xl border border-[#012667]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[#012667] hover:bg-slate-50 dark:border-slate-600 dark:bg-[#0D203F] dark:text-white dark:hover:bg-[#103553]"
          onClick={() => void copyReportNumber()}
          type="button"
        >
          Copy Report Number
        </button>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#012667] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0241A3] dark:bg-[#05D7E5] dark:text-[#07162F]"
          href={`/track-report?number=${encodeURIComponent(reportNumber)}`}
        >
          Track Report
        </Link>
      </div>
      {copyMessage && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300" role="status">{copyMessage}</p>}
    </div>
  );
}

export function ReportIssueForm() {
  const { user, loading: authLoading } = useAuth();
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [result, setResult] = useState<SubmissionState>({ kind: "idle" });

  const activeReportId = result.kind === "analysing" ? result.report.id : null;
  const analysisStartedAt = result.kind === "analysing" ? result.startedAt : null;

  useEffect(() => {
    if (photo) return () => URL.revokeObjectURL(photo.previewUrl);
  }, [photo]);

  useEffect(() => {
    if (activeReportId === null || analysisStartedAt === null) return;

    const startedAt = analysisStartedAt;
    let active = true;
    let latestSocketUpdate: ReportUpdatedEvent | null = null;
    const reportId = activeReportId;

    function finishDuplicate(
      duplicateOf: number | null,
      department: string | null,
      category?: string,
    ) {
      if (!active) return;
      setResult((current) =>
        current.kind === "analysing" && current.report.id === reportId
          ? {
              kind: "duplicate",
              report: current.report,
              duplicateOf,
              category: category ?? current.report.category,
              department,
            }
          : current,
      );
    }

    function finishFailure(message: string) {
      if (!active) return;
      setResult((current) =>
        current.kind === "analysing" && current.report.id === reportId
          ? { kind: "failed", report: current.report, message }
          : current,
      );
    }

    async function inspectTrace() {
      if (!active) return;
      try {
        const logs = await api.reports.trace(reportId);
        if (!active) return;
        const done = ANALYSIS_STEPS
          .filter((step) => logs.some((entry) => entry.agent_name === step.agent))
          .map((step) => step.agent);
        setCompletedSteps(done);
        setPipelineMessage(null);

        const duplicateOf = duplicateReportId(logs);
        const analysisComplete = logs.some((entry) => entry.agent_name === "ReportWriter");
        const orchestratorErrors = logs
          .filter((entry) => entry.agent_name === "Orchestrator")
          .map((entry) => isRecord(entry.output) ? entry.output.error : null)
          .filter((error): error is string => typeof error === "string");

        if (duplicateOf === null && !analysisComplete && orchestratorErrors.length > 0) {
          const unavailableErrors = orchestratorErrors.filter(isTemporaryProviderUnavailable);
          if (unavailableErrors.length > 0) {
            if (unavailableErrors.length >= MAX_ANALYSIS_ATTEMPTS) {
              const lastError = unavailableErrors[unavailableErrors.length - 1];
              console.error("SolveKey report analysis remained unavailable after automatic retries", lastError);
              finishFailure(
                "AI analysis is temporarily unavailable after automatic retries. Your report was saved and remains trackable with the Report Number above. Please check back later.",
              );
            } else {
              setPipelineMessage(
                "AI analysis is temporarily unavailable. Your report is saved, and automatic retries are in progress. You can track it using the Report Number below.",
              );
            }
            return;
          }

          const failure = orchestratorErrors[0];
          finishFailure("Your report was saved, but AI analysis could not finish. You can try again later.");
          console.error("SolveKey report analysis failed", failure);
          return;
        }

        if (duplicateOf !== null) {
          const departmentValue = agentOutput(logs, "RoutingAgent")?.dept;
          const department = isRecord(departmentValue) && typeof departmentValue.name === "string"
            ? departmentValue.name
            : null;
          const categoryValue = agentOutput(logs, "VisionAgent")?.category;
          finishDuplicate(duplicateOf, department, typeof categoryValue === "string" ? categoryValue : undefined);
          return;
        }

        if (analysisComplete) {
          const categoryValue = agentOutput(logs, "VisionAgent")?.category ?? latestSocketUpdate?.category;
          const severityValue = agentOutput(logs, "PriorityAgent")?.severity ?? latestSocketUpdate?.severity;
          const departmentValue = agentOutput(logs, "RoutingAgent")?.dept;
          const department = isRecord(departmentValue) && typeof departmentValue.name === "string"
            ? departmentValue.name
            : null;

          if (typeof categoryValue === "string" && typeof severityValue === "number") {
            setResult((current) =>
              current.kind === "analysing" && current.report.id === reportId
                ? {
                    kind: "complete",
                    report: current.report,
                    category: categoryValue,
                    severity: severityValue,
                    department,
                  }
                : current,
            );
          }
        }
      } catch (error) {
        if (active) setPipelineMessage(`Still waiting for the analysis update: ${errorMessage(error)}`);
      }
    }

    function onReportUpdated(event: ReportUpdatedEvent) {
      if (event.id !== reportId) return;
      latestSocketUpdate = event;
      if (event.status === "duplicate") {
        finishDuplicate(
          typeof event.duplicate_of === "number" ? event.duplicate_of : null,
          event.department ?? null,
          event.category,
        );
      } else {
        void inspectTrace();
      }
    }

    socket.on("report:updated", onReportUpdated);
    if (!socket.connected) socket.connect();

    async function monitorAnalysis() {
      while (active) {
        if (Date.now() - startedAt > ANALYSIS_TIMEOUT_MS) {
          finishFailure("Your report was saved, but analysis is taking longer than expected. Please check back later.");
          return;
        }
        await inspectTrace();
        if (!active) return;
        await new Promise((resolve) => window.setTimeout(resolve, 1800));
      }
    }

    void monitorAnalysis();
    return () => {
      active = false;
      socket.off("report:updated", onReportUpdated);
    };
  }, [activeReportId, analysisStartedAt]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setSubmitError(null);
    setPhoto(null);
    setCompressing(true);
    try {
      const blob = await compressImage(file);
      setPhoto({ blob, previewUrl: URL.createObjectURL(blob), originalSize: file.size });
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setCompressing(false);
    }
  }

  function getCurrentLocation() {
    setLocationError(null);
    setLocationMessage(null);
    if (!navigator.geolocation) {
      setLocationError("Location is not supported by this browser. Enter coordinates manually below.");
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLatitude(coords.latitude.toFixed(6));
        setLongitude(coords.longitude.toFixed(6));
        setLocationMessage("Your current location is ready. You can adjust the pin coordinates below.");
        setGettingLocation(false);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. Enter coordinates manually to place your pin."
          : error.code === error.TIMEOUT
            ? "Location lookup timed out. Try again or enter coordinates manually."
            : "Your location could not be determined. Enter coordinates manually to place your pin.";
        setLocationError(message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setPipelineMessage(null);

    if (!photo) {
      setSubmitError("Add a photo of the issue before submitting.");
      return;
    }
    if (!latitude.trim() || !longitude.trim()) {
      setSubmitError("Get your location or enter latitude and longitude to place the report pin.");
      return;
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setSubmitError("Enter valid coordinates: latitude from -90 to 90 and longitude from -180 to 180.");
      return;
    }

    setSubmitting(true);
    try {
      const imageBase64 = await blobToBase64(photo.blob);
      const report = await api.reports.create({
        lat,
        lng,
        image_base64: imageBase64,
        media_type: "image/jpeg",
      });
      setCompletedSteps([]);
      setResult({ kind: "analysing", report, startedAt: Date.now() });
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setResult({ kind: "idle" });
    setPhoto(null);
    setLatitude("");
    setLongitude("");
    setLocationMessage(null);
    setLocationError(null);
    setCompletedSteps([]);
    setPipelineMessage(null);
    setSubmitError(null);
  }

  if (authLoading) {
    return (
      <section className="dashboard-card p-8 text-center" aria-live="polite">
        <p className="font-semibold text-[#012667] dark:text-[#05D7E5]">Checking your SolveKey session...</p>
      </section>
    );
  }

  if (!user) {
    return (
      <AccessGate
        eyebrow="Issue intake"
        title="Sign in to report an issue"
        description="Your SolveKey account connects your report to a city team and lets you follow its progress through resolution."
        actionLabel="Sign in"
        secondaryHref="/register"
        secondaryLabel="Create an account"
      />
    );
  }

  if (result.kind === "analysing") {
    return (
      <section className="rounded-3xl border border-emerald-950/5 bg-white p-6 shadow-soft sm:p-9" aria-live="polite">
        <div className="flex items-start gap-4">
          <span className="mt-1 grid size-11 shrink-0 place-items-center rounded-2xl bg-mint text-forest">
            <span className="size-3 animate-pulse rounded-full bg-leaf" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-leaf">Report submitted successfully</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">AI is analysing your report</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Keep this page open while we classify the issue and route it to the right team.</p>
          </div>
        </div>
        <ReportTrackingActions
          reportNumber={result.report.report_number}
          status={result.report.status}
          category={result.report.category}
          department={result.report.department_name}
        />

        <ol className="mt-8 space-y-3">
          {ANALYSIS_STEPS.map((step, index) => {
            const done = completedSteps.includes(step.agent);
            const current = !done && completedSteps.length === index;
            return (
              <li key={step.agent} className="flex items-center gap-3">
                <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  done ? "bg-mint text-forest" : current ? "bg-forest text-white" : "bg-slate-100 text-slate-400"
                }`}>
                  {done ? "✓" : index + 1}
                </span>
                <span className={`text-sm ${done || current ? "font-medium text-ink" : "text-slate-400"}`}>{step.label}</span>
                {current && <span className="ml-auto text-xs text-leaf">In progress</span>}
              </li>
            );
          })}
        </ol>
        {pipelineMessage && <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">{pipelineMessage}</p>}
      </section>
    );
  }

  if (result.kind === "complete") {
    return (
      <section className="rounded-3xl border border-emerald-950/5 bg-white p-6 shadow-soft sm:p-9" aria-live="polite">
        <span className="inline-flex items-center gap-2 rounded-full bg-mint px-3 py-1.5 text-sm font-semibold text-forest">
          <span aria-hidden="true">✓</span> Analysis complete
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink">Report submitted successfully</h1>
        <p className="mt-2 text-sm text-slate-600">Your report has been analysed and routed. Use your Report Number to follow its progress.</p>
        <ReportTrackingActions reportNumber={result.report.report_number} status={result.report.status} />
        <dl className="mt-7 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-mint/70 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-forest/70">Category</dt>
            <dd className="mt-1 font-semibold text-ink">{reportCategoryLabel(result.category)}</dd>
          </div>
          <div className="rounded-2xl bg-lagoon p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-forest/70">Severity</dt>
            <dd className="mt-1 font-semibold text-ink">{result.severity} <span className="text-sm font-normal text-slate-600">/ 5</span></dd>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Department</dt>
            <dd className="mt-1 font-semibold text-ink">{result.department || "Awaiting department assignment"}</dd>
          </div>
        </dl>
        <button className="mt-7 rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-leaf" onClick={resetForm} type="button">
          Report another issue
        </button>
      </section>
    );
  }

  if (result.kind === "duplicate") {
    return (
      <section className="rounded-3xl border border-amber-900/10 bg-white p-6 shadow-soft sm:p-9" aria-live="polite">
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900">
          <span aria-hidden="true">↗</span> Duplicate report
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink">Your report was merged</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          We found an existing report for this issue nearby and merged yours with it so the responsible team can track the reports together.
        </p>
        {result.duplicateOf !== null && (
          <p className="mt-4 rounded-xl bg-amber-50/70 px-4 py-3 text-sm font-medium text-amber-950">
            Existing report #{result.duplicateOf}
          </p>
        )}
        <ReportTrackingActions
          reportNumber={result.report.report_number}
          status={result.report.status}
          category={result.report.category}
          department={result.report.department_name}
        />
        <button className="mt-7 rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-leaf" onClick={resetForm} type="button">
          Report another issue
        </button>
      </section>
    );
  }

  if (result.kind === "failed") {
    return (
      <section className="rounded-3xl border border-red-900/10 bg-white p-6 shadow-soft sm:p-9" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-700">Analysis interrupted</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Your report was saved</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{result.message}</p>
        <ReportTrackingActions
          reportNumber={result.report.report_number}
          status={result.report.status}
          category={result.report.category}
          department={result.report.department_name}
        />
        <button className="mt-7 rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-leaf" onClick={resetForm} type="button">
          Return to report form
        </button>
      </section>
    );
  }

  return (
    <div className="report-workspace">
    <section className="report-intake overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_12px_36px_-28px_rgba(9,37,83,0.35)] dark:border-slate-800 dark:bg-[#0D203F]">
      <div className="border-b border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#087A8A] dark:text-[#66D8E3]">Civic problem intake</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#092553] dark:text-white sm:text-3xl">Report an issue</h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">Add a clear photo and location. SolveKey will classify, assess, and route it to the right team.</p>
          </div>
          <ol className="report-stepper" aria-label="Reporting steps">
            {["Issue photo", "Location", "AI review"].map((step, index) => (
              <li key={step} className="min-w-[72px] rounded-lg border border-slate-200 px-2.5 py-2 text-center text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-300">
                <span className="mr-1 text-[#0F9B73]">{index + 1}</span>{step}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <form className="report-step-grid space-y-0 px-5 sm:px-8" onSubmit={handleSubmit}>
        <fieldset className="report-photo-step border-b border-slate-100 py-7 dark:border-slate-800">
          <legend className="text-sm font-bold text-[#092553] dark:text-white">1. Show us the issue</legend>
          <p className="mt-1 text-sm text-slate-500">Your photo is compressed on this device to under 1.5 MB before upload.</p>
          <input
            ref={cameraInput}
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePhotoChange}
            type="file"
          />
          <input
            ref={uploadInput}
            accept="image/*"
            className="sr-only"
            onChange={handlePhotoChange}
            type="file"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white transition hover:bg-leaf disabled:opacity-60"
              disabled={compressing || submitting}
              onClick={() => cameraInput.current?.click()}
              type="button"
            >
              {compressing ? "Preparing photo..." : "Take a photo"}
            </button>
            <button
              className="rounded-xl border border-emerald-900/15 px-4 py-3 text-sm font-semibold text-forest transition hover:bg-mint disabled:opacity-60"
              disabled={compressing || submitting}
              onClick={() => uploadInput.current?.click()}
              type="button"
            >
              Choose from device
            </button>
          </div>
          {photo && (
            <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center">
              <img alt="Preview of the compressed issue photo" className="h-36 w-full rounded-xl object-cover sm:w-44" src={photo.previewUrl} />
              <div className="text-sm">
                <p className="font-semibold text-ink">Photo ready</p>
                <p className="mt-1 text-slate-500">Original: {formatSize(photo.originalSize)}</p>
                <p className="mt-1 font-medium text-forest">Compressed: {formatSize(photo.blob.size)}</p>
              </div>
              <button
                aria-label="Remove selected photo"
                className="self-start rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white sm:ml-auto"
                onClick={() => setPhoto(null)}
                type="button"
              >
                Remove
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="report-location-step border-b border-slate-100 py-7 dark:border-slate-800">
          <legend className="text-sm font-bold text-[#092553] dark:text-white">2. Confirm the location</legend>
          <p className="mt-1 text-sm text-slate-500">Use GPS or enter the coordinates manually if location access is unavailable.</p>
          <button
            className="mt-4 rounded-xl border border-emerald-900/15 px-4 py-3 text-sm font-semibold text-forest transition hover:bg-mint disabled:opacity-60"
            disabled={gettingLocation || submitting}
            onClick={getCurrentLocation}
            type="button"
          >
            {gettingLocation ? "Getting your location..." : "Use my current location"}
          </button>
          {locationMessage && <p className="mt-3 text-sm text-forest" role="status">{locationMessage}</p>}
          {locationError && <p className="mt-3 text-sm text-amber-800" role="status">{locationError}</p>}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-ink">
              Latitude
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-leaf focus:ring-4 focus:ring-leaf/10"
                inputMode="decimal"
                max="90"
                min="-90"
                onChange={(event) => {
                  setLatitude(event.target.value);
                  setLocationError(null);
                  setLocationMessage("Manual pin coordinates entered.");
                }}
                placeholder="e.g. 24.8607"
                step="any"
                type="number"
                value={latitude}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Longitude
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-leaf focus:ring-4 focus:ring-leaf/10"
                inputMode="decimal"
                max="180"
                min="-180"
                onChange={(event) => {
                  setLongitude(event.target.value);
                  setLocationError(null);
                  setLocationMessage("Manual pin coordinates entered.");
                }}
                placeholder="e.g. 67.0011"
                step="any"
                type="number"
                value={longitude}
              />
            </label>
          </div>
        </fieldset>

        {submitError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{submitError}</p>}
        <div className="flex items-center justify-between gap-4 py-7">
          <p className="hidden max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400 sm:block">
            By submitting, you authorize SolveKey to share this report with the responsible city department.
          </p>
          <button
            className="w-full rounded-[10px] bg-[#092553] px-5 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_-14px_rgba(9,37,83,.8)] transition hover:bg-[#173A70] focus:outline-none focus:ring-4 focus:ring-[#05D7E5]/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-52"
            disabled={submitting || compressing || gettingLocation || !photo || !latitude || !longitude}
            type="submit"
          >
            {submitting ? "Submitting report..." : "Submit report"}
          </button>
        </div>
      </form>
    </section>
    <aside className="report-ai-panel">
      <div className="ops-panel-heading">
        <div><h2>AI analysis pipeline</h2><p>What happens after you submit</p></div>
        <span className="ops-ai-chip"><span className="app-live-dot" /> Ready</span>
      </div>
      <ol className="report-ai-steps">
        {ANALYSIS_STEPS.map((step, index) => (
          <li key={step.agent}>
            <span className="report-ai-node">{index + 1}</span>
            <span><strong>{step.label}</strong><small>{step.agent.replace("Agent", " agent")}</small></span>
          </li>
        ))}
      </ol>
      <p className="report-ai-note">Your photo and location help city teams classify, prioritize, and route the issue to the right department.</p>
    </aside>
    </div>
  );
}
