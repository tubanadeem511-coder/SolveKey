"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import type { Report } from "../lib/api";
import { getLevelProgress, levelRank } from "../lib/levels";
import { socket } from "../lib/socket";
import { useAuth } from "./AuthProvider";
import { PointsCelebration } from "./PointsCelebration";
import { RewardsPanel } from "./RewardsPanel";
import { UiIcon } from "./UiIcon";
import type { Celebration } from "./PointsCelebration";
import { reportCategoryLabel } from "../lib/report-categories";

interface PointSnapshot {
  userId: number;
  points: number;
  level: string;
}

function statusStyle(status: string): string {
  switch (status) {
    case "resolved":
      return "bg-emerald-100 text-emerald-800";
    case "in_progress":
      return "bg-sky-100 text-sky-800";
    case "duplicate":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function ProfileScreen() {
  const router = useRouter();
  const { user, loading: authLoading, error: authError, refresh, logout } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const previousPoints = useRef<PointSnapshot | null>(null);
  const userId = user?.id ?? null;
  const userPoints = user?.points ?? null;

  const loadMine = useCallback(async () => {
    if (userId === null) return;
    setReportsLoading(true);
    try {
      setReports(await api.reports.mine());
      setReportsError(null);
    } catch (error) {
      setReportsError(error instanceof Error ? error.message : "Could not load your reports.");
    } finally {
      setReportsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId === null) return;
    void loadMine();
  }, [userId, loadMine]);

  useEffect(() => {
    if (userId === null) return;

    const refreshProfile = () => {
      void refresh({ silent: true });
      void loadMine();
    };
    const refreshPoints = (updated: { id: number }) => {
      if (updated.id === userId) void refresh({ silent: true });
    };
    void refresh({ silent: true });
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15_000);
    window.addEventListener("focus", refreshProfile);
    socket.on("report:new", refreshProfile);
    socket.on("report:updated", refreshProfile);
    socket.on("points:updated", refreshPoints);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshProfile);
      socket.off("report:new", refreshProfile);
      socket.off("report:updated", refreshProfile);
      socket.off("points:updated", refreshPoints);
    };
  }, [userId, refresh, loadMine]);

  useEffect(() => {
    if (userId === null || userPoints === null || authLoading) return;

    const level = getLevelProgress(userPoints).level;
    const previous = previousPoints.current;
    if (previous?.userId === userId) {
      const pointsEarned = userPoints - previous.points;
      const leveledUp = levelRank(level) > levelRank(previous.level);
      if (pointsEarned > 0 || leveledUp) {
        setCelebration({ id: Date.now(), pointsEarned: Math.max(0, pointsEarned), levelReached: leveledUp ? level : null });
      }
    } else {
      previousPoints.current = { userId, points: userPoints, level };
      return;
    }
    previousPoints.current = { userId, points: userPoints, level };
  }, [userId, userPoints, authLoading]);

  const dismissCelebration = useCallback(() => setCelebration(null), []);

  async function handleLogout() {
    setActionError(null);
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  if (authLoading) {
    return <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-soft" role="status">Loading your profile…</p>;
  }

  if (!user) {
    return (
      <section className="dashboard-card mx-auto max-w-xl p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-[#012667]">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#E7F9FB] text-[#012667] dark:bg-[#0241A3] dark:text-[#05D7E5]">
          <UiIcon name="profile" className="size-5" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-[#012667] dark:text-white">Sign in to view your profile</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Your civic points, SolveKey rank, badges, and submitted municipal reports are synced to your account.
        </p>
        <Link
          className="sk-primary-action mt-6 inline-flex rounded-xl px-6 py-3 text-sm shadow-md transition"
          href="/login"
        >
          Sign in to SolveKey
        </Link>
      </section>
    );
  }

  const progress = getLevelProgress(user.points);
  const level = user.level || progress.level;
  const initials = user.name.trim().slice(0, 1).toUpperCase() || "S";
  const resolvedReports = reports.filter((report) => report.status === "resolved").length;

  return (
    <div className="profile-dashboard mx-auto max-w-5xl space-y-5">
      {celebration && <PointsCelebration key={celebration.id} celebration={celebration} onDismiss={dismissCelebration} />}

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#05D7E5]" />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
              SolveKey Citizen Profile
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[#012667] dark:text-white">Community impact</h1>
        </div>
        <button
          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#012667] transition hover:border-red-300 hover:bg-red-50 hover:text-[#DC4C4C] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-red-950/30"
          onClick={() => void handleLogout()}
          type="button"
        >
          Sign out
        </button>
      </header>

      {authError && <p className="rounded-xl border border-amber-200 bg-[#FEF7EC] px-4 py-3 text-xs text-[#8E5A10]" role="alert">{authError}</p>}
      {actionError && <p className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C]" role="alert">{actionError}</p>}

      {/* Main Profile Badge Card */}
      <section className="dashboard-card overflow-hidden dark:border-slate-800 dark:bg-[#012667]">
        <div className="relative overflow-hidden bg-[#092553] p-5 text-white sm:p-6">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#05D7E5]/15 to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/10 text-xl font-black text-[#05D7E5] ring-1 ring-white/20">
              {initials}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold">{user.name}</h2>
              <p className="mt-0.5 truncate text-xs text-slate-300">{user.email || "SolveKey Citizen"}</p>
            </div>
            <span className="ml-auto rounded-full bg-[#05D7E5]/20 border border-[#05D7E5]/40 px-3.5 py-1 text-xs font-bold tracking-wide text-[#05D7E5]">
              {level}
            </span>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Civic Points</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#012667] dark:text-[#05D7E5]">
              {user.points.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Earned through verified problem reports</p>
          </div>

          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-[#012667] dark:text-white">
                  {progress.nextLevel ? `Progress to ${progress.nextLevel}` : "Maximum Level Reached"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {progress.nextLevel
                    ? `${progress.pointsToNext} points to next civic milestone`
                    : "You’ve achieved Hero status in SolveKey. Thank you for your leadership!"}
                </p>
              </div>
              <span className="text-xs font-extrabold tabular-nums text-[#012667] dark:text-[#05D7E5]">
                {Math.round(progress.progressPercent)}%
              </span>
            </div>
            <div
              className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-[#0241A3]"
              role="progressbar"
              aria-label={progress.nextLevel ? `Progress to ${progress.nextLevel}` : "Maximum level reached"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.progressPercent)}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0241A3] via-[#0279CE] to-[#05D7E5] transition-[width] duration-700 ease-out"
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            {progress.nextLevel && (
              <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
                <span>{progress.pointsIntoLevel} pts in {progress.level}</span>
                <span>{progress.pointsForNextLevel} pts to {progress.nextLevel}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="profile-metrics" aria-label="Your civic contribution">
        {[
          ["Reports submitted", reportsLoading ? "—" : reports.length],
          ["Resolved", reportsLoading ? "—" : resolvedReports],
          ["Civic points", user.points.toLocaleString()],
          ["Level", level],
        ].map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </section>

      <section className="dashboard-card p-5 sm:p-6 dark:border-slate-800 dark:bg-[#012667]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">Civic Recognition</p>
        <h2 className="mt-1 text-xl font-bold text-[#012667] dark:text-white">Badges & Credentials</h2>
        {user.badges?.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {user.badges.map((badge) => (
              <li className="rounded-2xl border border-slate-100 bg-[#F8FAFC] p-4 dark:border-slate-800 dark:bg-[#0241A3]/40" key={badge.code}>
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-xl bg-[#E7F9FB] text-[#0241A3] dark:bg-[#0241A3] dark:text-[#05D7E5]">
                    <UiIcon name="award" className="size-4" />
                  </span>
                  <h3 className="font-bold text-[#012667] dark:text-white">{badge.name}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{badge.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Your first civic badge will appear when you complete an achievement milestone.</p>
        )}
      </section>

      <RewardsPanel />

      <section className="dashboard-card overflow-hidden dark:border-slate-800 dark:bg-[#012667]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="font-bold text-[#012667] dark:text-white">Your Incident Reports</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Track real-time progress and agency resolution.</p>
          </div>
          <Link className="rounded-xl bg-[#012667] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0241A3] dark:bg-[#05D7E5] dark:text-[#07162F]" href="/report">
            + New report
          </Link>
        </div>

        {reportsError && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C]" role="alert">
            <span>{reportsError}</span>
            <button className="font-bold underline" onClick={() => void loadMine()} type="button">Retry</button>
          </div>
        )}

        {reportsLoading && reports.length === 0 ? (
          <p className="px-6 py-10 text-center text-xs text-slate-500" role="status">Syncing your reports…</p>
        ) : reports.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#E7F9FB] text-xl font-bold text-[#05D7E5] dark:bg-[#0241A3]">
              ✓
            </span>
            <p className="mt-3 font-bold text-[#012667] dark:text-white">No active incident reports</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Issues you file to improve your neighborhood will display here.</p>
            <Link className="mt-4 inline-flex rounded-xl bg-[#012667] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#0241A3] dark:bg-[#05D7E5] dark:text-[#07162F]" href="/report">
              Report an issue
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {reports.map((report) => (
              <li key={report.id} className="flex items-start gap-4 px-6 py-4 transition hover:bg-slate-50/60 dark:hover:bg-[#0241A3]/30">
                {report.image_url ? (
                  <img
                    alt=""
                    className="size-14 shrink-0 rounded-xl bg-slate-100 object-cover dark:bg-slate-800"
                    loading="lazy"
                    src={report.image_url}
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-[#E7F9FB] text-xs font-black text-[#012667] dark:bg-[#0241A3] dark:text-[#05D7E5]" aria-hidden="true">
                    SK
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {report.report_number && (
                    <p className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Report Number:
                      </span>
                      <span className="font-mono text-xs font-bold tracking-wide text-[#075B67] dark:text-[#05D7E5]">
                        {report.report_number}
                      </span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#012667] dark:text-white">{reportCategoryLabel(report.category)}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusStyle(report.status)}`}>
                      {report.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Assigned department: {report.department_name || "Awaiting assignment"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {report.description || "No description provided."}
                  </p>
                  <p className="mt-1.5 text-[10px] text-slate-400">
                    Logged {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(report.created_at))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
