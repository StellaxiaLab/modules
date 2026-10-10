package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/StellaxiaLab/modules/leaf/io.terra.file/store"
	"github.com/StellaxiaLab/modules/leaf/io.terra.file/transfer"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
)

// startPush opens a push for content and sends its first two bytes, so there
// is a partial file and a checkpoint to keep or drop.
func startPush(t *testing.T, handler http.Handler, path, content string) string {
	t.Helper()
	status, opened, raw := call(t, handler, http.MethodPost, "/transfers", map[string]any{
		"direction": "push", "path": path, "size_bytes": len(content), "checksum_sha256": store.Checksum([]byte(content)),
	})
	if status != http.StatusAccepted {
		t.Fatalf("open push = %d %s", status, raw)
	}
	id := opened["transfer"].(map[string]any)["transfer_id"].(string)
	if status, _, raw := call(t, handler, http.MethodPut, "/transfers/"+id+"/chunks", map[string]any{
		"offset": 0, "data": b64(content[:2]), "sha256": store.Checksum([]byte(content[:2])),
	}); status != http.StatusOK {
		t.Fatalf("chunk = %d %s", status, raw)
	}
	return id
}

// TestAPauseSentThroughTheGatewayKeepsThePartial: an invoke reaches this
// handler with its input as the JSON body — for a POST binding the Gateway puts
// everything that is not a path parameter there (terra-module-runtime
// BuildOperationTarget). Reading keep_partial from the query alone turned every
// pause into giving up: the partial file deleted, the checkpoint forgotten, and
// nothing left to resume.
func TestAPauseSentThroughTheGatewayKeepsThePartial(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	id := startPush(t, handler, "up.bin", "abcd")

	status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/"+id+"/abort", map[string]any{"keep_partial": true, "reason": "paused"})
	if status != http.StatusOK || decoded["kept_partial"] != true {
		t.Fatalf("pause = %d %s, want 200 kept_partial true", status, raw)
	}
	status, got, raw := call(t, handler, http.MethodGet, "/transfers/"+id, nil)
	if status != http.StatusOK {
		t.Fatalf("get after pause = %d %s — the checkpoint is gone", status, raw)
	}
	record := got["transfer"].(map[string]any)
	if record["state"] != "aborted" || record["reason"] != "paused" || record["offset"] != float64(2) {
		t.Fatalf("paused record = %v, want aborted · paused · offset 2", record)
	}
	if _, err := os.Stat(filepath.Join(shared, "up.bin")); err != nil {
		t.Fatalf("partial upload is gone: %v", err)
	}
	status, resumed, raw := call(t, handler, http.MethodPost, "/transfers", map[string]any{"direction": "push", "path": "up.bin", "resume_id": id})
	if status != http.StatusAccepted || resumed["transfer"].(map[string]any)["offset"] != float64(2) {
		t.Fatalf("resume = %d %s, want 202 from offset 2", status, raw)
	}
}

// TestGivingUpThroughTheGatewayStillDropsThePartial: without keep_partial, or
// with it false, an abort gives up as it always did.
func TestGivingUpThroughTheGatewayStillDropsThePartial(t *testing.T) {
	for name, body := range map[string]any{"empty": map[string]any{}, "false": map[string]any{"keep_partial": false}, "none": nil} {
		t.Run(name, func(t *testing.T) {
			handler, shared := newWriteTestHandler(t)
			id := startPush(t, handler, "up.bin", "abcd")
			status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/"+id+"/abort", body)
			if status != http.StatusOK || decoded["kept_partial"] != false {
				t.Fatalf("abort = %d %s, want 200 kept_partial false", status, raw)
			}
			if status, _, _ := call(t, handler, http.MethodGet, "/transfers/"+id, nil); status != http.StatusNotFound {
				t.Fatalf("get after giving up = %d, want 404", status)
			}
			if _, err := os.Stat(filepath.Join(shared, "up.bin")); !os.IsNotExist(err) {
				t.Fatalf("partial upload is still there: %v", err)
			}
		})
	}
}

