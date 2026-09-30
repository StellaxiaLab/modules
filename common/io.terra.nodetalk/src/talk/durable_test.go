package talk

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// nulFill overwrites path with as many NUL bytes as it held, which is what an
// unclean shutdown leaves behind when a rename reached the disk and the data
// blocks behind it did not.
func nulFill(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	size := info.Size()
	if size == 0 {
		t.Fatalf("%s is empty; there is nothing to corrupt", path)
	}
	if err := os.WriteFile(path, bytes.Repeat([]byte{0}, int(size)), 0o644); err != nil {
		t.Fatalf("corrupt %s: %v", path, err)
	}
}

// The defect a desktop hit on 2026-09-07: one conversation's cursor.json came
// back NUL-filled and `terra nodetalk list` answered
//
//	NODETALK_UNAVAILABLE: talk: decode cursor: invalid character '\x00'
//
// The cursor is a cache of what peers reported. Losing it costs an accurate
// "behind" count until the next sync tick — it must not cost the caller the
// list, and least of all the rooms that were never damaged.
func TestALostCursorDoesNotTakeTheConversationListDown(t *testing.T) {
	store := newTestStore(t, "node-a")
	var logged bytes.Buffer
	store.SetLogger(log.New(&logged, "", 0))

	damaged := seedConversation(t, store, "손상된 방")
	healthy := seedConversation(t, store, "멀쩡한 방")
	if err := store.UpdatePeerMarks(damaged, "node-b", map[string]int{"node-b": 7}); err != nil {
		t.Fatalf("record peer marks: %v", err)
	}
	nulFill(t, store.cursorPath(damaged))

	summaries, err := store.List()
	if err != nil {
		t.Fatalf("list refused to answer because one cursor was unreadable: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("list returned %d conversations, want 2 — a damaged cache hid a healthy room", len(summaries))
	}
	for _, summary := range summaries {
		if summary.Conversation.ConversationID == damaged && summary.Behind != 0 {
			t.Errorf("behind = %d for the damaged room, want 0 — the cache is gone, so nothing is known missing yet", summary.Behind)
		}
		if summary.Conversation.ConversationID == healthy && summary.Behind != 0 {
			t.Errorf("behind = %d for the undamaged room", summary.Behind)
		}
	}
	if !strings.Contains(logged.String(), damaged) {
		t.Errorf("nothing was logged about the damaged cursor; recovery must not also be silent.\nlog: %q", logged.String())
	}
}

// Recovery that deletes the evidence leaves nobody able to say what happened.
// The unreadable bytes are kept, and the next write starts clean.
func TestALostCursorIsKeptAsideAndTheNextWriteStartsClean(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "증거 보존")
	if err := store.UpdatePeerMarks(id, "node-b", map[string]int{"node-b": 4}); err != nil {
		t.Fatalf("record peer marks: %v", err)
	}
	nulFill(t, store.cursorPath(id))

	// UpdatePeerMarks reads before it writes, so this one call both recovers
	// and re-establishes the cursor.
	if err := store.UpdatePeerMarks(id, "node-b", map[string]int{"node-b": 9}); err != nil {
		t.Fatalf("record peer marks after damage: %v", err)
	}

	kept, err := filepath.Glob(store.cursorPath(id) + ".corrupt-*")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(kept) != 1 {
		t.Fatalf("found %d quarantined cursor files, want 1 — the damaged bytes were thrown away", len(kept))
	}
	raw, err := os.ReadFile(kept[0])
	if err != nil {
		t.Fatalf("read quarantined file: %v", err)
	}
	if !bytes.Contains(raw, []byte{0}) {
		t.Errorf("the quarantined file does not hold the damage it was kept for")
	}

	marks, err := store.PeerMarks(id, "node-b")
	if err != nil {
		t.Fatalf("peer marks: %v", err)
	}
	if marks["node-b"] != 9 {
		t.Errorf("peer marks = %v, want node-b at 9 — the rebuilt cursor did not take", marks)
	}
}

// A log is not a cache. An interrupted append leaves a PREFIX of the JSON being
// written and may be discarded; NUL bytes are not a prefix of anything this
// store writes, so reading them as "the tail did not finish" would report a
// conversation whose transcript was lost as an empty one.
func TestALogWhoseBytesWereLostIsNotReadAsAnEmptyConversation(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "전사 손실")
	for _, text := range []string{"첫 줄", "둘째 줄", "셋째 줄"} {
		if _, err := store.AppendMessage(id, text, ""); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	nulFill(t, filepath.Join(store.conversationDir(id), "log", "node-a.jsonl"))

	entries, _, err := store.Entries(id, 0, 100)
	if err == nil {
		t.Fatalf("reading a log whose bytes were lost returned %d entries and no error — the transcript is gone and nothing said so", len(entries))
	}
	if !strings.Contains(err.Error(), "NUL") {
		t.Errorf("error = %q, want it to name the NUL bytes so an operator knows this is lost data, not a torn append", err)
	}
}

// The other half of the same rule: a genuinely interrupted append — a valid
// prefix at the end of the file — is still forgiven, because that record was
// never completed and nothing downstream saw it.
func TestAnInterruptedAppendIsStillForgiven(t *testing.T) {
	store := newTestStore(t, "node-a")
	id := seedConversation(t, store, "잘린 꼬리")
	if _, err := store.AppendMessage(id, "완결된 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	path := filepath.Join(store.conversationDir(id), "log", "node-a.jsonl")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("open log: %v", err)
	}
	if _, err := file.WriteString(`{"author_node_id":"node-a","kind":"mess`); err != nil {
		t.Fatalf("write torn tail: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	entries, _, err := store.Entries(id, 0, 100)
	if err != nil {
		t.Fatalf("a half-written tail must not fail the read: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want the 1 completed line", len(entries))
	}
}

// A replacement leaves the complete new file and no litter. The flush itself is
// not observable from a unit test — no filesystem here will lie about it — so
// what this pins is the contract around it: the temp file is gone either way,
// and the target holds exactly what was handed over.
func TestReplaceFileDurableLeavesTheWholeFileAndNoTempBehind(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "meta.json")
	payload := []byte("{\"conversation_id\":\"c1\"}\n")
	if err := replaceFileDurable(dir, ".meta-*.tmp", target, payload); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("target holds %q, want %q", got, payload)
	}

	if err := replaceFileDurable(dir, ".meta-*.tmp", target, []byte("{\"conversation_id\":\"c2\"}\n")); err != nil {
		t.Fatalf("second replace: %v", err)
	}
	leftovers, err := filepath.Glob(filepath.Join(dir, ".meta-*.tmp"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(leftovers) != 0 {
		t.Errorf("left %d temp files behind: %v", len(leftovers), leftovers)
	}
}

// holdsNUL is the whole basis for telling lost bytes from an unfinished write,
// so it is worth stating what it must say about each.
func TestHoldsNULSeparatesLostBytesFromAnUnfinishedWrite(t *testing.T) {
	if holdsNUL(`{"author_node_id":"node-a","kind":"mess`) {
		t.Error("a valid JSON prefix was reported as lost bytes")
	}
	if !holdsNUL("{\"author\":\x00\x00") {
		t.Error("a record holding NUL bytes was reported as merely unfinished")
	}
	if holdsNUL("") {
		t.Error("an empty line was reported as lost bytes")
	}
}
