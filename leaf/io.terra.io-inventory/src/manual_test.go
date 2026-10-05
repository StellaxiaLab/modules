package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/discovery"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/manual"
)

// camera is an HTTP camera the test can switch on and off.
type camera struct {
	server *httptest.Server
	up     atomic.Bool
}

func newCamera(t *testing.T) *camera {
	t.Helper()
	c := &camera{}
	c.up.Store(true)
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !c.up.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(c.server.Close)
	return c
}

// node is the module as it runs: a persistent registry and a persistent
// manual source in one data home, behind the operations handler.
type node struct {
	dir      string
	registry *inventory.Registry
	door     *manualDoor
	handler  http.Handler
}

func startNode(t *testing.T, dir string) *node {
	t.Helper()
	statePath := filepath.Join(dir, "devices.json")
	registry, err := inventory.NewPersistentRegistry(statePath)
	if err != nil {
		t.Fatal(err)
	}
	source, err := manual.OpenSource(manualSourcePath(statePath))
	if err != nil {
		t.Fatal(err)
	}
	door := &manualDoor{source: source, adapters: manual.NewAdapters(
		&manual.RTSPAdapter{Timeout: time.Second},
		&manual.HTTPCameraAdapter{Timeout: time.Second},
	)}
	if _, err := syncManual(context.Background(), registry, door); err != nil {
		t.Fatal(err)
	}
	handler := newOperationsHandler(registry, newHotplug(discovery.WatchStatus{Mode: discovery.WatchNone}), door)
	return &node{dir: dir, registry: registry, door: door, handler: handler}
}

func (n *node) post(t *testing.T, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}
	recorder := httptest.NewRecorder()
	n.handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, apiPrefix+path, reader))
	return recorder
}

func decode[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(recorder.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode: %v (body %s)", err, recorder.Body.String())
	}
	return value
}

func errorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	return decode[map[string]apiError](t, recorder)["error"].Code
}

func cameraRequest(address string) manual.Request {
	return manual.Request{Kind: "camera", Name: "Porch camera", AdapterID: "manual.http-camera", Address: address}
}

// The whole B-10 promise in one walk: a hand-registered camera arrives pending
// like any enumerated device, needs a person to approve and enable it before it
// is available, goes missing when it stops answering without losing that
// approval, and comes back after a restart because the source remembered it.
func TestManualDeviceGoesThroughTheSameDoor(t *testing.T) {
	cam := newCamera(t)
	dir := t.TempDir()
	n := startNode(t, dir)

	request := cameraRequest(cam.server.URL + "/snapshot.jpg")
	request.Alias = "현관"
	answer := n.post(t, "/devices", request)
	if answer.Code != http.StatusCreated {
		t.Fatalf("POST /devices = %d %s, want 201", answer.Code, answer.Body.String())
	}
	added := decode[manualAdded](t, answer)
	if added.DeviceID == "" || added.DeviceID != added.Device.ID {
		t.Fatalf("answer names device %q / %q", added.DeviceID, added.Device.ID)
	}
	device := added.Device
	if device.Approval != inventory.ApprovalPending {
		t.Errorf("approval = %s, want pending — typing an address is not approving a camera", device.Approval)
	}
	if device.Available || device.Enabled {
		t.Errorf("available=%v enabled=%v before approval, want both false", device.Available, device.Enabled)
	}
	if device.Presence != inventory.PresencePresent {
		t.Errorf("presence = %s, want present (the camera answered)", device.Presence)
	}
	if device.AdapterID != "manual.http-camera" || device.Kind != inventory.DeviceCamera {
		t.Errorf("adapter/kind = %s/%s", device.AdapterID, device.Kind)
	}
	if device.Alias != "현관" {
		t.Errorf("alias = %q, want 현관", device.Alias)
	}
	id := added.DeviceID

	if code := n.post(t, "/devices/"+id+"/enable", nil).Code; code != http.StatusConflict {
		t.Errorf("enable before approve = %d, want 409", code)
	}
	if code := n.post(t, "/devices/"+id+"/approve", nil).Code; code != http.StatusOK {
		t.Fatalf("approve = %d", code)
	}
	enabled := n.post(t, "/devices/"+id+"/enable", nil)
	if enabled.Code != http.StatusOK {
		t.Fatalf("enable = %d %s", enabled.Code, enabled.Body.String())
	}
	if device := decode[inventory.Device](t, enabled); !device.Available {
		t.Fatalf("after approve+enable: %+v, want available", device)
	}

	// The camera goes dark: missing, never deleted, approval kept (IO-3).
	cam.up.Store(false)
	probed := n.post(t, "/devices/"+id+"/probe", nil)
	if probed.Code != http.StatusOK {
		t.Fatalf("probe = %d %s", probed.Code, probed.Body.String())
	}
	result := decode[inventory.ProbeResult](t, probed)
	if result.Presence != inventory.PresenceMissing || result.Device.Available {
		t.Errorf("probe of a dark camera = %s available=%v, want missing and unavailable", result.Presence, result.Device.Available)
	}
	if result.Device.Approval != inventory.ApprovalApproved {
		t.Errorf("approval after going missing = %s, want approved kept", result.Device.Approval)
	}
	if result.Adapter != "manual.http-camera" {
		t.Errorf("probe adapter = %s", result.Adapter)
	}

	// Restart with the camera back: the source brings it in, the policy is
	// restored, and it is available again without anyone approving twice.
	cam.up.Store(true)
	restarted := startNode(t, dir)
	device, err := restarted.registry.Get(id)
	if err != nil {
		t.Fatalf("after restart: %v — the manual source did not bring the camera back", err)
	}
	if device.Approval != inventory.ApprovalApproved || !device.Available || device.Alias != "현관" {
		t.Errorf("after restart: approval=%s available=%v alias=%q, want approved, available, alias kept", device.Approval, device.Available, device.Alias)
	}
}

