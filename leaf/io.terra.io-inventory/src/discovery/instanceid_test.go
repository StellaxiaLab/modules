package discovery

import (
	"sort"
	"strings"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

func TestParseWindowsInstanceIDSeparatesSerialFromGeneratedInstance(t *testing.T) {
	for name, test := range map[string]struct {
		instance string
		want     Identity
	}{
		"HID collection with a generated instance": {
			instance: `HID\VID_046D&PID_C534&MI_01&COL01\8&1e0f24a1&0&0000`,
			want:     Identity{Bus: "HID", Vendor: "046D", Product: "C534", Interface: "MI_01+COL01", Location: "8&1e0f24a1&0&0000"},
		},
		"USB device whose bus driver read a serial": {
			instance: `USB\VID_0781&PID_5567\4C530001120523107442`,
			want:     Identity{Bus: "USB", Vendor: "0781", Product: "5567", Serial: "4C530001120523107442"},
		},
		"PS/2 keyboard has no vendor pair at all": {
			instance: `ACPI\PNP0303\4&1e9d1bf7&0`,
			want:     Identity{Bus: "ACPI", Interface: "PNP0303", Location: "4&1e9d1bf7&0"},
		},
		"PCI uses VEN/DEV rather than VID/PID": {
			instance: `PCI\VEN_8086&DEV_15F3&SUBSYS_00008086&REV_03\3&11583659&0&FE`,
			want:     Identity{Bus: "PCI", Vendor: "8086", Product: "15F3", Location: "3&11583659&0&FE"},
		},
		"a bare root device says nothing": {
			instance: `ROOT\SYSTEM`,
			want:     Identity{Bus: "ROOT", Interface: "SYSTEM"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			if got := parseWindowsInstanceID(test.instance); got != test.want {
				t.Fatalf("parseWindowsInstanceID(%q) =\n %#v\nwant\n %#v", test.instance, got, test.want)
			}
		})
	}
	if got := parseWindowsInstanceID("   "); got != (Identity{}) {
		t.Fatalf("empty instance = %#v", got)
	}
}

// windowsIDs runs the Windows adapter's output through the same derivation the
// adapter uses, so these fixtures exercise the real path rather than a copy of
// it. The adapter itself cannot run here (it is build-tagged, and cfgmgr32 is
// not on this machine) — what it produces is a list of instance IDs, which is
// what is pinned.
func windowsIDs(t *testing.T, instances map[string]string) ([]string, map[string]string) {
	t.Helper()
	found := make([]Found, 0, len(instances))
	keys := make([]string, 0, len(instances))
	for instance := range instances {
		keys = append(keys, instance)
	}
	sort.Strings(keys)
	for _, instance := range keys {
		found = append(found, Found{
			Key:      instance,
			Class:    instances[instance],
			Name:     "device",
			Identity: parseWindowsInstanceID(instance),
		})
	}
	result := devicesFrom(found)
	ids := make([]string, 0, len(result.Devices))
	for _, device := range result.Devices {
		ids = append(ids, device.ID)
	}
	sort.Strings(ids)
	return ids, result.Tiers
}

// TestWindowsDeviceIdsSurviveAReboot pins the other half of the completion
// condition. Windows instance IDs are already reboot-stable, so this is a
// regression guard rather than a fix: the derivation must not have made them
// less stable on the way to making Linux stable at all.
func TestWindowsDeviceIdsSurviveAReboot(t *testing.T) {
	fixture := map[string]string{
		`HID\VID_046D&PID_C534&MI_00\7&2f1c9d3a&0&0000`:       classKeyboard,
		`HID\VID_046D&PID_C534&MI_01&COL01\8&1e0f24a1&0&0000`: classMouse,
		`ACPI\PNP0303\4&1e9d1bf7&0`:                           classKeyboard,
	}
	before, _ := windowsIDs(t, fixture)
	after, tiers := windowsIDs(t, fixture)
	if len(before) != 3 {
		t.Fatalf("ids = %v, want 3", before)
	}
	for index := range before {
		if before[index] != after[index] {
			t.Fatalf("ids changed across a reboot: %v then %v", before, after)
		}
	}
	// None of these devices reported a serial, so none of the ids may claim to
	// survive being moved to another port.
	for id, tier := range tiers {
		if tier != string(tierLocation) {
			t.Errorf("%s rests on %q, want %q", id, tier, tierLocation)
		}
	}
}

// TestWindowsSerialIdSurvivesADifferentPort is the case the first release could
// not hold: the whole instance ID changes when a device moves, so hashing it
// renamed hardware that had not changed.
func TestWindowsSerialIdSurvivesADifferentPort(t *testing.T) {
	first, firstTiers := windowsIDs(t, map[string]string{
		`HID\VID_1532&PID_0084&MI_00\9&35a1d4f2&0&0000`: classKeyboard,
	})
	second, _ := windowsIDs(t, map[string]string{
		// Same keyboard, different port: the generated instance is gone
		// because this enumeration read the device's serial instead.
		`HID\VID_1532&PID_0084&MI_00\00000000001A`: classKeyboard,
	})
	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("fixtures = %v / %v", first, second)
	}
	if firstTiers[first[0]] != string(tierLocation) {
		t.Fatalf("a generated instance must not be read as a serial: %v", firstTiers)
	}
	// The two differ on purpose: an id derived from where a device was cannot
	// become an id derived from what it is. What the serial buys is that the id
	// derived from it stays put afterwards.
	third, thirdTiers := windowsIDs(t, map[string]string{
		`HID\VID_1532&PID_0084&MI_00\00000000001A`: classKeyboard,
	})
	if third[0] != second[0] {
		t.Fatalf("serial-derived id is not stable: %q then %q", second[0], third[0])
	}
	if thirdTiers[third[0]] != string(tierSerial) {
		t.Fatalf("tier = %v, want serial", thirdTiers)
	}
}

