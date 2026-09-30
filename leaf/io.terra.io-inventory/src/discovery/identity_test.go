package discovery

import (
	"sort"
	"strings"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

// The two fixtures below are the same three devices on the same machine, read
// from /proc/bus/input/devices before and after a reboot. Nothing about the
// hardware changed; what changed is everything the kernel hands out in
// enumeration order — the global `inputN` index, the `.000N` HID counter above
// it, and therefore the whole sysfs path. That is why the sysfs path could not
// be the identity: it renamed every device on every boot, and the approvals and
// aliases a person had set stayed behind on ids nothing would answer to again.
//
// What did not change is on the other lines: `I:` says what the device is,
// `U: Uniq=` is the serial when the device reports one, and `P: Phys=` is where
// it is attached.
const procInputBeforeReboot = `I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver"
P: Phys=usb-0000:00:14.0-3/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.0/0003:046D:C534.0001/input/input5
U: Uniq=
H: Handlers=sysrq kbd event5 leds
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver Mouse"
P: Phys=usb-0000:00:14.0-3/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/0003:046D:C534.0002/input/input6
U: Uniq=
H: Handlers=mouse0 event6
B: EV=17
B: KEY=1f0000 0 0 0 0
B: REL=903

I: Bus=0003 Vendor=1532 Product=0084 Version=0111
N: Name="Razer Razer Huntsman"
P: Phys=usb-0000:00:14.0-7/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-7/1-7:1.0/0003:1532:0084.0003/input/input8
U: Uniq=00000000001A
H: Handlers=sysrq kbd event8 leds
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
`

// The same three devices after a reboot. Every sysfs path moved; the receiver
// also came up in a different order than the keyboard this time, which is
// exactly how the indices drift.
const procInputAfterReboot = `I: Bus=0003 Vendor=1532 Product=0084 Version=0111
N: Name="Razer Razer Huntsman"
P: Phys=usb-0000:00:14.0-7/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-7/1-7:1.0/0003:1532:0084.0001/input/input4
U: Uniq=00000000001A
H: Handlers=sysrq kbd event4 leds
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver"
P: Phys=usb-0000:00:14.0-3/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.0/0003:046D:C534.0004/input/input9
U: Uniq=
H: Handlers=sysrq kbd event9 leds
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver Mouse"
P: Phys=usb-0000:00:14.0-3/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/0003:046D:C534.0005/input/input10
U: Uniq=
H: Handlers=mouse0 event10
B: EV=17
B: KEY=1f0000 0 0 0 0
B: REL=903
`

func idsOf(text string) []string {
	result := devicesFrom(parseProcInputDevices(text))
	ids := make([]string, 0, len(result.Devices))
	for _, device := range result.Devices {
		ids = append(ids, device.ID)
	}
	sort.Strings(ids)
	return ids
}

func tiersOf(text string) map[string]string {
	return devicesFrom(parseProcInputDevices(text)).Tiers
}

// TestLinuxDeviceIdsSurviveAReboot is the completion condition of persistent
// identity, held by fixture because no test can reboot the machine it runs on.
func TestLinuxDeviceIdsSurviveAReboot(t *testing.T) {
	before := idsOf(procInputBeforeReboot)
	after := idsOf(procInputAfterReboot)
	if len(before) != 3 {
		t.Fatalf("before = %v, want 3 devices", before)
	}
	if strings.Join(before, ",") != strings.Join(after, ",") {
		t.Fatalf("ids changed across a reboot:\n before %v\n after  %v", before, after)
	}

	// And none of them may rest on the path, which is the thing that moved.
	for id, tier := range tiersOf(procInputAfterReboot) {
		if tier == string(tierPath) {
			t.Errorf("%s still rests on the OS path, which a reboot rewrites", id)
		}
	}
}

// TestSerialIdSurvivesADifferentPort separates the two promises. A device that
// reports its own serial keeps its id when it is moved; one that does not
// cannot, and must not be described as if it could.
func TestSerialIdSurvivesADifferentPort(t *testing.T) {
	const port7 = `I: Bus=0003 Vendor=1532 Product=0084 Version=0111
N: Name="Razer Razer Huntsman"
P: Phys=usb-0000:00:14.0-7/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-7/1-7:1.0/0003:1532:0084.0003/input/input8
U: Uniq=00000000001A
H: Handlers=kbd event8
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
`
	// Same keyboard, front panel instead of the back.
	const port2 = `I: Bus=0003 Vendor=1532 Product=0084 Version=0111
N: Name="Razer Razer Huntsman"
P: Phys=usb-0000:00:14.0-2/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0/0003:1532:0084.0007/input/input3
U: Uniq=00000000001A
H: Handlers=kbd event3
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
`
	moved, stayed := idsOf(port2), idsOf(port7)
	if len(stayed) != 1 || len(moved) != 1 {
		t.Fatalf("fixtures = %v / %v, want one device each", stayed, moved)
	}
	if moved[0] != stayed[0] {
		t.Fatalf("a serial-bearing device changed id when it moved port: %q then %q", stayed[0], moved[0])
	}
	if got := tiersOf(port2)[moved[0]]; got != string(tierSerial) {
		t.Fatalf("tier = %q, want %q", got, tierSerial)
	}
}

// TestOneReceiverKeepsItsInterfacesApart is why Identity carries an interface
// at all. A wireless receiver is one piece of hardware with one serial that
// presents itself as a keyboard and as a mouse; without the interface both
// halves say exactly the same thing about themselves, the serial belongs to two
// devices, and neither may keep it.
func TestOneReceiverKeepsItsInterfacesApart(t *testing.T) {
	const receiver = `I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech Unifying Keyboard"
P: Phys=usb-0000:00:14.0-3/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.0/0003:046D:C52B.0001/input/input5
U: Uniq=4029ab17
H: Handlers=kbd event5
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech Unifying Mouse"
P: Phys=usb-0000:00:14.0-3/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/0003:046D:C52B.0002/input/input6
U: Uniq=4029ab17
H: Handlers=mouse0 event6
B: EV=17
B: KEY=1f0000 0 0 0 0
B: REL=903
`
	ids := idsOf(receiver)
	if len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("ids = %v, want two distinct devices", ids)
	}
	for id, tier := range tiersOf(receiver) {
		if tier != string(tierSerial) {
			t.Errorf("%s rests on %q; both interfaces of a receiver that reports a serial should keep it", id, tier)
		}
	}
}

