import { ACCENT, SURFACE, TEXT } from "./lib/theme";

/**
 * Slice 001 skeleton App. Renders only the wordmark and a small
 * "build wiring works" line so the rest of the toolchain (Vite, Tailwind,
 * fonts, Docker, /api/health) can be exercised end-to-end before the full
 * three-zone layout lands in Slice 009.
 */
export function App(): JSX.Element {
  return (
    <div
      data-testid="app-skeleton"
      className={`${SURFACE.appBg} ${TEXT.primary} flex h-screen w-screen flex-col items-center justify-center gap-3`}
    >
      <div className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <span className={ACCENT.text}>●</span>
        <span>ssediff</span>
      </div>
      <p className={`${TEXT.secondary} text-sm`}>
        Scaffold ready. Backend, frontend, and Docker pipelines are wired.
      </p>
    </div>
  );
}
