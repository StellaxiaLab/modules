// Package transfer owns one file transfer's life: what was agreed at prepare,
// how far the bytes have got, and whether what arrived is what was promised.
//
// The state lives in the module's own data directory, never in the shared
// folder. A transfer record is neither the user's data nor part of the
// installed payload — it belongs to this module, the same way
// io.terra.io-inventory keeps its device policy out of the folders it reports
// on. It also means a checkpoint survives a restart while a half-written file
// stays where it was, which is what makes resuming possible at all.
package transfer

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.file/store"
)

var (
	// ErrNotFound is a transfer id nobody prepared, or one already cleaned up.
	ErrNotFound = errors.New("transfer does not exist")
	// ErrExpired is a transfer whose window closed. The checkpoint survives —
	// expiry is not a reason to make someone start a 1 GB upload again.
	ErrExpired = errors.New("transfer has expired")
	// ErrChunkMismatch is a chunk whose digest does not match its bytes.
	ErrChunkMismatch = errors.New("chunk digest does not match its bytes")
	// ErrOutOfOrder is a chunk that does not continue from where the last one
	// ended. The offset the sender should resume from travels with it.
	ErrOutOfOrder = errors.New("chunk does not continue the transfer")
	// ErrChecksumMismatch is a completed file that is not what prepare promised.
	ErrChecksumMismatch = errors.New("the file does not match the checksum agreed at prepare")
	// ErrWrongState is an operation the transfer's state does not allow.
	ErrWrongState = errors.New("the transfer is not in a state that allows this")
	// ErrTargetExists is create mode meeting a file that is already there.
	ErrTargetExists = errors.New("the target already exists")
	// ErrTooLarge is a transfer above the configured ceiling.
	ErrTooLarge = errors.New("the transfer is larger than this node accepts")
)

// Direction says who sends the bytes.
type Direction string

const (
	// Push writes into the shared folder: the caller sends chunks.
	Push Direction = "push"
	// Pull reads out of it: the caller asks for chunks.
	Pull Direction = "pull"
)

// State is where a transfer is. The vocabulary is the design's, and the two
// terminal states differ in what they leave behind: completed clears the
// checkpoint, aborted usually clears the partial file too.
type State string

const (
	Prepared     State = "prepared"
	Transferring State = "transferring"
	Verifying    State = "verifying"
	Completed    State = "completed"
	Aborted      State = "aborted"
)

// Mode decides what a push does about a file that is already there.
type Mode string

const (
	// Create refuses to overwrite. It is the default because silently replacing
	// someone's file is not a thing a transfer should do by omission.
	Create Mode = "create"
	// Overwrite replaces it.
	Overwrite Mode = "overwrite"
)

