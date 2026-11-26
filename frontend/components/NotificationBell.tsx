"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
import type { Notification } from "../lib/api";
import { socket } from "../lib/socket";
import { useAuth } from "./AuthProvider";
import { UiIcon } from "./UiIcon";

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    try {
      setNotifications(await api.notifications.list());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load notifications.");
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
    const onNew = (notification: Notification) => {
      setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50));
    };
    socket.on("notification:new", onNew);
    return () => {
      socket.off("notification:new", onNew);
    };
  }, [loadNotifications]);

  async function markRead(id: number) {
    try {
      const result = await api.notifications.markRead(id);
      setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read_at: result.read_at } : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark notification as read.");
    }
  }

  async function markAllRead() {
    try {
      await api.notifications.markAllRead();
      const now = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark notifications as read.");
    }
  }

  if (!user) return null;
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        className="relative grid size-10 place-items-center rounded-xl border border-slate-200/80 bg-white/80 text-[#0241A3] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] hover:text-[#012667] dark:border-slate-700/80 dark:bg-[#122446] dark:text-slate-200 dark:hover:border-[#05D7E5] dark:hover:bg-[#0241A3]"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
          <path
            d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4.5 h-4.5 place-items-center rounded-full bg-[#DC4C4C] px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-[#122446]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          className="notification-panel absolute right-0 top-12 z-[1300] max-h-[72vh] w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#122446]"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-[#012667] dark:text-white">Notifications</h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-[#E7F9FB] px-2 py-0.5 text-xs font-semibold text-[#075B67] dark:bg-[#103553] dark:text-[#05D7E5]">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                className="text-xs font-semibold text-[#012667] underline decoration-[#05D7E5] decoration-2 underline-offset-2 transition hover:text-[#05D7E5] dark:text-slate-300 dark:hover:text-[#05D7E5]"
                onClick={() => void markAllRead()}
                type="button"
              >
                Mark all read
              </button>
            )}
          </div>
          {error && <p className="px-4 py-2 text-xs text-[#DC4C4C]" role="alert">{error}</p>}
          <ul className="max-h-[58vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800/80">
            {!notifications.length && (
              <li className="px-4 py-10 text-center">
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-[#E7F9FB] text-[#04A077] dark:bg-[#0241A3]">
                  <UiIcon name="check" className="size-5" />
                </span>
                <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">All caught up</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Status updates on your reports will appear here.</p>
              </li>
            )}
            {notifications.map((item) => (
              <li key={item.id}>
                <button
                  className={`w-full px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-[#0241A3]/60 ${
                    item.read_at ? "" : "bg-[#F8FAFC] dark:bg-[#0241A3]/35"
                  }`}
                  onClick={() => {
                    if (!item.read_at) void markRead(item.id);
                    setOpen(false);
                    if (typeof item.payload.reportId === "number") router.push("/map");
                  }}
                  type="button"
                >
                  <div className="flex items-start gap-2.5">
                    {!item.read_at && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#05D7E5]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#012667] dark:text-slate-100">
                        {item.title || "SolveKey Update"}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {item.body}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
