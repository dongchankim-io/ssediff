// Package engine implements the core stream-matching engine for ssediff.
//
// This file holds the StreamMatcher lifecycle: construction, mutex-
// protected map operations, the eviction goroutine, and clean shutdown.
// Domain types live in types.go; pure resolution helpers in resolve.go
// (spec §1.1 single-responsibility per file).
//
// The matcher is intentionally dependency-free at the project level (spec
// §1.1 "Dependency direction") — only stdlib + tidwall/gjson.
//
// File-length justification (spec §1.1 soft cap of 300 lines): all
// methods here share the StreamMatcher's mutex invariant. Splitting
// further (e.g. moving lookupLocked / insertLocked / removeLocked into a
// separate file) would scatter the lock contract across files and make
// it harder to audit by reading top-to-bottom. The current layout puts
// every operation that touches `m.buckets` in one place; the file stays
// near 300 lines as a deliberate trade-off in favour of locality.
package engine

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/tidwall/gjson"
)

// resultChannelCapacity bounds buffered results between the matcher and
// the broadcast hub. When full, new results are dropped (counted), never
// blocked — this prevents a slow consumer from stalling SSE ingestion.
const resultChannelCapacity = 1024

// evictionTickInterval is how often the background goroutine walks the
// buffer looking for items older than TTL.
const evictionTickInterval = 5 * time.Second

// StreamMatcher buckets incoming events from streams A and B by
// (eventType, correlationID), resolves matches into Results, and ages out
// unpaired items as ORPHANs. Safe for concurrent Ingest from any number
// of goroutines.
type StreamMatcher struct {
	mu              sync.Mutex
	buckets         map[string]map[StreamSource]map[string]EventItem
	correlationPath string
	closed          bool

	results      chan Result
	stopEviction chan struct{}
	closeOnce    sync.Once
	evictionDone chan struct{}

	ttl time.Duration

	matchCount    atomic.Int64
	mismatchCount atomic.Int64
	orphanCount   atomic.Int64
	droppedCount  atomic.Int64
	bufferedItems atomic.Int64
}

// NewStreamMatcher constructs a matcher with the given buffer TTL and
// correlation-path expression (a gjson path such as "id" or
// "payload.tracking.id"). The eviction goroutine starts immediately and
// runs until Close is called.
//
// TTL is read once at process start from BUFFER_TTL_MS per spec §3.2 and
// is not runtime-tunable from the UI. The correlationPath may be
// replaced by Reset when a new session begins.
//
// Panics on programmer error: ttl <= 0 (would cause an immediate
// eviction storm) or empty correlationPath (gjson treats it as "always
// missing", silently dropping every event). Both are constructor-time
// misuse, not runtime conditions, so failing loudly is the right answer.
func NewStreamMatcher(ttl time.Duration, correlationPath string) *StreamMatcher {
	if ttl <= 0 {
		panic("engine: NewStreamMatcher requires ttl > 0")
	}
	if correlationPath == "" {
		panic("engine: NewStreamMatcher requires a non-empty correlationPath")
	}
	m := &StreamMatcher{
		buckets:         make(map[string]map[StreamSource]map[string]EventItem),
		correlationPath: correlationPath,
		results:         make(chan Result, resultChannelCapacity),
		stopEviction:    make(chan struct{}),
		evictionDone:    make(chan struct{}),
		ttl:             ttl,
	}
	go m.evictionLoop()
	return m
}

// Results returns the receive-only channel of resolved/aged results. The
// channel is closed exactly once, by Close.
func (m *StreamMatcher) Results() <-chan Result { return m.results }

