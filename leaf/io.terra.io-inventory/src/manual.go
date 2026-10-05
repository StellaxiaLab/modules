package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/manual"
)

// manualDoor is the hand-registration side of the inventory: the source that
// remembers what a person registered, and the adapters that can open it.
type manualDoor struct {
	source   *manual.Source
	adapters manual.Adapters
}

// syncManual brings the hand-registered devices into the inventory the way a
// scan brings in enumerated ones — through Registry.Sync, one call per adapter,
// so a hand-registered device passes the same door (approval=pending) and the
// same missing rule (IO-3) as any other.
//
// Asking every device is the enumeration. Those that answer are what the
// adapter "sees", and Sync marks present the ones it sees and missing the ones
// that were present and no longer answer. One that has never answered — a
// camera registered while switched off — is still registered, at presence
// unknown: it has to be in the list for a person to approve it, and "unknown"
// is what is true about a device nothing has heard from yet.
func syncManual(ctx context.Context, registry *inventory.Registry, door *manualDoor) ([]inventory.SyncResult, error) {
	return syncManualFor(ctx, registry, door, "")
}

// syncManualFor is syncManual narrowed to one adapter's entries when only is
// set — a registration reconciles its own adapter the way a scan would and
// leaves the other adapters' devices, and their network round trips, alone.
func syncManualFor(ctx context.Context, registry *inventory.Registry, door *manualDoor, only string) ([]inventory.SyncResult, error) {
	if door == nil {
		return nil, nil
	}
	entries := door.source.Entries()
	if only != "" {
		narrowed := entries[:0]
		for _, entry := range entries {
			if entry.AdapterID == only {
				narrowed = append(narrowed, entry)
			}
		}
		entries = narrowed
	}
	answered := reachAll(ctx, door.adapters, entries)

	byAdapter := map[string][]manual.Entry{}
	for _, entry := range entries {
		byAdapter[entry.AdapterID] = append(byAdapter[entry.AdapterID], entry)
	}
	results := make([]inventory.SyncResult, 0, len(byAdapter))
	for _, adapterID := range door.adapters.IDs() {
		group := byAdapter[adapterID]
		if len(group) == 0 {
			continue
		}
		seen := make([]inventory.Device, 0, len(group))
		for _, entry := range group {
			if answered[entry.DeviceID] {
				seen = append(seen, entry.Device())
			}
		}
		result, err := registry.Sync(adapterID, seen)
		if err != nil {
			return results, err
		}
		for _, entry := range group {
			if answered[entry.DeviceID] {
				continue
			}
			if _, err := registry.Get(entry.DeviceID); err == nil {
				continue
			}
			device := entry.Device()
			device.Presence = inventory.PresenceUnknown
			if err := registry.Register(device); err != nil {
				return results, fmt.Errorf("register %s: %w", device.ID, err)
			}
			result.Added = append(result.Added, device.ID)
		}
		sort.Strings(result.Added)
		results = append(results, result)
	}
	// An entry whose adapter this build does not have cannot be opened, so it
	// is not brought in — but it is not dropped from the source either, because
	// a rollback is the usual way to get here and the next build will have it.
	for adapterID, group := range byAdapter {
		if _, ok := door.adapters[adapterID]; !ok {
			fmt.Fprintf(os.Stderr, "terra-io-inventory: %d manual device(s) name adapter %s, which this build does not have\n", len(group), adapterID)
		}
	}
	return results, nil
}

// reachAll asks every entry at once, so a scan on a node with several cameras
// switched off takes one timeout rather than one per camera.
func reachAll(ctx context.Context, adapters manual.Adapters, entries []manual.Entry) map[string]bool {
	answered := make(map[string]bool, len(entries))
	var mu sync.Mutex
	var wait sync.WaitGroup
	for _, entry := range entries {
		adapter, ok := adapters[entry.AdapterID]
		if !ok {
			continue
		}
		address, err := entry.URL()
		if err != nil {
			continue
		}
		wait.Add(1)
		go func() {
			defer wait.Done()
			if adapter.Reach(ctx, address) == nil {
				mu.Lock()
				answered[entry.DeviceID] = true
				mu.Unlock()
			}
		}()
	}
	wait.Wait()
	return answered
}

