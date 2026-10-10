// Package discovery enumerates the operating system's I/O devices so the
// inventory can hold real hardware, not only the logical provider slots the
// module registers at start-up.
//
// The split is deliberate. Everything that calls an OS API lives in a
// build-tagged file; everything that decides what a found device *means* lives
// here, where it is testable on any platform. The inventory package stays free
// of OS calls (see its package doc) — this package is the one place they belong.
//
// A scan never deletes. A device that stops answering becomes missing, because
// the user's policy for it — approval, alias — has to outlive the cable. The
// same promise is why a device's id is derived from what the device says about
// itself rather than from where the OS found it (identity.go): a policy is only
// as durable as the id it is filed under.
package discovery

import (
	"errors"
	"sort"
	"strings"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
)

// AdapterID names this adapter on every device it reports. Registry.Sync uses
// it to tell its own devices from the module's logical slots, so a scan can
// never mark those missing.
const AdapterID = "adapter.os-discovery"

// ErrUnsupported is what a platform without an adapter returns. It is
// deliberately distinct from "found nothing": the caller answers 501 rather
// than showing an empty inventory, because "none" and "could not look" must
// not reach the operator as the same screen.
var ErrUnsupported = errors.New("platform I/O discovery is not implemented for this operating system")

// The classes an adapter may report. Each platform speaks a different dialect —
// Windows a setup class GUID, Linux a capability bitmap — so every adapter
// translates into these tokens and kindFor maps them one place. An adapter that
// cannot place a device passes whatever the OS called it, and kindFor skips it.
const (
	classMouse    = "mouse"
	classKeyboard = "keyboard"
	classRawInput = "raw"
)

// Found is one device as the operating system describes it, before this package
// decides whether Terra has any use for it.
type Found struct {
	// Key is how the operating system addresses the device — the Linux sysfs
	// path, the Windows device instance ID. It is where the device is, not what
	// it is: it identifies the device within one boot, and the fields in
	// Identity are what carry across one. Devices reported twice are collapsed
	// on it, and it is the id's last resort when a device says nothing about
	// itself.
	Key string
	// Class is the OS device class name, the only thing that says what the
	// device is.
	Class string
	// Name is the OS's description. It may still be an INF token.
	Name string
	// Identity is what the device says about itself — serial, model, where it
	// is attached. It is what the device id rests on, because Key answers
	// "where" and only looks like an identity while nothing moves
	// (identity.go).
	Identity Identity
	// Synthetic marks a device Terra itself created — a projection of another
	// node's device rather than hardware attached here. Publishing it again
	// would offer a third node a copy of a copy, so these are counted and
	// skipped instead of enumerated. Only the Linux adapter can set it: on
	// Windows injection goes through SendInput and creates no device.
	Synthetic bool
}

// Result is one enumeration of the node.
type Result struct {
	// Devices is what the node has, in the inventory's own shape.
	Devices []inventory.Device
	// Skipped counts Terra's own projections, which are not enumerated as this
	// node's hardware. The count is returned rather than dropped in silence:
	// "this node has no mouse" and "this node's only mouse is one we projected
	// here" are different facts, and an operator reading an empty list deserves
	// to know which one they are looking at.
	Skipped int
	// Renamed maps a device's current id to the id the pre-identity derivation
	// gave the same hardware, for the devices where the two differ. It exists
	// for one call — Registry.AdoptPolicies — so an upgrade moves a person's
	// approvals and aliases onto the new id instead of stranding them.
	Renamed map[string]string
	// Tiers records which evidence each device's id rests on (identity.go), so
	// an operator can tell an id that survives a re-plug from one that only
	// survives a reboot.
	Tiers map[string]string
}

// Scan enumerates the node's I/O devices and returns them in the inventory's
// own shape. Errors are passed through rather than flattened into an empty
// list — see ErrUnsupported.
func Scan() (Result, error) {
	found, err := enumerate()
	if err != nil {
		return Result{}, err
	}
	return devicesFrom(found), nil
}

