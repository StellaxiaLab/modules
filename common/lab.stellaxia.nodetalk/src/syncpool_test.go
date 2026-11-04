package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A peer that never answers must not keep the others from syncing, and a tick
// must not outlast the peer's budget by much.
func TestHungPeerDoesNotBlockTheOthers(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, _ := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA}

	conversation, err := storeA.Create("멈춘 피어", []string{"node-b"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := storeA.AppendMessage(conversation.ConversationID, "도착해야 한다", ""); err != nil {
		t.Fatal(err)
	}

	real := httpDoor(t, "node-b", servers)
	// "aa-hung" sorts before "node-a": a sequential loop would sit on it first.
	door := func(c context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		if node == "aa-hung" {
			<-c.Done()
			return nil, c.Err()
		}
		return real(c, node, method, path, body)
	}
	loop := newSyncLoop(storeB, door, staticNodeID("node-b"), t.TempDir())
	loop.staticPeers = []string{"aa-hung", "node-a"}
	loop.peerBudget = 400 * time.Millisecond

	started := time.Now()
	loop.tick(ctx)
	if took := time.Since(started); took > 3*time.Second {
		t.Fatalf("tick took %s; the hung peer's budget was 400ms", took)
	}
	entries, _, err := storeB.Entries(conversation.ConversationID, 0, 0)
	if err != nil || len(entries) != 1 {
		t.Fatalf("node-a's line did not arrive past the hung peer: %v %d", err, len(entries))
	}
	if state := loop.backoff["aa-hung"]; state == nil || state.failures != 1 {
		t.Fatalf("hung peer not recorded as failed: %+v", state)
	}
	if loop.backoff["node-a"] != nil {
		t.Fatal("healthy peer carries a failure")
	}
}

// Peers sync in parallel, but never more than the pool allows.
func TestPeerSyncIsParallelAndBounded(t *testing.T) {
	storeB, _ := newNode(t, "node-b", t.TempDir())
	var running, peak int32
	door := func(c context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		if path != apiPrefix+"/conversations" {
			return nil, nil
		}
		now := atomic.AddInt32(&running, 1)
		for {
			seen := atomic.LoadInt32(&peak)
			if now <= seen || atomic.CompareAndSwapInt32(&peak, seen, now) {
				break
			}
		}
		time.Sleep(60 * time.Millisecond)
		atomic.AddInt32(&running, -1)
		return json.RawMessage(`{"conversations":[]}`), nil
	}
	loop := newSyncLoop(storeB, door, staticNodeID("node-b"), t.TempDir())
	loop.parallel = 3
	for i := 0; i < 9; i++ {
		loop.staticPeers = append(loop.staticPeers, "peer-"+string(rune('a'+i)))
	}
	loop.tick(context.Background())
	if got := atomic.LoadInt32(&peak); got < 2 || got > 3 {
		t.Fatalf("peak concurrency %d, want 2..3", got)
	}
}

// A failing peer is asked less and less often, a recovered one at once, and the
// first failure costs no wait at all.
func TestFailingPeerBacksOffAndRecoveryResets(t *testing.T) {
	storeB, _ := newNode(t, "node-b", t.TempDir())
	var calls int32
	var healthy atomic.Bool
	door := func(c context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		atomic.AddInt32(&calls, 1)
		if !healthy.Load() {
			return nil, &doorError{Code: "MODULE_UNAVAILABLE", Message: "down"}
		}
		return json.RawMessage(`{"conversations":[]}`), nil
	}
	var mu sync.Mutex
	clock := time.Unix(1_000_000, 0)
	loop := newSyncLoop(storeB, door, staticNodeID("node-b"), t.TempDir())
	loop.staticPeers = []string{"node-a"}
	loop.interval = 10 * time.Second
	loop.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }
	advance := func(d time.Duration) { mu.Lock(); clock = clock.Add(d); mu.Unlock() }
	ctx := context.Background()
	callsSince := func(f func()) int32 {
		before := atomic.LoadInt32(&calls)
		f()
		return atomic.LoadInt32(&calls) - before
	}

	// askPeerName and the listing both call the door, so count in units of
	// "did the peer get asked at all".
	if callsSince(func() { loop.tick(ctx) }) == 0 {
		t.Fatal("first tick must ask")
	}
	if callsSince(func() { loop.tick(ctx) }) == 0 {
		t.Fatal("after ONE failure the peer is asked again at once")
	}
	// Two failures now: the third tick falls inside the wait.
	if n := callsSince(func() { loop.tick(ctx) }); n != 0 {
		t.Fatalf("peer in backoff was asked (%d calls)", n)
	}
	advance(13 * time.Second) // interval 10s ±20% → at most 12s
	if callsSince(func() { loop.tick(ctx) }) == 0 {
		t.Fatal("peer not asked after its wait elapsed")
	}
	if state := loop.backoff["node-a"]; state == nil || state.failures != 3 {
		t.Fatalf("failures after three misses: %+v", state)
	}

	healthy.Store(true)
	advance(time.Hour)
	loop.tick(ctx)
	if loop.backoff["node-a"] != nil {
		t.Fatal("success did not reset the backoff")
	}
}

func TestBackoffDelayGrowsAndIsCapped(t *testing.T) {
	loop := &syncLoop{interval: 10 * time.Second}
	within := func(got, want time.Duration) bool {
		return got >= time.Duration(float64(want)*0.79) && got <= time.Duration(float64(want)*1.21)
	}
	if loop.backoffDelay(1) != 0 {
		t.Fatal("first failure must not wait")
	}
	if d := loop.backoffDelay(2); !within(d, 10*time.Second) {
		t.Fatalf("2 failures: %s", d)
	}
	if d := loop.backoffDelay(3); !within(d, 20*time.Second) {
		t.Fatalf("3 failures: %s", d)
	}
	if d := loop.backoffDelay(500); !within(d, backoffCap) {
		t.Fatalf("500 failures: %s, want ≈ cap %s", d, backoffCap)
	}
}

// A peer that calls us is reachable, so it need not wait out its backoff.
func TestInboundContactCutsBackoffShort(t *testing.T) {
	loop := newSyncLoop(nil, nil, staticNodeID("node-b"), t.TempDir())
	loop.learned = newPeerLearner()
	loop.interval = time.Hour
	for i := 0; i < 3; i++ {
		loop.recordPeerResult("node-a", false)
	}
	if loop.dueForSync("node-a") {
		t.Fatal("peer should be waiting")
	}
	time.Sleep(2 * time.Millisecond)
	loop.learned.learn("node-a")
	if !loop.dueForSync("node-a") {
		t.Fatal("a peer that knocked after failing should be asked at once")
	}
}
