//go:build linux

package discovery

import (
	"fmt"
	"os"
)

// procInputDevices is the kernel's own account of every input device that has a
// handler right now — which is what presence means here, the same as the
// Windows adapter's "present" filter.
const procInputDevices = "/proc/bus/input/devices"

func enumerate() ([]Found, error) {
	data, err := os.ReadFile(procInputDevices)
	if err != nil {
		// A node whose kernel does not expose this file is a node we cannot
		// look at, not a node without devices — so this is an error, never an
		// empty list.
		return nil, fmt.Errorf("read %s: %w", procInputDevices, err)
	}
	return parseProcInputDevices(string(data)), nil
}
