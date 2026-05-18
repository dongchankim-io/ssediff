# ssediff — Product, Quality & Verification Specification

## 1. About This Spec

This document defines **what** `ssediff` must do and the quality, security, and visual standards it must meet. It does **not** define the build process.

The build process — the iterative two-agent loop, slice plan, per-file reasoning scratchpad, and review rubric — lives in:
- `ssediff-workflow.md` — entry point; describes the loop.
- `ssediff-implementer.md` — Implementer role + slice plan + scratchpad protocol.
- `ssediff-reviewer.md` — Reviewer role + severity rubric + anti-rubber-stamp rules.

Both agents must conform to every standard in this document. Deviations are governed by Section 8 (Deviation Policy).

### 1.1 Code Quality Standards (Clean Code-aligned)

Apply Clean Code (Robert C. Martin) principles **pragmatically** — they are guidelines, not laws. When a rule would harm clarity, correctness, or performance, **deviate and justify the deviation in a one-line godoc/TSDoc comment above the offending symbol**. The standards below are enforceable defaults; deviation requires a stated reason in the code itself.

**Naming**
•	Names are intention-revealing and pronounceable. No Hungarian notation. Accepted short names: `ctx`, `req`, `res`, `cfg`, `id`, `i/j/k` in tight loops, `err`, single-letter type parameters.
•	Functions are verbs (`resolveMatch`, `evictStale`); types are nouns (`StreamMatcher`, `EventItem`); booleans read as predicates (`isClosed`, `hasMatched`, `canEvict`).
•	No misleading or generic names: `data`, `info`, `manager`, `helper`, `utils` are banned as top-level identifiers.

**Functions**
•	Soft cap: ≤ 30 logical lines and ≤ 3 parameters. Above 4 parameters, introduce a parameter struct.
•	One level of abstraction per function; extract a named helper rather than nest conditionals beyond 2 levels.
•	No flag/boolean parameters that flip branches — split into two functions.
•	**Command-Query Separation:** a method either returns a value or mutates state, not both. Constructors and channel-send operations are accepted exceptions.

**Files & packages**
•	Soft cap: 300 lines per file. Above that, document cohesion in a top-of-file godoc.
•	**Single Responsibility:** each package has one reason to change. Cross-cutting concerns (logging, retry, metrics) live in dedicated wrappers, never sprinkled inline.
•	**Dependency direction:** `engine` knows nothing about `api` or `stream`; `stream` knows nothing about `api`; `api` composes the lower layers. Enforce by import inspection.

**Complexity**
•	Cyclomatic complexity ≤ 15 per function, enforced by `gocyclo` (Go) and `eslint` `complexity` rule (TS).
•	Cognitive complexity (nested loops/branches) prefer ≤ 10; extract helpers to reduce.

**Error handling**
•	Never swallow an error or use `_ = err`. Wrap with context: Go `fmt.Errorf("ingest frame: %w", err)`; check with `errors.Is` / `errors.As`. TS: prefer typed error subclasses (`class ConfigValidationError extends Error`); never `throw "string"`; never `catch` for control flow.
•	`panic`/`recover` only at goroutine roots (the hub spawn point and the eviction loop), and only to log + restart, never to silently swallow.

**Constants over magic values**
•	Every threshold, timeout, capacity, or path lives in a named constant near the top of its file (e.g. `const evictionTick = 5 * time.Second`). No bare `5000` or `"id"` in the middle of logic.

**Comments**
•	Comments explain **why**, not what. The rewritten `///` comment paraphrasing the next line is forbidden.
•	Every exported Go identifier carries a godoc starting with the identifier name. Every exported TS type/function/component carries TSDoc. No commented-out code in committed files.

**Purity & isolation**
•	The matcher's resolution logic (decide MATCH vs MISMATCH from two `EventItem`s) is a **pure function** with no I/O, no logging, no time access — it takes inputs and returns a `Result`. Time-of-resolution is injected by the caller. This makes the hot path trivially correct and trivially testable later.
•	Hexagonal layout: I/O (HTTP, WebSocket, SSE) lives at the edges; the core (`engine`) is dependency-free.

**Discipline**
•	**Boy Scout Rule:** any file the agent touches is left at least as clean as it found it within the change's blast radius.
•	**DRY with judgment:** eliminate true duplication of *knowledge*; tolerate superficially similar code that has different reasons to change.

