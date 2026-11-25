"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LeaderboardEntry } from "../lib/api";
import { socket } from "../lib/socket";
import { useAuth } from "./AuthProvider";

function rankStyle(rank: number): string {
  if (rank === 1) return "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800";
  if (rank === 2) return "bg-slate-100 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
  if (rank === 3) return "bg-orange-100 text-orange-900 border border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800";
  return "bg-[#E7F9FB] text-[#075B67] border border-cyan-100 dark:bg-[#0241A3] dark:text-[#05D7E5] dark:border-slate-700";
}

export function LeaderboardScreen() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.reports.leaderboard());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the civic leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    socket.on("points:updated", loadLeaderboard);
    return () => {
      socket.off("points:updated", loadLeaderboard);
    };
  }, [loadLeaderboard]);

  return (
    <div className="leaderboard-page mx-auto max-w-4xl space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#05D7E5]" />
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
            SolveKey Civic Impact
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[#012667] dark:text-white">Civic contributors</h1>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Recognizing and honoring citizens whose verified reports actively improve city infrastructure.
        </p>
      </header>

      {error && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          <span>{error}</span>
          <button className="font-bold underline" onClick={() => void loadLeaderboard()} type="button">
            Retry
          </button>
        </div>
      )}

      {entries.length >= 3 && (
        <section className="leaderboard-podium grid grid-cols-3 items-end gap-2 border-b border-slate-200 pb-4 dark:border-slate-800" aria-label="Top three contributors">
          {[entries[1], entries[0], entries[2]].map((entry, visualIndex) => {
            const rank = visualIndex === 1 ? 1 : visualIndex === 0 ? 2 : 3;
            return (
              <article key={entry.id} className={`${rank === 1 ? "pb-5" : "pb-1"} text-center`}>
                <span className={`leaderboard-podium-rank rank-${rank}`}>#{rank}</span>
                <span className={`mx-auto grid ${rank === 1 ? "size-14" : "size-11"} place-items-center rounded-full border-2 border-white bg-[#092553] text-sm font-extrabold text-white shadow-md dark:border-[#07162F]`}>
                  {entry.name.charAt(0).toUpperCase()}
                </span>
                <p className="mt-2 truncate text-xs font-bold text-[#092553] dark:text-white sm:text-sm">{entry.name}</p>
                <p className="mt-0.5 text-[10px] font-bold text-slate-500">{entry.points.toLocaleString()} pts</p>
                <p className="mt-0.5 truncate text-[9px] text-slate-400">{entry.level}</p>
              </article>
            );
          })}
        </section>
      )}

      <section
        className="dashboard-card overflow-hidden dark:border-slate-800 dark:bg-[#012667]"
        aria-label="Top SolveKey citizens"
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-[#F8FAFC]/50 px-4 py-3 dark:border-slate-800 dark:bg-[#07162F]/40">
          <h2 className="text-sm font-bold text-[#012667] dark:text-white">Top Contributing Citizens</h2>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Civic Points</span>
        </div>

        {loading && entries.length === 0 ? (
          <p className="px-6 py-12 text-center text-xs text-slate-500" role="status">
            Syncing leaderboard metrics…
          </p>
        ) : entries.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-bold text-[#012667] dark:text-white">No leaderboard entries yet</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Be the first citizen to report an issue and earn civic points.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((entry, index) => {
              const rank = index + 1;
              const isCurrentUser = entry.id === user?.id;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center gap-3 px-4 py-3 transition ${
                    isCurrentUser
                      ? "bg-[#E7F9FB] dark:bg-[#0241A3]/60"
                      : "hover:bg-slate-50/70 dark:hover:bg-[#0241A3]/30"
                  }`}
                >
                  <span aria-label={`Rank ${rank}`}
                    className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${rankStyle(
                      rank,
                    )}`}
                  >
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-[#012667] dark:text-white">
                      {entry.name}
                      {isCurrentUser && (
                        <span className="ml-2 rounded-full bg-[#05D7E5]/20 border border-[#05D7E5]/40 px-2 py-0.5 text-[10px] font-bold text-[#075B67] dark:text-[#05D7E5]">
                          You
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{entry.level}</p>
                  </div>
                  <p className="shrink-0 text-right font-extrabold tabular-nums text-[#012667] dark:text-[#05D7E5]">
                    {entry.points.toLocaleString()}
                    <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">pts</span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
