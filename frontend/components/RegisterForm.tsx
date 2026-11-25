"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { UiIcon } from "./UiIcon";

export function RegisterForm() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await register({ name, email, password });
      router.replace("/map");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create your account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#012667] dark:text-slate-200" htmlFor="register-name">
          Full name
        </label>
        <input
          id="register-name"
          autoComplete="name"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#012667] outline-none transition focus:border-[#05D7E5] focus:ring-4 focus:ring-[#05D7E5]/15 dark:border-slate-700 dark:bg-[#0241A3]/60 dark:text-white"
          minLength={2}
          onChange={(event) => setName(event.target.value)}
          placeholder="Jane Doe"
          required
          value={name}
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#012667] dark:text-slate-200" htmlFor="register-email">
          Email address
        </label>
        <input
          id="register-email"
          autoComplete="email"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#012667] outline-none transition focus:border-[#05D7E5] focus:ring-4 focus:ring-[#05D7E5]/15 dark:border-slate-700 dark:bg-[#0241A3]/60 dark:text-white"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="jane@example.gov"
          required
          type="email"
          value={email}
        />
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-[#012667] dark:text-slate-200" htmlFor="register-password">
          Password
        </label>
        <input
          id="register-password"
          autoComplete="new-password"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#012667] outline-none transition focus:border-[#05D7E5] focus:ring-4 focus:ring-[#05D7E5]/15 dark:border-slate-700 dark:bg-[#0241A3]/60 dark:text-white"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          required
          type="password"
          value={password}
        />
        <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">Must contain at least 8 characters.</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
          <UiIcon name="alert" className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        className="sk-primary-action w-full rounded-xl px-5 py-3.5 text-sm shadow-md transition focus:outline-none focus:ring-4 focus:ring-[#05D7E5]/25 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Creating citizen account..." : "Join SolveKey Network"}
      </button>
    </form>
  );
}
