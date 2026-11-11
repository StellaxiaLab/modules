package nodedata

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func i64(n int64) *int64 { return &n }

func icon(c, r int, name string) map[string]any {
	return map[string]any{"c": float64(c), "r": float64(r), "name": name, "k": "dir"}
}

func prefsAll() map[string]any {
	return map[string]any{"prefs.dark": true, "prefs.wall": "dusk", "prefs.wallFit": "cover", "prefs.dock": "bottom", "prefs.snap": true, "prefs.anim": false}
}

func merge(a, b map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// seeded returns a store whose desk is at revision 1 with icons a and b.
func seeded(t *testing.T) *Store {
	t.Helper()
	s := open(t, Limits{})
	v, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A"), "icons.b": icon(1, 0, "B")}))
	if err != nil || v.Revision != 1 {
		t.Fatalf("seed = %+v %v", v, err)
	}
	return s
}

// num reads a stored number whether it is still the int64 a patch just wrote or
// the float64 a reload decodes.
func num(v any) float64 {
	if n, ok := asNumber(v); ok {
		return n
	}
	return -1
}

func conflictKeys(t *testing.T, err error) []string {
	t.Helper()
	var rc *RevisionConflict
	if !errors.Is(err, ErrRevisionConflict) || !errors.As(err, &rc) {
		t.Fatalf("want revision conflict, got %v", err)
	}
	return rc.Keys
}

func TestDeskFileIsReserved(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"desk.json", "Desk.JSON", "DESK.json.", "desk.json ", "desk.json. .", "properties.json", "Properties.Json.", "PROPERTIES.JSON"} {
		if _, _, err := s.Get(name); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Get(%q) = %v", name, err)
		}
		if _, err := s.Put(name, gif1x1, ""); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Put(%q) = %v", name, err)
		}
		if err := s.Delete(name); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Delete(%q) = %v", name, err)
		}
		if _, _, _, err := s.PutChunk(name, 0, int64(len(gif1x1)), gif1x1, ""); !errors.Is(err, ErrPathDenied) {
			t.Errorf("PutChunk(%q) = %v", name, err)
		}
	}
	if _, err := s.Put("desk/wall/x.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	entries, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.EqualFold(e.Path, DeskFile) {
			t.Fatalf("desk.json listed: %v", entries)
		}
	}
	if len(entries) != 1 || entries[0].Path != "desk/wall/x.gif" {
		t.Fatalf("entries = %v", entries)
	}
	if _, err := os.Stat(filepath.Join(s.root, DeskFile)); err != nil {
		t.Fatalf("desk.json should exist: %v", err)
	}
}

func TestDeskGetShapes(t *testing.T) {
	s := open(t, Limits{})
	v, err := s.DeskGet(nil)
	if err != nil || v.Revision != 0 || v.Doc != nil || v.Unchanged {
		t.Fatalf("empty = %+v %v", v, err)
	}
	// since == 0 on a node never written: unchanged wins.
	if v, _ = s.DeskGet(i64(0)); !v.Unchanged || v.Revision != 0 {
		t.Fatalf("since 0 = %+v", v)
	}
	if v, _ = s.DeskGet(i64(5)); v.Unchanged || v.Doc != nil {
		t.Fatalf("since 5 on empty = %+v", v)
	}
	s = seeded(t)
	if _, err := s.DeskPatch(i64(1), map[string]any{"icons.a": icon(3, 3, "A")}); err != nil {
		t.Fatal(err)
	}
	if v, _ = s.DeskGet(i64(2)); !v.Unchanged || v.Doc != nil || v.Revision != 2 {
		t.Fatalf("same = %+v", v)
	}
	if v, _ = s.DeskGet(i64(1)); v.Unchanged || v.Doc == nil || v.Revision != 2 {
		t.Fatalf("smaller = %+v", v)
	}
	if v, _ = s.DeskGet(i64(99)); v.Unchanged || v.Doc == nil {
		t.Fatalf("larger = %+v", v)
	}
	if v, _ = s.DeskGet(nil); v.Doc == nil || len(v.Doc.Icons) != 2 {
		t.Fatalf("no since = %+v", v)
	}
}

