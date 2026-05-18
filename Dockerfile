# syntax=docker/dockerfile:1.7

# ssediff — production image
#
# Three-stage build:
#   1. frontend   — Vite production bundle (node:22-alpine)
#   2. backend    — Go binary (golang:1.24-alpine) with version ldflags
#   3. runner     — alpine:3.20 + ca-certificates + tini + non-root user
#
# Image goals:
#   - <50 MB compressed (alpine + statically linked Go + minified JS)
#   - Non-root runtime, read-only filesystem-friendly
#   - HEALTHCHECK against /api/health so orchestrators can detect stalls
#   - Graceful shutdown: tini forwards SIGTERM, server completes drain
#
# Build with a real version:
#   docker build --build-arg VERSION=$(git describe --always --dirty) -t ssediff .

ARG NODE_IMAGE=node:22-alpine
ARG GO_IMAGE=golang:1.24-alpine
ARG RUNNER_IMAGE=alpine:3.20

# ---------- Stage 1: Frontend ----------
FROM ${NODE_IMAGE} AS frontend
WORKDIR /app
# Copy only manifests first so the dependency layer caches independently
# of source changes.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: Backend ----------
FROM ${GO_IMAGE} AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
ARG BUILDTIME=unknown
# CGO disabled for fully static linkage so we can run on a minimal
# Alpine base without libc compatibility surprises.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
      -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" \
      -o /out/ssediff \
      ./cmd/server

# ---------- Stage 3: Runner ----------
FROM ${RUNNER_IMAGE} AS runner

# tini  — clean PID 1, forwards signals to the Go binary.
# ca-certificates — outbound TLS to upstream SSE endpoints.
# wget  — used by HEALTHCHECK.
# tzdata — IANA zone data (avoids "Local" surprises in structured logs).
RUN apk add --no-cache ca-certificates tini wget tzdata && \
    addgroup -S appuser && \
    adduser -S -G appuser -u 10001 -h /nonexistent -s /sbin/nologin appuser

WORKDIR /app
COPY --from=backend  /out/ssediff       /app/ssediff
COPY --from=frontend /app/dist          /app/public

# Drop privileges before runtime. The binary listens on 8080 (non-
# privileged), so root is never required.
USER appuser:appuser

# Environment defaults — every value documented in the spec §3.2.
ENV PORT=8080 \
    BUFFER_TTL_MS=30000 \
    LOG_LEVEL=INFO \
    PUBLIC_DIR=/app/public

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --spider --tries=1 http://127.0.0.1:8080/api/health || exit 1

# tini reaps zombies and forwards SIGTERM so the Go graceful-shutdown
# path can drain in-flight requests cleanly.
ENTRYPOINT ["/sbin/tini", "--", "/app/ssediff"]
