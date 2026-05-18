// Package engine — pure resolution helpers.
//
// Everything in this file is referentially transparent: same inputs always
// produce the same outputs, no I/O, no globals, no time access. This is
// what spec §1.1 "Purity & isolation" demands for the matcher's hot path.
package engine

import (
	"bytes"
	"time"
)

// resolveMatch is the pure resolution function. It takes the two paired
// events plus an injected "now" and returns a Result. No I/O, no globals,
// no time.Now — safe to call from any context.
func resolveMatch(first, second EventItem, now time.Time) Result {
	a, b := orientAB(first, second)
	kind := ResultMatch
	if !bytes.Equal(bytes.TrimSpace(a.RawJSON), bytes.TrimSpace(b.RawJSON)) {
		kind = ResultMismatch
	}
	return Result{
		Kind:          kind,
		EventType:     a.EventType,
		CorrelationID: a.CorrelationID,
		Timestamp:     now,
		A:             &a,
		B:             &b,
	}
}

// orientAB returns the (A-side, B-side) ordering regardless of which
// argument arrived first. Keeping orientation deterministic is what lets
// the UI render a stable diff.
func orientAB(first, second EventItem) (EventItem, EventItem) {
	if first.Source == StreamA {
		return first, second
	}
	return second, first
}

// opposite returns the other stream source.
func opposite(s StreamSource) StreamSource {
	if s == StreamA {
		return StreamB
	}
	return StreamA
}

// buildOrphan packages a stale event as a Result with only the present
// side populated, matching the spec §3.5 ORPHAN wire shape.
func buildOrphan(item EventItem, eventType string, now time.Time) Result {
	r := Result{
		Kind:          ResultOrphan,
		EventType:     eventType,
		CorrelationID: item.CorrelationID,
		Timestamp:     now,
	}
	if item.Source == StreamA {
		r.A = &item
	} else {
		r.B = &item
	}
	return r
}
