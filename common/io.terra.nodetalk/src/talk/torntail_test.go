package talk

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppendAfterTornTailLosesNothingAcknowledged(t *testing.T) {
	store, err := NewStore(t.TempDir(), func() string { return "node-a" })
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.Create("torn", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendMessage(conv.ConversationID, "before", ""); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.conversationDir(conv.ConversationID), "log", "node-a.jsonl")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.WriteString(`{"author_node_id":"node-a","kind":"mess`) // crash mid-append, no newline
	_ = file.Close()

	if _, err := store.AppendMessage(conv.ConversationID, "after", ""); err != nil {
		t.Fatalf("append after a torn tail: %v", err)
	}
	entries, _, err := store.Entries(conv.ConversationID, 0, 0)
	if err != nil {
		t.Fatalf("read after append: %v", err)
	}
	texts := []string{}
	for _, entry := range entries {
		texts = append(texts, entry.Text)
	}
	if len(texts) != 2 || texts[1] != "after" {
		t.Fatalf("transcript = %v; the message acknowledged after the torn tail must be readable", texts)
	}
}

func TestAppendKeepsACompleteLineThatLacksItsNewline(t *testing.T) {
	store, err := NewStore(t.TempDir(), func() string { return "node-a" })
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "node-a.jsonl")
	if err := os.WriteFile(path, []byte(`{"author_node_id":"node-a","kind":"message","seq":1,"lamport":1,"text":"whole"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendLine(path, storedEntry{Entry: Entry{AuthorNodeID: "node-a", Kind: KindMessage, Seq: 2, Lamport: 2, Text: "next"}}); err != nil {
		t.Fatal(err)
	}
	got, err := store.summarizeLogLocked(path)
	if err != nil || got.lastSeq != 2 {
		t.Fatalf("summary = %+v err = %v; both lines must survive", got, err)
	}
	lines, err := readLog(path)
	if err != nil || len(lines) != 2 {
		t.Fatalf("lines = %d err = %v, want 2", len(lines), err)
	}
}

func TestAppendRefusesAnUnterminatedTailWithLostBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "node-a.jsonl")
	if err := os.WriteFile(path, []byte("{\"seq\":1}\n\x00\x00\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendLine(path, storedEntry{Entry: Entry{AuthorNodeID: "node-a", Seq: 2}}); err == nil {
		t.Fatal("append over NUL bytes must fail, not cut lost data")
	}
}
