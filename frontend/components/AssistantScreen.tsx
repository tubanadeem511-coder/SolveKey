"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent } from "react";
import { AccessGate } from "./AccessGate";
import { api } from "../lib/api";
import type { Recommendation } from "../lib/api";
import { reportCategoryLabel } from "../lib/report-categories";
import { useAuth } from "./AuthProvider";
import {
  CHAT_SUGGESTIONS,
  ChatAttachmentPreview,
  ChatImagePreview,
  ChatSuggestionChips,
  prepareChatImage,
} from "./ChatSuggestions";
import type { ChatImageAttachment } from "./ChatSuggestions";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  image?: ChatImageAttachment;
}

export function AssistantScreen() {
  const { user, loading } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationMessage, setRecommendationMessage] = useState<string | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [myReportCount, setMyReportCount] = useState<number | null>(null);
  const [myReportsError, setMyReportsError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const imageUrls = useRef(new Set<string>());

  const loadRecommendations = useCallback(async () => {
    try {
      const result = await api.assistant.recommendations();
      setRecommendations(result.items);
      setRecommendationMessage(result.message ?? null);
      setRecommendationError(null);
    } catch (error) {
      setRecommendationError(error instanceof Error ? error.message : "Could not load recommendations.");
    }
  }, []);

  const loadMyReportCount = useCallback(async () => {
    try {
      const reports = await api.reports.mine();
      setMyReportCount(reports.length);
      setMyReportsError(null);
    } catch (error) {
      setMyReportsError(error instanceof Error ? error.message : "Could not load your report count.");
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadRecommendations();
      void loadMyReportCount();
    }
  }, [user, loadRecommendations, loadMyReportCount]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => () => {
    for (const url of imageUrls.current) URL.revokeObjectURL(url);
  }, []);

  function releaseUnusedImages(keep: ChatMessage[]) {
    const retained = new Set(keep.flatMap((message) => (message.image ? [message.image.previewUrl] : [])));
    for (const url of imageUrls.current) {
      if (!retained.has(url)) {
        URL.revokeObjectURL(url);
        imageUrls.current.delete(url);
      }
    }
  }

  async function selectImage(file?: File) {
    if (!file) return;
    setImageError(null);
    setPreparingImage(true);
    try {
      const nextImage = await prepareChatImage(file);
      if (selectedImage) {
        URL.revokeObjectURL(selectedImage.previewUrl);
        imageUrls.current.delete(selectedImage.previewUrl);
      }
      imageUrls.current.add(nextImage.previewUrl);
      setSelectedImage(nextImage);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : "Could not attach this image.");
    } finally {
      setPreparingImage(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    void selectImage(event.target.files?.[0]);
  }

  function handleImageDrop(event: DragEvent<HTMLFormElement>) {
    if (event.dataTransfer.files.length) event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    void selectImage(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const file = event.clipboardData.files[0];
    if (file) void selectImage(file);
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>, suggestedQuestion?: string, retry = false) {
    event?.preventDefault();
    const latestMessage = messages.at(-1);
    const content = retry ? latestMessage?.content ?? "" : (suggestedQuestion ?? input).trim();
    const image = retry ? latestMessage?.image ?? null : selectedImage;
    if ((!content && !image) || sending || preparingImage) return;

    const userContent = content || "Please describe this image.";
    const nextMessages: ChatMessage[] = retry
      ? messages.slice(-12)
      : [...messages, { role: "user" as const, content: userContent, ...(image ? { image } : {}) }].slice(-12);
    if (!retry) {
      setMessages(nextMessages);
      releaseUnusedImages(nextMessages);
      setInput("");
      setSelectedImage(null);
    }
    setChatError(null);
    setImageError(null);
    setSending(true);
    try {
      const result = await api.assistant.chat(
        nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        image ? { image_base64: image.imageBase64, media_type: image.mediaType } : undefined,
      );
      const answer: ChatMessage = { role: "assistant", content: result.answer };
      setMessages((current) => {
        const updated = [...current, answer].slice(-12);
        releaseUnusedImages(updated);
        return updated;
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "The SolveKey AI assistant could not answer.");
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    releaseUnusedImages([]);
    setMessages([]);
    setSelectedImage((current) => {
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
        imageUrls.current.delete(current.previewUrl);
      }
      return null;
    });
    setInput("");
    setChatError(null);
    setImageError(null);
  }

  if (loading) {
    return (
      <div className="dashboard-card p-12 text-center text-sm text-slate-500" role="status">
        <span className="inline-block size-5 animate-spin rounded-full border-2 border-[#05D7E5] border-t-transparent mr-2" />
        Authenticating with SolveKey…
      </div>
    );
  }

  if (!user) {
    return (
      <AccessGate
        eyebrow="Civic intelligence"
        title="Sign in to access SolveKey AI"
        description="SolveKey AI uses your civic report history and city service information to guide you toward relevant next steps."
        actionLabel="Sign in to SolveKey"
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
      {/* Primary Chat Viewport */}
      <section className="assistant-conversation flex min-h-[min(70vh,780px)] min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-[#012667] sm:p-5">
        <header className="border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#05D7E5]" />
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#075B67] dark:text-[#05D7E5]">
                  SolveKey Civic Intelligence
                </p>
              </div>
              <h1 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-[#012667] dark:text-white sm:text-2xl">
                Civic intelligence
              </h1>
            </div>
            {messages.length > 0 && (
              <button
                className="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-[#012667] transition hover:border-[#05D7E5] hover:bg-[#E7F9FB] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
                disabled={sending || preparingImage}
                onClick={startNewChat}
                type="button"
              >
                Reset Chat
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Synthesizes civic regulations, severity criteria, and departmental routing logic. Verify official determinations directly.
          </p>
        </header>

        {/* Message Thread */}
        <div
          className="my-5 flex-1 space-y-4 overflow-y-auto rounded-2xl bg-[#F8FAFC] p-3.5 sm:p-5 dark:bg-[#07162F]/60"
          aria-live="polite"
        >
          {!messages.length && (
            <div className="space-y-5 py-3">
              <div className="flex items-start gap-3.5">
                <img alt="" className="size-9 shrink-0 object-contain" src="/solvekey-ai-assistant.svg" />
                <div>
                  <p className="font-bold text-[#012667] dark:text-white">
                    Welcome to SolveKey AI Assistance
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    Ask about filing municipal reports, tracking ongoing resolutions, analyzing severity ratings, or navigating public services.
                  </p>
                </div>
              </div>
              <ChatSuggestionChips
                onSelect={(question) => void sendMessage(undefined, question)}
                suggestions={CHAT_SUGGESTIONS}
              />
            </div>
          )}

          {messages.map((message, index) => (
            <article
              className={`max-w-[88%] break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.role === "user"
                  ? "ml-auto bg-[#012667] text-white shadow-sm dark:bg-[#0241A3] assistant-user-message"
                  : "border border-slate-200/80 bg-white text-[#012667] shadow-sm dark:border-slate-700 dark:bg-[#122446] dark:text-slate-100"
              }`}
              key={`${message.role}-${index}`}
            >
              <div className="assistant-message-byline">
                {message.role === "assistant" && <img alt="" className="size-4 object-contain" src="/solvekey-ai-assistant.svg" />}
                <span>{message.role === "assistant" ? "SolveKey AI · Civic assistant" : "You"}</span>
              </div>
              <p className="assistant-message-copy">{message.content}</p>
              {message.image && (
                <ChatImagePreview
                  alt={message.image.fileName}
                  className="mt-3"
                  src={message.image.previewUrl}
                />
              )}
            </article>
          ))}

          {messages.at(-1)?.role === "assistant" && !sending && (
            <div className="pt-2">
              <ChatSuggestionChips
                onSelect={(question) => void sendMessage(undefined, question)}
                suggestions={CHAT_SUGGESTIONS.slice(1, 4)}
              />
            </div>
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400" role="status">
              <span className="size-2 rounded-full bg-[#05D7E5] animate-ping" />
              SolveKey AI is evaluating municipal context…
            </div>
          )}
          <div ref={messageEnd} />
        </div>

        {chatError && (
          <p className="mb-3 rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {chatError}
          </p>
        )}
        {messages.at(-1)?.role === "user" && chatError && (
          <button
            className="mb-3 self-start rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#012667] transition hover:bg-[#E7F9FB] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
            onClick={() => void sendMessage(undefined, undefined, true)}
            type="button"
          >
            Retry Query
          </button>
        )}

        {selectedImage && (
          <div className="mb-3">
            <ChatAttachmentPreview
              attachment={selectedImage}
              onRemove={() => {
                URL.revokeObjectURL(selectedImage.previewUrl);
                imageUrls.current.delete(selectedImage.previewUrl);
                setSelectedImage(null);
              }}
            />
          </div>
        )}
        {imageError && (
          <p className="mb-3 rounded-xl border border-red-200 bg-[#FDF2F2] px-4 py-3 text-xs text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {imageError}
          </p>
        )}

        {/* Input Bar */}
        <form
          className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleImageDrop}
          onSubmit={(event) => void sendMessage(event)}
        >
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="assistant-message">
              Your inquiry
            </label>
            <input
              id="assistant-message"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#012667] outline-none transition focus:border-[#05D7E5] focus:ring-4 focus:ring-[#05D7E5]/15 dark:border-slate-700 dark:bg-[#0241A3]/60 dark:text-white"
              maxLength={1200}
              onChange={(event) => setInput(event.target.value)}
              onPaste={handlePaste}
              disabled={sending || preparingImage}
              placeholder="Ask SolveKey regarding civic issues, reporting steps, or city departments…"
              value={input}
            />
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={handleImageChange}
              ref={imageInput}
              type="file"
            />
            <button
              aria-label="Attach an issue image"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-200 text-[#0241A3] hover:border-[#05D7E5] hover:bg-[#E7F9FB] disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0241A3]"
              disabled={sending || preparingImage}
              onClick={() => imageInput.current?.click()}
              type="button"
            >
              <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
                <path
                  d="m8.5 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5l-8.6 8.6a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            <button
              aria-label={preparingImage ? "Processing image" : sending ? "Sending message" : "Send message"}
              className="assistant-send-button sk-primary-action rounded-xl px-4 py-3 text-sm shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
              disabled={(!input.trim() && !selectedImage) || sending || preparingImage}
              type="submit"
            >
              <span>{preparingImage ? "Processing…" : sending ? "Sending…" : "Send"}</span>
              {!preparingImage && !sending && (
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 20 20">
                  <path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {selectedImage ? "Image ready for vision analysis · " : "Drop or attach photo (JPG, PNG, WebP up to 5 MB) · "}
            SolveKey AI aids civic decision-making; verify legal or emergency needs through direct dispatch.
          </p>
        </form>
      </section>

      {/* Recommendations Sidebar */}
      <aside className="assistant-context dashboard-card min-w-0 space-y-4 p-4 shadow-card dark:border-slate-800 dark:bg-[#012667]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#075B67] dark:text-[#05D7E5]">
            Civic context
          </p>
          <h2 className="mt-1 text-sm font-bold text-[#012667] dark:text-white">Your local service brief</h2>
        </div>

        <div className="assistant-context-stats">
          <div><strong>{recommendations.length}</strong><span>Nearby issues</span></div>
          <div><strong>{recommendations.filter((report) => (report.severity ?? 0) >= 4).length}</strong><span>Critical nearby</span></div>
          <div><strong>{myReportCount ?? "—"}</strong><span>Your reports</span></div>
        </div>

        <div className="assistant-quick-actions" aria-label="Civic assistant actions">
          <p>Quick actions</p>
          <Link href="/report">Report an issue <span aria-hidden="true">→</span></Link>
          <button type="button" onClick={() => void sendMessage(undefined, "Find nearby civic issues and summarize the most urgent ones.")}>Find nearby issues <span aria-hidden="true">→</span></button>
          <Link href="/profile">Check my reports <span aria-hidden="true">→</span></Link>
        </div>

        {myReportsError && <p className="text-[10px] text-red-700 dark:text-red-300" role="alert">{myReportsError}</p>}

        <div className="assistant-nearby-heading">
          <h3>Nearby reports</h3>
          <span>{recommendations.length}</span>
        </div>
        {recommendationError && (
          <p className="rounded-xl border border-red-200 bg-[#FDF2F2] p-3 text-xs text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {recommendationError}
          </p>
        )}
        {recommendationMessage && (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {recommendationMessage}
          </p>
        )}
        {!recommendations.length && !recommendationMessage && !recommendationError && (
          <p className="text-xs text-slate-500" role="status">
            Scanning for correlated neighborhood reports…
          </p>
        )}

        <ul className="space-y-3">
          {recommendations.map((report) => (
            <li
              className="rounded-2xl border border-slate-100 bg-[#F8FAFC]/60 p-4 dark:border-slate-800 dark:bg-[#0241A3]/30"
              key={report.id}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold text-[#012667] dark:text-white">
                  {reportCategoryLabel(report.category)}
                </h3>
                <span className="shrink-0 rounded-full bg-[#E7F9FB] px-2.5 py-0.5 text-[11px] font-bold text-[#075B67] dark:bg-[#103553] dark:text-[#05D7E5]">
                  Severity {report.severity ?? "—"}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {report.description || report.summary}
              </p>
              <p className="mt-2 text-[11px] font-semibold text-[#075B67] dark:text-[#05D7E5]">
                {report.reason}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">
                Status: {report.status.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Assigned department: {report.department_name || "Awaiting assignment"}
              </p>
            </li>
          ))}
        </ul>

        <button
          className="text-xs font-bold text-[#012667] underline decoration-[#05D7E5] decoration-2 underline-offset-2 hover:text-[#05D7E5] dark:text-[#05D7E5]"
          onClick={() => void loadRecommendations()}
          type="button"
        >
          Refresh Nearby Inquiries
        </button>
      </aside>
    </div>
  );
}
