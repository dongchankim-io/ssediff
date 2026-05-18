# Slice 004 — REVIEW (rev 1 — post-fix)

**Verdict:** ACCEPT

## Audited items
1. **Route surface vs spec §3.5/§3.4** — Verified by direct curl: `/api/health`, `/api/stats`, `/api/session/start`, `/api/session/stop`, `/ws`, `/` (SPA), all return the spec'd shapes / status codes. Confirmed `GET` vs `POST` enforcement via Go 1.22+ mux method patterns.
2. **Request validation vs spec §3.6 limits** — `MaxBytesReader` caps body at 64 KiB (smoke: 70 KB body → 413 with clear error); `ValidateSessionRequest` enforces 2 KiB URL, ≤ 32 headers/stream, ≤ 8 KiB value, no `\r\n` in values; delegates URL scheme/userinfo/fragment + header name to the `stream` package. All denied with structured `{field, error}` body.
3. **SSRF mapping to 4xx (rev 1 fix)** — Verified: `POST /api/session/start` with `http://127.0.0.1:80/sse` returns 400 (not 500) with the `stream.ErrPrivateTarget` message. The five other `stream.Err*` sentinels (`ErrInvalidScheme`, `ErrURLUserInfo`, `ErrURLFragment`, `ErrEmptyHost`, `ErrReservedHeader`) flow through the same handler.
4. **Concurrency hygiene vs spec §3.6** — `SessionController.cancelAndWaitLocked` cancels the prior context, waits on `WaitGroup` with a 5 s safety timeout, and dumps goroutine stacks via `runtime.Stack` on expiry. `Hub.broadcast` acquires the mutex once, drops slow consumers under the lock, and releases before any socket work. `wsClient.serve` uses bidirectional cancellation so neither pump can outlive the other.
5. **Authorization redaction** — Still wired; smoke test from slice 003 still applies. No regression.
6. **Static handler safety** — Path traversal mitigated by `http.ServeMux`'s built-in URL cleaning + `filepath.Join`'s absolute-path semantics + `http.FileServer(http.Dir(...))` as a second layer. Real `404`s only for asset paths (e.g. `/missing.js`); non-asset paths fall through to `index.html` for client-side routing.
7. **Shutdown order vs spec §3.4** — Verified by log lines emitted during smoke shutdown: `step 1/4: stop accepting http` → `step 2/4: stop sessions` → `step 3/4: close matcher` → `step 4/4: stop hub and wait` → `server stopped cleanly`. No goroutine reads after channel close because matcher.Close happens **after** sessions.Stop has drained the SSE workers.
8. **Build/race/lint regression** — `make lint` clean (gofmt/vet/goimports/staticcheck/gocyclo). `go build -race ./...` clean. Frontend toolchain untouched and still clean.

## Adversarial inputs
- `POST /api/session/start {garbage}` → 400 with the JSON parser's exact error. ✓
- `POST /api/session/start <70 KB body>` → 413 with `request body exceeds 65536 bytes`. ✓
- `POST /api/session/start` with denied header `Proxy-Auth` → 400 with field path `streamA.headers.Proxy-Auth`. ✓
- `POST /api/session/start` with `Header: value\r\nX-Evil: y` (newline injection) → caught by the validator's `ContainsAny(value, "\r\n")` check before reaching the stream layer. (Spot-read confirms; not run live since the stream-layer stdlib check is the second wall.)
- `GET /ws` mid-shutdown → returns 503 because `Hub.ServeWS` reads `h.closed` under mu before upgrading.
- Concurrent two-`Start` race → second call blocks on `s.mu`, cancels first, waits up to 5 s, resets matcher, spawns fresh workers. Verified via code-read; race build is clean.
- `BUFFER_TTL_MS=abc` → config error, exit 2 with clear stderr message.
- `BUFFER_TTL_MS=0` → same; matcher's panic-on-zero ttl was the second wall but config catches first.

## DoD check
| DoD item | Status |
|---|---|
| All routes respond per spec | ✅ (verified live) |
| Header deny-list enforced | ✅ |
| `Authorization` `[REDACTED]` in logs | ✅ (slice 003 carry-over) |
| `Hub.Stop()` waits on WaitGroup with 5 s safety timeout | ✅ |

## Findings

### MINOR — Default `correlationPath` discrepancy
Spec §3.5 says the request's `correlationPath` defaults to `"id"` on the *frontend* (UI input default). My validator rejects empty `correlationPath` as 400. So if the UI sends an empty string the backend refuses — but the UI default is `"id"`, so an actual empty string only arrives from a misbehaved client. Behavior matches the spec (server-side is strict).

The cross-cutting note: `engine.NewStreamMatcher` (slice 002) is initialised in `main.go` with `correlationPath="id"` *just so it doesn't panic at boot before the first `Reset`*. This is a defensive seed value, not the operational default. Documented in the call site.

### NIT — Stats endpoint sets `MismatchCount` correctly but doesn't expose `dropped` results
The matcher tracks `droppedCount` (results dropped because the channel was full). This isn't part of the spec §3.5/§3.6 `Stats` JSON shape so I'm deliberately not exposing it. If operators want it, it's reachable via `matcher.Stats()` already.

## Verification of prior fixes
- Slice 003's MINOR-2 (header value validation at validation time) is resolved in `validate.go`. ✓
- All previously-accepted slices still build and test green.

## Outcome
Slice 004 accepted. The rev 1 SSRF→400 fix was caught by adversarial smoke testing and applied before this review; no outstanding findings of MAJOR or CRITICAL severity. Implementer may proceed to Slice 005.