// Reset clears every buffered event without emitting ORPHANs for them
// (the session was deliberately cancelled, not aged out) and installs a
// new correlation path. Safe to call concurrently with Ingest.
func (m *StreamMatcher) Reset(correlationPath string) {
	if correlationPath == "" {
		panic("engine: Reset requires a non-empty correlationPath")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.buckets = make(map[string]map[StreamSource]map[string]EventItem)
	m.correlationPath = correlationPath
	m.bufferedItems.Store(0)
}

// Close stops the eviction goroutine, blocks for any in-flight Ingest to
// complete, and closes the Results channel. Safe to call exactly once;
// repeated calls are no-ops.
func (m *StreamMatcher) Close() {
	m.closeOnce.Do(func() {
		close(m.stopEviction)
		<-m.evictionDone
		m.mu.Lock()
		m.closed = true
		close(m.results)
		m.mu.Unlock()
	})
}

// Stats returns a snapshot of the matcher's counters. Cheap — only atomic
// reads, no lock acquisition.
func (m *StreamMatcher) Stats() Stats {
	return Stats{
		MatchCount:    m.matchCount.Load(),
		MismatchCount: m.mismatchCount.Load(),
		OrphanCount:   m.orphanCount.Load(),
		BufferedItems: m.bufferedItems.Load(),
		Dropped:       m.droppedCount.Load(),
	}
}

// Ingest records an SSE frame from one upstream feed. If a counterpart is
// already buffered for the same (eventType, correlationID), the pair
// resolves immediately and a Result is published to the Results channel;
// otherwise the new item is buffered for later resolution.
//
// Returns ErrMatcherClosed if Close has already been called, or
// ErrNoCorrelationID if the configured path does not resolve in rawJSON.
func (m *StreamMatcher) Ingest(source StreamSource, eventType string, rawJSON []byte) error {
	if source != StreamA && source != StreamB {
		return ErrInvalidSource
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return ErrMatcherClosed
	}

	v := gjson.GetBytes(rawJSON, m.correlationPath)
	if !v.Exists() {
		return ErrNoCorrelationID
	}
	id := v.String()
	if id == "" {
		return ErrNoCorrelationID
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	item := EventItem{
		Source:        source,
		EventType:     eventType,
		CorrelationID: id,
		RawJSON:       rawJSON,
		ReceivedAt:    now,
	}

	other := opposite(source)
	if counterpart, ok := m.lookupLocked(eventType, other, id); ok {
		m.removeLocked(eventType, other, id)
		result := resolveMatch(item, counterpart, now)
		m.recordResultCounters(result.Kind)
		m.tryPublishLocked(result)
		return nil
	}

	m.insertLocked(eventType, source, id, item)
	return nil
}

// evictionLoop walks the buffer every evictionTickInterval and ages out
// any item older than TTL as an ORPHAN result.
func (m *StreamMatcher) evictionLoop() {
	defer close(m.evictionDone)
	ticker := time.NewTicker(evictionTickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopEviction:
			return
		case t := <-ticker.C:
			m.evictStale(t.UTC().Truncate(time.Millisecond))
		}
	}
}

// evictStale scans every bucket for items older than TTL, removes them,
// and publishes an ORPHAN result for each. Single-lock per tick.
func (m *StreamMatcher) evictStale(now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return
	}
	cutoff := now.Add(-m.ttl)
	for eventType, bySource := range m.buckets {
		for source, byID := range bySource {
			for id, item := range byID {
				if item.ReceivedAt.Before(cutoff) {
					delete(byID, id)
					m.bufferedItems.Add(-1)
					orphan := buildOrphan(item, eventType, now)
					m.orphanCount.Add(1)
					m.tryPublishLocked(orphan)
				}
			}
			if len(byID) == 0 {
				delete(bySource, source)
			}
		}
		if len(bySource) == 0 {
			delete(m.buckets, eventType)
		}
	}
}

// lookupLocked checks for a counterpart already buffered in (eventType,
// source) under the given id. Caller must hold m.mu.
func (m *StreamMatcher) lookupLocked(eventType string, source StreamSource, id string) (EventItem, bool) {
	bySource, ok := m.buckets[eventType]
	if !ok {
		return EventItem{}, false
	}
	byID, ok := bySource[source]
	if !ok {
		return EventItem{}, false
	}
	item, ok := byID[id]
	return item, ok
}

// insertLocked stores an item, growing the nested maps lazily. Caller
// must hold m.mu.
func (m *StreamMatcher) insertLocked(eventType string, source StreamSource, id string, item EventItem) {
	bySource, ok := m.buckets[eventType]
	if !ok {
		bySource = make(map[StreamSource]map[string]EventItem, 2)
		m.buckets[eventType] = bySource
	}
	byID, ok := bySource[source]
	if !ok {
		byID = make(map[string]EventItem)
		bySource[source] = byID
	}
	if _, replaced := byID[id]; !replaced {
		m.bufferedItems.Add(1)
	}
	byID[id] = item
}

// removeLocked deletes an item and prunes empty parent maps. Caller must
// hold m.mu.
func (m *StreamMatcher) removeLocked(eventType string, source StreamSource, id string) {
	bySource, ok := m.buckets[eventType]
	if !ok {
		return
	}
	byID, ok := bySource[source]
	if !ok {
		return
	}
	if _, existed := byID[id]; existed {
		delete(byID, id)
		m.bufferedItems.Add(-1)
	}
	if len(byID) == 0 {
		delete(bySource, source)
	}
	if len(bySource) == 0 {
		delete(m.buckets, eventType)
	}
}

// tryPublishLocked sends a Result without blocking. If the channel is
// full (a slow hub consumer), the result is dropped and droppedCount is
// incremented so operators can observe via /api/stats. Caller must hold
// m.mu — this is what guarantees we never send on a closed channel
// (Close also takes m.mu and only closes after acquiring it).
func (m *StreamMatcher) tryPublishLocked(r Result) {
	select {
	case m.results <- r:
	default:
		m.droppedCount.Add(1)
	}
}

// recordResultCounters bumps the per-kind atomic counters used by
// /api/stats. Called from the hot path; cheap.
func (m *StreamMatcher) recordResultCounters(kind ResultKind) {
	switch kind {
	case ResultMatch:
		m.matchCount.Add(1)
	case ResultMismatch:
		m.mismatchCount.Add(1)
	case ResultOrphan:
		m.orphanCount.Add(1)
	}
}
