import { useEffect, useMemo, useRef, useState } from "react";
import type { WireResult } from "../lib/wire";

/**
 * Maximum number of historical results retained in the ring buffer. Per
 * spec §4.4, older events are dropped silently.
 */
const MAX_HISTORY = 2000;

/**
 * Jittered exponential backoff parameters. Mirror the backend SSE
 * client (spec §3.3) so the whole system has one consistent retry
 * curve.
 */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_JITTER = 0.2;

/** Three-state WebSocket lifecycle status. */
export type WSStatus = "connecting" | "open" | "closed";

/** Stable shape returned by useEventStream. */
export interface EventStream {
  readonly status: WSStatus;
  readonly last: WireResult | null;
  readonly history: ReadonlyArray<WireResult>;
  /**
   * `Date.now()` ms when the next reconnect attempt will fire — or
   * `null` when no reconnect is currently scheduled (open or before
   * first close). The status header uses this to render a live
   * "Reconnecting in Ns…" countdown per spec §4.2.
   */
  readonly nextReconnectAt: number | null;
}

/**
 * `useEventStream` owns the application's single WebSocket connection
 * to `/ws`. Auto-reconnects with jittered exponential backoff
 * (1 s → 30 s cap, ±20 %), maintains a 2000-item ring buffer of past
 * results, and surfaces the live connection status.
 *
 * The returned object is memoized — its identity is stable across
 * renders when none of `status`, `last`, or `history` have changed.
 */
export function useEventStream(): EventStream {
  const [status, setStatus] = useState<WSStatus>("connecting");
  const [last, setLast] = useState<WireResult | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<WireResult>>([]);
  const [nextReconnectAt, setNextReconnectAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(BACKOFF_INITIAL_MS);

  useEffect(() => {
    let mounted = true;

    const scheduleReconnect = (): void => {
      if (!mounted) {
        return;
      }
      const base = backoffRef.current;
      const jitter = base * BACKOFF_JITTER * (2 * Math.random() - 1);
      const waitMs = Math.max(0, base + jitter);
      setNextReconnectAt(Date.now() + waitMs);
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!mounted) {
          return;
        }
        backoffRef.current = Math.min(base * 2, BACKOFF_MAX_MS);
        setNextReconnectAt(null);
        connect();
      }, waitMs);
    };

    const handleMessage = (raw: string): void => {
      let parsed: WireResult;
      try {
        parsed = JSON.parse(raw) as WireResult;
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null || typeof parsed.kind !== "string") {
        return;
      }
      setLast(parsed);
      setHistory((prev) => {
        const next = prev.length >= MAX_HISTORY ? prev.slice(prev.length - MAX_HISTORY + 1) : prev.slice();
        next.push(parsed);
        return next;
      });
    };

    const connect = (): void => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = (): void => {
        if (!mounted) {
          return;
        }
        backoffRef.current = BACKOFF_INITIAL_MS;
        setNextReconnectAt(null);
        setStatus("open");
      };
      ws.onmessage = (event: MessageEvent): void => {
        if (!mounted) {
          return;
        }
        if (typeof event.data === "string") {
          handleMessage(event.data);
        }
      };
      ws.onclose = (): void => {
        if (!mounted) {
          return;
        }
        setStatus("closed");
        scheduleReconnect();
      };
      // `onerror` is intentionally a no-op: the browser always fires
      // an `onclose` after `onerror`, and the close path drives the
      // reconnect, so listening here would either duplicate effort or
      // race the close handler.
    };

    connect();

    return (): void => {
      mounted = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws !== null) {
        ws.close();
        wsRef.current = null;
      }
    };
  }, []);

  return useMemo<EventStream>(
    () => ({ status, last, history, nextReconnectAt }),
    [status, last, history, nextReconnectAt],
  );
}
