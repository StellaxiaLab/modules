package vdevice

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
	"github.com/StellaxiaLab/terra-sdk/svi"
)

const (
	testSlot       = "camera-main"
	testResourceID = "svi.node-a." + SinkResourcePrefix + testSlot
	testFrameBytes = 640 * 480 * 2
)

// feedFixture is a Controller over a registry whose Fake is reachable, so a test
// can read what reached the "device".
type feedFixture struct {
	controller *Controller
	fake       *FakeAdapter
	registry   *AdapterRegistry
}

func newFeedFixture(t *testing.T) *feedFixture {
	t.Helper()
	registry := NewAdapterRegistry()
	adapter, _ := registry.Lookup(FakeAdapterID)
	store := NewStore(filepath.Join(t.TempDir(), StateFileName))
	controller, err := NewController(DefaultConfig(), registry, store)
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	return &feedFixture{controller: controller, fake: adapter.(*FakeAdapter), registry: registry}
}

func (f *feedFixture) putSlot(t *testing.T, slotID string) {
	t.Helper()
	request := fakeSlotRequest()
	if _, err := f.controller.PutSlot(slotID, request); err != nil {
		t.Fatalf("put slot %s: %v", slotID, err)
	}
}

func (f *feedFixture) open(t *testing.T) modulesdk.SVISink {
	t.Helper()
	sink, err := f.controller.OpenSink(context.Background(), testResourceID, SinkEndpointID)
	if err != nil {
		t.Fatalf("open sink: %v", err)
	}
	return sink
}

func (f *feedFixture) runtime(t *testing.T) ProjectionRuntime {
	t.Helper()
	view, err := f.controller.Projection("proj-" + testSlot)
	if err != nil {
		t.Fatalf("projection: %v", err)
	}
	return view.Runtime
}

func (f *feedFixture) declareProjection(t *testing.T) {
	t.Helper()
	request := ProjectionRequest{SlotID: testSlot, Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}
	if _, err := f.controller.PutProjection("proj-"+testSlot, request); err != nil {
		t.Fatalf("put projection: %v", err)
	}
}

func frameOf(value byte) []byte { return bytes.Repeat([]byte{value}, testFrameBytes) }

func codeOf(err error) string {
	var domain *DomainError
	if errors.As(err, &domain) {
		return domain.Code
	}
	return ""
}

func TestFramesReachTheSlotsAdapterInOrder(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)
	for sequence, value := range []byte{1, 2, 3} {
		if err := sink.Write(uint64(sequence+1), frameOf(value)); err != nil {
			t.Fatalf("write %d: %v", sequence, err)
		}
	}
	recorded := f.fake.Frames(testSlot)
	if recorded.Frames != 3 || recorded.Bytes != 3*testFrameBytes {
		t.Errorf("adapter saw %d frames / %d bytes, want 3 / %d", recorded.Frames, recorded.Bytes, 3*testFrameBytes)
	}
	if !bytes.Equal(recorded.Last, frameOf(3)) {
		t.Error("the adapter's last frame is not the third frame written")
	}
}

func TestAFrameOfTheWrongSizeIsRefusedBeforeTheAdapter(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)
	for _, size := range []int{0, 1, testFrameBytes - 1, testFrameBytes + 2} {
		err := sink.Write(1, make([]byte, size))
		if codeOf(err) != ErrCodeFrameInvalid {
			t.Errorf("a %d-byte frame returned %v, want %s", size, err, ErrCodeFrameInvalid)
		}
	}
	if got := f.fake.Frames(testSlot).Frames; got != 0 {
		t.Errorf("the adapter received %d frames of the wrong size", got)
	}
}