**Linting / formatting (must be clean as part of generation)**
•	Go: `gofmt -s`, `goimports`, `go vet ./...`, `staticcheck ./...`, `gocyclo -over 15 backend/` all clean. Provide a `Makefile` with `make lint`, `make build`, `make run`.
•	TypeScript: `eslint` with `@typescript-eslint/recommended-type-checked`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`; `prettier` with default config; `tsc --noEmit` clean. No `any`, no `@ts-ignore` without a justifying comment, no non-null assertions (`!`) on user-derived data.
•	Provide `.editorconfig` at repo root (UTF-8, LF, 2-space TS / tab Go, trim trailing whitespace, final newline).

---

## 2. Project Architecture & File Layout
Initialize a monorepo structure with the following exact file layout:

```text
.
├── .editorconfig
├── .dockerignore
├── .gitignore
├── Makefile
├── README.md
├── Dockerfile
├── docker-compose.yml
├── backend/
│   ├── cmd/server/main.go          # composition root: config, matcher, hub, sessions, HTTP server, graceful shutdown
│   ├── go.mod
│   ├── go.sum                      # generated by `go mod tidy` — do not hand-author
│   └── internal/
│       ├── engine/
│       │   ├── matcher.go          # StreamMatcher, eviction, Ingest, Results channel
│       │   ├── resolve.go          # pure MATCH/MISMATCH/ORPHAN resolution (no I/O)
│       │   └── types.go            # EventItem, Result, Stats, error sentinels
│       ├── stream/
│       │   ├── client.go           # SSE ingestion worker (Run loop, backoff)
│       │   ├── parser.go           # SSE framing (event/data lines, 1 MiB cap)
│       │   └── security.go         # SSRF, header deny-list, DNS pin
│       └── api/
│           ├── hub.go              # WebSocket registry + broadcast from matcher.Results()
│           ├── wsclient.go         # per-client read/write pumps, ping/pong
│           ├── session.go          # SessionController — start/stop upstream workers
│           ├── routes.go           # RegisterRoutes, static SPA handler, REST handlers
│           ├── validate.go         # POST /api/session/start request validation
│           └── mux_static_test.go  # optional regression test for static asset routing (Section 7)
├── frontend/
│   ├── index.html                  # `class="dark"` on <html>; mount node `#root`
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts              # dev proxy `/api` + `/ws` → :8080
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── .eslintrc.cjs
│   ├── .prettierrc
│   └── src/
│       ├── main.tsx                # font imports + createRoot
│       ├── index.css               # Tailwind layers; html/body/#root height 100%
│       ├── App.tsx                 # top-level layout + session/selection state
│       ├── components/
│       │   ├── ConfigBar.tsx
│       │   ├── EventLedger.tsx
│       │   ├── DiffViewer.tsx
│       │   ├── StatusHeader.tsx
│       │   ├── SplitPane.tsx
│       │   ├── OnboardingCard.tsx
│       │   ├── PreferencesPopover.tsx
│       │   ├── ErrorBoundary.tsx
│       │   └── ui/
│       │       ├── Button.tsx
│       │       ├── TextField.tsx
│       │       ├── StatusBadge.tsx
│       │       └── StatePill.tsx
│       ├── hooks/
│       │   ├── useEventStream.ts   # single WebSocket + ring buffer (Section 4.6)
│       │   ├── usePrefs.ts
│       │   └── useServerVersion.ts # GET /api/health → version string for header
│       └── lib/
│           ├── wire.ts             # protocol types only (Section 3.5 / 4.6)
│           ├── theme.ts            # design tokens + STATE_PILL_CLASSES / STATE_ICON
│           ├── api.ts              # startSession / stopSession + ApiError
│           ├── validation.ts       # client-side mirrors of backend URL/header rules
│           └── prefs.ts            # localStorage keys + ledger width helpers
└── public/                         # gitignored; populated by `make sync-public` or Docker COPY
```

**Dependency direction (enforce by import inspection):** `engine` imports neither `api` nor `stream`; `stream` imports `engine` only; `api` composes `engine` + `stream`. `cmd/server` wires everything.

**Build outputs (gitignored):** `frontend/dist/`, `public/`, `bin/ssediff`.

### 2.1 Makefile targets
Provide a root `Makefile` with at least these targets (exact names):

| Target | Purpose |
|--------|---------|
| `help` | Default goal; lists targets |
| `lint` | `gofmt`, `go vet`, optional `goimports` / `staticcheck` / `gocyclo` (skip gracefully if binaries missing) |
| `build` | `CGO_ENABLED=0 go build` → `./bin/ssediff` with `-ldflags "-s -w -X main.version=$(VERSION)"` where `VERSION` defaults to `git describe --always --dirty` |
| `sync-public` | `cd frontend && npm run build`, then copy `frontend/dist/` → `./public/` |
| `run` | `build` + `sync-public`, then run `./bin/ssediff` from **repo root** (so default `PUBLIC_DIR=./public` resolves correctly) |
| `dev` | Parallel: backend `go run ./cmd/server` from `backend/` with **`PUBLIC_DIR=../public`**, and `npm run dev` in `frontend/`. Print: open UI at **http://localhost:5173** (Vite proxies `/api` and `/ws` to :8080) |
| `up` | `docker compose down` (clean), `docker compose build --build-arg VERSION=…`, `docker compose up` — full stack on **http://localhost:8080** |
| `down` | Stop/remove compose containers |
| `tidy` | `go mod tidy` in `backend/` |
| `clean` | Remove `./bin/ssediff` |

---

## 3. Backend Specification (Go)

### 3.1 Dependencies & Toolchain
Initialize the Go module in `/backend` targeting `go 1.24` using these specific tracking and utility packages:
•	JSON Parsing: `github.com/tidwall/gjson` (for high-performance, allocation-free path extraction)
•	WebSockets: `github.com/gorilla/websocket` (for low-latency UI delivery)
•	Logging: stdlib `log/slog` with the JSON handler at `INFO` level by default. Do **not** introduce a third-party logger.
•	No other third-party runtime dependencies. The HTTP server uses `net/http` + `http.ServeMux` (no router framework).

### 3.2 High-Performance Stream Matcher (`internal/engine/matcher.go`)
Implement a thread-safe streaming analysis engine.
•	**State Management:** Design a `StreamMatcher` struct using a `sync.Mutex` protecting a nested map buffer: `map[eventType]map[streamSource("A"|"B")]map[correlationID]EventItem`.
•	**Zero-Allocation Evaluation:** Use `gjson.GetBytes(rawJSON, correlationPath)` to extract tracking IDs directly from raw byte streams without generic JSON unmarshaling into maps.
•	**Event-Type Bucketing:** The bucket key is the SSE `event:` field verbatim. If the upstream SSE frame has no `event:` field, bucket under `"message"` (per the SSE spec). Matching only ever occurs **within the same `eventType` bucket**; events with different types are never compared.
•	**Match Resolution:** When both `A` and `B` have an entry for the same `(eventType, correlationID)`:
	•	`MATCH` — both raw payloads are byte-equal after trimming surrounding whitespace.
	•	`MISMATCH` — payloads differ. The backend does **not** compute a textual diff; it ships both raw payloads to the UI, which renders the diff via `react-diff-viewer-continued`.
	•	In both cases, atomically `delete` both records under a single lock acquisition and publish exactly one `Result` to the buffered `results` channel (capacity **1024**; exposed as `Results() <-chan Result`).
•	**Proactive Eviction (Anti-Memory Leak):** A background goroutine ticks every 5s, walks the map under the lock, and evicts any record whose age exceeds `TTL`. Each evicted record is published as an `ORPHAN` result carrying its original source and raw payload.
•	**TTL Configuration:** `TTL` is read **once at process start** from the env var `BUFFER_TTL_MS` (default `30000`). It is **not** runtime-tunable from the UI; the `ConfigBar` does not expose it. Document this on the `StreamMatcher` constructor.
•	**Shutdown:** The matcher exposes a `Close()` method that stops the eviction ticker and closes the `results` channel exactly once (`sync.Once`).

### 3.3 Resilient SSE Ingestion Client (`internal/stream/client.go`)
Implement a robust HTTP client designed for long-lived streaming connections.
•	**Constructor:** `func NewClient(ctx context.Context, cfg Config) (*Client, error)` where `Config` bundles `Source` (`engine.StreamA` | `engine.StreamB`), `URL`, `Headers`, `Matcher`, `Logger`, `UserAgent`, `AllowPrivateTargets`, `InsecureSkipVerify`. Validation (URL shape, header names, DNS pin via `stream/security.go`) happens in `NewClient`; errors propagate to `SessionController.Start` as `400` responses.
•	The client pushes each parsed event into the matcher via `matcher.Ingest(source, eventType, rawJSON []byte)`. It never holds matcher locks itself.
•	Read incoming server-sent events line-by-line using a buffered reader (`bufio.Reader.ReadBytes('\n')`); use `Reader.Buffer` to allow lines up to 1 MiB.
•	Parse standard SSE framing (`event: <type>`, `data: <json_string>`, blank-line demarcations) cleanly. If multiple `data:` lines appear in one frame, concatenate them with `\n` per the spec.
•	Default the event type to `"message"` when no `event:` field is present in a frame.
•	Strip heartbeats and comments (lines starting with `:`) without processing them. Reset the backoff on the first successful frame received.
•	**Lifecycle:** `Run(ctx context.Context) error` blocks until `ctx` is cancelled. On `ctx.Done()`, the underlying HTTP request is cancelled and `Run` returns `ctx.Err()`.
•	**Resiliency:** Wrap the connection pipeline in an exponential backoff retry loop (initial delay 1s, doubling to a cap of 30s, with ±20% jitter) to survive network drops without killing the backend engine process. Each retry attempt and reason is logged at `WARN`. Malformed UTF-8, oversize lines, and invalid JSON in `data:` are logged at `WARN` and dropped — never panic.

### 3.4 Live Broadcast Server (`internal/api/` & `cmd/server/main.go`)

**Hub (`internal/api/hub.go` + `wsclient.go`) — WebSocket broadcast only**
•	`Hub` handles WebSocket upgrades (`gorilla/websocket.Upgrader`, `CheckOrigin` always `true` — UI is same-origin in production).
•	`Run(ctx)` consumes `matcher.Results()` and fans each `engine.Result` to every registered client via per-client buffered `send` channels (capacity **256**). If a client's buffer is full, the hub **drops** that client (closes its `send` channel) rather than blocking ingestion.
•	Each connection is a `wsClient` with a **write pump** (broadcasts + ping every **30s**) and a **read pump** (discards inbound messages; honours pongs; **60s** read deadline). Inbound UI messages are intentionally ignored.
•	`ServeWS` upgrades `GET /ws` and spawns `wsClient.serve`.

**Session controller (`internal/api/session.go`) — upstream SSE workers**
•	`SessionController` owns at most **one active assessment** at a time. It does **not** handle WebSockets.
•	`Start(ctx, SessionRequest) (sessionID string, error)` — validates via `validate.go` + `stream` security, calls `matcher.Reset(correlationPath)`, cancels any prior session (bounded **5s** wait with `runtime.Stack` dump on timeout), spawns two `stream.Client.Run` goroutines (A and B) under a session-scoped `context.Context`.
•	`Stop()` — idempotent; cancels the active session and waits for workers (same 5s safety timeout).
•	Session id: 8 random bytes hex (`crypto/rand`), logged as `session_id`.

**HTTP routing (`internal/api/routes.go`, wired from `cmd/server/main.go`)**
•	`cmd/server/main.go` is the composition root: load `Config` from env, construct matcher → `SessionController` → `Hub`, call `api.RegisterRoutes`, start `hub.Run` in a background goroutine, run `http.Server` with `ReadHeaderTimeout=10s`.
•	Use Go 1.22+ `http.ServeMux` method patterns:
	•	`POST /api/session/start` → `startHandler` (`http.MaxBytesReader` 64 KiB, `json.Decoder` with `DisallowUnknownFields`) → `SessionController.Start` → **`202 {"status":"started"}`** (no `sessionId` in the response body; id is log-only).
	•	`POST /api/session/stop` → `SessionController.Stop` → `200 {"status":"stopped"}`.
	•	`GET /api/health` → `200 {"status":"ok","version":"<ldflags>"}`.
	•	`GET /api/stats` → matcher counters + hub uptime/active WS clients (see §3.6).
	•	`GET /ws` → `Hub.ServeWS`.
	•	`GET /` (prefix match) → `staticHandler(PUBLIC_DIR)` (see below).

**Static file server (`staticHandler` in `routes.go`)**
•	Root directory: env `PUBLIC_DIR` (default `./public`; Docker `/app/public`; `make dev` uses `../public` from `backend/` — see §2.1).
•	If `index.html` is missing → serve a **200** placeholder HTML page explaining to run `npm run dev` (:5173) or `npm run build` + sync to `PUBLIC_DIR` (not a blank screen).
•	If the requested path is an existing file → `http.FileServer` serves it.
•	If the path's final segment contains `.` (looks like an asset) but the file is missing → **404** (missing JS/CSS must be loud).
•	Otherwise → serve `index.html` (SPA fallback).

**Graceful shutdown (`cmd/server/main.go`, on `SIGINT`/`SIGTERM`)**
Four logged steps (10s HTTP shutdown timeout):
	1.	`http.Server.Shutdown` — stop accepting new HTTP/WS upgrades.
	2.	`SessionController.Stop` — cancel upstream SSE workers (no further `Ingest`).
	3.	`StreamMatcher.Close` — stop eviction, close `Results` channel (hub drains remaining broadcasts).
	4.	Cancel hub context + `WaitGroup` for `hub.Run`.

This order ensures the hub can drain `Results()` while the matcher closes; sessions stop before `Close` so no ingest races during teardown.

### 3.5 Wire Protocol (canonical schemas)

These schemas are the **single source of truth** the frontend and backend must agree on. Use them verbatim.

**Go domain types** (define in `internal/engine/matcher.go` and reuse from `internal/api/hub.go`):

```go
type StreamSource string // "A" or "B"

