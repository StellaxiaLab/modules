// Package nodedata keeps the GUI data that belongs to this node rather than to
// a person: the node's profile picture and its small property sheet. It lives
// in the module's own data directory, so every viewer of the node sees the same
// thing, and nothing outside the store's root can be read or written through it.
//
// Layout (화면에 보이는 경로는 "/<노드>/데이터/" — 그 아래 v3 몫이 이 루트다):
//
//	<root>/
//	├─ properties.json   ← Props / Patch
//	└─ profile/image/…   ← Put / Get / Delete / List
package nodedata

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// PropsFile is the property sheet's name inside the root. It is reserved: the
// file operations refuse it so the only way to change it is Patch.
const PropsFile = "properties.json"

var (
	// ErrPathDenied — the path is malformed or would leave the root.
	ErrPathDenied = errors.New("path is not allowed")
	// ErrNotFound — nothing is stored at the path.
	ErrNotFound = errors.New("not found")
	// ErrTypeDenied — the content is not one of the image types the store keeps.
	ErrTypeDenied = errors.New("content type is not allowed")
	// ErrTooLarge — one file, or the store as a whole, would exceed its limit.
	ErrTooLarge = errors.New("too large")
	// ErrInvalidProps — a property key or value does not fit the sheet's rules.
	ErrInvalidProps = errors.New("invalid property")
	// ErrOutOfOrder — a chunk's offset is not where the staged upload ends.
	ErrOutOfOrder = errors.New("chunk offset does not continue the upload")
)

// MaxChunkBytes is the largest raw chunk one request may carry. The Gateway
// cuts request bodies at 1 MiB and base64 grows bytes by 4/3, so the raw size
// must stay under 3/4 of that — the same arithmetic io.terra.file uses.
const MaxChunkBytes = 640 << 10

// stagingDir holds uploads in progress. It starts with a dot, so List and the
// path rules never show or accept it.
const stagingDir = ".staging"

// stagingTTL drops uploads nobody finished.
const stagingTTL = time.Hour

// Limits bound what the store accepts.
type Limits struct {
	MaxFileBytes  int64
	MaxTotalBytes int64
}

// DefaultLimits match the manifest's configuration defaults.
var DefaultLimits = Limits{MaxFileBytes: 8 << 20, MaxTotalBytes: 64 << 20}

const (
	maxPropsBytes = 64 << 10
	maxDepth      = 8
	maxSegment    = 128
)

// AllowedTypes are the content types a file may have. The type is sniffed from
// the bytes, not taken from the caller: a declared type that disagrees with the
// content is refused.
var AllowedTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

var propKey = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

// Entry describes one stored file.
type Entry struct {
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	Mime     string    `json:"mime"`
	Modified time.Time `json:"modified"`
}

// Store is safe for concurrent use.
type Store struct {
	root   string
	limits Limits
	mu     sync.Mutex
}

// Open prepares a store rooted at dir (created 0700 if missing).
func Open(dir string, limits Limits) (*Store, error) {
	if limits.MaxFileBytes <= 0 {
		limits.MaxFileBytes = DefaultLimits.MaxFileBytes
	}
	if limits.MaxTotalBytes <= 0 {
		limits.MaxTotalBytes = DefaultLimits.MaxTotalBytes
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create node data directory: %w", err)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	return &Store{root: abs, limits: limits}, nil
}

// Limits reports the limits in force.
func (s *Store) Limits() Limits { return s.limits }

// clean turns a caller's relative path into a canonical slash path inside the
// root, or refuses it. Rules: relative, no "..", no empty or dot segments, no
// characters that are illegal on Windows, no control characters, bounded depth
// and segment length, and never the reserved property sheet.
func clean(rel string, allowEmpty bool) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" || rel == "." || rel == "/" {
		if allowEmpty {
			return "", nil
		}
		return "", ErrPathDenied
	}
	if strings.ContainsAny(rel, "\\:*?\"<>|") || strings.HasPrefix(rel, "/") {
		return "", ErrPathDenied
	}
	parts := strings.Split(rel, "/")
	if len(parts) > maxDepth {
		return "", ErrPathDenied
	}
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || len(p) > maxSegment || strings.HasPrefix(p, ".") {
			return "", ErrPathDenied
		}
		for _, r := range p {
			if r < 0x20 || r == 0x7f {
				return "", ErrPathDenied
			}
		}
	}
	out := path.Clean(rel)
	if out == PropsFile {
		return "", ErrPathDenied
	}
	return out, nil
}

// resolve maps a clean relative path onto disk and refuses any symbolic link on
// the way down, so a link planted inside the root cannot lead out of it.
func (s *Store) resolve(rel string) (string, error) {
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	inside, err := filepath.Rel(s.root, full)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", ErrPathDenied
	}
	cur := s.root
	for _, seg := range strings.Split(filepath.ToSlash(inside), "/") {
		if seg == "." || seg == "" {
			continue
		}
		cur = filepath.Join(cur, seg)
		info, err := os.Lstat(cur)
		if errors.Is(err, fs.ErrNotExist) {
			break
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return "", ErrPathDenied
		}
	}
	return full, nil
}

