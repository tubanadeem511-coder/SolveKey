"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { RewardRedemption } from "../lib/api";

export function RewardAdminPanel() {
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsCost, setPointsCost] = useState("");
  const [stock, setStock] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRedemptions = useCallback(async () => {
    try {
      setRedemptions(await api.rewards.redemptions());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load reward requests.");
    }
  }, []);

  useEffect(() => {
    void loadRedemptions();
  }, [loadRedemptions]);

  async function createReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.rewards.create({
        name: name.trim(),
        description: description.trim(),
        points_cost: Number(pointsCost),
        stock: stock.trim() ? Number(stock) : null,
      });
      setName("");
      setDescription("");
      setPointsCost("");
      setStock("");
      setMessage("Reward successfully published to SolveKey citizens.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish reward.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRedemption(id: number, status: "fulfilled" | "cancelled") {
    setBusy(true);
    setError(null);
    try {
      await api.rewards.updateRedemption(id, status);
      setMessage(
        status === "fulfilled"
          ? "Redemption marked fulfilled."
          : "Redemption cancelled and citizen points refunded.",
      );
      await loadRedemptions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update redemption.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-card space-y-6 p-6 sm:p-7 dark:border-slate-800 dark:bg-[#012667]">
      <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
          SolveKey Administration
        </p>
        <h2 className="mt-1 text-xl font-bold text-[#012667] dark:text-white">
          Civic Rewards & Redemptions
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Publish municipal partner rewards that SolveKey can fulfill; redemption requests verify citizen points and reserve inventory.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-sm text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl border border-emerald-200 bg-[#EAF7F0] px-4 py-3 text-sm text-[#047353] dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
          {message}
        </p>
      )}

      {/* Reward Creator Form */}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void createReward(event)}>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Reward Title
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
            maxLength={100}
            minLength={2}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. City Transit Monthly Pass"
            required
            value={name}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Points Required
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
            min={1}
            onChange={(event) => setPointsCost(event.target.value)}
            placeholder="150"
            required
            type="number"
            value={pointsCost}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 sm:col-span-2">
          Reward Description & Fulfillment Instructions
          <textarea
            className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
            maxLength={1000}
            minLength={5}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe what the citizen receives and how the agency delivers it."
            required
            value={description}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Inventory Limit (Leave blank for unlimited)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-[#012667] outline-none transition focus:border-[#05D7E5] dark:border-slate-700 dark:bg-[#0241A3] dark:text-white"
            min={0}
            onChange={(event) => setStock(event.target.value)}
            placeholder="e.g. 50"
            type="number"
            value={stock}
          />
        </label>

        <div className="flex items-end">
          <button
            className="rounded-xl bg-[#012667] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0241A3] disabled:opacity-50 dark:bg-[#05D7E5] dark:text-[#07162F] dark:hover:bg-[#0279CE]"
            disabled={busy}
            type="submit"
          >
            {busy ? "Publishing…" : "Publish Reward"}
          </button>
        </div>
      </form>

      {/* Active Redemptions List */}
      <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
        <h3 className="text-sm font-bold text-[#012667] dark:text-white">Pending Citizen Redemptions</h3>
        {!redemptions.length ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No active redemption requests.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {redemptions.map((redemption) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                key={redemption.id}
              >
                <div>
                  <p className="font-bold text-[#012667] dark:text-white">{redemption.name}</p>
                  <p className="text-slate-500">
                    Citizen #{redemption.user_id} · {redemption.points_spent} pts · {redemption.status}
                  </p>
                </div>
                {redemption.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg bg-[#04A077] px-3 py-1.5 font-bold text-white transition hover:bg-[#027A5B]"
                      disabled={busy}
                      onClick={() => void updateRedemption(redemption.id, "fulfilled")}
                      type="button"
                    >
                      Fulfill
                    </button>
                    <button
                      className="rounded-lg border border-red-300 px-3 py-1.5 font-bold text-[#DC4C4C] transition hover:bg-red-50 dark:border-red-800"
                      disabled={busy}
                      onClick={() => void updateRedemption(redemption.id, "cancelled")}
                      type="button"
                    >
                      Cancel & Refund
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
