# Slice 003 — REVIEW (rev 1)

**Verdict:** ACCEPT WITH MINOR NOTES

## Audited items (≥ 5 required)
1. **URL validation** vs spec §3.6 — scheme/userinfo/fragment/host all enforced in `ValidateURL`; smoke test exercised `ftp://`, `user:pass@`, `#frag` → all blocked with clear error messages.
2. **CIDR / IP deny-list** vs spec §3.6 — `isBlockedIP` combines stdlib classifiers (`IsLoopback`, `IsPrivate`, `IsLinkLocalUnicast`/`Multicast`, `IsUnspecified`, `IsMulticast`) and the explicit `0.0.0.0/8` extra. Smoke test verified: 127.0.0.1, 10.0.0.1, 169.254.169.254, ::1, 0.0.0.5 all blocked when `AllowPrivateTargets=false`; `AllowPrivateTargets=true` bypassed cleanly.
3. **DNS-rebinding defense** — `ResolveAndPin` runs once and the captured IP is closed over by the Transport's `DialContext`. The Transport ignores the `addr` parameter from net/http and always dials the pinned IP. TLS `ServerName` keeps the original hostname so SNI / cert verify continue to work. ✓
4. **Header allow/deny** — `ValidateHeaderName` case-insensitive on the exact set (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`) and on the `Proxy-*` prefix; `buildHeaders` aborts with the first denied name.
5. **TLS verification by default** — `Config.InsecureSkipVerify` defaults zero-valued (false); `tls.MinVersion = VersionTLS12` adds a sensible floor not in the spec.
6. **`Authorization` redaction** — verified in an out-of-tree harness against `slog.With("Authorization", ...)`, `slog.Info("…", "authorization", ...)`, and mixed case; all emit `[REDACTED]`. The replacer is wired in `cmd/server/main.go`'s logger construction.
7. **HTTP client tuning** — `ResponseHeaderTimeout=10s`, `IdleConnTimeout=90s`, `MaxIdleConns=10`, `ExpectContinueTimeout=1s`, no `Client.Timeout`. Matches spec §3.6.
8. **Backoff** — `jitterBackoff` applies uniform ±20 % via `math/rand/v2.Float64()` (lock-free); `grow` doubles to a 30 s cap; reset to 1 s on first successful frame.
9. **1 MiB line cap** — `bufio.Scanner.Buffer(make([]byte, 64<<10), maxLineBytes)`; oversize → `bufio.ErrTooLong` → WARN log → reconnect.
10. **Race & build** — `go build -race ./...` clean. `make lint` clean (gofmt, vet, goimports, staticcheck, gocyclo).
11. **Dependency direction** — `stream/client.go` imports `engine` and stdlib only; no `api` import (which doesn't exist yet anyway). ✓

## Adversarial inputs
- All eight URLs in the smoke test (loopback, RFC1918, link-local, IPv6 loopback, scheme, userinfo, fragment, 0.0.0.0/8) blocked with descriptive errors. ✓
- `Authorization` redaction confirmed by independent harness against both the attribute-key and `With(...)` paths, case-insensitively. ✓
- Empty `correlationPath` and `ttl <= 0` at matcher level still panic loudly (rev 2 fix from slice 002). ✓
- SSE comment lines (`:keepalive`) — silently skipped by `parseStream`. ✓
- `data:` with empty value — accumulated; `ErrNoCorrelationID` returns at matcher level; WARN logged. ✓
- `event:` missing — defaults to `"message"` per spec. ✓
- Stream closes mid-frame (no trailing blank line) — last partial frame is *not* dispatched (correct per SSE spec). ✓

## DoD check
| DoD item | Status |
|---|---|
| `stream` imports `engine` but not `api` | ✅ |
| SSRF block verified against `http://127.0.0.1:80/` | ✅ (+7 more URLs) |
| Backoff jittered | ✅ |
| Malformed frames logged at WARN, no panic | ✅ |

## Findings

### MINOR-1 — 4xx responses retry forever
When upstream returns `401 Unauthorized` or `403 Forbidden`, `streamOnce` returns an error and `Run` retries indefinitely with exponential backoff. The operator's only signal is WARN log noise. Spec §3.3 mandates "survive network drops without killing the backend engine process" so the retry is correct; but for *non-transient* status codes a friendlier policy would be "log ERROR and give up". Not blocking — current behavior is defensible and matches the spec's "always retry" reading. Leaving as-is.

### MINOR-2 — Header values not pre-validated
We validate header *names* (spec §3.6) but not values. The stdlib's `http.Transport.RoundTrip` will reject values containing `\r`/`\n` at send time, so a smuggling attempt would fail loudly with a WARN+retry loop. Defense in depth would be to validate at config time and surface a clear `400` from the hub. Slice 004 will add this in `Hub.StartAssessment` where we already validate the request body shape — recorded here as a follow-up.

### NIT-1 — `Run`'s log "sse session ended; will retry" on natural EOF
Clean upstream close (`io.EOF`) emits a WARN with `received_any=true`. Reads as a problem when it's actually a normal end-of-stream. Could downgrade to INFO when `received_any=true`. Cosmetic.

## Verification of prior fixes
- Slice 001's missing `Authorization` redaction is now wired in `cmd/server/main.go`. ✅
- Slice 002 acceptance preserved: `go build -race`, `make lint`, frontend toolchain all still clean.

## Outcome
Slice 003 accepted. MINOR-1 is intentional per spec reading. MINOR-2 is queued for Slice 004 (where it naturally fits). NIT-1 is cosmetic and acceptable. Implementer may proceed to Slice 004.
