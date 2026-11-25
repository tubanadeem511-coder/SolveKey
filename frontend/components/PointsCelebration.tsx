"use client";

import { useEffect } from "react";
import { UiIcon } from "./UiIcon";

export interface Celebration {
  id: number;
  pointsEarned: number;
  levelReached: string | null;
}

export function PointsCelebration({
  celebration,
  onDismiss,
}: {
  celebration: Celebration;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(timer);
  }, [celebration.id, onDismiss]);

  return (
    <div
      className="eco-celebration fixed right-4 top-20 z-[1200] flex max-w-sm items-center gap-3.5 rounded-2xl border border-[#05D7E5]/30 bg-white/95 p-4 shadow-xl backdrop-blur-md dark:border-slate-700 dark:bg-[#012667]/95"
      role="status"
      aria-live="polite"
    >
      <span
        className="eco-celebration-sparkle grid size-10 shrink-0 place-items-center rounded-xl bg-[#E7F9FB] text-[#05D7E5] dark:bg-[#0241A3]"
        aria-hidden="true"
      >
        <UiIcon name="assistant" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-[#075B67] dark:text-[#05D7E5]">
          {celebration.levelReached ? `Milestone: ${celebration.levelReached}!` : "Civic Points Awarded"}
        </p>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
          {celebration.pointsEarned > 0
            ? `+${celebration.pointsEarned} points logged for your civic participation.`
            : "Keep up the excellent municipal collaboration."}
        </p>
      </div>
      <button
        aria-label="Dismiss points celebration"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#0241A3]"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