type EventItem struct {
    Source        StreamSource
    EventType     string
    CorrelationID string
    RawJSON       []byte    // exact bytes received in the SSE data: field
    ReceivedAt    time.Time // UTC
}

type ResultKind string // "MATCH" | "MISMATCH" | "ORPHAN"

type Result struct {
    Kind          ResultKind
    EventType     string
    CorrelationID string
    Timestamp     time.Time // UTC; for MATCH/MISMATCH = time of resolution; for ORPHAN = eviction time
    // For MATCH and MISMATCH both are populated; for ORPHAN only one side is populated.
    A *EventItem `json:"a,omitempty"`
    B *EventItem `json:"b,omitempty"`
}
```

**REST: `POST /api/session/start`**

Request body:

```json
{
  "streamA": {
    "url": "https://example.com/sse/a",
    "headers": { "Authorization": "Bearer ...", "X-Foo": "bar" }
  },
  "streamB": {
    "url": "https://example.com/sse/b",
    "headers": {}
  },
  "correlationPath": "id"
}
```

•	`headers` is a **flat string→string JSON object**. The frontend serializes the user's textarea by `JSON.parse` and rejects anything that isn't a flat object of strings before sending. Empty object is valid.
•	`correlationPath` is a `gjson` path expression (e.g. `"id"`, `"payload.tracking.id"`).
•	Responses: `202 {"status":"started"}` on success, `400 {"error":"..."}` on validation failure. If a session is already running, the backend **auto-cancels it** (per 3.4) and still returns `202`; it does **not** return `409`.

**REST: `POST /api/session/stop`** — empty body, returns `200 {"status":"stopped"}` (idempotent).

**REST: `GET /api/health`** — returns `200 {"status":"ok","version":"<build-injected>"}` (see 3.6 Build metadata).

**REST: `GET /api/stats`** — returns `200` with `{matchCount, mismatchCount, orphanCount, bufferedItems, uptimeSeconds, activeWsClients}` (all integers, see 3.6 Observability).

**WebSocket: `GET /ws`** — server → client only (client messages are ignored, but reads must occur to honour pings). Each message is a single JSON object. `kind` is one of `"MATCH"`, `"MISMATCH"`, `"ORPHAN"`. Example (a `MISMATCH`):

```json
{
  "kind": "MISMATCH",
  "eventType": "order.created",
  "correlationId": "abc-123",
  "timestamp": "2026-05-17T12:34:56.789Z",
  "a": {
    "source": "A",
    "rawJson": "{\"id\":\"abc-123\",\"amount\":100}",
    "receivedAt": "2026-05-17T12:34:56.700Z"
  },
  "b": {
    "source": "B",
    "rawJson": "{\"id\":\"abc-123\",\"amount\":101}",
    "receivedAt": "2026-05-17T12:34:56.780Z"
  }
}
```

•	`rawJson` is the **string** form of the original SSE `data:` payload (UTF-8). The UI is responsible for pretty-printing before passing to `react-diff-viewer-continued`.
•	For `ORPHAN`, exactly one of `a` / `b` is present; the other is omitted.
•	JSON keys use `camelCase`. Configure `encoding/json` tags accordingly.

### 3.6 Backend Cross-Cutting Concerns

**Security — SSRF defense (mandatory).** The user supplies arbitrary URLs that the backend will dial. The SSE client must, at startup of each session, reject:
•	Any non-`http` / `https` scheme.
•	Any URL containing userinfo (`https://user:pass@...`) or a non-empty `#fragment`.
•	Any host that resolves to a private, loopback, or link-local address: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`, `::1/128`, `fc00::/7`, `fe80::/10`. Resolve hostnames **once** and dial the resolved IP via a custom `http.Transport.DialContext` to prevent DNS-rebinding.
•	Set `ALLOW_PRIVATE_TARGETS=true` (env) to bypass for local dev; log a startup `WARN` if enabled.

**Security — header allow/deny.** Reject these user-supplied header names (case-insensitive): `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, any `Proxy-*`. `Authorization` values must appear in logs as `[REDACTED]` (use a `slog.Value` replacer).

