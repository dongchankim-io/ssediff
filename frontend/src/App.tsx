import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfigBar } from "./components/ConfigBar";
import { DiffViewer } from "./components/DiffViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EventLedger, type LedgerSelection } from "./components/EventLedger";
import { OnboardingCard } from "./components/OnboardingCard";
import { SplitPane } from "./components/SplitPane";
import { StatusHeader, type LiveCounters } from "./components/StatusHeader";
import type { SessionStatus } from "./components/ui/StatusBadge";
import { useEventStream } from "./hooks/useEventStream";
import { usePrefs } from "./hooks/usePrefs";
import { useServerVersion } from "./hooks/useServerVersion";
import {
  hasSeenOnboarding,
  loadLedgerWidth,
  markOnboardingSeen,
} from "./lib/prefs";
import { SURFACE, TEXT } from "./lib/theme";
import type { WireResult } from "./lib/wire";

/**
 * Top-level layout composition for ssediff (spec §4.2).
 *
 * Owns: WS stream subscription, session lifecycle, user preferences,
 * ledger selection, layout dimensions. Delegates rendering to its three
 * children: `StatusHeader`, `ConfigBar`, and the resizable
 * `EventLedger` + `DiffViewer` pair.
 */
export function App(): JSX.Element {
  const stream = useEventStream();
  const version = useServerVersion();

  const { preferences, setPreferences } = usePrefs();
  const [ledgerWidth, setLedgerWidth] = useState<number>(() => loadLedgerWidth());
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !hasSeenOnboarding());

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [selection, setSelection] = useState<LedgerSelection | null>(null);

  const counters = useMemo<LiveCounters>(() => deriveCounters(stream.history), [stream.history]);

  const handleSelect = useCallback((s: LedgerSelection | null): void => {
    setSelection(s);
  }, []);

  const dismissOnboarding = useCallback((): void => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  useEffect(() => {
    if (sessionStatus !== "live") {
      return;
    }
    if (stream.status === "closed") {
      setSessionStatus("error");
    }
  }, [stream.status, sessionStatus]);

  return (
    <div className={`flex h-screen w-screen flex-col ${SURFACE.appBg} ${TEXT.primary}`}>
      <StatusHeader
        wsStatus={stream.status}
        nextReconnectAt={stream.nextReconnectAt}
        sessionStatus={sessionStatus}
        counters={counters}
        version={version}
        preferences={preferences}
        onPreferencesChange={setPreferences}
      />
      {showOnboarding ? <OnboardingCard onDismiss={dismissOnboarding} /> : null}
      <ConfigBar
        sessionStatus={sessionStatus}
        onSessionStarted={() => setSessionStatus("live")}
        onSessionStopped={() => setSessionStatus("stopped")}
      />
      <main className="flex-1 min-h-0">
        <SplitPane
          leftWidth={ledgerWidth}
          onLeftWidthChange={setLedgerWidth}
          left={
            <aside aria-label="Event ledger" className="h-full min-h-0">
              <ErrorBoundary label="Event ledger">
                <EventLedger
                  history={stream.history}
                  selectedKey={selection?.key ?? null}
                  onSelect={handleSelect}
                  compact={preferences.compact}
                  showEventType={preferences.showEventType}
                />
              </ErrorBoundary>
            </aside>
          }
          right={
            <section aria-label="Event payload diff" className="h-full min-h-0 min-w-0">
              <ErrorBoundary label="Diff viewer">
                <DiffViewer result={selection?.result ?? null} />
              </ErrorBoundary>
            </section>
          }
        />
      </main>
    </div>
  );
}

/** Counts results by kind across the entire history ring buffer. */
function deriveCounters(history: ReadonlyArray<WireResult>): LiveCounters {
  let match = 0;
  let mismatch = 0;
  let orphan = 0;
  for (const r of history) {
    if (r.kind === "MATCH") {
      match += 1;
    } else if (r.kind === "MISMATCH") {
      mismatch += 1;
    } else {
      orphan += 1;
    }
  }
  return { match, mismatch, orphan };
}