// probeManual asks one hand-registered device whether it is there and touches
// nothing else — the manual counterpart of probeFrom (§5.1).
func probeManual(ctx context.Context, registry *inventory.Registry, door *manualDoor, before inventory.Device) (inventory.ProbeResult, error) {
	if door == nil {
		return inventory.ProbeResult{}, fmt.Errorf("%w: %s belongs to %s", inventory.ErrDeviceNotProbeable, before.ID, before.AdapterID)
	}
	entry, ok := door.source.Get(before.ID)
	if !ok {
		return inventory.ProbeResult{}, fmt.Errorf("%w: %s has no manual source entry", inventory.ErrDeviceNotProbeable, before.ID)
	}
	adapter, ok := door.adapters[entry.AdapterID]
	if !ok {
		return inventory.ProbeResult{}, fmt.Errorf("%w: adapter %s is not in this build", inventory.ErrDeviceNotProbeable, entry.AdapterID)
	}
	address, err := entry.URL()
	if err != nil {
		return inventory.ProbeResult{}, fmt.Errorf("%w: stored address does not parse: %v", inventory.ErrDeviceNotProbeable, err)
	}
	if adapter.Reach(ctx, address) == nil {
		device := entry.Device()
		device.Presence = inventory.PresencePresent
		if err := registry.Register(device); err != nil {
			return inventory.ProbeResult{}, fmt.Errorf("register %s: %w", device.ID, err)
		}
	} else if _, err := registry.SetPresence(before.ID, inventory.PresenceMissing); err != nil {
		return inventory.ProbeResult{}, err
	}
	after, err := registry.Get(before.ID)
	if err != nil {
		return inventory.ProbeResult{}, err
	}
	return inventory.ProbeResult{
		DeviceID: after.ID,
		Adapter:  entry.AdapterID,
		Presence: after.Presence,
		Changed:  probeChanges(before, after),
		Device:   after,
	}, nil
}

// manualAdded is what POST /devices answers.
type manualAdded struct {
	DeviceID string           `json:"device_id"`
	Device   inventory.Device `json:"device"`
	Source   manual.Entry     `json:"source"`
}

// addManual writes a registration into the source and brings it in at once
// through the same sync a scan runs, so the answer can name the device and a
// person can approve it without waiting for the next scan.
func addManual(ctx context.Context, registry *inventory.Registry, door *manualDoor, request manual.Request) (manualAdded, error) {
	entry, adapter, err := door.adapters.Admit(request, time.Now())
	if err != nil {
		return manualAdded{}, err
	}
	if err := door.source.Add(entry); err != nil {
		return manualAdded{}, err
	}
	if _, err := syncManualFor(ctx, registry, door, adapter.ID()); err != nil {
		if _, _, removeErr := door.source.Remove(entry.DeviceID); removeErr != nil {
			fmt.Fprintln(os.Stderr, "terra-io-inventory: could not take back a registration that failed to sync:", removeErr)
		}
		return manualAdded{}, err
	}
	// The alias is policy, set the way a person would set it afterwards. If it
	// cannot be written the device is still registered — pending, without the
	// alias — and the error says so; taking the registration back would hide a
	// device that is already in the list.
	if alias := request.Alias; alias != "" {
		if _, err := registry.SetAlias(entry.DeviceID, alias); err != nil {
			return manualAdded{}, err
		}
	}
	device, err := registry.Get(entry.DeviceID)
	if err != nil {
		return manualAdded{}, err
	}
	return manualAdded{DeviceID: device.ID, Device: device, Source: entry.Public()}, nil
}

// forgetDevice forgets a device and, if a person registered it by hand, takes
// it out of the source too — otherwise the next scan would bring it straight
// back. The source goes first so a forget that cannot be recorded puts the
// entry back: half a forget, where the device is gone from the list but still
// in the source, would resurrect it at the next scan as a device nobody asked
// for.
func forgetDevice(registry *inventory.Registry, door *manualDoor, id string) (inventory.Tombstone, error) {
	var removed manual.Entry
	var wasManual bool
	if door != nil {
		if _, err := registry.Get(id); err != nil {
			return inventory.Tombstone{}, err
		}
		entry, ok, err := door.source.Remove(id)
		if err != nil {
			return inventory.Tombstone{}, err
		}
		removed, wasManual = entry, ok
	}
	tombstone, err := registry.Forget(id)
	if err != nil {
		if wasManual {
			if restoreErr := door.source.Restore(removed); restoreErr != nil {
				fmt.Fprintln(os.Stderr, "terra-io-inventory: could not restore a manual entry after a failed forget:", restoreErr)
			}
		}
		return inventory.Tombstone{}, err
	}
	return tombstone, nil
}

// manualSourcePath sits beside devices.json in the module's data home.
func manualSourcePath(statePath string) string {
	return filepath.Join(filepath.Dir(statePath), "manual-devices.json")
}