func TestASecondSinkOnTheSameSlotIsBusy(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	first := f.open(t)
	_, err := f.controller.OpenSink(context.Background(), testResourceID, SinkEndpointID)
	if codeOf(err) != ErrCodeSlotBusy {
		t.Fatalf("second open returned %v, want %s", err, ErrCodeSlotBusy)
	}
	if errors.Is(err, modulesdk.ErrSVISinkNotServed) {
		t.Fatal("a busy slot is ours and refused, not 'not served'")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	third := f.open(t)
	_ = third.Close()
}

func TestCloseShowsFallbackThenReleasesTheDevice(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	f.declareProjection(t)
	sink := f.open(t)
	if err := sink.Write(1, frameOf(7)); err != nil {
		t.Fatal(err)
	}
	if got := f.runtime(t).ObservedState; got != ProjectionActive {
		t.Fatalf("state with a frame accepted = %q, want active", got)
	}
	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}
	recorded := f.fake.Frames(testSlot)
	if recorded.Fallbacks != 1 || recorded.Closes != 1 || recorded.Open {
		t.Errorf("after Close: fallbacks=%d closes=%d open=%v, want 1 / 1 / false", recorded.Fallbacks, recorded.Closes, recorded.Open)
	}
	runtime := f.runtime(t)
	if runtime.ObservedState != ProjectionDegraded || runtime.ReasonCode != ErrCodeSourceUnavailable {
		t.Errorf("after Close: %q/%q, want degraded/%s", runtime.ObservedState, runtime.ReasonCode, ErrCodeSourceUnavailable)
	}
	// A second Close (the SDK's, after the controller's) is harmless.
	if err := sink.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
	if f.fake.Frames(testSlot).Fallbacks != 1 {
		t.Error("a second Close showed the fallback again")
	}
	if err := sink.Write(2, frameOf(1)); err == nil {
		t.Error("Write on a closed sink succeeded")
	}
}

