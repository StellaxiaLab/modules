//go:build !linux

package vdevice

// newPlatformAdapters returns the real adapters of this OS. Only Linux has one
// in this build; elsewhere the registry keeps the Fake and the declared-but-absent
// placeholder from plannedAdapters, and a Slot on the placeholder is refused with
// VDEV_ADAPTER_UNAVAILABLE.
func newPlatformAdapters(map[string]string) []Adapter { return nil }
