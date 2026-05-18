/**
 * Centralized design tokens for ssediff.
 *
 * Every color, surface, and motion class used in the UI comes from this
 * module. Components must import named constants here rather than spell out
 * Tailwind utility strings or hex values inline. See spec §4.2.
 *
 * `STATE_PILL_CLASSES` and `STATE_ICON` (added in Slice 002) live at the
 * bottom of this file — they require `ResultKind` from `lib/wire.ts`.
 */

import { AlertTriangle, Check, Clock, type LucideIcon } from "lucide-react";
import type { ResultKind } from "./wire";

export const SURFACE = {
  appBg: "bg-slate-950",
  cardBg: "bg-slate-900",
  cardBorder: "border border-slate-800",
  rowHover: "bg-slate-800/60",
  rowSelected: "bg-slate-800 ring-1 ring-indigo-500/40",
  divider: "border-slate-800",
} as const;

export const TEXT = {
  primary: "text-slate-100",
  secondary: "text-slate-400",
  muted: "text-slate-500",
  inverted: "text-slate-900",
} as const;

export const ACCENT = {
  bg: "bg-indigo-500",
  bgHover: "hover:bg-indigo-400",
  text: "text-indigo-400",
  ring: "focus-visible:ring-2 focus-visible:ring-indigo-500/40",
} as const;

/**
 * Semantic color classes for matching/diff outcomes. Each entry is a record
 * of complete Tailwind utility classes so consumers compose by named field
 * (e.g. `SEMANTIC.match.bg`) — never by string interpolation, which would
 * defeat Tailwind's content scanner and silently strip the class in prod.
 */
export const SEMANTIC = {
  match: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    dot: "text-emerald-400",
    ring: "ring-emerald-500/40",
  },
  mismatch: {
    bg: "bg-rose-600/10",
    border: "border-rose-600/30",
    text: "text-rose-300",
    dot: "text-rose-400",
    ring: "ring-rose-600/40",
  },
  orphan: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-300",
    dot: "text-amber-400",
    ring: "ring-amber-500/40",
  },
  info: {
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
    text: "text-sky-300",
    dot: "text-sky-400",
    ring: "ring-sky-500/40",
  },
} as const;

export const CONNECTION = {
  connecting: {
    dot: "text-amber-400 animate-pulse fill-current",
    label: "Connecting…",
  },
  open: {
    dot: "text-emerald-400 fill-current",
    label: "Live",
  },
  closed: {
    dot: "text-rose-400 fill-current",
    label: "Disconnected",
  },
} as const;

export const SESSION_BADGE = {
  idle: "bg-slate-800 text-slate-300",
  live: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  stopped: "bg-slate-700 text-slate-200",
  error: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
} as const;

export const BUTTON = {
  base:
    "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium " +
    "transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 " +
    "disabled:opacity-40 disabled:cursor-not-allowed",
  primary: "bg-indigo-500 hover:bg-indigo-400 text-white",
  danger: "bg-rose-600 hover:bg-rose-500 text-white",
  ghost: "text-slate-300 hover:bg-slate-800",
} as const;

export const INPUT = {
  base:
    "w-full rounded-md border bg-slate-950 px-3 py-2 text-sm text-slate-100 " +
    "placeholder:text-slate-500 transition-colors duration-150 " +
    "focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
  borderIdle: "border-slate-700 focus:border-indigo-500",
  borderError: "border-rose-500 focus:border-rose-500",
  label: "text-xs font-medium text-slate-400 uppercase tracking-wide",
  errorText: "text-rose-400 text-xs flex items-center gap-1",
} as const;

export const PILL = {
  base:
    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide",
} as const;

/**
 * Per-`ResultKind` pill classes. Each value is a complete utility-class
 * string (literal substring) so Tailwind's content scanner retains the
 * classes in the production CSS bundle.
 *
 * MATCH/MISMATCH/ORPHAN use solid backgrounds per spec §4.4 — these are
 * the one place in the UI where color is loud, intentionally.
 */
export const STATE_PILL_CLASSES: Record<ResultKind, string> = {
  MATCH: "bg-emerald-500 text-white",
  MISMATCH: "bg-rose-600 text-white",
  ORPHAN: "bg-amber-500 text-black",
};

/**
 * Per-`ResultKind` icon mapping. Color is never the sole signal — every
 * pill pairs the color class above with one of these icons and a textual
 * label (spec §4.6 a11y).
 */
export const STATE_ICON: Record<ResultKind, LucideIcon> = {
  MATCH: Check,
  MISMATCH: AlertTriangle,
  ORPHAN: Clock,
};
