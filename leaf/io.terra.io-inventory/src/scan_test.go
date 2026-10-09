package main

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/discovery"
	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
)

// hardware builds what the platform adapter would have returned, so the
// reconciliation these tests are about is exercised without depending on the
// devices the test machine happens to have.
func hardware(devices ...inventory.Device) enumerator {
	return func() (discovery.Result, error) {
		return discovery.Result{Devices: devices, Renamed: map[string]string{}, Tiers: map[string]string{}}, nil
	}
}

func mouse(id string) inventory.Device {
	return inventory.Device{
		ID: id, Name: "HID-compliant mouse", Kind: inventory.DeviceMouse,
		AdapterID: discovery.AdapterID, Capabilities: []string{"input.mouse"},
		PermissionRequired: true,
	}
}

func registryWith(t *testing.T, enumerate enumerator) *inventory.Registry {
	t.Helper()
	registry, err := inventory.NewPersistentRegistry(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := syncFrom(registry, enumerate); err != nil {
		t.Fatal(err)
	}
	return registry
}

// TestProbeTouchesOneDeviceAndLeavesTheRestAlone is the difference between
// probe and scan, and the reason both exist. A scan reconciles the whole
// adapter; if probe did that, asking about one camera would declare every other
// device on the node gone whenever the enumeration was partial.
func TestProbeTouchesOneDeviceAndLeavesTheRestAlone(t *testing.T) {
	registry := registryWith(t, hardware(mouse("mouse-a"), mouse("mouse-b")))

	// Only mouse-a answers this time.
	result, err := probeFrom(registry, "mouse-a", hardware(mouse("mouse-a")))
	if err != nil {
		t.Fatal(err)
	}
	if result.Presence != inventory.PresencePresent || result.DeviceID != "mouse-a" {
		t.Fatalf("probe = %#v", result)
	}
	if len(result.Changed) != 0 {
		t.Fatalf("changed = %v; a probe that confirms has changed nothing", result.Changed)
	}
	other, err := registry.Get("mouse-b")
	if err != nil {
		t.Fatal(err)
	}
	if other.Presence != inventory.PresencePresent {
		t.Fatalf("probing one device marked another missing: %#v", other)
	}
}

// A probe that finds nothing is the missing rule (IO-3), not a delete: the
// approval and alias stay, because a device that is out right now is expected
// back. Only a person, through forget, may take them away.
func TestProbeMarksMissingAndKeepsThePolicy(t *testing.T) {
	registry := registryWith(t, hardware(mouse("mouse-a")))
	if _, err := registry.SetApproval("mouse-a", inventory.ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetEnabled("mouse-a", true); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetAlias("mouse-a", "Desk mouse"); err != nil {
		t.Fatal(err)
	}

	result, err := probeFrom(registry, "mouse-a", hardware())
	if err != nil {
		t.Fatal(err)
	}
	if result.Presence != inventory.PresenceMissing {
		t.Fatalf("presence = %q, want missing", result.Presence)
	}
	// Confirming and correcting are different answers, so the caller is told
	// which one this was.
	if len(result.Changed) == 0 {
		t.Fatal("changed is empty though the probe moved presence")
	}
	if result.Device.Approval != inventory.ApprovalApproved || result.Device.Alias != "Desk mouse" {
		t.Fatalf("a missing device lost its policy: %#v", result.Device)
	}
	if result.Device.Available {
		t.Fatal("a missing device must not be available")
	}
}

// A probe that finds the device again refreshes what the OS now says about it.
func TestProbeRefreshesNameAndCapabilities(t *testing.T) {
	registry := registryWith(t, hardware(mouse("mouse-a")))

	renamed := mouse("mouse-a")
	renamed.Name = "Logitech USB Receiver Mouse"
	renamed.Capabilities = []string{"input.mouse", "io.raw"}
	result, err := probeFrom(registry, "mouse-a", hardware(renamed))
	if err != nil {
		t.Fatal(err)
	}
	if result.Device.Name != "Logitech USB Receiver Mouse" || len(result.Device.Capabilities) != 2 {
		t.Fatalf("device = %#v", result.Device)
	}
	changed := map[string]bool{}
	for _, field := range result.Changed {
		changed[field] = true
	}
	if !changed["name"] || !changed["capabilities"] {
		t.Fatalf("changed = %v, want name and capabilities", result.Changed)
	}
}

// The module's logical provider slots are not hardware and were never claimed
// to be. No enumerator can see one, so a probe could only ever conclude "gone" —
// which would be a lie told with the authority of a measurement.
func TestProbeRefusesDevicesNoAdapterCanSee(t *testing.T) {
	registry, err := inventory.NewPersistentRegistry(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(inventory.Device{ID: "camera-default", Name: "Default camera", Kind: inventory.DeviceCamera, Capabilities: []string{"video.frame"}, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := probeFrom(registry, "camera-default", hardware()); !errors.Is(err, inventory.ErrDeviceNotProbeable) {
		t.Fatalf("probe of a logical slot = %v, want ErrDeviceNotProbeable", err)
	}
	slot, err := registry.Get("camera-default")
	if err != nil {
		t.Fatal(err)
	}
	if slot.Presence != inventory.PresenceUnknown {
		t.Fatalf("the refused probe changed the slot anyway: %#v", slot)
	}

	if _, err := probeFrom(registry, "nothing-here", hardware()); !errors.Is(err, inventory.ErrDeviceNotFound) {
		t.Fatalf("probe of an unknown id = %v, want ErrDeviceNotFound", err)
	}
}

// A probe on a platform with no adapter is the same refusal a scan gets: 501,
// not an empty answer. "This device is gone" and "this node cannot look" must
// not arrive as the same fact.
func TestProbeOnAPlatformWithoutAnAdapterSaysSo(t *testing.T) {
	registry := registryWith(t, hardware(mouse("mouse-a")))
	unsupported := func() (discovery.Result, error) { return discovery.Result{}, discovery.ErrUnsupported }
	if _, err := probeFrom(registry, "mouse-a", unsupported); !errors.Is(err, discovery.ErrUnsupported) {
		t.Fatalf("probe = %v, want ErrUnsupported", err)
	}
	device, err := registry.Get("mouse-a")
	if err != nil {
		t.Fatal(err)
	}
	if device.Presence != inventory.PresencePresent {
		t.Fatalf("a failed look marked the device missing: %#v", device)
	}
}

// TestScanMovesPolicyOntoRenamedIds is the upgrade path end to end: the first
// scan after persistent identity ships is where an approval given under the old
// id has to catch up with the hardware.
func TestScanMovesPolicyOntoRenamedIds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	old, err := inventory.NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := syncFrom(old, hardware(mouse("mouse-legacy"))); err != nil {
		t.Fatal(err)
	}
	if _, err := old.SetApproval("mouse-legacy", inventory.ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := old.SetEnabled("mouse-legacy", true); err != nil {
		t.Fatal(err)
	}

	// The upgraded module restarts: the same hardware, a different id.
	upgraded, err := inventory.NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	renaming := func() (discovery.Result, error) {
		return discovery.Result{
			Devices: []inventory.Device{mouse("mouse-046d-c534-2f417bd9")},
			Renamed: map[string]string{"mouse-046d-c534-2f417bd9": "mouse-legacy"},
			Tiers:   map[string]string{"mouse-046d-c534-2f417bd9": "serial"},
		}, nil
	}
	if _, err := syncFrom(upgraded, renaming); err != nil {
		t.Fatal(err)
	}
	device, err := upgraded.Get("mouse-046d-c534-2f417bd9")
	if err != nil {
		t.Fatal(err)
	}
	if device.Approval != inventory.ApprovalApproved || !device.Available {
		t.Fatalf("the approval did not survive the id change: %#v", device)
	}
}