// Sniff returns the content type of data and whether the store accepts it.
func Sniff(data []byte) (string, bool) {
	mime := http.DetectContentType(data)
	if i := strings.IndexByte(mime, ';'); i >= 0 {
		mime = mime[:i]
	}
	return mime, AllowedTypes[mime]
}

// Put stores data at rel. declared, when not empty, must agree with the sniffed
// type. An existing file at rel is replaced atomically.
func (s *Store) Put(rel string, data []byte, declared string) (Entry, error) {
	rel, err := clean(rel, false)
	if err != nil {
		return Entry{}, err
	}
	mime, ok := Sniff(data)
	if !ok || (declared != "" && !strings.EqualFold(strings.TrimSpace(declared), mime)) {
		return Entry{}, ErrTypeDenied
	}
	if int64(len(data)) > s.limits.MaxFileBytes {
		return Entry{}, ErrTooLarge
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	full, err := s.resolve(rel)
	if err != nil {
		return Entry{}, err
	}
	used, err := s.usage()
	if err != nil {
		return Entry{}, err
	}
	if info, err := os.Stat(full); err == nil && info.Mode().IsRegular() {
		used -= info.Size()
	}
	if used+int64(len(data)) > s.limits.MaxTotalBytes {
		return Entry{}, ErrTooLarge
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
		return Entry{}, err
	}
	if err := writeAtomic(full, data); err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return Entry{}, err
	}
	return Entry{Path: rel, Size: info.Size(), Mime: mime, Modified: info.ModTime().UTC()}, nil
}

