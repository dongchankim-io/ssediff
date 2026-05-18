/**
 * Wire protocol types — the TypeScript mirror of `backend/internal/engine`.
 *
 * This file is the **single source of truth on the frontend** for the
 * shape of JSON traveling over `/ws` and `/api/*`. It must stay byte-for-
 * byte aligned with spec §3.5; if you change one side, change both.
 *
 * Only protocol shapes live here — never styling, color maps, or icons
 * (those belong in `lib/theme.ts`). This separation keeps the protocol
 * module dependency-free and trivially auditable.
 */

/** Identifies which upstream SSE feed produced an event. */
export type StreamSource = "A" | "B";

/** Outcome of comparing two events keyed on (eventType, correlationId). */
export type ResultKind = "MATCH" | "MISMATCH" | "ORPHAN";

/**
 * A single side of a paired or orphaned result. `rawJson` is the exact
 * payload string the upstream SSE feed emitted in its `data:` field —
 * the UI is responsible for pretty-printing before passing it to the
 * diff viewer (`react-diff-viewer-continued`).
 */
export interface WireStreamPayload {
  source: StreamSource;
  rawJson: string;
  /** ISO-8601 UTC with millisecond precision, e.g. `2026-05-17T12:34:56.789Z`. */
  receivedAt: string;
}

/**
 * Discriminated union over the three possible result kinds. For MATCH and
 * MISMATCH both `a` and `b` are present. For ORPHAN exactly one of `a`
 * / `b` is present (the other is omitted from the wire).
 *
 * Always narrow via `switch (result.kind)`; never use `any` or `!`.
 */
export type WireResult =
  | {
      kind: "MATCH";
      eventType: string;
      correlationId: string;
      timestamp: string;
      a: WireStreamPayload;
      b: WireStreamPayload;
    }
  | {
      kind: "MISMATCH";
      eventType: string;
      correlationId: string;
      timestamp: string;
      a: WireStreamPayload;
      b: WireStreamPayload;
    }
  | {
      kind: "ORPHAN";
      eventType: string;
      correlationId: string;
      timestamp: string;
      a?: WireStreamPayload;
      b?: WireStreamPayload;
    };

/** Per-stream configuration in a `POST /api/session/start` body. */
export interface SessionStreamConfig {
  url: string;
  headers: Record<string, string>;
}

/** Request body for `POST /api/session/start`. */
export interface SessionRequest {
  streamA: SessionStreamConfig;
  streamB: SessionStreamConfig;
  correlationPath: string;
}

/** Backend stats endpoint payload. */
export interface ServerStats {
  matchCount: number;
  mismatchCount: number;
  orphanCount: number;
  bufferedItems: number;
  uptimeSeconds: number;
  activeWsClients: number;
}

/** Health endpoint payload. */
export interface HealthResponse {
  status: "ok";
  version: string;
}

/**
 * Helper for compile-time exhaustiveness checks in `switch` statements.
 * Reaching this function at runtime means a new `ResultKind` was added
 * without updating every consumer — TypeScript will flag the omission at
 * compile time.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(value)}`);
}
