import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";

import { clampLedgerWidth, MAX_LEDGER_WIDTH, MIN_LEDGER_WIDTH, saveLedgerWidth } from "../lib/prefs";

/** Props for `<SplitPane>`. */
export interface SplitPaneProps {
  /** Current width (px) of the left pane. Controlled state lives in the parent. */
  readonly leftWidth: number;
  /** Called whenever the user resizes the divider. */
  readonly onLeftWidthChange: (px: number) => void;
  /** Left pane contents (Event Ledger). */
  readonly left: ReactNode;
  /** Right pane contents (Diff Viewer). */
  readonly right: ReactNode;
}

/**
 * Two-pane horizontal layout with a 4 px drag handle between the panes
 * (spec §4.2). State is controlled — the parent owns the width and
 * persists it via `lib/prefs.ts` when the drag ends.
 *
 * No external library; pointer events drive the resize so it works for
 * mouse, touch, and stylus uniformly.
 */
export function SplitPane({ leftWidth, onLeftWidthChange, left, right }: SplitPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) {
        return;
      }
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const px = clampLedgerWidth(e.clientX - rect.left);
      onLeftWidthChange(px);
    },
    [onLeftWidthChange],
  );

  const endDrag = useCallback(
    (px: number): void => {
      draggingRef.current = false;
      saveLedgerWidth(px);
    },
    [],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) {
      return;
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    endDrag(leftWidth);
  };

  useEffect(() => {
    return () => {
      draggingRef.current = false;
    };
  }, []);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div
        style={{ width: leftWidth }}
        className="h-full shrink-0"
      >
        {left}
      </div>
      {/*
       * `role="separator"` with `aria-orientation` and `aria-valuenow` is
       * the WAI-ARIA APG pattern for a resizable splitter
       * (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). The
       * separator IS focusable and interactive — `jsx-a11y` doesn't
       * classify it that way, so we suppress its rules here. Keyboard
       * support (Arrow Left / Right) is implemented below.
       */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        role="separator"
        aria-label="Resize ledger"
        aria-orientation="vertical"
        aria-valuemin={MIN_LEDGER_WIDTH}
        aria-valuemax={MAX_LEDGER_WIDTH}
        aria-valuenow={leftWidth}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            const next = clampLedgerWidth(leftWidth - 16);
            onLeftWidthChange(next);
            saveLedgerWidth(next);
          } else if (e.key === "ArrowRight") {
            const next = clampLedgerWidth(leftWidth + 16);
            onLeftWidthChange(next);
            saveLedgerWidth(next);
          }
        }}
        className="h-full w-1 cursor-col-resize bg-slate-800 hover:bg-indigo-500/50 transition-colors focus-visible:outline-none focus-visible:bg-indigo-500/60 select-none"
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div className="h-full flex-1 min-w-0">{right}</div>
    </div>
  );
}
