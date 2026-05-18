/**
 * Client-side validators that mirror the backend's request rules (spec
 * §3.2 + §3.6). Their job is to give immediate inline feedback in the
 * ConfigBar; the server still re-validates on submit, so these are a UX
 * convenience, never a security boundary.
 *
 * All helpers are pure and synchronous — no allocations beyond the input
 * itself, no network, no I/O.
 */

/** Max URL length the backend accepts (`url length ≤ 2 KiB`, spec §3.6). */
const MAX_URL_LENGTH = 2048;

/**
 * Validates an absolute `http(s)://` URL. Returns `null` when valid, or
 * a short, user-facing error string when not.
 */
export function validateUrl(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) {
    return "Required";
  }
  if (v.length > MAX_URL_LENGTH) {
    return "URL exceeds 2 KiB limit";
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must use http:// or https://";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "Embedded credentials are not allowed";
  }
  if (parsed.hash !== "") {
    return "Fragment (#…) is not allowed";
  }
  return null;
}

/**
 * Result of `validateHeadersText`. Either a parsed map of header
 * name → value, or a single user-facing error message.
 */
export type HeadersValidationResult =
  | { readonly parsed: Record<string, string> }
  | { readonly error: string };

/**
 * Validates a textarea of JSON headers. Empty input is treated as `{}`.
 *
 * The shape must be a **flat** object whose values are all strings.
 * Nested objects, arrays, numbers, `null`, etc. all fail validation.
 */
export function validateHeadersText(value: string): HeadersValidationResult {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { parsed: {} };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { error: "Invalid JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "Headers must be a flat JSON object" };
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string") {
      return { error: `Header "${k}" must be a string` };
    }
    out[k] = v;
  }
  return { parsed: out };
}

/** Validates the `correlationPath`. Non-empty is the only requirement. */
export function validateCorrelationPath(value: string): string | null {
  if (value.trim().length === 0) {
    return "Required";
  }
  return null;
}
