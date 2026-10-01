package transfer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.file/store"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

type harness struct {
	manager *Manager
	store   *store.Manager
	shared  string
	clock   time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	shared, state := t.TempDir(), t.TempDir()
	storeManager, err := store.NewManager([]modulert.SharedRoot{{Name: "share-0", Path: shared}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = storeManager.Close() })
	h := &harness{store: storeManager, shared: shared, clock: time.Unix(1_700_000_000, 0).UTC()}
	manager, err := NewManager(Options{
		StateDir: state, Store: storeManager, ChunkSize: 8, MaxBytes: 1 << 20,
		TTL: time.Hour, Now: func() time.Time { return h.clock },
	})
	if err != nil {
		t.Fatal(err)
	}
	h.manager = manager
	return h
}

func (h *harness) push(t *testing.T, path string, payload []byte, mode Mode) Record {
	t.Helper()
	record, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: path,
		SizeBytes: int64(len(payload)), Checksum: store.Checksum(payload), Mode: mode,
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	return record
}

// sendAll pushes a payload chunk by chunk, the way the CLI does.
func (h *harness) sendAll(t *testing.T, record Record, payload []byte) {
	t.Helper()
	for offset := 0; offset < len(payload); offset += record.ChunkSize {
		end := offset + record.ChunkSize
		if end > len(payload) {
			end = len(payload)
		}
		slice := payload[offset:end]
		if _, err := h.manager.AcceptChunk(record.ID, int64(offset), slice, store.Checksum(slice)); err != nil {
			t.Fatalf("chunk at %d: %v", offset, err)
		}
	}
}

// TestAPushRoundTripsAndVerifies is the ordinary path: prepare, chunks,
// complete, and the file on disk is the file that was promised.
func TestAPushRoundTripsAndVerifies(t *testing.T) {
	h := newHarness(t)
	payload := []byte(strings.Repeat("terra", 20))
	record := h.push(t, "deep/report.bin", payload, Create)
	h.sendAll(t, record, payload)

	done, err := h.manager.Complete(record.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if done.State != Completed {
		t.Errorf("state = %s", done.State)
	}
	written, err := os.ReadFile(filepath.Join(h.shared, "deep", "report.bin"))
	if err != nil || string(written) != string(payload) {
		t.Fatalf("file = %q, err = %v", written, err)
	}
	// A completed transfer leaves no checkpoint to resume.
	if _, err := h.manager.Get(record.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("a completed transfer is still resumable: %v", err)
	}
}

// TestAnInterruptedPushResumesWhereItStopped is the property the checkpoint
// exists for. Half the bytes, then a new prepare naming the old id, and the
// rest go on top rather than from zero.
func TestAnInterruptedPushResumesWhereItStopped(t *testing.T) {
	h := newHarness(t)
	payload := []byte(strings.Repeat("abcdefgh", 8)) // 64 bytes, 8 chunks
	record := h.push(t, "big.bin", payload, Create)

	half := 32
	for offset := 0; offset < half; offset += record.ChunkSize {
		slice := payload[offset : offset+record.ChunkSize]
		if _, err := h.manager.AcceptChunk(record.ID, int64(offset), slice, store.Checksum(slice)); err != nil {
			t.Fatal(err)
		}
	}

	resumed, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "big.bin",
		SizeBytes: int64(len(payload)), Checksum: store.Checksum(payload),
		Mode: Overwrite, ResumeID: record.ID,
	})
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if resumed.Offset != int64(half) {
		t.Fatalf("resume offset = %d, want %d", resumed.Offset, half)
	}
	for offset := half; offset < len(payload); offset += resumed.ChunkSize {
		slice := payload[offset : offset+resumed.ChunkSize]
		if _, err := h.manager.AcceptChunk(resumed.ID, int64(offset), slice, store.Checksum(slice)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.manager.Complete(resumed.ID); err != nil {
		t.Fatalf("complete after resume: %v", err)
	}
	written, _ := os.ReadFile(filepath.Join(h.shared, "big.bin"))
	if string(written) != string(payload) {
		t.Error("the resumed file is not the original")
	}
}

// TestResumingADifferentFileIsRefused: a checkpoint says "this many bytes of
// THAT file are there". Continuing it into another file would write one file's
// bytes into another at an offset nobody chose.
func TestResumingADifferentFileIsRefused(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678")
	record := h.push(t, "one.bin", payload, Create)
	h.sendAll(t, record, payload)

	_, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "two.bin",
		SizeBytes: int64(len(payload)), Checksum: store.Checksum(payload), ResumeID: record.ID,
	})
	if !errors.Is(err, ErrWrongState) {
		t.Errorf("resuming into another path = %v, want ErrWrongState", err)
	}
}

