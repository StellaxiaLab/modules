package vdevice

import (
	"errors"
	"runtime"
	"strings"
	"testing"
)

// The one rule this phase has about honesty: a Fake says it is a Fake. If this
// ever passes silently while the descriptor drops Simulated, an operator reads
// an adapter list in which a device that does not exist looks like one that
// does.
func TestFakeAdapterReportsItselfAsFake(t *testing.T) {
	descriptor := NewFakeAdapter().Describe()
	if !descriptor.Simulated {
		t.Error("simulated = false on the in-memory adapter")
	}
	if descriptor.Health != "simulated" {
		t.Errorf("health = %q, want simulated", descriptor.Health)
	}
	if !strings.Contains(descriptor.AdapterID, "fake") {
		t.Errorf("adapter_id = %q; the id itself should say what it is", descriptor.AdapterID)
	}
	if descriptor.Detail == "" {
		t.Error("detail is empty; an operator needs to be told no OS device is created")
	}
}

func TestFakeAdapterKeepsTheDeviceIDAcrossReRegistration(t *testing.T) {
	adapter := NewFakeAdapter()
	slot := Slot{SlotID: "camera-main", Kind: KindCamera}
	first, err := adapter.EnsureSlot(slot)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	slot.DisplayName = "renamed"
	second, err := adapter.EnsureSlot(slot)
	if err != nil {
		t.Fatalf("ensure again: %v", err)
	}
	if first != second {
		t.Fatalf("os_device_id changed on update: %q then %q — §9.2 says it survives", first, second)
	}
	if !strings.HasPrefix(first, "fake:") {
		t.Errorf("os_device_id = %q; a simulated device id should look simulated", first)
	}
}

func TestFakeAdapterRemoveIsIdempotent(t *testing.T) {
	adapter := NewFakeAdapter()
	if err := adapter.RemoveSlot("never-existed"); err != nil {
		t.Fatalf("removing an unknown slot: %v", err)
	}
	if _, err := adapter.EnsureSlot(Slot{SlotID: "camera-main", Kind: KindCamera}); err != nil {
		t.Fatal(err)
	}
	if err := adapter.RemoveSlot("camera-main"); err != nil {
		t.Fatal(err)
	}
	if got := adapter.RegisteredSlots(); len(got) != 0 {
		t.Fatalf("slots after removal = %v, want none", got)
	}
}

func TestRegistryAlwaysHasTheFakeAndListsThePlatformsPlannedAdapter(t *testing.T) {
	registry := NewAdapterRegistry()
	if _, ok := registry.Lookup(FakeAdapterID); !ok {
		t.Fatal("the fake adapter is missing from the registry")
	}
	descriptors := registry.Describe()
	if len(descriptors) < 1 {
		t.Fatal("no adapters at all")
	}
	for index := 1; index < len(descriptors); index++ {
		if descriptors[index-1].AdapterID >= descriptors[index].AdapterID {
			t.Fatalf("adapters are not sorted: %q before %q", descriptors[index-1].AdapterID, descriptors[index].AdapterID)
		}
	}
	if len(plannedAdapters(runtime.GOOS)) == 0 {
		return
	}
	// The planned adapter is listed, and listed as absent. "Not built" and
	// "unsupported OS" are different answers and fixed by different people.
	found := false
	for _, descriptor := range descriptors {
		if descriptor.Simulated {
			continue
		}
		found = true
		if descriptor.InstallState != StateNotInstalled {
			t.Errorf("%s install_state = %q, want not_installed", descriptor.AdapterID, descriptor.InstallState)
		}
		if descriptor.Detail == "" {
			t.Errorf("%s has no detail saying which phase brings it", descriptor.AdapterID)
		}
	}
	if !found {
		t.Fatalf("%s has a planned adapter but the registry lists none", runtime.GOOS)
	}
}

// An adapter with no implementation refuses slots with the §21 code meant for
// it, rather than pretending to succeed.
func TestUnbuiltAdapterRefusesSlotsWithAdapterUnavailable(t *testing.T) {
	registry := NewAdapterRegistry()
	for _, descriptor := range registry.Describe() {
		if descriptor.Simulated {
			continue
		}
		adapter, _ := registry.Lookup(descriptor.AdapterID)
		_, err := adapter.EnsureSlot(Slot{SlotID: "camera-main", Kind: KindCamera})
		var domain *DomainError
		if !errors.As(err, &domain) || domain.Code != ErrCodeAdapterUnavailable {
			t.Fatalf("%s returned %v, want %s", descriptor.AdapterID, err, ErrCodeAdapterUnavailable)
		}
	}
}

// The registry with a device map is the one main.go builds. Without a real
// platform adapter (every non-Linux build) the map changes nothing, and the Fake
// and the placeholder stay as they were.
func TestRegistryWithDevicesKeepsTheFakeAndAcceptsANilMap(t *testing.T) {
	for _, devices := range []map[string]string{nil, {}, {"camera-main": "/dev/video10"}} {
		registry := NewAdapterRegistryWithDevices(devices)
		adapter, ok := registry.Lookup(FakeAdapterID)
		if !ok {
			t.Fatal("the fake adapter is missing")
		}
		if _, ok := adapter.(FrameAdapter); !ok {
			t.Error("the fake adapter must take frames: it is how the frame path is tested")
		}
		if descriptor := adapter.Describe(); !descriptor.Simulated {
			t.Error("the fake stopped reporting itself as simulated")
		}
	}
}