// PutChunk adds one chunk to an upload of rel whose full size is total, and
// stores the file when the last byte arrives. Chunks arrive in order: offset
// must equal the bytes already staged (offset 0 restarts the upload). It returns
// how many bytes are staged and, once done, the stored entry. The type and size
// rules of Put apply to the whole file.
func (s *Store) PutChunk(rel string, offset, total int64, data []byte, declared string) (Entry, int64, bool, error) {
	rel, err := clean(rel, false)
	if err != nil {
		return Entry{}, 0, false, err
	}
	if total <= 0 || total > s.limits.MaxFileBytes {
		return Entry{}, 0, false, ErrTooLarge
	}
	if len(data) > MaxChunkBytes {
		return Entry{}, 0, false, fmt.Errorf("%w: chunk over %d bytes", ErrTooLarge, MaxChunkBytes)
	}
	if len(data) == 0 || offset < 0 || offset+int64(len(data)) > total {
		return Entry{}, 0, false, fmt.Errorf("%w: chunk %d+%d of %d", ErrOutOfOrder, offset, len(data), total)
	}
	s.mu.Lock()
	staging := filepath.Join(s.root, stagingDir)
	if err := os.MkdirAll(staging, 0o700); err != nil {
		s.mu.Unlock()
		return Entry{}, 0, false, err
	}
	s.sweepStaging(staging)
	part := filepath.Join(staging, stagingName(rel, total))
	var have int64
	if info, err := os.Stat(part); err == nil {
		have = info.Size()
	}
	if offset == 0 {
		have = 0
	}
	if offset != have {
		s.mu.Unlock()
		return Entry{}, have, false, fmt.Errorf("%w: have %d, got offset %d", ErrOutOfOrder, have, offset)
	}
	flags := os.O_WRONLY | os.O_CREATE | os.O_APPEND
	if offset == 0 {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	f, err := os.OpenFile(part, flags, 0o600)
	if err != nil {
		s.mu.Unlock()
		return Entry{}, have, false, err
	}
	_, werr := f.Write(data)
	cerr := f.Close()
	if werr != nil || cerr != nil {
		s.mu.Unlock()
		return Entry{}, have, false, errors.Join(werr, cerr)
	}
	have += int64(len(data))
	if have < total {
		s.mu.Unlock()
		return Entry{}, have, false, nil
	}
	full, err := os.ReadFile(part)
	_ = os.Remove(part)
	s.mu.Unlock()
	if err != nil {
		return Entry{}, have, false, err
	}
	entry, err := s.Put(rel, full, declared)
	return entry, have, err == nil, err
}

func stagingName(rel string, total int64) string {
	h := uint64(1469598103934665603)
	for _, b := range []byte(rel) {
		h ^= uint64(b)
		h *= 1099511628211
	}
	return fmt.Sprintf("%016x-%d.part", h, total)
}

func (s *Store) sweepStaging(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > stagingTTL {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// Get returns the bytes stored at rel and their type.
func (s *Store) Get(rel string) ([]byte, Entry, error) {
	rel, err := clean(rel, false)
	if err != nil {
		return nil, Entry{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	full, err := s.resolve(rel)
	if err != nil {
		return nil, Entry{}, err
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && !info.Mode().IsRegular()) {
		return nil, Entry{}, ErrNotFound
	}
	if err != nil {
		return nil, Entry{}, err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, Entry{}, err
	}
	mime, _ := Sniff(data)
	return data, Entry{Path: rel, Size: info.Size(), Mime: mime, Modified: info.ModTime().UTC()}, nil
}

// Delete removes the file at rel and any directories it leaves empty.
func (s *Store) Delete(rel string) error {
	rel, err := clean(rel, false)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	full, err := s.resolve(rel)
	if err != nil {
		return err
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && !info.Mode().IsRegular()) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil {
		return err
	}
	for dir := filepath.Dir(full); dir != s.root && strings.HasPrefix(dir, s.root); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			break
		}
	}
	return nil
}

// List returns the files under dir ("" = everything), sorted by path. The
// property sheet is not a file here.
func (s *Store) List(dir string) ([]Entry, error) {
	dir, err := clean(dir, true)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	base := s.root
	if dir != "" {
		if base, err = s.resolve(dir); err != nil {
			return nil, err
		}
	}
	out := []Entry{}
	err = filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if errors.Is(err, fs.ErrNotExist) && p == base {
			return fs.SkipAll
		}
		if err != nil {
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() && p != base && strings.HasPrefix(d.Name(), ".") {
			return fs.SkipDir
		}
		if d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			return nil
		}
		rel, err := filepath.Rel(s.root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == PropsFile {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		head := make([]byte, 512)
		mime := ""
		if f, err := os.Open(p); err == nil {
			n, _ := f.Read(head)
			_ = f.Close()
			mime, _ = Sniff(head[:n])
		}
		out = append(out, Entry{Path: rel, Size: info.Size(), Mime: mime, Modified: info.ModTime().UTC()})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// Usage reports the bytes the store holds, property sheet included.
func (s *Store) Usage() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usage()
}

func (s *Store) usage() (int64, error) {
	var total int64
	err := filepath.WalkDir(s.root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == stagingDir {
			return fs.SkipDir
		}
		if d.Type().IsRegular() {
			info, err := d.Info()
			if err != nil {
				return err
			}
			total += info.Size()
		}
		return nil
	})
	return total, err
}

// Props returns the property sheet ({} when none was written).
func (s *Store) Props() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.props()
}

func (s *Store) props() (map[string]any, error) {
	data, err := os.ReadFile(filepath.Join(s.root, PropsFile))
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("decode %s: %w", PropsFile, err)
	}
	return out, nil
}

// Patch applies set to the property sheet: a key with a nil value is removed,
// any other value replaces the key's value. Either every key applies or none.
// Values that name a stored file (profile.image) must point inside this node's
// data and at a file that exists.
func (s *Store) Patch(set map[string]any, base string) (map[string]any, error) {
	if len(set) == 0 {
		return nil, fmt.Errorf("%w: nothing to set", ErrInvalidProps)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, err := s.props()
	if err != nil {
		return nil, err
	}
	next := map[string]any{}
	for k, v := range cur {
		next[k] = v
	}
	for k, v := range set {
		if !propKey.MatchString(k) {
			return nil, fmt.Errorf("%w: key %q", ErrInvalidProps, k)
		}
		if v == nil {
			delete(next, k)
			continue
		}
		if k == "profile" {
			if err := s.checkProfile(v, base); err != nil {
				return nil, err
			}
		}
		next[k] = v
	}
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidProps, err)
	}
	if len(data) > maxPropsBytes {
		return nil, fmt.Errorf("%w: property sheet over %d bytes", ErrTooLarge, maxPropsBytes)
	}
	if err := writeAtomic(filepath.Join(s.root, PropsFile), append(data, '\n')); err != nil {
		return nil, err
	}
	return next, nil
}

// checkProfile: {"image": "<base>/<relative path of a stored image>"}. base is
// how the GUI names this node's data folder ("/<노드>/데이터"); the stored value
// keeps the GUI's absolute form, and must resolve to a file in this store.
func (s *Store) checkProfile(v any, base string) error {
	m, ok := v.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: profile must be an object", ErrInvalidProps)
	}
	for k := range m {
		if k != "image" {
			return fmt.Errorf("%w: profile.%s is not known", ErrInvalidProps, k)
		}
	}
	img, ok := m["image"].(string)
	if !ok || img == "" {
		return fmt.Errorf("%w: profile.image must be a path", ErrInvalidProps)
	}
	rel := img
	if base != "" {
		prefix := strings.TrimRight(base, "/") + "/"
		if !strings.HasPrefix(img, prefix) {
			return fmt.Errorf("%w: profile.image must be under %s", ErrInvalidProps, prefix)
		}
		rel = strings.TrimPrefix(img, prefix)
	}
	rel, err := clean(rel, false)
	if err != nil {
		return fmt.Errorf("%w: profile.image path", ErrInvalidProps)
	}
	full, err := s.resolve(rel)
	if err != nil {
		return err
	}
	if info, err := os.Stat(full); err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("%w: profile.image names no stored file", ErrInvalidProps)
	}
	return nil
}

func writeAtomic(full string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(full), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, full)
}

// equalJSON is used by tests and callers that want to compare sheets.
func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}
