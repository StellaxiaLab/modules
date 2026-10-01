//go:build linux

package weave

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"
	"testing"
	"unsafe"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

// G-27, from the creating side.
//
// io.terra.io-inventory excludes Terra's own projections with exactly one
// predicate — protocol.IsTerraVirtualInput, called from
// module/leaf/io.terra.io-inventory/src/discovery/procinput.go:57 on the
// vendor, product and sysfs path it reads out of /proc/bus/input/devices.
// There is nothing else in that filter, so a device that satisfies the
// predicate is a device the inventory skips.
//
// This is the half the other module cannot test. The inventory's own tests
// pin a block captured from a probe device in September; nothing pinned that
// what io-weave would eventually CREATE still matches it. Change any of the
// three values below and this fails here, before a node starts republishing
// another node's mouse as its own.
func TestCreatedPointerCarriesTheReservedIdentity(t *testing.T) {
	setup := pointerDeviceSetup()
	if setup.ID.BusType != protocol.VirtualInputBus {
		t.Errorf("bus = %#04x, want protocol.VirtualInputBus %#04x", setup.ID.BusType, protocol.VirtualInputBus)
	}
	if setup.ID.Vendor != protocol.VirtualInputVendor {
		t.Errorf("vendor = %#04x, want protocol.VirtualInputVendor %#04x", setup.ID.Vendor, protocol.VirtualInputVendor)
	}
	if setup.ID.Product != protocol.VirtualInputProduct {
		t.Errorf("product = %#04x, want protocol.VirtualInputProduct %#04x", setup.ID.Product, protocol.VirtualInputProduct)
	}
	name := string(bytes.TrimRight(setup.Name[:], "\x00"))
	if name != uinputDeviceName {
		t.Errorf("device name = %q, want %q", name, uinputDeviceName)
	}

	// And the identity, as the kernel will report it, is what the inventory
	// skips. The sysfs prefix is the second half of the predicate and is the
	// kernel's to choose — uinput devices have no physical parent, so they
	// land under /devices/virtual — which is why the live test below asks the
	// kernel rather than asserting it here.
	if !protocol.IsTerraVirtualInput(setup.ID.Vendor, setup.ID.Product, "/devices/virtual/input/input0") {
		t.Fatal("io-inventory would enumerate this node's projected pointer as its own hardware")
	}
}

// The structs handed to ioctl must be the kernel's, byte for byte. Go will
// happily lay out something close, and an ABI that is close writes the right
// values to the wrong offsets — a device that comes up with no axes, or with
// an identity nobody recognises, and no error anywhere.
func TestKernelStructLayoutsMatchTheHeaders(t *testing.T) {
	// linux/input.h and linux/uinput.h on a 64-bit kernel.
	for _, check := range []struct {
		what string
		got  uintptr
		want uintptr
	}{
		{"struct input_id", unsafe.Sizeof(inputID{}), 8},
		{"struct uinput_setup", unsafe.Sizeof(uinputSetup{}), 92},
		{"struct input_absinfo", unsafe.Sizeof(inputAbsInfo{}), 24},
		{"struct uinput_abs_setup", unsafe.Sizeof(uinputAbsSetup{}), 28},
		{"uinput_abs_setup.absinfo offset", unsafe.Offsetof(uinputAbsSetup{}.AbsInfo), 4},
	} {
		if check.got != check.want {
			t.Errorf("%s = %d bytes, want %d", check.what, check.got, check.want)
		}
	}

	// The request numbers follow from those sizes, so pinning them catches a
	// layout change that happened to keep a size the same.
	for _, check := range []struct {
		what string
		got  uintptr
		want uintptr
	}{
		{"UI_DEV_CREATE", uiDevCreate, 0x5501},
		{"UI_DEV_DESTROY", uiDevDestroy, 0x5502},
		{"UI_DEV_SETUP", uiDevSetup, 0x405c5503},
		{"UI_ABS_SETUP", uiAbsSetup, 0x401c5504},
		{"UI_SET_EVBIT", uiSetEvBit, 0x40045564},
		{"UI_SET_KEYBIT", uiSetKeyBit, 0x40045565},
		{"UI_SET_RELBIT", uiSetRelBit, 0x40045566},
		{"UI_SET_ABSBIT", uiSetAbsBit, 0x40045567},
	} {
		if check.got != check.want {
			t.Errorf("%s = %#x, want %#x", check.what, check.got, check.want)
		}
	}
}