**Security — request limits.** Wrap the `/api/session/start` body in `http.MaxBytesReader(..., 64<<10)`. Validate URL length ≤ 2 KiB, header count ≤ 32 per stream, header value length ≤ 8 KiB.

**TLS.** Verify upstream TLS by default. `INSECURE_SKIP_VERIFY=true` (default `false`) bypasses for local dev only; log a startup `WARN` if enabled.

**HTTP client tuning.** The SSE `http.Client` uses a custom `Transport` with: no overall `Client.Timeout` (long-lived streams), `Transport.ResponseHeaderTimeout=10s`, `Transport.IdleConnTimeout=90s`, `Transport.MaxIdleConns=10`, `Transport.ExpectContinueTimeout=1s`, and an explicit `User-Agent: ssediff/<version>`.

**Observability — structured logging.** Every `slog` record carries these fields when in scope: `session_id`, `source`, `event_type`, `correlation_id`. Bind a session-scoped child logger via `slog.With` in `SessionController.Start` and pass it to each `stream.Client`. Levels:
•	`DEBUG` — per-frame parsing details (off in production).
•	`INFO` — session lifecycle (start, stop, upstream connected).
•	`WARN` — retries, malformed frames, dropped slow consumers, oversize lines.
•	`ERROR` — unrecoverable session failures.

**Observability — stats endpoint.** Add `GET /api/stats` returning `200` with JSON `{matchCount, mismatchCount, orphanCount, bufferedItems, uptimeSeconds, activeWsClients}`. Counters are `atomic.Int64`. No Prometheus dependency required.

**Concurrency hygiene.**
•	`context.Context` is the **first parameter** of every function that can block on I/O or wait on a channel.
•	Every spawned goroutine is paired with a `sync.WaitGroup` increment and a deferred `Done`; no goroutine outlives its parent context.
•	`SessionController.Stop()` (and session replacement inside `Start`) waits for stream worker goroutines with a **5s** safety timeout — if it expires, log `ERROR` with a `runtime.Stack` dump.
•	`go vet -race`-clean (i.e. the binary built with `-race` for tests runs the eviction + ingest path without complaint).

**Configuration (12-factor).** All config is read from env vars at startup into a `Config` struct. Print the parsed config (with secrets redacted) at startup `INFO`. Invalid config → exit with non-zero status and a clear message; never silently default.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP listen port |
| `BUFFER_TTL_MS` | `30000` | Matcher orphan TTL (ms); not UI-tunable |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `PUBLIC_DIR` | `./public` | Built React bundle directory for `GET /` static handler |
| `ALLOW_PRIVATE_TARGETS` | `false` | Allow dialing private/loopback IPs (lab only; startup `WARN`) |
| `INSECURE_SKIP_VERIFY` | `false` | Skip upstream TLS verification (lab only; startup `WARN`) |

**Build metadata.** Inject version via ldflags: `-X main.version=$(git describe --always --dirty)`. Expose it in `/api/health` (`{"status":"ok","version":"..."}`).

---

## 4. Frontend UI Specification (React + TS + Tailwind)

### 4.1 Framework & Core Tools
Initialize the web dashboard in `/frontend` with these pinned versions (use latest patch within each minor):
•	`react` ^18.3, `react-dom` ^18.3
•	`typescript` ^5.5 with `strict: true`
•	`vite` ^5.4 + `@vitejs/plugin-react`
•	`tailwindcss` ^3.4 + `postcss` + `autoprefixer` (Tailwind v3 — **not** v4; the layout assumes `tailwind.config.js` and `postcss.config.js`)
•	`react-diff-viewer-continued` (latest)
•	`lucide-react` (latest)
•	`@fontsource/inter` (latest) + `@fontsource/jetbrains-mono` (latest) — self-hosted Inter (UI) and JetBrains Mono (code), imported once from `src/main.tsx` so no Google Fonts network calls are made. See Section 4.2 Typography.

No router library is required — the app is a single page. The fallback to `index.html` in 3.4 is there so future client-side routes don't break refresh.

**WebSocket endpoint:** the UI connects to `` `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` `` so it works in both dev (via Vite proxy) and prod (same origin as the Go server).

**Vite dev proxy:** configure `vite.config.ts` to proxy `/api` and `/ws` (with `ws: true`) to `http://localhost:8080` so `npm run dev` works against a locally-running backend.

### 4.2 Visual & UX Design Language

The UI must feel like a **modern, professional developer tool** — comparable in polish to Linear, the Vercel Dashboard, Stripe Dashboard, or Datadog's Live Tail. Users are engineers comparing two live SSE feeds; the design must minimize cognitive load, surface state changes instantly, and never get in the user's way. **An out-of-the-box Tailwind starter look or a Bootstrap admin template is a failed implementation, regardless of feature correctness.**

The single user job-to-be-done is: *"Quickly tell whether two SSE streams agree, and where they don't."* Every design choice must serve that job.

**Aesthetic direction**
•	**Dark-first.** Default (and only) theme is dark. Set `darkMode: 'class'` in `tailwind.config.js` and apply `class="dark"` on `<html>` in `index.html`. A light theme is out of scope.
•	**Calm chrome, urgent state.** Most surfaces are neutral slate; color is reserved for state (MATCH/MISMATCH/ORPHAN) and a single accent.
•	**Density over whitespace.** This is a real-time monitoring tool; prefer compact layouts that show maximum signal per pixel, while maintaining ≥ 1.5× line-height for readability.

**Design tokens (centralized in `src/lib/theme.ts`; consumed by components — never inline hex)**

Surfaces & text:
•	App background: `bg-slate-950`
•	Elevated card surface: `bg-slate-900` with `border border-slate-800`
•	Hover/selected row: `bg-slate-800/60`
•	Dividers: `divide-slate-800`, `border-slate-800`
•	Primary text: `text-slate-100`; secondary: `text-slate-400`; muted/placeholder: `text-slate-500`