// TestAChunkThatDoesNotContinueIsRefusedWithTheOffsetItNeeded: that offset is
// what lets a sender recover from a lost response without starting over.
func TestAChunkThatDoesNotContinueIsRefusedWithTheOffsetItNeeded(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678abcdefgh")
	record := h.push(t, "gap.bin", payload, Create)

	_, err := h.manager.AcceptChunk(record.ID, 8, payload[8:], store.Checksum(payload[8:]))
	if !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("a chunk that skipped ahead = %v, want ErrOutOfOrder", err)
	}
	if !strings.Contains(err.Error(), "offset 0") {
		t.Errorf("the refusal did not say where to resume: %v", err)
	}
}

// TestACorruptedChunkIsRefusedBeforeItIsWritten: the digest travels with the
// slice so a bad piece is caught now, not at the end of a 1 GB upload.
func TestACorruptedChunkIsRefusedBeforeItIsWritten(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678")
	record := h.push(t, "corrupt.bin", payload, Create)

	if _, err := h.manager.AcceptChunk(record.ID, 0, payload, store.Checksum([]byte("different"))); !errors.Is(err, ErrChunkMismatch) {
		t.Fatalf("a chunk with a wrong digest = %v, want ErrChunkMismatch", err)
	}
	if _, err := os.Stat(filepath.Join(h.shared, "corrupt.bin")); !os.IsNotExist(err) {
		t.Error("a refused chunk was written anyway")
	}
	// The offset did not move, so the sender resends the same one.
	current, err := h.manager.Get(record.ID)
	if err != nil || current.Offset != 0 {
		t.Errorf("offset = %d after a refused chunk (err %v)", current.Offset, err)
	}
}

// TestAFileThatIsNotWhatWasPromisedIsDeleted: leaving a file that says it is a
// report and is not is worse than leaving nothing.
func TestAFileThatIsNotWhatWasPromisedIsDeleted(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678")
	// Prepare agrees one digest; the bytes sent are a different file whose
	// chunks are each internally consistent — only the whole is wrong.
	record, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "lied.bin",
		SizeBytes: int64(len(payload)), Checksum: store.Checksum([]byte("something else")),
	})
	if err != nil {
		t.Fatal(err)
	}
	h.sendAll(t, record, payload)

	if _, err := h.manager.Complete(record.ID); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("complete = %v, want ErrChecksumMismatch", err)
	}
	if _, err := os.Stat(filepath.Join(h.shared, "lied.bin")); !os.IsNotExist(err) {
		t.Error("the partial file survived a checksum mismatch")
	}
	if _, err := h.manager.Get(record.ID); !errors.Is(err, ErrNotFound) {
		t.Error("the checkpoint survived a checksum mismatch; resuming would append to bytes known bad")
	}
}

// TestCreateModeDoesNotReplaceAFileAndOverwriteDoes: silently replacing
// someone's file is not a thing a transfer should do by omission.
func TestCreateModeDoesNotReplaceAFileAndOverwriteDoes(t *testing.T) {
	h := newHarness(t)
	if err := os.WriteFile(filepath.Join(h.shared, "there.bin"), []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte("replaced")
	_, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "there.bin",
		SizeBytes: int64(len(payload)), Checksum: store.Checksum(payload), Mode: Create,
	})
	if !errors.Is(err, ErrTargetExists) {
		t.Fatalf("create over an existing file = %v, want ErrTargetExists", err)
	}
	record := h.push(t, "there.bin", payload, Overwrite)
	h.sendAll(t, record, payload)
	if _, err := h.manager.Complete(record.ID); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
}

// TestAnExpiredTransferKeepsItsCheckpoint: expiry is not a reason to make
// someone start a 1 GB upload again.
func TestAnExpiredTransferKeepsItsCheckpoint(t *testing.T) {
	h := newHarness(t)
	payload := []byte(strings.Repeat("x", 16))
	record := h.push(t, "slow.bin", payload, Create)
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload[:8], store.Checksum(payload[:8])); err != nil {
		t.Fatal(err)
	}

	h.clock = h.clock.Add(2 * time.Hour)
	if _, err := h.manager.AcceptChunk(record.ID, 8, payload[8:], store.Checksum(payload[8:])); !errors.Is(err, ErrExpired) {
		t.Fatalf("a chunk after expiry = %v, want ErrExpired", err)
	}
	resumed, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "slow.bin",
		SizeBytes: int64(len(payload)), Checksum: store.Checksum(payload),
		Mode: Overwrite, ResumeID: record.ID,
	})
	if err != nil {
		t.Fatalf("resuming an expired transfer: %v", err)
	}
	if resumed.Offset != 8 {
		t.Errorf("resume offset = %d, want 8 — the checkpoint should have survived", resumed.Offset)
	}
}

