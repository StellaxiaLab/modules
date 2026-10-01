package talk

import (
	"errors"
	"testing"
	"time"
)

// The lease exists so that a dead main can be replaced without a partition
// producing two. Every test here is one half of that: the incumbent gives up,
// or the challenger takes over, and the two happen in that order.

// a room where node-b outranks the creating main, which is where a handover can
// legitimately go.
func leasedRoom(t *testing.T, ttl time.Duration) (*Store, string) {
	t.Helper()
	store := newTestStore(t, "node-a")
	store.SetLeaseTTL(ttl)
	conversation, err := store.Create("임차", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return store, conversation.ConversationID
}

// A main that HAS been reached and then goes unreached stands down from the one
// decision that must not happen twice — and keeps everything else, including the
// ability to clean the room up.
func TestALapsedMainStopsAddingButKeepsEverythingElse(t *testing.T) {
	store, id := leasedRoom(t, 30*time.Millisecond)
	// Someone reached it: now there is a challenger that could exist, and a
	// lease worth running.
	store.TouchPeerContact(id)
	if _, _, err := store.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("adding while the lease is held: %v", err)
	}

	time.Sleep(60 * time.Millisecond)

	if _, _, err := store.AddMember(id, "node-d", nil); !errors.Is(err, ErrMainLeaseLapsed) {
		t.Errorf("adding after the lease lapsed: %v", err)
	}
	// Everything that SHRINKS the room stays available. Two mains removing, or
	// deleting, converge on the smaller room; two mains adding do not. And an
	// operator who cannot clean up a room has no way out at all.
	if _, _, err := store.RemoveMember(id, "node-c"); err != nil {
		t.Errorf("a lapsed main could not remove a member: %v", err)
	}
	if _, err := store.AppendMessage(id, "메인이 물러나도 말은 오간다", ""); err != nil {
		t.Errorf("a lapsed main stopped taking messages: %v", err)
	}
	if _, _, err := store.DeleteAsMain(id); err != nil {
		t.Errorf("a lapsed main could not delete its own room: %v", err)
	}
}

// Being reached again restores it. Standing down is a pause, not a forfeit — the
// main is alive and the moment anyone talks to it again it is the main again.
func TestALapsedMainRecoversWhenReachedAgain(t *testing.T) {
	store, id := leasedRoom(t, 30*time.Millisecond)
	store.TouchPeerContact(id)
	time.Sleep(60 * time.Millisecond)
	if _, _, err := store.AddMember(id, "node-c", nil); !errors.Is(err, ErrMainLeaseLapsed) {
		t.Fatalf("fixture: expected a lapsed lease, got %v", err)
	}

	store.TouchPeerContact(id)
	if _, _, err := store.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("a main that was reached again did not recover: %v", err)
	}
}

// A main NOBODY has ever reached keeps full authority, forever.
//
// This is the failure that broke a live room. The clock used to start when the
// seat was taken, so a main whose only other member was a node that never
// existed stood down after 45 seconds and could no longer manage its own
// conversation — it had lost a race nobody was running. A challenger can only
// promote over a main it has synced with, and syncing with a main is reaching
// it, so "never reached" and "no challenger can exist" are the same fact.
func TestAMainNobodyHasReachedKeepsAuthority(t *testing.T) {
	store, id := leasedRoom(t, 10*time.Millisecond)
	time.Sleep(50 * time.Millisecond)
	if _, _, err := store.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("a main nobody had reached stood down: %v", err)
	}
	held, err := store.MainLeaseHeld(id, 10*time.Millisecond)
	if err != nil || !held {
		t.Fatalf("lease held = %v (%v)", held, err)
	}
}

