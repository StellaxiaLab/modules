package vdevice

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func newTestController(t *testing.T) (*Controller, *Store) {
	t.Helper()
	store := NewStore(filepath.Join(t.TempDir(), StateFileName))
	controller, err := NewController(DefaultConfig(), NewAdapterRegistry(), store)
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	return controller, store
}

func fakeSlotRequest() SlotRequest {
	return SlotRequest{
		Kind:        KindCamera,
		DisplayName: "Terra Virtual Camera",
		AdapterID:   FakeAdapterID,
		Format:      &Format{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"},
	}
}

func TestSlotSurvivesASourceChangeWithTheSameDeviceID(t *testing.T) {
	controller, _ := newTestController(t)
	created, err := controller.PutSlot("camera-main", fakeSlotRequest())
	if err != nil {
		t.Fatalf("create slot: %v", err)
	}

	first := ProjectionRequest{
		SlotID:     "camera-main",
		Source:     Source{ResourceID: "io.camera.usb-7", EndpointID: "video"},
		Generation: 1,
	}
	if _, err := controller.PutProjection("proj-camera-main", first); err != nil {
		t.Fatalf("first projection: %v", err)
	}

	// The source switch of §11.3: a new generation on the same projection id.
	second := first
	second.Source = Source{ResourceID: "io.camera.usb-9", EndpointID: "video"}
	second.Generation = 2
	if _, err := controller.PutProjection("proj-camera-main", second); err != nil {
		t.Fatalf("source switch: %v", err)
	}

	after, err := controller.Slot("camera-main")
	if err != nil {
		t.Fatal(err)
	}
	// This is design principle §4.8 and it is the whole reason Slot and
	// Projection are two objects. If it ever fails, an external program loses
	// the device it selected the moment the source behind it changes.
	if after.OSDeviceID != created.OSDeviceID {
		t.Errorf("os_device_id changed across a source switch: %q then %q", created.OSDeviceID, after.OSDeviceID)
	}
	if after.DisplayName != created.DisplayName {
		t.Errorf("display_name changed across a source switch: %q then %q", created.DisplayName, after.DisplayName)
	}
}

func TestOlderGenerationIsRefused(t *testing.T) {
	controller, _ := newTestController(t)
	if _, err := controller.PutSlot("camera-main", fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	request := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 5}
	if _, err := controller.PutProjection("proj-camera-main", request); err != nil {
		t.Fatal(err)
	}
	request.Generation = 4
	_, err := controller.PutProjection("proj-camera-main", request)
	if got := domainCode(t, err); got != ErrCodeStaleGeneration {
		t.Fatalf("code = %s, want %s", got, ErrCodeStaleGeneration)
	}
}

func TestReplayingTheSameGenerationIsTheSameResult(t *testing.T) {
	controller, _ := newTestController(t)
	if _, err := controller.PutSlot("camera-main", fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	request := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}
	first, err := controller.PutProjection("proj-camera-main", request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := controller.PutProjection("proj-camera-main", request)
	if err != nil {
		t.Fatalf("replay was refused: %v", err)
	}
	if !second.Declaration.UpdatedAt.Equal(first.Declaration.UpdatedAt) {
		t.Error("a replay moved updated_at; a retry must not look like a change")
	}
}

func TestOneActiveProjectionPerSlot(t *testing.T) {
	controller, _ := newTestController(t)
	if _, err := controller.PutSlot("camera-main", fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	first := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "a", EndpointID: "video"}, Generation: 1}
	if _, err := controller.PutProjection("proj-a", first); err != nil {
		t.Fatal(err)
	}
	second := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "b", EndpointID: "video"}, Generation: 1}
	_, err := controller.PutProjection("proj-b", second)
	if got := domainCode(t, err); got != ErrCodeSlotBusy {
		t.Fatalf("code = %s, want %s", got, ErrCodeSlotBusy)
	}
}

func TestDeletingASlotUnderAnActiveProjectionIsRefused(t *testing.T) {
	controller, _ := newTestController(t)
	if _, err := controller.PutSlot("camera-main", fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	request := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}
	if _, err := controller.PutProjection("proj-camera-main", request); err != nil {
		t.Fatal(err)
	}
	if got := domainCode(t, controller.DeleteSlot("camera-main")); got != ErrCodeSlotBusy {
		t.Fatalf("code = %s, want %s", got, ErrCodeSlotBusy)
	}

	request.DesiredState = DesiredStopped
	request.Generation = 2
	if _, err := controller.PutProjection("proj-camera-main", request); err != nil {
		t.Fatal(err)
	}
	if err := controller.DeleteSlot("camera-main"); err != nil {
		t.Fatalf("deleting a slot with a stopped projection: %v", err)
	}
}

