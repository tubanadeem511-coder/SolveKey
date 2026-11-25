"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";
import type { Report } from "../lib/api";
import { socket } from "../lib/socket";
import { reportCategories, reportCategoryLabel } from "../lib/report-categories";
import { MapView } from "./MapView";
import { ReportDetailSheet } from "./ReportDetailSheet";
import { UiIcon } from "./UiIcon";

const STATUSES = ["pending", "reported", "in_progress", "resolved", "duplicate"];

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MapScreen() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const loadReports = useCallback(async () => {
    setRefreshing(true);
    try {
      const currentReports = await api.reports.list({
        query: searchQuery || undefined,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setReports(currentReports);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load reports.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryFilter, searchQuery, statusFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    const onNewReport = () => {
      void loadReports();
    };
    const onReportUpdated = (update: { id: number; status?: string; category?: string; severity?: number }) => {
      setReports((current) =>
        current.map((report) =>
          report.id === update.id
            ? {
                ...report,
                status: update.status ?? report.status,
                category: update.category ?? report.category,
                severity: update.severity ?? report.severity,
              }
            : report,
        ),
      );
      void loadReports();
    };

    socket.on("report:new", onNewReport);
    socket.on("report:updated", onReportUpdated);
    return () => {
      socket.off("report:new", onNewReport);
      socket.off("report:updated", onReportUpdated);
    };
  }, [loadReports]);

  const categoryOptions = reportCategories.map(({ value }) => value);
  const selectedReport = reports.find((report) => report.id === selectedId) ?? null;
  const cityPulse = useMemo(() => ({
    open: reports.filter((report) => report.status !== "resolved").length,
    resolved: reports.filter((report) => report.status === "resolved").length,
    priority: reports.filter((report) => report.status !== "resolved" && report.severity !== null && report.severity >= 4).length,
    progress: reports.filter((report) => report.status === "in_progress").length,
  }), [reports]);

  function updateUpvotes(reportId: number) {
    setReports((current) =>
      current.map((report) => (report.id === reportId ? { ...report, upvotes: report.upvotes + 1 } : report)),
    );
  }

  return (
    <div className="map-workspace">
      <header className="map-page-heading">
        <div>
          <p className="map-eyebrow"><span className="app-live-dot" /> LIVE CIVIC NETWORK</p>
          <h1>Civic issue map</h1>
          <p>Explore reports and follow city response as it happens.</p>
        </div>
        <div className="map-heading-actions">
          <span className="map-refresh-status">{refreshing ? "Updating" : "Live updates on"}</span>
          <Link className="map-report-action" href="/report"><UiIcon name="report" className="size-4" /> Report issue</Link>
        </div>
      </header>

      <section className="map-stats" aria-label="Current civic activity">
        {[
          { label: "Active issues", value: cityPulse.open, tone: "blue" },
          { label: "Critical", value: cityPulse.priority, tone: "red" },
          { label: "In progress", value: cityPulse.progress, tone: "cyan" },
          { label: "Resolved", value: cityPulse.resolved, tone: "green" },
        ].map((stat) => (
          <div className="map-stat" key={stat.label}>
            <span className={`map-stat-dot ${stat.tone}`} />
            <div><strong>{loading ? "—" : stat.value}</strong><span>{stat.label}</span></div>
          </div>
        ))}
      </section>

      <section aria-label="Search and filter civic reports" className="map-filters">
        <form
          className="map-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearchQuery(searchInput.trim());
          }}
        >
          <label className="sr-only" htmlFor="report-search">Search reports</label>
          <input
            id="report-search"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-sm text-[#012667] outline-none transition focus:border-[#05D7E5] focus:ring-2 focus:ring-[#05D7E5]/20 dark:border-slate-700 dark:bg-[#07162F] dark:text-white"
            maxLength={120}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by report or neighborhood"
            value={searchInput}
          />
          <button className="map-search-button" type="submit">Search</button>
        </form>

        <label className="map-filter-select">
          <span>Category</span>
          <select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
            <option value="all">All categories</option>
            {categoryOptions.map((category) => <option key={category} value={category}>{reportCategoryLabel(category)}</option>)}
          </select>
        </label>

        <label className="map-filter-select">
          <span>Status</span>
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="all">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}
          </select>
        </label>
      </section>

      <div className="map-viewport">
        <MapView reports={reports} onSelect={(report) => setSelectedId(report.id)} />

        <div className="map-floating-pulse">
          <div className="map-pulse-title"><span className="app-live-dot" /><span>City pulse</span><small>{loading ? "Syncing" : "Live"}</small></div>
          <div className="map-pulse-value">{loading ? "—" : reports.length}<span> reports in view</span></div>
          <div className="map-pulse-grid">
            <span><i className="red" />Critical <b>{loading ? "—" : cityPulse.priority}</b></span>
            <span><i className="cyan" />In progress <b>{loading ? "—" : cityPulse.progress}</b></span>
            <span><i className="green" />Resolved <b>{loading ? "—" : cityPulse.resolved}</b></span>
          </div>
        </div>

        {selectedReport && (
          <ReportDetailSheet
            key={selectedReport.id}
            report={selectedReport}
            onClose={() => setSelectedId(null)}
            onUpvoted={updateUpvotes}
          />
        )}
        {!selectedReport && (
          <div className="map-legend" aria-label="Severity marker legend">
            <span className="map-legend-title">Severity</span>
            <span><i className="green" />Low 1–2</span>
            <span><i className="amber" />Moderate 3</span>
            <span><i className="red" />Critical 4–5</span>
            <span><i className="slate" />Pending</span>
          </div>
        )}
      </div>
      {loadError && (
        <div className="map-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => void loadReports()} type="button">Retry</button>
        </div>
      )}
    </div>
  );
}
