package nodedata

// The node's desktop layout (icons, preferences, wallpaper) belongs to the node,
// like its profile: every viewer sees the same desk. It is kept in one reserved
// file, desk.json, with a revision per key so two viewers editing different
// things merge and two editing the same thing do not silently overwrite each
// other. Design: docs/design/node-owned-desk.md §6, §7.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// DeskFile is the desk document's name inside the root. It is reserved like
// PropsFile: the file operations refuse it so DeskPatch is the only writer.
const DeskFile = "desk.json"

// WallDir is where wallpaper images live (written through the file operations).
const WallDir = "desk/wall"

// ErrRevisionConflict — a key in the patch changed after the revision the
// caller based it on, or the base revision is newer than the node's.
var ErrRevisionConflict = errors.New("revision conflict")

// RevisionConflict carries the keys that lost. Keys is empty when the base
// revision is ahead of the node's (a restored file, a reinstall).
type RevisionConflict struct {
	Keys []string
}

func (e *RevisionConflict) Error() string {
	if len(e.Keys) == 0 {
		return "revision conflict: base revision is newer than the node's"
	}
	return "revision conflict: " + strings.Join(e.Keys, ", ")
}

// Is makes errors.Is(err, ErrRevisionConflict) true.
func (e *RevisionConflict) Is(target error) bool { return target == ErrRevisionConflict }

const (
	maxDeskBytes     = 64 << 10
	maxDeskIcons     = 256
	maxDeskTombstone = 512
	maxIconCell      = 1000
	maxIconName      = 256
	maxIconRef       = 128
	maxWallName      = 256
)

var (
	iconID    = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	prefToken = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
)

// deskPrefs are the preference fields; the first write must carry all of them.
var deskPrefs = []string{"dark", "wall", "wallFit", "dock", "snap", "anim"}

// DeskDoc is the document viewers read.
type DeskDoc struct {
	Icons map[string]map[string]any `json:"icons"`
	Prefs map[string]any            `json:"prefs"`
	Wall  map[string]any            `json:"wall"`
}

// DeskView is what DeskGet and DeskPatch return. With Unchanged set it is
// {revision, unchanged:true}; otherwise {revision, doc} where doc is null when
// nothing was ever written.
type DeskView struct {
	Revision  int64    `json:"revision"`
	Doc       *DeskDoc `json:"doc"`
	Unchanged bool     `json:"-"`
}

// MarshalJSON writes the two shapes the contract names.
func (v DeskView) MarshalJSON() ([]byte, error) {
	if v.Unchanged {
		return json.Marshal(struct {
			Revision  int64 `json:"revision"`
			Unchanged bool  `json:"unchanged"`
		}{v.Revision, true})
	}
	return json.Marshal(struct {
		Revision int64    `json:"revision"`
		Doc      *DeskDoc `json:"doc"`
	}{v.Revision, v.Doc})
}

type deskState struct {
	Revision  int64            `json:"revision"`
	Doc       *DeskDoc         `json:"doc"`
	Revs      map[string]int64 `json:"revs"`
	RevsFloor int64            `json:"revs_floor"`
}

func (s *Store) readDesk() (*deskState, error) {
	data, err := os.ReadFile(filepath.Join(s.root, DeskFile))
	if errors.Is(err, fs.ErrNotExist) {
		return &deskState{Revs: map[string]int64{}}, nil
	}
	if err != nil {
		return nil, err
	}
	st := &deskState{}
	if err := json.Unmarshal(data, st); err != nil {
		return nil, fmt.Errorf("decode %s: %w", DeskFile, err)
	}
	if st.Revs == nil {
		st.Revs = map[string]int64{}
	}
	if st.Doc != nil {
		if st.Doc.Icons == nil {
			st.Doc.Icons = map[string]map[string]any{}
		}
		if st.Doc.Prefs == nil {
			st.Doc.Prefs = map[string]any{}
		}
	}
	return st, nil
}

// DeskGet returns the desk. A since equal to the current revision answers
// "unchanged" without the document; any other value (smaller or larger) gets
// the whole document. A file that cannot be decoded is an error and is left as
// it is.
func (s *Store) DeskGet(since *int64) (DeskView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readDesk()
	if err != nil {
		return DeskView{}, err
	}
	if since != nil && *since == st.Revision {
		return DeskView{Revision: st.Revision, Unchanged: true}, nil
	}
	return DeskView{Revision: st.Revision, Doc: st.Doc}, nil
}

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalidProps}, a...)...)
}