Accent (used sparingly — primary buttons, links, focus rings):
•	`bg-indigo-500` / hover `bg-indigo-400` / focus ring `ring-indigo-500/40`

Semantic (reuse Section 4.4 state map; never re-color):
•	MATCH `emerald-500` · MISMATCH `rose-600` · ORPHAN `amber-500` · Info `sky-500`

Export `STATE_PILL_CLASSES: Record<ResultKind, string>` and `STATE_ICON: Record<ResultKind, LucideIcon>` from `lib/theme.ts`.

**Typography**
•	Sans (UI): **Inter** via `@fontsource/inter` (self-hosted, no Google Fonts network calls). Fallback `font-sans`.
•	Mono (code, JSON, IDs, timestamps): **JetBrains Mono** via `@fontsource/jetbrains-mono`. Fallback `font-mono`.
•	Scale: `text-xs` chrome metadata · `text-sm` default body / table rows · `text-base` form inputs · `text-lg` section titles. Reserve `text-xl+` for the wordmark only.
•	All numerics in counters and timestamps use `tabular-nums` to prevent layout jitter.

**Spacing, radius, elevation**
•	4 px base (Tailwind default). Stick to the spacing scale `1, 2, 3, 4, 6, 8`; avoid odd values.
•	Radii: cards/panels `rounded-lg` (8 px) · buttons/inputs `rounded-md` (6 px) · pills `rounded-full`.
•	Elevation is achieved with `border-slate-800` + `bg-slate-900`, not heavy shadows. Reserve `shadow-lg` for the (rare) floating popover.

**Layout — single full-viewport composition**

The root shell in `App.tsx` must use `h-screen w-screen flex flex-col overflow-hidden` so child panes never spill off-screen. Structure:

1. `<header>` — `StatusHeader` (`shrink-0`, sticky `h-12`).
2. Optional onboarding — `OnboardingCard` wrapped in `shrink-0` (first visit only; §4.2 Onboarding).
3. Config zone — wrap `ConfigBar` in `shrink-0 max-h-[min(50vh,28rem)] overflow-y-auto border-b border-slate-800` so a tall form scrolls internally while the dashboard below always receives space.
4. `<main className="flex min-h-0 flex-1 flex-col overflow-hidden">` — `SplitPane` with Event Ledger (left) + Diff Viewer (right).

Without the config `max-h` + root `overflow-hidden`, short viewports show only the config form and the ledger/diff area appears "empty" below the fold.

```
┌────────────────────────────────────────────────────────────────────────┐
│  STATUS HEADER  (sticky top, h-12)                                     │
│  ssediff   ● Live   ✓142  ⚠8  ⏱3                v1.2.3   ⚙           │
├────────────────────────────────────────────────────────────────────────┤
│  CONFIG BAR  (collapsible, default expanded; auto-collapses on Start)  │
│  Stream A [______________________________]  Headers [________________] │
│  Stream B [______________________________]  Headers [________________] │
│  Correlation Path [id]              [ ▶ Start Assessment ] [ ■ Stop ]  │
├──────────────────────────┬─────────────────────────────────────────────┤
│  EVENT LEDGER            │  DIFF VIEWER (flex-1, main canvas)          │
│  (resizable; default     │                                             │
│   420px, min 320,        │  Header strip: [● MISMATCH] order.created   │
│   max 720; width         │                 id=abc-123  •  12:34:56.789 │
│   persisted)             │  ┌──────────────────┬──────────────────┐    │
│                          │  │    Stream A      │    Stream B      │    │
│  [ All | Mism. | Orph. ] │  │    (pretty)      │    (pretty)      │    │
│  ┌──────────────────┐    │  │     diff…        │     diff…        │    │
│  │ ● order.created  │    │  │                  │                  │    │
│  │ ● order.updated▶│    │  │                  │                  │    │
│  │ ● order.created  │    │  └──────────────────┴──────────────────┘    │
│  └──────────────────┘    │                                             │
└──────────────────────────┴─────────────────────────────────────────────┘
```

•	**Status header** — sticky, `h-12`, `bg-slate-900`, `border-b border-slate-800`. Left: wordmark `ssediff` (text-lg, font-semibold, tracking-tight) + a `lucide-react Activity` mark in accent color. Center: connection dot + session status badge. Right cluster: live counters, backend version (text-xs, muted), settings icon button (placeholder OK).
•	**ConfigBar** — auto-collapses ~3s after a successful Start (transition `max-height 200ms ease-out`); collapsed state shows a one-line summary with truncated URLs and a chevron to reopen. Disable auto-collapse if validation errors are present.
•	**EventLedger** — left side panel; resizable via a 4px-wide drag handle on its right edge (controlled state + pointer events; no library). Width persisted to `localStorage` under `ssediff:ledgerWidth`.
•	**DiffViewer** — fills remaining canvas, `min-w-[480px]`. Above the diff: a header strip showing the kind pill, eventType (mono), correlationId (mono, with a copy button), and timestamp.

**Component patterns**

Buttons (define a `<Button variant="primary"|"danger"|"ghost" size="md"|"sm">` in `src/components/ui/Button.tsx`):
•	Primary: `bg-indigo-500 hover:bg-indigo-400 text-white font-medium px-4 py-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 inline-flex items-center gap-2`.
•	Danger: same shape, `bg-rose-600 hover:bg-rose-500`.
•	Ghost: `text-slate-300 hover:bg-slate-800` for icon-only or low-emphasis actions.
•	Always pair a leading lucide icon with the label for primary actions (`Play` → Start, `Square` → Terminate).
•	While a request is in flight, replace the leading icon with `Loader2 className="animate-spin"`; never lock the whole UI.

Form inputs (`<TextField label="..." error="..." mono>` in `src/components/ui/TextField.tsx`):
•	`bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-colors` — `font-mono` when holding URLs / JSON / paths.
•	Labels above inputs in `text-xs font-medium text-slate-400 uppercase tracking-wide`.
•	Validation messages below input in `text-rose-400 text-xs flex items-center gap-1` prefixed by a lucide `AlertCircle`.
•	On focus, the entire field rises to `border-indigo-500`; on validation error, it's `border-rose-500`.
•	Auto-focus the **Stream A URL** input on first mount.

State pills (the one place color is loud):
•	`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide`
•	Always pair the color with a 12 px lucide icon (`Check`, `AlertTriangle`, `Clock`) **and** the textual label. Color alone is never the sole signal (accessibility).

Connection-status indicator in the header:
•	A small `Circle` filled via `fill-current`, sized `h-2.5 w-2.5`, with the textual status next to it:
	•	`connecting` → `text-amber-400 animate-pulse` · label `Connecting…`
	•	`open`       → `text-emerald-400` · label `Live`
	•	`closed`     → `text-rose-400` · label `Disconnected — retrying in {n}s`
•	The label is always rendered (no icon-only state).

Live counters in the header:
•	Derived from the WebSocket stream in real time (not polled from `/api/stats`).
•	Format: `<lucide-icon> <tabular-nums count>` per kind. Each counter pulses briefly on update via `transition-transform duration-150 scale-110` then back.
•	Cap display at `999+` to keep header width stable.

