// Package inventory owns the node-local inventory and policy state for I/O
// devices — the io.terra.io-inventory extension module's core, ported from the
// daemon's data_plane/io_gateway as the core-slimming pilot. Platform adapters
// remain responsible for discovery and data capture; the registry deliberately
// stays independent from operating-system APIs.
package inventory

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrGatewayDisabled   = errors.New("I/O gateway is disabled")
	ErrDeviceNotFound    = errors.New("I/O device not found")
	ErrDeviceNotApproved = errors.New("I/O device is not approved")
	ErrDeviceUnavailable = errors.New("I/O device is unavailable")
	ErrStatePersistence  = errors.New("I/O device policy persistence failed")
	// ErrDeviceNotProbeable is the refusal for asking a platform adapter to
	// re-read a device that is not its own. The module's logical provider slots
	// are the ordinary case: no enumerator can see them, so probing one could
	// only ever conclude "gone", which would be a lie about a slot that never
	// claimed to be hardware.
	ErrDeviceNotProbeable = errors.New("I/O device is not owned by a platform discovery adapter")
)

// maxTombstones caps how many forgets the state file keeps. Tombstones are a
// record of what a person did, not a blocklist, so the file must not grow
// without bound on a node where devices come and go; the oldest are dropped
// first.
const maxTombstones = 64

type DeviceKind string

const (
	DeviceCamera     DeviceKind = "camera"
	DeviceMicrophone DeviceKind = "microphone"
	DeviceScreen     DeviceKind = "screen"
	DeviceKeyboard   DeviceKind = "keyboard"
	DeviceMouse      DeviceKind = "mouse"
	DeviceRawBus     DeviceKind = "raw_bus"
)

type PresenceState string

const (
	PresenceUnknown PresenceState = "unknown"
	PresencePresent PresenceState = "present"
	PresenceMissing PresenceState = "missing"
)

type ApprovalState string

const (
	ApprovalPending     ApprovalState = "pending"
	ApprovalApproved    ApprovalState = "approved"
	ApprovalDenied      ApprovalState = "denied"
	ApprovalQuarantined ApprovalState = "quarantined"
)

type RuntimeState string

const (
	RuntimeIdle     RuntimeState = "idle"
	RuntimeOpening  RuntimeState = "opening"
	RuntimeActive   RuntimeState = "active"
	RuntimeBusy     RuntimeState = "busy"
	RuntimeDegraded RuntimeState = "degraded"
	RuntimeFailed   RuntimeState = "failed"
)

type Device struct {
	ID                 string        `json:"id"`
	Name               string        `json:"name"`
	Alias              string        `json:"alias,omitempty"`
	Kind               DeviceKind    `json:"kind"`
	AdapterID          string        `json:"adapter_id"`
	Capabilities       []string      `json:"capabilities"`
	Presence           PresenceState `json:"presence"`
	Approval           ApprovalState `json:"approval"`
	Enabled            bool          `json:"enabled"`
	RuntimeState       RuntimeState  `json:"runtime_state"`
	Available          bool          `json:"available"`
	PermissionRequired bool          `json:"permission_required"`
	FirstSeenAt        time.Time     `json:"first_seen_at,omitempty"`
	LastSeenAt         time.Time     `json:"last_seen_at,omitempty"`
	UpdatedAt          time.Time     `json:"updated_at"`
}

