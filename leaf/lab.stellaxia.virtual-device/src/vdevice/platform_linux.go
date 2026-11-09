//go:build linux

package vdevice

// newPlatformAdapters returns the real adapters of this OS. devices maps a
// slot id to the /dev/videoN node the operator pre-created with v4l2loopback;
// Terra does not load kernel modules or create nodes (design principle §4.3).
// The adapter's id equals the declared-but-unbuilt placeholder's, so
// registering it replaces that entry.
func newPlatformAdapters(devices map[string]string) []Adapter {
	return []Adapter{newV4L2Adapter(devices, openV4L2File)}
}