func TestDeskBrokenFileIsNotOverwritten(t *testing.T) {
	s := open(t, Limits{})
	p := filepath.Join(s.root, DeskFile)
	if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeskGet(nil); err == nil {
		t.Fatal("get should fail")
	}
	if _, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})); err == nil {
		t.Fatal("patch should fail")
	}
	if b, _ := os.ReadFile(p); string(b) != "{not json" {
		t.Fatalf("file was rewritten: %q", b)
	}
}

func TestDeskBaseRevisionRules(t *testing.T) {
	s := seeded(t)
	for name, base := range map[string]*int64{"nil": nil, "negative": i64(-1)} {
		if _, err := s.DeskPatch(base, map[string]any{"icons.a": icon(1, 1, "A")}); !errors.Is(err, ErrInvalidProps) {
			t.Errorf("%s base = %v", name, err)
		}
	}
	if _, err := s.DeskPatch(i64(1), map[string]any{}); !errors.Is(err, ErrInvalidProps) {
		t.Errorf("empty set = %v", err)
	}
	_, err := s.DeskPatch(i64(7), map[string]any{"icons.a": icon(1, 1, "A")})
	if keys := conflictKeys(t, err); keys == nil || len(keys) != 0 {
		t.Errorf("base ahead keys = %#v", keys)
	}
}

func TestDeskFirstWriteShape(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.DeskPatch(i64(0), map[string]any{"icons.a": icon(0, 0, "A")}); !errors.Is(err, ErrInvalidProps) {
		t.Errorf("no prefs = %v", err)
	}
	if _, err := s.DeskPatch(i64(0), prefsAll()); !errors.Is(err, ErrInvalidProps) {
		t.Errorf("no icons = %v", err)
	}
	partial := merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})
	delete(partial, "prefs.anim")
	if _, err := s.DeskPatch(i64(0), partial); !errors.Is(err, ErrInvalidProps) {
		t.Errorf("five prefs = %v", err)
	}
	if v, _ := s.DeskGet(nil); v.Revision != 0 {
		t.Fatalf("a refused first write changed the desk: %+v", v)
	}
	v, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")}))
	if err != nil || v.Revision != 1 || v.Doc.Prefs["dock"] != "bottom" || v.Doc.Wall != nil {
		t.Fatalf("first write = %+v %v", v, err)
	}
}

func TestDeskDifferentKeysMerge(t *testing.T) {
	s := seeded(t)
	if _, err := s.DeskPatch(i64(1), map[string]any{"icons.a": icon(5, 5, "A")}); err != nil {
		t.Fatal(err)
	}
	// Another viewer still holds revision 1 and writes a different key.
	v, err := s.DeskPatch(i64(1), map[string]any{"prefs.dock": "left"})
	if err != nil || v.Revision != 3 {
		t.Fatalf("merge = %+v %v", v, err)
	}
	if num(v.Doc.Icons["a"]["c"]) != 5 || v.Doc.Prefs["dock"] != "left" {
		t.Fatalf("doc = %+v", v.Doc)
	}
}

func TestDeskSameKeyConflicts(t *testing.T) {
	s := seeded(t)
	if _, err := s.DeskPatch(i64(1), map[string]any{"icons.a": icon(5, 5, "A")}); err != nil {
		t.Fatal(err)
	}
	// Mixed: one losing key and one free key. Nothing may be written.
	_, err := s.DeskPatch(i64(1), map[string]any{"icons.a": icon(9, 9, "A"), "icons.b": icon(2, 2, "B")})
	if keys := conflictKeys(t, err); !reflect.DeepEqual(keys, []string{"icons.a"}) {
		t.Fatalf("keys = %v", keys)
	}
	v, _ := s.DeskGet(nil)
	if v.Revision != 2 || num(v.Doc.Icons["b"]["c"]) != 1 || num(v.Doc.Icons["a"]["c"]) != 5 {
		t.Fatalf("a refused patch wrote something: %+v", v)
	}
	// Conflict keys come back sorted.
	_, err = s.DeskPatch(i64(0), map[string]any{"icons.b": icon(2, 2, "B"), "icons.a": icon(2, 2, "A"), "prefs.dark": false})
	if keys := conflictKeys(t, err); !reflect.DeepEqual(keys, []string{"icons.a", "icons.b", "prefs.dark"}) {
		t.Fatalf("sorted keys = %v", keys)
	}
	// Retrying from the fresh revision works.
	if _, err := s.DeskPatch(i64(2), map[string]any{"icons.a": icon(9, 9, "A")}); err != nil {
		t.Fatal(err)
	}
}

