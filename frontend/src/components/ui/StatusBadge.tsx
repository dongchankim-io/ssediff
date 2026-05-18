import { SESSION_BADGE } from "../../lib/theme";

/** Possible session lifecycle states surfaced in the header badge. */
export type SessionStatus = "idle" | "live" | "stopped" | "error";

const LABEL: Record<SessionStatus, string> = {
  idle: "Idle",
  live: "Live",
  stopped: "Stopped",
  error: "Error",
};

/** Props for `<StatusBadge>`. */
export interface StatusBadgeProps {
  /** Current session lifecycle state. */
  state: SessionStatus;
  /** Optional override label (otherwise derived from `state`). */
  label?: string;
}

/**
 * Pill-style badge that surfaces the session lifecycle in the page
 * header. Color comes from `SESSION_BADGE` per spec §4.2; the text
 * label is always rendered so color is never the sole signal.
 */
export function StatusBadge({ state, label }: StatusBadgeProps): JSX.Element {
  const classes = SESSION_BADGE[state];
  const text = label ?? LABEL[state];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium uppercase tracking-wide ${classes}`}
      data-state={state}
    >
      {text}
    </span>
  );
}
