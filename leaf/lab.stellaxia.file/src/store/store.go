// Package store confines this module's file operations to the shared folders
// the host granted it. Every public path is root-relative; a host absolute path
// is never accepted from a request.
//
// It is the daemon's data_plane/storage moved out of the core, with one change
// that is the reason the move was worth making: the confinement is the kernel's
// now. The core version resolved symlinks to check a path and then let the
// caller open it separately, which leaves a window — a symlink swapped between
// the check and the open escapes a check that passed. A shared folder is by
// definition a directory the person using the machine writes to, so that window
// was not theoretical. os.Root closes it: the check and the open are one
// syscall (openat2 with RESOLVE_BENEATH on Linux).
//
// The string validation below is kept anyway. It is not the confinement — the
// kernel is — it is the fast, legible failure in front of it, so a caller
// passing an absolute path is told that rather than "no such file".
package store

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
)

var (
	// ErrPathDenied is a path that would leave its shared folder.
	ErrPathDenied = errors.New("path is outside the shared folder")
	// ErrRootMissing is a shared folder name nobody registered.
	ErrRootMissing = errors.New("shared folder is not registered")
	// ErrNotFound distinguishes "there is nothing there" from "I could not
	// look" — the pair the audit of 2026-08-25 found collapsed in three layers.
	ErrNotFound = errors.New("path does not exist")
	// ErrRecursiveRequired is a directory named for removal without recursive.
	// It is its own sentinel rather than a plain error because the caller's
	// next move is specific and knowable — pass recursive — and collapsing it
	// into the generic invalid-request answer throws that away.
	ErrRecursiveRequired = errors.New("directory removal needs recursive")
	// ErrTargetExists is a path that is already taken: an exclusive write or a
	// non-recursive Mkdir that found something there. A filesystem has to be
	// able to say EEXIST, so "it was already there" cannot be folded into
	// success — mkdir would then succeed where the caller needed it to fail.
	ErrTargetExists = errors.New("path already exists")
	// ErrChecksumMismatch is a write whose bytes do not match the digest sent
	// with them. Nothing was written. This is what makes a failed write safe to
	// send again: bytes that are not the bytes the caller meant never land.
	ErrChecksumMismatch = errors.New("bytes do not match the digest sent with them")
)

// FileInfo is one entry as callers see it. Paths are slash-separated and
// root-relative regardless of host, so a Windows node and a Linux node describe
// the same tree the same way.
type FileInfo struct {
	Path    string    `json:"path"`
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"`
	ModTime time.Time `json:"modified_at"`
	IsDir   bool      `json:"is_dir"`
	// SHA256 is filled only when the caller asked for it on a stat. Listings
	// never carry it: digesting a directory's worth of files to answer "what is
	// in here" would make the cheap question expensive.
	SHA256 string `json:"sha256,omitempty"`
}

// Chunk is one slice of a file, carrying its own digest so the receiver can
// reject a corrupted piece without waiting for the whole transfer.
type Chunk struct {
	Offset int64  `json:"offset"`
	Data   []byte `json:"data"`
	SHA256 string `json:"sha256"`
	EOF    bool   `json:"eof"`
	// Size is the whole file's length. The read had to stat the file to know
	// where the end was, so reporting it costs nothing and saves the caller a
	// second round trip to ask — which on the mount path is the expensive part.
	Size int64 `json:"size"`
}

// Manager owns one confined handle per shared folder.
type Manager struct {
	mu    sync.RWMutex
	roots map[string]*root
	order []string
}

type root struct {
	name   string
	path   string
	handle *os.Root
}

// NewManager opens a confined handle for each granted shared folder.
//
// A folder that cannot be opened fails the whole call rather than being skipped:
// a module that silently serves three of four shared folders is worse than one
// that refuses to start, because the missing one looks empty instead of absent.
func NewManager(granted []modulert.SharedRoot) (*Manager, error) {
	m := &Manager{roots: make(map[string]*root, len(granted))}
	for _, entry := range modulert.NameSharedRoots(granted) {
		if _, exists := m.roots[entry.Name]; exists {
			m.Close()
			return nil, fmt.Errorf("shared folder %q is registered twice", entry.Name)
		}
		handle, err := os.OpenRoot(entry.Path)
		if err != nil {
			m.Close()
			return nil, fmt.Errorf("open shared folder %q at %s: %w", entry.Name, entry.Path, err)
		}
		m.roots[entry.Name] = &root{name: entry.Name, path: entry.Path, handle: handle}
		m.order = append(m.order, entry.Name)
	}
	return m, nil
}

