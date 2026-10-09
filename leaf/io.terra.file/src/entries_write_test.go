package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/leaf/io.terra.file/store"
	"github.com/StellaxiaLab/modules/leaf/io.terra.file/transfer"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

// newWriteTestHandler builds the real handler over a real shared folder and
// hands back the folder too, so a test can look at the disk rather than at what
// the API said about it. The two disagreeing is exactly the failure worth
// catching.
func newWriteTestHandler(t *testing.T) (http.Handler, string) {
	t.Helper()
	shared := t.TempDir()
	if err := os.MkdirAll(filepath.Join(shared, "logs"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shared, "logs", "a.txt"), []byte("terra-drive"), 0o600); err != nil {
		t.Fatal(err)
	}
	files, err := store.NewManager([]modulert.SharedRoot{{Name: "share-0", Path: shared}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = files.Close() })
	transfers, err := transfer.NewManager(transfer.Options{
		StateDir: t.TempDir(), Store: files, ChunkSize: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	return newOperationsHandler(files, transfers), shared
}

func call(t *testing.T, handler http.Handler, method, path string, body any) (int, map[string]any, string) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, apiPrefix+path, reader))
	decoded := map[string]any{}
	raw := recorder.Body.String()
	_ = json.Unmarshal([]byte(raw), &decoded)
	return recorder.Code, decoded, raw
}

func errorCode(decoded map[string]any) string {
	failure, ok := decoded["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := failure["code"].(string)
	return code
}

func b64(value string) string { return base64.StdEncoding.EncodeToString([]byte(value)) }

// TestAWriteReportsTheFileItLeavesBehind: the size and mtime come from the fstat
// the write already held the handle open for. Without them a mount would ask the
// node how big the file is immediately after telling it — a whole extra relayed
// round trip for an answer the node had in its hand.
func TestAWriteReportsTheFileItLeavesBehind(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	status, body, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/a.txt", "offset": 0, "data": b64("TERRA"),
		"sha256": store.Checksum([]byte("TERRA")),
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if body["size"] != float64(11) {
		t.Errorf("size = %v, want 11 — an offset-0 write of 5 bytes does not shorten an 11 byte file", body["size"])
	}
	if body["length"] != float64(5) {
		t.Errorf("length = %v, want 5", body["length"])
	}
	if _, ok := body["modified_at"].(string); !ok {
		t.Errorf("modified_at missing from %s", raw)
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "TERRA-drive" {
		t.Errorf("file = %q, want %q — a ranged write must not truncate the tail", onDisk, "TERRA-drive")
	}
}

// TestTheDigestIsCheckedBeforeAnythingIsWritten is the whole argument for
// retrying a failed write: bytes that are not the bytes the caller meant never
// reach the file, so sending the same request again cannot make things worse.
func TestTheDigestIsCheckedBeforeAnythingIsWritten(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	status, body, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/a.txt", "offset": 0, "data": b64("XXXXX"),
		"sha256": store.Checksum([]byte("TERRA")),
	})
	if status != http.StatusConflict {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_CHECKSUM_MISMATCH" {
		t.Errorf("code = %q, want FILE_CHECKSUM_MISMATCH", code)
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra-drive" {
		t.Errorf("file = %q — a refused write still touched the file", onDisk)
	}
}

// TestTheSameWriteTwiceLeavesTheSameFile: idempotence is what the contract
// promises and what the retry in the drive relies on. A retry that landed twice
// has to be indistinguishable from one that landed once.
func TestTheSameWriteTwiceLeavesTheSameFile(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	request := map[string]any{
		"path": "logs/a.txt", "offset": 6, "data": b64("DRIVE"),
		"sha256": store.Checksum([]byte("DRIVE")),
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if status, _, raw := call(t, handler, http.MethodPut, "/entries/write", request); status != http.StatusOK {
			t.Fatalf("attempt %d: status %d, body %s", attempt, status, raw)
		}
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra-DRIVE" {
		t.Errorf("file = %q, want %q", onDisk, "terra-DRIVE")
	}
}

