// Package engine — domain types and error sentinels.
//
// Splitting these out from matcher.go keeps each file focused (spec §1.1
// "single responsibility per file"). No behavior beyond EventItem's
// MarshalJSON projection lives here.
package engine

import (
	"encoding/json"
	"errors"
	"time"
)

// Errors returned by Ingest. Sentinel values so callers can branch via
// errors.Is without string matching.
var (
	// ErrMatcherClosed is returned when Ingest is called after Close.
	ErrMatcherClosed = errors.New("engine: matcher is closed")
	// ErrNoCorrelationID is returned when the configured correlation path
	// did not resolve to a non-empty value in the payload.
	ErrNoCorrelationID = errors.New("engine: correlation id not found in payload")
	// ErrInvalidSource is returned when Ingest receives anything other
	// than StreamA or StreamB.
	ErrInvalidSource = errors.New("engine: source must be \"A\" or \"B\"")
)

// StreamSource identifies which upstream SSE feed produced an event. The
// matcher only accepts the two canonical values; consumers must not invent
// new ones.
type StreamSource string

// StreamA and StreamB are the only legal StreamSource values.
const (
	StreamA StreamSource = "A"
	StreamB StreamSource = "B"
)

// EventItem is a single parsed SSE frame captured from one upstream feed.
// RawJSON holds the exact bytes from the SSE data: field so the UI can
// render a faithful diff without any backend re-encoding.
type EventItem struct {
	Source        StreamSource
	EventType     string
	CorrelationID string
	RawJSON       []byte
	ReceivedAt    time.Time
}

// MarshalJSON serializes the spec §3.5 "stream payload" projection:
// {source, rawJson, receivedAt}. EventType and CorrelationID live on the
// enclosing Result, not on the per-side payload, so they are
// intentionally omitted here.
func (e EventItem) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Source     StreamSource `json:"source"`
		RawJSON    string       `json:"rawJson"`
		ReceivedAt time.Time    `json:"receivedAt"`
	}{
		Source:     e.Source,
		RawJSON:    string(e.RawJSON),
		ReceivedAt: e.ReceivedAt,
	})
}

// ResultKind enumerates the three possible outcomes of comparing two
// events keyed on (eventType, correlationID).
type ResultKind string

// ResultMatch, ResultMismatch, ResultOrphan are the only legal kinds.
const (
	ResultMatch    ResultKind = "MATCH"
	ResultMismatch ResultKind = "MISMATCH"
	ResultOrphan   ResultKind = "ORPHAN"
)

// Result is the unit of output the matcher emits onto its Results channel
// every time a pair resolves (MATCH/MISMATCH) or an unmatched item ages
// out (ORPHAN). For ORPHAN, exactly one of A or B is populated.
type Result struct {
	Kind          ResultKind `json:"kind"`
	EventType     string     `json:"eventType"`
	CorrelationID string     `json:"correlationId"`
	Timestamp     time.Time  `json:"timestamp"`
	A             *EventItem `json:"a,omitempty"`
	B             *EventItem `json:"b,omitempty"`
}

// Stats is a point-in-time snapshot of the matcher's counters. The fields
// match the JSON shape served by GET /api/stats (spec §3.5/§3.6) minus
// the hub- and process-level fields (uptime, activeWsClients).
type Stats struct {
	MatchCount    int64 `json:"matchCount"`
	MismatchCount int64 `json:"mismatchCount"`
	OrphanCount   int64 `json:"orphanCount"`
	BufferedItems int64 `json:"bufferedItems"`
	Dropped       int64 `json:"dropped"`
}
