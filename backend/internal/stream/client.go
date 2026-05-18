// Package stream — SSE ingestion client.
//
// The Client establishes one long-lived HTTP connection to an upstream
// SSE endpoint, parses frames line-by-line under a 1 MiB cap, and pushes
// each frame into the engine.StreamMatcher. It auto-reconnects with
// jittered exponential backoff (spec §3.3) and enforces every spec §3.6
// network-side guarantee (SSRF, header hygiene, TLS verification by
// default, HTTP transport tuning).
//
// One Client per upstream feed; A and B are independent goroutines that
// only share the matcher.
package stream

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/dongchankim-io/ssediff/backend/internal/engine"
)

// Tuning constants. Spec §3.6 "HTTP client tuning" + §3.3 reconnect
// policy. Centralized so the policy is auditable in one place.
const (
	maxLineBytes          = 1 << 20 // 1 MiB per SSE line
	initialReadBufBytes   = 64 << 10
	backoffInitial        = 1 * time.Second
	backoffMax            = 30 * time.Second
	backoffJitterFraction = 0.20

	dialTimeout           = 10 * time.Second
	responseHeaderTimeout = 10 * time.Second
	idleConnTimeout       = 90 * time.Second
	expectContinueTimeout = 1 * time.Second
	maxIdleConnsPerClient = 10
)

// Config bundles the inputs NewClient needs. Using a struct keeps the
// constructor under the spec §1.1 "≤ 4 params" rule and makes adding
// future knobs (rate limit, sample rate) cheap.
type Config struct {
	Source              engine.StreamSource
	URL                 string
	Headers             map[string]string
	Matcher             *engine.StreamMatcher
	Logger              *slog.Logger
	UserAgent           string
	AllowPrivateTargets bool
	InsecureSkipVerify  bool
}

// Client is a single-stream SSE ingestion worker. Construct with
// NewClient; drive with Run.
type Client struct {
	source     engine.StreamSource
	url        *url.URL
	headers    http.Header
	matcher    *engine.StreamMatcher
	logger     *slog.Logger
	httpClient *http.Client
	userAgent  string
}

// NewClient validates inputs, resolves and pins the upstream IP (DNS-
// rebinding defense), and constructs a tuned http.Transport. Returns a
// validation error on any of: bad URL shape, denied scheme/userinfo/
// fragment, denied header name, or no allowed IP for the target host.
func NewClient(ctx context.Context, cfg Config) (*Client, error) {
	if cfg.Source != engine.StreamA && cfg.Source != engine.StreamB {
		return nil, fmt.Errorf("stream: source must be %q or %q (got %q)", engine.StreamA, engine.StreamB, cfg.Source)
	}
	if cfg.Matcher == nil {
		return nil, errors.New("stream: matcher must not be nil")
	}
	if cfg.Logger == nil {
		return nil, errors.New("stream: logger must not be nil")
	}

	parsedURL, err := ValidateURL(cfg.URL)
	if err != nil {
		return nil, err
	}

	cleanHeaders, err := buildHeaders(cfg.Headers)
	if err != nil {
		return nil, err
	}

	pinnedIP, port, err := ResolveAndPin(ctx, parsedURL, cfg.AllowPrivateTargets)
	if err != nil {
		return nil, err
	}

	transport := newTransport(parsedURL.Hostname(), pinnedIP, port, cfg.InsecureSkipVerify)

	logger := cfg.Logger.With("source", string(cfg.Source))

	return &Client{
		source:    cfg.Source,
		url:       parsedURL,
		headers:   cleanHeaders,
		matcher:   cfg.Matcher,
		logger:    logger,
		userAgent: cfg.UserAgent,
		httpClient: &http.Client{
			Transport: transport,
			// No Client.Timeout — SSE bodies are long-lived. Cancellation
			// is driven by request.Context() (set in streamOnce).
		},
	}, nil
}

// Run drives the connection lifecycle. Blocks until ctx is cancelled or
// the matcher is closed; on any other error it logs WARN and retries
// with jittered exponential backoff.
func (c *Client) Run(ctx context.Context) error {
	c.logger.Info("sse client starting", "url", c.url.Redacted())
	backoff := backoffInitial
	for {
		if err := ctx.Err(); err != nil {
			c.logger.Info("sse client stopping", "reason", err)
			return err
		}
		received, err := c.streamOnce(ctx)
		switch {
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return ctx.Err()
		case errors.Is(err, engine.ErrMatcherClosed):
			c.logger.Info("matcher closed; stopping")
			return nil
		case received:
			backoff = backoffInitial
		}
		if err != nil {
			c.logger.Warn("sse session ended; will retry",
				"err", err,
				"next_retry_ms", backoff/time.Millisecond,
				"received_any", received,
			)
		}
		wait := jitterBackoff(backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
		if !received {
			backoff = grow(backoff)
		}
	}
}

// streamOnce establishes one HTTP connection and parses frames until the
// stream ends or an error occurs. Returns whether any frame was
// successfully ingested, plus the terminating error (if any).
func (c *Client) streamOnce(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url.String(), nil)
	if err != nil {
		return false, fmt.Errorf("build request: %w", err)
	}
	for k, vs := range c.headers {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("connect: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return false, fmt.Errorf("upstream returned %s", resp.Status)
	}
	c.logger.Info("sse session connected", "status", resp.Status)
	return c.parseStream(resp.Body)
}

// buildHeaders validates user-supplied headers and copies them into an
// http.Header. Returns an error on the first deny-listed name.
func buildHeaders(in map[string]string) (http.Header, error) {
	out := make(http.Header, len(in))
	for name, value := range in {
		if err := ValidateHeaderName(name); err != nil {
			return nil, err
		}
		out.Add(name, value)
	}
	return out, nil
}

// newTransport builds the spec §3.6-tuned Transport with a DialContext
// that always dials the pre-pinned IP. The original hostname is kept in
// TLS ServerName so SNI / cert verification still target the right name.
func newTransport(hostname string, pinnedIP net.IP, port string, insecureSkipVerify bool) *http.Transport {
	dest := net.JoinHostPort(pinnedIP.String(), port)
	dialer := &net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, dest)
		},
		TLSClientConfig: &tls.Config{
			// nolint:gosec // InsecureSkipVerify is operator-gated and the
			// startup logger emits a WARN when it's true (spec §3.6).
			InsecureSkipVerify: insecureSkipVerify,
			ServerName:         hostname,
			MinVersion:         tls.VersionTLS12,
		},
		ResponseHeaderTimeout: responseHeaderTimeout,
		IdleConnTimeout:       idleConnTimeout,
		MaxIdleConns:          maxIdleConnsPerClient,
		MaxIdleConnsPerHost:   maxIdleConnsPerClient,
		ExpectContinueTimeout: expectContinueTimeout,
	}
}

// jitterBackoff returns d with a uniform ±20 % perturbation. Uses
// math/rand/v2's global Float64, which is goroutine-safe and lock-free.
func jitterBackoff(d time.Duration) time.Duration {
	delta := float64(d) * backoffJitterFraction * (2*rand.Float64() - 1)
	wait := time.Duration(float64(d) + delta)
	if wait < 0 {
		wait = 0
	}
	return wait
}

// grow doubles the backoff up to backoffMax.
func grow(d time.Duration) time.Duration {
	next := d * 2
	if next > backoffMax {
		return backoffMax
	}
	return next
}
