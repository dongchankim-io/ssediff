// Package stream — SSE frame parser.
//
// The frame parser is intentionally pulled out of client.go so the
// network plumbing and the protocol parsing each have one reason to
// change (spec §1.1). All functions here are methods on *Client
// (declared in client.go) because they consume the client's matcher,
// logger, and source; treating them as free functions would only push
// those dependencies into the parameter list.
package stream

import (
	"bufio"
	"errors"
	"io"
	"strings"

	"github.com/dongchankim-io/ssediff/backend/internal/engine"
)

// parseStream reads SSE frames from r and pushes each completed frame
// into the matcher. Returns (receivedAny, terminatingErr). Terminating
// errors are non-fatal — Run will retry — except ErrMatcherClosed which
// signals the matcher is gone for good.
func (c *Client) parseStream(r io.Reader) (bool, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, initialReadBufBytes), maxLineBytes)

	var (
		receivedAny bool
		eventType   string
		dataLines   []string
	)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			done, err := c.dispatch(eventType, dataLines)
			if err != nil {
				return receivedAny || done, err
			}
			if done {
				receivedAny = true
			}
			eventType = ""
			dataLines = nil
			continue
		}
		if line[0] == ':' {
			continue
		}
		field, value := parseField(line)
		switch field {
		case "event":
			eventType = value
		case "data":
			dataLines = append(dataLines, value)
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			c.logger.Warn("oversize sse line dropped (>1 MiB); reconnecting")
		}
		return receivedAny, err
	}
	return receivedAny, io.EOF
}

// dispatch packages a complete SSE frame and pushes it to the matcher.
// Returns (ingestedOK, fatalErr). A fatal error is only returned for
// ErrMatcherClosed; ErrNoCorrelationID and similar drops are logged at
// WARN and swallowed so one bad frame can't kill the session.
func (c *Client) dispatch(eventType string, dataLines []string) (bool, error) {
	if len(dataLines) == 0 {
		return false, nil
	}
	kind := eventType
	if kind == "" {
		kind = "message"
	}
	payload := []byte(strings.Join(dataLines, "\n"))
	if err := c.matcher.Ingest(c.source, kind, payload); err != nil {
		if errors.Is(err, engine.ErrMatcherClosed) {
			return false, err
		}
		c.logger.Warn("frame dropped at ingest",
			"event_type", kind,
			"err", err,
			"payload_bytes", len(payload),
		)
		return false, nil
	}
	c.logger.Debug("frame ingested", "event_type", kind, "payload_bytes", len(payload))
	return true, nil
}

// parseField parses a single SSE field line of the form "field:value" or
// "field: value" (the leading space after the colon is optional per the
// SSE spec). Lines without a colon are treated as "field with empty
// value".
func parseField(line string) (field, value string) {
	field, value, hasColon := strings.Cut(line, ":")
	if !hasColon {
		return field, ""
	}
	return field, strings.TrimPrefix(value, " ")
}
