import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // SolveKey civic palette, sampled from the supplied logo.
        solvekey: {
          navy: "#012667",
          blue: "#0241A3",
          "blue-bright": "#0279CE",
          deep: "#07162F",
          secondary: "#0241A3",
          surface: "#122446",
          cyan: "#05D7E5",
          "cyan-light": "#7CB3DD",
          "cyan-soft": "#E7F9FB",
          green: "#0BD58A",
          teal: "#04A077",
          lime: "#73F330",
          bg: "#F8FAFC",         // Background
          card: "#FFFFFF",       // Surface
          ink: "#012667",        // Primary Text
          muted: "#64748B",      // Secondary Text
          border: "#E2E8F0",     // Border
          success: "#04A077",
          warning: "#E6A23C",    // Warning
          error: "#DC4C4C",      // Error
        },
        // Legacy semantic mappings mapped to SolveKey design system
        forest: "#04A077",
        leaf: "#027A5B",
        mint: "#EAF8F1",
        lagoon: "#E7F9FB",
        ink: "#012667",
      },
      boxShadow: {
        soft: "0 10px 28px -5px rgba(1, 38, 103, 0.08), 0 3px 10px -2px rgba(1, 38, 103, 0.04)",
        card: "0 4px 18px -3px rgba(1, 38, 103, 0.07), 0 1px 3px rgba(1, 38, 103, 0.04)",
        elevated: "0 18px 38px -8px rgba(1, 38, 103, 0.14), 0 5px 14px -4px rgba(1, 38, 103, 0.06)",
        "cyan-glow": "0 0 18px -5px rgba(5, 215, 229, 0.32)",
      },
    },
  },
  plugins: [],
};

export default config;
