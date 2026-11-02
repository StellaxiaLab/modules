package talk

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The summary cache must say exactly what a fresh readLog would, in every
// state a log file can be in. These tests compare the two directly.

func referenceSummary(t *testing.T, path string) (logSummary, error) {
	t.Helper()
	lines, err := readLog(path)
	if err != nil {
		return logSummary{}, err
	}
	out := logSummary{keyed: map[string]Entry{}}
	for _, line := range lines {
		out.lastSeq = line.Seq
		if line.Lamport > out.maxLamport {
			out.maxLamport = line.Lamport
		}
		if line.IdempotencyKey != "" {
			out.keyed[line.IdempotencyKey] = line.Entry
		}
	}
	return out, nil
}

func requireSameSummary(t *testing.T, store *Store, path, step string) {
	t.Helper()
	want, wantErr := referenceSummary(t, path)
	got, gotErr := store.summarizeLogLocked(path)
	if (wantErr == nil) != (gotErr == nil) {
		t.Fatalf("%s: error mismatch: readLog=%v index=%v", step, wantErr, gotErr)
	}
	if wantErr != nil {
		return
	}
	if got.lastSeq != want.lastSeq || got.maxLamport != want.maxLamport || len(got.keyed) != len(want.keyed) {
		t.Fatalf("%s: index = seq %d lamport %d keys %d, readLog = seq %d lamport %d keys %d",
			step, got.lastSeq, got.maxLamport, len(got.keyed), want.lastSeq, want.maxLamport, len(want.keyed))
	}
	for key, entry := range want.keyed {
		if got.keyed[key] != entry {
			t.Fatalf("%s: key %q maps to %+v, want %+v", step, key, got.keyed[key], entry)
		}
	}
}

func TestLogSummaryTracksReadLogThroughAppendTornTailAndReplacement(t *testing.T) {
	store, err := NewStore(t.TempDir(), func() string { return "node-a" })
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "node-a.jsonl")

	requireSameSummary(t, store, path, "missing file")

	for i, key := range []string{"", "k1", "", "k2"} {
		line := storedEntry{Entry: Entry{AuthorNodeID: "node-a", Kind: KindMessage, Seq: i + 1, Lamport: (i + 1) * 3, Text: "x"}, IdempotencyKey: key}
		if err := appendLine(path, line); err != nil {
			t.Fatal(err)
		}
		requireSameSummary(t, store, path, "after append")
	}

	// A torn final line is tolerated and must not move the summary.
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(`{"author_node_id":"node-a","kind":"mess`); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	requireSameSummary(t, store, path, "torn tail")

	// A real line appended after a torn one makes the torn one mid-file
	// corruption on the next line — both views must refuse it.
	file, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("\n" + `{"author_node_id":"node-a","kind":"message","seq":5,"lamport":15}` + "\n"); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	requireSameSummary(t, store, path, "torn tail followed by a line")

	// Replacing the file with different, longer content must not be mistaken
	// for an append to the old one.
	var replacement strings.Builder
	for i := 1; i <= 12; i++ {
		replacement.WriteString(`{"author_node_id":"node-a","kind":"message","seq":` + string(rune('0'+i%10)) + `,"lamport":99,"text":"replaced replaced replaced replaced replaced replaced"}` + "\n")
	}
	if err := os.WriteFile(path, []byte(replacement.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	requireSameSummary(t, store, path, "replaced with longer content")

	// Shrunk file.
	if err := os.WriteFile(path, []byte(`{"author_node_id":"node-a","kind":"message","seq":1,"lamport":1}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	requireSameSummary(t, store, path, "shrunk")

	// NUL bytes are lost data in both views.
	if err := os.WriteFile(path, []byte("\x00\x00\x00\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	requireSameSummary(t, store, path, "NUL bytes")

	// Gone.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	requireSameSummary(t, store, path, "removed")
}
