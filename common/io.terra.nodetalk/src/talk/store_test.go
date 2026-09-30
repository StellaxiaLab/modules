package talk

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T, self string) *Store {
	t.Helper()
	store, err := NewStore(t.TempDir(), func() string { return self })
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return store
}

func TestCreateFreezesInviteOrderIntoRank(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, err := store.Create("릴레이 점검", []string{"node-b", "node-c"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// The creator joins at rank 0 even when the caller did not list it.
	want := []struct {
		node string
		rank int
	}{{"node-a", 0}, {"node-b", 1}, {"node-c", 2}}
	if len(conversation.Members) != len(want) {
		t.Fatalf("members: %+v", conversation.Members)
	}
	for i, expectation := range want {
		member := conversation.Members[i]
		if member.NodeID != expectation.node || member.Rank != expectation.rank || member.State != MemberActive {
			t.Fatalf("member %d: %+v, want %+v", i, member, expectation)
		}
	}
	if conversation.Epoch != 0 || conversation.MainNodeID != "node-a" || conversation.Role != "main" {
		t.Fatalf("creator is not the epoch-0 main: %+v", conversation)
	}
}

func TestCreateWithSameKeyIsIdempotent(t *testing.T) {
	store := newTestStore(t, "node-a")
	first, err := store.Create("한 번만", []string{"node-b"}, "retry-key")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	second, err := store.Create("한 번만", []string{"node-b"}, "retry-key")
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if first.ConversationID != second.ConversationID {
		t.Fatalf("retry made a second conversation: %s vs %s", first.ConversationID, second.ConversationID)
	}
	summaries, err := store.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("conversation count: %d, want 1", len(summaries))
	}
}

func TestAppendIsOwnLogOnlyAndMonotonic(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, err := store.Create("전사", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	first, err := store.AppendMessage(id, "첫 줄", "")
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	second, err := store.AppendMessage(id, "둘째 줄", "")
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if first.Seq != 1 || second.Seq != 2 {
		t.Fatalf("seq not monotonic: %d then %d", first.Seq, second.Seq)
	}
	if second.Lamport <= first.Lamport {
		t.Fatalf("lamport not increasing: %d then %d", first.Lamport, second.Lamport)
	}
	if first.WallMs == 0 {
		t.Fatal("wall_ms not stamped")
	}

	// Only this author's file exists, and only under log/.
	logDir := filepath.Join(store.root, "conversations", id, "log")
	files, err := os.ReadDir(logDir)
	if err != nil {
		t.Fatalf("read log dir: %v", err)
	}
	if len(files) != 1 || files[0].Name() != "node-a.jsonl" {
		t.Fatalf("log files: %v", files)
	}
}

func TestAppendWithSameKeyReturnsTheSameEntry(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("멱등", []string{"node-b"}, "")
	id := conversation.ConversationID

	first, err := store.AppendMessage(id, "한 번", "key-1")
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	retry, err := store.AppendMessage(id, "한 번", "key-1")
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if retry.Seq != first.Seq || retry.Lamport != first.Lamport {
		t.Fatalf("retry appended a second line: %+v vs %+v", retry, first)
	}
	entries, _, err := store.Entries(id, 0, 0)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entry count after retry: %d, want 1", len(entries))
	}
}

// A foreign author's log (hand-written here the way M2's replica.push will
// write it) merges into one totally-ordered transcript with no conflicts —
// the property the whole storage design buys.
func TestEntriesMergeAcrossAuthorsInTotalOrder(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("병합", []string{"node-b"}, "")
	id := conversation.ConversationID

	if _, err := store.AppendMessage(id, "a의 첫 줄", ""); err != nil { // lamport 1
		t.Fatalf("append: %v", err)
	}
	foreign := filepath.Join(store.root, "conversations", id, "log", "node-b.jsonl")
	for i, entry := range []Entry{
		{AuthorNodeID: "node-b", Kind: KindMessage, Lamport: 1, Seq: 1, Text: "b의 첫 줄"},
		{AuthorNodeID: "node-b", Kind: KindMessage, Lamport: 2, Seq: 2, Text: "b의 둘째 줄"},
	} {
		if err := appendLine(foreign, storedEntry{Entry: entry}); err != nil {
			t.Fatalf("write foreign line %d: %v", i, err)
		}
	}
	if _, err := store.AppendMessage(id, "a의 둘째 줄", ""); err != nil { // lamport 3 (clock saw b's 2)
		t.Fatalf("append: %v", err)
	}

	entries, hasMore, err := store.Entries(id, 0, 0)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if hasMore {
		t.Fatal("unexpected hasMore")
	}
	got := []string{}
	for _, entry := range entries {
		got = append(got, entry.Text)
	}
	// lamport ties break by author id: (1,node-a) before (1,node-b).
	want := []string{"a의 첫 줄", "b의 첫 줄", "b의 둘째 줄", "a의 둘째 줄"}
	if len(got) != len(want) {
		t.Fatalf("transcript: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("transcript order: %v, want %v", got, want)
		}
	}

	marks, err := func() (map[string]int, error) { _, m, err := store.Get(id); return m, err }()
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if marks["node-a"] != 2 || marks["node-b"] != 2 {
		t.Fatalf("watermarks: %v", marks)
	}
}

func TestEntriesAfterLamportAndLimit(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("증분", []string{"node-b"}, "")
	id := conversation.ConversationID
	for _, text := range []string{"1", "2", "3"} {
		if _, err := store.AppendMessage(id, text, ""); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	entries, hasMore, err := store.Entries(id, 1, 1)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 1 || entries[0].Text != "2" || !hasMore {
		t.Fatalf("incremental read: %+v hasMore=%v", entries, hasMore)
	}
}

func TestSubscribeDeliversAppends(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("구독", []string{"node-b"}, "")
	id := conversation.ConversationID

	events, cancel, err := store.Subscribe(id)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer cancel()

	sent, err := store.AppendMessage(id, "실시간", "")
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	select {
	case event := <-events:
		if event.Event != "entry" || event.Entry == nil || event.Entry.Seq != sent.Seq {
			t.Fatalf("event: %+v", event)
		}
	default:
		t.Fatal("no event delivered")
	}

	cancel()
	cancel() // idempotent
	if _, err := store.AppendMessage(id, "구독 해지 후", ""); err != nil {
		t.Fatalf("append after cancel: %v", err)
	}
}

func TestPathTraversalIdsAreNotFound(t *testing.T) {
	store := newTestStore(t, "node-a")
	for _, id := range []string{"../evil", "..", "a/b", "", ".hidden"} {
		if _, _, err := store.Get(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("id %q: err %v, want ErrNotFound", id, err)
		}
	}
}

func TestTornTailLineIsToleratedMidCorruptionIsNot(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("찢긴 꼬리", []string{"node-b"}, "")
	id := conversation.ConversationID
	if _, err := store.AppendMessage(id, "온전한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	logPath := filepath.Join(store.root, "conversations", id, "log", "node-a.jsonl")

	// A torn final line (interrupted append) must not take the transcript down.
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := file.WriteString(`{"author_node_id":"node-a","kind":"mess`); err != nil {
		t.Fatalf("write torn tail: %v", err)
	}
	_ = file.Close()
	entries, _, err := store.Entries(id, 0, 0)
	if err != nil {
		t.Fatalf("entries with torn tail: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries: %d, want 1", len(entries))
	}

	// The same garbage mid-file is corruption and must error loudly.
	raw, _ := os.ReadFile(logPath)
	valid, _ := json.Marshal(storedEntry{Entry: Entry{AuthorNodeID: "node-a", Kind: KindMessage, Lamport: 9, Seq: 9}})
	if err := os.WriteFile(logPath, append(raw, append([]byte("\n"), append(valid, '\n')...)...), 0o644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	if _, _, err := store.Entries(id, 0, 0); err == nil {
		t.Fatal("mid-file corruption did not error")
	}
}
