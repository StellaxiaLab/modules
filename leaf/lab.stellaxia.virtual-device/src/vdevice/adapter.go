package vdevice

import (
	"runtime"
	"sort"
	"strings"
	"sync"
)

// Adapter is what a Virtual Device Adapter must do for the controller (§9.1,
// §15). It is small on purpose: an adapter registers and removes a stable OS
// device for a Slot, and says what it is. Frame delivery is the optional
// FrameAdapter extension (frames.go): the sink the Daemon opens hands each frame
// to the adapter's FrameSink, and the per-Slot "is this device usable" question
// is the optional SlotReadiness.
//
// Adapters come from a build-time allowlist (§9.1). There is no path here that
// loads a shared library or an executable found at runtime, and this module has
// no installation code at all: Driver and Extension changes are the signed Setup
// path's alone (design principle §4.3).
type Adapter interface {
	// Describe reports the adapter's identity, install state and health.
	Describe() AdapterDescriptor
	// EnsureSlot makes the OS device for this slot exist, returning its
	// os_device_id. Called again for the same slot it is an update, never a
	// remove-and-recreate: the device name has to stay stable across source
	// changes (design principle §4.8).
	EnsureSlot(slot Slot) (string, error)
	// RemoveSlot takes the OS device away. A slot the adapter does not know is
	// not an error — removal is idempotent.
	RemoveSlot(slotID string) error
}

// AdapterRegistry is the build-time allowlist of adapters this binary has.
type AdapterRegistry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
}

// NewAdapterRegistry builds the registry for this OS.
//
// It always contains the Fake adapter, and on a platform whose real adapter is
// not built yet it contains a declared-but-absent entry for that adapter too.
// The absent entry is the honest answer to "can this machine do it": leaving it
// out would say the OS is unsupported, when what is true is that Terra has not
// built it yet (design §25: Windows is Phase 3, macOS Phase 4; Linux's adapter
// is built and registered over its placeholder).
func NewAdapterRegistry() *AdapterRegistry {
	return NewAdapterRegistryWithDevices(nil)
}

// NewAdapterRegistryWithDevices is NewAdapterRegistry plus the operator's
// configured OS devices (config linux.devices: slot id -> /dev/videoN).
//
// Order matters: the Fake and the declared-but-absent placeholder go in first,
// then newPlatformAdapters (platform_linux.go / platform_other.go) registers the
// platform's real adapters over them. Register replaces by id, so a real adapter
// takes the placeholder's place and an OS with no real adapter keeps the
// placeholder.
func NewAdapterRegistryWithDevices(devices map[string]string) *AdapterRegistry {
	registry := &AdapterRegistry{adapters: map[string]Adapter{}}
	registry.Register(NewFakeAdapter())
	for _, descriptor := range plannedAdapters(runtime.GOOS) {
		registry.Register(unbuiltAdapter{descriptor: descriptor})
	}
	for _, adapter := range newPlatformAdapters(devices) {
		registry.Register(adapter)
	}
	return registry
}

// Register adds an adapter, replacing any adapter with the same id.
func (r *AdapterRegistry) Register(adapter Adapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[adapter.Describe().AdapterID] = adapter
}

// Lookup finds an adapter by id.
func (r *AdapterRegistry) Lookup(adapterID string) (Adapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapter, ok := r.adapters[strings.TrimSpace(adapterID)]
	return adapter, ok
}

// Describe lists every adapter, ordered by id so the API answer is stable.
func (r *AdapterRegistry) Describe() []AdapterDescriptor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	descriptors := make([]AdapterDescriptor, 0, len(r.adapters))
	for _, adapter := range r.adapters {
		descriptors = append(descriptors, adapter.Describe())
	}
	sort.Slice(descriptors, func(i, j int) bool { return descriptors[i].AdapterID < descriptors[j].AdapterID })
	return descriptors
}

// plannedAdapters names the real OS adapter each platform gets, or will get, with
// the phase that brings it. The OS order is the project's: Linux, Windows, macOS.
// The Linux entry is only a placeholder: newPlatformAdapters registers the real
// v4l2 adapter over it, so it is what a Linux build WITHOUT that adapter would
// list.
func plannedAdapters(goos string) []AdapterDescriptor {
	switch goos {
	case "linux":
		return []AdapterDescriptor{{
			AdapterID:        "linux.v4l2loopback",
			Kind:             KindCamera,
			OS:               "linux",
			InstallState:     StateNotInstalled,
			Health:           "not_built",
			Capabilities:     []string{},
			SupportedFormats: []Format{},
			Detail:           "V4L2 loopback adapter placeholder (design §15.1, §25): a Linux build normally replaces this entry with the real adapter; this one has no code that talks to v4l2loopback.",
		}}
	case "windows":
		return []AdapterDescriptor{{
			AdapterID:        "windows.mediafoundation",
			Kind:             KindCamera,
			OS:               "windows",
			InstallState:     StateNotInstalled,
			Health:           "not_built",
			Capabilities:     []string{},
			SupportedFormats: []Format{},
			Detail:           "Media Foundation Virtual Camera adapter arrives in Phase 3 (design §15.2, §25).",
		}}
	case "darwin":
		return []AdapterDescriptor{{
			AdapterID:        "macos.coremediaio",
			Kind:             KindCamera,
			OS:               "darwin",
			InstallState:     StateNotInstalled,
			Health:           "not_built",
			Capabilities:     []string{},
			SupportedFormats: []Format{},
			Detail:           "CoreMediaIO Camera Extension arrives in Phase 4 (design §15.3, §25).",
		}}
	default:
		return nil
	}
}

// unbuiltAdapter is a declared adapter with no implementation behind it. It
// answers /adapters so an operator can see what this platform is waiting for,
// and refuses every slot with the code §21 has for exactly this.
type unbuiltAdapter struct {
	descriptor AdapterDescriptor
}

func (a unbuiltAdapter) Describe() AdapterDescriptor { return a.descriptor }

func (a unbuiltAdapter) EnsureSlot(Slot) (string, error) {
	return "", domainError(ErrCodeAdapterUnavailable, "%s: %s", a.descriptor.AdapterID, a.descriptor.Detail)
}

func (a unbuiltAdapter) RemoveSlot(string) error { return nil }
