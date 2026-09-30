//go:build !windows && !linux

package discovery

import (
	"fmt"
	"runtime"
)

const (
	watchPlatform = runtime.GOOS
	// A platform with no enumerate() has nothing for a watcher to re-read, so
	// the watcher reports WatchNone rather than polling a scan that answers
	// ErrUnsupported every time. This mirrors discovery_other.go: the honest
	// answer is "cannot look", never an empty list on a timer.
	enumerationAvailable = false
)

func newPlatformSource() (Source, string, error) {
	return nil, "", fmt.Errorf("no I/O enumeration on %s: %w", runtime.GOOS, ErrWatchUnsupported)
}
