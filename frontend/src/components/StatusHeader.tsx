import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Check, Circle, Clock } from "lucide-react";

import { CONNECTION, TEXT } from "../lib/theme";
import { PreferencesPopover } from "./PreferencesPopover";
import { StatusBadge, type SessionStatus } from "./ui/StatusBadge";
import type { Preferences } from "../lib/prefs";
import type { WSStatus } from "../hooks/useEventStream";

/** Live counters derived from the WS stream (spec §4.2). */
export interface LiveCounters {
  readonly match: number;
  readonly mismatch: number;
  readonly orphan: number;
}

/** Props for `<StatusHeader>`. */
export interface StatusHeaderProps {
  /** WebSocket transport status. */
  readonly wsStatus: WSStatus;
  /**
   * `Date.now()` ms when the WebSocket will next attempt to reconnect,
   * or `null` if no reconnect is scheduled. Drives the live countdown
   * shown while `wsStatus === "closed"`.
   */
  readonly nextReconnectAt: number | null;
  /** Session lifecycle status. */
  readonly sessionStatus: SessionStatus;
  /** Real-time counters. */
  readonly counters: LiveCounters;
  /** Backend version (from `/api/health`), or `null` while loading / on failure. */
  readonly version: string | null;
  /** Current user preferences. */
  readonly preferences: Preferences;
  /** Called when preferences change in the popover. */
  readonly onPreferencesChange: (next: Preferences) => void;
}

/**
 * Sticky `h-12` header described in spec §4.2. Left: wordmark.
 * Center: connection dot + session status badge. Right cluster: live
 * counters, backend version, preferences popover.
 */
export function StatusHeader(props: StatusHeaderProps): JSX.Element {
  return (
    <header
      className={`sticky top-0 z-20 flex h-12 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900 px-4 ${TEXT.primary}`}
    >
      <Wordmark />
      <div className="flex flex-1 items-center justify-center gap-3">
        <ConnectionIndicator status={props.wsStatus} nextReconnectAt={props.nextReconnectAt} />
        <StatusBadge state={props.sessionStatus} />
      </div>
      <div className="flex items-center gap-3">
        <Counters counters={props.counters} />
        {props.version !== null ? (
          <span className={`hidden sm:inline-block text-xs font-mono ${TEXT.muted}`}>
            v{props.version}
          </span>
        ) : null}
        <PreferencesPopover value={props.preferences} onChange={props.onPreferencesChange} />
      </div>
    </header>
  );
}

function Wordmark(): JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <Activity className="h-4 w-4 text-indigo-400" aria-hidden />
      <span className={`text-lg font-semibold tracking-tight ${TEXT.primary}`}>ssediff</span>
    </span>
  );
}

interface ConnectionIndicatorProps {
  readonly status: WSStatus;
  readonly nextReconnectAt: number | null;
}

function ConnectionIndicator({ status, nextReconnectAt }: ConnectionIndicatorProps): JSX.Element {
  const cfg = CONNECTION[status];
  const label = useReconnectLabel(status, cfg.label, nextReconnectAt);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
      <Circle className={`h-2.5 w-2.5 ${cfg.dot}`} aria-hidden />
      <span className={TEXT.secondary}>{label}</span>
    </span>
  );
}

/**
 * For `closed` + scheduled reconnect, returns "Disconnected — retrying
 * in Ns…". For all other states, returns the base label.
 */
function useReconnectLabel(status: WSStatus, base: string, nextReconnectAt: number | null): string {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (status !== "closed" || nextReconnectAt === null) {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [status, nextReconnectAt]);
  if (status !== "closed" || nextReconnectAt === null) {
    return base;
  }
  const remainSec = Math.max(0, Math.ceil((nextReconnectAt - now) / 1_000));
  return `Disconnected — retrying in ${remainSec}s`;
}

interface CountersProps {
  readonly counters: LiveCounters;
}

function Counters({ counters }: CountersProps): JSX.Element {
  return (
    <span className="hidden md:inline-flex items-center gap-3 text-xs tabular-nums">
      <CounterCell icon={<Check className="h-3.5 w-3.5" aria-hidden />} count={counters.match} colorClass="text-emerald-400" label="Matches" />
      <CounterCell icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />} count={counters.mismatch} colorClass="text-rose-400" label="Mismatches" />
      <CounterCell icon={<Clock className="h-3.5 w-3.5" aria-hidden />} count={counters.orphan} colorClass="text-amber-400" label="Orphans" />
    </span>
  );
}

interface CounterCellProps {
  readonly icon: JSX.Element;
  readonly count: number;
  readonly colorClass: string;
  readonly label: string;
}

function CounterCell({ icon, count, colorClass, label }: CounterCellProps): JSX.Element {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (count === 0) {
      return;
    }
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 150);
    return () => window.clearTimeout(t);
  }, [count]);
  const display = count > 999 ? "999+" : String(count);
  const transform = pulse ? "scale-110" : "scale-100";
  return (
    <span className={`inline-flex items-center gap-1 ${colorClass} transition-transform duration-150 ${transform}`} aria-label={`${label}: ${display}`}>
      {icon}
      <span>{display}</span>
    </span>
  );
}
