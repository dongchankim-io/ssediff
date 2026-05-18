/**
 * Thin REST helpers for the backend's HTTP control plane.
 *
 * Every non-2xx response is normalised into an `ApiError` whose
 * `.message` is either the backend's structured `{error: "..."}` field
 * or, as a fallback, the bare HTTP status. Callers display
 * `error.message` inline; they never inspect status codes directly.
 *
 * Network failures (DNS, offline, CORS) propagate as the original
 * `TypeError` so the UI can distinguish them from server-rejected
 * requests if needed.
 */
import type { ServerStats, SessionRequest } from "./wire";

/** Thrown for any non-2xx response from the backend. */
export class ApiError extends Error {
  /** HTTP status code returned by the server. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Body returned by a successful `POST /api/session/start`. */
export interface StartSessionResponse {
  /** Opaque server-side session identifier. Useful for log correlation. */
  sessionId: string;
}

/** Issues `POST /api/session/start`. Throws `ApiError` on 4xx/5xx. */
export async function startSession(req: SessionRequest): Promise<StartSessionResponse> {
  const res = await fetch("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  return (await res.json()) as StartSessionResponse;
}

/** Issues `POST /api/session/stop`. Throws `ApiError` on 4xx/5xx. */
export async function stopSession(): Promise<void> {
  const res = await fetch("/api/session/stop", { method: "POST" });
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
}

/** Issues `GET /api/stats`. Throws `ApiError` on non-2xx. */
export async function fetchStats(): Promise<ServerStats> {
  const res = await fetch("/api/stats");
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }
  return (await res.json()) as ServerStats;
}

/**
 * Reads `{error: "..."}` from a non-2xx response. Falls back to the HTTP
 * status when the body is empty or not valid JSON (e.g. an HTML 405 from
 * the static handler).
 */
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`;
}
