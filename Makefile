.PHONY: help lint build run dev up down sync-public tidy clean

COMPOSE := docker compose

# Version is injected into the Go binary via ldflags so /api/health reports
# the actual git revision instead of the package-default "dev" value.
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

GOFILES := $(shell find backend -type f -name '*.go')

.DEFAULT_GOAL := help

help: ## Show available targets
	@echo "ssediff — make targets"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Run (pick one):"
	@echo "  make up            Docker Compose — API + UI on http://localhost:8080"
	@echo "  make dev           Local hot reload — UI :5173, API :8080"
	@echo "  make down          Stop and remove Docker Compose stack"
	@echo ""
	@echo "Frontend only (from frontend/):"
	@echo "  npm run lint       ESLint (zero warnings)"
	@echo "  npm run typecheck  tsc --noEmit"
	@echo "  npm run build      Production bundle → frontend/dist/"

lint: ## Run Go linters (gofmt, vet, goimports, staticcheck, gocyclo)
	cd backend && gofmt -s -l . | tee /dev/stderr | (! grep .)
	cd backend && go vet ./...
	@cd backend && if command -v goimports >/dev/null 2>&1; then \
		out=$$(goimports -l .); [ -z "$$out" ] || { echo "goimports drift:"; echo "$$out"; exit 1; }; \
	else echo "goimports not installed — skipping (install: go install golang.org/x/tools/cmd/goimports@latest)"; fi
	@cd backend && if command -v staticcheck >/dev/null 2>&1; then \
		staticcheck ./...; \
	else echo "staticcheck not installed — skipping (install: go install honnef.co/go/tools/cmd/staticcheck@latest)"; fi
	@cd backend && if command -v gocyclo >/dev/null 2>&1; then \
		out=$$(gocyclo -over 15 .); [ -z "$$out" ] || { echo "gocyclo > 15:"; echo "$$out"; exit 1; }; \
	else echo "gocyclo not installed — skipping (install: go install github.com/fzipp/gocyclo/cmd/gocyclo@latest)"; fi

build: ## Build static Go binary to ./bin/ssediff (VERSION from git)
	cd backend && CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o ../bin/ssediff ./cmd/server

sync-public: ## Build frontend and copy frontend/dist → ./public
	cd frontend && npm run build
	rm -rf public && mkdir -p public
	cp -R frontend/dist/. public/

run: build sync-public ## Build backend + UI locally (no Docker) on :8080
	./bin/ssediff

# Stop any existing Compose stack for this project so the next `make up` is clean.
down: ## Stop and remove Docker Compose containers (ssediff)
	@echo "Stopping ssediff containers…"
	@$(COMPOSE) down --remove-orphans --timeout 10 2>/dev/null || true
	@docker rm -f ssediff 2>/dev/null || true

# Rebuild image (frontend + backend) and run via Docker Compose on :8080.
up: down ## Stop old stack, rebuild, run API + UI in Docker on :8080
	@echo "Building ssediff image (frontend + backend)…"
	@VERSION=$(VERSION) $(COMPOSE) build --build-arg VERSION=$(VERSION)
	@echo ""
	@echo "Starting stack — open http://localhost:8080"
	@echo "Logs below. Ctrl+C stops containers; run 'make down' before the next 'make up'."
	@echo ""
	@VERSION=$(VERSION) $(COMPOSE) up

# Hot-reload dev: Go API on :8080, Vite on :5173 (proxies /api and /ws).
dev: ## Run backend + frontend locally; Ctrl+C stops both
	@echo "ssediff dev"
	@echo "  backend   http://localhost:8080  (/api, /ws)"
	@echo "  frontend  http://localhost:5173  (open this in the browser)"
	@echo ""
	@test -d frontend/node_modules || (echo "Installing frontend dependencies…" && cd frontend && npm ci)
	@trap 'kill 0' INT TERM; \
		( cd backend && CGO_ENABLED=0 go run -ldflags "$(LDFLAGS)" ./cmd/server ) & \
		( cd frontend && npm run dev ) & \
		wait

tidy: ## Run go mod tidy in backend/
	cd backend && go mod tidy

clean: ## Remove ./bin/ssediff
	rm -rf bin
