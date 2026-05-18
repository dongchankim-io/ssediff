import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Play, Square } from "lucide-react";

import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import type { SessionStatus } from "./ui/StatusBadge";
import { ApiError, startSession, stopSession } from "../lib/api";
import {
  validateCorrelationPath,
  validateHeadersText,
  validateUrl,
  type HeadersValidationResult,
} from "../lib/validation";
import { SURFACE, TEXT } from "../lib/theme";
import type { SessionRequest } from "../lib/wire";

/** ms between a successful Start and the auto-collapse animation (spec §4.2). */
const AUTO_COLLAPSE_DELAY_MS = 3_000;

/** Props for `<ConfigBar>`. The parent owns session lifecycle state. */
export interface ConfigBarProps {
  /** Current session lifecycle. Drives auto-collapse and button enablement. */
  sessionStatus: SessionStatus;
  /** Called after a successful `POST /api/session/start`. */
  onSessionStarted: () => void;
  /** Called after a successful `POST /api/session/stop`. */
  onSessionStopped: () => void;
}

/** Internal: the full set of form state managed by `useConfigForm`. */
interface FormState {
  readonly streamAUrl: string;
  readonly streamBUrl: string;
  readonly streamAHeaders: string;
  readonly streamBHeaders: string;
  readonly correlationPath: string;
}

/** Internal: derived per-field validation errors. */
interface FormErrors {
  readonly urlA: string | null;
  readonly urlB: string | null;
  readonly path: string | null;
  readonly headersA: string | undefined;
  readonly headersB: string | undefined;
  readonly any: boolean;
}

/** Internal: setters used by ConfigBar to update the form. */
interface FormSetters {
  readonly setStreamAUrl: (v: string) => void;
  readonly setStreamBUrl: (v: string) => void;
  readonly setStreamAHeaders: (v: string) => void;
  readonly setStreamBHeaders: (v: string) => void;
  readonly setCorrelationPath: (v: string) => void;
}

/**
 * Owns ConfigBar form state + derived validation. Extracted from the
 * component to keep the visual function below the ESLint complexity
 * ceiling (15) without losing readability.
 */
function useConfigForm(): {
  readonly state: FormState;
  readonly errors: FormErrors;
  readonly setters: FormSetters;
  readonly headersA: HeadersValidationResult;
  readonly headersB: HeadersValidationResult;
} {
  const [streamAUrl, setStreamAUrl] = useState("");
  const [streamBUrl, setStreamBUrl] = useState("");
  const [streamAHeaders, setStreamAHeaders] = useState("");
  const [streamBHeaders, setStreamBHeaders] = useState("");
  const [correlationPath, setCorrelationPath] = useState("id");

  const urlA = useMemo(() => validateUrl(streamAUrl), [streamAUrl]);
  const urlB = useMemo(() => validateUrl(streamBUrl), [streamBUrl]);
  const path = useMemo(() => validateCorrelationPath(correlationPath), [correlationPath]);
  const headersA = useMemo(() => validateHeadersText(streamAHeaders), [streamAHeaders]);
  const headersB = useMemo(() => validateHeadersText(streamBHeaders), [streamBHeaders]);
  const headersAError = "error" in headersA ? headersA.error : undefined;
  const headersBError = "error" in headersB ? headersB.error : undefined;

  const errors: FormErrors = {
    urlA,
    urlB,
    path,
    headersA: headersAError,
    headersB: headersBError,
    any:
      urlA !== null ||
      urlB !== null ||
      path !== null ||
      headersAError !== undefined ||
      headersBError !== undefined,
  };

  return {
    state: { streamAUrl, streamBUrl, streamAHeaders, streamBHeaders, correlationPath },
    errors,
    setters: {
      setStreamAUrl,
      setStreamBUrl,
      setStreamAHeaders,
      setStreamBHeaders,
      setCorrelationPath,
    },
    headersA,
    headersB,
  };
}

/**
 * Three-row configuration dashboard implementing spec §4.3.
 *
 * Owns its form state (via `useConfigForm`), validates inline (mirrors
 * backend rules), and auto-collapses ~3 s after a successful Start
 * unless validation errors are present.
 */