func TestDeskMoveAfterDeleteConflicts(t *testing.T) {
	s := seeded(t)
	if v, err := s.DeskPatch(i64(1), map[string]any{"icons.a": nil}); err != nil || len(v.Doc.Icons) != 1 {
		t.Fatalf("delete = %+v %v", v, err)
	}
	// Another viewer, still at revision 1, moves the deleted icon.
	_, err := s.DeskPatch(i64(1), map[string]any{"icons.a": icon(4, 4, "A")})
	if keys := conflictKeys(t, err); !reflect.DeepEqual(keys, []string{"icons.a"}) {
		t.Fatalf("keys = %v", keys)
	}
	// A viewer that saw the deletion may re-create it.
	if _, err := s.DeskPatch(i64(2), map[string]any{"icons.a": icon(4, 4, "A")}); err != nil {
		t.Fatal(err)
	}
}

func TestDeskRevsFloor(t *testing.T) {
	s := seeded(t)
	// 600 icons added and deleted leave 600 tombstones; only 512 may stay.
	rev := int64(1)
	for batch := 0; batch < 3; batch++ {
		add, del := map[string]any{}, map[string]any{}
		for i := 0; i < 200; i++ {
			id := fmt.Sprintf("t%d", batch*200+i)
			add["icons."+id] = icon(0, 0, id)
			del["icons."+id] = nil
		}
		if _, err := s.DeskPatch(i64(rev), add); err != nil {
			t.Fatal(err)
		}
		rev++
		if _, err := s.DeskPatch(i64(rev), del); err != nil {
			t.Fatal(err)
		}
		rev++
	}
	st, err := s.readDesk()
	if err != nil {
		t.Fatal(err)
	}
	tombs := 0
	for k := range st.Revs {
		if strings.HasPrefix(k, "icons.t") {
			tombs++
		}
	}
	if tombs != maxDeskTombstone {
		t.Fatalf("tombstones = %d", tombs)
	}
	if st.RevsFloor <= 0 || st.RevsFloor >= st.Revision {
		t.Fatalf("floor = %d at revision %d", st.RevsFloor, st.Revision)
	}
	// t0's record was dropped: a writer based before the floor still conflicts on
	// it (the key falls back to the floor)...
	_, err = s.DeskPatch(i64(st.RevsFloor-1), map[string]any{"icons.t0": icon(1, 1, "x")})
	conflictKeys(t, err)
	// ...and one based at the floor may write it.
	if _, err := s.DeskPatch(i64(st.RevsFloor), map[string]any{"icons.t0": icon(1, 1, "x")}); err != nil {
		t.Fatalf("at floor: %v", err)
	}
	// A key never written falls back to the floor too.
	_, err = s.DeskPatch(i64(0), map[string]any{"icons.fresh": icon(1, 1, "x")})
	conflictKeys(t, err)
}