// DeskPatch applies set on top of the document the caller saw at base. Either
// every key applies or none; a null value deletes an icon or the wallpaper.
func (s *Store) DeskPatch(base *int64, set map[string]any) (DeskView, error) {
	if base == nil || *base < 0 {
		return DeskView{}, invalid("base_revision is required and must not be negative")
	}
	if len(set) == 0 {
		return DeskView{}, invalid("nothing to set")
	}
	// Shape first: nothing here reads the store, so a bad request never waits on
	// the lock or reports a conflict instead of its real fault.
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	norm := make(map[string]any, len(set))
	for _, k := range keys {
		v, err := checkDeskValue(k, set[k])
		if err != nil {
			return DeskView{}, err
		}
		norm[k] = v
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.readDesk()
	if err != nil {
		return DeskView{}, err
	}
	// Wall files are looked up under the lock, with the store's own path rules.
	for _, k := range keys {
		if k == "wall" && norm[k] != nil {
			if err := s.checkWallFile(norm[k].(map[string]any)); err != nil {
				return DeskView{}, err
			}
		}
	}
	if *base > st.Revision {
		return DeskView{}, &RevisionConflict{Keys: []string{}}
	}
	if st.Revision == 0 {
		if err := checkFirstWrite(norm); err != nil {
			return DeskView{}, err
		}
	}
	conflicts := []string{}
	for _, k := range keys {
		rev, ok := st.Revs[k]
		if !ok {
			rev = st.RevsFloor
		}
		if rev > *base {
			conflicts = append(conflicts, k)
		}
	}
	if len(conflicts) > 0 {
		return DeskView{}, &RevisionConflict{Keys: conflicts}
	}

	next := &deskState{Revision: st.Revision + 1, Revs: map[string]int64{}, RevsFloor: st.RevsFloor}
	for k, v := range st.Revs {
		next.Revs[k] = v
	}
	doc := &DeskDoc{Icons: map[string]map[string]any{}, Prefs: map[string]any{}}
	if st.Doc != nil {
		for k, v := range st.Doc.Icons {
			doc.Icons[k] = v
		}
		for k, v := range st.Doc.Prefs {
			doc.Prefs[k] = v
		}
		doc.Wall = st.Doc.Wall
	}
	for _, k := range keys {
		v := norm[k]
		switch {
		case k == "wall":
			if v == nil {
				doc.Wall = nil
			} else {
				doc.Wall = v.(map[string]any)
			}
		case strings.HasPrefix(k, "icons."):
			id := strings.TrimPrefix(k, "icons.")
			if v == nil {
				delete(doc.Icons, id)
			} else {
				doc.Icons[id] = v.(map[string]any)
			}
		default:
			doc.Prefs[strings.TrimPrefix(k, "prefs.")] = v
		}
		next.Revs[k] = next.Revision
	}
	next.Doc = doc

	if len(doc.Icons) > maxDeskIcons {
		return DeskView{}, fmt.Errorf("%w: more than %d icons", ErrTooLarge, maxDeskIcons)
	}
	docJSON, err := json.Marshal(doc)
	if err != nil {
		return DeskView{}, invalid("%v", err)
	}
	if len(docJSON) > maxDeskBytes {
		return DeskView{}, fmt.Errorf("%w: desk document over %d bytes", ErrTooLarge, maxDeskBytes)
	}
	pruneTombstones(next)
	out, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return DeskView{}, err
	}
	if err := writeAtomic(filepath.Join(s.root, DeskFile), append(out, '\n')); err != nil {
		return DeskView{}, err
	}
	return DeskView{Revision: next.Revision, Doc: doc}, nil
}

// pruneTombstones keeps at most maxDeskTombstone revision records for keys that
// are no longer in the document, dropping the oldest and raising the floor to
// the newest one dropped, so a late writer that remembers a dropped key still
// conflicts instead of resurrecting it.
func pruneTombstones(st *deskState) {
	type tomb struct {
		key string
		rev int64
	}
	var tombs []tomb
	for k, rev := range st.Revs {
		live := false
		switch {
		case k == "wall":
			live = st.Doc.Wall != nil
		case strings.HasPrefix(k, "icons."):
			_, live = st.Doc.Icons[strings.TrimPrefix(k, "icons.")]
		default:
			_, live = st.Doc.Prefs[strings.TrimPrefix(k, "prefs.")]
		}
		if !live {
			tombs = append(tombs, tomb{k, rev})
		}
	}
	if len(tombs) <= maxDeskTombstone {
		return
	}
	sort.Slice(tombs, func(i, j int) bool {
		if tombs[i].rev != tombs[j].rev {
			return tombs[i].rev < tombs[j].rev
		}
		return tombs[i].key < tombs[j].key
	})
	for _, t := range tombs[:len(tombs)-maxDeskTombstone] {
		delete(st.Revs, t.key)
		if t.rev > st.RevsFloor {
			st.RevsFloor = t.rev
		}
	}
}

func checkFirstWrite(norm map[string]any) error {
	icons := false
	for k := range norm {
		if strings.HasPrefix(k, "icons.") {
			icons = true
		}
	}
	if !icons {
		return invalid("the first write must include at least one icons.<id>")
	}
	for _, p := range deskPrefs {
		if _, ok := norm["prefs."+p]; !ok {
			return invalid("the first write must include prefs.%s", p)
		}
	}
	return nil
}