// One composite device is several logical devices, and Windows says so with
// MI_ and COL. They have to stay apart for the same reason a Linux receiver's
// two interfaces do.
func TestWindowsCompositeInterfacesStayApart(t *testing.T) {
	ids, tiers := windowsIDs(t, map[string]string{
		`HID\VID_04D9&PID_1203&MI_00\00000000ABCD`:       classKeyboard,
		`HID\VID_04D9&PID_1203&MI_01&COL01\00000000ABCD`: classRawInput,
	})
	if len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("ids = %v, want two distinct devices", ids)
	}
	for id, tier := range tiers {
		if tier != string(tierSerial) {
			t.Errorf("%s rests on %q, want %q", id, tier, tierSerial)
		}
	}
}

// The prefix is for the person reading the list, and a vendor of all zeros
// tells them nothing — so it is left off rather than used to group unrelated
// devices under one meaningless heading.
func TestZeroVendorIsLeftOutOfTheIdPrefix(t *testing.T) {
	entry := Found{
		Key:      "/devices/LNXSYSTM:00/LNXSYBUS:00/PNP0C0C:00/input/input0",
		Class:    classRawInput,
		Name:     "Power Button",
		Identity: Identity{Bus: "0019", Vendor: "0000", Product: "0001", Location: "PNP0C0C/button/input0", Interface: "input0"},
	}
	result := devicesFrom([]Found{entry})
	if len(result.Devices) != 1 {
		t.Fatalf("devices = %v", result.Devices)
	}
	id := result.Devices[0].ID
	if !strings.HasPrefix(id, string(inventory.DeviceRawBus)+"-") {
		t.Fatalf("id = %q, want the kind in front", id)
	}
	if strings.Contains(id, "-0000-") {
		t.Fatalf("id = %q carries an all-zero vendor prefix, which names nothing", id)
	}
}
