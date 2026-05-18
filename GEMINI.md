# GEMINI.md — ssediff Project Context

This file serves as the foundational instructional context for the `ssediff` project. All agents and developers must adhere to the standards and workflows defined herein.

## 1. Project Identity & Purpose
`ssediff` is a high-performance, enterprise-grade utility for real-time visual diffing of Server-Sent Events (SSE) streams. It is designed to ingest, align, and perform granular structural diffs on live asynchronous data streams without blocking pipelines or excessive memory usage.

## 2. The Iterative Build Workflow (MANDATORY)
This project follows a strict, iterative two-agent loop as defined in `ssediff-workflow.md`. 

### The Core Loop:
1.  **Implementer Agent:** Reads `ssediff-implementer.md` and `ssediff-spec.md`. Generates code for a specific slice, including a mandatory "Per-File Reasoning Scratchpad".
2.  **Reviewer Agent:** Reads `ssediff-reviewer.md` and `ssediff-spec.md`. Performs an adversarial audit. Acceptance requires zero CRITICAL and zero MAJOR findings.
3.  **Repetition:** The loop continues until the Reviewer accepts the slice.

**Routing:**
- **Implementer:** Refer to `ssediff-implementer.md` for role mandates and the slice plan.
- **Reviewer:** Refer to `ssediff-reviewer.md` for the severity rubric and audit procedures.

## 3. Core Technical Mandates
All code must conform to the **`ssediff-spec.md`**, which is the single source of truth for requirements.

### Quality & Architecture
- **Clean Architecture:** Hexagonal layout with I/O at the edges and a pure, dependency-free core (`engine`).
- **Clean Code:** Pragmatic adherence to naming, function size (≤30 lines), and complexity (Cyclomatic ≤ 15) standards.
- **Performance:** Multi-threaded Go engine, zero-allocation JSON path extraction via `gjson`, and proactive TTL-based memory eviction.
- **Type Safety:** Strict TypeScript (`strict: true`) and idiomatic, fully-typed Go 1.24.

### Security & Compliance
- **SSRF Defense:** Mandatory host resolution and CIDR check on all user-supplied URLs.
- **Secret Protection:** `Authorization` headers must be redacted in logs (`[REDACTED]`).
- **Accessibility:** WCAG 2.1 AA target. Semantic HTML, ARIA labels, and keyboard navigability are non-negotiable.

## 4. Project Structure
The project is a monorepo with the following layout:
- `backend/`: Go 1.24 server (`internal/engine`, `internal/stream`, `internal/api`).
- `frontend/`: React + Vite + Tailwind CSS + TypeScript dashboard.
- `Dockerfile` & `docker-compose.yml`: Multi-stage, non-root, hardened containerization.

## 5. Operational Commands

### Root Makefile
- `make lint`: Runs all backend and frontend linters/type-checks.
- `make build`: Compiles the Go binary with version metadata injection.
- `make run`: Runs the application locally.

### Backend (Go)
```bash
cd backend
go mod tidy
go run cmd/server/main.go
```

### Frontend (React)
```bash
cd frontend
npm install
npm run dev   # Development with HMR and proxy to backend
npm run build # Production build to dist/
```

### Docker
```bash
docker compose up --build
```

## 6. Deviation Policy
Deviations from standards are permitted only when justified. Every deviation must be documented with a one-line comment (`// gocyclo:ignore ...` or similar) explaining the rationale. Security and accessibility rules cannot be bypassed.
