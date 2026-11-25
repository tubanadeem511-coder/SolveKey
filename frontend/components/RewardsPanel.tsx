"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Reward, RewardRedemption } from "../lib/api";
import { useAuth } from "./AuthProvider";

export function RewardsPanel() {
  const { refresh } = useAuth();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRewardId, setBusyRewardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [available, mine] = await Promise.all([api.rewards.list(), api.rewards.mine()]);
      setRewards(available);
      setRedemptions(mine);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(reward: Reward) {
    setBusyRewardId(reward.id);
    setError(null);
    setMessage(null);
    try {
      await api.rewards.redeem(reward.id);
      setMessage(`Your redemption request for ${reward.name} was successfully submitted.`);
      await Promise.all([load(), refresh({ silent: true })]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not redeem this reward.");
    } finally {
      setBusyRewardId(null);
    }
  }

  return (
    <section className="dashboard-card space-y-5 p-6 sm:p-7 dark:border-slate-800 dark:bg-[#012667]">
      <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
          Civic Incentives
        </p>
        <h2 className="mt-1 text-xl font-bold text-[#012667] dark:text-white">
          Redeem Citizen Points
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Rewards are sponsored and fulfilled by SolveKey municipal partners. Redemption requests remain pending until dispatched.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C]" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl border border-emerald-200 bg-[#EAF7F0] px-4 py-3 text-xs text-[#047353]" role="status">
          {message}
        </p>
      )}

      {loading && !rewards.length && <p className="text-xs text-slate-500" role="status">Loading rewards catalog…</p>}
      {!loading && !rewards.length && <p className="text-xs text-slate-500">No active civic partner rewards available currently.</p>}

      <ul className="grid gap-3.5 sm:grid-cols-2">
        {rewards.map((reward) => (
          <li
            className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-[#F8FAFC]/50 p-4 dark:border-slate-800 dark:bg-[#0241A3]/30"
            key={reward.id}
          >
            <div>
              <h3 className="font-bold text-[#012667] dark:text-white">{reward.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{reward.description}</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <span className="text-xs font-extrabold text-[#012667] dark:text-[#05D7E5]">
                {reward.points_cost.toLocaleString()} <span className="font-normal text-slate-500">pts</span>
              </span>
              <button
                className="rounded-xl bg-[#012667] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0241A3] disabled:opacity-50 dark:bg-[#05D7E5] dark:text-[#07162F] dark:hover:bg-[#0279CE]"
                disabled={busyRewardId !== null || reward.stock === 0}
                onClick={() => void redeem(reward)}
                type="button"
              >
                {reward.stock === 0 ? "Out of Stock" : busyRewardId === reward.id ? "Submitting…" : "Redeem"}
              </button>
            </div>
            {reward.stock !== null && (
              <p className="mt-1.5 text-[10px] text-slate-400">{reward.stock} units remaining</p>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Your Redemption History
        </h3>
        {!redemptions.length ? (
          <p className="mt-2 text-xs text-slate-500">No redemptions requested yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {redemptions.map((item) => (
              <li className="flex items-center justify-between gap-3 py-2.5 text-xs" key={item.id}>
                <span className="font-medium text-[#012667] dark:text-white">{item.name}</span>
                <span className="rounded-full bg-[#E7F9FB] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#075B67] dark:bg-[#0241A3] dark:text-[#05D7E5]">
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
