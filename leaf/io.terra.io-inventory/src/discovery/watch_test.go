package discovery

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSource stands in for the platform half so the coalescing logic is tested
// on any platform — the split the package doc describes, applied to the watcher.
type fakeSource struct {
	signals chan struct{}
	fail    chan error
	closed  atomic.Bool
	// calls counts concurrent entries into Next. A watcher that reads the
	// socket from two goroutines splits one event stream between them, and
	// whichever loses looks like a change nobody noticed.
	inFlight atomic.Int32
	maxSeen  atomic.Int32
	// delivered counts signals the watcher's reader has taken.
	delivered atomic.Int32
}

func newFakeSource() *fakeSource {
	return &fakeSource{signals: make(chan struct{}), fail: make(chan error, 1)}
}

func (s *fakeSource) Next(ctx context.Context) error {
	depth := s.inFlight.Add(1)
	for {
		seen := s.maxSeen.Load()
		if depth <= seen || s.maxSeen.CompareAndSwap(seen, depth) {
			break
		}
	}
	defer s.inFlight.Add(-1)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-s.fail:
		return err
	case <-s.signals:
		s.delivered.Add(1)
		return nil
	}
}

// awaitDelivered waits until the watcher's reader has taken count signals off
// the source. Past that point the burst is inside the watcher, which is the
// only thing the burst test can observe: the reader coalesces into a
// one-deep buffer, so signals do NOT map one-to-one onto settle windows —
// dropping a token when one is already waiting is the first half of the
// coalescing this test exists to check.
func (s *fakeSource) awaitDelivered(t *testing.T, count int32) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for s.delivered.Load() < count {
		select {
		case <-deadline:
			t.Fatalf("the source delivered %d signal(s), want %d", s.delivered.Load(), count)
		case <-time.After(time.Millisecond):
		}
	}
}

func (s *fakeSource) Close() error {
	s.closed.Store(true)
	return nil
}

// manualClock hands out settle timers the test fires by hand, so the coalescing
// is asserted rather than slept through.
type manualClock struct {
	mu      sync.Mutex
	pending []chan time.Time
}

func (c *manualClock) After(time.Duration) <-chan time.Time {
	timer := make(chan time.Time, 1)
	c.mu.Lock()
	c.pending = append(c.pending, timer)
	c.mu.Unlock()
	return timer
}

// fireNewest settles the live window and reports whether there was one. The
// watcher abandons the previous timer every time it restarts, so the newest is
// the only one anybody is reading.
func (c *manualClock) fireNewest() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.pending) == 0 {
		return false
	}
	timer := c.pending[len(c.pending)-1]
	c.pending = c.pending[:len(c.pending)-1]
	timer <- time.Now()
	return true
}

// fire settles a window and waits for the scan it produces.
//
// It retries because the watcher may restart its window between the pop and the
// send — absorbing one more signal abandons the timer this just took. Retrying
// settles the next live one; it never produces an extra scan, because only one
// window is ever live.
func (c *manualClock) fire(t *testing.T, scanned <-chan struct{}) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		c.fireNewest()
		select {
		case <-scanned:
			return
		case <-deadline:
			t.Fatal("no scan followed the settle window")
		case <-time.After(2 * time.Millisecond):
		}
	}
}

func runWatch(t *testing.T, source Source, options WatchOptions, onChange func()) (context.CancelFunc, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Watch(ctx, source, options, onChange) }()
	t.Cleanup(cancel)
	return cancel, done
}

// A burst of signals is one scan. Plugging a hub emits an event per downstream
// port; scanning on each would read the device list a dozen times for one answer.
func TestWatchCoalescesABurstIntoOneScan(t *testing.T) {
	source := newFakeSource()
	clock := &manualClock{}
	var scans atomic.Int32
	scanned := make(chan struct{}, 8)
	_, done := runWatch(t, source, WatchOptions{After: clock.After}, func() {
		scans.Add(1)
		scanned <- struct{}{}
	})

	const burst = 5
	for range burst {
		source.signals <- struct{}{}
	}
	source.awaitDelivered(t, burst)
	clock.fire(t, scanned)

	// Give a watcher that did not coalesce room to scan again before asserting
	// it did not: settle every window still open, then look.
	deadline := time.After(200 * time.Millisecond)
	for {
		if !clock.fireNewest() {
			select {
			case <-deadline:
				if got := scans.Load(); got != 1 {
					t.Fatalf("scans = %d, want 1 — the burst was not coalesced", got)
				}
				return
			case err := <-done:
				t.Fatalf("watch stopped early: %v", err)
			case <-time.After(5 * time.Millisecond):
			}
		}
		if got := scans.Load(); got != 1 {
			t.Fatalf("scans = %d, want 1 — the burst was not coalesced", got)
		}
	}
}

