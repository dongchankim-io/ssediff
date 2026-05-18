import { Sparkles, X } from "lucide-react";

import { SURFACE, TEXT } from "../lib/theme";

/** Props for `<OnboardingCard>`. */
export interface OnboardingCardProps {
  readonly onDismiss: () => void;
}

/**
 * First-visit tip card shown above the ConfigBar until the user
 * dismisses it (spec §4.2). Dismissal is persistent across sessions.
 */
export function OnboardingCard({ onDismiss }: OnboardingCardProps): JSX.Element {
  return (
    <aside
      className={`mx-6 mt-4 flex items-start gap-3 rounded-lg ${SURFACE.cardBg} ${SURFACE.cardBorder} px-4 py-3`}
      aria-label="Welcome tip"
    >
      <Sparkles className="h-5 w-5 mt-0.5 shrink-0 text-indigo-400" aria-hidden />
      <div className="flex-1 text-sm">
        <p className={TEXT.primary}>
          <strong>Welcome to ssediff.</strong>{" "}
          <span className={TEXT.secondary}>
            Point this tool at two SSE endpoints that emit the same events, and we&apos;ll align
            them by your chosen correlation ID and surface mismatches in real time.
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss welcome tip"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