func TestProjectionRuntimeFollowsTheSink(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	f.declareProjection(t)

	if got := f.runtime(t); got.ObservedState != ProjectionDegraded || got.ReasonCode != ErrCodeSourceUnavailable {
		t.Fatalf("no sink: %q/%q", got.ObservedState, got.ReasonCode)
	}
	sink := f.open(t)
	if got := f.runtime(t); got.ObservedState != ProjectionPriming {
		t.Fatalf("sink open, no frame: %q, want priming", got.ObservedState)
	}
	// A refused (wrong-size) frame is not an accepted one, and a source that
	// sends only those is not delivering: degraded, not priming.
	_ = sink.Write(1, []byte{1})
	got := f.runtime(t)
	if got.ObservedState != ProjectionDegraded || got.ReasonCode != ErrCodeFrameInvalid || got.FramesDropped != 1 {
		t.Fatalf("after a refused frame: %q/%q dropped=%d", got.ObservedState, got.ReasonCode, got.FramesDropped)
	}
	if err := sink.Write(2, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	got = f.runtime(t)
	if got.ObservedState != ProjectionActive || got.FramesOut != 1 || got.FramesIn != 2 || got.LastFrameAt == nil || got.StartedAt == nil {
		t.Fatalf("after a frame: state=%q in=%d out=%d last=%v", got.ObservedState, got.FramesIn, got.FramesOut, got.LastFrameAt)
	}
	if got.NegotiatedFormat == nil || got.NegotiatedFormat.Width != 640 {
		t.Errorf("negotiated format = %+v", got.NegotiatedFormat)
	}

	// The device starts refusing frames: degraded with the adapter's code, and
	// back to active when it recovers.
	f.fake.SetWriteError(testSlot, errors.New("device vanished"))
	if err := sink.Write(3, frameOf(1)); err == nil {
		t.Fatal("a failing device write returned nil")
	}
	got = f.runtime(t)
	if got.ObservedState != ProjectionDegraded || got.ReasonCode != ErrCodeAdapterUnavailable || !strings.Contains(got.ReasonDetail, "device vanished") {
		t.Fatalf("device refusing: %q/%q/%q", got.ObservedState, got.ReasonCode, got.ReasonDetail)
	}
	f.fake.SetWriteError(testSlot, nil)
	if err := sink.Write(4, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	if got := f.runtime(t).ObservedState; got != ProjectionActive {
		t.Fatalf("device recovered: %q, want active", got)
	}

	_ = sink.Close()
	second := f.open(t)
	defer second.Close()
	got = f.runtime(t)
	if got.ReconnectCount != 1 || got.FramesOut != 0 || got.ObservedState != ProjectionPriming {
		t.Errorf("second session: reconnects=%d out=%d state=%q, want 1 / 0 / priming", got.ReconnectCount, got.FramesOut, got.ObservedState)
	}
}

func TestDeletingASlotClosesItsSinkAndTheDevice(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)
	if err := sink.Write(1, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.DeleteSlot(testSlot); err != nil {
		t.Fatal(err)
	}
	recorded := f.fake.Frames(testSlot)
	if recorded.Open || recorded.Fallbacks != 1 || recorded.Closes != 1 {
		t.Errorf("adapter after slot delete: open=%v fallbacks=%d closes=%d", recorded.Open, recorded.Fallbacks, recorded.Closes)
	}
	if err := sink.Write(2, frameOf(1)); err == nil {
		t.Error("a write after the slot was deleted succeeded")
	}
	if _, err := f.controller.OpenSink(context.Background(), testResourceID, SinkEndpointID); !errors.Is(err, modulesdk.ErrSVISinkNotServed) {
		t.Errorf("open on a deleted slot returned %v, want ErrSVISinkNotServed", err)
	}
	if err := sink.Close(); err != nil {
		t.Errorf("the SDK's own Close after the controller's: %v", err)
	}
}

func TestStoppingASlotOrResizingItClosesTheSink(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)

	stopped := fakeSlotRequest()
	stopped.DesiredState = DesiredStopped
	if _, err := f.controller.PutSlot(testSlot, stopped); err != nil {
		t.Fatal(err)
	}
	if f.fake.Frames(testSlot).Open {
		t.Error("stopping the slot left the device handle open")
	}
	if err := sink.Write(1, frameOf(1)); err == nil {
		t.Error("write after the slot was stopped succeeded")
	}

	f.putSlot(t, testSlot)
	sink = f.open(t)
	resized := fakeSlotRequest()
	resized.Format = &Format{Width: 320, Height: 240, FPS: 30, PixelFormat: "YUY2"}
	if _, err := f.controller.PutSlot(testSlot, resized); err != nil {
		t.Fatal(err)
	}
	if err := sink.Write(1, frameOf(1)); err == nil {
		t.Error("a frame sized for the old format was accepted after the slot was resized")
	}
}

// plainAdapter registers slots but cannot take frames.
type plainAdapter struct{}

func (plainAdapter) Describe() AdapterDescriptor {
	return AdapterDescriptor{AdapterID: "plain.test", Kind: KindCamera, InstallState: StateReady, Health: "ok"}
}
func (plainAdapter) EnsureSlot(slot Slot) (string, error) { return "plain:" + slot.SlotID, nil }
func (plainAdapter) RemoveSlot(string) error              { return nil }

// failingOpenAdapter takes frames in principle and fails to open the device.
type failingOpenAdapter struct{ plainAdapter }

func (failingOpenAdapter) Describe() AdapterDescriptor {
	descriptor := plainAdapter{}.Describe()
	descriptor.AdapterID = "failing.test"
	return descriptor
}
func (failingOpenAdapter) OpenFrames(Slot) (FrameSink, error) { return nil, errors.New("EACCES") }

func TestOpenSinkAnswersEachCaseDistinctly(t *testing.T) {
	f := newFeedFixture(t)
	f.registry.Register(plainAdapter{})
	f.registry.Register(failingOpenAdapter{})
	f.putSlot(t, testSlot)
	for slotID, adapterID := range map[string]string{"camera-plain": "plain.test", "camera-fail": "failing.test"} {
		request := fakeSlotRequest()
		request.AdapterID = adapterID
		if _, err := f.controller.PutSlot(slotID, request); err != nil {
			t.Fatal(err)
		}
	}
	noFormat := fakeSlotRequest()
	noFormat.Format = nil
	if _, err := f.controller.PutSlot("camera-bare", noFormat); err != nil {
		t.Fatalf("a slot with no format is allowed: %v", err)
	}
	stopped := fakeSlotRequest()
	stopped.DesiredState = DesiredStopped
	if _, err := f.controller.PutSlot("camera-stopped", stopped); err != nil {
		t.Fatal(err)
	}

	notServed := []struct{ resource, endpoint string }{
		{"svi.node-a.io-weave.pointer", "input"},            // someone else's
		{"svi.node-a.vdevice.no-such-slot", "input"},        // ours by shape, no such slot
		{"vdevice." + testSlot, "input"},                    // not node-canonical
		{testResourceID, "output"},                          // a slot, but not its endpoint
		{"svi.node-a.vdevice." + testSlot + "x.y", "input"}, // slot id with a dot is not a slot id
	}
	for _, c := range notServed {
		if _, err := f.controller.OpenSink(context.Background(), c.resource, c.endpoint); !errors.Is(err, modulesdk.ErrSVISinkNotServed) {
			t.Errorf("OpenSink(%q, %q) = %v, want ErrSVISinkNotServed", c.resource, c.endpoint, err)
		}
	}

	refused := map[string]string{
		"svi.n.vdevice.camera-plain":   ErrCodeAdapterUnavailable,
		"svi.n.vdevice.camera-fail":    ErrCodeHandleOpenFailed,
		"svi.n.vdevice.camera-bare":    ErrCodeFormatIncompatible,
		"svi.n.vdevice.camera-stopped": ErrCodeAdapterUnavailable,
	}
	for resource, code := range refused {
		_, err := f.controller.OpenSink(context.Background(), resource, SinkEndpointID)
		if err == nil || errors.Is(err, modulesdk.ErrSVISinkNotServed) || codeOf(err) != code {
			t.Errorf("OpenSink(%s) = %v, want a plain error with %s", resource, err, code)
		}
	}
	// A failed open must not leave the slot reserved.
	if _, err := f.controller.OpenSink(context.Background(), "svi.n.vdevice.camera-fail", SinkEndpointID); codeOf(err) != ErrCodeHandleOpenFailed {
		t.Errorf("second attempt on a failed open = %v; the slot stayed reserved", err)
	}
}

func TestResourcesAreValidSVIAndTrackTheSlotSet(t *testing.T) {
	f := newFeedFixture(t)
	resources, err := f.controller.Resources(context.Background())
	if err != nil || len(resources) != 0 {
		t.Fatalf("no slots: %v %v", resources, err)
	}

	f.putSlot(t, testSlot)
	f.registry.Register(plainAdapter{})
	other := fakeSlotRequest()
	other.AdapterID = "plain.test"
	other.DisplayName = "Plain camera"
	if _, err := f.controller.PutSlot("camera-plain", other); err != nil {
		t.Fatal(err)
	}

	resources, _ = f.controller.Resources(context.Background())
	if len(resources) != 2 {
		t.Fatalf("resources = %d, want 2", len(resources))
	}
	byID := map[string]svi.ResourceDescriptor{}
	for _, resource := range resources {
		byID[resource.ResourceID] = resource
		// The host fills these in; set them as it does, then run the host's own
		// validation (the SDK ships it for exactly this).
		filled := resource
		filled.NodeID, filled.ProviderID = "node-a", ModuleID
		filled.Owner = svi.SubjectRef{Type: svi.SubjectApplication, ID: ModuleID}
		filled.ExpiresAt = time.Now().Add(time.Minute)
		if err := svi.ValidateResource(filled); err != nil {
			t.Errorf("%s does not validate: %v", resource.ResourceID, err)
		}
		if !resource.ExpiresAt.IsZero() || resource.NodeID != "" || resource.ProviderID != "" {
			t.Errorf("%s fills fields the host owns", resource.ResourceID)
		}
		if len(resource.StatusReason) > svi.MaxStatusReasonLength {
			t.Errorf("status_reason too long")
		}
	}
	main := byID[SinkResourcePrefix+testSlot]
	if main.Kind != "virtual-device.camera" || main.CanonicalName != "virtual-device/"+testSlot || main.DisplayName != "Terra Virtual Camera" {
		t.Errorf("descriptor naming: %+v", main)
	}
	endpoint := main.Endpoints[0]
	if endpoint.EndpointID != SinkEndpointID || endpoint.Direction != svi.DirectionSink || endpoint.Interaction != svi.InteractionStream {
		t.Errorf("endpoint shape: %+v", endpoint)
	}
	if endpoint.InputSchema != SinkSchema || endpoint.MaxConsumers != 1 || !endpoint.Exclusive {
		t.Errorf("endpoint schema/consumers: %+v", endpoint)
	}
	if endpoint.Metadata["width"] != 640 || endpoint.Metadata["height"] != 480 || endpoint.Metadata["frame_bytes"] != testFrameBytes ||
		endpoint.Metadata["pixel_format"] != "YUY2" || endpoint.Metadata["simulated"] != true {
		t.Errorf("metadata = %v", endpoint.Metadata)
	}
	if main.Status != svi.ResourceAvailable || endpoint.Status != svi.ResourceAvailable {
		t.Errorf("a ready slot is %s/%s, want available", main.Status, endpoint.Status)
	}
	if got := byID["vdevice.camera-plain"]; got.Status != svi.ResourceUnavailable || got.StatusReason != "adapter_cannot_take_frames" {
		t.Errorf("a slot whose adapter cannot take frames: %s/%q", got.Status, got.StatusReason)
	}

	// busy while a sink is open, available again after
	sink := f.open(t)
	resources, _ = f.controller.Resources(context.Background())
	if resources[0].Status != svi.ResourceBusy || resources[0].Endpoints[0].Status != svi.ResourceBusy {
		t.Errorf("with a sink open: %s, want busy", resources[0].Status)
	}
	_ = sink.Close()
	resources, _ = f.controller.Resources(context.Background())
	if resources[0].Status != svi.ResourceAvailable {
		t.Errorf("after close: %s, want available", resources[0].Status)
	}

	// a stopped slot says why it is unavailable; a deleted one is gone
	stopped := fakeSlotRequest()
	stopped.DesiredState = DesiredStopped
	if _, err := f.controller.PutSlot(testSlot, stopped); err != nil {
		t.Fatal(err)
	}
	resources, _ = f.controller.Resources(context.Background())
	if resources[0].Status != svi.ResourceUnavailable || resources[0].StatusReason != "slot_disabled" {
		t.Errorf("stopped slot: %s/%q", resources[0].Status, resources[0].StatusReason)
	}
	if err := f.controller.DeleteSlot("camera-plain"); err != nil {
		t.Fatal(err)
	}
	resources, _ = f.controller.Resources(context.Background())
	if len(resources) != 1 {
		t.Errorf("after delete: %d resources, want 1", len(resources))
	}
}

func TestSlotFormatsTheSinkCannotCarryAreRefusedAtDeclaration(t *testing.T) {
	f := newFeedFixture(t)
	for name, format := range map[string]Format{
		"720p is over the sink limit":   {Width: 1280, Height: 720, FPS: 30, PixelFormat: "YUY2"},
		"not YUY2":                      {Width: 640, Height: 480, FPS: 30, PixelFormat: "NV12"},
		"no pixel format":               {Width: 640, Height: 480},
		"no size":                       {PixelFormat: "YUY2"},
		"odd width":                     {Width: 641, Height: 480, PixelFormat: "YUY2"},
		"absurd size does not overflow": {Width: 1 << 40, Height: 1 << 40, PixelFormat: "YUY2"},
	} {
		request := fakeSlotRequest()
		request.Format = &format
		if _, err := f.controller.PutSlot(testSlot, request); codeOf(err) != ErrCodeFormatIncompatible {
			t.Errorf("%s: PutSlot = %v, want %s", name, err, ErrCodeFormatIncompatible)
		}
	}
	if len(f.controller.Slots()) != 0 {
		t.Error("a refused slot was stored")
	}
	// The largest fitting size and lowercase spelling are accepted.
	request := fakeSlotRequest()
	request.Format = &Format{Width: 640, Height: 480, PixelFormat: "yuy2"}
	if _, err := f.controller.PutSlot(testSlot, request); err != nil {
		t.Errorf("640x480 yuy2: %v", err)
	}
	if testFrameBytes > MaxSinkFrameBytes {
		t.Fatal("640x480 YUY2 no longer fits the sink limit")
	}
}

func TestSlotIDFromResource(t *testing.T) {
	good := map[string]string{
		"svi.node-a.vdevice.camera-main":   "camera-main",
		"svi.node.with.dots.vdevice.cam-2": "cam-2",
		"svi.n.vdevice.vdevice-slot":       "vdevice-slot",
	}
	for resource, want := range good {
		if got, ok := slotIDFromResource(resource); !ok || got != want {
			t.Errorf("slotIDFromResource(%q) = %q, %v; want %q", resource, got, ok, want)
		}
	}
	for _, resource := range []string{"", "vdevice.camera-main", "svi.n.vdevice.", "svi.n.vdevice.Bad_Id", "svi.n.io-weave.pointer", "svi.n.vdevice.a.b"} {
		if got, ok := slotIDFromResource(resource); ok {
			t.Errorf("slotIDFromResource(%q) = %q, want no match", resource, got)
		}
	}
}

// Without cgo the race detector is unavailable on Windows, so this exercises the
// lock discipline of feed.go as hard as it can without it: writers, resource
// polls, runtime reads and a slot delete at once. Run it with -race where
// available; here it must at least not deadlock or panic.
func TestConcurrentWritesPollsAndDeleteDoNotDeadlock(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	f.declareProjection(t)
	sink := f.open(t)

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_, _ = f.controller.Resources(context.Background())
					_, _ = f.controller.Projection("proj-" + testSlot)
					_ = f.controller.Diagnostics()
				}
			}
		}()
	}
	writer := make(chan struct{})
	go func() {
		defer close(writer)
		frame := frameOf(9)
		for sequence := uint64(1); ; sequence++ {
			if err := sink.Write(sequence, frame); err != nil {
				return // closed by the delete below
			}
		}
	}()
	time.Sleep(30 * time.Millisecond)
	// An active projection would refuse the delete; stop it first, as an
	// operator must.
	stopRequest := ProjectionRequest{SlotID: testSlot, Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 2, DesiredState: DesiredStopped}
	if _, err := f.controller.PutProjection("proj-"+testSlot, stopRequest); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.DeleteSlot(testSlot); err != nil {
		t.Fatal(err)
	}
	select {
	case <-writer:
	case <-time.After(5 * time.Second):
		t.Fatal("the writer was not stopped by the slot delete")
	}
	close(stop)
	wg.Wait()

	// Final state, not just "did not hang": the slot is gone, its sink with it,
	// and the counters the pollers read never ran ahead of each other.
	if _, err := f.controller.Slot(testSlot); codeOf(err) != ErrCodeSlotNotFound {
		t.Errorf("slot after delete: %v, want %s", err, ErrCodeSlotNotFound)
	}
	if _, open := f.controller.sinkFrameSpec(testSlot); open {
		t.Error("the deleted slot still has an open sink")
	}
	if got := f.fake.Frames(testSlot); got.Open || got.Closes != got.Opens {
		t.Errorf("device after delete: open=%v opens=%d closes=%d", got.Open, got.Opens, got.Closes)
	}
	if err := sink.Write(1<<20, frameOf(9)); err == nil {
		t.Error("a write after the delete succeeded")
	}
	stats := f.controller.feedSnapshot(testSlot).Stats
	if stats.FramesOut > stats.FramesIn {
		t.Errorf("frames_out %d ran ahead of frames_in %d", stats.FramesOut, stats.FramesIn)
	}
	if recorded := f.fake.Frames(testSlot).Frames; uint64(recorded) < stats.FramesOut {
		t.Errorf("the device recorded %d frames but frames_out says %d", recorded, stats.FramesOut)
	}
}

func TestStatusAndDiagnosticsNoLongerPromiseThePhase1Daemon(t *testing.T) {
	f := newFeedFixture(t)
	status := f.controller.Status()
	if strings.Contains(status.Daemon.Detail, "arrives in Phase 1") || !strings.Contains(status.Daemon.Detail, "binding") {
		t.Errorf("daemon.detail is stale or silent about bindings: %q", status.Daemon.Detail)
	}
	for _, note := range f.controller.Diagnostics().Notes {
		if strings.Contains(note, "arrive in Phase 1") || strings.Contains(note, "Phase 0 build") {
			t.Errorf("stale diagnostics note: %q", note)
		}
	}
}
