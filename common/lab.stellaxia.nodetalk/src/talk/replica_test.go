package talk

import (
	"errors"
	"reflect"
	"sort"
	"testing"
)

func seedConversation(t *testing.T, store *Store, name string) string {
	t.Helper()
	conversation, err := store.Create(name, []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return conversation.ConversationID
}

func entriesOf(author string, seqs ...int) []Entry {
	entries := make([]Entry, 0, len(seqs))
	for _, seq := range seqs {
		entries = append(entries, Entry{
			AuthorNodeID: author, Kind: KindMessage, Lamport: seq, Seq: seq,
			Text: author + "의 " + string(rune('0'+seq)),
		})
	}
	return entries
}

// The core merge property: a re-sent slice is observable as duplicates, never
// as new lines — idempotency as a VALUE, not a promise (M2 evidence ②).
func TestMergeIsIdempotentAndSaysSo(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "멱등 병합")

	first, err := store.MergeEntries(id, entriesOf("node-b", 1, 2, 3), 0, &Transport{Rung: "L1", RTTMs: 40})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if first.Accepted != 3 || first.Duplicates != 0 {
		t.Fatalf("first merge: %+v", first)
	}
	retry, err := store.MergeEntries(id, entriesOf("node-b", 1, 2, 3), 0, nil)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if retry.Accepted != 0 || retry.Duplicates != 3 {
		t.Fatalf("retry merge must be all duplicates: %+v", retry)
	}
	if retry.HighWaterMarks["node-b"] != 3 {
		t.Fatalf("marks: %v", retry.HighWaterMarks)
	}
}

// A gap is neither accepted nor a duplicate — accepting it would make the
// watermark lie about completeness below it.
func TestMergeRefusesGaps(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "구멍")

	result, err := store.MergeEntries(id, entriesOf("node-b", 1, 3), 0, nil)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if result.Accepted != 1 || result.Duplicates != 0 {
		t.Fatalf("gap merge: %+v", result)
	}
	if result.HighWaterMarks["node-b"] != 1 {
		t.Fatalf("marks after gap: %v", result.HighWaterMarks)
	}
}

func TestMergeStampsArrivalTransportAndNotifies(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "계측")
	events, cancel, err := store.Subscribe(id)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer cancel()

	if _, err := store.MergeEntries(id, entriesOf("node-b", 1), 0, &Transport{Rung: "L1", RTTMs: 41}); err != nil {
		t.Fatalf("merge: %v", err)
	}
	select {
	case event := <-events:
		if event.Entry == nil || event.Entry.Transport == nil || event.Entry.Transport.Rung != "L1" {
			t.Fatalf("merged entry event lacks arrival transport: %+v", event)
		}
	default:
		t.Fatal("merge did not notify local subscribers")
	}

	// …and the transcript carries it, but a replica read strips it: arrival
	// instrumentation is local truth, never travel baggage.
	entries, _, err := store.Entries(id, 0, 0)
	if err != nil || len(entries) != 1 || entries[0].Transport == nil {
		t.Fatalf("transcript transport: %v %+v", err, entries)
	}
	slice, err := store.ReadReplica(id, "node-b", 0, 0)
	if err != nil || len(slice.Entries) != 1 {
		t.Fatalf("replica read: %v %+v", err, slice)
	}
	if slice.Entries[0].Transport != nil {
		t.Fatal("replica read must strip transport")
	}
}

func TestMergeRefusesStaleEpochAndOwnAuthorship(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "epoch 게이트")

	// Raise the local epoch by adopting a higher-epoch view of the same
	// conversation (the M3 handover will do this for real).
	view, _, err := store.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	view.Epoch = 2
	if _, err := store.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	if _, err := store.MergeEntries(id, entriesOf("node-b", 1), 1, nil); !errors.Is(err, ErrEpochStale) {
		t.Fatalf("stale epoch: err=%v", err)
	}

	// An echo of our own authorship is a duplicate, never a write.
	result, err := store.MergeEntries(id, entriesOf("node-a", 1), 2, nil)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if result.Accepted != 0 || result.Duplicates != 1 {
		t.Fatalf("own-author echo: %+v", result)
	}
}

