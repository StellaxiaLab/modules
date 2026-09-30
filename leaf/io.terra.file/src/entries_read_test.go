package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.file/store"
	"github.com/terra-project/terra/module/leaf/io.terra.file/transfer"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

// newReadTestHandler builds the real operations handler over a real shared
// folder, because what is under test is the seam between the HTTP surface and
// the confined store — a fake store would remove exactly that.
func newReadTestHandler(t *testing.T, content []byte) http.Handler {
	t.Helper()
	shared := t.TempDir()
	if err := os.MkdirAll(filepath.Join(shared, "logs"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shared, "logs", "a.bin"), content, 0o600); err != nil {
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
	return newOperationsHandler(files, transfers)
}

type readResponse struct {
	Offset int64  `json:"offset"`
	Length int    `json:"length"`
	Data   string `json:"data"`
	SHA256 string `json:"sha256"`
	EOF    bool   `json:"eof"`
	Size   int64  `json:"size"`
}

func readRange(t *testing.T, handler http.Handler, query string) (int, readResponse, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+"/entries/read"+query, nil))
	var decoded readResponse
	body := recorder.Body.String()
	_ = json.Unmarshal([]byte(body), &decoded)
	return recorder.Code, decoded, body
}

// TestAReadIsARangeAndSaysHowBigTheWholeFileIs: the mount needs both halves of
// this answer. Without size it would have to stat the file again, and on the
// relayed path that second question costs as much as the read itself.
func TestAReadIsARangeAndSaysHowBigTheWholeFileIs(t *testing.T) {
	handler := newReadTestHandler(t, []byte("terra-drive"))

	status, body, raw := readRange(t, handler, "?path=logs/a.bin&offset=6&length=5")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	decoded, err := base64.StdEncoding.DecodeString(body.Data)
	if err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if string(decoded) != "drive" {
		t.Errorf("data = %q, want %q", decoded, "drive")
	}
	if body.Offset != 6 || body.Length != 5 {
		t.Errorf("offset/length = %d/%d, want 6/5", body.Offset, body.Length)
	}
	if body.Size != 11 {
		t.Errorf("size = %d, want 11 (the whole file, not the range)", body.Size)
	}
	if !body.EOF {
		t.Error("a range ending at the last byte did not report eof")
	}
}

// TestReadingLeavesNoTransferBehind is the reason this operation exists rather
// than reusing transfers.chunks.get: that path writes a checkpoint on every
// call so an interrupted transfer can resume, which would turn each of a
// mount's small reads into a disk write and leave records nobody closes.
func TestReadingLeavesNoTransferBehind(t *testing.T) {
	handler := newReadTestHandler(t, []byte("terra-drive"))
	for offset := 0; offset < 11; offset += 4 {
		if status, _, raw := readRange(t, handler,
			"?path=logs/a.bin&offset="+strconv.Itoa(offset)+"&length=4"); status != http.StatusOK {
			t.Fatalf("read at %d: status %d, body %s", offset, status, raw)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+"/transfers", nil))
	var listing struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listing); err != nil {
		t.Fatalf("decode transfers: %v", err)
	}
	if listing.Count != 0 {
		t.Errorf("three reads left %d transfer records behind", listing.Count)
	}
}

// TestAReadRefusesWhatItCannotAnswer: each of these is a different mistake and
// the caller's next move differs, so none of them may collapse into another —
// least of all into a short read, which a filesystem would hand to a program as
// truncated content.
func TestAReadRefusesWhatItCannotAnswer(t *testing.T) {
	handler := newReadTestHandler(t, []byte("terra-drive"))
	for _, testCase := range []struct {
		name, query string
		wantStatus  int
		wantCode    string
	}{
		{"past the end", "?path=logs/a.bin&offset=99&length=4", http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"negative offset", "?path=logs/a.bin&offset=-1&length=4", http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"zero length", "?path=logs/a.bin&length=0", http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"over the allocation guard", "?path=logs/a.bin&length=1048577", http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"a directory", "?path=logs", http.StatusBadRequest, "FILE_INVALID_REQUEST"},
		{"traversal", "?path=../secret", http.StatusForbidden, "PATH_DENIED"},
		{"absent file", "?path=logs/missing.bin", http.StatusNotFound, "FILE_NOT_FOUND"},
		{"absent shared folder", "?root=nope&path=logs/a.bin", http.StatusNotFound, "ROOT_NOT_FOUND"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+"/entries/read"+testCase.query, nil))
			if recorder.Code != testCase.wantStatus {
				t.Errorf("status = %d, want %d — %s", recorder.Code, testCase.wantStatus, recorder.Body.String())
			}
			var failure struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &failure); err != nil {
				t.Fatalf("decode error: %v", err)
			}
			if failure.Error.Code != testCase.wantCode {
				t.Errorf("code = %q, want %q", failure.Error.Code, testCase.wantCode)
			}
		})
	}
}

// TestOmittedLengthUsesTheModulesChunkSize: a caller that does not care should
// not have to know the number, and the number it gets must be the one the module
// already tells transfers to use.
func TestOmittedLengthUsesTheModulesChunkSize(t *testing.T) {
	handler := newReadTestHandler(t, []byte("terra-drive"))
	status, body, raw := readRange(t, handler, "?path=logs/a.bin")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if body.Length != 8 {
		t.Errorf("length = %d, want the manager's chunk size 8", body.Length)
	}
	if body.EOF {
		t.Error("a read stopping 3 bytes short of the end reported eof")
	}
}
