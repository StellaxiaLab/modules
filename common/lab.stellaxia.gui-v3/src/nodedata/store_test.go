package nodedata

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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

// starMakerSphere is a real StarMaker file (sphereData(): terra.sphere v1, a GIF
// source at 128 px), cut to two frames to keep the repository small. The sphere
// names itself in "format" — the first version of the check looked for "type"
// and refused every file StarMaker writes.
func starMakerSphere(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "web", "tests", "fixtures", "starmaker-gif.sphere.json"))
	if err != nil {
		t.Fatal(err)
	}
	var head map[string]any
	if json.Unmarshal(data, &head) != nil || head["format"] != "terra.sphere" || head["type"] != nil {
		t.Fatalf("fixture is not a StarMaker sphere: %.80s", data)
	}
	return data
}

func TestSkinFile(t *testing.T) {
	s := open(t, Limits{})
	sphere := starMakerSphere(t)
	if _, err := s.Put("skin/mars-1.json", []byte(`{"type":"other"}`), ""); !errors.Is(err, ErrTypeDenied) {
		t.Fatalf("not a sphere: %v", err)
	}
	if _, err := s.Put("profile/image/a.json", sphere, ""); !errors.Is(err, ErrTypeDenied) {
		t.Fatalf("json outside skin/: %v", err)
	}
	e, err := s.Put("skin/mars-1.json", sphere, "application/json")
	if err != nil || e.Mime != "application/json" {
		t.Fatalf("put: %v %+v", err, e)
	}
	if _, err := s.Patch(map[string]any{"skin": map[string]any{"file": "/데이터/skin/none.json"}}, "/데이터"); !errors.Is(err, ErrInvalidProps) {
		t.Fatalf("missing file: %v", err)
	}
	if _, err := s.Patch(map[string]any{"skin": map[string]any{"file": "/데이터/skin/mars-1.json"}}, "/데이터"); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(SkinDir)
	if err != nil || len(list) != 1 || list[0].Mime != "application/json" {
		t.Fatalf("list: %v %+v", err, list)
	}
}

// TestSkinFileLegacyType keeps files written while the check read "type".
func TestSkinFileLegacyType(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.Put("skin/old-1.json", []byte(`{"type":"terra.sphere","surface":{"frames":[]}}`), "application/json"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("skin/bad-1.json", []byte(`{"format":"terra.other","type":"other"}`), ""); !errors.Is(err, ErrTypeDenied) {
		t.Fatalf("neither key names a sphere: %v", err)
	}
}

// bigStarMakerSphere grows the real file to n frames by repeating its frames:
// a long GIF makes a file of several MB, which arrives in 640 KiB chunks.
func bigStarMakerSphere(t *testing.T, n int) []byte {
	t.Helper()
	var J map[string]any
	if err := json.Unmarshal(starMakerSphere(t), &J); err != nil {
		t.Fatal(err)
	}
	surface := J["surface"].(map[string]any)
	src := surface["frames"].([]any)
	frames := make([]any, n)
	for i := range frames {
		frames[i] = src[i%len(src)]
	}
	surface["frames"] = frames
	data, err := json.Marshal(J)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func putInChunks(t *testing.T, s *Store, rel string, data []byte) Entry {
	t.Helper()
	total := int64(len(data))
	for off := int64(0); off < total; {
		end := off + MaxChunkBytes
		if end > total {
			end = total
		}
		e, have, done, err := s.PutChunk(rel, off, total, data[off:end], "application/json")
		if err != nil {
			t.Fatalf("chunk at %d: %v", off, err)
		}
		if done {
			return e
		}
		off = have
	}
	t.Fatal("upload never finished")
	return Entry{}
}

func TestSkinFileChunkedStarMaker(t *testing.T) {
	s := open(t, Limits{})
	data := bigStarMakerSphere(t, 400)
	if len(data) < 3*MaxChunkBytes {
		t.Fatalf("want a file over three chunks, got %d bytes", len(data))
	}
	e := putInChunks(t, s, "skin/long-1.json", data)
	if e.Mime != "application/json" || e.Size != int64(len(data)) {
		t.Fatalf("entry = %+v", e)
	}
	got, _, err := s.Get("skin/long-1.json")
	if err != nil || string(got) != string(data) {
		t.Fatalf("read back %d of %d bytes: %v", len(got), len(data), err)
	}
	if _, err := s.Patch(map[string]any{"skin": map[string]any{"file": "/데이터/skin/long-1.json"}}, "/데이터"); err != nil {
		t.Fatal(err)
	}
}

// TestSkinFileCapturedSamples stores every *.sphere.json in TERRA_SPHERE_SAMPLES
// — full-size files saved from StarMaker in a browser — the way the GUI does.
// It is skipped when the variable is not set.
func TestSkinFileCapturedSamples(t *testing.T) {
	dir := os.Getenv("TERRA_SPHERE_SAMPLES")
	if dir == "" {
		t.Skip("TERRA_SPHERE_SAMPLES not set")
	}
	paths, _ := filepath.Glob(filepath.Join(dir, "*.sphere.json"))
	if len(paths) == 0 {
		t.Fatalf("no samples in %s", dir)
	}
	s := open(t, Limits{})
	for i, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		rel := fmt.Sprintf("skin/sample-%d.json", i)
		e := putInChunks(t, s, rel, data)
		got, _, err := s.Get(rel)
		if err != nil || string(got) != string(data) {
			t.Fatalf("%s: read back %d of %d bytes: %v", filepath.Base(p), len(got), len(data), err)
		}
		t.Logf("%s: %d bytes stored", filepath.Base(p), e.Size)
		if err := s.Delete(rel); err != nil {
			t.Fatal(err)
		}
	}
}