// Close releases every confined handle.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var firstErr error
	for _, r := range m.roots {
		if err := r.handle.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	m.roots = map[string]*root{}
	m.order = nil
	return firstErr
}

// Roots lists the shared folders in the order they were granted.
func (m *Manager) Roots() []modulert.SharedRoot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	listed := make([]modulert.SharedRoot, 0, len(m.order))
	for _, name := range m.order {
		listed = append(listed, modulert.SharedRoot{Name: name, Path: m.roots[name].path})
	}
	return listed
}

// lookup resolves a shared folder name to its handle.
func (m *Manager) lookup(name string) (*root, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.roots[strings.TrimSpace(name)]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrRootMissing, name)
	}
	return r, nil
}

// cleanRelative is the fast failure in front of the kernel: it rejects what can
// be seen without touching the filesystem and normalizes the rest.
//
// The empty path means the root itself, which is how a caller lists the top of
// a shared folder. Everything else must be relative, must not climb, and is
// slash-separated — os.Root takes the same shape on every host.
func cleanRelative(requested string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(requested), "\\", "/")
	normalized = strings.Trim(normalized, "/")
	if normalized == "" || normalized == "." {
		return ".", nil
	}
	if strings.HasPrefix(requested, "/") || strings.Contains(requested, ":") {
		return "", fmt.Errorf("%w: absolute paths are not accepted", ErrPathDenied)
	}
	cleaned := path.Clean(normalized)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("%w: the path climbs out of the shared folder", ErrPathDenied)
	}
	for _, segment := range strings.Split(cleaned, "/") {
		if segment == ".." {
			return "", fmt.Errorf("%w: the path climbs out of the shared folder", ErrPathDenied)
		}
	}
	return cleaned, nil
}

// translate maps a filesystem error onto this package's vocabulary. A path the
// kernel refused because it left the root is denied, not missing: telling a
// caller "no such file" about a traversal attempt hides what happened.
func translate(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, os.ErrNotExist):
		return fmt.Errorf("%w", ErrNotFound)
	case errors.Is(err, os.ErrPermission):
		return fmt.Errorf("%w: %v", ErrPathDenied, err)
	default:
		// os.Root reports an escape as a plain path error; there is no sentinel
		// to match, so anything left that mentions the boundary is denied.
		if strings.Contains(err.Error(), "outside") || strings.Contains(err.Error(), "escapes") {
			return fmt.Errorf("%w: %v", ErrPathDenied, err)
		}
		return err
	}
}

func info(relative string, entry os.FileInfo) FileInfo {
	return FileInfo{
		Path:    relative,
		Name:    entry.Name(),
		Size:    entry.Size(),
		Mode:    entry.Mode().String(),
		ModTime: entry.ModTime().UTC(),
		IsDir:   entry.IsDir(),
	}
}

// List reads one directory. An empty result and a missing directory are
// different answers: the first is a directory with nothing in it, the second is
// ErrNotFound.
func (m *Manager) List(rootName, requested string) ([]FileInfo, error) {
	r, err := m.lookup(rootName)
	if err != nil {
		return nil, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return nil, err
	}
	handle, err := r.handle.Open(cleaned)
	if err != nil {
		return nil, translate(err)
	}
	defer handle.Close()
	stat, err := handle.Stat()
	if err != nil {
		return nil, translate(err)
	}
	if !stat.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", cleaned)
	}
	entries, err := handle.ReadDir(-1)
	if err != nil {
		return nil, translate(err)
	}
	listed := make([]FileInfo, 0, len(entries))
	for _, entry := range entries {
		stat, err := entry.Info()
		if err != nil {
			// A file removed between the read and the stat is not an error for
			// the listing — it is simply not there any more.
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, translate(err)
		}
		listed = append(listed, info(joinRelative(cleaned, entry.Name()), stat))
	}
	sort.Slice(listed, func(i, j int) bool { return listed[i].Path < listed[j].Path })
	return listed, nil
}

func joinRelative(dir, name string) string {
	if dir == "." {
		return name
	}
	return dir + "/" + name
}

