import type { SVGProps } from "react";

export type UiIconName =
  | "map"
  | "report"
  | "leaderboard"
  | "profile"
  | "dashboard"
  | "assistant"
  | "lock"
  | "shield"
  | "bolt"
  | "check"
  | "chart"
  | "award"
  | "alert";

/** Small, consistent outline icons for SolveKey's shared interface. */
export function UiIcon({
  name,
  className = "size-5",
  ...props
}: SVGProps<SVGSVGElement> & { name: UiIconName }) {
  const paths: Record<UiIconName, string[]> = {
    map: ["M9 18 3.8 20.6A1.2 1.2 0 0 1 2 19.5V5.8a1.2 1.2 0 0 1 .7-1.1L9 2m0 16 6 3m-6-3V2m6 19 6.3-3.2a1.2 1.2 0 0 0 .7-1.1V3.8a1.2 1.2 0 0 0-1.8-1.1L15 5m0 16V5m0 0L9 2"],
    report: ["M12 5v14m-7-7h14"],
    leaderboard: ["M8 21h8m-4-4v4m-6-9V4h12v8m-18 0h8v4H2zm12-3h8v7h-8z"],
    profile: ["M20 21a8 8 0 0 0-16 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
    dashboard: ["M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z"],
    assistant: ["m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z", "m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4", "M12 15v2"],
    shield: ["M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z", "m9 12 2 2 4-4"],
    bolt: ["m13 2-3 9h7l-6 11 1-8H5l8-12Z"],
    check: ["m5 12 4 4L19 6"],
    chart: ["M4 19V5m0 14h17", "m7 15 4-4 3 2 6-7", "M17 6h3v3"],
    award: ["M8 4h8v4a4 4 0 0 1-8 0V4Z", "M8 6H5v2a4 4 0 0 0 4 4m7-6h3v2a4 4 0 0 1-4 4", "m10 12-1 4-3 5 6-2 6 2-3-5-1-4"],
    alert: ["M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9v4m0 3h.01"],
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}
