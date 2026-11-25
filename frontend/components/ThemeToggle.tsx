"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem("solvekey-theme") || localStorage.getItem("SolveKey-theme");
    const bootstrapped = document.documentElement.dataset.theme;
    const initial: Theme =
      saved === "dark" || saved === "light"
        ? saved
        : bootstrapped === "dark" || bootstrapped === "light"
        ? bootstrapped
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("solvekey-theme", next);
    localStorage.setItem("SolveKey-theme", next);
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <button
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-pressed={theme === "dark"}
      className="grid size-10 place-items-center rounded-xl border border-slate-200/80 bg-white/80 text-[#0241A3] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] hover:text-[#012667] dark:border-slate-700/80 dark:bg-[#122446] dark:text-slate-200 dark:hover:border-[#05D7E5] dark:hover:bg-[#0241A3]"
      onClick={toggleTheme}
      type="button"
    >
      {theme === "dark" ? (
        <svg aria-hidden="true" className="size-4.5 text-[#05D7E5]" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41m14.14-14.14l-1.41 1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="size-4.5 text-[#0241A3]" fill="none" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
