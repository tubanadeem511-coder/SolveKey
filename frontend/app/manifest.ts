import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SolveKey — Civic Issue Resolution Platform",
    short_name: "SolveKey",
    description: "Report. Resolve. Improve. Connect with city departments and track civic solutions.",
    start_url: "/map",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait-primary",
    background_color: "#F8FAFC",
    theme_color: "#012667",
    categories: ["civic", "utilities", "government"],
    icons: [
      {
        src: "/solvekey-favicon.png",
        sizes: "768x768",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      { name: "Report an issue", short_name: "Report", url: "/report" },
      { name: "Civic Map", short_name: "Map", url: "/map" },
    ],
  };
}