// A declaration is intent, not evidence. A declared projection with no sink open
// must never observe `active`, because the one thing an operator would do with
// that answer is believe it. (Phase 1 states: feed_test.go.)
func TestADeclarationWithoutASinkNeverReportsActive(t *testing.T) {
	controller, _ := newTestController(t)
	if _, err := controller.PutSlot("camera-main", fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	request := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}
	view, err := controller.PutProjection("proj-camera-main", request)
	if err != nil {
		t.Fatal(err)
	}
	if view.Runtime.ObservedState == ProjectionActive {
		t.Fatal("observed_state = active with no sink open behind it")
	}
	if view.Runtime.ObservedState != ProjectionDegraded {
		t.Errorf("observed_state = %q, want degraded", view.Runtime.ObservedState)
	}
	if view.Runtime.ReasonCode != ErrCodeSourceUnavailable {
		t.Errorf("reason_code = %q, want %s", view.Runtime.ReasonCode, ErrCodeSourceUnavailable)
	}
	if !strings.Contains(view.Runtime.ReasonDetail, "does not create the binding") {
		t.Errorf("reason_detail must say a declaration does not create the binding: %q", view.Runtime.ReasonDetail)
	}
}

// §26: the management API is alive and answers degraded while no real adapter
// is ready, and says why.
func TestStatusIsDegradedAndNamesTheMissingDaemon(t *testing.T) {
	controller, _ := newTestController(t)
	status := controller.Status()
	if status.Status != "degraded" {
		t.Errorf("status = %q, want degraded", status.Status)
	}
	if status.Daemon.Connected {
		t.Error("daemon.connected = true with no daemon integration built")
	}
	if status.Daemon.Detail == "" {
		t.Error("daemon.detail is empty; degraded with no reason is not usable")
	}
	if status.Phase != PhaseLabel {
		t.Errorf("phase = %q, want %s", status.Phase, PhaseLabel)
	}
	// The fake must not be counted as a ready adapter. That sum is what an
	// operator reads to decide whether this machine can do anything.
	if status.Adapters.Ready != 0 {
		t.Errorf("adapters.ready = %d; the only working adapter here is simulated", status.Adapters.Ready)
	}
	if status.Adapters.Simulated != 1 {
		t.Errorf("adapters.simulated = %d, want 1", status.Adapters.Simulated)
	}
}

func TestDeclarationsSurviveARestart(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), StateFileName))
	first, err := NewController(DefaultConfig(), NewAdapterRegistry(), store)
	if err != nil {
		t.Fatal(err)
	}
	created, err := first.PutSlot("camera-main", fakeSlotRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.PutProjection("proj-camera-main", ProjectionRequest{
		SlotID: "camera-main", Source: Source{ResourceID: "io.camera.usb-7", EndpointID: "video"}, Generation: 3,
	}); err != nil {
		t.Fatal(err)
	}

	// A fresh controller over the same store is what a restart looks like.
	second, err := NewController(DefaultConfig(), NewAdapterRegistry(), NewStore(store.Path()))
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	restored, err := second.Slot("camera-main")
	if err != nil {
		t.Fatalf("slot lost across restart: %v", err)
	}
	if restored.OSDeviceID != created.OSDeviceID {
		t.Errorf("os_device_id after restart = %q, want %q", restored.OSDeviceID, created.OSDeviceID)
	}
	view, err := second.Projection("proj-camera-main")
	if err != nil {
		t.Fatalf("projection lost across restart: %v", err)
	}
	if view.Declaration.Generation != 3 {
		t.Errorf("generation after restart = %d, want 3", view.Declaration.Generation)
	}
	// The declaration came back; the handle did not, and must not pretend to.
	if view.Runtime.HandleID != "" {
		t.Errorf("handle_id = %q after restart; §19.2 says a lease is never stored", view.Runtime.HandleID)
	}
}

func TestProjectionOnAMissingSlotIsRefused(t *testing.T) {
	controller, _ := newTestController(t)
	_, err := controller.PutProjection("proj-x", ProjectionRequest{
		SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1,
	})
	if got := domainCode(t, err); got != ErrCodeSlotNotFound {
		t.Fatalf("code = %s, want %s", got, ErrCodeSlotNotFound)
	}
}

func TestSlotOnAnUnknownAdapterIsRefused(t *testing.T) {
	controller, _ := newTestController(t)
	request := fakeSlotRequest()
	request.AdapterID = "linux.does-not-exist"
	_, err := controller.PutSlot("camera-main", request)
	if got := domainCode(t, err); got != ErrCodeAdapterUnavailable {
		t.Fatalf("code = %s, want %s", got, ErrCodeAdapterUnavailable)
	}
}

// Diagnostics is the most-copied artefact there is. §20.4 names what must not
// be in it.
func TestDiagnosticsCarriesNoSourceOrOwner(t *testing.T) {
	controller, _ := newTestController(t)
	request := fakeSlotRequest()
	request.OwnerSubject = "user:alice@example.com"
	if _, err := controller.PutSlot("camera-main", request); err != nil {
		t.Fatal(err)
	}
	if _, err := controller.PutProjection("proj-camera-main", ProjectionRequest{
		SlotID:       "camera-main",
		Source:       Source{ResourceID: "io.camera.secret-lab-7", EndpointID: "video"},
		OwnerSubject: "user:alice@example.com",
		Generation:   1,
	}); err != nil {
		t.Fatal(err)
	}
	encoded := mustJSON(t, controller.Diagnostics())
	for _, forbidden := range []string{"alice@example.com", "io.camera.secret-lab-7"} {
		if contains(encoded, forbidden) {
			t.Errorf("diagnostics contains %q", forbidden)
		}
	}
	// It still has to be useful: the state counts are what someone reads.
	if len(controller.Diagnostics().ProjectionStates) == 0 {
		t.Error("diagnostics reports no projection states at all")
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return string(raw)
}

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }
