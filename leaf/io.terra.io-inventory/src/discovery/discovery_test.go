package discovery

import (
	"strings"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

func TestKindForMapsOnlyDescribableClasses(t *testing.T) {
	for class, want := range map[string]inventory.DeviceKind{
		"mouse":    inventory.DeviceMouse,
		"Mouse":    inventory.DeviceMouse,
		"keyboard": inventory.DeviceKeyboard,
		"raw":      inventory.DeviceRawBus,
	} {
		kind, ok := kindFor(class)
		if !ok || kind != want {
			t.Fatalf("kindFor(%q) = %q, %t; want %q, true", class, kind, ok, want)
		}
	}
	// A class Terra cannot describe must be skipped, not guessed at: the kind
	// picks the SVI schema.
	for _, class := range []string{"", "Net", "Printer", "Volume", "HIDClass", "{4D36E96F-E325-11CE-BFC1-08002BE10318}"} {
		if _, ok := kindFor(class); ok {
			t.Fatalf("kindFor(%q) must not map", class)
		}
	}
}

func TestDeviceIDIsPathFreeAndDistinguishesDevices(t *testing.T) {
	const instance = `HID\VID_046D&PID_C534&MI_01&COL01\8&1e0f24a1&0&0000`
	entry := Found{Key: instance, Identity: parseWindowsInstanceID(instance)}

	id, tier := assignIdentity(inventory.DeviceMouse, entry, countIdentityCandidates([]Found{entry}, []inventory.DeviceKind{inventory.DeviceMouse}))
	again, _ := assignIdentity(inventory.DeviceMouse, entry, countIdentityCandidates([]Found{entry}, []inventory.DeviceKind{inventory.DeviceMouse}))
	if id != again {
		t.Fatal("device id must be stable across calls")
	}
	// `8&1e0f24a1&0&0000` is bus-generated, not a serial the hardware reported,
	// so the id may only promise what that promises.
	if tier != tierLocation {
		t.Fatalf("tier = %q, want %q", tier, tierLocation)
	}
	lower := Found{Key: strings.ToLower(instance), Identity: parseWindowsInstanceID(strings.ToLower(instance))}
	lowerID, _ := assignIdentity(inventory.DeviceMouse, lower, countIdentityCandidates([]Found{lower}, []inventory.DeviceKind{inventory.DeviceMouse}))
	if lowerID != id {
		t.Fatal("Windows instance ids are case-insensitive; the device id must be too")
	}
	if strings.ContainsAny(id, `/\`) {
		t.Fatalf("Registry.Register rejects path separators: %q", id)
	}
	if !strings.HasPrefix(id, "mouse-046d-c534-") {
		t.Fatalf("vendor and product belong in the id for a human reading the list: %q", id)
	}

	other := Found{Key: instance + `0`, Identity: parseWindowsInstanceID(instance + `0`)}
	otherID, _ := assignIdentity(inventory.DeviceMouse, other, countIdentityCandidates([]Found{other}, []inventory.DeviceKind{inventory.DeviceMouse}))
	if otherID == id {
		t.Fatal("different devices must not collide")
	}

	// A key without a vendor/product pair — PS/2, Bluetooth — still gets an id.
	const acpi = `ACPI\PNP0303\4&1e9d1bf7&0`
	plain := Found{Key: acpi, Identity: parseWindowsInstanceID(acpi)}
	plainID, _ := assignIdentity(inventory.DeviceKeyboard, plain, countIdentityCandidates([]Found{plain}, []inventory.DeviceKind{inventory.DeviceKeyboard}))
	if !strings.HasPrefix(plainID, "keyboard-") || strings.ContainsAny(plainID, `/\`) {
		t.Fatalf("unexpected id for a key without VID/PID: %q", plainID)
	}
}

// TestLegacyDeviceIDStillReproducesTheShippedDerivation pins the digests with
// literals on purpose.
//
// legacyDeviceID has one caller — AdoptPolicies, which uses it to find the
// policy a running node filed under the id the first release derived. Those ids
// are on disk on machines this repository cannot see, so the function is not
// free to be "cleaned up": if it stops reproducing them, the upgrade silently
// strands every approval and alias instead of moving it, which is the loss
// persistent identity exists to prevent.
func TestLegacyDeviceIDStillReproducesTheShippedDerivation(t *testing.T) {
	for _, test := range []struct {
		kind inventory.DeviceKind
		key  string
		want string
	}{
		{inventory.DeviceMouse, `HID\VID_046D&PID_C534&MI_01&COL01\8&1e0f24a1&0&0000`, "mouse-046d-c534-e1b4ab26"},
		{inventory.DeviceKeyboard, `ACPI\PNP0303\4&1e9d1bf7&0`, "keyboard-41e98200"},
	} {
		if got := legacyDeviceID(test.kind, test.key); got != test.want {
			t.Fatalf("legacyDeviceID(%q) = %q, want %q", test.key, got, test.want)
		}
	}
}

func TestDisplayNameResolvesINFTokens(t *testing.T) {
	entry := Found{Name: `@input.inf,%hid_device_system_mouse%;HID-compliant mouse`}
	if got := displayName(entry, inventory.DeviceMouse); got != "HID-compliant mouse" {
		t.Fatalf("displayName = %q", got)
	}
	if got := displayName(Found{Name: "  Logitech USB Receiver "}, inventory.DeviceMouse); got != "Logitech USB Receiver" {
		t.Fatalf("displayName = %q", got)
	}
	if got := displayName(Found{}, inventory.DeviceKeyboard); got != "Unknown keyboard" {
		t.Fatalf("a nameless device still needs a label: %q", got)
	}
}

func TestDevicesFromRegistersUnapprovedAndSkipsWhatItCannotDescribe(t *testing.T) {
	devices := devicesFrom([]Found{
		{Key: `HID\VID_046D&PID_C534\1`, Class: "mouse", Name: "HID-compliant mouse"},
		{Key: `ACPI\PNP0303\4`, Class: "keyboard", Name: "Standard keyboard"},
		{Key: `PCI\VEN_8086&DEV_15F3\3`, Class: "Net", Name: "Ethernet"},
		{Key: "   ", Class: "mouse", Name: "no key"},
		// The same device reported twice must land once.
		{Key: `hid\vid_046d&pid_c534\1`, Class: "mouse", Name: "HID-compliant mouse"},
	}).Devices

	if len(devices) != 2 {
		t.Fatalf("devices = %d, want 2: %#v", len(devices), devices)
	}
	for _, device := range devices {
		if device.AdapterID != AdapterID {
			t.Fatalf("adapter id = %q", device.AdapterID)
		}
		if !device.PermissionRequired {
			t.Fatalf("input devices must land unapproved: %#v", device)
		}
		if len(device.Capabilities) == 0 {
			t.Fatalf("missing capabilities: %#v", device)
		}
	}
	if devices[0].ID >= devices[1].ID {
		t.Fatal("devices must come back sorted so a scan reads the same twice")
	}
}

func TestDevicesFromKeepsDefaultDenyThroughTheRegistry(t *testing.T) {
	registry := inventory.NewRegistry()
	devices := devicesFrom([]Found{{Key: `HID\VID_046D&PID_C534\1`, Class: "keyboard", Name: "HID Keyboard Device"}}).Devices
	if _, err := registry.Sync(AdapterID, devices); err != nil {
		t.Fatal(err)
	}
	stored := registry.List()
	if len(stored) != 1 {
		t.Fatalf("stored = %d", len(stored))
	}
	// The whole point of PermissionRequired: a keyboard the scan just found is
	// visible but not usable until a person approves it.
	if stored[0].Approval != inventory.ApprovalPending || stored[0].Enabled || stored[0].Available {
		t.Fatalf("a newly discovered keyboard must not be usable: %#v", stored[0])
	}
}
