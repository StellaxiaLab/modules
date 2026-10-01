package talk

import (
	"errors"
	"testing"
	"time"
)

// A conversation where node-b outranks the creating main: explicit order
// [node-b, node-a] with node-a creating — D-2's explicit-rank model, the
// handover's natural habitat.
func outrankedMain(t *testing.T) (*Store, string) {
	t.Helper()
	store := newTestStore(t, "node-a")
	conversation, err := store.Create("인수인계", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// creator listed itself at index 1: rank 1, but still the epoch-0 main.
	if conversation.MainNodeID != "node-a" || conversation.Members[0].NodeID != "node-b" {
		t.Fatalf("fixture: %+v", conversation)
	}
	return store, conversation.ConversationID
}

func TestClaimMainHandsOverAtomically(t *testing.T) {
	store, id := outrankedMain(t)
	if _, err := store.AppendMessage(id, "메인의 한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	events, cancel, err := store.Subscribe(id)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer cancel()

	result, err := store.ClaimMain(id, "node-b", 1, map[string]int{"node-a": 1}, 0)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if result.Epoch != 1 || result.MainNodeID != "node-b" || result.PreviousMainName != "node-a" {
		t.Fatalf("handover result: %+v", result)
	}
	view, _, err := store.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if view.MainNodeID != "node-b" || view.Epoch != 1 || view.Role != "backup" {
		t.Fatalf("post-handover view: %+v", view)
	}
	select {
	case event := <-events:
		if event.Event != "main-changed" || event.MainNodeID != "node-b" || event.Epoch == nil || *event.Epoch != 1 {
			t.Fatalf("main-changed event: %+v", event)
		}
	default:
		t.Fatal("no main-changed event")
	}
}

func TestClaimMainRefusals(t *testing.T) {
	store, id := outrankedMain(t)
	if _, err := store.AppendMessage(id, "따라잡을 한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	// ② 증거: 따라잡기 미완 — the claimant holds nothing of node-a.
	if _, err := store.ClaimMain(id, "node-b", 1, map[string]int{}, 0); !errors.Is(err, ErrCatchUpIncomplete) {
		t.Fatalf("incomplete claim: %v", err)
	}
	// ③ 증거: epoch 불일치 (과거를 주장).
	if _, err := store.ClaimMain(id, "node-b", 0, map[string]int{"node-a": 1}, 0); !errors.Is(err, ErrEpochStale) {
		t.Fatalf("stale claim: %v", err)
	}
	// 건너뛰기도 안 된다.
	if _, err := store.ClaimMain(id, "node-b", 5, map[string]int{"node-a": 1}, 0); !errors.Is(err, ErrEpochStale) {
		t.Fatalf("skipping claim: %v", err)
	}
	// 비멤버.
	if _, err := store.ClaimMain(id, "node-z", 1, map[string]int{"node-a": 1}, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("stranger claim: %v", err)
	}
	// 메인이 아닌 노드에 주장이 도착.
	backup := newTestStore(t, "node-b")
	view, _, _ := store.Get(id)
	if _, err := backup.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, err := backup.ClaimMain(id, "node-b", 1, map[string]int{"node-a": 1}, 0); !errors.Is(err, ErrNotMain) {
		t.Fatalf("claim at a backup: %v", err)
	}
}

// A lower-priority node has no claim while the main lives — rank is D-2's
// explicit order, and forced demotion belongs to M5's fault knob.
func TestClaimMainRequiresOutranking(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, err := store.Create("순위", []string{"node-b"}, "") // self rank 0, b rank 1
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.ClaimMain(conversation.ConversationID, "node-b", 1, map[string]int{}, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("underranked claim: %v", err)
	}
}

// §5.5's brake: inside the hysteresis window a structurally valid claim is
// suppressed with its own error, and passes once the window is over.
func TestClaimMainHysteresis(t *testing.T) {
	store, id := outrankedMain(t)
	if _, err := store.ClaimMain(id, "node-b", 1, nil, 0); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	// Hand it back the other way is impossible (rank), so re-raise the window
	// by adopting main=node-a at a higher epoch and claiming again.
	view, _, _ := store.Get(id)
	view.Epoch = 2
	view.MainNodeID = "node-a"
	if _, err := store.AdoptConversation(view); err != nil {
		t.Fatalf("re-seat main: %v", err)
	}
	if _, err := store.ClaimMain(id, "node-b", 3, nil, time.Hour); !errors.Is(err, ErrHandoverSuppressed) {
		t.Fatalf("claim inside hysteresis: %v", err)
	}
	if _, err := store.ClaimMain(id, "node-b", 3, nil, time.Nanosecond); err != nil {
		t.Fatalf("claim after window: %v", err)
	}
}

func TestMembershipChangesAreMainOnlyLogEntries(t *testing.T) {
	store, id := outrankedMain(t)

	added, addedEntry, err := store.AddMember(id, "node-c", nil)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if added.Rank != 2 || added.State != MemberActive || added.JoinedEpoch != 0 {
		t.Fatalf("appended member: %+v", added)
	}
	// The change is a log line with the member named — it replicates like any.
	entries, _, err := store.Entries(id, 0, 0)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	last := entries[len(entries)-1]
	if last.Kind != KindMemberAdded || last.MemberNodeID != "node-c" || last.Seq != 1 {
		t.Fatalf("membership entry: %+v", last)
	}
	// The caller is handed that same entry, because it is what gets pushed to
	// the other members (chat-room design §1) — a zero value there would send
	// nothing and nobody would notice until a room stayed silent.
	if addedEntry.Kind != KindMemberAdded || addedEntry.MemberNodeID != "node-c" || addedEntry.Seq != last.Seq {
		t.Fatalf("returned membership entry: %+v", addedEntry)
	}

	// Insert at rank 0: actives at/below shift down.
	zero := 0
	inserted, _, err := store.AddMember(id, "node-d", &zero)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if inserted.Rank != 0 {
		t.Fatalf("inserted rank: %+v", inserted)
	}
	view, _, _ := store.Get(id)
	ranks := map[string]int{}
	for _, member := range view.Members {
		if member.State == MemberActive {
			ranks[member.NodeID] = member.Rank
		}
	}
	if ranks["node-d"] != 0 || ranks["node-b"] != 1 || ranks["node-a"] != 2 || ranks["node-c"] != 3 {
		t.Fatalf("ranks after insert: %v", ranks)
	}

	removed, _, err := store.RemoveMember(id, "node-c")
	if err != nil || removed.State != MemberRemoved {
		t.Fatalf("remove: %v %+v", err, removed)
	}
	if _, _, err := store.RemoveMember(id, "node-c"); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("re-remove: %v", err)
	}
	if _, _, err := store.RemoveMember(id, "node-a"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("main removing itself: %v", err)
	}

	// A removed member re-invited comes back at the appended rank with the
	// CURRENT epoch as its join epoch.
	if _, err := store.ClaimMain(id, "node-d", 1, map[string]int{"node-a": 3}, 0); err != nil {
		t.Fatalf("claim for epoch bump: %v", err)
	}
	backupView, _, _ := store.Get(id)
	if backupView.Role != "backup" {
		t.Fatalf("expected backup after handover: %+v", backupView)
	}
	if _, _, err := store.AddMember(id, "node-c", nil); !errors.Is(err, ErrNotMain) {
		t.Fatalf("backup adding member: %v", err)
	}
}