// A camera that is switched off when it is registered is still registered —
// it has to be in the list to be approved — but nothing has heard from it, so
// its presence says so.
func TestManualDeviceRegisteredWhileUnreachable(t *testing.T) {
	cam := newCamera(t)
	cam.up.Store(false)
	n := startNode(t, t.TempDir())

	answer := n.post(t, "/devices", cameraRequest(cam.server.URL+"/snapshot.jpg"))
	if answer.Code != http.StatusCreated {
		t.Fatalf("POST /devices = %d %s, want 201", answer.Code, answer.Body.String())
	}
	device := decode[manualAdded](t, answer).Device
	if device.Presence != inventory.PresenceUnknown || device.Approval != inventory.ApprovalPending {
		t.Errorf("presence=%s approval=%s, want unknown and pending", device.Presence, device.Approval)
	}

	cam.up.Store(true)
	results, err := syncManual(context.Background(), n.registry, n.door)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Adapter != "manual.http-camera" {
		t.Fatalf("sync results = %+v", results)
	}
	after, err := n.registry.Get(device.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Presence != inventory.PresencePresent || after.Approval != inventory.ApprovalPending {
		t.Errorf("after the camera answered: presence=%s approval=%s, want present and still pending", after.Presence, after.Approval)
	}
}

func TestManualRegistrationRefusals(t *testing.T) {
	n := startNode(t, t.TempDir())
	before := len(n.registry.List())

	cases := []struct {
		name   string
		body   any
		status int
		code   string
	}{
		{"kind with no adapter", manual.Request{Kind: "serial", Name: "Arduino", AdapterID: "manual.serial", Address: "serial:///dev/ttyUSB0"}, http.StatusBadRequest, "IO_ADAPTER_UNAVAILABLE"},
		{"adapter that opens another kind", manual.Request{Kind: "microphone", Name: "Mic", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/audio"}, http.StatusBadRequest, "IO_ADAPTER_UNAVAILABLE"},
		{"posing as the enumerator", manual.Request{Kind: "camera", Name: "Cam", AdapterID: discovery.AdapterID, Address: "rtsp://10.0.0.2/s"}, http.StatusBadRequest, "IO_INVALID_REQUEST"},
		{"unknown field", map[string]any{"kind": "camera", "name": "Cam", "adapter_id": "manual.rtsp", "address": "rtsp://10.0.0.2/s", "approval": "approved"}, http.StatusBadRequest, "IO_INVALID_REQUEST"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			answer := n.post(t, "/devices", tc.body)
			if answer.Code != tc.status {
				t.Fatalf("status = %d %s, want %d", answer.Code, answer.Body.String(), tc.status)
			}
			if code := errorCode(t, answer); code != tc.code {
				t.Errorf("code = %s, want %s", code, tc.code)
			}
		})
	}
	if after := len(n.registry.List()); after != before {
		t.Errorf("refused registrations changed the inventory: %d -> %d devices", before, after)
	}
	if entries := n.door.source.Entries(); len(entries) != 0 {
		t.Errorf("refused registrations reached the source: %+v", entries)
	}
}

func TestManualRegistrationTwiceConflicts(t *testing.T) {
	cam := newCamera(t)
	n := startNode(t, t.TempDir())
	request := cameraRequest(cam.server.URL + "/snapshot.jpg")
	if code := n.post(t, "/devices", request).Code; code != http.StatusCreated {
		t.Fatalf("first = %d", code)
	}
	again := n.post(t, "/devices", request)
	if again.Code != http.StatusConflict || errorCode(t, again) != "IO_DEVICE_EXISTS" {
		t.Fatalf("second = %d %s, want 409 IO_DEVICE_EXISTS", again.Code, again.Body.String())
	}
}

// Forget is the person leaving (IO-11). For a hand-registered device that has
// to include the source, or the next scan would bring it straight back.
func TestForgetTakesAManualDeviceOutOfTheSource(t *testing.T) {
	cam := newCamera(t)
	dir := t.TempDir()
	n := startNode(t, dir)
	request := cameraRequest(cam.server.URL + "/snapshot.jpg")
	id := decode[manualAdded](t, n.post(t, "/devices", request)).DeviceID
	if code := n.post(t, "/devices/"+id+"/approve", nil).Code; code != http.StatusOK {
		t.Fatalf("approve = %d", code)
	}

	forgotten := n.post(t, "/devices/"+id+"/forget", nil)
	if forgotten.Code != http.StatusOK {
		t.Fatalf("forget = %d %s", forgotten.Code, forgotten.Body.String())
	}
	if _, ok := n.door.source.Get(id); ok {
		t.Fatal("the manual source still holds a forgotten device")
	}

	// The next scan does not enumerate it again — not now, and not after a
	// restart.
	if _, err := syncManual(context.Background(), n.registry, n.door); err != nil {
		t.Fatal(err)
	}
	if _, err := n.registry.Get(id); !errors.Is(err, inventory.ErrDeviceNotFound) {
		t.Errorf("after forget and sync: %v, want not found", err)
	}
	restarted := startNode(t, dir)
	if _, err := restarted.registry.Get(id); !errors.Is(err, inventory.ErrDeviceNotFound) {
		t.Errorf("after forget and restart: %v, want not found", err)
	}
	if tombstones := restarted.registry.Tombstones(); len(tombstones) != 1 || tombstones[0].DeviceID != id || tombstones[0].AdapterID != "manual.http-camera" {
		t.Errorf("tombstones = %+v, want the forgotten camera", tombstones)
	}

	// Not a blocklist: registering it again is a new device, at pending, and
	// the approval that was forgotten does not come back with it.
	again := restarted.post(t, "/devices", request)
	if again.Code != http.StatusCreated {
		t.Fatalf("register again = %d %s", again.Code, again.Body.String())
	}
	if device := decode[manualAdded](t, again).Device; device.Approval != inventory.ApprovalPending {
		t.Errorf("re-registered approval = %s, want pending", device.Approval)
	}
}

// Probing a logical slot is still refused; the manual branch must not have
// widened what probe accepts.
func TestProbeStillRefusesLogicalSlots(t *testing.T) {
	n := startNode(t, t.TempDir())
	if err := n.registry.Register(inventory.Device{ID: "camera-default", Name: "Default camera", Kind: inventory.DeviceCamera, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	answer := n.post(t, "/devices/camera-default/probe", nil)
	if answer.Code != http.StatusConflict || errorCode(t, answer) != "IO_DEVICE_NOT_PROBEABLE" {
		t.Fatalf("probe slot = %d %s, want 409 IO_DEVICE_NOT_PROBEABLE", answer.Code, answer.Body.String())
	}
}
