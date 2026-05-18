# GEMINI.md - ssediff

This file provides context and instructions for the `ssediff` project, a high-performance, real-time visual diffing utility for Server-Sent Events (SSE) streams.

## Project Overview
`ssediff` is designed to ingest, temporally align, and perform granular 1-to-1 structural diffs on live SSE streams. It bridges the gap for testing continuous, asynchronous data streams where traditional static API diffing tools fail.

### Key Features
- **Real-time Stream Ingestion:** Multi-threaded Go engine for simultaneous high-throughput stream processing.
- **Zero-Allocation Extraction:** Efficient JSON path extraction using `gjson` to avoid heavy unmarshaling.
- **Memory Management:** Proactive TTL-based eviction to prevent memory leaks in long-running stream comparisons.
- **Visual Diffing:** React-based UI for side-by-side git-style diffs and real-time status tracking (`MATCH`, `MISMATCH`, `ORPHAN`).

## Technology Stack
- **Backend:** Go 1.24
- **Frontend:** React, TypeScript, Tailwind CSS, Vite
- **Deployment:** Docker, Docker Compose

## Planned Architecture
The project is structured as a monorepo:
- `backend/`: Core logic, stream clients, and API hub.
- `frontend/`: Interactive dashboard and diff viewer.
- `Dockerfile` & `docker-compose.yml`: Single-container orchestration.

## Development Guidelines
- **Clean Architecture:** Maintain strict separation between engine, stream, and API layers.
- **Performance First:** Prioritize concurrency and memory efficiency in the backend.
- **Idiomatic Code:** Follow Go and TypeScript best practices and conventions.
- **Documentation:** Ensure all components are well-documented and typed.

## Building and Running (TODO)
*The project is currently in the initialization phase. The following commands are inferred based on the tech stack.*

### Backend
```bash
# From the root directory
cd backend
go mod tidy
go run cmd/server/main.go
```

### Frontend
```bash
# From the root directory
cd frontend
npm install
npm run dev
```

### Docker
```bash
# From the root directory
docker-compose up --build
```
