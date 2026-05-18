import { useMemo, useState } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import { Copy, GitCompare, Info } from "lucide-react";

import { StatePill } from "./ui/StatePill";
import { SURFACE, TEXT } from "../lib/theme";
import { assertNever, type StreamSource, type WireResult, type WireStreamPayload } from "../lib/wire";

/** Props for `<DiffViewer>`. */
export interface DiffViewerProps {
  /** Currently selected result, or `null` for the empty state. */
  readonly result: WireResult | null;
}

/**
 * Side-by-side comparison view implementing spec §4.5.
 *
 * - MATCH / MISMATCH: full split view through `react-diff-viewer-continued`.
 * - ORPHAN: only the present side, full-width, with an amber banner.
 * - No selection: centered `GitCompare` placeholder.
 */
export function DiffViewer({ result }: DiffViewerProps): JSX.Element {
  if (result === null) {
    return <EmptyState />;
  }
  if (result.kind === "ORPHAN") {
    return <OrphanView result={result} />;
  }
  if (result.kind === "MATCH" || result.kind === "MISMATCH") {
    return <PairedDiff result={result} />;
  }
  return assertNever(result);
}

/** Pretty-prints a JSON string, falling back to the raw bytes on parse failure. */
function prettyPrint(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

interface PairedDiffProps {
  readonly result: Extract<WireResult, { kind: "MATCH" | "MISMATCH" }>;
}

function PairedDiff({ result }: PairedDiffProps): JSX.Element {
  const pretty = useMemo(
    () => ({
      a: prettyPrint(result.a.rawJson),
      b: prettyPrint(result.b.rawJson),
    }),
    [result.a.rawJson, result.b.rawJson],
  );
  return (
    <div className="flex h-full flex-col">
      <DiffHeader result={result} />
      <div className="flex-1 overflow-auto">
        <ReactDiffViewer
          oldValue={pretty.a}
          newValue={pretty.b}
          splitView
          useDarkTheme
          leftTitle="Stream A"
          rightTitle="Stream B"
        />
      </div>
    </div>
  );
}

interface OrphanViewProps {
  readonly result: Extract<WireResult, { kind: "ORPHAN" }>;
}

function OrphanView({ result }: OrphanViewProps): JSX.Element {
  const presentPayload = result.a ?? result.b;
  if (presentPayload === undefined) {
    return <EmptyState />;
  }
  const missingFrom: StreamSource = presentPayload.source === "A" ? "B" : "A";
  return (
    <div className="flex h-full flex-col">
      <DiffHeader result={result} />
      <OrphanBanner missingFrom={missingFrom} />
      <div className="flex-1 overflow-auto">
        <SingleSidePane payload={presentPayload} />
      </div>
    </div>
  );
}

interface OrphanBannerProps {
  readonly missingFrom: StreamSource;
}

function OrphanBanner({ missingFrom }: OrphanBannerProps): JSX.Element {
  return (
    <div
      role="status"
      className="mx-6 mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <span>No counterpart from Stream {missingFrom} within the TTL window.</span>
    </div>
  );
}

interface SingleSidePaneProps {
  readonly payload: WireStreamPayload;
}

function SingleSidePane({ payload }: SingleSidePaneProps): JSX.Element {
  const pretty = useMemo(() => prettyPrint(payload.rawJson), [payload.rawJson]);
  return (
    <pre
      className={`m-6 max-h-full overflow-auto rounded-md border ${SURFACE.cardBorder} bg-slate-950 p-4 text-xs leading-relaxed text-slate-200 font-mono`}
    >
      <code>{pretty}</code>
    </pre>
  );
}

interface DiffHeaderProps {
  readonly result: WireResult;
}

function DiffHeader({ result }: DiffHeaderProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopyId = async (): Promise<void> => {
    const ok = await copyText(result.correlationId);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    }
  };
  return (
    <header
      className={`flex flex-wrap items-center gap-3 px-6 py-3 ${SURFACE.cardBg} border-b ${SURFACE.cardBorder} border-x-0 border-t-0`}
    >
      <StatePill kind={result.kind} />
      <span className={`font-mono text-sm ${TEXT.primary} truncate`} title={result.eventType}>
        {result.eventType}
      </span>
      <span className="flex items-center gap-1">
        <span className={`font-mono text-xs ${TEXT.secondary}`}>id={result.correlationId}</span>
        <button
          type="button"
          onClick={() => void onCopyId()}
          aria-label="Copy correlation ID"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
        </button>
        {copied ? (
          <span className="text-xs text-emerald-400" role="status">
            Copied
          </span>
        ) : null}
      </span>
      <span className={`ml-auto font-mono text-xs tabular-nums ${TEXT.muted}`}>
        {formatTimestamp(result.timestamp)}
      </span>
    </header>
  );
}

/** HH:mm:ss.SSS (UTC). Defensive against malformed timestamps. */
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

/**
 * Copies `text` to the user's clipboard. Uses the modern async API when
 * available, falls back to a hidden `<textarea>` + `execCommand("copy")`
 * for legacy / insecure-context fallbacks. Returns `false` on failure.
 */
async function copyText(text: string): Promise<boolean> {
  const navClipboard =
    typeof navigator !== "undefined" && navigator.clipboard !== undefined
      ? navigator.clipboard
      : null;
  if (navClipboard !== null) {
    try {
      await navClipboard.writeText(text);
      return true;
    } catch {
      /* fall through to legacy path */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function EmptyState(): JSX.Element {
  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-3 px-6 text-center ${SURFACE.cardBg}`}
    >
      <GitCompare className="h-10 w-10 text-slate-600" aria-hidden />
      <p className={`max-w-sm text-sm ${TEXT.secondary}`}>
        Select a row from the ledger to inspect the diff.
      </p>
    </div>
  );
}
