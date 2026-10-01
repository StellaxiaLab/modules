package discovery

import (
	"fmt"
	"testing"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

// The other half of G-27, pinned from the identity rather than from a
// transcript.
//
// TestUinputDeviceIsIndistinguishableFromPhysical next door pins a block
// captured from a probe device on 2026-09-03, with the vendor and product
// written out in hex. That was the right thing to pin before anything created
// such a device — it proves the parser handles a real one — but it stops being
// a test of the EXCLUSION the moment those constants move: the fixture would
// go on carrying 1209/7e88 while both modules agreed on something else, and it
// would pass while a node republished another node's mouse as its own.
//
// So this one builds its block out of protocol.VirtualInput*, the constants
// io.terra.io-weave stamps on the device it creates
// (io.terra.io-weave/src/weave/uinput_linux.go, pinned there by
// TestCreatedPointerCarriesTheReservedIdentity). Both modules now derive from
// the same three values, and there is no arrangement in which one side changes
// and every test still passes.
func TestTheIdentityIOWeaveStampsIsTheOneThisModuleSkips(t *testing.T) {
	const sysfs = "/devices/virtual/input/input11"
	block := fmt.Sprintf(`I: Bus=%04x Vendor=%04x Product=%04x Version=0001
N: Name="Terra io-weave projected pointer"
P: Phys=
S: Sysfs=%s
U: Uniq=
H: Handlers=mouse0 event11
B: PROP=0
B: EV=f
B: KEY=70000 0 0 0 0
B: REL=140
B: ABS=3
`, protocol.VirtualInputBus, protocol.VirtualInputVendor, protocol.VirtualInputProduct, sysfs)

	found := parseProcInputDevices(block)
	if len(found) != 1 {
		t.Fatalf("parsed %d devices, want 1: %#v", len(found), found)
	}
	if !found[0].Synthetic {
		t.Fatalf("a device carrying io-weave's stamp was not recognised as Terra's own: %#v", found[0])
	}
	result := devicesFrom(found)
	if len(result.Devices) != 0 || result.Skipped != 1 {
		t.Fatalf("devicesFrom = %d device(s), %d skipped; want 0 and 1 — this node would publish its own projection",
			len(result.Devices), result.Skipped)
	}
}

// An absolute pointer is what io-weave creates (protocol.PointerPosition is
// normalized absolute space, not deltas), so the exclusion has to survive a
// device with ABS axes and no REL_X/REL_Y. This classifies as `raw` rather
// than `mouse` — the class heuristic asks for relative axes — and that is
// fine, because the exclusion is consulted before the class is. Pinned so
// nobody later "fixes" the ordering and lets a synthetic device through on
// the strength of being unclassifiable.
func TestTheExclusionRunsBeforeTheClassification(t *testing.T) {
	block := fmt.Sprintf(`I: Bus=%04x Vendor=%04x Product=%04x Version=0001
N: Name="Terra io-weave projected pointer"
S: Sysfs=/devices/virtual/input/input12
H: Handlers=event12
B: EV=f
B: KEY=70000 0 0 0 0
B: ABS=3
`, protocol.VirtualInputBus, protocol.VirtualInputVendor, protocol.VirtualInputProduct)

	found := parseProcInputDevices(block)
	if len(found) != 1 {
		t.Fatalf("parsed %d devices, want 1", len(found))
	}
	if !found[0].Synthetic {
		t.Fatal("an absolute projected pointer was not recognised as Terra's own")
	}
	result := devicesFrom(found)
	if len(result.Devices) != 0 || result.Skipped != 1 {
		t.Fatalf("devicesFrom = %d device(s), %d skipped; want 0 and 1", len(result.Devices), result.Skipped)
	}
}