// Two separate bursts are two scans: coalescing must not swallow the second.
func TestWatchScansAgainForALaterBurst(t *testing.T) {
	source := newFakeSource()
	clock := &manualClock{}
	scanned := make(chan struct{}, 4)
	_, done := runWatch(t, source, WatchOptions{After: clock.After}, func() { scanned <- struct{}{} })

	for round := range int32(2) {
		source.signals <- struct{}{}
		source.awaitDelivered(t, round+1)
		clock.fire(t, scanned)
	}
	select {
	case err := <-done:
		t.Fatalf("watch stopped early: %v", err)
	default:
	}
}

// Only one goroutine may call Next. Two readers on one socket split the event
// stream, and the loser's events are lost without a trace.
func TestWatchReadsTheSourceFromOneGoroutine(t *testing.T) {
	source := newFakeSource()
	clock := &manualClock{}
	scanned := make(chan struct{}, 8)
	_, done := runWatch(t, source, WatchOptions{After: clock.After}, func() { scanned <- struct{}{} })

	for range 3 {
		source.signals <- struct{}{}
		clock.fire(t, scanned)
	}
	select {
	case err := <-done:
		t.Fatalf("watch stopped early: %v", err)
	default:
	}
	if got := source.maxSeen.Load(); got > 1 {
		t.Fatalf("Next was entered %d times concurrently, want 1", got)
	}
}

// A source failure ends the watch and is reported. A watcher that swallowed it
// would sit forever on a socket that is never going to answer again.
func TestWatchReturnsASourceFailure(t *testing.T) {
	source := newFakeSource()
	sentinel := errors.New("the netlink socket went away")
	_, done := runWatch(t, source, WatchOptions{After: (&manualClock{}).After}, func() {})

	source.fail <- sentinel
	select {
	case err := <-done:
		if !errors.Is(err, sentinel) {
			t.Fatalf("watch returned %v, want the source's failure", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("watch did not stop on a source failure")
	}
}

func TestWatchStopsWithTheContext(t *testing.T) {
	source := newFakeSource()
	cancel, done := runWatch(t, source, WatchOptions{After: (&manualClock{}).After}, func() {})
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("watch returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("watch did not stop with its context")
	}
}

// A nil source polls. This is the Windows and no-event-source path, and it has
// to keep scanning rather than quietly doing nothing.
func TestWatchPollsWithoutASource(t *testing.T) {
	clock := &manualClock{}
	scanned := make(chan struct{}, 4)
	_, done := runWatch(t, nil, WatchOptions{After: clock.After}, func() { scanned <- struct{}{} })

	for range 2 {
		clock.fire(t, scanned)
	}
	select {
	case err := <-done:
		t.Fatalf("poll stopped early: %v", err)
	default:
	}
}

func TestWatchRefusesAWatchWithNowhereToReport(t *testing.T) {
	if err := Watch(context.Background(), nil, WatchOptions{}, nil); err == nil {
		t.Fatal("a watch with a nil onChange was accepted")
	}
}

// Whatever this platform offers, the status has to say which mode is running:
// a stale-looking device list means something different under a poll than under
// an event source, and the operator cannot tell without being told.
func TestOpenWatchReportsAUsableMode(t *testing.T) {
	source, status := OpenWatch(WatchOptions{})
	if source != nil {
		t.Cleanup(func() { _ = source.Close() })
	}
	switch status.Mode {
	case WatchEvent, WatchPoll, WatchNone:
	default:
		t.Fatalf("mode = %q, want event, poll, or none", status.Mode)
	}
	if status.Platform == "" {
		t.Error("status names no platform")
	}
	if status.Detail == "" {
		t.Error("status gives no reason for its mode")
	}
	if status.Mode == WatchEvent && source == nil {
		t.Error("event mode reported with no source to read")
	}
	if status.Mode != WatchEvent && source != nil {
		t.Error("a source was returned outside event mode")
	}
	if status.Mode == WatchPoll && status.PollIntervalSeconds <= 0 {
		t.Error("poll mode does not say how long the list can be wrong for")
	}
	if got := status.Watching(); got != (status.Mode != WatchNone) {
		t.Errorf("Watching() = %v for mode %q", got, status.Mode)
	}
}
