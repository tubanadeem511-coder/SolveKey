"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { FloatingAssistant } from "./FloatingAssistant";
import { SolveKeyLogo } from "./SolveKeyLogo";
import { UiIcon } from "./UiIcon";
import type { UiIconName } from "./UiIcon";

const citizenItems: { href: string; label: string; icon: UiIconName }[] = [
  { href: "/map", label: "Civic Map", icon: "map" },
  { href: "/report", label: "Report Issue", icon: "report" },
  { href: "/track-report", label: "Track Report", icon: "chart" },
  { href: "/assistant", label: "SolveKey AI", icon: "assistant" },
  { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
  { href: "/profile", label: "Profile", icon: "profile" },
];

const staffItems: { href: string; label: string; icon: UiIconName }[] = [
  { href: "/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/map", label: "Live Map", icon: "map" },
  { href: "/track-report", label: "Track Report", icon: "chart" },
  { href: "/assistant", label: "AI Operations", icon: "assistant" },
];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { user, error } = useAuth();
  const staff = !!user && ["department", "admin"].includes(user.role);
  const primaryItems = staff ? [...staffItems, { href: "/profile", label: "Profile", icon: "profile" as UiIconName }] : citizenItems;
  const headerItems = primaryItems.filter((item) => item.href !== "/profile");

  return (
    <div className="app-shell">
      <div className="app-stage">
        <header className="app-topbar">
          <Link href="/map" className="app-brand" aria-label="SolveKey home">
            <SolveKeyLogo variant="compact" size="sm" showTagline={false} />
          </Link>

          <nav className="app-primary-nav" aria-label="Primary navigation">
            {headerItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  href={item.href}
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`app-nav-link ${active ? "is-active" : ""}`}
                >
                  <UiIcon name={item.icon} className="size-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="app-actions">
            <NotificationBell />
            <ThemeToggle />
            {user ? (
              <Link href="/profile" className="app-user" aria-label="Open profile">
                <span className="app-avatar">{user.name.trim().charAt(0).toUpperCase()}</span>
                <span className="app-user-copy">
                  <strong>{user.name}</strong>
                  <small>{user.role}</small>
                </span>
              </Link>
            ) : (
              <Link href="/login" className="app-signin">Sign in</Link>
            )}
          </div>
        </header>

        {error && (
          <div className="app-error" role="alert">{error}</div>
        )}

        <main className="app-content">{children}</main>
      </div>

      <nav className="app-bottom-nav" aria-label="Mobile primary navigation">
        {(staff
          ? [{ href: "/dashboard", label: "Overview", icon: "dashboard" as UiIconName }, { href: "/map", label: "Map", icon: "map" as UiIconName }, { href: "/track-report", label: "Track", icon: "chart" as UiIconName }, { href: "/assistant", label: "AI", icon: "assistant" as UiIconName }, { href: "/profile", label: "Profile", icon: "profile" as UiIconName }]
          : citizenItems
        ).map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""}>
              <UiIcon name={item.icon} className="size-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {pathname !== "/assistant" && <FloatingAssistant />}
    </div>
  );
}
