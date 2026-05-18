// Package main is the ssediff server entry point. In Slice 001 this is a
// minimal skeleton serving only /api/health so the rest of the toolchain
// (Docker, compose, lint, build) can be exercised end-to-end. Later slices
// extend this composition root to wire the matcher, hub, and full routing.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// redactedAuthorization is the literal value substituted in log output
// anywhere an "Authorization" attribute appears (spec §3.6).
const redactedAuthorization = "[REDACTED]"

// version is overridden at build time via -ldflags "-X main.version=...".
// It is reported in /api/health so operators can distinguish builds.
var version = "dev"

// shutdownTimeout bounds how long graceful shutdown will wait for in-flight
// requests to drain before forcibly returning.
const shutdownTimeout = 10 * time.Second

// Config is the parsed startup configuration. Every field is read from an
// environment variable at startup; invalid values cause the process to exit
// with a clear error rather than silently defaulting.
type Config struct {
	Port     int
	LogLevel slog.Level
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config error:", err)
		os.Exit(2)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:       cfg.LogLevel,
		ReplaceAttr: redactSensitiveAttrs,
	}))
	slog.SetDefault(logger)
	logger.Info("starting ssediff",
		"version", version,
		"port", cfg.Port,
		"log_level", cfg.LogLevel.String(),
	)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	if err := runUntilSignal(server, logger); err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
	logger.Info("server stopped cleanly")
}

// loadConfig reads and validates startup environment variables.
func loadConfig() (Config, error) {
	cfg := Config{
		Port:     8080,
		LogLevel: slog.LevelInfo,
	}
	if raw, ok := os.LookupEnv("PORT"); ok {
		port, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("PORT must be a TCP port in [1,65535], got %q", raw)
		}
		cfg.Port = port
	}
	if raw, ok := os.LookupEnv("LOG_LEVEL"); ok {
		level, err := parseLogLevel(raw)
		if err != nil {
			return Config{}, err
		}
		cfg.LogLevel = level
	}
	return cfg, nil
}

// redactSensitiveAttrs is a slog.ReplaceAttr that scrubs known-sensitive
// attribute values before they're emitted by the JSON handler. Currently
// matches "Authorization" case-insensitively (spec §3.6).
func redactSensitiveAttrs(_ []string, a slog.Attr) slog.Attr {
	if strings.EqualFold(a.Key, "authorization") {
		return slog.String(a.Key, redactedAuthorization)
	}
	return a
}

// parseLogLevel turns a case-insensitive string into a slog.Level. It rejects
// unknown values rather than defaulting silently.
func parseLogLevel(raw string) (slog.Level, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "DEBUG":
		return slog.LevelDebug, nil
	case "INFO":
		return slog.LevelInfo, nil
	case "WARN", "WARNING":
		return slog.LevelWarn, nil
	case "ERROR":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("LOG_LEVEL must be one of DEBUG/INFO/WARN/ERROR, got %q", raw)
	}
}

// runUntilSignal starts the HTTP server and blocks until SIGINT/SIGTERM, at
// which point it triggers a bounded graceful shutdown.
func runUntilSignal(server *http.Server, logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	listenErr := make(chan error, 1)
	go func() {
		logger.Info("http listening", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
			return
		}
		listenErr <- nil
	}()

	select {
	case err := <-listenErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http shutdown: %w", err)
	}
	return nil
}

// healthHandler returns a small JSON document including the build version,
// so operators can verify deployments without a separate /version endpoint.
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": version,
	})
}
