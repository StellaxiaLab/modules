package transfer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/leaf/lab.stellaxia.file/store"
)

func (h *harness) read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(h.shared, path))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// TestOverwritingWithASmallerFileLeavesNoOldTail: the in-place write never
// truncated, so the old file's tail survived behind the new bytes.
func TestOverwritingWithASmallerFileLeavesNoOldTail(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.shared, "r.bin"), []byte(strings.Repeat("O", 40)), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte("new-bytes")
	for _, withChecksum := range []bool{true, false} {
		record := h.push(t, "r.bin", payload, Overwrite)
		if !withChecksum {
			var err error
			record, err = h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "r.bin",
				SizeBytes: int64(len(payload)), Mode: Overwrite})
			if err != nil {
				t.Fatal(err)
			}
		}
		h.sendAll(t, record, payload)
		done, err := h.manager.Complete(record.ID)
		if err != nil {
			t.Fatalf("complete (checksum=%v): %v", withChecksum, err)
		}
		if done.Verified != withChecksum {
			t.Errorf("verified = %v with checksum=%v", done.Verified, withChecksum)
		}
		if got := h.read(t, "r.bin"); got != string(payload) {
			t.Fatalf("file = %q, want %q", got, payload)
		}
	}
}

// TestAFailedOverwriteKeepsTheOriginal: a mismatch must not cost the user the
// file that was there before the transfer began.
func TestAFailedOverwriteKeepsTheOriginal(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.shared, "keep.bin"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte("12345678")
	record, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "keep.bin",
		SizeBytes: 8, Checksum: store.Checksum([]byte("different")), Mode: Overwrite})
	if err != nil {
		t.Fatal(err)
	}
	h.sendAll(t, record, payload)
	if got := h.read(t, "keep.bin"); got != "original" {
		t.Fatalf("original replaced before verification: %q", got)
	}
	if _, err := h.manager.Complete(record.ID); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("complete = %v", err)
	}
	if got := h.read(t, "keep.bin"); got != "original" {
		t.Fatalf("original lost after mismatch: %q", got)
	}
	if entries, _ := os.ReadDir(h.shared); len(entries) != 1 {
		t.Errorf("leftover files: %v", entries)
	}
}

func TestAbortingAnOverwriteKeepsTheOriginal(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.shared, "keep.bin"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte("12345678abcdefgh")
	record := h.push(t, "keep.bin", payload, Overwrite)
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload[:8], ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.manager.Abort(record.ID, "giving up", true); err != nil {
		t.Fatal(err)
	}
	if got := h.read(t, "keep.bin"); got != "original" {
		t.Fatalf("original = %q", got)
	}
	if entries, _ := os.ReadDir(h.shared); len(entries) != 1 {
		t.Errorf("leftover files: %v", entries)
	}
}

func TestAnInterruptedOverwriteResumes(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.shared, "r.bin"), []byte(strings.Repeat("O", 40)), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte("12345678abcdefgh")
	record := h.push(t, "r.bin", payload, Overwrite)
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload[:8], ""); err != nil {
		t.Fatal(err)
	}
	resumed, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "r.bin",
		SizeBytes: 16, Checksum: store.Checksum(payload), Mode: Overwrite, ResumeID: record.ID})
	if err != nil || resumed.Offset != 8 {
		t.Fatalf("resume = %+v, %v", resumed, err)
	}
	if _, err := h.manager.AcceptChunk(record.ID, 8, payload[8:], ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.manager.Complete(record.ID); err != nil {
		t.Fatal(err)
	}
	if got := h.read(t, "r.bin"); got != string(payload) {
		t.Fatalf("file = %q", got)
	}
}

func TestAChunkPastTheDeclaredSizeIsRefused(t *testing.T) {
	h := newHarness(t)
	record, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "s.bin", SizeBytes: 4})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.manager.AcceptChunk(record.ID, 0, []byte("12345"), ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized chunk = %v, want ErrTooLarge", err)
	}
	if _, err := os.Stat(filepath.Join(h.shared, "s.bin")); !os.IsNotExist(err) {
		t.Error("a refused chunk left a file")
	}
	if cur, _ := h.manager.Get(record.ID); cur.Offset != 0 {
		t.Errorf("offset moved to %d", cur.Offset)
	}
}

func TestAChunkPastTheCeilingIsRefused(t *testing.T) {
	h := newHarness(t)
	record, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "s.bin", SizeBytes: 6})
	if err != nil {
		t.Fatal(err)
	}
	h.manager.maxByte = 4 // the ceiling was lowered after prepare
	if _, err := h.manager.AcceptChunk(record.ID, 0, []byte("123456"), ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("= %v, want ErrTooLarge", err)
	}
}

func TestCompletingAnIncompletePushIsRefusedAndKeepsTheCheckpoint(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678abcdefgh")
	record := h.push(t, "short.bin", payload, Create)
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload[:8], ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.manager.Complete(record.ID); !errors.Is(err, ErrWrongState) {
		t.Fatalf("complete = %v, want ErrWrongState", err)
	}
	if cur, err := h.manager.Get(record.ID); err != nil || cur.State == Completed || cur.Offset != 8 {
		t.Errorf("checkpoint = %+v, %v", cur, err)
	}
}

func TestVerifiedMeansTheChecksumWasCompared(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678")
	record, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "nc.bin", SizeBytes: 8})
	if err != nil {
		t.Fatal(err)
	}
	h.sendAll(t, record, payload)
	done, err := h.manager.Complete(record.ID)
	if err != nil || done.Verified {
		t.Fatalf("no-checksum push: %+v, %v", done, err)
	}
	pull, err := h.manager.Prepare(PrepareRequest{Direction: Pull, Root: "share-0", Path: "nc.bin"})
	if err != nil {
		t.Fatal(err)
	}
	done, err = h.manager.Complete(pull.ID)
	if err != nil || done.Verified {
		t.Fatalf("pull: %+v, %v", done, err)
	}
	ok := h.push(t, "v.bin", payload, Create)
	h.sendAll(t, ok, payload)
	if done, err := h.manager.Complete(ok.ID); err != nil || !done.Verified {
		t.Fatalf("checksummed push: %+v, %v", done, err)
	}
}

func TestCreateModeRefusesAFileThatAppearedAfterPrepare(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678")
	record := h.push(t, "race.bin", payload, Create)
	if err := os.WriteFile(filepath.Join(h.shared, "race.bin"), []byte("someone else"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload, ""); !errors.Is(err, ErrTargetExists) {
		t.Fatalf("= %v, want ErrTargetExists", err)
	}
	if got := h.read(t, "race.bin"); got != "someone else" {
		t.Fatalf("file overwritten: %q", got)
	}
}

func TestAnEmptyPushCompletes(t *testing.T) {
	h := newHarness(t)
	record, err := h.manager.Prepare(PrepareRequest{Direction: Push, Root: "share-0", Path: "e/empty.bin",
		SizeBytes: 0, Checksum: store.Checksum(nil), Mode: Create})
	if err != nil {
		t.Fatal(err)
	}
	if done, err := h.manager.Complete(record.ID); err != nil || !done.Verified {
		t.Fatalf("complete = %+v, %v", done, err)
	}
	if h.read(t, "e/empty.bin") != "" {
		t.Error("not empty")
	}
}
