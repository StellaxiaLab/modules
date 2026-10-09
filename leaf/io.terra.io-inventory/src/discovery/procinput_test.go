package discovery

import (
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
)

// Blocks copied from a real /proc/bus/input/devices, trimmed to the lines the
// parser reads. The bitmaps are the point: they are what says a device is a
// mouse rather than what its name claims.
const procInputSample = `I: Bus=0019 Vendor=0000 Product=0001 Version=0000
N: Name="Power Button"
P: Phys=PNP0C0C/button/input0
S: Sysfs=/devices/LNXSYSTM:00/LNXSYBUS:00/PNP0C0C:00/input/input0
U: Uniq=
H: Handlers=kbd event0
B: PROP=0
B: EV=3
B: KEY=10000000000000 0

I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver"
P: Phys=usb-0000:00:14.0-3/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.0/0003:046D:C534.0001/input/input5
U: Uniq=
H: Handlers=sysrq kbd event5 leds
B: PROP=0
B: EV=120013
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe
B: MSC=10
B: LED=1f

I: Bus=0003 Vendor=046d Product=c534 Version=0111
N: Name="Logitech USB Receiver Mouse"
P: Phys=usb-0000:00:14.0-3/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-3/1-3:1.1/0003:046D:C534.0002/input/input6
U: Uniq=
H: Handlers=mouse0 event6
B: PROP=0
B: EV=17
B: KEY=1f0000 0 0 0 0
B: REL=903
B: MSC=10

I: Bus=0003 Vendor=28de Product=1142 Version=0111
N: Name="Valve Software Steam Controller"
P: Phys=usb-0000:00:14.0-5/input2
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-5/1-5:1.2/0003:28DE:1142.0005/input/input9
U: Uniq=
H: Handlers=event9
B: PROP=0
B: EV=100001
B: KEY=0
`

func TestParseProcInputDevicesClassifiesByCapability(t *testing.T) {
	found := parseProcInputDevices(procInputSample)
	if len(found) != 4 {
		t.Fatalf("found = %d, want 4: %#v", len(found), found)
	}

	byName := map[string]Found{}
	for _, entry := range found {
		byName[entry.Name] = entry
	}
	for name, want := range map[string]string{
		// EV_KEY only, and a single key bit: not a keyboard, whatever its name.
		"Power Button": classRawInput,
		// The receiver's keyboard interface carries the typing keys.
		"Logitech USB Receiver": classKeyboard,
		// REL_X, REL_Y and BTN_LEFT — a pointer even though its name is shared
		// with the keyboard interface above.
		"Logitech USB Receiver Mouse": classMouse,
		// A device with neither: passed through as raw.
		"Valve Software Steam Controller": classRawInput,
	} {
		entry, ok := byName[name]
		if !ok {
			t.Fatalf("missing device %q", name)
		}
		if entry.Class != want {
			t.Fatalf("%q class = %q, want %q", name, entry.Class, want)
		}
		if entry.Key == "" {
			t.Fatalf("%q has no sysfs key", name)
		}
	}

	// Every classified block survives into a usable device with an id of its
	// own; identity_test.go is where those ids are held to surviving a reboot.
	devices := devicesFrom(found).Devices
	if len(devices) != 4 {
		t.Fatalf("devices = %d, want 4", len(devices))
	}
	kinds := map[inventory.DeviceKind]int{}
	for _, device := range devices {
		kinds[device.Kind]++
	}
	if kinds[inventory.DeviceMouse] != 1 || kinds[inventory.DeviceKeyboard] != 1 || kinds[inventory.DeviceRawBus] != 2 {
		t.Fatalf("kinds = %#v", kinds)
	}
}

func TestBitmapHasReadsWordsFromTheRight(t *testing.T) {
	// Two 64-bit words, most significant first: bit 64 is the low bit of the
	// first word, bit 0 the low bit of the last.
	const bitmap = "1 8000000000000001"
	for bit, want := range map[uint]bool{0: true, 1: false, 63: true, 64: true, 65: false, 128: false} {
		if got := bitmapHas(bitmap, bit); got != want {
			t.Fatalf("bit %d = %t, want %t", bit, got, want)
		}
	}
	if bitmapHas("", 0) || bitmapHas("zz", 0) {
		t.Fatal("an unreadable bitmap holds no bits")
	}
}

