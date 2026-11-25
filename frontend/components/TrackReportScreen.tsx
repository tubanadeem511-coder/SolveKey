"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { ApiError, api } from "../lib/api";
import type { TrackedReport } from "../lib/api";
import { reportCategoryLabel } from "../lib/report-categories";

const timeline = [
  { label: "Submitted", completedAt: 0 },
  { label: "Reviewed", completedAt: 1 },
  { label: "In Progress", completedAt: 2 },
  { label: "Resolved", completedAt: 3 },
];

function displayStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function progressFor(status: string): number {
  switch (status) {
    case "pending": return 0;
    case "reported": return 1;
    case "in_progress": return 2;
    case "resolved": return 3;
    case "duplicate": return 1;
    default: return -1;
  }
}

export function TrackReportScreen() {
  const [reportNumber, setReportNumber] = useState("");
  const [report, setReport] = useState<TrackedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    const number = new URLSearchParams(window.location.search).get("number");
    if (!number) return;

    const normalized = number.trim().toUpperCase();
    setReportNumber(normalized);
    if (!/^SK-\d{4}-(?:\d{6,}|[A-F0-9]{32})$/i.test(normalized)) return;

    let active = true;
    setLoading(true);
    api.reports.track(normalized)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) setNotFound(true);
        else setRequestError("We couldn’t retrieve this report right now. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = reportNumber.trim().toUpperCase();
    setReportNumber(normalized);
    setReport(null);
    setNotFound(false);
    setRequestError(null);
    if (!/^SK-\d{4}-(?:\d{6,}|[A-F0-9]{32})$/i.test(normalized)) {
      setNotFound(true);
      return;
    }

    setLoading(true);
    try {
      setReport(await api.reports.track(normalized));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setNotFound(true);
      } else {
        setRequestError("We couldn’t retrieve this report right now. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  const currentProgress = report ? progressFor(report.status) : -1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#0D203F] sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#087A8A] dark:text-[#66D8E3]">SolveKey public service</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#012667] dark:text-white">Track Your Report</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Enter the Report Number from your confirmation to see the latest progress from the responsible city team.
        </p>
        <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="report-number">Enter your Report Number</label>
          <input
            autoComplete="off"
            className="min-w-0 flex-1 border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm uppercase tracking-wide text-[#012667] outline-none focus:border-[#05D7E5] focus:ring-2 focus:ring-[#05D7E5]/20 dark:border-slate-700 dark:bg-[#07162F] dark:text-white"
            id="report-number"
            maxLength={43}
            onChange={(event) => setReportNumber(event.target.value)}
            placeholder="SK-2026-000123"
            value={reportNumber}
          />
          <button
            className="min-h-12 rounded-xl bg-[#012667] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#0241A3] disabled:cursor-wait disabled:opacity-60 dark:bg-[#05D7E5] dark:text-[#07162F]"
            disabled={loading || !reportNumber.trim()}
            type="submit"
          >
            {loading ? "Looking up report…" : "Track Report"}
          </button>
        </form>
        {notFound && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30" role="alert">
            <p className="font-semibold text-red-800 dark:text-red-200">Report Not Found</p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              We couldn’t find a report with this Report Number. Please check the number and try again.
            </p>
          </div>
        )}
        {requestError && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
            {requestError}
          </p>
        )}
      </header>

      {report && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#0D203F] sm:p-9" aria-live="polite">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Report Number</p>
              <h2 className="mt-1 break-all font-mono text-lg font-bold tracking-wide text-[#012667] dark:text-white">{report.report_number}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{report.issue}</p>
            </div>
            <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-bold text-[#075B67] dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">
              {displayStatus(report.status)}
            </span>
          </div>

          <dl className="grid gap-x-8 gap-y-5 py-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</dt>
              <dd className="mt-1 text-sm font-semibold text-[#012667] dark:text-white">{reportCategoryLabel(report.category)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</dt>
              <dd className="mt-1 text-sm font-semibold text-[#012667] dark:text-white">{report.location}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</dt>
              <dd className="mt-1 text-sm font-semibold text-[#012667] dark:text-white">{formatDate(report.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</dt>
              <dd className="mt-1 text-sm font-semibold text-[#012667] dark:text-white">{formatDate(report.updated_at)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned department</dt>
              <dd className="mt-1 text-sm font-semibold text-[#012667] dark:text-white">{report.department_name || "Awaiting assignment"}</dd>
            </div>
            {report.description && report.description !== report.issue && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issue details</dt>
                <dd className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">{report.description}</dd>
              </div>
            )}
          </dl>

          <div className="border-t border-slate-100 pt-6 dark:border-slate-800">
            <h3 className="text-sm font-bold text-[#012667] dark:text-white">Status timeline</h3>
            <ol className="mt-5 grid gap-4 sm:grid-cols-4">
              {timeline.map((step, index) => {
                const complete = currentProgress >= 0 && step.completedAt < currentProgress;
                const current = step.completedAt === currentProgress;
                return (
                  <li className="flex items-center gap-3 sm:flex-col sm:items-start" key={step.label}>
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-bold ${
                      complete
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : current
                          ? "border-[#05A7B4] bg-[#E7F9FB] text-[#075B67] dark:border-[#05D7E5] dark:bg-[#103553] dark:text-[#8DEBF2]"
                          : "border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-[#07162F]"
                    }`}>
                      {complete ? "✓" : current ? "●" : "○"}
                    </span>
                    <span className={`text-sm ${complete || current ? "font-semibold text-[#012667] dark:text-white" : "text-slate-400"}`}>
                      {step.label}
                    </span>
                    {index < timeline.length - 1 && <span className="sr-only">then</span>}
                  </li>
                );
              })}
            </ol>
            {report.status === "duplicate" && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                This report was identified as a duplicate and linked to the existing civic issue.
              </p>
            )}
          </div>
          <p className="mt-6 text-xs leading-5 text-slate-500 dark:text-slate-400">
            This public view contains complaint tracking details only. Personal account information is not shown.
          </p>
        </section>
      )}

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Need to report another issue? <Link className="font-semibold text-[#075B67] underline dark:text-[#66D8E3]" href="/report">Submit a report</Link>
      </p>
    </div>
  );
}