func TestDeskValueWhitelist(t *testing.T) {
	s := seeded(t)
	big := strings.Repeat("x", 257)
	cases := map[string]map[string]any{
		"unknown key":      {"theme": 1},
		"unknown prefs":    {"prefs.volume": true},
		"bad icon id":      {"icons.Bad": icon(0, 0, "A")},
		"icon id too long": {"icons." + strings.Repeat("a", 65): icon(0, 0, "A")},
		"icon not object":  {"icons.a": "x"},
		"extra field":      {"icons.a": merge(icon(0, 0, "A"), map[string]any{"z": 1})},
		"neg col":          {"icons.a": merge(icon(0, 0, "A"), map[string]any{"c": float64(-1)})},
		"frac row":         {"icons.a": merge(icon(0, 0, "A"), map[string]any{"r": 1.5})},
		"huge col":         {"icons.a": merge(icon(0, 0, "A"), map[string]any{"c": float64(1001)})},
		"empty name":       {"icons.a": merge(icon(0, 0, "A"), map[string]any{"name": ""})},
		"long name":        {"icons.a": merge(icon(0, 0, "A"), map[string]any{"name": big})},
		"bad kind":         {"icons.a": merge(icon(0, 0, "A"), map[string]any{"k": "link"})},
		"long loc":         {"icons.a": merge(icon(0, 0, "A"), map[string]any{"loc": strings.Repeat("l", 129)})},
		"loc not string":   {"icons.a": merge(icon(0, 0, "A"), map[string]any{"loc": 3})},
		"missing k":        {"icons.a": map[string]any{"c": 0, "r": 0, "name": "A"}},
		"dark string":      {"prefs.dark": "yes"},
		"dock value":       {"prefs.dock": "top"},
		"wall upper":       {"prefs.wall": "Dusk"},
		"wallFit long":     {"prefs.wallFit": strings.Repeat("a", 33)},
		"prefs null":       {"prefs.dark": nil},
		"wall not object":  {"wall": "x"},
		"wall extra":       {"wall": map[string]any{"file": "desk/wall/a.gif", "name": "a", "type": "image/gif", "at": 1, "z": 1}},
	}
	for name, set := range cases {
		if _, err := s.DeskPatch(i64(1), set); !errors.Is(err, ErrInvalidProps) {
			t.Errorf("%s: %v", name, err)
		}
	}
	ok := map[string]any{"icons.n-1_x": map[string]any{"c": 2, "r": int64(3), "name": "N", "k": "short", "loc": "/x", "app": "a", "mod": "m", "src": "s"},
		"prefs.dock": "left", "prefs.wall": "img", "prefs.wallFit": "cover", "prefs.dark": false, "prefs.snap": false, "prefs.anim": true}
	if v, err := s.DeskPatch(i64(1), ok); err != nil || v.Revision != 2 {
		t.Fatalf("valid = %+v %v", v, err)
	}
}