type Usage struct {
	DeviceID  string    `json:"device_id"`
	Sessions  int       `json:"sessions"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Tombstone records that a person deliberately forgot a device.
//
// It is the counterpart to the missing rule, not a variant of it, and the two
// answer different questions. presence=missing (IO-3) is the *device* leaving:
// the cable came out, and everything Terra knew about it — the approval, the
// alias — is kept precisely because the device is expected back. Forgetting is
// the *person* leaving: they are saying this device is not theirs to manage any
// more, so the policy goes and the entry goes with it.
//
// What stays is this record, because "no policy for that device" and "a person
// removed the policy for that device" are different facts and an operator
// reading state has to be able to tell them apart. It does not block anything:
// if the same hardware is enumerated again, the next scan registers it as a new
// device at approval=pending — default deny, the same door every device comes
// in through — and this stays as history.
type Tombstone struct {
	DeviceID    string        `json:"device_id"`
	Name        string        `json:"name,omitempty"`
	Alias       string        `json:"alias,omitempty"`
	Kind        DeviceKind    `json:"kind,omitempty"`
	AdapterID   string        `json:"adapter_id,omitempty"`
	Approval    ApprovalState `json:"approval,omitempty"`
	LastSeenAt  time.Time     `json:"last_seen_at,omitempty"`
	ForgottenAt time.Time     `json:"forgotten_at"`
}

type Registry struct {
	mu         sync.RWMutex
	devices    map[string]Device
	usage      map[string]Usage
	policies   map[string]devicePolicy
	tombstones map[string]Tombstone
	state      *stateStore
}

func NewRegistry() *Registry {
	return &Registry{devices: map[string]Device{}, usage: map[string]Usage{}, policies: map[string]devicePolicy{}, tombstones: map[string]Tombstone{}}
}

// NewPersistentRegistry restores only user-managed policy and the record of
// what a person forgot. Presence, runtime health, and active usage are
// intentionally rebuilt from live adapters.
func NewPersistentRegistry(path string) (*Registry, error) {
	store := newStateStore(path)
	policies, tombstones, err := store.load()
	if err != nil {
		return nil, err
	}
	return &Registry{devices: map[string]Device{}, usage: map[string]Usage{}, policies: policies, tombstones: tombstones, state: store}, nil
}

// AdoptPolicies re-files stored policy from an id an earlier release derived
// onto the id this one derives for the same hardware.
//
// It exists because the id derivation changed. Until persistent identity
// (discovery/identity.go) the id was a digest of the OS key, so a Linux reboot
// or a Windows re-plug renamed every device — and an approval filed under the
// old name was, from that moment, policy for a device that would never be
// enumerated again. Deriving the id better does not by itself rescue the policy
// already on disk: the first scan after the upgrade is the one moment both
// names are known at once, so it is the moment to move it.
//
// Nothing is overwritten. A new id that already carries policy keeps it, a
// legacy id whose device is somehow still registered is left alone, and the
// legacy entry is removed only when its policy has actually been adopted — so
// running this twice does nothing the second time.
func (r *Registry) AdoptPolicies(renames map[string]string) ([]string, error) {
	if r == nil || len(renames) == 0 {
		return nil, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	adopted := make([]string, 0, len(renames))
	moved := map[string]devicePolicy{}
	for currentID, legacyID := range renames {
		currentID = strings.TrimSpace(currentID)
		legacyID = strings.TrimSpace(legacyID)
		if currentID == "" || legacyID == "" || currentID == legacyID {
			continue
		}
		policy, ok := r.policies[legacyID]
		if !ok {
			continue
		}
		if _, taken := r.policies[currentID]; taken {
			continue
		}
		if _, live := r.devices[legacyID]; live {
			// Some other adapter still answers to that id. Moving its policy
			// would take it away from a device that is present.
			continue
		}
		policy.DeviceID = currentID
		moved[currentID] = policy
		adopted = append(adopted, currentID)
	}
	if len(adopted) == 0 {
		return nil, nil
	}

	previous := make(map[string]devicePolicy, len(moved)*2)
	for currentID, policy := range moved {
		legacyID := renames[currentID]
		previous[legacyID] = r.policies[legacyID]
		r.policies[currentID] = policy
		delete(r.policies, legacyID)
	}
	if r.state != nil {
		if err := r.state.save(r.policies, r.tombstones); err != nil {
			for currentID := range moved {
				delete(r.policies, currentID)
				legacyID := renames[currentID]
				r.policies[legacyID] = previous[legacyID]
			}
			return nil, fmt.Errorf("%w: %v", ErrStatePersistence, err)
		}
	}
	sort.Strings(adopted)
	return adopted, nil
}

// Forget drops a device and the policy a person set for it, leaving a
// tombstone. See the Tombstone doc for why this is not what a disappearing
// device gets.
func (r *Registry) Forget(id string) (Tombstone, error) {
	if r == nil {
		return Tombstone{}, ErrDeviceNotFound
	}
	id = strings.TrimSpace(id)
	r.mu.Lock()
	defer r.mu.Unlock()
	device, ok := r.devices[id]
	if !ok {
		return Tombstone{}, ErrDeviceNotFound
	}
	tombstone := Tombstone{
		DeviceID:    device.ID,
		Name:        device.Name,
		Alias:       device.Alias,
		Kind:        device.Kind,
		AdapterID:   device.AdapterID,
		Approval:    device.Approval,
		LastSeenAt:  device.LastSeenAt,
		ForgottenAt: time.Now().UTC(),
	}

	previousPolicy, hadPolicy := r.policies[id]
	previousTombstone, hadTombstone := r.tombstones[id]
	delete(r.policies, id)
	r.tombstones[id] = tombstone
	trimTombstones(r.tombstones)
	if r.state != nil {
		if err := r.state.save(r.policies, r.tombstones); err != nil {
			// The device is still there and still governed by its policy: a
			// forget that cannot be written down did not happen.
			if hadPolicy {
				r.policies[id] = previousPolicy
			}
			if hadTombstone {
				r.tombstones[id] = previousTombstone
			} else {
				delete(r.tombstones, id)
			}
			return Tombstone{}, fmt.Errorf("%w: %v", ErrStatePersistence, err)
		}
	}
	delete(r.devices, id)
	delete(r.usage, id)
	return tombstone, nil
}

// Tombstones lists the forgets this node remembers, newest first.
func (r *Registry) Tombstones() []Tombstone {
	if r == nil {
		return []Tombstone{}
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Tombstone, 0, len(r.tombstones))
	for _, tombstone := range r.tombstones {
		result = append(result, tombstone)
	}
	sortTombstones(result)
	return result
}

// trimTombstones keeps the newest maxTombstones records.
func trimTombstones(tombstones map[string]Tombstone) {
	if len(tombstones) <= maxTombstones {
		return
	}
	ordered := make([]Tombstone, 0, len(tombstones))
	for _, tombstone := range tombstones {
		ordered = append(ordered, tombstone)
	}
	sortTombstones(ordered)
	for _, tombstone := range ordered[maxTombstones:] {
		delete(tombstones, tombstone.DeviceID)
	}
}

// sortTombstones orders newest first, with the device id breaking ties so two
// forgets in the same instant still read the same way twice.
func sortTombstones(tombstones []Tombstone) {
	sort.Slice(tombstones, func(i, j int) bool {
		if tombstones[i].ForgottenAt.Equal(tombstones[j].ForgottenAt) {
			return tombstones[i].DeviceID < tombstones[j].DeviceID
		}
		return tombstones[i].ForgottenAt.After(tombstones[j].ForgottenAt)
	})
}

func (r *Registry) Register(device Device) error {
	device.ID = strings.TrimSpace(device.ID)
	device.Name = strings.TrimSpace(device.Name)
	device.Alias = strings.TrimSpace(device.Alias)
	if r == nil || device.ID == "" || device.Kind == "" {
		return errors.New("device id and kind are required")
	}
	if strings.ContainsAny(device.ID, `/\`) {
		return errors.New("device id must not contain path separators")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	if previous, ok := r.devices[device.ID]; ok {
		if device.Alias == "" {
			device.Alias = previous.Alias
		}
		if device.Approval == "" {
			device.Approval = previous.Approval
		}
		if !device.Enabled {
			device.Enabled = previous.Enabled
		}
		if device.FirstSeenAt.IsZero() {
			device.FirstSeenAt = previous.FirstSeenAt
		}
	}
	if policy, ok := r.policies[device.ID]; ok {
		device.Alias = policy.Alias
		device.Approval = policy.Approval
		device.Enabled = policy.Enabled
	}
	normalizeDevice(&device, now)
	r.devices[device.ID] = device
	if _, ok := r.usage[device.ID]; !ok {
		r.usage[device.ID] = Usage{DeviceID: device.ID, UpdatedAt: now}
	}
	return nil
}

// ProbeResult is what re-reading one device found.
//
// Presence is the answer an operator came for, and Changed says whether the
// probe actually moved anything — a probe that confirms is a different result
// from a probe that corrects, and reporting only the device would make the two
// look identical.
type ProbeResult struct {
	DeviceID string        `json:"device_id"`
	Adapter  string        `json:"adapter"`
	Presence PresenceState `json:"presence"`
	Changed  []string      `json:"changed"`
	Device   Device        `json:"device"`
}

// SyncResult reports what one adapter's scan changed.
type SyncResult struct {
	Adapter string   `json:"adapter"`
	Scanned int      `json:"scanned"`
	Added   []string `json:"added"`
	Updated []string `json:"updated"`
	Missing []string `json:"missing"`
}

// Sync reconciles one adapter's view of the hardware with the registry.
//
// Two rules make it safe to run on a timer. A device the scan no longer sees
// becomes missing instead of being deleted — the user's approval and alias for
// it have to outlive the cable — and only devices carrying this adapter's id are
// considered, so a scan can never mark another adapter's devices, or the
// module's logical provider slots, as gone.
//
// Devices that were already missing stay missing without being reported again:
// Missing is what *changed*, so a caller can show it as news.
func (r *Registry) Sync(adapterID string, devices []Device) (SyncResult, error) {
	adapterID = strings.TrimSpace(adapterID)
	if r == nil || adapterID == "" {
		return SyncResult{}, errors.New("adapter id is required")
	}
	result := SyncResult{Adapter: adapterID, Scanned: len(devices), Added: []string{}, Updated: []string{}, Missing: []string{}}

	present := map[string]bool{}
	for _, device := range r.List() {
		if device.AdapterID == adapterID {
			present[device.ID] = device.Presence == PresencePresent
		}
	}

	scanned := make(map[string]bool, len(devices))
	for _, device := range devices {
		// Being in a scan's list is what present means, so Sync sets it rather
		// than trusting each adapter to remember: an adapter that forgot would
		// report hardware the registry then treats as never seen.
		device.AdapterID = adapterID
		device.Presence = PresencePresent
		if err := r.Register(device); err != nil {
			return SyncResult{}, fmt.Errorf("register %s: %w", device.ID, err)
		}
		scanned[device.ID] = true
		if _, known := present[device.ID]; known {
			result.Updated = append(result.Updated, device.ID)
		} else {
			result.Added = append(result.Added, device.ID)
		}
	}

	for id, wasPresent := range present {
		if scanned[id] || !wasPresent {
			continue
		}
		if _, err := r.SetPresence(id, PresenceMissing); err != nil {
			return SyncResult{}, fmt.Errorf("mark %s missing: %w", id, err)
		}
		result.Missing = append(result.Missing, id)
	}

	sort.Strings(result.Added)
	sort.Strings(result.Updated)
	sort.Strings(result.Missing)
	return result, nil
}

func (r *Registry) List() []Device {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Device, 0, len(r.devices))
	for _, device := range r.devices {
		device.Capabilities = append([]string(nil), device.Capabilities...)
		result = append(result, device)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (r *Registry) Get(id string) (Device, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	device, ok := r.devices[id]
	if !ok {
		return Device{}, ErrDeviceNotFound
	}
	device.Capabilities = append([]string(nil), device.Capabilities...)
	return device, nil
}

func (r *Registry) SetApproval(id string, approval ApprovalState) (Device, error) {
	if approval != ApprovalApproved && approval != ApprovalDenied && approval != ApprovalPending && approval != ApprovalQuarantined {
		return Device{}, errors.New("approval must be pending, approved, denied, or quarantined")
	}
	return r.updateDevice(id, true, func(device *Device, _ *Usage, now time.Time) error {
		device.Approval = approval
		if approval == ApprovalDenied || approval == ApprovalQuarantined {
			device.Enabled = false
		}
		recomputeAvailable(device)
		device.UpdatedAt = now
		return nil
	})
}

func (r *Registry) SetEnabled(id string, enabled bool) (Device, error) {
	return r.updateDevice(id, true, func(device *Device, _ *Usage, now time.Time) error {
		if enabled && device.Approval != ApprovalApproved {
			return ErrDeviceNotApproved
		}
		device.Enabled = enabled
		recomputeAvailable(device)
		device.UpdatedAt = now
		return nil
	})
}

func (r *Registry) SetAlias(id, alias string) (Device, error) {
	alias = strings.TrimSpace(alias)
	if len(alias) > 128 {
		return Device{}, errors.New("device alias must be 128 characters or fewer")
	}
	return r.updateDevice(id, true, func(device *Device, _ *Usage, now time.Time) error {
		device.Alias = alias
		device.UpdatedAt = now
		return nil
	})
}

// SetPresence is the platform-adapter boundary used by discovery and hotplug
// implementations. A newly present device remains unavailable until it is
// approved and enabled.
func (r *Registry) SetPresence(id string, presence PresenceState) (Device, error) {
	if presence != PresencePresent && presence != PresenceMissing && presence != PresenceUnknown {
		return Device{}, errors.New("presence must be present, missing, or unknown")
	}
	return r.updateDevice(id, false, func(device *Device, _ *Usage, now time.Time) error {
		device.Presence = presence
		if presence == PresencePresent {
			if device.FirstSeenAt.IsZero() {
				device.FirstSeenAt = now
			}
			device.LastSeenAt = now
		}
		recomputeAvailable(device)
		device.UpdatedAt = now
		return nil
	})
}

func (r *Registry) SetRuntimeState(id string, state RuntimeState) (Device, error) {
	if state != RuntimeIdle && state != RuntimeOpening && state != RuntimeActive && state != RuntimeBusy && state != RuntimeDegraded && state != RuntimeFailed {
		return Device{}, errors.New("invalid I/O runtime state")
	}
	return r.updateDevice(id, false, func(device *Device, _ *Usage, now time.Time) error {
		device.RuntimeState = state
		recomputeAvailable(device)
		device.UpdatedAt = now
		return nil
	})
}

func (r *Registry) SetActive(id string, active bool) error {
	_, err := r.updateDevice(id, false, func(device *Device, usage *Usage, now time.Time) error {
		if active && !device.Available {
			return ErrDeviceUnavailable
		}
		if active {
			usage.Sessions++
		} else if usage.Sessions > 0 {
			usage.Sessions--
		}
		switch {
		case usage.Sessions > 1:
			device.RuntimeState = RuntimeBusy
		case usage.Sessions == 1:
			device.RuntimeState = RuntimeActive
		default:
			device.RuntimeState = RuntimeIdle
		}
		device.UpdatedAt = now
		usage.UpdatedAt = now
		return nil
	})
	return err
}

func (r *Registry) Usage() []Usage {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Usage, 0, len(r.usage))
	for _, value := range r.usage {
		result = append(result, value)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DeviceID < result[j].DeviceID })
	return result
}

func (r *Registry) UsageFor(id string) (Usage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	usage, ok := r.usage[id]
	if !ok {
		return Usage{}, ErrDeviceNotFound
	}
	return usage, nil
}

func (r *Registry) updateDevice(id string, persistPolicy bool, update func(*Device, *Usage, time.Time) error) (Device, error) {
	if r == nil {
		return Device{}, ErrDeviceNotFound
	}
	id = strings.TrimSpace(id)
	r.mu.Lock()
	defer r.mu.Unlock()
	device, ok := r.devices[id]
	if !ok {
		return Device{}, ErrDeviceNotFound
	}
	usage := r.usage[id]
	if err := update(&device, &usage, time.Now().UTC()); err != nil {
		return Device{}, err
	}
	if persistPolicy {
		policy := devicePolicy{DeviceID: device.ID, Alias: device.Alias, Approval: device.Approval, Enabled: device.Enabled, UpdatedAt: device.UpdatedAt}
		previous, existed := r.policies[id]
		r.policies[id] = policy
		if r.state != nil {
			if err := r.state.save(r.policies, r.tombstones); err != nil {
				if existed {
					r.policies[id] = previous
				} else {
					delete(r.policies, id)
				}
				return Device{}, fmt.Errorf("%w: %v", ErrStatePersistence, err)
			}
		}
	}
	r.devices[id] = device
	r.usage[id] = usage
	device.Capabilities = append([]string(nil), device.Capabilities...)
	return device, nil
}

func normalizeDevice(device *Device, now time.Time) {
	device.Capabilities = append([]string(nil), device.Capabilities...)
	sort.Strings(device.Capabilities)
	if device.AdapterID == "" {
		device.AdapterID = "adapter.io-gateway"
	}
	if device.Presence == "" {
		if device.Available {
			device.Presence = PresencePresent
		} else {
			device.Presence = PresenceUnknown
		}
	}
	if device.Approval == "" {
		switch {
		case device.Available:
			device.Approval = ApprovalApproved
		case device.PermissionRequired:
			device.Approval = ApprovalPending
		default:
			device.Approval = ApprovalApproved
		}
	}
	if device.Available {
		device.Enabled = true
	}
	if device.RuntimeState == "" {
		device.RuntimeState = RuntimeIdle
	}
	if device.Presence == PresencePresent {
		if device.FirstSeenAt.IsZero() {
			device.FirstSeenAt = now
		}
		device.LastSeenAt = now
	}
	recomputeAvailable(device)
	device.UpdatedAt = now
}

func recomputeAvailable(device *Device) {
	device.Available = device.Presence == PresencePresent &&
		device.Approval == ApprovalApproved &&
		device.Enabled &&
		device.RuntimeState != RuntimeDegraded &&
		device.RuntimeState != RuntimeFailed
}
