import { useEffect, useId, useRef, type ChangeEvent } from "react";
import { AlertCircle } from "lucide-react";

import { INPUT } from "../../lib/theme";

/** Common props shared by single-line and multiline variants. */
interface TextFieldCommonProps {
  /** Visible label rendered above the field (uppercase, micro-size). */
  label: string;
  /** Controlled string value. */
  value: string;
  /** Called with the new value on every change. */
  onChange: (value: string) => void;
  /** Inline placeholder. */
  placeholder?: string;
  /** When present, renders below the field as a red error and sets `aria-invalid`. */
  error?: string;
  /** Optional small helper text below the field (suppressed when `error` is set). */
  hint?: string;
  /** When true, uses JetBrains Mono — for URLs, JSON, IDs. */
  mono?: boolean;
  /** When true, disables the field. */
  disabled?: boolean;
  /**
   * Programmatically focuses the field on mount via `ref.focus()`. Used
   * instead of the native `autoFocus` attribute (blocked by
   * `jsx-a11y/no-autofocus`) to satisfy spec §4.2's "Auto-focus the
   * Stream A URL input on first mount" while keeping the lint clean.
   */
  focusOnMount?: boolean;
  /** Explicit DOM id. Auto-generated via `useId` when omitted. */
  id?: string;
}

/** Props for the single-line variant (default). */
export interface TextFieldInputProps extends TextFieldCommonProps {
  multiline?: false;
  /** Native input type — defaults to "text". */
  type?: "text" | "url";
}

/** Props for the multiline variant. */
export interface TextFieldTextareaProps extends TextFieldCommonProps {
  multiline: true;
  /** Number of visible rows. */
  rows?: number;
}

/** Discriminated union over the two variants so call sites stay strongly typed. */
export type TextFieldProps = TextFieldInputProps | TextFieldTextareaProps;

/**
 * Form input styled per spec §4.2 — uppercase label, mono-optional body,
 * inline error with lucide AlertCircle.
 *
 * Single-line by default; pass `multiline` for textarea behaviour (used
 * by the headers fields in ConfigBar).
 */
export function TextField(props: TextFieldProps): JSX.Element {
  const autoId = useId();
  const id = props.id ?? `tf-${autoId}`;
  const errorId = `${id}-error`;
  const borderClass = props.error !== undefined ? INPUT.borderError : INPUT.borderIdle;
  const monoClass = props.mono === true ? "font-mono" : "";
  const compositeClass = [INPUT.base, borderClass, monoClass].filter(Boolean).join(" ");

  const onValueChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    props.onChange(e.target.value);
  };

  const ariaInvalid = props.error !== undefined ? true : undefined;
  const ariaDescribedBy = props.error !== undefined ? errorId : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.focusOnMount !== true) {
      return;
    }
    const node = props.multiline === true ? textareaRef.current : inputRef.current;
    node?.focus();
  }, [props.focusOnMount, props.multiline]);

  return (
    <div className="block space-y-1">
      <label htmlFor={id} className={INPUT.label}>
        {props.label}
      </label>
      {props.multiline === true ? (
        <textarea
          ref={textareaRef}
          id={id}
          rows={props.rows ?? 3}
          value={props.value}
          onChange={onValueChange}
          placeholder={props.placeholder}
          disabled={props.disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={`${compositeClass} resize-y min-h-[72px]`}
        />
      ) : (
        <input
          ref={inputRef}
          id={id}
          type={props.type ?? "text"}
          value={props.value}
          onChange={onValueChange}
          placeholder={props.placeholder}
          disabled={props.disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={compositeClass}
        />
      )}
      {renderHelp(props.error, props.hint, errorId)}
    </div>
  );
}

/** Renders either the error (with role="alert") or a muted hint, never both. */
function renderHelp(error: string | undefined, hint: string | undefined, errorId: string): JSX.Element | null {
  if (error !== undefined) {
    return (
      <span id={errorId} className={INPUT.errorText} role="alert">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        <span>{error}</span>
      </span>
    );
  }
  if (hint !== undefined) {
    return <span className="text-xs text-slate-500">{hint}</span>;
  }
  return null;
}
