package main

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// TestTruncateCutsAndFills: truncate(2) does both directions, and a mount that
// only did the cutting would leave a program that seeks past the end with a
// file shorter than it asked for.
func TestTruncateCutsAndFills(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	status, body, raw := call(t, handler, http.MethodPost, "/entries/truncate", map[string]any{
		"path": "logs/a.txt", "size": 5,
	})
	if status != http.StatusOK {
		t.Fatalf("cut: status %d, body %s", status, raw)
	}
	if body["size"] != float64(5) {
		t.Errorf("size = %v, want 5", body["size"])
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra" {
		t.Errorf("file = %q, want %q", onDisk, "terra")
	}

	if status, _, raw := call(t, handler, http.MethodPost, "/entries/truncate", map[string]any{
		"path": "logs/a.txt", "size": 8,
	}); status != http.StatusOK {
		t.Fatalf("fill: status %d, body %s", status, raw)
	}
	onDisk, err = os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra\x00\x00\x00" {
		t.Errorf("file = %q, want the gap filled with zeroes", onDisk)
	}
}

// TestTruncateWithoutASizeIsRefused: zero is both the commonest size a caller
// means and what an absent field decodes to. Guessing would empty a file nobody
// asked to empty, so the field is required rather than defaulted.
func TestTruncateWithoutASizeIsRefused(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	status, body, raw := call(t, handler, http.MethodPost, "/entries/truncate", map[string]any{
		"path": "logs/a.txt",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_INVALID_REQUEST" {
		t.Errorf("code = %q, want FILE_INVALID_REQUEST", code)
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "terra-drive" {
		t.Errorf("file = %q — a refused truncate emptied the file", onDisk)
	}
}

// TestTruncateDoesNotCreate: truncate(2) on a missing path is ENOENT, and a
// caller relying on that to detect absence must not be answered with a new
// empty file.
func TestTruncateDoesNotCreate(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	status, body, raw := call(t, handler, http.MethodPost, "/entries/truncate", map[string]any{
		"path": "logs/missing.txt", "size": 0,
	})
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_NOT_FOUND" {
		t.Errorf("code = %q, want FILE_NOT_FOUND", code)
	}
	if _, err := os.Stat(filepath.Join(shared, "logs", "missing.txt")); !os.IsNotExist(err) {
		t.Errorf("the refused truncate created the file: %v", err)
	}
}

// TestMkdirSaysWhenItWasAlreadyThere: a filesystem mount has to report EEXIST,
// so "already there" cannot be folded into success — otherwise mkdir succeeds
// exactly where the caller needed it to fail. parents is the other half: that
// is mkdir -p, where already-there IS success and created says so.
func TestMkdirSaysWhenItWasAlreadyThere(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	status, body, raw := call(t, handler, http.MethodPost, "/entries/mkdir", map[string]any{"path": "fresh"})
	if status != http.StatusOK {
		t.Fatalf("mkdir: status %d, body %s", status, raw)
	}
	if body["created"] != true {
		t.Errorf("created = %v, want true", body["created"])
	}
	if info, err := os.Stat(filepath.Join(shared, "fresh")); err != nil || !info.IsDir() {
		t.Fatalf("fresh is not a directory: %v", err)
	}

	status, body, raw = call(t, handler, http.MethodPost, "/entries/mkdir", map[string]any{"path": "fresh"})
	if status != http.StatusConflict {
		t.Fatalf("second mkdir: status %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_TARGET_EXISTS" {
		t.Errorf("code = %q, want FILE_TARGET_EXISTS", code)
	}

	status, body, raw = call(t, handler, http.MethodPost, "/entries/mkdir",
		map[string]any{"path": "fresh", "parents": true})
	if status != http.StatusOK {
		t.Fatalf("mkdir -p over existing: status %d, body %s", status, raw)
	}
	if body["created"] != false {
		t.Errorf("created = %v, want false — nothing was made this time", body["created"])
	}
}

// TestMkdirWithoutParentsDoesNotInventThem keeps mkdir and mkdir -p apart on the
// missing-parent side too.
func TestMkdirWithoutParentsDoesNotInventThem(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	status, body, raw := call(t, handler, http.MethodPost, "/entries/mkdir", map[string]any{"path": "a/b/c"})
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, body %s", status, raw)
	}
	if code := errorCode(body); code != "FILE_NOT_FOUND" {
		t.Errorf("code = %q, want FILE_NOT_FOUND", code)
	}
	if _, err := os.Stat(filepath.Join(shared, "a")); !os.IsNotExist(err) {
		t.Errorf("the refused mkdir made the parent anyway: %v", err)
	}

	if status, _, raw := call(t, handler, http.MethodPost, "/entries/mkdir",
		map[string]any{"path": "a/b/c", "parents": true}); status != http.StatusOK {
		t.Fatalf("mkdir -p: status %d, body %s", status, raw)
	}
	if info, err := os.Stat(filepath.Join(shared, "a", "b", "c")); err != nil || !info.IsDir() {
		t.Fatalf("a/b/c is not a directory: %v", err)
	}
}

// TestRenameIsHowAnAtomicReplacementIsMade. This is the operation that makes the
// in-place write an acceptable promise: write the temporary file, then move it
// over the target in one step, the same way a program does on a local disk.
func TestRenameIsHowAnAtomicReplacementIsMade(t *testing.T) {
	handler, shared := newWriteTestHandler(t)

	if status, _, raw := call(t, handler, http.MethodPut, "/entries/write", map[string]any{
		"path": "logs/.a.txt.tmp", "data": b64("replacement"),
	}); status != http.StatusOK {
		t.Fatalf("write temp: status %d, body %s", status, raw)
	}
	status, body, raw := call(t, handler, http.MethodPost, "/entries/rename", map[string]any{
		"path": "logs/.a.txt.tmp", "to": "logs/a.txt",
	})
	if status != http.StatusOK {
		t.Fatalf("rename: status %d, body %s", status, raw)
	}
	if body["from"] != "logs/.a.txt.tmp" || body["to"] != "logs/a.txt" {
		t.Errorf("from/to = %v/%v", body["from"], body["to"])
	}
	onDisk, err := os.ReadFile(filepath.Join(shared, "logs", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) != "replacement" {
		t.Errorf("file = %q, want %q", onDisk, "replacement")
	}
	if _, err := os.Stat(filepath.Join(shared, "logs", ".a.txt.tmp")); !os.IsNotExist(err) {
		t.Errorf("the temporary file survived the rename: %v", err)
	}
}

// TestRenameJudgesBothEndsAgainstTheSharedFolder: the destination is as much a
// way out as the source is, and a string check on either would be a check a
// swapped symlink could outrun. The kernel decides, in one renameat.
func TestRenameJudgesBothEndsAgainstTheSharedFolder(t *testing.T) {
	handler, shared := newWriteTestHandler(t)
	outside := filepath.Join(filepath.Dir(shared), "outside.txt")
	if err := os.WriteFile(outside, []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(outside) })
	if err := os.Symlink(filepath.Dir(shared), filepath.Join(shared, "link")); err != nil {
		t.Skipf("this host cannot make symlinks: %v", err)
	}

	for _, testCase := range []struct {
		name       string
		body       map[string]any
		wantStatus int
		wantCode   string
	}{
		{"destination climbs out", map[string]any{"path": "logs/a.txt", "to": "../escaped.txt"},
			http.StatusForbidden, "PATH_DENIED"},
		{"source climbs out", map[string]any{"path": "../outside.txt", "to": "stolen.txt"},
			http.StatusForbidden, "PATH_DENIED"},
		{"destination parent is a symlink out", map[string]any{"path": "logs/a.txt", "to": "link/escaped.txt"},
			http.StatusForbidden, "PATH_DENIED"},
		{"the shared folder itself", map[string]any{"path": "", "to": "elsewhere"},
			http.StatusForbidden, "PATH_DENIED"},
		{"absent source", map[string]any{"path": "logs/missing.txt", "to": "logs/b.txt"},
			http.StatusNotFound, "FILE_NOT_FOUND"},
		{"absent destination parent", map[string]any{"path": "logs/a.txt", "to": "nowhere/b.txt"},
			http.StatusNotFound, "FILE_NOT_FOUND"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			status, body, raw := call(t, handler, http.MethodPost, "/entries/rename", testCase.body)
			if status != testCase.wantStatus {
				t.Errorf("status = %d, want %d — %s", status, testCase.wantStatus, raw)
			}
			if code := errorCode(body); code != testCase.wantCode {
				t.Errorf("code = %q, want %q", code, testCase.wantCode)
			}
		})
	}
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("a refused rename moved a file outside the shared folder: %v", err)
	}
}