// checkDeskValue validates one key and its value and returns the value in the
// form that is stored. nil means delete.
func checkDeskValue(key string, v any) (any, error) {
	switch {
	case key == "wall":
		if v == nil {
			return nil, nil
		}
		return checkWall(v)
	case strings.HasPrefix(key, "icons."):
		if !iconID.MatchString(strings.TrimPrefix(key, "icons.")) {
			return nil, invalid("key %q", key)
		}
		if v == nil {
			return nil, nil
		}
		return checkIcon(key, v)
	case strings.HasPrefix(key, "prefs."):
		field := strings.TrimPrefix(key, "prefs.")
		known := false
		for _, p := range deskPrefs {
			known = known || p == field
		}
		if !known {
			return nil, invalid("key %q", key)
		}
		if v == nil {
			return nil, invalid("%s cannot be null", key)
		}
		return checkPref(key, field, v)
	}
	return nil, invalid("key %q", key)
}

func checkPref(key, field string, v any) (any, error) {
	switch field {
	case "dark", "snap", "anim":
		b, ok := v.(bool)
		if !ok {
			return nil, invalid("%s must be true or false", key)
		}
		return b, nil
	case "dock":
		s, ok := v.(string)
		if !ok || (s != "bottom" && s != "left") {
			return nil, invalid("%s must be bottom or left", key)
		}
		return s, nil
	default: // wall, wallFit
		s, ok := v.(string)
		if !ok || !prefToken.MatchString(s) {
			return nil, invalid("%s must be a short lowercase token", key)
		}
		return s, nil
	}
}

func asInt(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int64:
		return n, true
	case float64:
		if n != math.Trunc(n) || math.IsInf(n, 0) || math.IsNaN(n) {
			return 0, false
		}
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	}
	return 0, false
}

func asNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, !math.IsInf(n, 0) && !math.IsNaN(n)
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func checkIcon(key string, v any) (any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, invalid("%s must be an object", key)
	}
	out := map[string]any{}
	for f, val := range m {
		switch f {
		case "c", "r":
			n, ok := asInt(val)
			if !ok || n < 0 || n > maxIconCell {
				return nil, invalid("%s.%s must be a whole number from 0 to %d", key, f, maxIconCell)
			}
			out[f] = n
		case "name":
			s, ok := val.(string)
			if !ok || len(s) < 1 || len(s) > maxIconName {
				return nil, invalid("%s.name must be 1 to %d bytes", key, maxIconName)
			}
			out[f] = s
		case "k":
			s, ok := val.(string)
			if !ok || (s != "dir" && s != "file" && s != "short") {
				return nil, invalid("%s.k must be dir, file or short", key)
			}
			out[f] = s
		case "loc", "app", "mod", "src":
			s, ok := val.(string)
			if !ok || len(s) > maxIconRef {
				return nil, invalid("%s.%s must be a string of at most %d bytes", key, f, maxIconRef)
			}
			out[f] = s
		default:
			return nil, invalid("%s.%s is not known", key, f)
		}
	}
	for _, f := range []string{"c", "r", "name", "k"} {
		if _, ok := out[f]; !ok {
			return nil, invalid("%s.%s is required", key, f)
		}
	}
	return out, nil
}

func checkWall(v any) (any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, invalid("wall must be an object")
	}
	out := map[string]any{}
	for f, val := range m {
		switch f {
		case "file":
			s, ok := val.(string)
			if !ok || s == "" {
				return nil, invalid("wall.file must be a path")
			}
			out[f] = s
		case "name":
			s, ok := val.(string)
			if !ok || len(s) < 1 || len(s) > maxWallName {
				return nil, invalid("wall.name must be 1 to %d bytes", maxWallName)
			}
			out[f] = s
		case "type":
			s, ok := val.(string)
			if !ok || !AllowedTypes[s] {
				return nil, invalid("wall.type is not an allowed image type")
			}
			out[f] = s
		case "at":
			n, ok := asNumber(val)
			if !ok || n < 0 {
				return nil, invalid("wall.at must be a number of zero or more")
			}
			out[f] = n
		default:
			return nil, invalid("wall.%s is not known", f)
		}
	}
	for _, f := range []string{"file", "name", "type", "at"} {
		if _, ok := out[f]; !ok {
			return nil, invalid("wall.%s is required", f)
		}
	}
	return out, nil
}

// checkWallFile: wall.file names a regular file under desk/wall/ in this store.
func (s *Store) checkWallFile(w map[string]any) error {
	file := w["file"].(string)
	rel, err := clean(file, false)
	if err != nil || !strings.HasPrefix(rel, WallDir+"/") {
		return invalid("wall.file must be under %s/", WallDir)
	}
	full, err := s.resolve(rel)
	if err != nil {
		return invalid("wall.file path")
	}
	if info, err := os.Stat(full); err != nil || !info.Mode().IsRegular() {
		return invalid("wall.file names no stored file")
	}
	w["file"] = rel
	return nil
}
