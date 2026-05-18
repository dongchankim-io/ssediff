# Slice 003 — SSE Ingestion Client — Iteration Notes

**Slice goal:** Resilient SSE client per spec §3.3 with SSRF defense per §3.6.

## Files emitted
- `backend/internal/stream/security.go` — new (190 lines). URL/header validation + SSRF resolver (resolve-once-and-pin) + IPv4/IPv6 deny-list. Pure functions only; no state.
- `backend/internal/stream/client.go` — new (247 lines). Client struct, NewClient (validates + pins IP + builds tuned Transport), Run with jittered exponential backoff (1s→30s, ±20 %), streamOnce, http transport tuning per spec §3.6, jitter/grow helpers.
- `backend/internal/stream/parser.go` — new (105 lines). SSE frame parser (split out of client.go to keep each file ≤ 300 lines and reflect single-responsibility): `parseStream`, `dispatch`, `parseField`. 1 MiB line cap via `bufio.Scanner.Buffer`; oversize → WARN + reconnect.
- `backend/cmd/server/main.go` — **modified** (cross-slice fix from Slice 001). Added `slog.HandlerOptions.ReplaceAttr = redactSensitiveAttrs` so any `Authorization` attribute value is emitted as `[REDACTED]` (spec §3.6).

## Definition-of-done check (Slice 003 in implementer.md §3)
- [x] `stream` imports `engine` but not `api` — verified by inspection: `stream/client.go` imports `engine` and stdlib only; `api/` does not yet exist.
- [x] SSRF block verified against `http://127.0.0.1:80/` — verified with an ephemeral `cmd/ssrf-smoke` harness (now deleted). All eight adversarial URLs were correctly refused with clear error messages:
  - `http://127.0.0.1:80/` → blocked (loopback)
  - `http://10.0.0.1/` → blocked (RFC1918)
  - `http://169.254.169.254/latest/meta-data/` → blocked (link-local, cloud metadata)
  - `http://[::1]/` → blocked (IPv6 loopback)
  - `ftp://example.com/` → blocked (scheme)
  - `https://user:pass@example.com/` → blocked (userinfo)
  - `https://example.com/#frag` → blocked (fragment)
  - `http://0.0.0.5/` → blocked (0.0.0.0/8 explicit CIDR)
  And `ALLOW_PRIVATE_TARGETS=true` + `127.0.0.1` correctly bypasses for local dev.
- [x] Backoff jittered — `jitterBackoff(d)` applies uniform ±20 % via `math/rand/v2.Float64()` (goroutine-safe, lock-free).
- [x] Malformed frames logged at WARN, no panic — `dispatch` swallows `ErrNoCorrelationID` with a WARN; `parseStream` swallows `bufio.ErrTooLong` with a WARN and reconnects; SSE comment lines (`:`) are skipped silently.

## Cross-slice fix log
- **Slice 001 follow-up:** `slog.HandlerOptions.ReplaceAttr` is now wired in `cmd/server/main.go`'s logger construction so `Authorization` values are scrubbed in every log call site without callers needing to remember. Required by spec §3.6 but missed in the Slice 001 review.

## Deviations from spec
- **Constructor signature uses a `Config` struct** instead of the spec §3.3 illustrative positional signature (`NewClient(source, url, headers, matcher, logger)`). Reason: spec §1.1 caps parameter count at 4 and we need 8 inputs (the four above plus UserAgent, AllowPrivateTargets, InsecureSkipVerify). Documented in the `Config` godoc.
- **`bufio.Scanner` is used instead of `bufio.Reader.ReadBytes`** to enforce the spec's "lines up to 1 MiB" cap as a hard ceiling (Scanner returns `bufio.ErrTooLong` past `Buffer` cap; `Reader.ReadBytes` has no hard cap and would silently grow). Spec phrases the choice as "illustrative" (§3.3: "use a buffered reader (bufio.Reader.ReadBytes('\n')); use Reader.Buffer to allow lines up to 1 MiB"); `Scanner` satisfies the same intent more directly.
- **Tests intentionally omitted** per spec §7.

## Outstanding from this slice
- (none for Slice 003 scope)

## Notes for the Reviewer
- The Transport's `InsecureSkipVerify` is gated by `Config.InsecureSkipVerify`; the spec mandates a startup `WARN` log when it's true. That WARN is emitted from `cmd/server/main.go` at config load — wiring main.go to forward the flag down to the hub/clients lands in Slice 004 when `Hub.StartAssessment` is wired. The plumbing pattern itself (Config bool → Transport InsecureSkipVerify) is in place here.
- `Run` returns `ctx.Err()` on cancellation and `nil` on `engine.ErrMatcherClosed`. Both are clean shutdowns; any other transient error is swallowed and retried.
- `tls.MinVersion = tls.VersionTLS12` is an extra-spec hardening (spec is silent on min TLS version; TLS 1.2 is the modern floor).