export function ConfigBar({
  sessionStatus,
  onSessionStarted,
  onSessionStopped,
}: ConfigBarProps): JSX.Element {
  const { state, errors, setters, headersA, headersB } = useConfigForm();
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);

  const sessionActive = sessionStatus === "live";
  const isCollapsed = autoCollapsed && !errors.any && !forceExpanded;

  useEffect(() => {
    if (sessionStatus !== "live") {
      setAutoCollapsed(false);
      setForceExpanded(false);
      return;
    }
    const handle = window.setTimeout(() => setAutoCollapsed(true), AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [sessionStatus]);

  const clearBackendError = (): void => setBackendError(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (submitting || sessionActive || errors.any) {
      return;
    }
    if ("error" in headersA || "error" in headersB) {
      return;
    }
    const req: SessionRequest = {
      streamA: { url: state.streamAUrl.trim(), headers: headersA.parsed },
      streamB: { url: state.streamBUrl.trim(), headers: headersB.parsed },
      correlationPath: state.correlationPath.trim(),
    };
    setSubmitting(true);
    setBackendError(null);
    try {
      await startSession(req);
      onSessionStarted();
    } catch (err) {
      setBackendError(formatApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onStop = async (): Promise<void> => {
    if (stopping || !sessionActive) {
      return;
    }
    setStopping(true);
    try {
      await stopSession();
      onSessionStopped();
    } catch (err) {
      setBackendError(formatApiError(err));
    } finally {
      setStopping(false);
    }
  };

  const bodyId = useId();
  return (
    <section
      className={`${SURFACE.cardBg} ${SURFACE.cardBorder} border-x-0 border-t-0`}
      aria-label="Configuration"
    >
      <form aria-label="Stream configuration" onSubmit={(e) => void onSubmit(e)} className="px-6 py-4">
        <ConfigHeader
          collapsed={isCollapsed}
          bodyId={bodyId}
          onToggle={() => setForceExpanded((v) => !v)}
        />
        {isCollapsed ? (
          <CollapsedSummary url={state.streamAUrl} urlB={state.streamBUrl} path={state.correlationPath} />
        ) : (
          <ConfigFormBody
            state={state}
            errors={errors}
            setters={setters}
            submitting={submitting}
            stopping={stopping}
            sessionActive={sessionActive}
            backendError={backendError}
            onFieldEdit={clearBackendError}
            onStop={() => void onStop()}
            bodyId={bodyId}
          />
        )}
      </form>
    </section>
  );
}

interface ConfigHeaderProps {
  readonly collapsed: boolean;
  readonly bodyId: string;
  readonly onToggle: () => void;
}

function ConfigHeader({ collapsed, bodyId, onToggle }: ConfigHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className={`text-sm font-semibold ${TEXT.primary}`}>Configuration</h2>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className={`inline-flex items-center gap-1 text-xs ${TEXT.secondary} hover:text-slate-200 transition-colors`}
      >
        {collapsed ? (
          <>
            <ChevronDown className="h-4 w-4" aria-hidden />
            Expand
          </>
        ) : (
          <>
            <ChevronUp className="h-4 w-4" aria-hidden />
            Collapse
          </>
        )}
      </button>
    </div>
  );
}

interface CollapsedSummaryProps {
  readonly url: string;
  readonly urlB: string;
  readonly path: string;
}

function CollapsedSummary({ url, urlB, path }: CollapsedSummaryProps): JSX.Element {
  return (
    <div className={`flex flex-wrap gap-x-6 gap-y-1 text-xs ${TEXT.secondary} font-mono`}>
      <span>
        <span className="text-slate-500">A</span> {truncate(url)}
      </span>
      <span>
        <span className="text-slate-500">B</span> {truncate(urlB)}
      </span>
      <span>
        <span className="text-slate-500">id</span> {path || "—"}
      </span>
    </div>
  );
}

interface ConfigFormBodyProps {
  readonly state: FormState;
  readonly errors: FormErrors;
  readonly setters: FormSetters;
  readonly submitting: boolean;
  readonly stopping: boolean;
  readonly sessionActive: boolean;
  readonly backendError: string | null;
  readonly onFieldEdit: () => void;
  readonly onStop: () => void;
  readonly bodyId: string;
}

function ConfigFormBody(props: ConfigFormBodyProps): JSX.Element {
  const { state, errors, setters, submitting, stopping, sessionActive, backendError, onFieldEdit, onStop, bodyId } =
    props;
  const bind = <T,>(setter: (v: T) => void) => (v: T): void => {
    onFieldEdit();
    setter(v);
  };
  return (
    <div id={bodyId} className="grid gap-3 transition-[max-height] duration-200 ease-out">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField
          label="Stream A URL"
          value={state.streamAUrl}
          onChange={bind(setters.setStreamAUrl)}
          placeholder="https://stream-a.example.com/events"
          error={errors.urlA ?? undefined}
          mono
          focusOnMount
          type="url"
        />
        <TextField
          label="Stream A headers (JSON)"
          value={state.streamAHeaders}
          onChange={bind(setters.setStreamAHeaders)}
          placeholder='{"Authorization": "Bearer ..."}'
          error={errors.headersA}
          hint='Flat {"key":"value"} object. Empty = no headers.'
          mono
          multiline
          rows={2}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField
          label="Stream B URL"
          value={state.streamBUrl}
          onChange={bind(setters.setStreamBUrl)}
          placeholder="https://stream-b.example.com/events"
          error={errors.urlB ?? undefined}
          mono
          type="url"
        />
        <TextField
          label="Stream B headers (JSON)"
          value={state.streamBHeaders}
          onChange={bind(setters.setStreamBHeaders)}
          placeholder='{}'
          error={errors.headersB}
          hint='Flat {"key":"value"} object. Empty = no headers.'
          mono
          multiline
          rows={2}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <TextField
          label="Correlation path"
          value={state.correlationPath}
          onChange={bind(setters.setCorrelationPath)}
          placeholder="id"
          error={errors.path ?? undefined}
          hint="gjson path (e.g. id, payload.tracking.id)"
          mono
        />
        <div className="md:col-span-2 flex items-center justify-end gap-2">
          <Button
            variant="primary"
            leadingIcon={Play}
            loading={submitting}
            disabled={errors.any || sessionActive}
            type="submit"
          >
            Start Assessment
          </Button>
          <Button
            variant="danger"
            leadingIcon={Square}
            loading={stopping}
            disabled={!sessionActive}
            onClick={onStop}
          >
            Terminate Connections
          </Button>
        </div>
      </div>
      {backendError !== null ? <BackendErrorBanner message={backendError} /> : null}
    </div>
  );
}

function BackendErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <span className="font-mono break-all">{message}</span>
    </div>
  );
}

function truncate(s: string): string {
  if (s.length <= 64) {
    return s || "—";
  }
  return `${s.slice(0, 32)}…${s.slice(-24)}`;
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
