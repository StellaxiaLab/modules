package vdevice

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	store := NewStore(filepath.Join(t.TempDir(), StateFileName))
	controller, err := NewController(DefaultConfig(), NewAdapterRegistry(), store)
	if err != nil {
		t.Fatal(err)
	}
	return NewHandler(controller)
}

func call(t *testing.T, handler http.Handler, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	request := httptest.NewRequest(method, path, reader)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	decoded := map[string]any{}
	if recorder.Body.Len() > 0 {
		if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("%s %s returned a body that is not a JSON object: %s", method, path, recorder.Body.String())
		}
	}
	return recorder, decoded
}

func errorCode(t *testing.T, body map[string]any) string {
	t.Helper()
	wrapper, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("body has no error object: %v", body)
	}
	code, _ := wrapper["code"].(string)
	return code
}

func TestStatusIsServedAndDegraded(t *testing.T) {
	handler := newTestServer(t)
	recorder, body := call(t, handler, http.MethodGet, APIPrefix+"/status", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if body["status"] != "degraded" {
		t.Errorf("status = %v, want degraded", body["status"])
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("content-type = %q", got)
	}
}

func TestSlotAndProjectionRoundTripThroughTheAPI(t *testing.T) {
	handler := newTestServer(t)

	recorder, slot := call(t, handler, http.MethodPut, APIPrefix+"/slots/camera-main", map[string]any{
		"kind": "camera", "display_name": "Terra Virtual Camera", "adapter_id": FakeAdapterID,
		"format": map[string]any{"width": 640, "height": 480, "fps": 30, "pixel_format": "YUY2"},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT slot = %d: %v", recorder.Code, slot)
	}
	if slot["os_device_id"] != "fake:camera-main" {
		t.Errorf("os_device_id = %v", slot["os_device_id"])
	}

	recorder, view := call(t, handler, http.MethodPut, APIPrefix+"/projections/proj-camera-main", map[string]any{
		"slot_id":    "camera-main",
		"source":     map[string]any{"resource_id": "io.camera.usb-7", "endpoint_id": "video"},
		"generation": 1,
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT projection = %d: %v", recorder.Code, view)
	}
	runtime, _ := view["runtime"].(map[string]any)
	if runtime["observed_state"] != ProjectionDegraded {
		t.Errorf("observed_state = %v, want degraded", runtime["observed_state"])
	}

	recorder, listing := call(t, handler, http.MethodGet, APIPrefix+"/projections", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET projections = %d", recorder.Code)
	}
	if projections, _ := listing["projections"].([]any); len(projections) != 1 {
		t.Fatalf("projections = %v", listing["projections"])
	}

	recorder, _ = call(t, handler, http.MethodDelete, APIPrefix+"/projections/proj-camera-main", nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("DELETE projection = %d, want 204", recorder.Code)
	}
	recorder, _ = call(t, handler, http.MethodDelete, APIPrefix+"/slots/camera-main", nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("DELETE slot = %d, want 204", recorder.Code)
	}
}

// The HTTP statuses are the contract's, per error code.
func TestErrorsCarryTheContractsCodeAndStatus(t *testing.T) {
	handler := newTestServer(t)

	recorder, body := call(t, handler, http.MethodGet, APIPrefix+"/slots/camera-main", nil)
	if recorder.Code != http.StatusNotFound || errorCode(t, body) != ErrCodeSlotNotFound {
		t.Errorf("missing slot: %d %s", recorder.Code, errorCode(t, body))
	}

	recorder, body = call(t, handler, http.MethodGet, APIPrefix+"/adapters/nope.nothing", nil)
	if recorder.Code != http.StatusServiceUnavailable || errorCode(t, body) != ErrCodeAdapterUnavailable {
		t.Errorf("unknown adapter: %d %s", recorder.Code, errorCode(t, body))
	}

	recorder, body = call(t, handler, http.MethodPut, APIPrefix+"/slots/camera-main", map[string]any{
		"kind": "camera", "display_name": "Terra Virtual Camera", "adapter_id": "nope.nothing",
	})
	if recorder.Code != http.StatusServiceUnavailable || errorCode(t, body) != ErrCodeAdapterUnavailable {
		t.Errorf("slot on unknown adapter: %d %s", recorder.Code, errorCode(t, body))
	}

	request := httptest.NewRequest(http.MethodPut, APIPrefix+"/slots/camera-main", bytes.NewReader([]byte("{not json")))
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Errorf("malformed body = %d, want 400", recorder.Code)
	}
}

func TestStaleGenerationIsAConflict(t *testing.T) {
	handler := newTestServer(t)
	if recorder, _ := call(t, handler, http.MethodPut, APIPrefix+"/slots/camera-main", map[string]any{
		"kind": "camera", "display_name": "Terra Virtual Camera", "adapter_id": FakeAdapterID,
	}); recorder.Code != http.StatusOK {
		t.Fatalf("slot = %d", recorder.Code)
	}
	body := map[string]any{
		"slot_id": "camera-main", "generation": 4,
		"source": map[string]any{"resource_id": "r", "endpoint_id": "video"},
	}
	if recorder, _ := call(t, handler, http.MethodPut, APIPrefix+"/projections/proj-p", body); recorder.Code != http.StatusOK {
		t.Fatalf("first projection = %d", recorder.Code)
	}
	body["generation"] = 3
	recorder, decoded := call(t, handler, http.MethodPut, APIPrefix+"/projections/proj-p", body)
	if recorder.Code != http.StatusConflict || errorCode(t, decoded) != ErrCodeStaleGeneration {
		t.Fatalf("stale generation: %d %s", recorder.Code, errorCode(t, decoded))
	}
}

// A mistyped path answers in this module's vocabulary, not with net/http's
// HTML 404 page.
func TestUnknownPathAnswersInTheModulesVocabulary(t *testing.T) {
	handler := newTestServer(t)
	recorder, body := call(t, handler, http.MethodGet, APIPrefix+"/slotz", nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if errorCode(t, body) == "" {
		t.Fatal("a mistyped path returned no error code")
	}
}

// §16.2 declares a driver plan route; Phase 0 must not serve one. Installation
// is the signed Setup path's alone (§4.3), and a driver-plan endpoint is its
// front door.
func TestNoDriverPlanRouteExistsYet(t *testing.T) {
	handler := newTestServer(t)
	recorder, _ := call(t, handler, http.MethodPost, APIPrefix+"/adapters/"+FakeAdapterID+"/driver-plan", map[string]any{"action": "install"})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("driver-plan answered %d; Phase 0 builds no installation surface", recorder.Code)
	}
}

func TestAdaptersListingMarksTheFake(t *testing.T) {
	handler := newTestServer(t)
	_, body := call(t, handler, http.MethodGet, APIPrefix+"/adapters", nil)
	adapters, _ := body["adapters"].([]any)
	if len(adapters) == 0 {
		t.Fatal("no adapters listed")
	}
	found := false
	for _, entry := range adapters {
		descriptor, _ := entry.(map[string]any)
		if descriptor["adapter_id"] == FakeAdapterID {
			found = true
			if descriptor["simulated"] != true {
				t.Error("the fake adapter is not marked simulated over the wire")
			}
		}
	}
	if !found {
		t.Fatalf("the fake adapter is missing from the listing: %v", adapters)
	}
}
