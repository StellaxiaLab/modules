package manual

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
)

// ErrInvalid is a registration whose shape is wrong — the request, not the
// device.
var ErrInvalid = errors.New("invalid manual device registration")

// ErrExists is a registration of a device that is already registered. The same
// adapter and address are the same device, so registering it twice would only
// put a second entry where the first one's approval already lives.
var ErrExists = errors.New("manual device is already registered")

// sourceSchemaVersion versions manual-devices.json. It is a file of its own,
// not a field in devices.json, so an older build that rolls back (module.json
// update.strategy) reads the policy file it knows and never sees this one.
const sourceSchemaVersion = 1

// The limits are the Daemon's (terra.daemon.io.devices.post). The module checks
// them again because the Gateway route reaches it without the Daemon in front.
const (
	maxKindLength       = 64
	maxNameLength       = 128
	maxAliasLength      = 128
	maxAdapterIDLength  = 128
	maxAddressLength    = 2048
	maxCapabilities     = 32
	maxCapabilityLength = 64
)

var (
	kindPattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)
	adapterIDPattern  = regexp.MustCompile(`^manual\.[a-z0-9][a-z0-9._-]*$`)
	capabilityPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]*$`)
)

// Request is a registration as a person sends it.
type Request struct {
	Kind         string   `json:"kind"`
	Name         string   `json:"name"`
	AdapterID    string   `json:"adapter_id"`
	Address      string   `json:"address"`
	Capabilities []string `json:"capabilities,omitempty"`
	Alias        string   `json:"alias,omitempty"`
}

// Entry is one hand-registered device as the source keeps it.
type Entry struct {
	DeviceID     string               `json:"device_id"`
	Kind         inventory.DeviceKind `json:"kind"`
	Name         string               `json:"name"`
	AdapterID    string               `json:"adapter_id"`
	Address      string               `json:"address"`
	Capabilities []string             `json:"capabilities"`
	AddedAt      time.Time            `json:"added_at"`
}

// Device is the entry in the inventory's shape — what a scan hands to
// Registry.Sync. PermissionRequired is what makes it arrive pending: a camera
// carries pictures of a room, and no one approved it by typing its address.
func (e Entry) Device() inventory.Device {
	return inventory.Device{
		ID:                 e.DeviceID,
		Name:               e.Name,
		Kind:               e.Kind,
		AdapterID:          e.AdapterID,
		Capabilities:       append([]string(nil), e.Capabilities...),
		PermissionRequired: true,
	}
}

// URL parses the stored address. It was parsed once on the way in, so a
// failure here means the file was edited by hand.
func (e Entry) URL() (*url.URL, error) {
	return url.Parse(e.Address)
}

// Public is the entry as an answer may show it: the password is not part of it.
func (e Entry) Public() Entry {
	if parsed, err := e.URL(); err == nil {
		e.Address = Redact(parsed)
	} else {
		e.Address = ""
	}
	e.Capabilities = append([]string(nil), e.Capabilities...)
	return e
}

// Admit checks a registration and turns it into an entry, or says why not.
// Shape errors wrap ErrInvalid; a kind or capability no adapter here can open
// wraps ErrAdapterUnavailable.
func (a Adapters) Admit(request Request, now time.Time) (Entry, Adapter, error) {
	kind := strings.TrimSpace(request.Kind)
	name := strings.TrimSpace(request.Name)
	adapterID := strings.TrimSpace(request.AdapterID)
	address := strings.TrimSpace(request.Address)
	alias := strings.TrimSpace(request.Alias)
	invalid := func(format string, args ...any) (Entry, Adapter, error) {
		return Entry{}, nil, fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
	}
	switch {
	case kind == "":
		return invalid("kind is required")
	case len(kind) > maxKindLength || !kindPattern.MatchString(kind):
		return invalid("kind must be lowercase letters, digits, '-' or '_' (at most %d)", maxKindLength)
	case name == "":
		return invalid("name is required")
	case len(name) > maxNameLength || hasControl(name):
		return invalid("name must be at most %d bytes without control characters", maxNameLength)
	case adapterID == "":
		return invalid("adapter_id is required")
	case !strings.HasPrefix(adapterID, AdapterPrefix):
		return invalid(`adapter_id must start with "manual." — enumerated adapters cannot be registered by hand`)
	case len(adapterID) > maxAdapterIDLength || !adapterIDPattern.MatchString(adapterID):
		return invalid("adapter_id must be manual.<protocol> in lowercase letters, digits, '.', '-' or '_' (at most %d)", maxAdapterIDLength)
	case address == "":
		return invalid("address is required")
	case len(address) > maxAddressLength || hasControl(address):
		return invalid("address must be at most %d bytes without control characters", maxAddressLength)
	case len(alias) > maxAliasLength || hasControl(alias):
		return invalid("alias must be at most %d bytes without control characters", maxAliasLength)
	case len(request.Capabilities) > maxCapabilities:
		return invalid("capabilities may list at most %d entries", maxCapabilities)
	}
	capabilities := make([]string, 0, len(request.Capabilities))
	seen := map[string]bool{}
	for _, raw := range request.Capabilities {
		capability := strings.TrimSpace(raw)
		if capability == "" || len(capability) > maxCapabilityLength || !capabilityPattern.MatchString(capability) {
			return invalid("each capability must be lowercase letters, digits, '.', ':', '-' or '_' (at most %d)", maxCapabilityLength)
		}
		if !seen[capability] {
			seen[capability] = true
			capabilities = append(capabilities, capability)
		}
	}

	adapter, err := a.For(adapterID, inventory.DeviceKind(kind))
	if err != nil {
		return Entry{}, nil, err
	}
	parsed, err := url.Parse(address)
	if err != nil || parsed.Scheme == "" {
		return invalid("address must be a URL the adapter can open")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if err := adapter.CheckAddress(parsed); err != nil {
		return invalid("%v", err)
	}

	offered := map[string]bool{}
	for _, capability := range adapter.Capabilities() {
		offered[capability] = true
	}
	var beyond []string
	for _, capability := range capabilities {
		if !offered[capability] {
			beyond = append(beyond, capability)
		}
	}
	if len(beyond) > 0 {
		return Entry{}, nil, fmt.Errorf("%w: %s provides %s, not %s", ErrAdapterUnavailable, adapter.ID(), strings.Join(adapter.Capabilities(), ", "), strings.Join(beyond, ", "))
	}
	if len(capabilities) == 0 {
		capabilities = append(capabilities, adapter.Capabilities()...)
	}
	sortStrings(capabilities)

	return Entry{
		DeviceID:     deviceID(adapter, parsed),
		Kind:         adapter.Kind(),
		Name:         name,
		AdapterID:    adapter.ID(),
		Address:      parsed.String(),
		Capabilities: capabilities,
		AddedAt:      now.UTC(),
	}, adapter, nil
}

// deviceID derives the id from what the device is — which adapter opens it at
// which address — so the same camera registered again is recognised as the
// same camera. The password is not part of it: changing a camera's credentials
// does not make it a different camera.
//
// The kind leads, like the enumerated ids, and "manual" says which door the
// device came through to anyone reading a list.
func deviceID(adapter Adapter, address *url.URL) string {
	identity := *address
	identity.User = nil
	identity.Host = strings.ToLower(identity.Host)
	sum := sha256.Sum256([]byte(adapter.ID() + "\n" + identity.String()))
	return string(adapter.Kind()) + "-manual-" + hex.EncodeToString(sum[:])[:12]
}

func hasControl(value string) bool {
	return strings.IndexFunc(value, unicode.IsControl) >= 0
}

func sortStrings(values []string) { sort.Strings(values) }

// Source keeps the hand-registered devices on disk. It holds no presence and no
// policy — presence is what the next scan finds, and policy is the registry's
// like any device's. What it holds is the one thing no enumerator can rebuild
// after a restart: that the device exists at all.
type Source struct {
	mu      sync.Mutex
	path    string
	entries map[string]Entry
}

type sourceDocument struct {
	SchemaVersion int     `json:"schema_version"`
	Devices       []Entry `json:"devices"`
}

// NewMemorySource is a source that keeps nothing across restarts, for tests.
func NewMemorySource() *Source {
	return &Source{entries: map[string]Entry{}}
}

// OpenSource restores the source at path. A missing file is an empty source.
func OpenSource(path string) (*Source, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return nil, errors.New("manual device source path is required")
	}
	source := &Source{path: path, entries: map[string]Entry{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return source, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read manual device source: %w", err)
	}
	var document sourceDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse manual device source: %w", err)
	}
	if document.SchemaVersion != sourceSchemaVersion {
		return nil, fmt.Errorf("unsupported manual device source schema version %d", document.SchemaVersion)
	}
	for _, entry := range document.Devices {
		entry.DeviceID = strings.TrimSpace(entry.DeviceID)
		if entry.DeviceID == "" || entry.Kind == "" || entry.AdapterID == "" {
			return nil, errors.New("manual device source contains an entry without id, kind or adapter")
		}
		source.entries[entry.DeviceID] = entry
	}
	return source, nil
}

// Add writes an entry down. Nothing is added unless it is on disk.
func (s *Source) Add(entry Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, taken := s.entries[entry.DeviceID]; taken {
		return fmt.Errorf("%w: %s", ErrExists, entry.DeviceID)
	}
	s.entries[entry.DeviceID] = entry
	if err := s.saveLocked(); err != nil {
		delete(s.entries, entry.DeviceID)
		return err
	}
	return nil
}

// Remove takes an entry out and returns what it was, so a caller whose next
// step fails can put it back. Removing an id that is not here is not an error:
// most devices were never in this source.
func (s *Source) Remove(id string) (Entry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	if !ok {
		return Entry{}, false, nil
	}
	delete(s.entries, id)
	if err := s.saveLocked(); err != nil {
		s.entries[id] = entry
		return Entry{}, false, err
	}
	return entry, true, nil
}

// Restore puts back an entry Remove took out.
func (s *Source) Restore(entry Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[entry.DeviceID] = entry
	return s.saveLocked()
}

// Get returns one entry.
func (s *Source) Get(id string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[id]
	return entry, ok
}

// Entries lists every entry, ordered by id.
func (s *Source) Entries() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]Entry, 0, len(s.entries))
	for _, entry := range s.entries {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DeviceID < result[j].DeviceID })
	return result
}

func (s *Source) saveLocked() error {
	if s.path == "" {
		return nil
	}
	document := sourceDocument{SchemaVersion: sourceSchemaVersion, Devices: make([]Entry, 0, len(s.entries))}
	for _, entry := range s.entries {
		document.Devices = append(document.Devices, entry)
	}
	sort.Slice(document.Devices, func(i, j int) bool { return document.Devices[i].DeviceID < document.Devices[j].DeviceID })
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode manual device source: %w", err)
	}
	if err := inventory.WriteFileAtomic(s.path, append(data, '\n')); err != nil {
		return fmt.Errorf("%w: manual device source: %v", inventory.ErrStatePersistence, err)
	}
	return nil
}
