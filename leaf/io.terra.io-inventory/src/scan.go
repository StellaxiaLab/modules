package main

import (
	"errors"
	"fmt"
	"os"
	"slices"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/discovery"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

// enumerator is one look at the node's hardware. The two helpers below take it
// as a parameter rather than calling discovery.Scan directly so that what they
// do with a scan — move policy onto renamed ids, reconcile, refuse to touch
// devices that are not the adapter's — is tested against fixtures instead of
// against whatever hardware the test machine happens to have.
type enumerator func() (discovery.Result, error)

// scanDevices enumerates the node's I/O and reconciles the inventory with it.
// The HTTP route and the start-up sweep share it so an operator's rescan and
// the module's own first look cannot drift apart.
func scanDevices(registry *inventory.Registry) (inventory.SyncResult, error) {
	return syncFrom(registry, discovery.Scan)
}

func syncFrom(registry *inventory.Registry, enumerate enumerator) (inventory.SyncResult, error) {
	result, err := enumerate()
	if err != nil {
		return inventory.SyncResult{}, err
	}
	if result.Skipped > 0 {
		// Not a silent drop: an operator reading a short list should be able
		// to tell "no such device here" from "the only one here is ours".
		fmt.Fprintf(os.Stderr, "terra-io-inventory: skipped %d device(s) Terra itself projected onto this node\n", result.Skipped)
	}
	// Before the devices land: any policy still filed under the id the
	// pre-identity derivation gave this hardware is moved onto the id it has
	// now. This has to happen before Sync, or the device registers with no
	// policy and the approval a person gave is lost at the moment the upgrade
	// was supposed to make it durable.
	adopted, err := registry.AdoptPolicies(result.Renamed)
	if err != nil {
		return inventory.SyncResult{}, err
	}
	if len(adopted) > 0 {
		fmt.Fprintf(os.Stderr, "terra-io-inventory: moved saved policy onto %d device(s) whose id changed with persistent identity\n", len(adopted))
	}
	return registry.Sync(discovery.AdapterID, result.Devices)
}

// probeDevice re-reads one device and reports what that changed.
//
// It is not a one-device scan, and the difference is the whole point of having
// both. A scan reconciles: everything this adapter knows about and did not see
// becomes missing. A probe answers about one device and touches nothing else,
// so an operator can ask "is this camera back?" without a slow or partial
// enumeration silently declaring the rest of the node's hardware gone.
//
// The enumeration itself is still whole — one file read on Linux, one PnP query
// on Windows, neither of which answers about a single device — and the result is
// filtered to the one asked about.
func probeDevice(registry *inventory.Registry, deviceID string) (inventory.ProbeResult, error) {
	return probeFrom(registry, deviceID, discovery.Scan)
}

func probeFrom(registry *inventory.Registry, deviceID string, enumerate enumerator) (inventory.ProbeResult, error) {
	before, err := registry.Get(deviceID)
	if err != nil {
		return inventory.ProbeResult{}, err
	}
	if before.AdapterID != discovery.AdapterID {
		return inventory.ProbeResult{}, fmt.Errorf("%w: %s belongs to %s", inventory.ErrDeviceNotProbeable, before.ID, before.AdapterID)
	}

	result, err := enumerate()
	if err != nil {
		return inventory.ProbeResult{}, err
	}

	var after inventory.Device
	found := false
	for _, device := range result.Devices {
		if device.ID != deviceID {
			continue
		}
		// Sync is what normally stamps presence; a probe is the other caller
		// that has actually looked, so it says so for this one device.
		device.AdapterID = discovery.AdapterID
		device.Presence = inventory.PresencePresent
		if err := registry.Register(device); err != nil {
			return inventory.ProbeResult{}, fmt.Errorf("register %s: %w", device.ID, err)
		}
		found = true
		break
	}
	if !found {
		// Missing, never deleted (IO-3). The approval and alias stay exactly
		// where they were, because a device that is out right now is expected
		// back — forget is the other verb, and only a person may use it.
		if _, err := registry.SetPresence(deviceID, inventory.PresenceMissing); err != nil {
			return inventory.ProbeResult{}, err
		}
	}
	after, err = registry.Get(deviceID)
	if err != nil {
		return inventory.ProbeResult{}, err
	}
	return inventory.ProbeResult{
		DeviceID: after.ID,
		Adapter:  discovery.AdapterID,
		Presence: after.Presence,
		Changed:  probeChanges(before, after),
		Device:   after,
	}, nil
}

// probeChanges names what the probe moved. A probe that confirms and a probe
// that corrects are different answers, and a caller that only got the device
// back could not tell them apart.
func probeChanges(before, after inventory.Device) []string {
	changed := make([]string, 0, 4)
	if before.Presence != after.Presence {
		changed = append(changed, "presence")
	}
	if before.Name != after.Name {
		changed = append(changed, "name")
	}
	if !slices.Equal(before.Capabilities, after.Capabilities) {
		changed = append(changed, "capabilities")
	}
	if before.Available != after.Available {
		changed = append(changed, "available")
	}
	return changed
}

// scanAtStartup fills the inventory before the module answers its first
// request.
//
// It exists because policy is the only thing that survives a restart:
// NewPersistentRegistry restores approvals and aliases, never the devices
// themselves, since presence has to come from a live adapter. Without this
// sweep the inventory held nothing but the logical slots until somebody
// happened to call POST /scan — and after every reboot the node looked like it
// had no hardware.
//
// It never fails start-up. A platform with no adapter is the ordinary case on
// macOS today, and a module that refuses to run there would take the working
// half of the inventory — the policy surface — down with it.
func scanAtStartup(registry *inventory.Registry) {
	result, err := scanDevices(registry)
	switch {
	case errors.Is(err, discovery.ErrUnsupported):
		fmt.Fprintln(os.Stderr, "terra-io-inventory: platform discovery unavailable, inventory holds logical slots only:", err)
	case err != nil:
		// Worth saying loudly: the devices are missing from the inventory and
		// the reason is not "this node has none".
		fmt.Fprintln(os.Stderr, "terra-io-inventory: device scan failed at start-up:", err)
	default:
		fmt.Fprintf(os.Stderr, "terra-io-inventory: start-up scan found %d device(s)\n", result.Scanned)
	}
}
