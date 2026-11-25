"use client";

import { useEffect, useRef, useState } from "react";

export const CHAT_SUGGESTIONS = [
  "How can I report a civic issue?",
  "Show nearby reported issues",
  "What should I report as urgent?",
  "Track my recent reports",
  "How does AI analyze my report?",
];

export type ChatImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ChatImageAttachment {
  imageBase64: string;
  mediaType: ChatImageMediaType;
  previewUrl: string;
  fileName: string;
}

const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const CHAT_IMAGE_TYPES = new Set<ChatImageMediaType>(["image/jpeg", "image/png", "image/webp"]);

function isChatImageType(value: string): value is ChatImageMediaType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export async function prepareChatImage(file: File): Promise<ChatImageAttachment> {
  if (!isChatImageType(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (!file.size) throw new Error("Choose an image that is not empty.");
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("Images must be 5 MB or smaller.");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("This image could not be read. Please choose another file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("This image could not be read. Please choose another file."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("This image has an unsupported format.");

  return {
    imageBase64: dataUrl.slice(separator + 1),
    mediaType: file.type,
    previewUrl: URL.createObjectURL(file),
    fileName: file.name,
  };
}

export function ChatSuggestionChips({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (question: string) => void;
}) {
  return (
    <div aria-label="Suggested questions" className="chat-suggestions" role="group">
      {suggestions.map((question) => (
        <button
          className="chat-suggestion"
          key={question}
          onClick={() => onSelect(question)}
          type="button"
        >
          <span>{question}</span>
          <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
            <path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function ChatImagePreview({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const triggerButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      triggerButton.current?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        aria-label={`Enlarge image: ${alt}`}
        className={`chat-image-trigger ${className}`}
        onClick={() => setIsOpen(true)}
        ref={triggerButton}
        type="button"
      >
        <img alt={alt} className="chat-image" src={src} />
      </button>
      {isOpen && (
        <div
          aria-label="Image preview"
          aria-modal="true"
          className="chat-image-lightbox"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          role="dialog"
        >
          <button
            aria-label="Close image preview"
            className="chat-image-close"
            onClick={() => setIsOpen(false)}
            ref={closeButton}
            type="button"
          >
            ×
          </button>
          <img alt={alt} className="chat-image-expanded" src={src} />
        </div>
      )}
    </>
  );
}

export function ChatAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ChatImageAttachment;
  onRemove: () => void;
}) {
  return (
    <div className="chat-attachment-preview">
      <ChatImagePreview
        alt={attachment.fileName}
        className="chat-attachment-thumb"
        src={attachment.previewUrl}
      />
      <span className="chat-attachment-name">{attachment.fileName}</span>
      <button
        aria-label="Remove attached image"
        className="chat-attachment-remove"
        onClick={onRemove}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
