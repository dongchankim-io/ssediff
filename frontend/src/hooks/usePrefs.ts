import { useCallback, useState } from "react";

import { loadPreferences, savePreferences, type Preferences } from "../lib/prefs";

/**
 * Synchronous initial read from `localStorage` + state setter that persists on
 * every update (spec §4.2 — no first-paint flicker; spec implementer §3 Slice 009).
 */
export function usePrefs(): {
  readonly preferences: Preferences;
  readonly setPreferences: (next: Preferences) => void;
} {
  const [preferences, setState] = useState<Preferences>(() => loadPreferences());

  const setPreferences = useCallback((next: Preferences) => {
    setState(next);
    savePreferences(next);
  }, []);

  return { preferences, setPreferences };
}
