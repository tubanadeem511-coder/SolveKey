import { apiBaseUrl } from "./api-base-url";

export interface AuthUser {
  id: number;
  name: string;
  email?: string;
  role: string;
  points: number;
  level?: string;
  department_id?: number | null;
  badges?: Badge[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  name: string;
}

export type ReportStatus = "reported" | "in_progress" | "resolved";

export interface Report {
  id: number;
  report_number?: string;
  user_id?: number;
  image_url?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
  category: string | null;
  severity: number | null;
  status: string;
  description: string | null;
  summary?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  duplicate_of?: number | null;
  upvotes: number;
  has_upvoted?: boolean;
  created_at: string;
}

export interface SubmittedReport extends Report {
  report_number: string;
}

export interface TrackedReport {
  report_number: string;
  issue: string;
  description: string | null;
  summary: string | null;
  category: string | null;
  location: string;
  status: string;
  created_at: string;
  updated_at: string;
  department_name: string | null;
}

export interface Department {
  id: number;
  name: string;
}

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: "citizen" | "department" | "admin";
  department_id: number | null;
}

export interface CategoryStat {
  category: string;
  count: number;
}

export interface DashboardStats {
  open: number;
  resolved: number;
  average_severity: number;
  by_category: CategoryStat[];
  departments: Department[];
}

export interface AgentLog {
  agent_name: string;
  input: unknown;
  output: unknown;
  created_at: string;
}

export interface CreateReportInput {
  lat: number;
  lng: number;
  address?: string;
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  points: number;
  level: string;
}

export interface Badge {
  code: string;
  name: string;
  description: string;
  earned_at?: string;
}

export interface ReportMessage {
  id: number;
  report_id: number;
  sender_user_id: number;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface Recommendation extends Report {
  distance_m: number;
  reason: string;
}

export interface Reward {
  id: number;
  name: string;
  description: string;
  points_cost: number;
  stock: number | null;
  active?: boolean;
}

export interface RewardRedemption {
  id: number;
  reward_id?: number;
  user_id?: number;
  name?: string;
  reward_name?: string;
  user_name?: string;
  user_email?: string;
  points_spent: number;
  status: "pending" | "fulfilled" | "cancelled";
  created_at: string;
  updated_at?: string;
}

export interface AssistantImageInput {
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
}

interface ApiErrorBody {
  error?: unknown;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function getErrorMessage(body: ApiErrorBody, fallback: string): string {
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "fieldErrors" in body.error) {
    const fieldErrors = body.error.fieldErrors;
    if (fieldErrors && typeof fieldErrors === "object") {
      const messages = Object.values(fieldErrors).flatMap((value) =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
      );
      if (messages.length) return messages.join(" ");
    }
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(`Cannot reach the server at ${apiBaseUrl}`, 0);
    }
    throw error;
  }

  const responseText = await response.text();
  let body: unknown;
  try {
    body = responseText ? JSON.parse(responseText) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const apiBody = body && typeof body === "object" ? body as ApiErrorBody : {};
    const message = response.status === 429
      ? "Too many attempts, please wait a few minutes"
      : response.status >= 500
        ? "Server error, please try again"
        : getErrorMessage(apiBody, `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  auth: {
    login: (input: LoginInput) =>
      request<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
    register: (input: RegisterInput) =>
      request<AuthUser>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
    session: () => request<{ user: AuthUser | null }>("/api/auth/session"),
    me: () => request<AuthUser>("/api/auth/me"),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    staff: () => request<{ users: StaffUser[]; departments: Department[] }>("/api/auth/staff"),
    updateStaff: (id: number, role: StaffUser["role"], department_id: number | null) =>
      request<StaffUser>(`/api/auth/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, department_id }),
      }),
  },
  reports: {
    list: (filters?: { departmentId?: number; category?: string; status?: string; query?: string }) => {
      const params = new URLSearchParams();
      if (filters?.departmentId !== undefined) params.set("department_id", String(filters.departmentId));
      if (filters?.category) params.set("category", filters.category);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.query?.trim()) params.set("q", filters.query.trim());
      const suffix = params.size ? `?${params.toString()}` : "";
      return request<Report[]>(`/api/reports${suffix}`);
    },
    mine: () => request<Report[]>("/api/reports/mine"),
    create: (input: CreateReportInput) =>
      request<SubmittedReport>("/api/reports", { method: "POST", body: JSON.stringify(input) }),
    track: (reportNumber: string) =>
      request<TrackedReport>(`/api/reports/track/${encodeURIComponent(reportNumber)}`),
    trace: (id: number) => request<AgentLog[]>(`/api/reports/${id}/trace`),
    messages: (id: number) => request<ReportMessage[]>(`/api/reports/${id}/messages`),
    sendMessage: (id: number, body: string) =>
      request<ReportMessage>(`/api/reports/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    upvote: (id: number) =>
      request<{ ok: true }>(`/api/reports/${id}/upvote`, { method: "POST" }),
    updateStatus: (id: number, status: ReportStatus) =>
      request<{ ok: true }>(`/api/reports/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    leaderboard: () => request<LeaderboardEntry[]>("/api/reports/leaderboard/top"),
  },
  stats: {
    get: (departmentId?: number) => {
      const query = departmentId === undefined
        ? ""
        : `?department_id=${encodeURIComponent(departmentId)}`;
      return request<DashboardStats>(`/api/stats${query}`);
    },
  },
  assistant: {
    chat: (
      messages: { role: "user" | "assistant"; content: string }[],
      image?: AssistantImageInput,
    ) =>
      request<{ answer: string }>("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ messages, ...(image ? image : {}) }),
      }),
    recommendations: () =>
      request<{ items: Recommendation[]; message?: string }>("/api/assistant/recommendations"),
  },
  notifications: {
    list: () => request<Notification[]>("/api/notifications"),
    markRead: (id: number) =>
      request<{ id: number; read_at: string }>(`/api/notifications/${id}/read`, { method: "PATCH" }),
    markAllRead: () =>
      request<{ ok: true; updated: number }>("/api/notifications/read-all", { method: "PATCH" }),
  },
  rewards: {
    list: () => request<Reward[]>("/api/rewards"),
    mine: () => request<RewardRedemption[]>("/api/rewards/mine"),
    create: (input: Pick<Reward, "name" | "description" | "points_cost" | "stock">) =>
      request<Reward>("/api/rewards", { method: "POST", body: JSON.stringify(input) }),
    redeem: (id: number) =>
      request<RewardRedemption>(`/api/rewards/${id}/redeem`, { method: "POST" }),
    redemptions: () => request<RewardRedemption[]>("/api/rewards/redemptions"),
    updateRedemption: (id: number, status: "fulfilled" | "cancelled") =>
      request<{ id: number; status: RewardRedemption["status"] }>(`/api/rewards/redemptions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
  },
};
