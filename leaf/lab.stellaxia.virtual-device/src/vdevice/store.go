package vdevice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// StateSchemaVersion is the on-disk state document version (the
// `schema_migrations` row of design §19.2).
const StateSchemaVersion = 1

// StateFileName is the state document inside the module's data directory.
const StateFileName = "virtual-device-state.json"

// Design §19.2 names SQLite WAL as the store. This build writes a JSON document
// instead, with the section names taken from that table list, and the decision
// is recorded in the design's decision table. Three reasons:
//
//   - Only desired state is persisted. There is no runtime checkpoint to
//     recover (the sink and its counters live in memory and start over) and no
//     audit index (no audit sink is wired), so the transactional part of the
//     table list has no content.
//   - Every other Leaf module in this repository (lab.stellaxia.io-inventory,
//     lab.stellaxia.io-weave, lab.stellaxia.file) persists a JSON document, and a module
//     that stores a handful of slots does not earn a 4 MB SQLite driver the
//     rest of the Leaf side does not carry.
//   - The section names match §19.2, so the migration is a reader change, not
//     a redesign.
//
// SQLite arrives with the thing that needs it: a runtime checkpoint or an audit
// index, if either is ever built.
type stateDocument struct {
	SchemaVersion int `json:"schema_version"`
	// AdapterInstallations is written empty (this module installs nothing) and is present rather
	// than omitted: an empty list says "this module installed nothing", which
	// is a different statement from a missing key, which says nothing at all.
	AdapterInstallations   []AdapterInstallation   `json:"adapter_installations"`
	Slots                  []Slot                  `json:"slots"`
	ProjectionDeclarations []ProjectionDeclaration `json:"projection_declarations"`
}

// AdapterInstallation is the `adapter_installations` row of §19.2. This module
// records none — installation is Setup's, and this module has no code that
// installs anything (design principle §4.3).
type AdapterInstallation struct {
	AdapterID    string    `json:"adapter_id"`
	Version      string    `json:"version"`
	InstallState string    `json:"install_state"`
	Health       string    `json:"health"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Store persists declared desired state. Nothing here holds a token, a lease
// secret or a frame: §19.2 forbids all three, and a persistent projection gets
// a fresh handle after a restart rather than a remembered one.
type Store struct {
	mu   sync.Mutex
	path string
}

// NewStore builds a store over the given file path.
func NewStore(path string) *Store {
	return &Store{path: filepath.Clean(strings.TrimSpace(path))}
}

// State is a loaded snapshot of declared desired state.
type State struct {
	Slots       map[string]Slot
	Projections map[string]ProjectionDeclaration
}

func newState() State {
	return State{Slots: map[string]Slot{}, Projections: map[string]ProjectionDeclaration{}}
}

// Load reads the state document. A file that is not there is an empty state,
// not a failure — a module that has never been configured has nothing stored.
// A file that IS there and cannot be read is a failure, because something was
// written and is now not in effect.
func (s *Store) Load() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(s.path) == "" || s.path == "." {
		return State{}, errors.New("virtual device state path is required")
	}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), nil
	}
	if err != nil {
		return State{}, fmt.Errorf("read virtual device state: %w", err)
	}
	var document stateDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return State{}, fmt.Errorf("parse virtual device state %s: %w", s.path, err)
	}
	if document.SchemaVersion != StateSchemaVersion {
		return State{}, fmt.Errorf("unsupported virtual device state schema version %d (expected %d)",
			document.SchemaVersion, StateSchemaVersion)
	}
	state := newState()
	for _, slot := range document.Slots {
		if strings.TrimSpace(slot.SlotID) == "" {
			return State{}, errors.New("virtual device state contains a slot with no slot_id")
		}
		state.Slots[slot.SlotID] = slot
	}
	for _, declaration := range document.ProjectionDeclarations {
		if strings.TrimSpace(declaration.ProjectionID) == "" {
			return State{}, errors.New("virtual device state contains a projection with no projection_id")
		}
		state.Projections[declaration.ProjectionID] = declaration
	}
	return state, nil
}

// Save writes the state document, replacing it atomically so a crash mid-write
// leaves the previous state rather than a truncated file.
func (s *Store) Save(state State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(s.path) == "" || s.path == "." {
		return errors.New("virtual device state path is required")
	}
	document := stateDocument{
		SchemaVersion:          StateSchemaVersion,
		AdapterInstallations:   []AdapterInstallation{},
		Slots:                  make([]Slot, 0, len(state.Slots)),
		ProjectionDeclarations: make([]ProjectionDeclaration, 0, len(state.Projections)),
	}
	for _, slot := range state.Slots {
		document.Slots = append(document.Slots, slot)
	}
	for _, declaration := range state.Projections {
		document.ProjectionDeclarations = append(document.ProjectionDeclarations, declaration)
	}
	// Sorted so a rewrite that changed nothing produces the same bytes.
	sort.Slice(document.Slots, func(i, j int) bool { return document.Slots[i].SlotID < document.Slots[j].SlotID })
	sort.Slice(document.ProjectionDeclarations, func(i, j int) bool {
		return document.ProjectionDeclarations[i].ProjectionID < document.ProjectionDeclarations[j].ProjectionID
	})

	raw, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode virtual device state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create virtual device state directory: %w", err)
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return fmt.Errorf("write virtual device state: %w", err)
	}
	if err := os.Rename(temporary, s.path); err != nil {
		return fmt.Errorf("replace virtual device state: %w", err)
	}
	return nil
}

// Path is where this store writes, for diagnostics.
func (s *Store) Path() string { return s.path }
