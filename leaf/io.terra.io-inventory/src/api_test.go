package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/discovery"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/manual"
)

func tombstoneFixture(t *testing.T) (http.Handler, *inventory.Registry) {
	t.Helper()
	registry := inventory.NewRegistry()
	device := inventory.Device{
		ID:        "mouse-046d-c534-2f417bd9",
		Name:      "Logitech USB Receiver Mouse",
		Kind:      inventory.DeviceMouse,
		AdapterID: discovery.AdapterID,
	}
	if err := registry.Register(device); err != nil {
		t.Fatal(err)
	}
	handler := newOperationsHandler(registry, newHotplug(discovery.WatchStatus{Mode: discovery.WatchNone}), &manualDoor{source: manual.NewMemorySource(), adapters: manual.DefaultAdapters()})
	return handler, registry
}

func getJSON(t *testing.T, handler http.Handler, path string, target any) int {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+path, nil))
	if target != nil && recorder.Code == http.StatusOK {
		if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
			t.Fatalf("decode %s: %v (body %s)", path, err, recorder.Body.String())
		}
	}
	return recorder.Code
}

// Tombstones are their own route, a sibling of /devices rather than a child of
// it (IO-20). The test is the round trip: nothing forgotten answers an empty
// list, and a forget shows up with what the device was.
func TestTombstonesRoute(t *testing.T) {
	handler, registry := tombstoneFixture(t)

	var empty struct {
		Tombstones []inventory.Tombstone `json:"tombstones"`
		Count      int                   `json:"count"`
	}
	if code := getJSON(t, handler, "/tombstones", &empty); code != http.StatusOK {
		t.Fatalf("GET /tombstones = %d, want 200", code)
	}
	if empty.Tombstones == nil {
		t.Error("tombstones is null; a node that has forgotten nothing answers an empty list")
	}
	if empty.Count != 0 {
		t.Errorf("count = %d, want 0", empty.Count)
	}

	if _, err := registry.Forget("mouse-046d-c534-2f417bd9"); err != nil {
		t.Fatal(err)
	}

	var after struct {
		Tombstones []inventory.Tombstone `json:"tombstones"`
		Count      int                   `json:"count"`
	}
	if code := getJSON(t, handler, "/tombstones", &after); code != http.StatusOK {
		t.Fatalf("GET /tombstones after a forget = %d, want 200", code)
	}
	if after.Count != 1 || len(after.Tombstones) != 1 {
		t.Fatalf("count = %d, tombstones = %d, want 1 and 1", after.Count, len(after.Tombstones))
	}
	if after.Tombstones[0].DeviceID != "mouse-046d-c534-2f417bd9" {
		t.Errorf("device_id = %q", after.Tombstones[0].DeviceID)
	}
	// The record carries what the device was, so an operator reading it does
	// not have to remember an id they deliberately dropped.
	if after.Tombstones[0].Name == "" {
		t.Error("the tombstone does not say what the device was called")
	}
	if after.Tombstones[0].ForgottenAt.IsZero() {
		t.Error("the tombstone does not say when")
	}
}

// Forgetting removes the device. The two lists answer different questions and
// must not both claim the same device.
func TestForgottenDeviceLeavesTheDeviceList(t *testing.T) {
	handler, registry := tombstoneFixture(t)
	if _, err := registry.Forget("mouse-046d-c534-2f417bd9"); err != nil {
		t.Fatal(err)
	}

	var devices struct {
		Devices []inventory.Device `json:"devices"`
		Count   int                `json:"count"`
	}
	if code := getJSON(t, handler, "/devices", &devices); code != http.StatusOK {
		t.Fatalf("GET /devices = %d", code)
	}
	for _, device := range devices.Devices {
		if device.ID == "mouse-046d-c534-2f417bd9" {
			t.Fatal("a forgotten device is still in the device list")
		}
	}
	if code := getJSON(t, handler, "/devices/mouse-046d-c534-2f417bd9", nil); code != http.StatusNotFound {
		t.Errorf("GET of a forgotten device = %d, want 404", code)
	}
}
