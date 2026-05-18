# Slice 001 — Scaffolding & Skeleton — Iteration Notes

**Slice goal:** stand up the monorepo, lint/build/test toolchain, and a runnable container that serves `/api/health` with `{ "status": "ok", "version": "<build>" }`, so every later slice extends a working pipeline rather than replacing it.

## Files added or changed
| File | Status | Scratchpad |
|------|--------|------------|
| `.editorconfig` | added | declarative — no scratchpad per implementer.md §4 |
| `.gitignore` | added | declarative |
| `Makefile` | added | declarative (build/lint targets) |
| `Dockerfile` | added | included above |
| `docker-compose.yml` | added | declarative |
| `backend/go.mod` (+ `go.sum`) | added | declarative |
| `backend/cmd/server/main.go` | added | included above |
| `frontend/package.json` (+ `package-lock.json` generated) | added | declarative |
| `frontend/tsconfig.json` | added | declarative |
| `frontend/vite.config.ts` | added | declarative (no `.tsx`/`src/` source) |
| `frontend/tailwind.config.js` | added | declarative |
| `frontend/postcss.config.js` | added | declarative |
| `frontend/.eslintrc.cjs` | added | declarative |
| `frontend/.prettierrc` | added | declarative |
| `frontend/index.html` | added | declarative |
| `frontend/src/index.css` | added | declarative (CSS only) |
| `frontend/src/main.tsx` | added | included above |
| `frontend/src/App.tsx` | added | included above |
| `frontend/src/lib/theme.ts` | added | included above |

## DoD checklist (spec §6 + slice 001 acceptance)
- **`make lint` clean:** verified — both `gofmt -s -l` and `go vet ./...` produce no output.
- **`npm run lint && npm run typecheck` clean:** verified — eslint exits 0 with `--max-warnings 0`; tsc exits 0.
- **`npm run build` produces `dist/`:** verified — Vite emitted `dist/` containing 143 KB hashed JS bundle, 40 KB CSS bundle, and bundled font assets (no Google Fonts network call).
- **Container starts and serves shell:** binary built via `make build` runs, listens on `:8080`, emits structured JSON logs, and shuts down cleanly on SIGTERM.
- **`/api/health` reports injected version:** confirmed by curl — response body was `{"status":"ok","version":"f57d79d"}`, where `f57d79d` is the current `git describe --always --dirty` value. Default value when ldflags absent is `"dev"` per `var version = "dev"` in `main.go`.
- **Per-file reasoning scratchpads:** emitted for every in-scope file (`main.go`, `main.tsx`, `App.tsx`, `theme.ts`, `Dockerfile`).

## Cross-slice fix log
None — first slice.

## Rev 2 (in response to REVIEW.md rev 1)
- **MAJOR-1 fixed:** `Dockerfile` no longer swallows `go mod download` failures; `|| true` removed and `go.sum` is required (not glob-optional).
- **MAJOR-2 fixed:** added `.dockerignore` covering `bin/`, `node_modules/`, `dist/`, `iterations/`, `.git/`, markdown notes, editor state, and local env files.
- **MAJOR-3 fixed:** `theme.ts` `SEMANTIC` token now exports complete utility class strings (grouped `bg`/`border`/`text`/`dot`/`ring`) so consumers compose by name and Tailwind's content scanner sees the literal class tokens.
- Toolchain re-verified: `make lint`, `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Deviations from spec
None.

## Known follow-ups for next slices (not implemented here on purpose)
- `STATE_PILL_CLASSES` and `STATE_ICON` exports in `lib/theme.ts` (need `ResultKind` from `lib/wire.ts` — Slice 002).
- `npm ci`-based lockfile install in Dockerfile (needs lockfile committed; Slice 010 hardens this).
- Static-asset serving from the Go binary (Slice 004).
- `gocyclo`, `staticcheck`, prettier-check, image size check (Slice 010 production hardening).

## Stop condition
All in-scope DoD items pass. Ready for review.