func TestAdoptConversationRules(t *testing.T) {
	origin := newTestStore(t, "node-a")
	id := seedConversation(t, origin, "입양")
	view, _, err := origin.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	// A member adopts.
	member := newTestStore(t, "node-b")
	adopted, err := member.AdoptConversation(view)
	if err != nil || !adopted {
		t.Fatalf("member adopt: %v %v", adopted, err)
	}
	// Same epoch again: untouched.
	again, err := member.AdoptConversation(view)
	if err != nil || again {
		t.Fatalf("re-adopt at same epoch: %v %v", again, err)
	}
	// A bystander does not.
	bystander := newTestStore(t, "node-z")
	if _, err := bystander.AdoptConversation(view); err == nil {
		t.Fatal("a non-member must not adopt a conversation")
	}
}

func TestPeerMarksDriveBehind(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "뒤처짐")
	if _, err := store.AppendMessage(id, "내 한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	// node-b reports holding: itself at 5, me at 1.
	if err := store.UpdatePeerMarks(id, "node-b", map[string]int{"node-b": 5, "node-a": 1}); err != nil {
		t.Fatalf("update marks: %v", err)
	}
	behind, _, err := store.Behind(id)
	if err != nil {
		t.Fatalf("behind: %v", err)
	}
	if behind != 5 {
		t.Fatalf("behind = %d, want 5 (all of node-b's lines are missing)", behind)
	}

	// Catch up 3 of them: behind shrinks to 2, and List carries it.
	if _, err := store.MergeEntries(id, entriesOf("node-b", 1, 2, 3), 0, nil); err != nil {
		t.Fatalf("merge: %v", err)
	}
	summaries, err := store.List()
	if err != nil || len(summaries) != 1 {
		t.Fatalf("list: %v %+v", err, summaries)
	}
	if summaries[0].Behind != 2 {
		t.Fatalf("behind in list = %d, want 2", summaries[0].Behind)
	}
}

func TestActiveMemberPeers(t *testing.T) {
	store := newTestStore(t, "node-a")
	if _, err := store.Create("하나", []string{"node-b", "node-c"}, ""); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.Create("둘", []string{"node-b", "node-d"}, ""); err != nil {
		t.Fatalf("create: %v", err)
	}
	peers, err := store.ActiveMemberPeers()
	if err != nil {
		t.Fatalf("peers: %v", err)
	}
	want := "node-b,node-c,node-d"
	got := ""
	for i, peer := range peers {
		if i > 0 {
			got += ","
		}
		got += peer
	}
	if got != want {
		t.Fatalf("peers = %s, want %s", got, want)
	}
}

// membersOf lists the active member ids in a node's copy, for comparing views.
func membersOf(t *testing.T, store *Store, id string) []string {
	t.Helper()
	conversation, _, err := store.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	active := []string{}
	for _, member := range conversation.Members {
		if member.State == MemberActive {
			active = append(active, member.NodeID)
		}
	}
	sort.Strings(active)
	return active
}