// TestAHandWrittenAbortMayStillUseTheQuery: a caller that reaches the path
// directly and says keep_partial in the query is still heard.
func TestAHandWrittenAbortMayStillUseTheQuery(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	id := startPush(t, handler, "up.bin", "abcd")
	status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/"+id+"/abort?keep_partial=true&reason=later", nil)
	if status != http.StatusOK || decoded["kept_partial"] != true {
		t.Fatalf("pause by query = %d %s", status, raw)
	}
	if _, err := os.Stat(filepath.Join(shared, "up.bin")); err != nil {
		t.Fatalf("partial upload is gone: %v", err)
	}
	_, got, _ := call(t, handler, http.MethodGet, "/transfers/"+id, nil)
	if reason := got["transfer"].(map[string]any)["reason"]; reason != "later" {
		t.Fatalf("reason = %v, want later", reason)
	}
}

// TestThePullOnlyAbortReadsTheBodyToo: the pull door's abort is invoked the
// same way, so it reads the same body.
func TestThePullOnlyAbortReadsTheBodyToo(t *testing.T) {
	handler, _ := newWriteTestHandler(t)
	status, opened, raw := call(t, handler, http.MethodPost, "/transfers/pulls", map[string]any{"path": "logs/a.txt"})
	if status != http.StatusAccepted {
		t.Fatalf("open pull = %d %s", status, raw)
	}
	id := opened["transfer"].(map[string]any)["transfer_id"].(string)
	status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/pulls/"+id+"/abort", map[string]any{"keep_partial": true, "reason": "page closed"})
	if status != http.StatusOK || decoded["kept_partial"] != true {
		t.Fatalf("pull pause = %d %s", status, raw)
	}
	_, got, raw := call(t, handler, http.MethodGet, "/transfers/"+id, nil)
	if record, _ := got["transfer"].(map[string]any); record == nil || record["reason"] != "page closed" {
		t.Fatalf("paused pull = %s, want the record kept with its reason", raw)
	}
}

// TestAMalformedAbortBodyIsRefused: a body that is not an abort request is a
// mistake to report, not a request to give up on the transfer.
func TestAMalformedAbortBodyIsRefused(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	id := startPush(t, handler, "up.bin", "abcd")
	status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/"+id+"/abort", "keep it")
	if status != http.StatusBadRequest || errorCode(decoded) != "FILE_INVALID_REQUEST" {
		t.Fatalf("malformed abort = %d %s, want 400 FILE_INVALID_REQUEST", status, raw)
	}
	if !strings.Contains(raw, "abort") {
		t.Fatalf("the refusal should say what it expected: %s", raw)
	}
	if _, err := os.Stat(filepath.Join(shared, "up.bin")); err != nil {
		t.Fatalf("a refused abort deleted the partial: %v", err)
	}
}

// TestAnExpiredPullCanStillBeClosed: a page that shut mid-download leaves its
// pull open until the window closes. The pull-only door has to be able to close
// it afterwards — otherwise a reader, who has no other door, leaves it listed
// as running for good.
func TestAnExpiredPullCanStillBeClosed(t *testing.T) {
	shared := t.TempDir()
	if err := os.WriteFile(filepath.Join(shared, "a.txt"), []byte("terra-drive"), 0o600); err != nil {
		t.Fatal(err)
	}
	files, err := store.NewManager([]modulert.SharedRoot{{Name: "share-0", Path: shared}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = files.Close() })
	now := time.Now()
	transfers, err := transfer.NewManager(transfer.Options{
		StateDir: t.TempDir(), Store: files, ChunkSize: 8, TTL: time.Minute, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := newOperationsHandler(files, transfers)

	for _, action := range []string{"abort", "complete"} {
		status, opened, raw := call(t, handler, http.MethodPost, "/transfers/pulls", map[string]any{"path": "a.txt"})
		if status != http.StatusAccepted {
			t.Fatalf("open pull = %d %s", status, raw)
		}
		id := opened["transfer"].(map[string]any)["transfer_id"].(string)
		now = now.Add(2 * time.Minute)
		if status, decoded, _ := call(t, handler, http.MethodGet, "/transfers/"+id+"/chunks?offset=0", nil); status != http.StatusConflict || errorCode(decoded) != "TRANSFER_EXPIRED" {
			t.Fatalf("chunk after the window = %d %v, want 409 TRANSFER_EXPIRED", status, decoded)
		}
		if status, _, raw := call(t, handler, http.MethodPost, "/transfers/pulls/"+id+"/"+action, nil); status != http.StatusOK {
			t.Fatalf("%s an expired pull = %d %s, want 200", action, status, raw)
		}
		if status, _, _ := call(t, handler, http.MethodGet, "/transfers/"+id, nil); status != http.StatusNotFound {
			t.Fatalf("after %s the pull is still listed (%d)", action, status)
		}
	}
}