// TestAPullAgreesTheSourceDigestUpFront so a file edited mid-transfer does not
// verify against its new contents.
func TestAPullAgreesTheSourceDigestUpFront(t *testing.T) {
	h := newHarness(t)
	payload := []byte("the original bytes")
	if err := os.WriteFile(filepath.Join(h.shared, "src.bin"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	record, err := h.manager.Prepare(PrepareRequest{Direction: Pull, Root: "share-0", Path: "src.bin"})
	if err != nil {
		t.Fatal(err)
	}
	if record.Checksum != store.Checksum(payload) || record.SizeBytes != int64(len(payload)) {
		t.Fatalf("prepare = %+v", record)
	}

	var received []byte
	for {
		_, chunk, err := h.manager.ServeChunk(record.ID, int64(len(received)))
		if err != nil {
			t.Fatal(err)
		}
		received = append(received, chunk.Data...)
		if chunk.EOF {
			break
		}
	}
	if store.Checksum(received) != record.Checksum {
		t.Error("what was served is not what prepare promised")
	}
}

// TestTransfersAreListedNewestFirst: transfers.get needs an id, and an operator
// asking "what is running" does not have one.
func TestTransfersAreListedNewestFirst(t *testing.T) {
	h := newHarness(t)
	first := h.push(t, "a.bin", []byte("aaaa"), Create)
	h.clock = h.clock.Add(time.Minute)
	second := h.push(t, "b.bin", []byte("bbbb"), Create)

	listed, err := h.manager.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].ID != second.ID || listed[1].ID != first.ID {
		t.Errorf("listed = %+v", listed)
	}
}

// TestAbortKeepsOrDropsThePartialAsAsked: giving up on a bad file should not
// leave it behind, while stopping to resume later must keep what is there.
func TestAbortKeepsOrDropsThePartialAsAsked(t *testing.T) {
	h := newHarness(t)
	payload := []byte("12345678abcdefgh")
	record := h.push(t, "partial.bin", payload, Create)
	if _, err := h.manager.AcceptChunk(record.ID, 0, payload[:8], store.Checksum(payload[:8])); err != nil {
		t.Fatal(err)
	}

	if _, err := h.manager.Abort(record.ID, "pausing", false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(h.shared, "partial.bin")); err != nil {
		t.Error("a pause deleted the partial file")
	}
	if _, err := h.manager.Get(record.ID); err != nil {
		t.Errorf("a pause dropped the checkpoint: %v", err)
	}

	if _, err := h.manager.Abort(record.ID, "giving up", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(h.shared, "partial.bin")); !os.IsNotExist(err) {
		t.Error("giving up left the partial file behind")
	}
}

// TestTheCeilingIsCheckedBeforeAnyBytesMove: finding out at byte 700,000 of a
// 1 GB upload is the worst possible time to learn it.
func TestTheCeilingIsCheckedBeforeAnyBytesMove(t *testing.T) {
	h := newHarness(t)
	_, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "huge.bin",
		SizeBytes: (1 << 20) + 1, Checksum: store.Checksum([]byte("x")),
	})
	if !errors.Is(err, ErrTooLarge) {
		t.Errorf("prepare above the ceiling = %v, want ErrTooLarge", err)
	}
}

// TestPathConfinementHoldsThroughTheTransferLayer: the store refuses, and the
// transfer layer must not have found a way around it.
func TestPathConfinementHoldsThroughTheTransferLayer(t *testing.T) {
	h := newHarness(t)
	_, err := h.manager.Prepare(PrepareRequest{
		Direction: Push, Root: "share-0", Path: "../escape.bin",
		SizeBytes: 4, Checksum: store.Checksum([]byte("aaaa")),
	})
	if !errors.Is(err, store.ErrPathDenied) {
		t.Errorf("preparing outside the shared folder = %v, want ErrPathDenied", err)
	}
}
