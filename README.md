# ssediff

### High-performance, real-time visual diffing for Server-Sent Events (SSE) streams.

[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://docs.docker.com/)
[![Go Version](https://img.shields.io/badge/go-1.24-blue.svg)](https://golang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Traditional API diffing tools expect static payloads and fail when testing continuous, asynchronous data streams. **ssediff** bridges this gap. It is a standalone, production-ready developer utility designed to ingest, temporally align, and perform granular 1-to-1 structural diffs on live SSE streams without blocking your data pipelines or blowing up your RAM.

## Key Architecture Pillars

* **⚡ Blazing Fast Go Engine:** Leverages Go's native multi-threaded concurrency model (goroutines) to ingest multiple high-throughput API streams simultaneously across separate CPU threads.
* **🧠 Zero-Allocation ID Extraction:** Utilizes `gjson` to execute dynamic path extraction directly on raw byte streams, entirely avoiding generic, heavy JSON unmarshaling into maps.
* **🛡️ Anti-Memory Leak Infrastructure:** Implements a proactive background eviction ticker that safely clears stale unmatched events via a strict Time-To-Live (TTL) configuration, keeping the host container light and stateless.
* **🎨 Interactive Visual Diff Terminal:** A modern React + Tailwind web UI that maps incoming stream statuses (`MATCH`, `MISMATCH`, `ORPHAN`) in real-time, featuring a clean side-by-side git-style code diff viewer.
* **🐋 Zero-Friction Single Container:** Built as an ultra-lightweight multi-stage Docker image (~35MB). The compiled static Go binary serves the compiled React assets natively on a single exposed port—no external proxies or complex web servers required.

## Getting Started

### Run with Docker

```bash
docker build --build-arg VERSION=$(git describe --always --dirty) -t ssediff .
docker run --rm -p 8080:8080 ssediff
# open http://localhost:8080
```

### Run with Docker Compose

```bash
docker compose up --build
```

### Run from source (single binary)

```bash
make run   # builds backend, syncs frontend/dist → ./public, listens on :8080
# open http://localhost:8080
```

### Run from source (dev — hot reload)

```bash
# Terminal 1 — backend
make build && ./bin/ssediff

# Terminal 2 — frontend (proxies /api + /ws to :8080)
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

## Configuration

All runtime configuration is via environment variables (read once at process start; spec §3.2):

| Variable                 | Default | Description |
| ------------------------ | ------- | ----------- |
| `PORT`                   | `8080`  | HTTP listen port. |
| `BUFFER_TTL_MS`          | `30000` | Time an unmatched event stays in the matcher before becoming an `ORPHAN`. Not exposed in the UI. |
| `LOG_LEVEL`              | `INFO`  | One of `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `PUBLIC_DIR`             | `./public` | Directory containing the built React bundle. |
| `ALLOW_PRIVATE_TARGETS`  | `false` | When `true`, lets the backend connect to RFC1918, loopback, and link-local hosts. Leave off in production. |
| `INSECURE_SKIP_VERIFY`   | `false` | When `true`, skips TLS verification for upstream SSE endpoints. Emits a `WARN` log on startup. Leave off in production. |

## Security defaults

* SSRF defense is on by default — `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and link-local v6 are blocked unless `ALLOW_PRIVATE_TARGETS=true`.
* DNS rebinding is mitigated by pinning the resolved IP for the lifetime of the connection.
* `Authorization` header values are redacted (`[REDACTED]`) in all log output.
* Request bodies on `/api/session/start` are capped at 64 KiB; URLs at 2 KiB; ≤ 32 headers per stream; ≤ 8 KiB per header value.

## Development workflow

* `make lint` — gofmt, go vet, goimports, staticcheck, gocyclo (Go side).
* `cd frontend && npm run lint && npm run typecheck && npm run build` — TS lint + type check + production bundle.
* `make build` — builds a versioned static Go binary into `./bin/ssediff`.
