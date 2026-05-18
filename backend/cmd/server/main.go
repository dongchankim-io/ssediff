// Package main is the ssediff server entry point.
//
// This is the composition root and nothing else: it parses env into a
// Config, constructs the matcher, session controller, hub, and HTTP
// server, then handles graceful shutdown in the documented order
// (matcher-aware; no panic on shutdown).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dongchankim-io/ssediff/backend/internal/api"
	"github.com/dongchankim-io/ssediff/backend/internal/engine"
)

// version is overridden at build time via -ldflags "-X main.version=...".
// It is reported in /api/health so operators can distinguish builds.
var version = "dev"

// redactedAuthorization is the literal value substituted in log output
// anywhere an "Authorization" attribute appears (spec §3.6).
const redactedAuthorization = "[REDACTED]"

// shutdownTimeout bounds how long graceful shutdown will wait for in-
// flight HTTP requests to drain before forcibly returning.
const shutdownTimeout = 10 * time.Second

// defaultPort, defaultBufferTTL, defaultPublicDir are the spec §3.4
// defaults applied when an env var is unset.
const (
	defaultPort      = 8080
	defaultBufferTTL = 30 * time.Second
	defaultPublicDir = "./public"
)

// Config is the parsed startup configuration. Every field is derived
// from an env var; invalid values cause the process to exit with code 2
// rather than silently defaulting.
type Config struct {
	Port                int
	BufferTTL           time.Duration
	LogLevel            slog.Level
	AllowPrivateTargets bool
	InsecureSkipVerify  bool
	PublicDir           string
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
		"buffer_ttl_ms", cfg.BufferTTL/time.Millisecond,
		"public_dir", cfg.PublicDir,
	)
	if cfg.AllowPrivateTargets {
		logger.Warn("ALLOW_PRIVATE_TARGETS=true — SSRF defense bypassed; do not use in production")
	}
	if cfg.InsecureSkipVerify {
		logger.Warn("INSECURE_SKIP_VERIFY=true — upstream TLS certificates not verified; do not use in production")
	}

	matcher := engine.NewStreamMatcher(cfg.BufferTTL, "id")
	sessions := api.NewSessionController(api.SessionControllerConfig{
		Matcher:             matcher,
		Logger:              logger,
		UserAgent:           "ssediff/" + version,
		AllowPrivateTargets: cfg.AllowPrivateTargets,
		InsecureSkipVerify:  cfg.InsecureSkipVerify,
	})
	hub := api.NewHub(matcher, logger)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.RoutesConfig{
		Hub:       hub,
		Sessions:  sessions,
		Version:   version,
		PublicDir: cfg.PublicDir,
		Logger:    logger,
	})

	hubCtx, stopHub := context.WithCancel(context.Background())
	defer stopHub()
	var hubWG sync.WaitGroup
	hubWG.Add(1)
	go func() {
		defer hubWG.Done()
		hub.Run(hubCtx)
	}()

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	if err := runUntilSignal(server, sessions, matcher, stopHub, &hubWG, logger); err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
	logger.Info("server stopped cleanly")
}

// loadConfig reads and validates startup environment variables.
func loadConfig() (Config, error) {
	cfg := Config{
		Port:      defaultPort,
		BufferTTL: defaultBufferTTL,
		LogLevel:  slog.LevelInfo,
		PublicDir: defaultPublicDir,
	}
	if raw, ok := os.LookupEnv("PORT"); ok {
		port, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("PORT must be a TCP port in [1,65535], got %q", raw)
		}
		cfg.Port = port
	}
	if raw, ok := os.LookupEnv("BUFFER_TTL_MS"); ok {
		ms, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || ms <= 0 {
			return Config{}, fmt.Errorf("BUFFER_TTL_MS must be a positive integer, got %q", raw)
		}
		cfg.BufferTTL = time.Duration(ms) * time.Millisecond
	}
	if raw, ok := os.LookupEnv("LOG_LEVEL"); ok {
		level, err := parseLogLevel(raw)
		if err != nil {
			return Config{}, err
		}
		cfg.LogLevel = level
	}
	if raw, ok := os.LookupEnv("ALLOW_PRIVATE_TARGETS"); ok {
		b, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return Config{}, fmt.Errorf("ALLOW_PRIVATE_TARGETS must be true/false, got %q", raw)
		}
		cfg.AllowPrivateTargets = b
	}
	if raw, ok := os.LookupEnv("INSECURE_SKIP_VERIFY"); ok {
		b, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return Config{}, fmt.Errorf("INSECURE_SKIP_VERIFY must be true/false, got %q", raw)
		}
		cfg.InsecureSkipVerify = b
	}
	if raw, ok := os.LookupEnv("PUBLIC_DIR"); ok {
		cfg.PublicDir = strings.TrimSpace(raw)
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

// runUntilSignal starts the HTTP server and blocks until SIGINT/SIGTERM,
// at which point it triggers the spec §3.4 graceful shutdown order:
// HTTP → sessions → matcher → hub.
func runUntilSignal(
	server *http.Server,
	sessions *api.SessionController,
	matcher *engine.StreamMatcher,
	stopHub context.CancelFunc,
	hubWG *sync.WaitGroup,
	logger *slog.Logger,
) error {
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

	return shutdownInOrder(server, sessions, matcher, stopHub, hubWG, logger)
}

// shutdownInOrder performs the spec §3.4 shutdown sequence with bounded
// timeouts at each step. Failures are logged but don't short-circuit
// later steps — we want every cleanup phase to run.
func shutdownInOrder(
	server *http.Server,
	sessions *api.SessionController,
	matcher *engine.StreamMatcher,
	stopHub context.CancelFunc,
	hubWG *sync.WaitGroup,
	logger *slog.Logger,
) error {
	logger.Info("shutdown step 1/4: stop accepting http")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown error", "err", err)
	}
	logger.Info("shutdown step 2/4: stop sessions")
	sessions.Stop()
	logger.Info("shutdown step 3/4: close matcher")
	matcher.Close()
	logger.Info("shutdown step 4/4: stop hub and wait")
	stopHub()
	hubWG.Wait()
	return nil
}