// Stat describes one entry. It does not follow a symlink out of the root — the
// handle refuses that before this returns.
func (m *Manager) Stat(rootName, requested string) (FileInfo, error) {
	r, err := m.lookup(rootName)
	if err != nil {
		return FileInfo{}, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return FileInfo{}, err
	}
	stat, err := r.handle.Stat(cleaned)
	if err != nil {
		return FileInfo{}, translate(err)
	}
	return info(cleaned, stat), nil
}

// Remove deletes one entry. Emptying a shared folder is refused outright: that
// is not something a path argument should be able to ask for by accident.
//
// Without recursive, a directory is removed only if it is already empty, and a
// directory with anything in it is ErrRecursiveRequired. That is rmdir(2), and
// it is the reason the check is the kernel's rather than a stat beforehand: a
// mount has to be able to rmdir an empty directory, and an earlier version
// refused every directory on sight, which made "remove this empty folder"
// impossible to express.
func (m *Manager) Remove(rootName, requested string, recursive bool) error {
	r, err := m.lookup(rootName)
	if err != nil {
		return err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return err
	}
	if cleaned == "." {
		return fmt.Errorf("%w: the shared folder itself cannot be removed", ErrPathDenied)
	}
	stat, err := r.handle.Stat(cleaned)
	if err != nil {
		return translate(err)
	}
	if stat.IsDir() && recursive {
		return m.removeTree(r, cleaned)
	}
	err = r.handle.Remove(cleaned)
	if err != nil && stat.IsDir() && isNotEmpty(err) {
		return fmt.Errorf("%w: %s has entries in it", ErrRecursiveRequired, cleaned)
	}
	return translate(err)
}

// isNotEmpty recognises the kernel refusing to remove a directory with entries
// in it. Linux says ENOTEMPTY, and some hosts say EEXIST for the same thing;
// both mean the same next move, so both are named here rather than left to fall
// through as an unexplained failure.
func isNotEmpty(err error) bool {
	return errors.Is(err, syscall.ENOTEMPTY) || errors.Is(err, syscall.EEXIST) ||
		errors.Is(err, os.ErrExist)
}

// removeTree walks a directory depth-first through the confined handle. It is
// written out rather than reaching for os.RemoveAll because RemoveAll takes a
// host path, which is exactly the escape this package exists to prevent.
func (m *Manager) removeTree(r *root, cleaned string) error {
	handle, err := r.handle.Open(cleaned)
	if err != nil {
		return translate(err)
	}
	entries, readErr := handle.ReadDir(-1)
	handle.Close()
	if readErr != nil {
		return translate(readErr)
	}
	for _, entry := range entries {
		child := joinRelative(cleaned, entry.Name())
		if entry.IsDir() {
			if err := m.removeTree(r, child); err != nil {
				return err
			}
			continue
		}
		if err := r.handle.Remove(child); err != nil {
			return translate(err)
		}
	}
	return translate(r.handle.Remove(cleaned))
}

// ReadChunk reads one slice, digest attached. An offset at end-of-file returns
// an empty chunk with EOF set rather than an error, so a caller that asked for
// the piece after the last one is told the transfer is done.
func (m *Manager) ReadChunk(rootName, requested string, offset int64, size int) (Chunk, error) {
	if offset < 0 || size <= 0 {
		return Chunk{}, fmt.Errorf("chunk offset must be zero or more and size must be positive")
	}
	r, err := m.lookup(rootName)
	if err != nil {
		return Chunk{}, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return Chunk{}, err
	}
	handle, err := r.handle.Open(cleaned)
	if err != nil {
		return Chunk{}, translate(err)
	}
	defer handle.Close()
	stat, err := handle.Stat()
	if err != nil {
		return Chunk{}, translate(err)
	}
	if stat.IsDir() {
		return Chunk{}, fmt.Errorf("%s is a directory", cleaned)
	}
	if offset > stat.Size() {
		return Chunk{}, fmt.Errorf("chunk offset %d is past the end of a %d byte file", offset, stat.Size())
	}
	buffer := make([]byte, size)
	read, err := handle.ReadAt(buffer, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return Chunk{}, translate(err)
	}
	buffer = buffer[:read]
	return Chunk{
		Offset: offset, Data: buffer, SHA256: Checksum(buffer),
		EOF:  offset+int64(read) >= stat.Size(),
		Size: stat.Size(),
	}, nil
}