func TestParseProcInputDevicesSkipsIncompleteBlocks(t *testing.T) {
	// A block with no sysfs path has no stable key, so it cannot become a
	// device id — dropping it is better than inventing one.
	found := parseProcInputDevices("I: Bus=0019\nN: Name=\"No sysfs\"\nB: EV=3\n\n")
	if len(found) != 0 {
		t.Fatalf("found = %#v", found)
	}
}

// TestUinputDeviceIsIndistinguishableFromPhysical feeds this parser the exact
// block a uinput device produced on marui-server (2026-09-03 injection
// probe). It classifies as a mouse, which is the point: the enumeration axis
// sees what the injection axis creates, and nothing in the block marks it as
// synthetic except the Sysfs path.
//
// That is a hazard, not a feature. A virtual mouse io-weave creates on node B
// to reproduce node A's mouse is enumerated on node B as one of node B's own
// devices, and once approved it is published again as node B's SVI resource —
// so node C can subscribe to node B's copy of node A's mouse. The exclusion
// has to exist before injection ships; this test pins the input it will need
// to recognise.
func TestUinputDeviceIsIndistinguishableFromPhysical(t *testing.T) {
	const block = `I: Bus=0003 Vendor=1209 Product=7e88 Version=0001
N: Name="Terra io-weave probe mouse"
P: Phys=
S: Sysfs=/devices/virtual/input/input11
U: Uniq=
H: Handlers=mouse0 event11
B: PROP=0
B: EV=7
B: KEY=10000 0 0 0 0
B: REL=3
`
	found := parseProcInputDevices(block)
	if len(found) != 1 {
		t.Fatalf("parsed %d devices, want 1: %#v", len(found), found)
	}
	device := found[0]
	if device.Class != "mouse" {
		t.Errorf("class = %q, want mouse — a uinput pointer must classify like any other", device.Class)
	}
	if device.Key != "/devices/virtual/input/input11" {
		t.Errorf("key = %q, want the sysfs path", device.Key)
	}
	if !strings.HasPrefix(device.Key, "/devices/virtual/") {
		t.Errorf("key %q no longer carries the virtual marker the exclusion depends on", device.Key)
	}
	// Nothing in the block says "synthetic" — the verdict comes from the
	// reserved vendor/product pair on the identity line plus that path.
	if !device.Synthetic {
		t.Error("device not marked synthetic: io-inventory would publish Terra's own projection as this node's device")
	}
	// And it must not reach the inventory.
	result := devicesFrom(found)
	if len(result.Devices) != 0 || result.Skipped != 1 {
		t.Errorf("devicesFrom = %d device(s), %d skipped; want 0 and 1", len(result.Devices), result.Skipped)
	}
}

// A virtual device Terra did not create is still this node's device. The
// exclusion asks two questions, and a rule that asked only about the sysfs
// path would swallow every loopback and portal shim on the machine.
func TestOtherProjectsVirtualDeviceIsStillEnumerated(t *testing.T) {
	const block = `I: Bus=0003 Vendor=0000 Product=0000 Version=0000
N: Name="Some other virtual pointer"
S: Sysfs=/devices/virtual/input/input12
H: Handlers=mouse1 event12
B: EV=7
B: KEY=10000 0 0 0 0
B: REL=3
`
	found := parseProcInputDevices(block)
	if len(found) != 1 {
		t.Fatalf("parsed %d devices, want 1", len(found))
	}
	if found[0].Synthetic {
		t.Error("marked synthetic: only devices carrying Terra's reserved identity are ours")
	}
	result := devicesFrom(found)
	if len(result.Devices) != 1 || result.Skipped != 0 {
		t.Errorf("devicesFrom = %d device(s), %d skipped; want 1 and 0", len(result.Devices), result.Skipped)
	}
}
