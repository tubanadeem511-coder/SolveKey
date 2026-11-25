"use client";

import Link from "next/link";
import { AccessGate } from "./AccessGate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, api } from "../lib/api";
import type { DashboardStats, Report, ReportStatus } from "../lib/api";
import { socket } from "../lib/socket";
import { reportCategoryLabel } from "../lib/report-categories";
import { useAuth } from "./AuthProvider";
import { RewardAdminPanel } from "./RewardAdminPanel";
import { StaffAdminPanel } from "./StaffAdminPanel";
import { UiIcon } from "./UiIcon";

function statusLabel(status: string): string {
  if (status === "pending" || status === "reported") return "Open";
  return status.replaceAll("_", " ");
}

function statusClass(status: string): string {
  if (status === "resolved") return "status-resolved";
  if (status === "in_progress") return "status-progress";
  return "status-open";
}

function severityColor(severity: number | null): string {
  if (severity !== null && severity >= 4) return "#DC4C4C";
  if (severity !== null && severity === 3) return "#E6A23C";
  return "#04A077";
}

export function DashboardScreen() {
  const { user, loading: authLoading } = useAuth();
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [queueStatus, setQueueStatus] = useState<"all" | "critical" | "reported" | "in_progress" | "resolved">("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const departmentId = departmentFilter === "all" ? undefined : Number(departmentFilter);
  const canView = !!user && ["department", "admin"].includes(user.role);

  const loadDashboard = useCallback(async () => {
    if (!hasLoaded.current) setInitialLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [nextStats, nextReports] = await Promise.all([
        api.stats.get(departmentId),
        api.reports.list({ departmentId }),
      ]);
      setStats(nextStats);
      setReports(nextReports);
      hasLoaded.current = true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the department dashboard.");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [departmentId]);

  useEffect(() => {
    if (canView) void loadDashboard();
  }, [canView, loadDashboard]);

  useEffect(() => {
    if (!canView) return;
    const refresh = () => void loadDashboard();
    socket.on("report:new", refresh);
    socket.on("report:updated", refresh);
    return () => {
      socket.off("report:new", refresh);
      socket.off("report:updated", refresh);
    };
  }, [canView, loadDashboard]);

  const sortedReports = useMemo(
    () =>
      [...reports].sort((a, b) => {
        if (a.severity === null && b.severity !== null) return 1;
        if (a.severity !== null && b.severity === null) return -1;
        if (a.severity !== null && b.severity !== null && a.severity !== b.severity) {
          return sortDirection === "desc" ? b.severity - a.severity : a.severity - b.severity;
        }
        return a.id - b.id;
      }).filter((report) => {
        const statusMatch = queueStatus === "all"
          || (queueStatus === "critical" && report.status !== "resolved" && (report.severity ?? 0) >= 4)
          || (queueStatus === "reported" && (report.status === "reported" || report.status === "pending"))
          || report.status === queueStatus;
        const needle = queueSearch.trim().toLowerCase();
        const searchMatch = !needle || [report.category, report.description, report.address, report.department_name]
          .some((value) => value?.toLowerCase().includes(needle));
        return statusMatch && searchMatch;
      }),
    [reports, sortDirection, queueStatus, queueSearch],
  );

  const updateStatus = async (report: Report, status: ReportStatus) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.reports.updateStatus(report.id, status);
      setReports((current) =>
        current.map((item) => (item.id === report.id ? { ...item, status } : item)),
      );
      await loadDashboard();
    } catch (reason) {
      setActionError(
        reason instanceof ApiError ? reason.message : "Could not update this report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div aria-label="Checking access" className="mx-auto max-w-7xl space-y-4" role="status">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-24 w-full" />
        <span className="sr-only">Checking access…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <AccessGate
        eyebrow="Operations center"
        title="Sign in to access city operations"
        description="The SolveKey operations center is reserved for municipal staff and verified administrators."
        actionLabel="Sign in to SolveKey"
      />
    );
  }

  if (!canView) {
    return (
      <section className="dashboard-card mx-auto max-w-xl p-8 text-center sm:p-12">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-50 text-[#E6A23C] dark:bg-amber-950/40">
          <UiIcon name="shield" className="size-5" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-[#012667] dark:text-white">Access Restricted</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Your account is registered as a Citizen. Department operations are accessible only to agency staff and administrators.
        </p>
        <Link
          href="/map"
          className="mt-6 inline-flex rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-[#012667] transition hover:bg-[#E7F9FB] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
        >
          Return to Civic Map
        </Link>
      </section>
    );
  }

  const maxCategoryCount = Math.max(1, ...(stats?.by_category.map((item) => item.count) ?? []));
  const criticalCount = reports.filter((report) => report.status !== "resolved" && (report.severity ?? 0) >= 4).length;
  const inProgressCount = reports.filter((report) => report.status === "in_progress").length;
  const operationsStages = [
    ["Vision Agent", "Image classification"],
    ["Duplicate Agent", "Nearby report matching"],
    ["Priority Agent", "Severity assessment"],
    ["Routing Agent", "Department selection"],
    ["Report Writer", "Citizen-ready summary"],
  ];
  const queueFilters: { value: typeof queueStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "critical", label: "Critical" },
    { value: "reported", label: "Pending" },
    { value: "in_progress", label: "In progress" },
    { value: "resolved", label: "Resolved" },
  ];

  return (
    <div className="ops-workspace min-w-0 space-y-5">
      <div className="ops-header">
        <div>
          <p className="ops-eyebrow"><span className="app-live-dot" /> SOLVEKEY OPERATIONS</p>
          <h1>Good morning, {user.name.split(" ")[0]}</h1>
          <p>Current civic activity across your service area.</p>
        </div>
        <label className="ops-department-filter">
          <span>Department</span>
          <select
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
          >
            <option value="all">All Departments</option>
            {(stats?.departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-sm text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-sm text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {actionError}
        </div>
      )}

      <section aria-label="Report statistics" className="ops-stat-grid">
        {initialLoading && !stats ? (
          Array.from({ length: 4 }, (_, index) => (
            <article aria-hidden="true" className="ops-stat-card space-y-3" key={index}>
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-7 w-16" />
            </article>
          ))
        ) : (
          [
            {
              label: "Total reports",
              value: reports.length,
              detail: "In selected department",
              tone: "navy",
            },
            {
              label: "Critical",
              value: criticalCount,
              detail: "Active · severity 4–5",
              tone: "red",
            },
            {
              label: "In progress",
              value: inProgressCount,
              detail: `${stats?.open ?? "—"} open reports`,
              tone: "cyan",
            },
            {
              label: "Resolved",
              value: stats?.resolved ?? "—",
              detail: `Avg. severity ${stats ? stats.average_severity.toFixed(1) : "—"} / 5`,
              tone: "green",
            },
          ].map((card) => (
            <article key={card.label} className="ops-stat-card">
              <div className="ops-stat-heading"><span className={`ops-stat-dot ${card.tone}`} /><span>{card.label}</span></div>
              <strong className={`ops-stat-value ${card.tone}`}>{card.value}</strong>
              <span className="ops-stat-detail">{card.detail}</span>
              <span className={`ops-stat-track ${card.tone}`}><i style={{ width: `${reports.length ? Math.min(100, (Number(card.value) / reports.length) * 100) : 0}%` }} /></span>
            </article>
          ))
        )}
      </section>

      <div className="ops-insight-grid">
        <section className="ops-panel min-w-0">
          <div className="ops-panel-heading">
            <div><h2>Issue activity</h2><p>Current mix by category</p></div>
            {refreshing && <span className="ops-sync" role="status">Syncing live data…</span>}
          </div>

          {initialLoading && !stats ? (
            <div aria-label="Loading category totals" className="mt-4 space-y-3" role="status">
              {[0, 1, 2, 3].map((item) => <div className="skeleton h-4 w-full" key={item} />)}
            </div>
          ) : stats?.by_category.length ? (
            <div className="ops-category-list" role="list" aria-label="Report counts by category">
              {stats.by_category.slice(0, 6).map((item) => (
                <div key={item.category} className="ops-category-row" role="listitem">
                  <span className="truncate">{reportCategoryLabel(item.category)}</span>
                  <span className="ops-category-track" aria-label={`${reportCategoryLabel(item.category)}: ${item.count} reports`} aria-valuemax={maxCategoryCount} aria-valuemin={0} aria-valuenow={item.count} role="progressbar">
                    <i style={{ width: `${(item.count / maxCategoryCount) * 100}%` }} />
                  </span>
                  <b>{item.count}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="ops-empty">No reports found for this department yet.</p>
          )}
        </section>

        <section className="ops-panel ops-agent-panel">
          <div className="ops-panel-heading">
            <div><h2>AI triage workflow</h2><p>Multi-agent report processing</p></div>
            <span className="ops-ai-chip"><UiIcon name="assistant" className="size-4" /> AI</span>
          </div>
          <ol className="ops-agent-list">
            {operationsStages.map(([name, description], index) => (
              <li key={name}>
                <span className={`ops-agent-node ${index === 0 ? "is-first" : ""}`}>{index + 1}</span>
                <span className="ops-agent-copy"><strong>{name}</strong><small>{description}</small></span>
                <span className="ops-agent-state">Pipeline</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Community Reports Table */}
      <section className="dashboard-card min-w-0 overflow-hidden dark:border-slate-800 dark:bg-[#012667]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[length:var(--font-section)] font-bold text-[#012667] dark:text-white">
                Recent reports
              </h2>
              <span className="rounded-full bg-[#E7F9FB] px-2.5 py-0.5 text-xs font-bold text-[#075B67] dark:bg-[#0241A3] dark:text-[#05D7E5]">
                {reports.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Ranked by urgency score · Live department dispatch
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={refreshing}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#012667] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
          >
            {refreshing ? "Refreshing…" : "Sync Queue"}
          </button>
        </div>

        <div className="ops-queue-tools">
          <label className="ops-queue-search">
            <span className="sr-only">Search reports</span>
            <input onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search issue, location, department" value={queueSearch} />
          </label>
          <div className="ops-queue-filters" aria-label="Filter reports by status">
            {queueFilters.map(({ value, label }) => (
              <button
                aria-pressed={queueStatus === value}
                className={queueStatus === value ? "is-selected" : ""}
                key={value}
                onClick={() => setQueueStatus(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {initialLoading ? (
          <div aria-label="Loading reports" className="space-y-3 p-6" role="status">
            {[0, 1, 2, 3].map((item) => (
              <div className="skeleton h-16 w-full" key={item} />
            ))}
          </div>
        ) : sortedReports.length === 0 ? (
          <div className="p-12 text-center">
            <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-full bg-[#E7F9FB] text-xl text-[#05D7E5] dark:bg-[#0241A3]">
              ✓
            </span>
            <p className="mt-3 font-bold text-[#012667] dark:text-white">
              {reports.length === 0 ? "Queue clear" : "No reports match these filters"}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {reports.length === 0 ? "All community reports in this department have been addressed." : "Try another search or status filter."}
            </p>
            {reports.length > 0 && (
              <button
                className="mt-3 text-xs font-bold text-[#176E87] underline"
                onClick={() => { setQueueStatus("all"); setQueueSearch(""); }}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="dashboard-table-wrap">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-[#0241A3]/60 dark:text-slate-300">
                  <tr>
                    <th className="px-6 py-3.5">Issue Details</th>
                    <th className="px-4 py-3.5">Assigned Agency</th>
                    <th className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() =>
                          setSortDirection((direction) => (direction === "desc" ? "asc" : "desc"))
                        }
                        aria-label={`Sort by severity, currently ${
                          sortDirection === "desc" ? "highest first" : "lowest first"
                        }`}
                        className="inline-flex items-center gap-1 font-bold text-slate-600 hover:text-[#05D7E5] dark:text-slate-300"
                      >
                        Severity {sortDirection === "desc" ? "↓" : "↑"}
                      </button>
                    </th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Logged At</th>
                    <th className="px-6 py-3.5">Operational Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {sortedReports.map((report) => (
                    <tr
                      key={report.id}
                      className="align-top transition-colors hover:bg-slate-50/70 dark:hover:bg-[#0241A3]/30"
                    >
                      <td className="max-w-xs px-6 py-4">
                        <div className="flex items-start gap-3">
                          {report.image_url ? (
                            <img alt="" className="ops-report-thumb" loading="lazy" src={report.image_url} />
                          ) : (
                            <span className="ops-report-thumb ops-report-placeholder" aria-hidden="true">SK</span>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold capitalize text-[#012667] dark:text-white">
                              {reportCategoryLabel(report.category)}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                              {report.description || "No description provided."}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{report.address || `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`}</p>
                            <p className="mt-1 text-[10px] font-mono text-slate-400">Report #{report.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {report.department_name || "Unassigned"}
                      </td>
                      <td className="px-4 py-4 font-bold text-slate-700 dark:text-slate-200">
                        <span
                          className="severity-indicator"
                          style={{ "--severity-color": severityColor(report.severity) } as CSSProperties}
                        >
                          {report.severity ?? "—"}
                          <span className="font-normal text-slate-400"> / 5</span>
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`status-badge ${statusClass(report.status)}`}>
                          {statusLabel(report.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                          new Date(report.created_at),
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {report.status !== "in_progress" && report.status !== "resolved" && (
                            <button
                              type="button"
                              onClick={() => void updateStatus(report, "in_progress")}
                              disabled={busy}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#012667] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
                            >
                              Dispatch Team
                            </button>
                          )}
                          {report.status !== "resolved" ? (
                            <button
                              type="button"
                              onClick={() => void updateStatus(report, "resolved")}
                              disabled={busy}
                              className="rounded-lg bg-[#012667] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0241A3] disabled:opacity-50 dark:bg-[#05D7E5] dark:text-[#07162F] dark:hover:bg-[#0279CE]"
                            >
                              Mark Resolved
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[#EAF7F0] px-2.5 py-1 text-xs font-bold text-[#04A077] dark:bg-emerald-950/40">
                              ✓ Closed
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Report Cards */}
            <div className="dashboard-report-cards pt-4">
              {sortedReports.map((report) => (
                <article
                  className="dashboard-mobile-report border border-slate-200 dark:border-slate-800 dark:bg-[#0241A3]/40"
                  key={report.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {report.image_url && <img alt="" className="ops-report-thumb" loading="lazy" src={report.image_url} />}
                        <h3 className="font-bold capitalize text-[#012667] dark:text-white">
                          {reportCategoryLabel(report.category)}
                        </h3>
                      </div>
                      <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {report.description || "No description provided."}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{report.address || `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`}</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-400">Report #{report.id}</p>
                    </div>
                    <span className={`status-badge ${statusClass(report.status)}`}>
                      {statusLabel(report.status)}
                    </span>
                  </div>

                  <dl className="mt-3.5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                    <div>
                      <dt className="text-slate-400">Severity</dt>
                      <dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                        <span
                          className="severity-indicator"
                          style={{ "--severity-color": severityColor(report.severity) } as CSSProperties}
                        >
                          {report.severity ?? "—"}
                          <span className="font-normal text-slate-400"> / 5</span>
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Department</dt>
                      <dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                        {report.department_name || "Unassigned"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {report.status !== "in_progress" && report.status !== "resolved" && (
                      <button
                        type="button"
                        onClick={() => void updateStatus(report, "in_progress")}
                        disabled={busy}
                        className="flex-1 rounded-lg border border-slate-300 py-2 text-xs font-semibold text-[#012667] hover:bg-[#E7F9FB] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                      >
                        Dispatch Team
                      </button>
                    )}
                    {report.status !== "resolved" ? (
                      <button
                        type="button"
                        onClick={() => void updateStatus(report, "resolved")}
                        disabled={busy}
                        className="flex-1 rounded-lg bg-[#012667] py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0241A3] disabled:opacity-50 dark:bg-[#05D7E5] dark:text-[#07162F]"
                      >
                        Mark Resolved
                      </button>
                    ) : (
                      <span className="py-2 text-center text-xs font-bold text-[#04A077]">
                        ✓ Closed
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Admin Management Panels */}
      {user.role === "admin" && (
        <div className="space-y-6 pt-4">
          <StaffAdminPanel />
          <RewardAdminPanel />
        </div>
      )}
    </div>
  );
}
