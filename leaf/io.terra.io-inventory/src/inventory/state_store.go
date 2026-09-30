package inventory

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// deviceStateSchemaVersion stays 1 through the addition of tombstones, and that
// is a decision rather than an oversight.
//
// The shipped reader rejects any version it does not recognise, so bumping this
// would make the previous module build refuse to start on a file this one
// wrote — and module updates roll back (module.json update.strategy). Refusing
// to start takes the whole policy surface down with it, which is the failure
// IO-10 exists to avoid, in exchange for nothing: `tombstones` is an additive
// field that an older reader ignores. What it costs instead is one-way — an
// older build that saves drops the tombstones it could not read. Losing a
// record of what was forgotten is recoverable; losing the inventory is not.
const deviceStateSchemaVersion = 1

type devicePolicy struct {
	DeviceID  string        `json:"device_id"`
	Alias     string        `json:"alias,omitempty"`
	Approval  ApprovalState `json:"approval"`
	Enabled   bool          `json:"enabled"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type deviceStateDocument struct {
	SchemaVersion int            `json:"schema_version"`
	Devices       []devicePolicy `json:"devices"`
	// Tombstones is what a person forgot, not what went missing. See the
	// Tombstone doc in registry.go for why the two are stored apart.
	Tombstones []Tombstone `json:"tombstones,omitempty"`
}

type stateStore struct {
	path string
}

func newStateStore(path string) *stateStore {
	return &stateStore{path: filepath.Clean(strings.TrimSpace(path))}
}

func (s *stateStore) load() (map[string]devicePolicy, map[string]Tombstone, error) {
	if s == nil || strings.TrimSpace(s.path) == "" || s.path == "." {
		return nil, nil, errors.New("I/O device state path is required")
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]devicePolicy{}, map[string]Tombstone{}, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read I/O device state: %w", err)
	}
	var document deviceStateDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, nil, fmt.Errorf("parse I/O device state: %w", err)
	}
	if document.SchemaVersion != deviceStateSchemaVersion {
		return nil, nil, fmt.Errorf("unsupported I/O device state schema version %d", document.SchemaVersion)
	}
	result := make(map[string]devicePolicy, len(document.Devices))
	for _, policy := range document.Devices {
		policy.DeviceID = strings.TrimSpace(policy.DeviceID)
		if policy.DeviceID == "" {
			return nil, nil, errors.New("I/O device state contains an empty device id")
		}
		if policy.Approval != ApprovalPending && policy.Approval != ApprovalApproved && policy.Approval != ApprovalDenied && policy.Approval != ApprovalQuarantined {
			return nil, nil, fmt.Errorf("I/O device %q has invalid approval state %q", policy.DeviceID, policy.Approval)
		}
		if policy.Approval == ApprovalDenied || policy.Approval == ApprovalQuarantined {
			policy.Enabled = false
		}
		result[policy.DeviceID] = policy
	}
	tombstones := make(map[string]Tombstone, len(document.Tombstones))
	for _, tombstone := range document.Tombstones {
		tombstone.DeviceID = strings.TrimSpace(tombstone.DeviceID)
		if tombstone.DeviceID == "" {
			// A tombstone with no device id records nothing. It is dropped
			// rather than refused: a record of the past must not be able to
			// stop the module from starting.
			continue
		}
		tombstones[tombstone.DeviceID] = tombstone
	}
	trimTombstones(tombstones)
	return result, tombstones, nil
}

func (s *stateStore) save(policies map[string]devicePolicy, tombstones map[string]Tombstone) error {
	if s == nil || strings.TrimSpace(s.path) == "" || s.path == "." {
		return errors.New("I/O device state path is required")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create I/O device state directory: %w", err)
	}
	document := deviceStateDocument{SchemaVersion: deviceStateSchemaVersion, Devices: make([]devicePolicy, 0, len(policies))}
	for _, policy := range policies {
		document.Devices = append(document.Devices, policy)
	}
	sort.Slice(document.Devices, func(i, j int) bool { return document.Devices[i].DeviceID < document.Devices[j].DeviceID })
	for _, tombstone := range tombstones {
		document.Tombstones = append(document.Tombstones, tombstone)
	}
	sortTombstones(document.Tombstones)
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode I/O device state: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".io-devices-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary I/O device state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := os.Rename(temporaryPath, s.path); err != nil {
			return fmt.Errorf("replace I/O device state: %w", err)
		}
		return nil
	}
	return replaceStateFileWindows(temporaryPath, s.path)
}

func replaceStateFileWindows(temporaryPath, targetPath string) error {
	backupPath := targetPath + ".bak"
	_ = os.Remove(backupPath)
	targetExists := false
	if _, err := os.Stat(targetPath); err == nil {
		targetExists = true
		if err := os.Rename(targetPath, backupPath); err != nil {
			return fmt.Errorf("backup I/O device state: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		if targetExists {
			_ = os.Rename(backupPath, targetPath)
		}
		return fmt.Errorf("replace I/O device state: %w", err)
	}
	if targetExists {
		_ = os.Remove(backupPath)
	}
	return nil
}
