.PHONY: lint build run tidy clean

# Version is injected into the Go binary via ldflags so /api/health reports
# the actual git revision instead of the package-default "dev" value.
VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

GOFILES := $(shell find backend -type f -name '*.go')

lint:
	cd backend && gofmt -s -l . | tee /dev/stderr | (! grep .)
	cd backend && go vet ./...

build:
	cd backend && CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o ../bin/ssediff ./cmd/server

run: build
	./bin/ssediff

tidy:
	cd backend && go mod tidy

clean:
	rm -rf bin
