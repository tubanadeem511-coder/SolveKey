import { io } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import type { Notification, ReportMessage } from "./api";
import { apiBaseUrl } from "./api-base-url";

export interface NewReportEvent {
  id: number;
  lat: number;
  lng: number;
}

export interface ReportUpdatedEvent {
  id: number;
  status?: "reported" | "in_progress" | "resolved" | "duplicate";
  category?: string;
  severity?: number;
  duplicate_of?: number;
  department?: string;
}

interface ServerToClientEvents {
  "report:new": (report: NewReportEvent) => void;
  "report:updated": (report: ReportUpdatedEvent) => void;
  "chat:message": (message: ReportMessage) => void;
  "notification:new": (notification: Notification) => void;
  "points:updated": (user: { id: number; points: number; level: string }) => void;
  "badge:earned": (event: { badges: string[] }) => void;
}

interface ClientToServerEvents {
  "report:join": (reportId: number, acknowledge: (result: { ok: boolean; error?: string }) => void) => void;
  "report:leave": (reportId: number) => void;
}

export const socket = io(apiBaseUrl, {
  autoConnect: false,
  withCredentials: true,
}) as ClientSocket<ServerToClientEvents, ClientToServerEvents>;
