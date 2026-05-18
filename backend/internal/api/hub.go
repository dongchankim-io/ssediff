// Package api — WebSocket broadcast hub.
//
// The Hub maintains the registry of connected browsers and fans out
// each engine.Result emitted by the matcher to every client. Per-client
// state and the read/write pumps live in wsclient.go. Session lifecycle
// (start/stop of upstream SSE workers) lives in session.go.
package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dongchankim-io/ssediff/backend/internal/engine"
	"github.com/gorilla/websocket"
)

// upgrader carries spec §3.4's permissive CheckOrigin (UI is served
// same-origin from this same binary in production).
var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// ErrHubStopped is returned by ServeWS when an upgrade is attempted
// after Run has exited.
var ErrHubStopped = errors.New("api: hub is stopped")

// Hub holds the WebSocket client registry and the broadcast loop.
type Hub struct {
	mu        sync.Mutex
	clients   map[*wsClient]struct{}
	closed    bool
	matcher   *engine.StreamMatcher
	logger    *slog.Logger
	startedAt time.Time
	wsCount   atomic.Int64
}

// NewHub constructs an idle hub. Run must be called before broadcasts
// flow.
func NewHub(matcher *engine.StreamMatcher, logger *slog.Logger) *Hub {
	if matcher == nil {
		panic("api: NewHub requires a matcher")
	}
	if logger == nil {
		panic("api: NewHub requires a logger")
	}
	return &Hub{
		clients:   make(map[*wsClient]struct{}),
		matcher:   matcher,
		logger:    logger,
		startedAt: time.Now().UTC(),
	}
}

// UptimeSeconds is the number of whole seconds since the hub started.
func (h *Hub) UptimeSeconds() int64 {
	return int64(time.Since(h.startedAt).Seconds())
}

// ActiveClients returns the current number of connected WebSocket
// clients (atomic load — cheap).
func (h *Hub) ActiveClients() int64 { return h.wsCount.Load() }

// Run is the broadcast loop. It blocks until ctx is cancelled or
// matcher.Results() closes (the latter happens on graceful shutdown).
func (h *Hub) Run(ctx context.Context) {
	h.logger.Info("hub broadcast loop starting")
	defer func() {
		h.markClosedAndDrain()
		h.logger.Info("hub broadcast loop stopped")
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case result, ok := <-h.matcher.Results():
			if !ok {
				return
			}
			h.broadcast(result)
		}
	}
}

// ServeWS upgrades an HTTP request to WebSocket and hands off to a
// wsClient.serve goroutine. Returns a 503 if the hub is already
// stopped.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	stopped := h.closed
	h.mu.Unlock()
	if stopped {
		http.Error(w, "service shutting down", http.StatusServiceUnavailable)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn("ws upgrade failed", "err", err, "remote_addr", r.RemoteAddr)
		return
	}
	client := &wsClient{
		hub:    h,
		conn:   conn,
		send:   make(chan engine.Result, clientSendBuffer),
		logger: h.logger.With("ws_remote", r.RemoteAddr),
	}
	go client.serve(r.Context())
}

// broadcast fans one result out to every registered client via a
// non-blocking send. Slow consumers are dropped (their channel is
// closed; the wsClient's write pump exits as a result).
func (h *Hub) broadcast(r engine.Result) {
	// Snapshot the client set under the lock so we can release before
	// touching socket-bound state.
	h.mu.Lock()
	dropped := make([]*wsClient, 0)
	for client := range h.clients {
		select {
		case client.send <- r:
		default:
			dropped = append(dropped, client)
		}
	}
	for _, client := range dropped {
		delete(h.clients, client)
		close(client.send)
	}
	h.mu.Unlock()
	for _, client := range dropped {
		h.wsCount.Add(-1)
		h.logger.Warn("dropped slow ws consumer", "remote", client.conn.RemoteAddr().String())
	}
}

// registerClient adds a new wsClient to the broadcast set. Called by
// wsClient.serve before its pumps start.
func (h *Hub) registerClient(c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		// race with shutdown — close the new client's send so its write
		// pump exits cleanly.
		close(c.send)
		return
	}
	h.clients[c] = struct{}{}
	h.wsCount.Add(1)
}

// unregisterClient removes the wsClient if still present. Idempotent.
func (h *Hub) unregisterClient(c *wsClient) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
		h.wsCount.Add(-1)
	}
	h.mu.Unlock()
}

// markClosedAndDrain marks the hub closed (rejects new connections) and
// closes every remaining client's send channel so write pumps drain.
// Called from Run's defer on exit.
func (h *Hub) markClosedAndDrain() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for c := range h.clients {
		close(c.send)
	}
	h.clients = make(map[*wsClient]struct{})
}
