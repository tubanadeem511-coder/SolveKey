"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { api } from "../lib/api";
import type { AgentLog, Report, ReportMessage } from "../lib/api";
import { socket } from "../lib/socket";
import { useAuth } from "./AuthProvider";
import { reportCategoryLabel } from "../lib/report-categories";

interface ReportDetailSheetProps {
  report: Report;
  onClose: () => void;
  onUpvoted: (reportId: number) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusName(status: string): string {
  return status.replaceAll("_", " ");
}

function stepTitle(name: string): string {
  const titles: Record<string, string> = {
    VisionAgent: "Photo classification",
    DuplicateAgent: "Nearby report check",
    PriorityAgent: "Severity assessment",
    RoutingAgent: "Department routing",
    ReportWriter: "Complaint summary",
    Orchestrator: "Pipeline status",
  };
  return titles[name] || name;
}

function stepSummary(log: AgentLog): string {
  const output = isRecord(log.output) ? log.output : {};
  switch (log.agent_name) {
    case "VisionAgent": {
      const category = typeof output.category === "string" ? reportCategoryLabel(output.category) : "Issue classified";
      const description = typeof output.description === "string" ? output.description : "";
      return description ? `${category} — ${description}` : category;
    }
    case "DuplicateAgent": {
      const duplicates = Array.isArray(output.duplicates) ? output.duplicates : [];
      return duplicates.length ? `${duplicates.length} nearby matching report${duplicates.length === 1 ? "" : "s"} found.` : "No nearby matching reports found.";
    }
    case "PriorityAgent": {
      const reason = typeof output.reason === "string" ? output.reason : "";
      return `Severity ${typeof output.severity === "number" ? output.severity : "assigned"}${reason ? ` — ${reason}` : ""}`;
    }
    case "RoutingAgent": {
      const department = isRecord(output.dept) && typeof output.dept.name === "string" ? output.dept.name : null;
      return department ? `Assigned to ${department}.` : "No matching department was found.";
    }
    case "ReportWriter":
      return typeof output.summary === "string" ? output.summary : "Complaint summary prepared.";
    case "Orchestrator":
      return typeof output.error === "string" ? output.error : "The pipeline reported an error.";
    default:
      return "Step completed.";
  }
}

function severityClass(severity: number | null): string {
  if (severity === null) return "bg-slate-100 text-slate-700 dark:bg-[#0241A3] dark:text-slate-300";
  if (severity <= 2) return "bg-[#EAF7F0] text-[#047353] dark:bg-emerald-950/40 dark:text-[#5EE2A3]";
  if (severity === 3) return "bg-[#FEF7EC] text-[#8E5A10] dark:bg-amber-950/40 dark:text-[#F7D088]";
  return "bg-[#FDF2F2] text-[#962828] dark:bg-red-950/40 dark:text-[#F89494]";
}

export function ReportDetailSheet({ report, onClose, onUpvoted }: ReportDetailSheetProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [trace, setTrace] = useState<AgentLog[]>([]);
  const [traceLoading, setTraceLoading] = useState(true);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [upvotes, setUpvotes] = useState(report.upvotes);
  const [hasUpvoted, setHasUpvoted] = useState(report.has_upvoted ?? false);
  const [upvoting, setUpvoting] = useState(false);
  const [upvoteError, setUpvoteError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [messages, setMessages] = useState<ReportMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const loadTrace = useCallback(async () => {
    setTraceLoading(true);
    try {
      setTrace(await api.reports.trace(report.id));
      setTraceError(null);
    } catch (error) {
      setTraceError(error instanceof Error ? error.message : "Could not load the AI trace.");
    } finally {
      setTraceLoading(false);
    }
  }, [report.id]);

  useEffect(() => {
    void loadTrace();
    const onUpdate = (event: { id: number }) => {
      if (event.id === report.id) void loadTrace();
    };
    socket.on("report:updated", onUpdate);
    return () => {
      socket.off("report:updated", onUpdate);
    };
  }, [report.id, loadTrace]);

  useEffect(() => {
    setUpvotes(report.upvotes);
    setHasUpvoted(report.has_upvoted ?? false);
  }, [report.id, report.upvotes, report.has_upvoted]);

  const loadMessages = useCallback(async () => {
    if (userId === null) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    try {
      setMessages(await api.reports.messages(report.id));
      setChatError(null);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not load report messages.");
    } finally {
      setMessagesLoading(false);
    }
  }, [report.id, userId]);

  useEffect(() => {
    if (userId === null) return;
    const joinRoom = () => {
      socket.emit("report:join", report.id, (result) => {
        if (!result.ok) setChatError(result.error || "Could not join report chat.");
      });
    };
    const onMessage = (message: ReportMessage) => {
      if (message.report_id !== report.id) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    };
    socket.on("connect", joinRoom);
    socket.on("chat:message", onMessage);
    if (socket.connected) joinRoom();
    void loadMessages();
    return () => {
      socket.off("connect", joinRoom);
      socket.off("chat:message", onMessage);
      socket.emit("report:leave", report.id);
    };
  }, [report.id, userId, loadMessages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageBody.trim();
    if (!body || sendingMessage) return;
    setSendingMessage(true);
    setChatError(null);
    try {
      const message = await api.reports.sendMessage(report.id, body);
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      setMessageBody("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not send this message.");
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleUpvote() {
    setUpvoteError(null);
    if (!user) {
      setUpvoteError("Sign in to upvote this report.");
      return;
    }

    setUpvoting(true);
    try {
      await api.reports.upvote(report.id);
      setUpvotes((count) => count + 1);
      setHasUpvoted(true);
      onUpvoted(report.id);
    } catch (error) {
      setUpvoteError(error instanceof Error ? error.message : "Could not upvote this report.");
    } finally {
      setUpvoting(false);
    }
  }

  return (
    <aside className="report-detail-sheet absolute inset-x-3 bottom-3 z-[1000] max-h-[72%] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#012667] md:inset-y-4 md:left-auto md:right-4 md:w-[380px] md:max-h-none">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-[#012667]/95">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">SolveKey Incident #{report.id}</p>
        <button
          aria-label="Close report details"
          className="grid size-8 place-items-center rounded-lg text-lg leading-none text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#0241A3]"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="space-y-5 p-5">
        {report.image_url && !photoError ? (
          <img
            alt={`Photo for ${reportCategoryLabel(report.category).toLowerCase()} report`}
            className="report-detail-image h-44 w-full rounded-2xl bg-slate-100 object-cover dark:bg-slate-800"
            loading="lazy"
            onError={() => setPhotoError(true)}
            src={report.image_url}
          />
        ) : (
          <div className="grid h-28 place-items-center rounded-2xl bg-[#E7F9FB] text-xs font-semibold text-[#075B67] dark:bg-[#0241A3] dark:text-[#05D7E5]">
            Photo not attached
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-[#012667] dark:text-white">{reportCategoryLabel(report.category)}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${severityClass(report.severity)}`}>
              {report.severity === null ? "Severity Pending" : `Severity ${report.severity}/5`}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{report.description || "Issue description is being prepared."}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Assigned department: <span className="font-semibold text-[#012667] dark:text-slate-200">{report.department_name || "Awaiting assignment"}</span>
          </p>
          <div className="mt-3.5 flex items-center justify-between gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700 dark:bg-[#0241A3] dark:text-slate-200">
              {statusName(report.status)}
            </span>
            <button
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-xs font-bold text-[#012667] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
              disabled={upvoting || hasUpvoted}
              onClick={() => void handleUpvote()}
              type="button"
            >
              <span aria-hidden="true" className="text-[#05D7E5]">▲</span>
              {hasUpvoted ? "Upvoted" : "Upvote"} <span className="tabular-nums font-mono">{upvotes}</span>
            </button>
          </div>
          {upvoteError && (
            <p className="mt-2 text-xs text-red-700" role="alert">
              {upvoteError} {!user && <Link className="font-semibold underline" href="/login">Sign in</Link>}
            </p>
          )}
        </div>

        <section aria-labelledby="ai-trace-title">
          <div className="flex items-center justify-between">
            <h3 id="ai-trace-title" className="font-semibold text-ink">AI trace</h3>
            {traceLoading && <span className="text-xs text-slate-500">Updating…</span>}
          </div>
          {traceError && (
            <div className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-800" role="alert">
              <p>{traceError}</p>
              <button className="mt-1 font-semibold underline" onClick={() => void loadTrace()} type="button">Retry</button>
            </div>
          )}
          {!traceLoading && !traceError && trace.length === 0 && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">AI analysis has not started yet.</p>
          )}
          {trace.length > 0 && (
            <ol className="mt-4 space-y-0">
              {trace.map((entry, index) => (
                <li className="relative flex gap-3 pb-4 last:pb-0" key={`${entry.agent_name}-${entry.created_at}-${index}`}>
                  {index < trace.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-emerald-100" aria-hidden="true" />}
                  <span className={`relative z-[1] mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                    entry.agent_name === "Orchestrator" ? "bg-red-100 text-red-700" : "bg-mint text-forest"
                  }`}>
                    <span className="size-1.5 rounded-full bg-current" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">{stepTitle(entry.agent_name)}</p>
                    <p className="mt-1 break-words text-xs leading-5 text-slate-600">{stepSummary(entry)}</p>
                    <time className="mt-1 block text-[10px] text-slate-400" dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="report-chat-title">
          <div className="flex items-center justify-between">
            <h3 id="report-chat-title" className="font-semibold text-ink">Report conversation</h3>
            {messagesLoading && <span className="text-xs text-slate-500">Loading…</span>}
          </div>
          {!user ? (
            <p className="mt-2 text-sm text-slate-600">
              <Link className="font-semibold text-forest underline" href="/login">Sign in</Link> to message the reporter or assigned department.
            </p>
          ) : (
            <>
              {chatError && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{chatError}</p>}
              <ol className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3" aria-live="polite">
                {!messages.length && !messagesLoading && (
                  <li className="text-xs text-slate-500">No messages yet. Only the reporter, assigned department, and admins can access this conversation.</li>
                )}
                {messages.map((message) => (
                  <li className="rounded-lg bg-white p-2.5 text-xs" key={message.id}>
                    <p className="font-semibold text-ink">{message.sender_name}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{message.body}</p>
                    <time className="mt-1 block text-[10px] text-slate-400" dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
              <form className="mt-3 space-y-2" onSubmit={(event) => void sendMessage(event)}>
                <label className="sr-only" htmlFor={`message-${report.id}`}>Message about this report</label>
                <textarea
                  id={`message-${report.id}`}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-leaf"
                  maxLength={4000}
                  onChange={(event) => setMessageBody(event.target.value)}
                  placeholder="Write a message to the report participants…"
                  rows={2}
                  value={messageBody}
                />
                <button className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={!messageBody.trim() || sendingMessage} type="submit">
                  {sendingMessage ? "Sending…" : "Send message"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