// A room of one has nobody to be reached by and nobody to take over.
func TestARoomOfOneNeedsNoLease(t *testing.T) {
	store := newTestStore(t, "node-a")
	store.SetLeaseTTL(10 * time.Millisecond)
	conversation, err := store.Create("혼자", nil, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	store.TouchPeerContact(id)
	time.Sleep(40 * time.Millisecond)
	if _, _, err := store.AddMember(id, "node-b", nil); err != nil {
		t.Fatalf("a room of one was held to a lease: %v", err)
	}
}

// The contact record survives a restart, because the silence does. A main that
// was reached five minutes ago and then rebooted has still been out of touch for
// five minutes, and a challenger that synced before the reboot still holds the
// proof that lets it promote.
func TestTheContactRecordSurvivesARestart(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root, func() string { return "node-a" })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	store.SetLeaseTTL(30 * time.Millisecond)
	conversation, err := store.Create("재시작", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	store.TouchPeerContact(id)
	time.Sleep(60 * time.Millisecond)

	restarted, err := NewStore(root, func() string { return "node-a" })
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	restarted.SetLeaseTTL(30 * time.Millisecond)
	if _, _, err := restarted.AddMember(id, "node-c", nil); !errors.Is(err, ErrMainLeaseLapsed) {
		t.Fatalf("a restart forgot that the room had gone quiet: %v", err)
	}
	// And a conversation never reached in its life stays unreached across a
	// restart too — the absence is a fact, not a missing record.
	fresh, err := store.Create("한 번도 안 닿음", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	time.Sleep(60 * time.Millisecond)
	again, _ := NewStore(root, func() string { return "node-a" })
	again.SetLeaseTTL(30 * time.Millisecond)
	if _, _, err := again.AddMember(fresh.ConversationID, "node-c", nil); err != nil {
		t.Fatalf("a never-reached room lapsed after a restart: %v", err)
	}
}

// The challenger's half. Promotion takes the seat without asking, so it has to
// pass the same bar a cooperative claim does.
func TestPromoteSelfTakesTheSeatOnlyWhenItMay(t *testing.T) {
	main, id := leasedRoom(t, time.Hour)
	if _, err := main.AppendMessage(id, "메인이 남긴 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	view, marks, err := main.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	challenger := newTestStore(t, "node-b")
	if _, err := challenger.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	// Not caught up: the main holds a line this node has never seen.
	if _, err := challenger.PromoteSelf(id, marks, 0); !errors.Is(err, ErrCatchUpIncomplete) {
		t.Fatalf("promotion without catching up: %v", err)
	}

	// Catch up, then take it.
	slice, err := main.ReadReplica(id, "node-a", 0, 100)
	if err != nil {
		t.Fatalf("read replica: %v", err)
	}
	if _, err := challenger.MergeEntries(id, slice.Entries, view.Epoch, nil); err != nil {
		t.Fatalf("merge: %v", err)
	}
	result, err := challenger.PromoteSelf(id, marks, 0)
	if err != nil {
		t.Fatalf("promotion after catching up: %v", err)
	}
	if result.Epoch != view.Epoch+1 || result.MainNodeID != "node-b" || result.PreviousMainName != "node-a" {
		t.Fatalf("promotion result: %+v", result)
	}
	promoted, _, err := challenger.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if promoted.MainNodeID != "node-b" || promoted.Role != "main" {
		t.Fatalf("post-promotion view: %+v", promoted)
	}
	// The new main starts its own lease rather than inheriting a clock that has
	// already run out — otherwise it would stand down the instant it stood up.
	if _, _, err := challenger.AddMember(id, "node-c", nil); err != nil {
		t.Errorf("the newly promoted main was already lapsed: %v", err)
	}
	// And it cannot promote itself again.
	if _, err := challenger.PromoteSelf(id, nil, 0); !errors.Is(err, ErrInvalid) {
		t.Errorf("promoting an already-main node: %v", err)
	}
}

// Exactly one node may promote. A rule that let the second-ranked node take over
// while the first was merely quiet is a rule that promotes two nodes in a
// three-way partition, so the lower-ranked one waits — even though that means a
// room can sit without a main when two nodes are down.
func TestOnlyTheHighestRankedMemberPromotes(t *testing.T) {
	store := newTestStore(t, "node-a")
	// order fixes rank: node-b 0, node-c 1, node-a 2 (the creating main).
	conversation, err := store.Create("순위", []string{"node-b", "node-c", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	view, _, _ := store.Get(id)

	third := newTestStore(t, "node-c")
	if _, err := third.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, err := third.PromoteSelf(id, nil, 0); !errors.Is(err, ErrNotHighestRanked) {
		t.Fatalf("the second-ranked member promoted: %v", err)
	}

	second := newTestStore(t, "node-b")
	if _, err := second.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, err := second.PromoteSelf(id, nil, 0); err != nil {
		t.Fatalf("the highest-ranked member could not promote: %v", err)
	}
}

// A node that does not outrank the main has no business taking the seat, whether
// it asks or not.
func TestPromoteSelfStillRespectsRankAndMembership(t *testing.T) {
	store := newTestStore(t, "node-a") // self rank 0, node-b rank 1
	conversation, err := store.Create("순위 역전", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	view, _, _ := store.Get(id)

	lower := newTestStore(t, "node-b")
	if _, err := lower.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, err := lower.PromoteSelf(id, nil, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a lower-ranked node promoted: %v", err)
	}

	// Removal is enforced a step earlier: AdoptConversation refuses a view this
	// node is not an active member of, so a removed member never receives the
	// removal and cannot reach PromoteSelf holding it. The membership check
	// there is a guard on the argument, not a path any peer can walk.
}

// The hysteresis window that paces cooperative claims paces promotions too. It
// is per-NODE pacing — how recently THIS node took or lost the seat — so what it
// stops is flapping: a node that promotes, gets demoted when the old main
// returns, and immediately promotes again.
func TestPromotionIsPacedByHysteresis(t *testing.T) {
	main := newTestStore(t, "node-a")
	conversation, err := main.Create("제동", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	view, _, _ := main.Get(id)

	challenger := newTestStore(t, "node-b")
	if _, err := challenger.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, err := challenger.PromoteSelf(id, nil, 0); err != nil {
		t.Fatalf("first promotion: %v", err)
	}

	// The old main comes back with a higher epoch and takes the seat again.
	returned, _, _ := challenger.Get(id)
	returned.Epoch++
	returned.MainNodeID = "node-a"
	if _, err := challenger.AdoptConversation(returned); err != nil {
		t.Fatalf("demotion: %v", err)
	}

	if _, err := challenger.PromoteSelf(id, nil, time.Hour); !errors.Is(err, ErrHandoverSuppressed) {
		t.Fatalf("promotion inside the window: %v", err)
	}
	if _, err := challenger.PromoteSelf(id, nil, time.Nanosecond); err != nil {
		t.Fatalf("promotion after the window: %v", err)
	}
}

// The safety argument in one test: the incumbent has already stood down by the
// time the challenger takes over. Both sides measure their own elapsed time, and
// the grace margin is what keeps the two events in that order.
func TestTheIncumbentStandsDownBeforeTheChallengerStandsUp(t *testing.T) {
	const ttl, grace = 40 * time.Millisecond, 40 * time.Millisecond
	main, id := leasedRoom(t, ttl)
	// The challenger reaching the main is what starts both clocks — its own
	// patience and the main's lease. Neither runs before the two have met.
	main.TouchPeerContact(id)
	view, marks, _ := main.Get(id)

	challenger := newTestStore(t, "node-b")
	if _, err := challenger.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	// At the moment the challenger would take over (ttl+grace), the incumbent
	// must already have refused to decide anything (it lapsed at ttl).
	time.Sleep(ttl + grace)

	if _, _, err := main.AddMember(id, "node-c", nil); !errors.Is(err, ErrMainLeaseLapsed) {
		t.Fatalf("the incumbent was still deciding when the challenger took over: %v", err)
	}
	if _, err := challenger.PromoteSelf(id, marks, 0); err != nil {
		t.Fatalf("the challenger could not take a seat nobody was holding: %v", err)
	}

	// And when the old main comes back, it adopts the higher epoch rather than
	// arguing — the ordinary replication rule, not a special case.
	promoted, _, _ := challenger.Get(id)
	if _, err := main.AdoptConversation(promoted); err != nil {
		t.Fatalf("the old main could not adopt: %v", err)
	}
	back, _, _ := main.Get(id)
	if back.MainNodeID != "node-b" || back.Role != "backup" {
		t.Fatalf("the returning main did not step aside: %+v", back)
	}
}
