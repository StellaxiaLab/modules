package talk

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestAppendCostGrowsWithLog measures, not asserts: how long one
// AppendMessage takes once the conversation already holds n lines. Run with
// NODETALK_BENCH=1 -v; it exists to put a number behind the "full-log read per append" reading.
func TestAppendCostGrowsWithLog(t *testing.T) {
	if os.Getenv("NODETALK_BENCH") == "" {
		t.Skip("measurement, about a minute: set NODETALK_BENCH=1 to run")
	}
	for _, n := range []int{100, 1000, 10000, 50000, 100000} {
		store, err := NewStore(t.TempDir(), func() string { return "node-a" })
		if err != nil {
			t.Fatal(err)
		}
		conv, err := store.Create("bench", nil, "")
		if err != nil {
			t.Fatal(err)
		}
		// Preload without timing: lay the lines down in one write, the same
		// shape appendLine produces, so the setup is not itself quadratic.
		var buf bytes.Buffer
		for i := 1; i <= n; i++ {
			raw, _ := json.Marshal(storedEntry{Entry: Entry{AuthorNodeID: "node-a", Kind: KindMessage, Lamport: i, Seq: i, Text: "preload message body of ordinary length", WallMs: 1}})
			buf.Write(raw)
			buf.WriteByte(10)
		}
		if err := os.WriteFile(filepath.Join(store.conversationDir(conv.ConversationID), "log", "node-a.jsonl"), buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		const probes = 20
		start := time.Now()
		for i := 0; i < probes; i++ {
			if _, err := store.AppendMessage(conv.ConversationID, "probe", ""); err != nil {
				t.Fatal(err)
			}
		}
		appendMs := float64(time.Since(start).Microseconds()) / probes / 1000
		start = time.Now()
		for i := 0; i < probes; i++ {
			if _, _, err := store.Get(conv.ConversationID); err != nil {
				t.Fatal(err)
			}
		}
		getMs := float64(time.Since(start).Microseconds()) / probes / 1000
		start = time.Now()
		for i := 0; i < probes; i++ {
			if _, err := store.List(); err != nil {
				t.Fatal(err)
			}
		}
		listMs := float64(time.Since(start).Microseconds()) / probes / 1000
		t.Logf("log=%6d lines  append=%8.2f ms  get(watermarks)=%8.2f ms  list=%8.2f ms", n, appendMs, getMs, listMs)
	}
}
