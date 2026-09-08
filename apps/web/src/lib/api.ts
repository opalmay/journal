import type { DayDTO, DayDetailDTO, RecordDTO, TagDTO } from "@journal/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Only a JSON body gets the JSON content-type. FormData sets its own (with
  // the multipart boundary), and a bodyless DELETE/POST must send none at all —
  // Fastify rejects an empty body declared as application/json.
  const isJsonBody = init.body !== undefined && !(init.body instanceof FormData);

  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: isJsonBody
      ? { "content-type": "application/json", ...init.headers }
      : init.headers,
  });

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : response.statusText;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

export interface RecordPage {
  records: RecordDTO[];
  nextCursor: string | null;
}

export interface Settings {
  timeZone: string;
  aiEnabled: boolean;
  aiModels: { title: string; day: string };
  maxUploadBytes: number;
  webhookPath: string;
  webhookTokenSet: boolean;
  storage: { files: number; bytes: number };
  jobs: Record<string, number>;
}

export interface RecordFilters {
  from?: string;
  to?: string;
  tag?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

function queryString(filters: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const api = {
  me: () => request<{ authenticated: boolean; configured: boolean }>("/api/auth/me"),
  login: (password: string) =>
    request<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  records: (filters: RecordFilters = {}) =>
    request<RecordPage>(`/api/records${queryString({ ...filters })}`),
  createRecord: (body: FormData | { text: string; tags: string[]; timestamp?: number }) =>
    request<RecordDTO>("/api/records", {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  updateRecord: (
    id: string,
    patch: { text?: string; title?: string | null; tags?: string[]; timestamp?: number },
  ) => request<RecordDTO>(`/api/records/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRecord: (id: string) => request<void>(`/api/records/${id}`, { method: "DELETE" }),
  regenerateRecord: (id: string) =>
    request<{ queued: boolean }>(`/api/records/${id}/regenerate`, { method: "POST" }),

  days: (from: string, to: string) => request<{ days: DayDTO[] }>(`/api/days${queryString({ from, to })}`),
  day: (date: string) => request<DayDetailDTO>(`/api/days/${date}`),
  updateDay: (
    date: string,
    patch: {
      mood?: number | null;
      note?: string | null;
      title?: string | null;
      tags?: string[];
    },
  ) => request<DayDTO>(`/api/days/${date}`, { method: "PATCH", body: JSON.stringify(patch) }),
  regenerateDay: (date: string) =>
    request<{ queued: boolean }>(`/api/days/${date}/regenerate`, { method: "POST" }),

  tags: () => request<{ tags: TagDTO[] }>("/api/tags"),
  settings: () => request<Settings>("/api/settings"),
};
