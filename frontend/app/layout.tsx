import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import { AuthProvider } from "../components/AuthProvider";
import { PwaRegistration } from "../components/PwaRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SolveKey — Civic Issue Resolution Platform",
    template: "%s | SolveKey",
  },
  description: "Report. Resolve. Improve. SolveKey connects citizens with municipal departments to simplify civic issue reporting and accelerate public service delivery.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SolveKey",
  },
  icons: {
    icon: "/solvekey-favicon.png",
    apple: "/solvekey-favicon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#012667",
  width: "device-width",
  initialScale: 1,
};

const themeBootstrap = `
  const savedTheme = localStorage.getItem("solvekey-theme") || localStorage.getItem("SolveKey-theme");
  const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : preferredTheme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <AuthProvider>
          <PwaRegistration />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
