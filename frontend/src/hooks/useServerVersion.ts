import { useEffect, useState } from "react";

/**
 * Fires a single `GET /api/health` on mount and exposes the backend
 * version string for the header chrome. Returns `null` until the
 * response arrives, or on failure (the UI then hides the version).
 */
export function useServerVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/health", { signal: ac.signal });
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as { version?: unknown };
        if (mounted && typeof body.version === "string") {
          setVersion(body.version);
        }
      } catch {
        /* ignore — degrade silently */
      }
    })();
    return () => {
      mounted = false;
      ac.abort();
    };
  }, []);
  return version;
}
