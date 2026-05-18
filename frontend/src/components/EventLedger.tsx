import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Activity, ArrowDown } from "lucide-react";

import { StatePill } from "./ui/StatePill";
import { SURFACE, TEXT } from "../lib/theme";
import type { ResultKind, WireResult } from "../lib/wire";

/** Mutually-exclusive ledger filter mode (spec §4.4). */
export type LedgerFilter = "all" | "mismatches" | "orphans";

/** Stable identifier of a row in the ledger; passed to the parent on selection. */
export interface LedgerSelection {
  readonly key: string;
  readonly result: WireResult;
}

/** Props for `<EventLedger>`. */
export interface EventLedgerProps {
  /** Source-of-truth ring buffer from the WS hook. Latest event is last. */
  readonly history: ReadonlyArray<WireResult>;
  /** Currently selected row key (or null when nothing is selected). */
  readonly selectedKey: string | null;
  /** Fired when the user picks a row. Pass `null` to clear selection. */
  readonly onSelect: (selection: LedgerSelection | null) => void;
  /** When true, applies the compact row padding from the preferences popover. */
  readonly compact?: boolean;
  /** When true (default), shows the Event Type column. */
  readonly showEventType?: boolean;
}

/** Spec §4.4 row key: stable across re-renders, unique per logical event. */
function makeKey(r: WireResult): string {
  return `${r.kind}:${r.correlationId}:${r.timestamp}`;
}

/** HH:mm:ss.SSS formatter. Defensive against invalid timestamps. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "--:--:--.---";
  }
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  const ms = d.getUTCMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Max anomaly announcements per second (spec §4.6). */
const MAX_ANNOUNCEMENTS_PER_SEC = 4;

/**
 * Announces new MISMATCH / ORPHAN rows to screen readers, throttled to
 * avoid spamming (spec §4.6 `aria-live="polite"`).
 */
function useThrottledAnomalyAnnounce(
  history: ReadonlyArray<WireResult>,
  liveRef: RefObject<HTMLDivElement>,
): void {
  const recentRef = useRef<number[]>([]);
  const prevLenRef = useRef<number>(history.length);

  useEffect(() => {
    if (history.length <= prevLenRef.current) {
      prevLenRef.current = history.length;
      return;
    }
    const latest = history[history.length - 1];
    prevLenRef.current = history.length;
    if (latest === undefined || (latest.kind !== "MISMATCH" && latest.kind !== "ORPHAN")) {
      return;
    }
    const now = Date.now();
    const windowMs = 1000;
    recentRef.current = recentRef.current.filter((t) => now - t < windowMs);
    if (recentRef.current.length >= MAX_ANNOUNCEMENTS_PER_SEC) {
      return;
    }
    recentRef.current = [...recentRef.current, now];
    const el = liveRef.current;
    if (el !== null) {
      el.textContent = `${latest.kind} ${latest.eventType} correlation ${latest.correlationId}`;
    }
  }, [history, liveRef]);
}

/** Predicate used by the filter toggles. */
function passesFilter(kind: ResultKind, f: LedgerFilter): boolean {
  if (f === "all") {
    return true;
  }
  if (f === "mismatches") {
    return kind === "MISMATCH";
  }
  return kind === "ORPHAN";
}

/**
 * High-throughput event ledger implementing spec §4.4.
 *
 * - Displays newest-on-top.
 * - Filters are client-side, mutually exclusive (`all` / `mismatches` /
 *   `orphans`).
 * - Never auto-scrolls. When new rows arrive while the user is scrolled
 *   away from the top, shows a "↓ N new" pill that scrolls back when
 *   clicked.
 * - Each row uses `React.memo` to avoid re-rendering siblings on every
 *   new event (the stable `key` from `makeKey` does the rest).
 */
export function EventLedger({
  history,
  selectedKey,
  onSelect,
  compact = false,
  showEventType = true,
}: EventLedgerProps): JSX.Element {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const filtered = useMemo(() => history.filter((r) => passesFilter(r.kind, filter)), [history, filter]);

  const containerRef = useRef<HTMLDivElement>(null);
  const previousLengthRef = useRef<number>(filtered.length);
  const [pendingNew, setPendingNew] = useState<number>(0);

  const isPinnedToBottom = (el: HTMLDivElement): boolean => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
  };

  useEffect(() => {
    const delta = filtered.length - previousLengthRef.current;
    previousLengthRef.current = filtered.length;
    if (delta <= 0) {
      return;
    }
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    if (isPinnedToBottom(el)) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    setPendingNew((n) => Math.min(n + delta, 999));
  }, [filtered.length]);

  const scrollToBottom = (): void => {
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPendingNew(0);
  };

  const onScroll = (): void => {
    const el = containerRef.current;
    if (el !== null && isPinnedToBottom(el) && pendingNew > 0) {
      setPendingNew(0);
    }
  };

  const handleRowSelect = useCallback(
    (r: WireResult): void => {
      const key = makeKey(r);
      if (key === selectedKey) {
        onSelect(null);
        return;
      }
      onSelect({ key, result: r });
    },
    [selectedKey, onSelect],
  );

  const liveAnnounceRef = useRef<HTMLDivElement>(null);
  useThrottledAnomalyAnnounce(history, liveAnnounceRef);

  return (
    <div
      className={`${SURFACE.cardBg} flex h-full flex-col border-r ${SURFACE.cardBorder} border-y-0 border-l-0`}
    >
      <div ref={liveAnnounceRef} className="sr-only" aria-live="polite" aria-atomic="true" />
      <LedgerToolbar filter={filter} onChange={setFilter} count={filtered.length} />
      <div ref={containerRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto">
        {renderBody({
          history,
          filtered,
          selectedKey,
          compact,
          showEventType,
          onRowSelect: handleRowSelect,
        })}
        {pendingNew > 0 ? <NewRowsPill count={pendingNew} onClick={scrollToBottom} /> : null}
      </div>
    </div>
  );
}