// WriteChunk places one slice at its offset, creating the file and any parent
// directories inside the shared folder.
func (m *Manager) WriteChunk(rootName, requested string, chunk Chunk) error {
	if chunk.Offset < 0 {
		return fmt.Errorf("chunk offset must be zero or more")
	}
	r, err := m.lookup(rootName)
	if err != nil {
		return err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return err
	}
	if cleaned == "." {
		return fmt.Errorf("%w: the shared folder itself is not a file", ErrPathDenied)
	}
	if err := m.mkdirAll(r, path.Dir(cleaned)); err != nil {
		return err
	}
	handle, err := r.handle.OpenFile(cleaned, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return translate(err)
	}
	defer handle.Close()
	if _, err := handle.WriteAt(chunk.Data, chunk.Offset); err != nil {
		return translate(err)
	}
	return handle.Sync()
}

// mkdirAll creates a directory chain one confined Mkdir at a time. os.MkdirAll
// takes a host path and would step outside the handle.
func (m *Manager) mkdirAll(r *root, cleaned string) error {
	if cleaned == "." || cleaned == "" {
		return nil
	}
	if parent := path.Dir(cleaned); parent != cleaned {
		if err := m.mkdirAll(r, parent); err != nil {
			return err
		}
	}
	if err := r.handle.Mkdir(cleaned, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return translate(err)
	}
	return nil
}

