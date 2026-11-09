package vdevice

import (
	"errors"
	"testing"
)

func domainCode(t *testing.T, err error) string {
	t.Helper()
	var domain *DomainError
	if !errors.As(err, &domain) {
		t.Fatalf("error %v is not a DomainError", err)
	}
	return domain.Code
}

func TestSlotRequestRejectsIdentifiersThatCannotBeAPathSegment(t *testing.T) {
	request := SlotRequest{Kind: KindCamera, DisplayName: "Terra Virtual Camera", AdapterID: FakeAdapterID}
	for _, id := range []string{"", "a", "../etc", "Camera-Main", "camera main", "camera/main"} {
		if err := request.Validate(id); err == nil {
			t.Errorf("slot id %q was accepted", id)
		}
	}
	if err := request.Validate("camera-main"); err != nil {
		t.Errorf("camera-main was rejected: %v", err)
	}
}

// Audio is Phase 5. The refusal names the phase rather than reading as "bad
// request", because the caller's request is not wrong — it is early.
func TestAudioSlotIsRefusedAsAdapterUnavailable(t *testing.T) {
	request := SlotRequest{Kind: KindAudio, DisplayName: "Terra Virtual Microphone", AdapterID: FakeAdapterID}
	if got := domainCode(t, request.Validate("audio-main")); got != ErrCodeAdapterUnavailable {
		t.Fatalf("code = %s, want %s", got, ErrCodeAdapterUnavailable)
	}
}

func TestSlotRequestDefaultsScopeAndDesiredState(t *testing.T) {
	request := SlotRequest{Kind: KindCamera, DisplayName: "Terra Virtual Camera", AdapterID: FakeAdapterID}
	if err := request.Validate("camera-main"); err != nil {
		t.Fatal(err)
	}
	if request.Scope != ScopeMachine {
		t.Errorf("scope = %q, want machine", request.Scope)
	}
	if request.DesiredState != DesiredReady {
		t.Errorf("desired_state = %q, want ready", request.DesiredState)
	}
}

func TestSlotRequestRequiresADisplayNameAndAnAdapter(t *testing.T) {
	missingName := SlotRequest{Kind: KindCamera, AdapterID: FakeAdapterID}
	if got := domainCode(t, missingName.Validate("camera-main")); got != ErrCodeInvalidRequest {
		t.Errorf("missing display_name gave %s", got)
	}
	missingAdapter := SlotRequest{Kind: KindCamera, DisplayName: "Terra Virtual Camera"}
	if got := domainCode(t, missingAdapter.Validate("camera-main")); got != ErrCodeInvalidRequest {
		t.Errorf("missing adapter_id gave %s", got)
	}
}

func TestAcceptedFormatsFoldsBothSpellings(t *testing.T) {
	request := SlotRequest{
		Format:  &Format{Width: 1280, Height: 720, FPS: 30, PixelFormat: "YUY2"},
		Formats: []Format{{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"}},
	}
	if got := len(request.AcceptedFormats()); got != 2 {
		t.Fatalf("accepted formats = %d, want 2", got)
	}
	empty := SlotRequest{}
	if got := len(empty.AcceptedFormats()); got != 0 {
		t.Fatalf("a request naming no format produced %d; none must be invented (§4.9)", got)
	}
}

func TestProjectionRequestRequiresASourceAndAGeneration(t *testing.T) {
	base := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "io.camera.usb-7", EndpointID: "video"}, Generation: 1}
	if err := base.Validate("proj-camera-main"); err != nil {
		t.Fatalf("a well formed request was rejected: %v", err)
	}

	noSource := base
	noSource.Source = Source{}
	if got := domainCode(t, noSource.Validate("proj-camera-main")); got != ErrCodeInvalidRequest {
		t.Errorf("missing source gave %s", got)
	}

	noGeneration := base
	noGeneration.Generation = 0
	if got := domainCode(t, noGeneration.Validate("proj-camera-main")); got != ErrCodeInvalidRequest {
		t.Errorf("generation 0 gave %s", got)
	}
}

func TestProjectionRequestDefaultsLifecycleAndDesiredState(t *testing.T) {
	request := ProjectionRequest{SlotID: "camera-main", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}
	if err := request.Validate("proj-camera-main"); err != nil {
		t.Fatal(err)
	}
	if request.Lifecycle != LifecyclePersistent {
		t.Errorf("lifecycle = %q, want persistent", request.Lifecycle)
	}
	if request.DesiredState != DesiredActive {
		t.Errorf("desired_state = %q, want active", request.DesiredState)
	}
}

// §21's retry column is a promise to the caller. A stale generation is
// retryable after re-reading; an incompatible format is not.
func TestRetryableMirrorsTheErrorTable(t *testing.T) {
	for code, want := range map[string]bool{
		ErrCodeSourceUnavailable:  true,
		ErrCodeStaleGeneration:    true,
		ErrCodeLeaseExpired:       true,
		ErrCodeAdapterUnavailable: false,
		ErrCodeFormatIncompatible: false,
		ErrCodeSlotNotFound:       false,
		ErrCodeInvalidRequest:     false,
	} {
		if got := retryableCode(code); got != want {
			t.Errorf("%s retryable = %v, want %v", code, got, want)
		}
	}
}
