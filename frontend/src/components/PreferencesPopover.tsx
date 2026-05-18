import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Settings } from "lucide-react";

import { SURFACE, TEXT } from "../lib/theme";
import type { Preferences } from "../lib/prefs";

/** Props for `<PreferencesPopover>`. */
export interface PreferencesPopoverProps {
  readonly value: Preferences;
  readonly onChange: (next: Preferences) => void;
}

/**
 * Small density & preferences popover anchored under the settings icon
 * in the status header (spec §4.2). The parent (`usePrefs`) persists each
 * toggle to `localStorage` via `onChange`.
 */
export function PreferencesPopover({ value, onChange }: PreferencesPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (popoverRef.current === null || target === null) {
        return;
      }
      if (popoverRef.current.contains(target) || buttonRef.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const update = (patch: Partial<Preferences>): void => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Preferences"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div
          ref={popoverRef}
          id={panelId}
          role="dialog"
          aria-label="Preferences"
          className={`absolute right-0 z-30 mt-2 w-64 rounded-lg shadow-lg ${SURFACE.cardBg} ${SURFACE.cardBorder} p-3`}
        >
          <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${TEXT.muted}`}>
            Density
          </h3>
          <ToggleRow
            label="Compact mode"
            description="Reduce ledger row padding"
            checked={value.compact}
            onChange={(checked) => update({ compact: checked })}
          />
          <ToggleRow
            label="Show event type"
            description="Display the event type column"
            checked={value.showEventType}
            onChange={(checked) => update({ showEventType: checked })}
          />
        </div>
      ) : null}
    </div>
  );
}

interface ToggleRowProps {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps): JSX.Element {
  const inputId = useId();
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => onChange(e.target.checked),
    [onChange],
  );
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <label htmlFor={inputId} className="flex cursor-pointer flex-col">
        <span className={`text-sm ${TEXT.primary}`}>{label}</span>
        <span className={`text-xs ${TEXT.muted}`}>{description}</span>
      </label>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      />
    </div>
  );
}
