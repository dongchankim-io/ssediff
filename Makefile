.PHONY: lint build run tidy clean

# Version is injected into the Go binary via ldflags so /api/health reports
# the actual git revision instead of the package-default "dev" value.
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

GOFILES := $(shell find backend -type f -name '*.go')

lint:
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

build:
	cd backend && CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o ../bin/ssediff ./cmd/server

run: build
	./bin/ssediff

tidy:
	cd backend && go mod tidy

clean:
	rm -rf bin