// TestSharedIdentityStepsDownRatherThanColliding covers the case where two
// devices say the same thing about themselves — two of the same cheap keyboard,
// both reporting the vendor's placeholder serial. An identity two devices claim
// is not an identity, so both step down to where they actually differ rather
// than one of them winning and the other being merged into it.
func TestSharedIdentityStepsDownRatherThanColliding(t *testing.T) {
	const twins = `I: Bus=0003 Vendor=1a2c Product=2124 Version=0110
N: Name="SEMICO USB Keyboard"
P: Phys=usb-0000:00:14.0-1/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0/0003:1A2C:2124.0001/input/input4
U: Uniq=0000000000000000
H: Handlers=kbd event4
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

I: Bus=0003 Vendor=1a2c Product=2124 Version=0110
N: Name="SEMICO USB Keyboard"
P: Phys=usb-0000:00:14.0-4/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-4/1-4:1.0/0003:1A2C:2124.0002/input/input7
U: Uniq=0000000000000000
H: Handlers=kbd event7
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
`
	ids := idsOf(twins)
	if len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("ids = %v; two devices must not merge into one", ids)
	}
	for id, tier := range tiersOf(twins) {
		if tier != string(tierLocation) {
			t.Errorf("%s rests on %q, want %q — a serial two devices report is not a serial", id, tier, tierLocation)
		}
	}
}

// TestRenamedNamesTheIdAnUpgradeHasToRescue is what AdoptPolicies consumes. A
// node that has been running has policy filed under the old ids, and this map
// is the only place the two names are known at once.
func TestRenamedNamesTheIdAnUpgradeHasToRescue(t *testing.T) {
	found := parseProcInputDevices(procInputBeforeReboot)
	result := devicesFrom(found)
	if len(result.Renamed) != len(result.Devices) {
		t.Fatalf("renamed = %v; every device's id moved when identity replaced the path", result.Renamed)
	}
	for _, device := range result.Devices {
		legacy, ok := result.Renamed[device.ID]
		if !ok {
			t.Fatalf("%s has no legacy id", device.ID)
		}
		if legacy == device.ID {
			t.Fatalf("%s maps to itself", device.ID)
		}
		if !strings.HasPrefix(legacy, string(device.Kind)+"-") {
			t.Fatalf("legacy id %q is not of kind %q", legacy, device.Kind)
		}
	}
}

// A platform that says nothing about a device still has to give it an id, and
// the tier has to admit what that id rests on.
func TestDeviceWithNoIdentityFallsBackToThePath(t *testing.T) {
	entry := Found{Key: "/devices/platform/i8042/serio0/input/input1", Class: classKeyboard, Name: "AT Translated Set 2 keyboard"}
	result := devicesFrom([]Found{entry})
	if len(result.Devices) != 1 {
		t.Fatalf("devices = %v", result.Devices)
	}
	if got := result.Tiers[result.Devices[0].ID]; got != string(tierPath) {
		t.Fatalf("tier = %q, want %q", got, tierPath)
	}
	if result.Devices[0].Kind != inventory.DeviceKeyboard {
		t.Fatalf("kind = %q", result.Devices[0].Kind)
	}
}