func TestDeskWall(t *testing.T) {
	s := seeded(t)
	if _, err := s.Put("desk/wall/1730000000000.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("profile/image/me.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	wall := func(file string) map[string]any {
		return map[string]any{"file": file, "name": "My pic.gif", "type": "image/gif", "at": float64(1730000000000)}
	}
	bad := map[string]map[string]any{
		"missing":       wall("desk/wall/none.gif"),
		"outside":       wall("profile/image/me.gif"),
		"dotdot":        wall("desk/wall/../../profile/image/me.gif"),
		"absolute":      wall("/desk/wall/1730000000000.gif"),
		"directory":     wall("desk/wall"),
		"bad type":      merge(wall("desk/wall/1730000000000.gif"), map[string]any{"type": "text/html"}),
		"neg at":        merge(wall("desk/wall/1730000000000.gif"), map[string]any{"at": float64(-1)}),
		"empty name":    merge(wall("desk/wall/1730000000000.gif"), map[string]any{"name": ""}),
		"missing field": {"file": "desk/wall/1730000000000.gif", "name": "a", "type": "image/gif"},
		"reserved name": wall("desk.json"),
	}
	for name, w := range bad {
		if _, err := s.DeskPatch(i64(1), map[string]any{"wall": w}); !errors.Is(err, ErrInvalidProps) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if v, _ := s.DeskGet(nil); v.Revision != 1 {
		t.Fatalf("refused wall patches changed the desk: %+v", v)
	}
	v, err := s.DeskPatch(i64(1), map[string]any{"wall": wall("desk/wall/1730000000000.gif"), "prefs.wall": "img"})
	if err != nil || v.Doc.Wall["file"] != "desk/wall/1730000000000.gif" || v.Doc.Prefs["wall"] != "img" {
		t.Fatalf("wall = %+v %v", v, err)
	}
	// null removes the wallpaper; the record stays as a tombstone.
	v, err = s.DeskPatch(i64(2), map[string]any{"wall": nil})
	if err != nil || v.Doc.Wall != nil {
		t.Fatalf("clear = %+v %v", v, err)
	}
	_, err = s.DeskPatch(i64(2), map[string]any{"wall": wall("desk/wall/1730000000000.gif")})
	conflictKeys(t, err)
}

func TestDeskLimits(t *testing.T) {
	s := open(t, Limits{})
	set := prefsAll()
	for i := 0; i < maxDeskIcons; i++ {
		set[fmt.Sprintf("icons.i%d", i)] = icon(i%100, i/100, "icon")
	}
	if v, err := s.DeskPatch(i64(0), set); err != nil || len(v.Doc.Icons) != maxDeskIcons {
		t.Fatalf("256 icons = %v", err)
	}
	if _, err := s.DeskPatch(i64(1), map[string]any{"icons.extra": icon(0, 0, "x")}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("257th icon = %v", err)
	}
	if v, _ := s.DeskGet(nil); v.Revision != 1 || len(v.Doc.Icons) != maxDeskIcons {
		t.Fatalf("a refused patch changed the desk: %d", v.Revision)
	}

	// 64 KiB: icons with long fields fill the document before the count limit.
	s = open(t, Limits{})
	long := strings.Repeat("n", 256)
	set = prefsAll()
	for i := 0; i < 120; i++ {
		set[fmt.Sprintf("icons.i%d", i)] = map[string]any{"c": 0, "r": 0, "name": long, "k": "file", "loc": strings.Repeat("l", 128), "app": strings.Repeat("a", 128)}
	}
	_, err := s.DeskPatch(i64(0), set)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("over 64 KiB = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(s.root, DeskFile)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("desk.json was written by a refused patch: %v", statErr)
	}
}

func TestDeskConcurrentWriters(t *testing.T) {
	const n = 24
	run := func(s *Store, setFor func(i int) map[string]any) (ok int) {
		var wg sync.WaitGroup
		var mu sync.Mutex
		start := make(chan struct{})
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				_, err := s.DeskPatch(i64(1), setFor(i))
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					ok++
				} else if !errors.Is(err, ErrRevisionConflict) {
					t.Errorf("writer %d: %v", i, err)
				}
			}(i)
		}
		close(start)
		wg.Wait()
		return ok
	}
	// Same key, same base: exactly one wins.
	s := seeded(t)
	if ok := run(s, func(i int) map[string]any { return map[string]any{"icons.a": icon(i, 0, "A")} }); ok != 1 {
		t.Fatalf("same key winners = %d", ok)
	}
	if v, _ := s.DeskGet(nil); v.Revision != 2 {
		t.Fatalf("revision = %d", v.Revision)
	}
	// Different keys, same base: all win and all are kept.
	s = seeded(t)
	ok := run(s, func(i int) map[string]any { return map[string]any{fmt.Sprintf("icons.w%d", i): icon(i, 1, "W")} })
	v, _ := s.DeskGet(nil)
	if ok != n || v.Revision != int64(1+n) || len(v.Doc.Icons) != 2+n {
		t.Fatalf("different keys: ok=%d revision=%d icons=%d", ok, v.Revision, len(v.Doc.Icons))
	}
}

