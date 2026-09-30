package weave

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	ioweave "github.com/terra-project/terra/products/common/packages/terra-io-weave"
)

// What a node answers a remote pointer with depends on what is in front of the
// person using it: the same wheel scrolls under tmux and walks command history
// on a bare shell. That is a property of THIS node, not of the source, so it is
// configured here and not carried on the wire.
//
// It lives in the module's data directory rather than in the environment
// because the module host does not pass the environment through — it merges a
// fixed allowlist (PATH, TEMP, LANG, …) with the identity it issues, and
// anything else a module read from os.Getenv would be empty in production
// while working perfectly in a developer's shell. A setting that can only be
// changed in a test is not a setting.

const settingsSchemaVersion = 1

// InjectionMode is whether this node lets a remote pointer drive its own.
type InjectionMode string

const (
	// InjectionOff never opens an OS input device. The node still projects —
	// gestures become terminal intent — so turning injection off is not
	// turning the axis off.
	InjectionOff InjectionMode = "off"
	// InjectionAuto opens one when the platform permits it, and falls back to
	// translation with a reason when it does not.
	InjectionAuto InjectionMode = "auto"
)

// InjectionModes lists what this build accepts.
func InjectionModes() []InjectionMode { return []InjectionMode{InjectionOff, InjectionAuto} }

// Settings is the node's own half of the projection.
type Settings struct {
	// Profile is which translation profile answers a gesture.
	Profile ioweave.Profile `json:"profile"`
	// SourceLayout is the keyboard layout to assume when a source does not
	// name one. A source that names its own layout wins; this is the floor.
	SourceLayout string `json:"source_layout,omitempty"`
	// Injection is whether a remote pointer may drive this node's own.
	//
	// It is a setting rather than "whatever the platform allows" because
	// letting another machine move this one's cursor is a decision about this
	// node, and inferring it from /dev/uinput being openable would turn every
	// upgrade on a permitted node into a silent grant of exactly that.
	Injection InjectionMode `json:"injection,omitempty"`
}

// DefaultSettings is a bare shell with a US layout and injection off — the
// assumption that refuses the most and invents the least. A node that really
// is running tmux says so; a node that says nothing gets gestures declined
// with a reason rather than arrow keys walking its command history.
//
// Injection defaults off for the same reason one step further. A node that
// upgrades into this version must not start accepting another machine's
// pointer because it happened to have the udev rule: the escape path is one
// layer of D-22's five so far, the lock-screen gate can only see locks logind
// reports, and "the platform would allow it" is not the same sentence as
// "this node's operator agreed to it". Turning it on is one operation
// (settings.set) and the state says so from then on.
func DefaultSettings() Settings {
	return Settings{Profile: ioweave.ProfileShell, SourceLayout: "us", Injection: InjectionOff}
}

// Validate rejects a profile this build cannot honour. An unknown profile is
// an error rather than a fallback: silently giving shell behaviour to a node
// whose operator asked for tmux is the failure that looks like a working
// configuration.
func (s Settings) Validate() error {
	known := false
	for _, candidate := range ioweave.Profiles() {
		if s.Profile == candidate {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("unknown translation profile %q (have %v)", s.Profile, ioweave.Profiles())
	}
	// An empty injection mode is the absent field, not a third value: a
	// settings document written before this field existed must keep meaning
	// what it meant, which is the default.
	if s.Injection == "" {
		return nil
	}
	for _, candidate := range InjectionModes() {
		if s.Injection == candidate {
			return nil
		}
	}
	return fmt.Errorf("unknown injection mode %q (have %v)", s.Injection, InjectionModes())
}

type settingsDocument struct {
	SchemaVersion int      `json:"schema_version"`
	Settings      Settings `json:"settings"`
}

// SettingsStore persists the node's settings next to the module's other data.
type SettingsStore struct{ path string }

// NewSettingsStore points at a settings file. A blank path is a store that
// remembers nothing — usable, and honest about it, which is what a test or a
// node with no writable data directory needs.
func NewSettingsStore(path string) *SettingsStore {
	return &SettingsStore{path: strings.TrimSpace(path)}
}

// Load returns the stored settings, or the defaults when nothing is stored.
func (s *SettingsStore) Load() (Settings, error) {
	if s == nil || s.path == "" {
		return DefaultSettings(), nil
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read io-weave settings: %w", err)
	}
	var document settingsDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return Settings{}, fmt.Errorf("parse io-weave settings: %w", err)
	}
	if document.SchemaVersion != settingsSchemaVersion {
		return Settings{}, fmt.Errorf("unsupported io-weave settings schema version %d", document.SchemaVersion)
	}
	if err := document.Settings.Validate(); err != nil {
		return Settings{}, err
	}
	if strings.TrimSpace(document.Settings.SourceLayout) == "" {
		document.Settings.SourceLayout = DefaultSettings().SourceLayout
	}
	if document.Settings.Injection == "" {
		document.Settings.Injection = DefaultSettings().Injection
	}
	return document.Settings, nil
}

// Save writes the settings, replacing the file atomically so a crash mid-write
// leaves the previous settings rather than half of the new ones.
func (s *SettingsStore) Save(settings Settings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	if s == nil || s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create io-weave data directory: %w", err)
	}
	data, err := json.MarshalIndent(settingsDocument{SchemaVersion: settingsSchemaVersion, Settings: settings}, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".io-weave-settings-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary io-weave settings: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
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
	// os.Rename replaces an existing file on every platform this ships to
	// (Windows included, where it is MoveFileEx with REPLACE_EXISTING).
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace io-weave settings: %w", err)
	}
	return nil
}