// devicesFrom keeps the devices Terra can describe, drops the rest, and derives
// each one's persistent id.
func devicesFrom(found []Found) Result {
	// Classify first: the kind is part of the identity key, so two devices only
	// contend for one identity when they are the same kind of thing.
	entries := make([]Found, 0, len(found))
	kinds := make([]inventory.DeviceKind, 0, len(found))
	result := Result{
		Devices: make([]inventory.Device, 0, len(found)),
		Renamed: map[string]string{},
		Tiers:   map[string]string{},
	}
	seenKey := make(map[string]bool, len(found))
	for _, entry := range found {
		if entry.Synthetic {
			result.Skipped++
			continue
		}
		kind, ok := kindFor(entry.Class)
		if !ok {
			continue
		}
		key := strings.TrimSpace(entry.Key)
		if key == "" {
			continue
		}
		// The same device reported twice is one device. Collapsing it here,
		// before identities are counted, keeps it from looking like two
		// devices contending for one identity — which would push both of them
		// down to a weaker tier.
		normalized := identityToken(key)
		if seenKey[normalized] {
			continue
		}
		seenKey[normalized] = true
		entry.Key = key
		entries = append(entries, entry)
		kinds = append(kinds, kind)
	}

	taken := countIdentityCandidates(entries, kinds)
	for index, entry := range entries {
		kind := kinds[index]
		id, tier := assignIdentity(kind, entry, taken)
		result.Tiers[id] = string(tier)
		if legacy := legacyDeviceID(kind, entry.Key); legacy != id {
			result.Renamed[id] = legacy
		}
		result.Devices = append(result.Devices, inventory.Device{
			ID:           id,
			Name:         displayName(entry, kind),
			Kind:         kind,
			AdapterID:    AdapterID,
			Capabilities: capabilitiesFor(kind),
			// Presence is not set here: Registry.Sync owns it, because being in
			// a scan's list is what present means.
			//
			// Input devices carry keystrokes and pointer motion, so discovery
			// registers them unapproved: normalizeDevice turns
			// PermissionRequired into approval "pending", and nothing reaches
			// the catalog as available until a person approves it.
			PermissionRequired: true,
		})
	}
	sort.Slice(result.Devices, func(i, j int) bool { return result.Devices[i].ID < result.Devices[j].ID })
	return result
}

// kindFor maps an OS device class onto the inventory's kinds. Only the classes
// Terra can actually describe are mapped; an unmapped class is skipped rather
// than guessed at, because the kind picks the SVI schema (inventory/svi.go) and
// a wrong guess publishes a resource nothing can consume.
func kindFor(class string) (inventory.DeviceKind, bool) {
	switch strings.ToLower(strings.TrimSpace(class)) {
	case classMouse:
		return inventory.DeviceMouse, true
	case classKeyboard:
		return inventory.DeviceKeyboard, true
	case classRawInput:
		return inventory.DeviceRawBus, true
	}
	return "", false
}

// capabilitiesFor mirrors the schema names in inventory/svi.go's deviceSchema,
// so a reader of the device list and a reader of the SVI catalog see the same
// words for the same thing.
func capabilitiesFor(kind inventory.DeviceKind) []string {
	switch kind {
	case inventory.DeviceMouse:
		return []string{"input.mouse"}
	case inventory.DeviceKeyboard:
		return []string{"input.keyboard"}
	default:
		return []string{"io.raw"}
	}
}

// displayName prefers what the OS calls the device.
//
// Windows DeviceDesc values are often INF tokens like
// `@input.inf,%hid_device_system_mouse%;HID-compliant mouse`: the part after the
// last semicolon is the resolved text and everything before it is noise to a
// person reading a device list.
func displayName(entry Found, kind inventory.DeviceKind) string {
	name := strings.TrimSpace(entry.Name)
	if index := strings.LastIndex(name, ";"); index >= 0 {
		name = strings.TrimSpace(name[index+1:])
	}
	if name == "" {
		return "Unknown " + string(kind)
	}
	return name
}