// A node that joined a conversation never learned about members added after it.
//
// Membership lives only in the meta, and two paths write it: the main's own
// mutation, and adoption. MergeEntries does not — a member-added entry is a
// transcript line, not the state. Adoption then refuses a conversation it
// already knows unless the EPOCH advanced, and adding a member does not
// advance the epoch (only a main handover does). So the second member's copy
// stays frozen at the membership it joined with, forever.
//
// That is not a cosmetic staleness. A node that does not consider a peer a
// member refuses that peer's replica push with 404 (guardPeer), and the peer's
// own sync loop silently skips the conversation because the peer's listing
// does not show it as a member — no error, no log, on either side. The two
// simply stop speaking directly and route everything through the main, one
// tick each way.
//
// Measured that way on three real nodes: the RDK, invited first, never learned
// the desktop, invited second. Desktop→RDK push failed 404 every time while
// desktop↔server and server↔RDK were immediate.
func TestAdoptLearnsAMemberAddedAfterThisNodeJoined(t *testing.T) {
	main := newTestStore(t, "node-a")
	id := seedConversation(t, main, "멤버십") // members: node-a, node-b

	// node-b joins with the membership as it stands.
	joined, _, err := main.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	second := newTestStore(t, "node-b")
	if _, err := second.AdoptConversation(joined); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	// The main adds a third. No handover happened, so the epoch does not move —
	// which is exactly what makes the adoption gate misfire.
	if _, _, err := main.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("add member: %v", err)
	}
	grown, _, err := main.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if grown.Epoch != joined.Epoch {
		t.Fatalf("epoch moved on a member add (%d → %d); this test is about the case where it does not",
			joined.Epoch, grown.Epoch)
	}

	if _, err := second.AdoptConversation(grown); err != nil {
		t.Fatalf("re-adopt: %v", err)
	}

	want := []string{"node-a", "node-b", "node-c"}
	if got := membersOf(t, second, id); !reflect.DeepEqual(got, want) {
		t.Fatalf("members = %v, want %v — a member added after this node joined never arrived", got, want)
	}
}

// The epoch gate still has to do its job: a view from before a handover must
// not overwrite the newer one, membership included.
func TestAdoptStillRefusesAViewFromBeforeAHandover(t *testing.T) {
	main := newTestStore(t, "node-a")
	id := seedConversation(t, main, "임차")
	stale, _, err := main.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	second := newTestStore(t, "node-b")
	if _, err := second.AdoptConversation(stale); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	// node-b takes over: its own copy moves to a higher epoch.
	promoted := stale
	promoted.Epoch = stale.Epoch + 1
	promoted.MainNodeID = "node-b"
	if _, err := second.AdoptConversation(promoted); err != nil {
		t.Fatalf("adopt promoted: %v", err)
	}

	// The old view arrives late. It must not put the main back.
	if _, err := second.AdoptConversation(stale); err != nil {
		t.Fatalf("adopt stale: %v", err)
	}
	conversation, _, err := second.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if conversation.MainNodeID != "node-b" || conversation.Epoch != promoted.Epoch {
		t.Fatalf("a pre-handover view was applied: main=%s epoch=%d", conversation.MainNodeID, conversation.Epoch)
	}
}

// The two clocks have an order. A handover always wins, even if the view that
// carries it names fewer membership changes than the copy it replaces —
// otherwise a node could refuse the new main because its own membership clock
// happened to be ahead.
func TestAdoptLetsTheEpochOutrankTheMembershipClock(t *testing.T) {
	main := newTestStore(t, "node-a")
	id := seedConversation(t, main, "우선순위")
	if _, _, err := main.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("add member: %v", err)
	}
	grown, _, err := main.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if grown.MembersRev == 0 {
		t.Fatal("adding a member did not move the membership clock")
	}

	second := newTestStore(t, "node-b")
	if _, err := second.AdoptConversation(grown); err != nil {
		t.Fatalf("adopt: %v", err)
	}

	// A handover arrives from a copy that has seen fewer membership changes.
	handover := grown
	handover.Epoch = grown.Epoch + 1
	handover.MainNodeID = "node-b"
	handover.MembersRev = grown.MembersRev - 1

	if _, err := second.AdoptConversation(handover); err != nil {
		t.Fatalf("adopt handover: %v", err)
	}
	conversation, _, err := second.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if conversation.MainNodeID != "node-b" || conversation.Epoch != handover.Epoch {
		t.Fatalf("the handover was refused over a membership clock: main=%s epoch=%d",
			conversation.MainNodeID, conversation.Epoch)
	}
}