interface LedgerBodyArgs {
  readonly history: ReadonlyArray<WireResult>;
  readonly filtered: ReadonlyArray<WireResult>;
  readonly selectedKey: string | null;
  readonly compact: boolean;
  readonly showEventType: boolean;
  readonly onRowSelect: (r: WireResult) => void;
}

function renderBody(args: LedgerBodyArgs): JSX.Element {
  if (args.history.length === 0) {
    return <LedgerEmptyState variant="idle" />;
  }
  if (args.filtered.length === 0) {
    return <LedgerEmptyState variant="filtered" />;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-[1] bg-slate-900/95 backdrop-blur">
        <tr className={`text-left text-xs uppercase tracking-wide ${TEXT.muted}`}>
          <th scope="col" className="px-3 py-2 font-medium">
            Time
          </th>
          {args.showEventType ? (
            <th scope="col" className="px-3 py-2 font-medium">
              Event
            </th>
          ) : null}
          <th scope="col" className="px-3 py-2 font-medium">
            Correlation ID
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            State
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {args.filtered.map((r) => {
          const key = makeKey(r);
          return (
            <LedgerRow
              key={key}
              rowKey={key}
              result={r}
              selected={key === args.selectedKey}
              compact={args.compact}
              showEventType={args.showEventType}
              onSelect={args.onRowSelect}
            />
          );
        })}
      </tbody>
    </table>
  );
}

interface LedgerToolbarProps {
  readonly filter: LedgerFilter;
  readonly onChange: (f: LedgerFilter) => void;
  readonly count: number;
}

function LedgerToolbar({ filter, onChange, count }: LedgerToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Ledger filters"
      className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-3 py-2 backdrop-blur"
    >
      <div className="flex items-center gap-1" aria-label="Filter">
        <FilterChip current={filter} value="all" label="All" onChange={onChange} />
        <FilterChip current={filter} value="mismatches" label="Mismatches only" onChange={onChange} />
        <FilterChip current={filter} value="orphans" label="Orphans only" onChange={onChange} />
      </div>
      <span className={`tabular-nums text-xs ${TEXT.muted}`}>{count}</span>
    </div>
  );
}

interface FilterChipProps {
  readonly current: LedgerFilter;
  readonly value: LedgerFilter;
  readonly label: string;
  readonly onChange: (f: LedgerFilter) => void;
}

function FilterChip({ current, value, label, onChange }: FilterChipProps): JSX.Element {
  const active = current === value;
  const base = "px-2 py-1 text-xs rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";
  const cls = active ? `${base} bg-slate-800 text-slate-100` : `${base} text-slate-400 hover:text-slate-200`;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(value)}
      className={cls}
    >
      {label}
    </button>
  );
}

interface LedgerRowProps {
  readonly rowKey: string;
  readonly result: WireResult;
  readonly selected: boolean;
  readonly compact: boolean;
  readonly showEventType: boolean;
  readonly onSelect: (r: WireResult) => void;
}

const LedgerRow = memo(function LedgerRow({
  rowKey,
  result,
  selected,
  compact,
  showEventType,
  onSelect,
}: LedgerRowProps): JSX.Element {
  const padding = compact ? "py-1" : "py-2";
  const selectedClass = selected ? SURFACE.rowSelected : SURFACE.rowHoverClass;

  const activate = (): void => {
    onSelect(result);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  return (
    <tr
      tabIndex={0}
      data-rowkey={rowKey}
      onClick={activate}
      onKeyDown={onKeyDown}
      className={`cursor-pointer transition-colors duration-150 ${selectedClass} animate-fadeIn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40`}
      aria-selected={selected}
    >
      <td className={`tabular-nums px-3 font-mono text-xs ${TEXT.muted} ${padding}`}>
        {formatTimestamp(result.timestamp)}
      </td>
      {showEventType ? (
        <td className={`max-w-[8rem] truncate px-3 text-sm ${TEXT.primary} ${padding}`}>
          {result.eventType}
        </td>
      ) : null}
      <td className={`max-w-[12rem] truncate px-3 font-mono text-xs ${TEXT.secondary} ${padding}`}>
        {result.correlationId}
      </td>
      <td className={`px-3 ${padding}`}>
        <StatePill kind={result.kind} />
      </td>
    </tr>
  );
});

interface LedgerEmptyStateProps {
  readonly variant: "idle" | "filtered";
}

function LedgerEmptyState({ variant }: LedgerEmptyStateProps): JSX.Element {
  if (variant === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Activity className="h-8 w-8 text-slate-600" aria-hidden />
        <p className={`max-w-sm text-sm ${TEXT.secondary}`}>
          Configure two SSE endpoints above and click <strong>Start Assessment</strong> to begin comparing live streams.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className={`text-sm ${TEXT.secondary}`}>No events match the current filter.</p>
    </div>
  );
}

interface NewRowsPillProps {
  readonly count: number;
  readonly onClick: () => void;
}

function NewRowsPill({ count, onClick }: NewRowsPillProps): JSX.Element {
  const label = count >= 999 ? "999+ new" : `${count} new`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-200 shadow-md transition-colors hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
    >
      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