// Record is one transfer as it is stored and reported.
type Record struct {
	ID        string    `json:"transfer_id"`
	Direction Direction `json:"direction"`
	Root      string    `json:"root"`
	Path      string    `json:"path"`
	SizeBytes int64     `json:"size_bytes"`
	Checksum  string    `json:"checksum_sha256"`
	Mode      Mode      `json:"mode"`
	ChunkSize int       `json:"chunk_size"`
	// Offset is how far the bytes have got: the next byte a push should send,
	// and the high-water mark a pull has served.
	Offset    int64     `json:"offset"`
	State     State     `json:"state"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	ExpiresAt time.Time `json:"expires_at"`
	// Reason explains an aborted transfer. Empty otherwise.
	Reason string `json:"reason,omitempty"`
}

// Options configure a Manager.
type Options struct {
	// StateDir is the module's own data directory.
	StateDir string
	// Store opens the shared folders.
	Store *store.Manager
	// ChunkSize is what prepare tells callers to use.
	ChunkSize int
	// MaxBytes refuses anything larger at prepare. Zero means no ceiling.
	MaxBytes int64
	// TTL is how long a prepared transfer stays usable.
	TTL time.Duration
	// Now is injectable so a test can move the clock instead of sleeping.
	Now func() time.Time
}

// Manager owns the transfer records.
type Manager struct {
	mu      sync.Mutex
	dir     string
	store   *store.Manager
	chunk   int
	maxByte int64
	ttl     time.Duration
	now     func() time.Time
	// sequence makes ids unique within a process without a dependency.
	sequence uint64
}

const defaultTTL = time.Hour

// NewManager prepares the transfer state directory.
func NewManager(options Options) (*Manager, error) {
	if options.Store == nil {
		return nil, errors.New("a store is required")
	}
	if options.ChunkSize <= 0 {
		return nil, errors.New("chunk size must be positive")
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	ttl := options.TTL
	if ttl <= 0 {
		ttl = defaultTTL
	}
	dir := filepath.Join(options.StateDir, "transfers")
	if options.StateDir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("create transfer state directory: %w", err)
		}
	}
	return &Manager{dir: dir, store: options.Store, chunk: options.ChunkSize,
		maxByte: options.MaxBytes, ttl: ttl, now: now}, nil
}

// ChunkSize is what callers should send.
func (m *Manager) ChunkSize() int { return m.chunk }

func (m *Manager) recordPath(id string) string {
	// filepath.Base keeps an id from addressing another directory; ids are
	// generated here, but this file is written from a request path.
	return filepath.Join(m.dir, filepath.Base(id)+".json")
}

func (m *Manager) save(record Record) error {
	if m.dir == "" {
		return nil
	}
	record.UpdatedAt = m.now()
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return os.WriteFile(m.recordPath(record.ID), append(data, '\n'), 0o600)
}

func (m *Manager) load(id string) (Record, error) {
	if strings.TrimSpace(id) == "" || m.dir == "" {
		return Record{}, ErrNotFound
	}
	data, err := os.ReadFile(m.recordPath(id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Record{}, ErrNotFound
		}
		return Record{}, err
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return Record{}, fmt.Errorf("read transfer %s: %w", id, err)
	}
	return record, nil
}

func (m *Manager) forget(id string) {
	if m.dir != "" {
		_ = os.Remove(m.recordPath(id))
	}
}

// List reports every transfer this module knows about, newest first.
//
// It exists because transfers.get needs an id, and an operator asking "what is
// running" does not have one. Without this the id has to be kept from the
// output of a command that may have scrolled away.
func (m *Manager) List() ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(m.dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	records := make([]Record, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		record, err := m.load(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			// A record that cannot be read is not a reason to refuse the whole
			// listing; it is one transfer nobody can resume.
			continue
		}
		records = append(records, record)
	}
	for i := 1; i < len(records); i++ {
		for j := i; j > 0 && records[j].CreatedAt.After(records[j-1].CreatedAt); j-- {
			records[j], records[j-1] = records[j-1], records[j]
		}
	}
	return records, nil
}

// Get answers one transfer, refusing an expired one so a caller does not build
// on a window that has closed.
func (m *Manager) Get(id string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, err := m.load(id)
	if err != nil {
		return Record{}, err
	}
	return record, m.checkLive(record)
}

// checkLive refuses an expired transfer that has not already finished.
func (m *Manager) checkLive(record Record) error {
	if record.State == Completed || record.State == Aborted {
		return nil
	}
	if !record.ExpiresAt.IsZero() && m.now().After(record.ExpiresAt) {
		return ErrExpired
	}
	return nil
}

// PrepareRequest is what a caller agrees to before any bytes move.
type PrepareRequest struct {
	Direction Direction
	Root      string
	Path      string
	SizeBytes int64
	Checksum  string
	Mode      Mode
	// ResumeID continues an earlier transfer rather than starting one.
	ResumeID string
}

// Prepare agrees the transfer and answers where to start.
//
// Everything that can be checked without moving a byte is checked here: the
// path is inside a shared folder, the size is under the ceiling, and a create
// is not about to replace a file. Finding any of that out at byte 700,000 of a
// 1 GB upload is the worst possible time to learn it.
func (m *Manager) Prepare(request PrepareRequest) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if request.Direction != Push && request.Direction != Pull {
		return Record{}, fmt.Errorf("direction must be %q or %q", Push, Pull)
	}
	if strings.TrimSpace(request.Path) == "" {
		return Record{}, errors.New("a path inside the shared folder is required")
	}
	mode := request.Mode
	if mode == "" {
		mode = Create
	}
	if mode != Create && mode != Overwrite {
		return Record{}, fmt.Errorf("mode must be %q or %q", Create, Overwrite)
	}

	if request.ResumeID != "" {
		return m.resume(request)
	}

	now := m.now()
	record := Record{
		Direction: request.Direction,
		Root:      request.Root,
		Path:      request.Path,
		SizeBytes: request.SizeBytes,
		Checksum:  strings.ToLower(strings.TrimSpace(request.Checksum)),
		Mode:      mode,
		ChunkSize: m.chunk,
		State:     Prepared,
		CreatedAt: now,
		ExpiresAt: now.Add(m.ttl),
	}

	switch request.Direction {
	case Push:
		if m.maxByte > 0 && record.SizeBytes > m.maxByte {
			return Record{}, fmt.Errorf("%w: %d bytes, ceiling is %d", ErrTooLarge, record.SizeBytes, m.maxByte)
		}
		existing, err := m.store.Stat(record.Root, record.Path)
		switch {
		case err == nil && existing.IsDir:
			return Record{}, fmt.Errorf("%s is a directory", record.Path)
		case err == nil && mode == Create:
			return Record{}, fmt.Errorf("%w: %s", ErrTargetExists, record.Path)
		case err != nil && !errors.Is(err, store.ErrNotFound):
			return Record{}, err
		}
	case Pull:
		existing, err := m.store.Stat(record.Root, record.Path)
		if err != nil {
			return Record{}, err
		}
		if existing.IsDir {
			return Record{}, fmt.Errorf("%s is a directory", record.Path)
		}
		record.SizeBytes = existing.Size
		if m.maxByte > 0 && record.SizeBytes > m.maxByte {
			return Record{}, fmt.Errorf("%w: %d bytes, ceiling is %d", ErrTooLarge, record.SizeBytes, m.maxByte)
		}
		// The digest is computed here rather than at complete so the caller can
		// compare what it received against what the file was when the transfer
		// was agreed — a file edited mid-pull should not verify.
		digest, err := m.store.ChecksumFile(record.Root, record.Path)
		if err != nil {
			return Record{}, err
		}
		record.Checksum = digest
	}

	m.sequence++
	record.ID = fmt.Sprintf("tr-%d-%d", now.UnixNano(), m.sequence)
	if err := m.save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

// resume picks up a transfer that already has a checkpoint.
//
// The path has to match. A checkpoint says "this many bytes of THAT file are
// there", and continuing it into a different file would write one file's bytes
// into another at an offset nobody chose.
func (m *Manager) resume(request PrepareRequest) (Record, error) {
	record, err := m.load(request.ResumeID)
	if err != nil {
		return Record{}, err
	}
	if record.State == Completed {
		return Record{}, fmt.Errorf("%w: transfer %s already completed", ErrWrongState, record.ID)
	}
	if record.Root != request.Root || record.Path != request.Path || record.Direction != request.Direction {
		return Record{}, fmt.Errorf("%w: transfer %s is %s %s/%s", ErrWrongState, record.ID,
			record.Direction, record.Root, record.Path)
	}
	now := m.now()
	record.State = Prepared
	record.Reason = ""
	record.ExpiresAt = now.Add(m.ttl)
	record.ChunkSize = m.chunk
	if err := m.save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

// AcceptChunk writes one chunk of a push.
//
// A chunk that does not continue from the current offset is refused with the
// offset it should have had, which is what lets a sender recover from a lost
// response without starting over. A chunk whose digest does not match its bytes
// is refused the same way: the sender resends that offset.
func (m *Manager) AcceptChunk(id string, offset int64, data []byte, digest string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, err := m.load(id)
	if err != nil {
		return Record{}, err
	}
	if err := m.checkLive(record); err != nil {
		return record, err
	}
	if record.Direction != Push {
		return record, fmt.Errorf("%w: %s is a %s transfer", ErrWrongState, id, record.Direction)
	}
	if record.State != Prepared && record.State != Transferring {
		return record, fmt.Errorf("%w: %s is %s", ErrWrongState, id, record.State)
	}
	if offset != record.Offset {
		return record, fmt.Errorf("%w: expected offset %d", ErrOutOfOrder, record.Offset)
	}
	if want := strings.ToLower(strings.TrimSpace(digest)); want != "" && want != store.Checksum(data) {
		return record, ErrChunkMismatch
	}
	if err := m.store.WriteChunk(record.Root, record.Path, store.Chunk{Offset: offset, Data: data}); err != nil {
		return record, err
	}
	record.Offset = offset + int64(len(data))
	record.State = Transferring
	if err := m.save(record); err != nil {
		return record, err
	}
	return record, nil
}

// ServeChunk reads one chunk of a pull.
func (m *Manager) ServeChunk(id string, offset int64) (Record, store.Chunk, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, err := m.load(id)
	if err != nil {
		return Record{}, store.Chunk{}, err
	}
	if err := m.checkLive(record); err != nil {
		return record, store.Chunk{}, err
	}
	if record.Direction != Pull {
		return record, store.Chunk{}, fmt.Errorf("%w: %s is a %s transfer", ErrWrongState, id, record.Direction)
	}
	chunk, err := m.store.ReadChunk(record.Root, record.Path, offset, record.ChunkSize)
	if err != nil {
		return record, store.Chunk{}, err
	}
	if end := offset + int64(len(chunk.Data)); end > record.Offset {
		record.Offset = end
	}
	record.State = Transferring
	if err := m.save(record); err != nil {
		return record, store.Chunk{}, err
	}
	return record, chunk, nil
}

// Complete verifies the transfer against what prepare agreed and closes it.
//
// A push is checked here because the module wrote the bytes and is the only
// side that can read them back. A pull was already given the source digest at
// prepare, so the caller does the comparison and says here whether it held.
func (m *Manager) Complete(id string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, err := m.load(id)
	if err != nil {
		return Record{}, err
	}
	if record.State == Completed {
		return record, nil
	}
	if record.State == Aborted {
		return record, fmt.Errorf("%w: %s was aborted", ErrWrongState, id)
	}
	record.State = Verifying
	_ = m.save(record)

	if record.Direction == Push && record.Checksum != "" {
		digest, err := m.store.ChecksumFile(record.Root, record.Path)
		if err != nil {
			return record, err
		}
		if digest != record.Checksum {
			// The partial file goes. Leaving a file that says it is a report
			// and is not is worse than leaving nothing, and the checkpoint goes
			// with it: resuming would append to bytes already known bad.
			_ = m.store.Remove(record.Root, record.Path, false)
			record.State = Aborted
			record.Reason = "checksum mismatch"
			_ = m.save(record)
			m.forget(id)
			return record, ErrChecksumMismatch
		}
	}
	record.State = Completed
	_ = m.save(record)
	m.forget(id)
	return record, nil
}

// Abort ends a transfer.
//
// deletePartial is the caller's decision because the two reasons to abort want
// opposite things: giving up on a bad file should not leave it behind, while
// stopping to resume later must keep what is already there.
func (m *Manager) Abort(id, reason string, deletePartial bool) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, err := m.load(id)
	if err != nil {
		return Record{}, err
	}
	if record.Direction == Push && deletePartial {
		_ = m.store.Remove(record.Root, record.Path, false)
	}
	record.State = Aborted
	record.Reason = strings.TrimSpace(reason)
	_ = m.save(record)
	if deletePartial {
		m.forget(id)
	}
	return record, nil
}