// TestAnEmptyWriteOnlyCreates: this is how a mount answers create(2). It must
// not truncate a file that is already there, because O_CREAT alone does not.
func TestAnEmptyWriteOnlyCreates(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	if status, _, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/new.txt", "data": "",
	}); status != http.StatusOK {
		t.Fatalf("create: status %d, body %s", status, raw)
	}
	if info, err := os.Stat(filepath.Join(shared, "logs", "new.txt")); err != nil {
		t.Fatalf("the empty write created nothing: %v", err)
	} else if info.Size() != 0 {
		t.Errorf("size = %d, want 0", info.Size())
	}

	if status, _, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/a.txt", "data": "",
	}); status != http.StatusOK {
		t.Fatalf("create over existing: status %d, body %s", status, raw)
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra-drive" {
		t.Errorf("file = %q — an empty write truncated an existing file", onDisk)
	}
}

// TestExclusiveCreateRefusesAnExistingPath keeps O_EXCL honest without a stat
// first: asking and then acting is a race, and over a relay it is a long one.
func TestExclusiveCreateRefusesAnExistingPath(t *testing.T) {
	handler, _ := newWriteTestHandler(t)
	status, body, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/a.txt", "data": "", "exclusive": true,
	})
	if status != http.StatusConflict {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_TARGET_EXISTS" {
		t.Errorf("code = %q, want FILE_TARGET_EXISTS", code)
	}
}

// TestAWriteDoesNotInventParentDirectories: open(O_CREAT) under a missing parent
// is ENOENT everywhere, and a mount that silently created the parent would make
// mkdir optional in a way no local filesystem does.
func TestAWriteDoesNotInventParentDirectories(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	status, body, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "nowhere/deep/a.txt", "data": b64("x"),
	})
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_NOT_FOUND" {
		t.Errorf("code = %q, want FILE_NOT_FOUND", code)
	}
	if _, err := os.Stat(filepath.Join(shared, "nowhere")); !os.IsNotExist(err) {
		t.Errorf("the refused write created the parent anyway: %v", err)
	}
}

// TestAWriteRefusesWhatItCannotAnswer keeps the vocabulary apart. Each of these
// has a different next move for the caller.
func TestAWriteRefusesWhatItCannotAnswer(t *testing.T) {
	handler, _ := newWriteTestHandler(t)
	for _, testCase := range []struct {
		name       string
		body       map[string]any
		wantStatus int
		wantCode   string
	}{
		{"traversal", map[string]any{"path": "../secret", "data": b64("x")},
			http.StatusForbidden, "PATH_DENIED"},
		{"absent shared folder", map[string]any{"root": "nope", "path": "a.txt", "data": b64("x")},
			http.StatusNotFound, "ROOT_NOT_FOUND"},
		{"the shared folder itself", map[string]any{"path": "", "data": b64("x")},
			http.StatusForbidden, "PATH_DENIED"},
		{"a directory", map[string]any{"path": "logs", "data": b64("x")},
			http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"negative offset", map[string]any{"path": "logs/a.txt", "offset": -1, "data": b64("x")},
			http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"data that is not base64", map[string]any{"path": "logs/a.txt", "data": "not base64!"},
			http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"over the body ceiling", map[string]any{"path": "logs/a.txt", "data": b64(strings.Repeat("x", maxWriteLength+1))},
			http.StatusBadRequest, "FILE_INVALID_REQUEST"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			status, body, raw := call(t, handler, http.MethodPut, "/entries/write", testCase.body)
			if status != testCase.wantStatus {
				t.Errorf("status = %d, want %d — %s", status, testCase.wantStatus, raw)
			}
			if code := errorCode(body); code != testCase.wantCode {
				t.Errorf("code = %q, want %q", code, testCase.wantCode)
			}
		})
	}
}

// TestWritingLeavesNoTransferBehind mirrors the read side: the mount's write
// path must not accumulate records nobody closes.
func TestWritingLeavesNoTransferBehind(t *testing.T) {
	handler, _ := newWriteTestHandler(t)
	for offset := 0; offset < 8; offset += 4 {
		if status, _, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
			"path": "logs/a.txt", "offset": offset, "data": b64("abcd"),
		}); status != http.StatusOK {
			t.Fatalf("write at %d: status %d, body %s", offset, status, raw)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+"/transfers", nil))
	var listing struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if listing.Count != 0 {
		t.Errorf("two writes left %d transfer records behind", listing.Count)
	}
}
