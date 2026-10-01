package main

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// The whole of D-10 in one place: a main that stops answering is replaced, and
// a main that is merely unreachable has already stood down by the time it is.
//
// The sync loop only ever asked the LIVING main to hand over, so a dead main
// held its room forever. What makes taking it without asking safe is that the
// two sides act on different clocks by different amounts — the incumbent gives
// up at its lease, the challenger takes over a grace margin later.

// promotionRoom stands up a main (node-a) and a higher-ranked member (node-b)
// that has already caught up, which is where a promotion becomes legitimate.
func promotionRoom(t *testing.T, ttl, grace time.Duration) (*talk.Store, *talk.Store, *syncLoop, string, map[string]*httptest.Server) {
	t.Helper()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeA.SetLeaseTTL(ttl)
	storeB, serverB := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	// node-b listed first: it outranks the creating main (D-2 explicit order).
	conversation, err := storeA.Create("승격", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := storeA.AppendMessage(id, "메인이 살아 있을 때", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour // never take the cooperative path in these tests
	// 따라잡기 tick은 **승격을 끈 채** 돈다. 이 tick의 일은 node-b를 메인과
	// 같은 지점까지 끌어오는 것이지 승격을 시험하는 것이 아닌데, 켜 두면
	// 픽스처 비용이 테스트의 리스 창에서 나간다 — `syncPeer`가 디스크에 쓰고
	// HTTP를 한 바퀴 도는 동안 시계가 흐르고, 같은 tick의 `takeLapsedMains`가
	// 그 시간을 "메인이 조용했던 시간"으로 읽는다. 한가한 리눅스에서도 40ms
	// 창의 3ms가 이렇게 나가고(실측), 부하가 그 열 배인 러너에서는 창이 셋업
	// 안에서 끝나 **본문이 시작하기도 전에** node-b가 메인이 된다. CI에서
	// `TestPromotionCanBeDisabled`가 정확히 그렇게 깨졌다 — 본문이 승격을
	// 끄기도 전에 이미 일어나 있었으니, 끄는 것으로는 막을 수 없었다.
	loopB.leaseTTL, loopB.leaseGrace = -1, grace
	loopB.tick(context.Background())

	// 이제 리스를 켜고 시계를 지금으로 맞춘다. 본문이 재는 것은 "메인이
	// 조용해진 뒤 얼마나 지났나"이지 "픽스처를 세우는 데 얼마가 들었나"가 아니다.
	loopB.leaseTTL, loopB.leaseGrace = ttl, grace
	loopB.markMainSeen(id)
	return storeA, storeB, loopB, id, servers
}

// A main that stops answering is replaced, and nothing is lost doing it.
func TestADeadMainIsReplaced(t *testing.T) {
	const ttl, grace = 40 * time.Millisecond, 40 * time.Millisecond
	storeA, storeB, loopB, id, servers := promotionRoom(t, ttl, grace)

	view, _, _ := storeB.Get(id)
	if view.MainNodeID != "node-a" {
		t.Fatalf("fixture: main is %s", view.MainNodeID)
	}
	if entries, _, _ := storeB.Entries(id, 0, 0); len(entries) != 1 {
		t.Fatalf("node-b did not catch up before the main died: %d", len(entries))
	}

	// node-a dies. Not slow, not partitioned — gone.
	servers["node-a"].Close()
	time.Sleep(ttl + grace + 20*time.Millisecond)
	loopB.tick(context.Background())

	promoted, _, err := storeB.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if promoted.MainNodeID != "node-b" || promoted.Role != "main" {
		t.Fatalf("the room kept a main that will never answer again: %+v", promoted)
	}
	if promoted.Epoch != view.Epoch+1 {
		t.Fatalf("epoch %d, want %d", promoted.Epoch, view.Epoch+1)
	}
	// The transcript survived the promotion intact.
	if entries, _, _ := storeB.Entries(id, 0, 0); len(entries) != 1 || entries[0].Text != "메인이 살아 있을 때" {
		t.Fatalf("promotion cost a line: %+v", entries)
	}
	// And the old main, whenever it comes back, steps aside by the ordinary
	// replication rule rather than a special case.
	if _, err := storeA.AdoptConversation(promoted); err != nil {
		t.Fatalf("the old main could not adopt: %v", err)
	}
	back, _, _ := storeA.Get(id)
	if back.MainNodeID != "node-b" || back.Role != "backup" {
		t.Fatalf("the returning main did not step aside: %+v", back)
	}
}

// The safety property. A partition looks exactly like a death from the outside,
// so the test that matters is what the INCUMBENT is doing at the moment the
// challenger takes over: it must already have stopped.
func TestAPartitionedMainHasAlreadyStoodDown(t *testing.T) {
	const ttl, grace = 40 * time.Millisecond, 40 * time.Millisecond
	storeA, storeB, loopB, id, servers := promotionRoom(t, ttl, grace)

	// A partition, not a death: node-a is up and serving, just not reachable
	// from node-b. It has no way to tell the difference either.
	servers["node-a"].Close()
	time.Sleep(ttl + grace + 20*time.Millisecond)
	loopB.tick(context.Background())

	if promoted, _, _ := storeB.Get(id); promoted.MainNodeID != "node-b" {
		t.Fatalf("the challenger did not take over: %+v", promoted)
	}
	// At this instant node-a still believes it is main — and refuses to act as
	// one, because nobody has reached it for longer than its lease. Two nodes
	// hold the title; only one of them is deciding anything.
	stillMain, _, _ := storeA.Get(id)
	if stillMain.MainNodeID != "node-a" {
		t.Fatalf("fixture: the partitioned node should still name itself: %+v", stillMain)
	}
	if _, _, err := storeA.AddMember(id, "node-c", nil); err == nil {
		t.Fatal("the partitioned main was still deciding membership while another node was main")
	}
	// It keeps taking messages, which is the point of D-1: standing down costs
	// the room nothing that matters.
	if _, err := storeA.AppendMessage(id, "분단된 쪽에서도 말은 남는다", ""); err != nil {
		t.Fatalf("the partitioned main stopped accepting messages: %v", err)
	}
	// Deleting is deliberately NOT gated. Two mains deleting converge on the
	// same tombstone, and the alternative — an operator who cannot clean up a
	// room whose other member will never come back — is the failure that
	// actually happened.
	if _, _, err := storeA.DeleteAsMain(id); err != nil {
		t.Fatalf("a partitioned main could not clean up its own room: %v", err)
	}
}

// Reaching the main renews its lease and resets the challenger's patience, so an
// ordinary slow tick never unseats anybody.
//
// This is the one test in this file whose assertion a SLOW machine can break.
// Its siblings sleep past a lease and then assert that a promotion happened —
// more delay only makes those surer. This one asserts a promotion did NOT
// happen while ticking, so every tick has to land inside the lease window, and
// a stalled runner produces the same symptom as a broken lease.
//
// Two things keep the two apart. The window is a second rather than the 120ms
// it was, which is far past any scheduling jitter while still costing about a
// second and a half of test time. And the loop measures the widest gap between
// its own ticks, so a failure says which of the two happened instead of
// leaving the reader to guess — the guess is expensive, because the honest
// answer is usually "the runner", and reading it as "the lease" sends someone
// after code that is fine.
func TestAReachableMainIsNeverUnseated(t *testing.T) {
	const ttl, grace = 500 * time.Millisecond, 500 * time.Millisecond
	_, storeB, loopB, id, _ := promotionRoom(t, ttl, grace)

	// Keep syncing across more than a full lease window.
	deadline := time.Now().Add(ttl + grace + 500*time.Millisecond)
	previous, widest := time.Now(), time.Duration(0)
	for time.Now().Before(deadline) {
		loopB.tick(context.Background())
		if gap := time.Since(previous); gap > widest {
			widest = gap
		}
		previous = time.Now()
		time.Sleep(50 * time.Millisecond)
	}
	view, _, _ := storeB.Get(id)
	if view.MainNodeID != "node-a" {
		if widest >= ttl+grace {
			t.Fatalf("this machine stalled %s between ticks, longer than the %s lease window, so the main "+
				"went unreached through no fault of the lease: %+v", widest.Round(time.Millisecond), ttl+grace, view)
		}
		t.Fatalf("a main that answered every tick was unseated (widest gap between ticks %s, well inside "+
			"the %s window): %+v", widest.Round(time.Millisecond), ttl+grace, view)
	}
}

// A conversation this node has only just heard of has not been silent — nobody
// has had the chance to reach anyone yet. Without this an invited node would
// promote itself the moment it learned the room existed.
func TestAJustAdoptedRoomIsNotImmediatelyTaken(t *testing.T) {
	const ttl, grace = 10 * time.Millisecond, 10 * time.Millisecond
	storeA, _ := newNode(t, "node-a", t.TempDir())
	conversation, err := storeA.Create("갓 채택", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	view, _, _ := storeA.Get(id)

	storeB, _ := newNode(t, "node-b", t.TempDir())
	if _, err := storeB.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	loopB := newSyncLoop(storeB, nil, staticNodeID("node-b"), t.TempDir())
	loopB.leaseTTL, loopB.leaseGrace = ttl, grace

	// The room is older than a lease window, but THIS node has only just met it.
	time.Sleep(ttl + grace + 20*time.Millisecond)
	loopB.takeLapsedMains("node-b")
	if seen, _, _ := storeB.Get(id); seen.MainNodeID != "node-b" {
		// first sweep only starts the clock
		if seen.MainNodeID != "node-a" {
			t.Fatalf("unexpected main: %+v", seen)
		}
	} else {
		t.Fatal("a node promoted itself in a room it had only just adopted")
	}
}

// Self-promotion can be turned off, for an assembly that wants the old
// ask-the-main-only behaviour.
func TestPromotionCanBeDisabled(t *testing.T) {
	const ttl, grace = 20 * time.Millisecond, 20 * time.Millisecond
	_, storeB, loopB, id, servers := promotionRoom(t, ttl, grace)
	loopB.leaseTTL = -1

	servers["node-a"].Close()
	time.Sleep(ttl + grace + 20*time.Millisecond)
	loopB.tick(context.Background())

	if view, _, _ := storeB.Get(id); view.MainNodeID != "node-a" {
		t.Fatalf("promotion happened with the lease disabled: %+v", view)
	}
}

// A node that has never synced with the main cannot promote over it, however
// long it waits.
//
// Its catch-up proof would be EMPTY, and an empty proof passes the catch-up
// check vacuously — so without this a node that had never seen a single line of
// a conversation could take the main seat from a node that had them all. The two
// facts are the same one: syncing with a main is reaching it, so a node with no
// proof is a node the main never knew was there.
func TestANodeThatNeverSyncedCannotPromote(t *testing.T) {
	const ttl, grace = 10 * time.Millisecond, 10 * time.Millisecond
	storeA, _ := newNode(t, "node-a", t.TempDir())
	conversation, err := storeA.Create("만난 적 없음", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := storeA.AppendMessage(id, "메인만 가진 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	view, _, _ := storeA.Get(id)

	// node-b learns the conversation from somewhere but never reaches node-a.
	storeB, _ := newNode(t, "node-b", t.TempDir())
	if _, err := storeB.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	loopB := newSyncLoop(storeB, nil, staticNodeID("node-b"), t.TempDir())
	loopB.leaseTTL, loopB.leaseGrace = ttl, grace

	for attempt := 0; attempt < 5; attempt++ {
		time.Sleep(ttl + grace + 10*time.Millisecond)
		loopB.takeLapsedMains("node-b")
	}
	if seen, _, _ := storeB.Get(id); seen.MainNodeID != "node-a" {
		t.Fatalf("a node that had never seen a line took the seat: %+v", seen)
	}

	// And the main, whom nobody has reached, still runs its own room.
	storeA.SetLeaseTTL(ttl)
	if _, _, err := storeA.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("the main lost authority to a challenger that could not exist: %v", err)
	}
}
