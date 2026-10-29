package nodedata

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// 1×1 images — the smallest bytes the sniffer recognises as each type.
var (
	gif1x1, _ = base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
	png1x1, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
)

func open(t *testing.T, limits Limits) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "node-data"), limits)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPutGetListDelete(t *testing.T) {
	s := open(t, Limits{})
	e, err := s.Put("profile/image/me.gif", gif1x1, "image/gif")
	if err != nil {
		t.Fatal(err)
	}
	if e.Mime != "image/gif" || e.Size != int64(len(gif1x1)) || e.Path != "profile/image/me.gif" {
		t.Fatalf("entry = %+v", e)
	}
	data, got, err := s.Get("profile/image/me.gif")
	if err != nil || string(data) != string(gif1x1) || got.Mime != "image/gif" {
		t.Fatalf("get = %v %+v", err, got)
	}
	list, err := s.List("profile")
	if err != nil || len(list) != 1 || list[0].Path != "profile/image/me.gif" {
		t.Fatalf("list = %v %+v", err, list)
	}
	if err := s.Delete("profile/image/me.gif"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.root, "profile")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("empty directories should be removed, stat err = %v", err)
	}
	if _, _, err := s.Get("profile/image/me.gif"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get after delete = %v", err)
	}
	if list, err := s.List(""); err != nil || len(list) != 0 {
		t.Fatalf("list after delete = %v %+v", err, list)
	}
}

func TestPathsThatLeaveOrAreReserved(t *testing.T) {
	s := open(t, Limits{})
	for _, p := range []string{"", "/abs.gif", "../x.gif", "a/../../x.gif", "a//b.gif", "./x.gif", ".hidden.gif", "a\\b.gif", "c:x.gif", "a/b?.gif", PropsFile, "a/b/c/d/e/f/g/h/i.gif", "bad\x01.gif"} {
		if _, err := s.Put(p, gif1x1, ""); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Put(%q) = %v, want ErrPathDenied", p, err)
		}
	}
}

func TestSymlinkInsideRootIsRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	s := open(t, Limits{})
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(s.root, "profile")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("profile/me.gif", gif1x1, ""); !errors.Is(err, ErrPathDenied) {
		t.Fatalf("put through symlink = %v", err)
	}
	if entries, _ := os.ReadDir(outside); len(entries) != 0 {
		t.Fatalf("a file escaped through the link: %v", entries)
	}
}

func TestTypeIsSniffedNotTrusted(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.Put("x.gif", []byte("<html>not an image</html>"), "image/gif"); !errors.Is(err, ErrTypeDenied) {
		t.Fatalf("html as gif = %v", err)
	}
	if _, err := s.Put("x.png", gif1x1, "image/png"); !errors.Is(err, ErrTypeDenied) {
		t.Fatalf("gif declared as png = %v", err)
	}
	if e, err := s.Put("x.png", png1x1, ""); err != nil || e.Mime != "image/png" {
		t.Fatalf("png without declared type = %v %+v", err, e)
	}
}

func TestLimits(t *testing.T) {
	s := open(t, Limits{MaxFileBytes: int64(len(gif1x1)), MaxTotalBytes: int64(len(gif1x1))*2 + 10})
	big := append(append([]byte{}, gif1x1...), 0)
	if _, err := s.Put("big.gif", big, ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over file limit = %v", err)
	}
	if _, err := s.Put("a.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("b.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("c.gif", gif1x1, ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over total limit = %v", err)
	}
	// Replacing a file counts only the difference.
	if _, err := s.Put("a.gif", gif1x1, ""); err != nil {
		t.Fatalf("replace within total = %v", err)
	}
}

func TestChunkedUpload(t *testing.T) {
	s := open(t, Limits{})
	data := append(append([]byte{}, gif1x1...), make([]byte, MaxChunkBytes+100)...)
	total := int64(len(data))
	if _, _, _, err := s.PutChunk("p/big.gif", 5, total, data[5:10], ""); !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("start past zero = %v", err)
	}
	if _, _, _, err := s.PutChunk("p/big.gif", 0, total, data, ""); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("chunk over the limit = %v", err)
	}
	_, got, done, err := s.PutChunk("p/big.gif", 0, total, data[:MaxChunkBytes], "image/gif")
	if err != nil || done || got != MaxChunkBytes {
		t.Fatalf("first chunk = %v %v %d", err, done, got)
	}
	if list, _ := s.List(""); len(list) != 0 {
		t.Fatalf("a staged upload must not be listed: %+v", list)
	}
	if _, _, _, err := s.PutChunk("p/big.gif", 10, total, data[10:20], ""); !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("gap = %v", err)
	}
	entry, got, done, err := s.PutChunk("p/big.gif", MaxChunkBytes, total, data[MaxChunkBytes:], "image/gif")
	if err != nil || !done || got != total || entry.Size != total || entry.Mime != "image/gif" {
		t.Fatalf("last chunk = %v %v %d %+v", err, done, got, entry)
	}
	stored, _, err := s.Get("p/big.gif")
	if err != nil || string(stored) != string(data) {
		t.Fatalf("stored bytes differ: %v", err)
	}
	if used, _ := s.Usage(); used != total {
		t.Fatalf("usage = %d, want %d (staging must be gone)", used, total)
	}
}

func TestPatchProps(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.Put("profile/image/me.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	got, err := s.Patch(map[string]any{"profile": map[string]any{"image": "/데이터/profile/image/me.gif"}, "note": "hi"}, "/데이터")
	if err != nil {
		t.Fatal(err)
	}
	if !equalJSON(got, map[string]any{"profile": map[string]any{"image": "/데이터/profile/image/me.gif"}, "note": "hi"}) {
		t.Fatalf("props = %v", got)
	}
	again, err := s.Props()
	if err != nil || !equalJSON(again, got) {
		t.Fatalf("reread = %v %v", err, again)
	}
	if got, err := s.Patch(map[string]any{"note": nil}, "/데이터"); err != nil || got["note"] != nil {
		t.Fatalf("delete key = %v %v", err, got)
	}
	// Whole patch is refused when one part is wrong — and nothing changes.
	for _, bad := range []map[string]any{
		{"profile": map[string]any{"image": "/데이터/profile/image/missing.gif"}},
		{"profile": map[string]any{"image": "/elsewhere/me.gif"}},
		{"profile": map[string]any{"image": "/데이터/../../etc/passwd"}},
		{"profile": map[string]any{"image": "/데이터/profile/image/me.gif", "extra": 1}},
		{"profile": "me.gif"},
		{"Bad Key": 1},
		{},
	} {
		if _, err := s.Patch(bad, "/데이터"); !errors.Is(err, ErrInvalidProps) && !errors.Is(err, ErrPathDenied) {
			t.Errorf("Patch(%v) = %v", bad, err)
		}
	}
	final, _ := s.Props()
	if !equalJSON(final, map[string]any{"profile": map[string]any{"image": "/데이터/profile/image/me.gif"}}) {
		t.Fatalf("a refused patch changed the sheet: %v", final)
	}
	if list, _ := s.List(""); len(list) != 1 {
		t.Fatalf("properties.json must not be listed as a file: %+v", list)
	}
}

func TestFilesArePrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX modes")
	}
	s := open(t, Limits{})
	if _, err := s.Put("p/x.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(s.root, "p", "x.gif"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v %v", err, info.Mode())
	}
}
