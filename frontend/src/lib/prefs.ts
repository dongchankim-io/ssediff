/**
 * `localStorage`-backed user preferences (spec §4.2).
 *
 * The helpers in this module are synchronous so the initial state can be
 * read inside a `useState` initializer (`useState(() => loadPrefs())`)
 * — that's the trick spec §4.2 calls out as "loaded synchronously before
 * first paint to avoid flicker".
 *
 * All reads are defensive: a corrupt or partial blob falls back to the
 * default values without throwing.
 */

/** Storage key holding the JSON-encoded preferences blob. */
export const STORAGE_KEY_PREFS = "ssediff:prefs";

/** Storage key holding the ledger-pane width in pixels (raw integer). */
export const STORAGE_KEY_LEDGER_WIDTH = "ssediff:ledgerWidth";

/** Storage key flagging that the user has dismissed the onboarding card. */
export const STORAGE_KEY_HAS_SEEN_ONBOARDING = "ssediff:hasSeenOnboarding";

/** Persisted user preferences. */
export interface Preferences {
  /** Compact mode: reduces ledger row padding `py-2 → py-1`. */
  readonly compact: boolean;
  /** Show the Event Type column in the ledger. */
  readonly showEventType: boolean;
}

const DEFAULT_PREFS: Preferences = {
  compact: false,
  showEventType: true,
};

/** Default ledger pane width (px). */
export const DEFAULT_LEDGER_WIDTH = 420;
/** Minimum allowed ledger width (px). */
export const MIN_LEDGER_WIDTH = 320;
/** Maximum allowed ledger width (px). */
export const MAX_LEDGER_WIDTH = 720;

/** Reads `Preferences` from localStorage; returns defaults on any failure. */
export function loadPreferences(): Preferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    if (raw === null) {
      return DEFAULT_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      compact: typeof parsed.compact === "boolean" ? parsed.compact : DEFAULT_PREFS.compact,
      showEventType:
        typeof parsed.showEventType === "boolean" ? parsed.showEventType : DEFAULT_PREFS.showEventType,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Persists `Preferences`. Silent on quota / serialization failure. */
export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
  } catch {
    /* quota exceeded, private mode, etc. — preferences degrade to in-memory only */
  }
}

/** Reads the persisted ledger width, clamped to the documented range. */
export function loadLedgerWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_LEDGER_WIDTH;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LEDGER_WIDTH);
    if (raw === null) {
      return DEFAULT_LEDGER_WIDTH;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_LEDGER_WIDTH;
    }
    return clampLedgerWidth(parsed);
  } catch {
    return DEFAULT_LEDGER_WIDTH;
  }
}

/** Persists the ledger width. */
export function saveLedgerWidth(px: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_LEDGER_WIDTH, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

/** Clamps an arbitrary number to the documented ledger-width range. */
export function clampLedgerWidth(px: number): number {
  if (px < MIN_LEDGER_WIDTH) {
    return MIN_LEDGER_WIDTH;
  }
  if (px > MAX_LEDGER_WIDTH) {
    return MAX_LEDGER_WIDTH;
  }
  return px;
}

/** Returns `true` if the user has dismissed the onboarding card before. */
export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY_HAS_SEEN_ONBOARDING) !== null;
  } catch {
    return true;
  }
}

/** Persists the onboarding-dismissed flag. */
export function markOnboardingSeen(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_HAS_SEEN_ONBOARDING, "1");
  } catch {
    /* ignore */
  }
}
