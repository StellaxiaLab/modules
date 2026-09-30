package discovery

import (
	"os"
	"testing"
)

// TestManualScanPrintsRealHardware is the eyeball test for the platform
// adapter. Unit tests can prove the mapping; only real hardware can prove the
// enumeration, and what it returns cannot be asserted on — it differs per
// machine. So this runs on request and prints.
//
//	go test ./discovery -run TestManualScan -v   (with TERRA_IO_MANUAL_SCAN=1)
func TestManualScanPrintsRealHardware(t *testing.T) {
	if os.Getenv("TERRA_IO_MANUAL_SCAN") == "" {
		t.Skip("set TERRA_IO_MANUAL_SCAN=1 to enumerate this machine's devices")
	}
	result, err := Scan()
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if result.Skipped > 0 {
		t.Logf("skipped %d device(s) Terra projected onto this machine", result.Skipped)
	}
	t.Logf("%d devices", len(result.Devices))
	for _, device := range result.Devices {
		// The tier is the part worth reading on real hardware: it says whether
		// this id will survive the device being moved to another port, or only
		// a reboot.
		t.Logf("  %-34s %-9s %-8s %s", device.ID, device.Kind, result.Tiers[device.ID], device.Name)
	}
}
