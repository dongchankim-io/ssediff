// Package api — session controller.
//
// SessionController owns the lifecycle of the two stream.Client workers
// (one per upstream feed). At most one session is active at a time;
// Start auto-cancels and waits for the prior session before resetting
// the matcher and spawning fresh workers (spec §3.4).
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/dongchankim-io/ssediff/backend/internal/engine"
	"github.com/dongchankim-io/ssediff/backend/internal/stream"
)

// sessionShutdownTimeout bounds how long Stop / Start-cancellation waits
// for the prior session's workers to drain (spec §3.6 "Hub.Stop() ...
// drain the WaitGroup with a 5s safety timeout").
const sessionShutdownTimeout = 5 * time.Second

// SessionControllerConfig bundles the controller's startup inputs.
// Required to keep the constructor under the 4-parameter soft cap.
type SessionControllerConfig struct {
	Matcher             *engine.StreamMatcher
	Logger              *slog.Logger
	UserAgent           string
	AllowPrivateTargets bool
	InsecureSkipVerify  bool
}

// SessionController serializes session start/stop and bridges the API
// layer to the SSE ingestion clients.
type SessionController struct {
	mu     sync.Mutex
	active *activeSession

	matcher             *engine.StreamMatcher
	logger              *slog.Logger
	userAgent           string
	allowPrivateTargets bool
	insecureSkipVerify  bool
}

// activeSession is the per-session bag of state. Recreated on every
// successful Start; nil between sessions.
type activeSession struct {
	id        string
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	startedAt time.Time
}

// NewSessionController builds a controller bound to a single matcher.
// Panics on nil matcher or logger — both are required.
func NewSessionController(cfg SessionControllerConfig) *SessionController {
	if cfg.Matcher == nil {
		panic("api: NewSessionController requires a matcher")
	}
	if cfg.Logger == nil {
		panic("api: NewSessionController requires a logger")
	}
	return &SessionController{
		matcher:             cfg.Matcher,
		logger:              cfg.Logger,
		userAgent:           cfg.UserAgent,
		allowPrivateTargets: cfg.AllowPrivateTargets,
		insecureSkipVerify:  cfg.InsecureSkipVerify,
	}
}

// ActiveSessionID returns the current session id or empty string if no
// session is active. Safe for concurrent reads.
func (s *SessionController) ActiveSessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return ""
	}
	return s.active.id
}

// Start cancels any prior session, resets the matcher, and spawns two
// stream.Client goroutines. Returns the new session id on success or a
// validation/SSRF error suitable for a 400 response.
func (s *SessionController) Start(ctx context.Context, req SessionRequest) (string, error) {
	if err := ValidateSessionRequest(&req); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.active != nil {
		s.cancelAndWaitLocked()
	}

	s.matcher.Reset(req.CorrelationPath)

	sessionCtx, cancel := context.WithCancel(context.Background())
	id := newSessionID()
	sessionLogger := s.logger.With("session_id", id)

	clientA, err := s.buildClient(ctx, engine.StreamA, req.StreamA, sessionLogger)
	if err != nil {
		cancel()
		return "", err
	}
	clientB, err := s.buildClient(ctx, engine.StreamB, req.StreamB, sessionLogger)
	if err != nil {
		cancel()
		return "", err
	}

	sess := &activeSession{id: id, cancel: cancel, startedAt: time.Now().UTC()}
	sess.wg.Add(2)
	go s.runClient(sessionCtx, clientA, &sess.wg, sessionLogger)
	go s.runClient(sessionCtx, clientB, &sess.wg, sessionLogger)
	s.active = sess

	sessionLogger.Info("session started",
		"correlation_path", req.CorrelationPath,
		"stream_a_url", req.StreamA.URL,
		"stream_b_url", req.StreamB.URL,
	)
	return id, nil
}

// Stop cancels the active session (idempotent) and waits with a bounded
// safety timeout for workers to drain.
func (s *SessionController) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active == nil {
		return
	}
	s.logger.Info("session stop requested", "session_id", s.active.id)
	s.cancelAndWaitLocked()
}

// buildClient constructs one stream.Client and returns its validation
// error verbatim so the API layer can surface it as a 400.
func (s *SessionController) buildClient(
	ctx context.Context,
	src engine.StreamSource,
	cfg SessionStream,
	logger *slog.Logger,
) (*stream.Client, error) {
	return stream.NewClient(ctx, stream.Config{
		Source:              src,
		URL:                 cfg.URL,
		Headers:             cfg.Headers,
		Matcher:             s.matcher,
		Logger:              logger,
		UserAgent:           s.userAgent,
		AllowPrivateTargets: s.allowPrivateTargets,
		InsecureSkipVerify:  s.insecureSkipVerify,
	})
}

// runClient is the per-worker entry point. Logs the terminal state and
// decrements the session WaitGroup.
func (s *SessionController) runClient(ctx context.Context, c *stream.Client, wg *sync.WaitGroup, logger *slog.Logger) {
	defer wg.Done()
	if err := c.Run(ctx); err != nil && ctx.Err() == nil {
		logger.Warn("stream client exited with error", "err", err)
	}
}

// cancelAndWaitLocked cancels the active session and waits for both
// stream workers to drain. Honours the spec §3.6 5 s safety timeout: if
// it fires, log ERROR with a goroutine stack dump and proceed.
//
// Caller must hold s.mu.
func (s *SessionController) cancelAndWaitLocked() {
	prev := s.active
	if prev == nil {
		return
	}
	prev.cancel()
	done := make(chan struct{})
	go func() {
		prev.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(sessionShutdownTimeout):
		buf := make([]byte, 1<<16)
		n := runtime.Stack(buf, true)
		s.logger.Error("session shutdown safety timeout exceeded; goroutines may be leaked",
			"session_id", prev.id,
			"timeout_seconds", int(sessionShutdownTimeout.Seconds()),
			"goroutine_dump", string(buf[:n]),
		)
	}
	s.active = nil
}

// newSessionID returns 8 random hex bytes — short, opaque, unique enough
// for log correlation. crypto/rand to avoid clashes across restarts.
func newSessionID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("ts-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}
