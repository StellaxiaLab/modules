package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/leaf/io.terra.file/store"
)

// TestAReadOnlyCallerCanTakeAFileOut: the pull-only door is the whole path —
// open, read every chunk, close — without touching an operation that needs
// file.write. If any step had to fall back to transfers.create or the generic
// complete, a read-only caller would be stuck halfway.
func TestAReadOnlyCallerCanTakeAFileOut(t *testing.T) {
	handler, _ := newWriteTestHandler(t)

	status, opened, raw := call(t, handler, http.MethodPost, "/transfers/pulls", map[string]any{"path": "logs/a.txt"})
	if status != http.StatusAccepted {
		t.Fatalf("open pull = %d %s", status, raw)
	}
	record := opened["transfer"].(map[string]any)
	if record["direction"] != "pull" {
		t.Fatalf("direction = %v, want pull", record["direction"])
	}
	id := record["transfer_id"].(string)

	var got []byte
	for offset := 0; ; {
		status, chunk, raw := call(t, handler, http.MethodGet, "/transfers/"+id+"/chunks?offset="+strconv.Itoa(offset), nil)
		if status != http.StatusOK {
			t.Fatalf("chunk at %d = %d %s", offset, status, raw)
		}
		data, err := base64.StdEncoding.DecodeString(chunk["data"].(string))
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, data...)
		offset += len(data)
		if chunk["eof"] == true {
			break
		}
	}
	if string(got) != "terra-drive" {
		t.Fatalf("pulled %q", got)
	}

	status, closed, raw := call(t, handler, http.MethodPost, "/transfers/pulls/"+id+"/complete", nil)
	if status != http.StatusOK || closed["verified"] != true {
		t.Fatalf("complete pull = %d %s", status, raw)
	}
}

// TestThePullOnlyDoorIgnoresADirectionItWasHanded: the body has no direction
// field to honour. A caller holding only file.read must not be able to ask the
// pull door for a push and get one.
func TestThePullOnlyDoorIgnoresADirectionItWasHanded(t *testing.T) {
	handler, _ := newWriteTestHandler(t)
	status, opened, raw := call(t, handler, http.MethodPost, "/transfers/pulls", map[string]any{
		"direction": "push", "path": "logs/a.txt", "size_bytes": 3, "checksum_sha256": strings.Repeat("0", 64),
	})
	if status != http.StatusAccepted {
		t.Fatalf("open = %d %s", status, raw)
	}
	if direction := opened["transfer"].(map[string]any)["direction"]; direction != "pull" {
		t.Fatalf("direction = %v, want pull", direction)
	}
}

// TestThePullOnlyDoorDoesNotCloseAnUpload: complete and abort behind file.read
// would otherwise let a reader finish or delete someone's upload. The upload
// must come out untouched — still live, partial file still on disk.
func TestThePullOnlyDoorDoesNotCloseAnUpload(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	status, opened, raw := call(t, handler, http.MethodPost, "/transfers", map[string]any{
		"direction": "push", "path": "up.bin", "size_bytes": 4, "checksum_sha256": strings.Repeat("0", 64),
	})
	if status != http.StatusAccepted {
		t.Fatalf("open push = %d %s", status, raw)
	}
	id := opened["transfer"].(map[string]any)["transfer_id"].(string)
	if status, _, raw := call(t, handler, http.MethodPut, "/transfers/"+id+"/chunks", map[string]any{
		"offset": 0, "data": b64("ab"), "sha256": store.Checksum([]byte("ab")),
	}); status != http.StatusOK {
		t.Fatalf("chunk = %d %s", status, raw)
	}

	for _, action := range []string{"complete", "abort"} {
		status, decoded, raw := call(t, handler, http.MethodPost, "/transfers/pulls/"+id+"/"+action, nil)
		if status != http.StatusConflict || errorCode(decoded) != "TRANSFER_WRONG_STATE" {
			t.Fatalf("pull-only %s on a push = %d %s, want 409 TRANSFER_WRONG_STATE", action, status, raw)
		}
	}
	status, got, raw := call(t, handler, http.MethodGet, "/transfers/"+id, nil)
	if status != http.StatusOK {
		t.Fatalf("get = %d %s", status, raw)
	}
	if state := got["transfer"].(map[string]any)["state"]; state != "transferring" {
		t.Fatalf("upload state = %v, want transferring", state)
	}
	if _, err := os.Stat(filepath.Join(shared, "up.bin")); err != nil {
		t.Fatalf("partial upload is gone: %v", err)
	}
}

// TestEveryContractBindingIsServed: a binding the handlers do not answer reaches
// the catch-all, which says FILE_OPERATION_NOT_FOUND. The contract is what the
// Gateway routes by, so a declared operation with no handler is a 404 in
// production that no other test here would notice.
func TestEveryContractBindingIsServed(t *testing.T) {
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Operations map[string]struct {
			Bindings []struct {
				Method string `json:"method"`
				Path   string `json:"path"`
			} `json:"bindings"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	handler, _ := newWriteTestHandler(t)
	for operation, spec := range contract.Operations {
		for _, binding := range spec.Bindings {
			path := strings.TrimPrefix(binding.Path, apiPrefix)
			for {
				open := strings.Index(path, "{")
				if open < 0 {
					break
				}
				close := strings.Index(path[open:], "}")
				path = path[:open] + "x" + path[open+close+1:]
			}
			_, decoded, _ := call(t, handler, binding.Method, path, nil)
			if errorCode(decoded) == "FILE_OPERATION_NOT_FOUND" {
				t.Errorf("%s: %s %s has no handler", operation, binding.Method, binding.Path)
			}
		}
	}
}
