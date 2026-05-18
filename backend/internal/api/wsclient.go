// Package api — per-WebSocket-client read/write pumps.
//
// One wsClient per connected browser. Each owns two goroutines:
// writePump (serializing broadcasts + ping frames onto the wire) and
// readPump (discarding inbound frames but honouring pongs to keep the
// read deadline alive). Bidirectional cancellation lets either pump
// terminate the other promptly.
package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/dongchankim-io/ssediff/backend/internal/engine"
	"github.com/gorilla/websocket"
)

// WebSocket timing constants per spec §3.4: ping every 30 s, read
// deadline 60 s. Write deadline keeps a stalled socket from blocking a
// pump indefinitely.
const (
	pingInterval     = 30 * time.Second
	readDeadline     = 60 * time.Second
	writeDeadline    = 10 * time.Second
	clientSendBuffer = 256 // spec §3.4 per-client send queue
)

// wsClient is the server-side handle for one browser WebSocket. Owned
// jointly by the hub (which sends into `send`) and the two pumps below.
type wsClient struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan engine.Result
	logger *slog.Logger
}

// serve registers the client with the hub, runs both pumps, and
// guarantees a clean unregister-and-close on any exit path.
func (c *wsClient) serve(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer c.cleanup()

	c.hub.registerClient(c)
	go c.readPump(cancel)
	c.writePump(ctx)
}

// cleanup unregisters from the hub and closes the underlying conn. Safe
// to call once; called from serve's defer.
func (c *wsClient) cleanup() {
	c.hub.unregisterClient(c)
	_ = c.conn.Close()
}

// readPump reads (and discards) frames from the browser. Its only real
// job is to drive the pong handler so the read deadline keeps rolling
// forward. When ReadMessage errors (client disconnected or read deadline
// expired), it cancels the writer's context.
func (c *wsClient) readPump(cancel context.CancelFunc) {
	defer cancel()
	_ = c.conn.SetReadDeadline(time.Now().Add(readDeadline))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(readDeadline))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				c.logger.Debug("ws read ended", "err", err)
			}
			return
		}
		// Inbound payloads are intentionally ignored — UI is read-only.
	}
}

// writePump consumes broadcasts and emits ping frames on a schedule.
// Returns when ctx is cancelled (parent shutdown / read pump death) or
// when the hub closes the send channel (slow-consumer drop).
func (c *wsClient) writePump(ctx context.Context) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.SetWriteDeadline(time.Now().Add(writeDeadline))
				_ = c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "dropped"))
				return
			}
			if err := c.writeJSON(msg); err != nil {
				c.logger.Debug("ws write failed", "err", err)
				return
			}
		case <-ticker.C:
			if err := c.writePing(); err != nil {
				c.logger.Debug("ws ping failed", "err", err)
				return
			}
		}
	}
}

// writeJSON serializes one Result as a JSON text frame, bounded by the
// write deadline.
func (c *wsClient) writeJSON(r engine.Result) error {
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	return c.conn.WriteJSON(r)
}

// writePing emits one ping frame bounded by the write deadline.
func (c *wsClient) writePing() error {
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	return c.conn.WriteMessage(websocket.PingMessage, nil)
}