// Checksum is the digest both transfer layers agree on: the chunk carries it,
// and the whole file is compared against it when a transfer completes.
func Checksum(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// ChecksumFile digests a whole file inside a shared folder.
func (m *Manager) ChecksumFile(rootName, requested string) (string, error) {
	r, err := m.lookup(rootName)
	if err != nil {
		return "", err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return "", err
	}
	handle, err := r.handle.Open(cleaned)
	if err != nil {
		return "", translate(err)
	}
	defer handle.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, handle); err != nil {
		return "", translate(err)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// WriteAt places bytes at an offset in one file, creating it if it is not there,
// and reports what the file looks like afterwards.
//
// It does NOT create the parent directories. WriteChunk does, because a transfer
// names its destination once and the caller has no other chance to prepare it.
// This is the mount's write, and open(O_CREAT) against a path whose parent is
// missing is ENOENT on every filesystem there is — a caller that wants the
// parents made asks for them, which is what Mkdir is for.
//
// digest is optional, and when it is present the bytes are checked against it
// BEFORE the file is opened, so a body that arrived damaged leaves nothing
// behind. That check is the whole reason a failed write may be sent again: the
// same bytes at the same offset land the same way twice, and bytes that are not
// those bytes never land at all.
//
// The write is in place, so the range being written is not atomic. That is the
// promise a local filesystem makes too; a caller that needs an atomic
// replacement writes a temporary file and calls Rename — which is also what it
// would do on a local disk.
//
// Returning the FileInfo rather than nothing is deliberate. The write had to
// hold the handle open anyway, so the fstat that follows it is free, and it
// spares the caller the round trip it would otherwise make to ask how big the
// file is now. On the mount path that round trip is the expensive part.
func (m *Manager) WriteAt(rootName, requested string, offset int64, data []byte, digest string, exclusive bool) (FileInfo, error) {
	if offset < 0 {
		return FileInfo{}, fmt.Errorf("write offset must be zero or more")
	}
	if digest != "" {
		if computed := Checksum(data); computed != digest {
			return FileInfo{}, fmt.Errorf("%w: sent %s, computed %s", ErrChecksumMismatch, digest, computed)
		}
	}
	r, err := m.lookup(rootName)
	if err != nil {
		return FileInfo{}, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return FileInfo{}, err
	}
	if cleaned == "." {
		return FileInfo{}, fmt.Errorf("%w: the shared folder itself is not a file", ErrPathDenied)
	}
	flags := os.O_CREATE | os.O_WRONLY
	if exclusive {
		flags |= os.O_EXCL
	}
	handle, err := r.handle.OpenFile(cleaned, flags, 0o600)
	if err != nil {
		// O_EXCL against an existing path is the answer the caller asked for,
		// not a failure to open: it has to arrive as EEXIST, not as EIO.
		if errors.Is(err, os.ErrExist) {
			return FileInfo{}, fmt.Errorf("%w: %s", ErrTargetExists, cleaned)
		}
		return FileInfo{}, translate(err)
	}
	defer handle.Close()
	if len(data) > 0 {
		if _, err := handle.WriteAt(data, offset); err != nil {
			return FileInfo{}, translate(err)
		}
		if err := handle.Sync(); err != nil {
			return FileInfo{}, translate(err)
		}
	}
	stat, err := handle.Stat()
	if err != nil {
		return FileInfo{}, translate(err)
	}
	return info(cleaned, stat), nil
}

// Truncate sets one file's length, cutting the tail off or filling the gap with
// zeroes. It does not create a missing file, because truncate(2) does not.
//
// os.Root has no Truncate, so this opens the path through the confined handle
// and truncates the *file*. The confinement is not weakened by that: the kernel
// already resolved the path under the root when it produced this descriptor, and
// the descriptor cannot be re-pointed at something else afterwards.
func (m *Manager) Truncate(rootName, requested string, size int64) (FileInfo, error) {
	if size < 0 {
		return FileInfo{}, fmt.Errorf("size must be zero or more")
	}
	r, err := m.lookup(rootName)
	if err != nil {
		return FileInfo{}, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return FileInfo{}, err
	}
	if cleaned == "." {
		return FileInfo{}, fmt.Errorf("%w: the shared folder itself is not a file", ErrPathDenied)
	}
	handle, err := r.handle.OpenFile(cleaned, os.O_WRONLY, 0)
	if err != nil {
		return FileInfo{}, translate(err)
	}
	defer handle.Close()
	if stat, err := handle.Stat(); err != nil {
		return FileInfo{}, translate(err)
	} else if stat.IsDir() {
		return FileInfo{}, fmt.Errorf("%s is a directory", cleaned)
	}
	if err := handle.Truncate(size); err != nil {
		return FileInfo{}, translate(err)
	}
	if err := handle.Sync(); err != nil {
		return FileInfo{}, translate(err)
	}
	stat, err := handle.Stat()
	if err != nil {
		return FileInfo{}, translate(err)
	}
	return info(cleaned, stat), nil
}

// Mkdir creates one directory, or with parents the whole chain leading to it.
//
// Without parents an existing path is ErrTargetExists rather than success,
// because that is the difference between mkdir and mkdir -p and a filesystem
// mount has to be able to report both. With parents an existing directory is
// success and created comes back false, so a caller can still tell which
// happened.
func (m *Manager) Mkdir(rootName, requested string, parents bool) (created bool, err error) {
	r, err := m.lookup(rootName)
	if err != nil {
		return false, err
	}
	cleaned, err := cleanRelative(requested)
	if err != nil {
		return false, err
	}
	if cleaned == "." {
		return false, fmt.Errorf("%w: the shared folder itself already exists", ErrTargetExists)
	}
	if parents {
		if stat, err := r.handle.Stat(cleaned); err == nil && stat.IsDir() {
			return false, nil
		}
		if err := m.mkdirAll(r, cleaned); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := r.handle.Mkdir(cleaned, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return false, fmt.Errorf("%w: %s", ErrTargetExists, cleaned)
		}
		return false, translate(err)
	}
	return true, nil
}

// Rename moves one entry to another path inside the SAME shared folder.
//
// Both ends are judged by the confined handle in one renameat, so a destination
// that climbs out, or whose parent is a symlink pointing out, is refused by the
// kernel rather than by a string check that a swapped symlink could outrun.
//
// There is no cross-root form. Confinement is per shared folder — one os.Root
// each — and there is no rename that spans two of them; a caller that wants to
// move between shared folders reads, writes and removes. The mount answers that
// case as EXDEV without asking the node at all, which is exactly what makes mv
// fall back to copying.
//
// This operation is why WriteAt is allowed to write in place: an application
// that needs an atomic replacement writes a temporary file and renames it over
// the target, the same way it would locally.
func (m *Manager) Rename(rootName, from, to string) error {
	r, err := m.lookup(rootName)
	if err != nil {
		return err
	}
	source, err := cleanRelative(from)
	if err != nil {
		return err
	}
	target, err := cleanRelative(to)
	if err != nil {
		return err
	}
	if source == "." || target == "." {
		return fmt.Errorf("%w: the shared folder itself cannot be renamed", ErrPathDenied)
	}
	return translate(r.handle.Rename(source, target))
}
