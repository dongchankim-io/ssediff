import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";

import { BUTTON } from "../../lib/theme";

/** Visual variant. `primary` = accent, `danger` = destructive, `ghost` = subtle. */
export type ButtonVariant = "primary" | "danger" | "ghost";

/** Density variant. `md` is the default; `sm` is for inline / chrome actions. */
export type ButtonSize = "md" | "sm";

/** Props accepted by `<Button>`. Extends the native button props minus `type`. */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Visual variant. */
  variant?: ButtonVariant;
  /** Density. */
  size?: ButtonSize;
  /** When true, replaces leading icon with a spinner and disables interaction. */
  loading?: boolean;
  /** Optional leading lucide icon (size auto-scales with size prop). */
  leadingIcon?: LucideIcon;
  /** Native button type. Defaults to `"button"` (never submits a form by surprise). */
  type?: "button" | "submit" | "reset";
  /** Visible button label. */
  children?: ReactNode;
}

/**
 * Accent / danger / ghost button styled per spec §4.2.
 *
 * - `type="button"` by default — opt into `"submit"` explicitly inside forms.
 * - When `loading` the leading icon is replaced by `Loader2` with a spin
 *   animation and `disabled` is forced true.
 * - Focus is visible via the Tailwind `focus-visible` ring on `BUTTON.base`.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leadingIcon: Icon,
  type = "button",
  className,
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const variantClass = BUTTON[variant];
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "";
  const compositeClass = [BUTTON.base, variantClass, sizeClass, className ?? ""]
    .filter(Boolean)
    .join(" ");
  const renderIcon = (): ReactNode => {
    if (loading) {
      return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
    }
    if (Icon !== undefined) {
      return <Icon className="h-4 w-4" aria-hidden />;
    }
    return null;
  };
  return (
    <button
      type={type}
      className={compositeClass}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {renderIcon()}
      {children !== undefined ? <span>{children}</span> : null}
    </button>
  );
}
