import { PILL, STATE_ICON, STATE_PILL_CLASSES } from "../../lib/theme";
import type { ResultKind } from "../../lib/wire";

/** Props for `<StatePill>`. */
export interface StatePillProps {
  /** Result kind to render. */
  kind: ResultKind;
}

/**
 * State pill that combines color (background), icon, and uppercase text
 * label — color is redundant with icon + text per spec §4.6 a11y.
 */
export function StatePill({ kind }: StatePillProps): JSX.Element {
  const Icon = STATE_ICON[kind];
  const colorClass = STATE_PILL_CLASSES[kind];
  return (
    <span className={`${PILL.base} ${colorClass}`} data-kind={kind}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{kind}</span>
    </span>
  );
}