// requireUinput skips when this machine has no uinput to talk to.
//
// Skipped rather than faked, and the skip says which of the two reasons it
// was: a kernel without the node and a node without permission are fixed by
// different people (modprobe versus the udev rule D-25 installs), and a test
// that said only "skipped" would send both of them looking in the wrong place.
func requireUinput(t *testing.T) {
	t.Helper()
	handle, err := os.OpenFile(uinputDevice, os.O_WRONLY, 0)
	if err == nil {
		_ = handle.Close()
		return
	}
	switch {
	case errors.Is(err, fs.ErrNotExist):
		t.Skipf("%s does not exist on this machine (modprobe uinput); the creation path is unmeasured here", uinputDevice)
	case errors.Is(err, fs.ErrPermission):
		t.Skipf("%s is not writable by this user (run config/install/linux/install-uinput-access.sh as root); the creation path is unmeasured here", uinputDevice)
	default:
		t.Skipf("cannot open %s: %v", uinputDevice, err)
	}
}

// The live half: the kernel really creates the device, really enumerates it,
// and the identity it reports is the one io-inventory skips.
//
// Everything above this point is Terra checking its own arithmetic. This is
// the only test that asks the kernel, and it is the one that would catch a
// uinput ABI that moved under us or a sysfs layout that is not what the
// predicate assumes.
func TestCreatedPointerIsEnumeratedAsOneOfOurs(t *testing.T) {
	requireUinput(t)

	device, err := newUinputPointer()
	if err != nil {
		t.Fatalf("create the virtual pointer: %v", err)
	}
	defer func() { _ = device.Close() }()

	if device.SysfsPath() == "" {
		t.Fatal("the kernel would not say where it put the device; the exclusion's second half cannot be checked")
	}
	if !strings.HasPrefix(device.SysfsPath(), "/devices/virtual/") {
		t.Fatalf("sysfs path = %q, want it under /devices/virtual/ — the exclusion tests that prefix",
			device.SysfsPath())
	}

	block, err := procInputBlockFor(device.SysfsPath())
	if err != nil {
		t.Fatalf("find the created device in /proc/bus/input/devices: %v", err)
	}
	vendor, product, err := identityFromProcBlock(block)
	if err != nil {
		t.Fatalf("read the identity the kernel reports: %v\n%s", err, block)
	}
	// The one predicate io-inventory applies, on the values the kernel
	// actually published rather than the ones we meant to publish.
	if !protocol.IsTerraVirtualInput(vendor, product, device.SysfsPath()) {
		t.Fatalf("io-inventory would republish this device as this node's own hardware:\n%s", block)
	}

	// It moves. The pointer landing somewhere is the display server's affair
	// — a headless node has none — but the write reaching the kernel is ours,
	// and a device that refuses one is not a device.
	if err := device.Pointer(protocol.PointerEvent{
		Position: protocol.PointerPosition{X: protocol.PointerPositionMax / 2, Y: protocol.PointerPositionMax / 2},
		Buttons:  []protocol.PointerButton{protocol.PointerButtonLeft},
	}); err != nil {
		t.Fatalf("inject a pointer frame: %v", err)
	}
	if err := device.Release(); err != nil {
		t.Fatalf("release the held button: %v", err)
	}
	if err := device.Close(); err != nil {
		t.Fatalf("destroy the device: %v", err)
	}
	// Closing twice is the ordinary case, not the exotic one: a binding
	// tearing down while the watchdog fires does exactly this.
	if err := device.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
	if err := device.Pointer(protocol.PointerEvent{}); !errors.Is(err, errInjectionClosed) {
		t.Fatalf("writing to a destroyed device = %v, want %v", err, errInjectionClosed)
	}
}

// procInputBlockFor returns the /proc/bus/input/devices block whose Sysfs line
// names this path.
func procInputBlockFor(sysfs string) (string, error) {
	content, err := os.ReadFile("/proc/bus/input/devices")
	if err != nil {
		return "", err
	}
	for _, block := range strings.Split(string(content), "\n\n") {
		if strings.Contains(block, "S: Sysfs="+sysfs+"\n") || strings.HasSuffix(strings.TrimRight(block, "\n"), "S: Sysfs="+sysfs) {
			return block, nil
		}
	}
	return "", fmt.Errorf("no block names sysfs %q", sysfs)
}

// identityFromProcBlock reads the vendor and product off the "I:" line, the
// same line io-inventory's parser reads.
func identityFromProcBlock(block string) (uint16, uint16, error) {
	for _, line := range strings.Split(block, "\n") {
		if !strings.HasPrefix(line, "I: ") {
			continue
		}
		var vendor, product uint16
		for _, field := range strings.Fields(strings.TrimPrefix(line, "I: ")) {
			key, value, ok := strings.Cut(field, "=")
			if !ok {
				continue
			}
			parsed, err := strconv.ParseUint(value, 16, 16)
			if err != nil {
				continue
			}
			switch key {
			case "Vendor":
				vendor = uint16(parsed)
			case "Product":
				product = uint16(parsed)
			}
		}
		return vendor, product, nil
	}
	return 0, 0, errors.New("no identity line")
}
