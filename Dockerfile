# Slice 001 skeleton Dockerfile. Slice 010 replaces this with a fully
# hardened multi-stage build (non-root user, ldflags-injected version, ca
# bundle, image-size budget under 50 MB). Keep this minimal so the pipeline
# compiles end-to-end during early iterations.

# ---------- Stage 1: Frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: Backend ----------
FROM golang:1.24-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/ssediff ./cmd/server

# ---------- Stage 3: Runner ----------
FROM alpine:3.20 AS runner
WORKDIR /app
COPY --from=backend /out/ssediff /app/ssediff
COPY --from=frontend /app/dist /app/public
EXPOSE 8080
ENTRYPOINT ["/app/ssediff"]