**Microinteractions (subtle, never bouncy)**
•	Default transition: `transition-colors duration-150 ease-out`.
•	New ledger rows fade in over 120 ms (define `@keyframes fadeIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }` in `tailwind.config.js`).
•	Never auto-scroll the ledger; preserve the user's scroll position. Show a small "↓ N new" pill at the bottom when off-screen rows arrive; clicking it scrolls to bottom.
•	On row select: `bg-slate-800 ring-1 ring-indigo-500/40`.
•	No spring physics, no large entrance animations, no parallax. This is a serious tool.

**Iconography**
•	All icons from `lucide-react`, stroke width 2.
•	Sizes: `h-4 w-4` chrome · `h-5 w-5` button leading icons · `h-3.5 w-3.5` pill icons.
•	Canonical mapping: `Play` (start) · `Square` (stop) · `Settings` (prefs) · `ChevronDown/Up` (collapse) · `Circle` (status dot) · `Check` (match) · `AlertTriangle` (mismatch) · `Clock` (orphan) · `Copy` (copy ID) · `GitCompare` (diff empty state) · `Activity` (logo glyph, ledger waiting state) · `AlertCircle` (form error) · `Loader2` (loading) · `Trash2` (clear ledger).

**Empty / loading / error states (every panel has one — never render a blank rectangle)**
•	**Ledger when `history.length === 0`:** centered card with `Activity` icon and copy *"Configure two SSE endpoints above and click **Start Assessment** to begin comparing live streams."* (shown whenever the WebSocket history ring buffer is empty, including a live session waiting for first events).
•	**Ledger when filters exclude all rows:** centered copy *"No events match the current filter."*
•	**DiffViewer with nothing selected:** centered `GitCompare` icon and copy *"Select a row from the ledger to inspect the diff."*
•	**ORPHAN selected:** the present side shown full-width with a subtle amber-tinted banner *"No counterpart from Stream {A|B} within the TTL window."*
•	**Backend 4xx on Start:** inline rose-tinted banner inside the ConfigBar showing the error message — never a modal, never a toast that auto-disappears.
•	**WebSocket disconnected:** header dot turns rose; when `status === 'closed'` and a reconnect is scheduled, label shows `Disconnected — retrying in {N}s` using `nextReconnectAt` from `useEventStream` (live countdown, 1s tick).

**Header session-status badge**
•	`Idle` (`bg-slate-800 text-slate-300`) before any session.
•	`Live` (`bg-emerald-500/15 text-emerald-300 border border-emerald-500/30`) during an active session.
•	`Stopped` (`bg-slate-700 text-slate-200`) after a manual stop.
•	`Error` (`bg-rose-500/15 text-rose-300 border border-rose-500/30`) on backend failure.

**Density & preference popover (small `Settings` icon in the header)**
•	Toggle **Compact mode** — reduces ledger row padding `py-2 → py-1`.
•	Toggle **Show event-type column** — hides/shows the column in the ledger.
•	Persisted to `localStorage` under `ssediff:prefs`. Loaded synchronously before first paint to avoid flicker.

**Onboarding (first visit)**
•	On first load (no `localStorage["ssediff:hasSeenOnboarding"]`), show a one-time, dismissible tip card above the ConfigBar:
	*"Welcome to ssediff. Point this tool at two SSE endpoints that emit the same events, and we'll align them by your chosen correlation ID and surface mismatches in real time."*

**Inspiration / north star**
Aim for the visual quality of: **Linear** (typographic restraint, dense panels, accent discipline), **Vercel Dashboard** (calm dark surfaces, clear hierarchy), **Stripe Dashboard** (status communication, semantic color usage), **Datadog Live Tail** (real-time log viewer ergonomics). The end result must read as a deliberate, opinionated developer tool — not a generic admin panel.

