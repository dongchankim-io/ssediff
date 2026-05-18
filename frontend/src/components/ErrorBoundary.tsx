import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "./ui/Button";
import { SURFACE, TEXT } from "../lib/theme";

/** Props for `<ErrorBoundary>`. */
export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Short label for the inline error card (e.g. "Event ledger"). */
  readonly label: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Catches render errors in child trees and shows an inline recovery card
 * instead of blank-screening the app (spec §4.6).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-4 p-6 ${SURFACE.cardBg} border ${SURFACE.cardBorder}`}
        role="alert"
      >
        <AlertCircle className="h-8 w-8 text-rose-500" aria-hidden />
        <p className={`text-sm font-medium ${TEXT.primary}`}>{this.props.label} failed to render</p>
        <p className={`max-w-md text-center text-xs ${TEXT.muted}`}>{this.state.error.message}</p>
        <Button type="button" variant="primary" size="sm" onClick={this.handleReset}>
          Reset
        </Button>
      </div>
    );
  }
}
