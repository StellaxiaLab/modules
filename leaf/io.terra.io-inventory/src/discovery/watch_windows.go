//go:build windows

package discovery

import "fmt"

const (
	watchPlatform        = "windows/cfgmgr32"
	enumerationAvailable = true
)

// Windows has an event source and this build does not use it.
//
// `CM_Register_Notification` is the one that fits: it is the cfgmgr32 half of
// the same PnP manager discovery_windows.go already enumerates through, and it
// answers from session 0 where the module host runs modules. `WM_DEVICECHANGE`
// is the better-known path and the wrong one here — it needs a window and a
// message pump, which a service does not have.
//
// It is not built yet because it is callback-based: the kernel calls back into
// the process, which from Go means syscall.NewCallback and a handler that must
// not block, allocate carelessly, or outlive its registration. Getting that
// wrong crashes the module rather than misreporting a device, and nobody here
// has a Windows node to measure it on — the same reason injection_windows.go in
// io-weave measures its precondition instead of claiming the backend.
//
// So the watcher polls, and says so. The inventory is correct either way; what
// differs is that a plugged device takes up to one poll interval to appear.
func newPlatformSource() (Source, string, error) {
	return nil, "no event source in this build; CM_Register_Notification is the path, and polling stands in until it is built and measured",
		fmt.Errorf("windows uevent equivalent not built: %w", ErrWatchUnsupported)
}