### 4.3 Configuration Dashboard (`components/ConfigBar.tsx`)
Build a polished UI header layout featuring state management controls:
•	Inputs for **Stream A Target URL** and **Stream B Target URL** (validated as absolute `http(s)://` URLs).
•	Textareas for custom JSON headers per stream (e.g. Bearer auth tokens). The textarea must `JSON.parse` to a flat `{[k: string]: string}` object; any other shape (nested objects, non-string values, arrays) shows an inline validation error and disables **Start Assessment**. Empty textarea is treated as `{}`.
•	Input for the **Correlation ID JSON Path** (a `gjson` path), defaulting to `"id"`. Non-empty validation only.
•	Buttons **Start Assessment** → `POST /api/session/start`, **Terminate Connections** → `POST /api/session/stop`. The Start button is disabled while a session is active or while validation fails. Surface backend `4xx` error bodies inline.
•	TTL is **not** exposed in the UI (it's a server env var, see 3.2).
•	`App.tsx` owns session lifecycle state (`idle` | `live` | `stopped` | `error`). On successful start → `live`. On stop → `stopped`. While `live`, if the WebSocket hook reports `closed`, transition to `error` (upstream may still be running; user sees transport failure).

### 4.4 High-Throughput Event Ledger (`components/EventLedger.tsx`)
Create an optimized side-panel logging real-time stream status updates from the WebSocket feed.
•	Display chronological columns: Timestamp (HH:mm:ss.SSS), Event Type, Correlation ID, and a state indicator pill.
•	Use these exact Tailwind classes for indicator backgrounds: `MATCH` → `bg-emerald-500 text-white`, `MISMATCH` → `bg-rose-600 text-white`, `ORPHAN` → `bg-amber-500 text-black`.
•	Top-bar filter toggles: `All` / `Mismatches only` / `Orphans only`. Toggles are mutually exclusive and apply client-side.
•	**Performance:** the ledger keeps a **ring buffer of the most recent 2,000 events** in component state. Older events are dropped silently. Rendering must use a stable `key` per event (e.g. `` `${kind}:${correlationId}:${timestamp}` ``) and avoid re-rendering all rows on every new event (use `React.memo` for the row component).
•	Clicking a row selects it and feeds it to the `DiffViewer`.

### 4.5 Code Diff Terminal (`components/DiffViewer.tsx`)
•	When an item in the ledger is clicked, render a side-by-side comparison via `react-diff-viewer-continued` (`splitView={true}`, `useDarkTheme={true}`).
•	Pretty-print each side before passing in: `try { JSON.stringify(JSON.parse(rawJson), null, 2) } catch { return rawJson }`. Never throw on malformed JSON — fall back to the raw string.
•	For `ORPHAN`, show the populated side full-width with a banner explaining no counterpart arrived within the TTL window; do not pass the missing side to the diff viewer.
•	Empty state (nothing selected): show a short placeholder explaining how to select a row.

### 4.6 Frontend Cross-Cutting Concerns

**Type safety (mirror the wire protocol).**
•	`src/lib/wire.ts` exports a discriminated union mirroring Section 3.5 exactly:

```ts
export type StreamSource = "A" | "B";
export type ResultKind = "MATCH" | "MISMATCH" | "ORPHAN";

export interface WireStreamPayload {
  source: StreamSource;
  rawJson: string;
  receivedAt: string; // ISO-8601 UTC
}

export type WireResult =
  | { kind: "MATCH";    eventType: string; correlationId: string; timestamp: string; a: WireStreamPayload; b: WireStreamPayload; }
  | { kind: "MISMATCH"; eventType: string; correlationId: string; timestamp: string; a: WireStreamPayload; b: WireStreamPayload; }
  | { kind: "ORPHAN";   eventType: string; correlationId: string; timestamp: string; a?: WireStreamPayload; b?: WireStreamPayload; };

export interface SessionRequest {
  streamA: { url: string; headers: Record<string, string> };
  streamB: { url: string; headers: Record<string, string> };
  correlationPath: string;
}
```

•	No `any`, no non-null assertions on wire data. Narrow via `switch (result.kind)`.

**WebSocket lifecycle (`hooks/useEventStream.ts`).**
•	Single hook owns the `WebSocket`: connect on mount to `` `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` ``, auto-reconnect with exponential backoff (1s → 30s cap, ±20% jitter).
•	Expose `{ status: 'connecting'|'open'|'closed', last: WireResult | null, history: ReadonlyArray<WireResult>, nextReconnectAt: number | null }`. `nextReconnectAt` is `Date.now()` ms when the next reconnect fires, or `null` when connected / not scheduled — drives the header countdown (§4.2).
•	On each message: `JSON.parse`; ignore non-objects and messages without a string `kind`. (Malformed payloads may still reach child components if partially shaped — `ErrorBoundary` contains render faults.)
•	Use a `useRef` for the socket. `onerror` is intentionally empty; `onclose` drives reconnect.
•	Ring-buffer `history` at **2,000** items (see §4.4).

**REST helpers (`lib/api.ts`).**
•	`startSession(req)` → `POST /api/session/start`; success body is `{ status: "started" }` (HTTP **202**). Throw `ApiError` (`.status`, `.message`) on failure; parse `{ error: string }` from JSON when present.
•	`stopSession()` → `POST /api/session/stop`.
•	`fetchStats()` may exist for diagnostics; the UI counters are driven from the WebSocket, not polled.

**Client validation (`lib/validation.ts`).** Mirrors backend rules for immediate ConfigBar feedback (not a security boundary): `validateUrl` (http/https, no userinfo/fragment, ≤ 2 KiB), `validateHeadersText` (flat string map or `{}`), `validateCorrelationPath` (non-empty).

**Preferences (`lib/prefs.ts` + `hooks/usePrefs.ts`).** Keys: `ssediff:prefs`, `ssediff:ledgerWidth`, `ssediff:hasSeenOnboarding`. Ledger width clamped **320–720** px (default **420**). Load prefs synchronously in `useState` initializers to avoid flicker.

**Version chrome (`hooks/useServerVersion.ts`).** One-shot `GET /api/health` on mount; display `v{version}` in the header when available.

**State management.**
•	Local component state and a single top-level state in `App.tsx` (session config, selected event). No Redux/Zustand. Lift state only where ≥ 2 components need it. Prop drilling > 2 levels → introduce a React Context with a typed provider.

**Error boundaries.**
•	Wrap `EventLedger` and `DiffViewer` each in an `<ErrorBoundary>` (class component or `react-error-boundary` — implement locally, no dependency) that renders an inline error card with a "Reset" button. Never blank-screen the app.

**Accessibility (WCAG 2.1 AA target).**
•	Use semantic landmarks, one per zone in the 4.2 layout:
	•	**Status header** (sticky top) → `<header>` (the page-level banner landmark).
	•	**ConfigBar** → `<form aria-label="Stream configuration">` (it's a form: inputs + submit/cancel buttons).
	•	**Dashboard area** → `<main>`.
	•	**Event ledger panel** → `<aside aria-label="Event ledger">`.
	•	**Diff viewer panel** → `<section aria-label="Event payload diff">`.
•	The ledger is a `<table>` with `<thead>`/`<tbody>` and column `<th scope="col">`. Each row is keyboard-focusable (`tabIndex={0}`), activated via `Enter` or `Space`.
•	Filter toggles use `<button aria-pressed={isActive}>`. Color is never the sole signal — pair each state pill with a textual label (`MATCH`, `MISMATCH`, `ORPHAN`).
•	An `aria-live="polite"` region announces new mismatches/orphans, throttled to ≤ 4 announcements/sec to avoid screen-reader spam.
•	All interactive elements have visible focus rings (do not remove Tailwind's default `focus-visible:ring-*`).
•	`eslint-plugin-jsx-a11y` runs clean with the `recommended` ruleset.

**Performance.**
•	Memoize derived data with `useMemo`; memoize event-row components with `React.memo` and a stable `key` (`` `${kind}:${correlationId}:${timestamp}` ``).
•	No state update inside `useEffect` that lacks a guard against an infinite loop.
•	Avoid inline object/array literals in props of memoized children — hoist or `useMemo` them.

**Hooks discipline.**
•	Custom hooks named `use*`; one hook per concern. Return objects with named fields, not positional tuples > 2 elements.
•	No data fetching inside render; only inside effects or event handlers.

**Styling.**
•	Tailwind utility classes only; no inline `style={{}}` except for computed sizes. The state color map (`STATE_PILL_CLASSES: Record<ResultKind, string>`) and all other design tokens live in `lib/theme.ts` — see Section 4.2. `lib/wire.ts` holds only the protocol types, never colors or styling.

---

## 5. Distribution & Infrastructure Configuration

### 5.1 Multi-Stage Dockerfile (`/Dockerfile`)
Provide a single production-ready Dockerfile (`# syntax=docker/dockerfile:1.7`) with three stages:

	1.	**Stage `frontend`** — `node:22-alpine`. Copy `frontend/package.json` + `package-lock.json`, `npm ci --no-audit --no-fund`, copy sources, `npm run build`. Output: `/app/dist/`.
	2.	**Stage `backend`** — `golang:1.24-alpine`. Copy `go.mod`/`go.sum`, `go mod download`, copy sources. `ARG VERSION=dev`. Build: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/ssediff ./cmd/server`.
	3.	**Stage `runner`** — `alpine:3.20`. Install `ca-certificates`, **`tini`** (PID 1 signal forwarding), **`wget`** (healthcheck), **`tzdata`**. Create non-root user `appuser` (uid **10001**). Copy binary → `/app/ssediff`, frontend dist → `/app/public`. `WORKDIR /app`, `USER appuser:appuser`, `EXPOSE 8080`.

**Runner defaults (ENV):** `PORT=8080`, `BUFFER_TTL_MS=30000`, `LOG_LEVEL=INFO`, `PUBLIC_DIR=/app/public`.

**HEALTHCHECK:** `wget --quiet --spider --tries=1 http://127.0.0.1:8080/api/health` — interval 30s, timeout 3s, retries 3, start-period 5s.

**ENTRYPOINT:** `["/sbin/tini", "--", "/app/ssediff"]` — forwards `SIGTERM` for graceful shutdown (§3.4).

Build example: `docker build --build-arg VERSION=$(git describe --always --dirty) -t ssediff:local .`

### 5.2 Composition Layer (`/docker-compose.yml`)
Compose file (no top-level `version:` key) with one service `ssediff`:

```yaml
services:
  ssediff:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VERSION: ${VERSION:-dev}
    image: ssediff:local
    container_name: ssediff
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      BUFFER_TTL_MS: "30000"
      LOG_LEVEL: "INFO"
      PUBLIC_DIR: "/app/public"
      # ALLOW_PRIVATE_TARGETS: "true"   # lab only — see §3.6
      # INSECURE_SKIP_VERIFY: "true"    # lab only
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true   # MUST be a string (Compose rejects YAML map form)
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--spider", "--tries=1", "http://127.0.0.1:8080/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
```

`make up` passes `VERSION` from `git describe` into `docker compose build --build-arg VERSION=…`.

---

## 6. Verification Checklist
Before producing files, verify that the implementation satisfies every constraint. Each item must be defensible on inspection.

**Correctness & concurrency**
	1.	**Zero Data Races:** All state mutations on streaming collections execute behind `sync.Mutex` locks. `go vet ./...` and `go build -race ./...` are clean.
	2.	**Streaming Efficiency:** No upstream HTTP response is buffered whole; SSE frames stream and process chunk-by-chunk with bounded memory.
	3.	**Graceful Degradation:** Malformed JSON, oversize lines, missing correlation IDs, and empty SSE frames are logged at `WARN` and dropped; no panics on the backend; no unhandled exceptions in the browser (error boundaries catch component faults).
	4.	**Wire-Protocol Conformance:** JSON shapes emitted by `/api/*` and `/ws` match Section 3.5 byte-for-byte (camelCase keys, `ORPHAN` omits the missing side, ISO-8601 UTC timestamps with millisecond precision).
	5.	**Lifecycle Correctness:** `SIGTERM` shuts down within ~10s following the four-step order in §3.4 (HTTP → sessions → matcher → hub); no goroutine leaks (auditable via `runtime.NumGoroutine` before/after).

**Code quality (Section 1.1)**
	6.	**Lint clean:** `make lint` exits 0 — i.e. `gofmt -s`, `goimports`, `go vet`, `staticcheck`, `gocyclo -over 15`. Frontend: `npm run lint && npm run typecheck` exit 0 with zero warnings (treat warnings as errors).
	7.	**Complexity budget:** No Go or TS function exceeds cyclomatic complexity 15. Files exceeding 300 lines carry a top-of-file justification comment.
	8.	**Naming & comments:** No banned generic names (`data`, `info`, `manager`, `helper`, `utils`) at the top level. Every exported identifier has godoc/TSDoc. No commented-out code committed.
	9.	**Purity:** The matcher's resolution function is pure (no I/O, no `time.Now()` calls internally; time is injected). Demonstrable by reading the signature.
	10.	**Dependency direction:** `engine` imports neither `api` nor `stream`; `stream` does not import `api`. Verified by inspecting import lines.

**Security (Section 3.6)**
	11.	**SSRF defense active by default:** A `POST /api/session/start` with `http://127.0.0.1:9999/x` is rejected with a `400` and a clear message unless `ALLOW_PRIVATE_TARGETS=true`. Non-`http(s)` schemes and userinfo are rejected.
	12.	**Header hygiene:** User-supplied `Host`/`Content-Length`/`Transfer-Encoding`/`Connection`/`Upgrade`/`Proxy-*` headers are rejected with a clear `400`. `Authorization` values never appear in logs (always `[REDACTED]`).
	13.	**Body & header limits:** `/api/session/start` enforces 64 KiB body, ≤ 32 headers per stream, ≤ 8 KiB per header value, ≤ 2 KiB URL.
	14.	**TLS verified by default:** `INSECURE_SKIP_VERIFY=false` is the default; toggling it logs a `WARN` at startup.

**Observability (Section 3.6)**
	15.	**Structured logs:** Every log record at session scope carries `session_id`, `source`, `event_type`, `correlation_id` when applicable. Log level is controlled by `LOG_LEVEL` env var.
	16.	**Stats endpoint:** `GET /api/stats` returns `{matchCount, mismatchCount, orphanCount, bufferedItems, uptimeSeconds, activeWsClients}`; counters are `atomic.Int64`.

**Frontend (Section 4.6) + Visual UX (Section 4.2)**
	17.	**Type safety:** `tsc --noEmit` clean under `strict: true`; no `any`, no unjustified `@ts-ignore`, no non-null assertions on wire data. `WireResult` narrowed only via `switch (kind)`.
	18.	**Accessibility:** `eslint-plugin-jsx-a11y` recommended ruleset clean. Manual smoke: full keyboard navigation works; focus rings visible; color is never the sole state signal.
	19.	**Resilience:** Reloading the page mid-stream re-establishes the WebSocket via the reconnect backoff. A component fault renders an inline error card, not a blank page.
	20.	**Frontend Build:** `npm ci && npm run build` in `/frontend` produces `dist/` with no errors and no warnings.
	21.	**Visual & UX fidelity (Section 4.2):** The shipped UI matches the dark-first design tokens, three-zone layout, and component patterns. No bare hex colors in JSX; all colors flow from `lib/theme.ts`. Every panel renders a deliberate empty/loading/error state — no blank rectangles. Status header, live counters, session badge, connection dot, and onboarding tip are present and functional. The result is judged against the "Linear / Vercel / Stripe / Datadog" north star, not the default Tailwind look.

**Infrastructure**
	22.	**Image is non-root, minimal, and stateless:** final image runs as `appuser` via `tini`, contains `ca-certificates` + `wget` + `tzdata` + binary + `/app/public` assets, exposes 8080, passes healthcheck.
	23.	**Compose hardening:** `read_only: true`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]` (string form). `PUBLIC_DIR=/app/public` set explicitly.
	24.	**Dev ergonomics:** `make dev` opens UI at :5173 with proxy; `make run` / Docker serve UI from `PUBLIC_DIR`; missing bundle serves placeholder HTML, not an empty `#root`.

## 7. Testing Scope
Full test suites are **out of scope** for initial generation (no Vitest/Jest, no exhaustive `_test.go` coverage). The verification checklist (Section 6) is the acceptance bar.

**Optional regression test:** `backend/internal/api/mux_static_test.go` may assert that `GET /`, `GET /assets/*`, and missing asset paths return the expected status codes when wired through `RegisterRoutes`. This guards static SPA routing only.

Design for testability remains mandatory: pure `resolve.go`, hexagonal isolation, injected time in resolution, narrow constructors — so matcher/security/session tests can be added later without refactors.

## 8. Deviation Policy
The standards in Sections 1.1, 3.6, 4.2, and 4.6 are defaults, not absolutes. Deviating is permitted when a rule would materially harm clarity, correctness, or performance — but each deviation must be:
	1.	**Local** — confined to a single symbol or block.
	2.	**Explained** — a one-line godoc/TSDoc comment above the deviation states the reason (e.g. `// gocyclo:ignore — single switch over 18 SSE field tags is clearer flat than dispatched.`).
	3.	**Bounded** — no deviation suppresses a security, accessibility, wire-protocol, or design-token rule (Sections 3.6, 4.6 a11y, 3.5, 4.2 tokens). Those are non-negotiable.