"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";
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

type ConnectionState = "checking" | "online" | "offline" | "connected" | "error";

function AssistantAvatar({ small = false }: { small?: boolean }) {
  return (
    <img
      alt=""
      className={small ? "size-7 object-contain" : "size-9 object-contain"}
      src="/solvekey-ai-assistant.svg"
    />
  );
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d="m8.5 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5l-8.6 8.6a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function FloatingAssistant() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const imageUrls = useRef(new Set<string>());

  useEffect(() => {
    const updateConnection = () => setConnection(navigator.onLine ? "online" : "offline");
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!open || minimized) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, minimized, messages, sending, error, selectedImage]);

  useEffect(() => () => {
    for (const url of imageUrls.current) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (open && !minimized && user && !authLoading) inputRef.current?.focus();
  }, [open, minimized, user, authLoading]);

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
    if (file) void selectImage(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = event.clipboardData.files[0];
    if (file) void selectImage(file);
  }

  function startNewChat() {
    releaseUnusedImages([]);
    if (selectedImage) {
      URL.revokeObjectURL(selectedImage.previewUrl);
      imageUrls.current.delete(selectedImage.previewUrl);
    }
    setSelectedImage(null);
    setMessages([]);
    setError(null);
    setImageError(null);
    setInput("");
  }

  async function sendMessage(
    event?: FormEvent<HTMLFormElement>,
    retry = false,
    suggestedQuestion?: string,
  ) {
    event?.preventDefault();
    const latestMessage = messages.at(-1);
    const content = retry ? latestMessage?.content || "" : (suggestedQuestion ?? input).trim();
    const image = retry ? latestMessage?.image ?? null : selectedImage;
    if ((!content && !image) || sending || preparingImage) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!navigator.onLine) {
      setConnection("offline");
      setError("You are offline. Reconnect to send your message to SolveKey.");
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: content || "Please describe this image.",
      ...(image ? { image } : {}),
    };
    const nextMessages: ChatMessage[] = retry
      ? messages.slice(-12)
      : [...messages, userMessage].slice(-12);
    if (!retry) {
      setMessages(nextMessages);
      releaseUnusedImages(nextMessages);
      setInput("");
      setSelectedImage(null);
    }
    setError(null);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "SolveKey AI could not answer.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {/* Floating Chat Modal */}
      <section
        id="solvekey-ai-chat-panel"
        aria-label="SolveKey AI Civic Assistant"
        aria-hidden={!open || minimized}
        inert={!open || minimized}
        className={`pointer-events-auto fixed inset-x-4 top-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-10 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-3xl border border-[#0241A3]/15 bg-white shadow-[0_24px_72px_-24px_rgba(1,38,103,0.38)] transition duration-200 dark:border-slate-800 dark:bg-[#012667] sm:inset-x-auto sm:top-auto sm:right-6 sm:h-[min(600px,calc(100dvh-11rem))] sm:w-[min(410px,calc(100vw-2rem))] lg:bottom-[5.5rem] lg:h-[min(600px,calc(100dvh-9rem))] ${
          open && !minimized ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#0241A3] bg-[#012667] px-4 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <img alt="" className="size-9 object-contain" src="/solvekey-ai-assistant.svg" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-[-0.01em] text-white">SolveKey AI</h2>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-blue-100/80">
                <span className={`size-1.5 rounded-full ${connection === "offline" ? "bg-[#DC4C4C]" : "bg-[#0BD58A]"}`} />
                {connection === "offline" ? "Offline · Civic Assistant" : "Online · Civic Assistant"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5]"
                onClick={startNewChat}
                type="button"
              >
                Reset
              </button>
            )}
            <button
              aria-label="Minimize SolveKey AI chat"
              className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5]"
              onClick={() => {
                setMinimized(true);
                launcherRef.current?.focus();
              }}
              title="Minimize chat"
              type="button"
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
                <path d="M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </button>
            <button
              aria-label="Close assistant"
              className="grid size-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5]"
              onClick={() => {
                setOpen(false);
                setMinimized(false);
                launcherRef.current?.focus();
              }}
              title="Close chat"
              type="button"
            >
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
            </button>
          </div>
        </header>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto bg-[#F8FAFD] p-4 text-xs leading-relaxed dark:bg-[#0D1728]" aria-live="polite">
          <div className="mb-4 flex items-start gap-2.5">
            <AssistantAvatar small />
            <div className="rounded-2xl rounded-tl-sm border border-[#7CB3DD]/35 bg-white p-3 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-[#0241A3]/40 dark:text-slate-200">
              <p className="font-bold text-[#012667] dark:text-[#05D7E5]">
                Greetings{user?.name ? `, ${user.name.split(" ")[0]}` : ""}!
              </p>
              <p className="mt-1 leading-relaxed">
                I’m your SolveKey civic intelligence assistant. Inquire regarding municipal issue status, local department responsibilities, or filing reports.
              </p>
            </div>
          </div>

          {!messages.length && (
            <div className="mb-4 ml-9">
              <ChatSuggestionChips
                onSelect={(question) => void sendMessage(undefined, false, question)}
                suggestions={CHAT_SUGGESTIONS}
              />
            </div>
          )}

          {messages.map((message, index) => (
            <div
              className={`mb-3 flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              key={`${index}-${message.role}`}
            >
              {message.role === "assistant" && <AssistantAvatar small />}
              <div
                className={`max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${
                  message.role === "user"
                    ? "rounded-br-sm bg-gradient-to-br from-[#012667] to-[#0241A3] text-white shadow-sm"
                    : "rounded-bl-sm border border-[#7CB3DD]/35 bg-white text-[#012667] shadow-sm dark:border-slate-700 dark:bg-[#122446] dark:text-slate-100"
                }`}
              >
                {message.content}
                {message.image && (
                  <ChatImagePreview
                    alt={message.image.fileName}
                    className="mt-2"
                    src={message.image.previewUrl}
                  />
                )}
              </div>
            </div>
          ))}

          {messages.at(-1)?.role === "assistant" && !sending && (
            <div className="mb-4 ml-9">
              <ChatSuggestionChips
                onSelect={(question) => void sendMessage(undefined, false, question)}
                suggestions={CHAT_SUGGESTIONS.slice(1, 4)}
              />
            </div>
          )}

          {sending && (
            <div className="mb-3 flex items-end gap-2" role="status" aria-label="SolveKey AI is formulating a response">
              <AssistantAvatar small />
              <div className="flex h-9 items-center gap-1.5 rounded-2xl rounded-bl-sm border border-[#05D7E5]/30 bg-white px-3.5 shadow-sm dark:border-slate-700 dark:bg-[#122446]">
                <span className="eco-chat-dot" />
                <span className="eco-chat-dot eco-chat-dot-delay-1" />
                <span className="eco-chat-dot eco-chat-dot-delay-2" />
              </div>
            </div>
          )}

          {error && (
            <div
              className="mb-3 ml-9 rounded-xl border border-red-200 bg-[#FDF2F2] px-3 py-2 text-xs leading-relaxed text-[#DC4C4C] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              role="alert"
            >
              <p>{error}</p>
              {messages.at(-1)?.role === "user" && user && (
                <button
                  className="mt-1 font-bold underline"
                  onClick={() => void sendMessage(undefined, true)}
                  type="button"
                >
                  Retry query
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Bar or Auth Gate */}
        {!user && !authLoading ? (
          <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#012667]">
            <p className="mb-3 text-center text-xs text-slate-600 dark:text-slate-300">
              Sign in to initiate a session with SolveKey AI civic assistance.
            </p>
            <button
              className="w-full rounded-xl bg-[#0241A3] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#012667] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#012667]"
              onClick={() => router.push("/login")}
              type="button"
            >
              Sign in to SolveKey
            </button>
          </div>
        ) : (
          <>
            {selectedImage && (
              <div className="border-t border-slate-200 bg-white px-3 pt-3 dark:border-slate-800 dark:bg-[#012667]">
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
            <form
              className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#012667]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleImageDrop}
              onSubmit={(event) => void sendMessage(event)}
            >
              <input
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleImageChange}
                ref={imageInput}
                type="file"
              />
              <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-[#F8FAFD] p-1.5 transition focus-within:border-[#05D7E5] focus-within:ring-2 focus-within:ring-[#05D7E5]/20 dark:border-slate-700 dark:bg-[#0241A3]/50">
                <button
                  aria-label="Attach an issue image"
                  className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-[#0241A3] transition hover:bg-[#E9F9FC] hover:text-[#012667] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5] disabled:opacity-50 dark:hover:bg-[#0241A3] dark:hover:text-[#05D7E5]"
                  disabled={sending || preparingImage || authLoading}
                  onClick={() => imageInput.current?.click()}
                  title="Attach JPG, PNG, or WebP"
                  type="button"
                >
                  <PaperclipIcon />
                </button>
                <label className="sr-only" htmlFor="floating-assistant-input">
                  Message SolveKey AI
                </label>
                <textarea
                  ref={inputRef}
                  id="floating-assistant-input"
                  className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-xs text-[#012667] outline-none placeholder:text-slate-400 dark:text-white"
                  maxLength={1200}
                  onChange={(event) => setInput(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask SolveKey anything about civic services…"
                  disabled={sending || authLoading || preparingImage}
                  rows={1}
                  value={input}
                />
                <button
                  aria-label="Send message"
                  className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#04A077] text-white shadow-sm transition hover:bg-[#027A5B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05D7E5] focus-visible:ring-offset-2 disabled:opacity-40 dark:focus-visible:ring-offset-[#012667]"
                  disabled={(!input.trim() && !selectedImage) || sending || authLoading || preparingImage}
                  type="submit"
                >
                  {preparingImage || sending ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
                      <path
                        d="m5 12 14-7-4.5 14-3-5-6.5-2Z"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                      <path d="m11.5 14 4-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                    </svg>
                  )}
                </button>
              </div>
              {imageError && (
                <p className="mt-1 text-[11px] text-[#DC4C4C]" role="alert">
                  {imageError}
                </p>
              )}
            </form>
          </>
        )}
      </section>

      {/* Floating Action Button */}
      <button
        ref={launcherRef}
        aria-controls="solvekey-ai-chat-panel"
        aria-expanded={open && !minimized}
        aria-label={minimized ? "Restore SolveKey AI assistant" : open ? "Close SolveKey AI assistant" : "Open SolveKey AI assistant"}
        className="pointer-events-auto fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-20 grid size-14 place-items-center rounded-full bg-[#012667] text-white shadow-lg ring-1 ring-[#05D7E5]/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-cyan-glow dark:bg-[#012667] active:scale-95 sm:size-16 lg:bottom-6 lg:right-6"
        onClick={() => {
          if (minimized) setMinimized(false);
          else setOpen((current) => !current);
        }}
        type="button"
      >
        <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-white bg-[#0BD58A] dark:border-[#012667]" />
        {open && !minimized ? (
          <svg aria-hidden="true" className="size-5 transition-transform duration-200" fill="none" viewBox="0 0 24 24">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        ) : (
          <img alt="" className="size-11 object-contain sm:size-12" src="/solvekey-ai-assistant.svg" />
        )}
      </button>
    </div>
  );
}