func TestDeskPersistsAcrossOpen(t *testing.T) {
	s := seeded(t)
	if _, err := s.DeskPatch(i64(1), map[string]any{"icons.a": nil}); err != nil {
		t.Fatal(err)
	}
	again, err := Open(s.root, Limits{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = again.DeskPatch(i64(1), map[string]any{"icons.a": icon(1, 1, "A")})
	conflictKeys(t, err) // the tombstone survived the reopen
}

// A reserved name used as a directory would make desk.json a directory and
// break the sheet before it is ever written.
func TestReservedNameAsDirectoryIsRefused(t *testing.T) {
	s := open(t, Limits{})
	for _, p := range []string{"desk.json/x.png", "Desk.JSON/x.png", "desk.json./x.png", "properties.json/x.png", "PROPERTIES.json /x.png"} {
		if _, err := s.Put(p, png1x1, ""); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Put(%q) = %v", p, err)
		}
		if _, err := s.List(p); !errors.Is(err, ErrPathDenied) {
			t.Errorf("List(%q) = %v", p, err)
		}
	}
	if _, err := s.DeskGet(nil); err != nil {
		t.Fatalf("DeskGet: %v", err)
	}
	if _, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})); err != nil {
		t.Fatalf("DeskPatch: %v", err)
	}
	if _, err := s.Props(); err != nil {
		t.Fatalf("Props: %v", err)
	}
}

// refuseAlias checks every operation that resolves a path refuses name.
func refuseAlias(t *testing.T, s *Store, name string) {
	t.Helper()
	if _, _, err := s.Get(name); !errors.Is(err, ErrPathDenied) {
		t.Errorf("Get(%q) = %v", name, err)
	}
	if _, err := s.Put(name, gif1x1, ""); !errors.Is(err, ErrPathDenied) {
		t.Errorf("Put(%q) = %v", name, err)
	}
	if _, _, _, err := s.PutChunk(name, 0, int64(len(gif1x1)), gif1x1, ""); !errors.Is(err, ErrPathDenied) {
		t.Errorf("PutChunk(%q) = %v", name, err)
	}
	if err := s.Delete(name); !errors.Is(err, ErrPathDenied) {
		t.Errorf("Delete(%q) = %v", name, err)
	}
	if _, err := s.List(name); !errors.Is(err, ErrPathDenied) {
		t.Errorf("List(%q) = %v", name, err)
	}
}

func TestReservedFileAliasByHardLink(t *testing.T) {
	s := open(t, Limits{})
	// Before the sheets exist, resolving ordinary paths must not fail.
	if _, err := s.Put("desk/wall/a.gif", gif1x1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Patch(map[string]any{"note": "x"}, ""); err != nil {
		t.Fatal(err)
	}
	for sheet, alias := range map[string]string{DeskFile: "alias-desk.gif", PropsFile: "desk/wall/alias-props.gif"} {
		if err := os.Link(filepath.Join(s.root, sheet), filepath.Join(s.root, filepath.FromSlash(alias))); err != nil {
			t.Skipf("hard links unavailable here: %v", err)
		}
		refuseAlias(t, s, alias)
	}
	// The alias is also no wallpaper.
	_, err := s.DeskPatch(i64(1), map[string]any{"wall": map[string]any{"file": "desk/wall/alias-props.gif", "name": "a", "type": "image/gif", "at": 1}})
	if !errors.Is(err, ErrInvalidProps) && !errors.Is(err, ErrPathDenied) {
		t.Errorf("wall alias = %v", err)
	}
	// Both sheets are intact.
	if v, err := s.DeskGet(nil); err != nil || v.Doc == nil {
		t.Fatalf("desk damaged: %v", err)
	}
	if p, err := s.Props(); err != nil || p["note"] != "x" {
		t.Fatalf("props damaged: %v %v", p, err)
	}
}

func TestReservedFileAliasByShortName(t *testing.T) {
	s := open(t, Limits{})
	if _, err := s.DeskPatch(i64(0), merge(prefsAll(), map[string]any{"icons.a": icon(0, 0, "A")})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Patch(map[string]any{"note": "x"}, ""); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, short := range []string{"DESK~1.JSO", "PROPER~1.JSO"} {
		if _, err := os.Stat(filepath.Join(s.root, short)); err != nil {
			t.Logf("skip %s: no 8.3 short name on this volume (%v)", short, err)
			continue
		}
		checked++
		refuseAlias(t, s, short)
	}
	if checked == 0 {
		t.Skip("8.3 short names are not available on this system or volume")
	}
	if v, err := s.DeskGet(nil); err != nil || v.Doc == nil {
		t.Fatalf("desk damaged: %v", err)
	}
}
