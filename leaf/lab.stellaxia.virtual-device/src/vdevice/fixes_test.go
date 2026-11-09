package vdevice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/StellaxiaLab/terra-sdk/svi"
)

// flakyAdapter is the Fake with knobs for the failures a real device has: a
// device that is not there yet, one that will not go away, one that is bad.
type flakyAdapter struct {
	*FakeAdapter

	mu        sync.Mutex
	ensureErr error
	removeErr error
	notReady  map[string]string // slot id -> reason
	ensures   int
}

func newFlakyAdapter() *flakyAdapter {
	return &flakyAdapter{FakeAdapter: NewFakeAdapter(), notReady: map[string]string{}}
}

func (a *flakyAdapter) set(update func(*flakyAdapter)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	update(a)
}

func (a *flakyAdapter) EnsureSlot(slot Slot) (string, error) {
	a.mu.Lock()
	a.ensures++
	err := a.ensureErr
	a.mu.Unlock()
	if err != nil {
		return "", err
	}
	return a.FakeAdapter.EnsureSlot(slot)
}

func (a *flakyAdapter) RemoveSlot(slotID string) error {
	a.mu.Lock()
	err := a.removeErr
	a.mu.Unlock()
	if err != nil {
		return err
	}
	return a.FakeAdapter.RemoveSlot(slotID)
}

func (a *flakyAdapter) SlotReady(slotID string) (bool, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if reason, bad := a.notReady[slotID]; bad {
		return false, reason
	}
	return true, ""
}

func (a *flakyAdapter) ensureCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ensures
}

// newFlakyController builds a Controller whose "fake.in-memory" is the flaky
// adapter, over the state file at path.
func newFlakyController(t *testing.T, path string, flaky *flakyAdapter) *Controller {
	t.Helper()
	registry := NewAdapterRegistry()
	registry.Register(flaky)
	controller, err := NewController(DefaultConfig(), registry, NewStore(path))
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	return controller
}

func openFlakySink(t *testing.T, c *Controller) (interface {
	Write(uint64, []byte) error
	Close() error
}, error) {
	t.Helper()
	return c.OpenSink(context.Background(), testResourceID, SinkEndpointID)
}

func resourceStatus(t *testing.T, c *Controller, slotID string) (svi.ResourceStatus, string) {
	t.Helper()
	resources, _ := c.Resources(context.Background())
	for _, resource := range resources {
		if resource.ResourceID == SinkResourcePrefix+slotID {
			return resource.Status, resource.StatusReason
		}
	}
	t.Fatalf("no resource for slot %s", slotID)
	return "", ""
}

// D1: a Slot whose start-up EnsureSlot failed must come back when its device
// appears, instead of failing OpenFrames with SLOT_NOT_FOUND for the life of the
// process while the catalog calls it available.
func TestSlotWhoseBootEnsureFailedRecoversWhenTheDeviceAppears(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	first := newFlakyController(t, path, newFlakyAdapter())
	if _, err := first.PutSlot(testSlot, fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}

	flaky := newFlakyAdapter()
	flaky.set(func(a *flakyAdapter) {
		a.ensureErr = errors.New("no such device yet")
		a.notReady[testSlot] = "device missing"
	})
	c := newFlakyController(t, path, flaky)
	slot, _ := c.Slot(testSlot)
	if slot.InstallState != StateNotInstalled {
		t.Fatalf("boot ensure failed but the slot is %q", slot.InstallState)
	}
	if status, reason := resourceStatus(t, c, testSlot); status != svi.ResourceUnavailable || reason != "slot_device_unavailable" {
		t.Fatalf("a slot with no device is published %s/%q", status, reason)
	}

	// The device appears. The catalog offers the slot again and the open works.
	flaky.set(func(a *flakyAdapter) { a.ensureErr = nil; delete(a.notReady, testSlot) })
	if status, _ := resourceStatus(t, c, testSlot); status != svi.ResourceAvailable {
		t.Fatalf("device is back but the slot is %s", status)
	}
	sink, err := openFlakySink(t, c)
	if err != nil {
		t.Fatalf("open after the device appeared: %v (want the slot re-ensured)", err)
	}
	defer sink.Close()
	if err := sink.Write(1, frameOf(7)); err != nil {
		t.Fatal(err)
	}
	slot, _ = c.Slot(testSlot)
	if slot.InstallState != StateReady || slot.OSDeviceID != "fake:"+testSlot {
		t.Errorf("recovered slot is %q / %q, want ready / fake:%s", slot.InstallState, slot.OSDeviceID, testSlot)
	}
	if got := flaky.Frames(testSlot).Frames; got != 1 {
		t.Errorf("device got %d frames, want 1", got)
	}
}

// An open that still cannot ensure the slot fails with the adapter's own error
// and leaves nothing reserved.
func TestOpenSinkThatCannotEnsureTheSlotFailsCleanly(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	flaky := newFlakyAdapter()
	c := newFlakyController(t, path, flaky)
	if _, err := c.PutSlot(testSlot, fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	flaky.set(func(a *flakyAdapter) { a.ensureErr = domainError(ErrCodeOSPermissionDenied, "denied") })
	if _, err := openFlakySink(t, c); codeOf(err) != ErrCodeOSPermissionDenied {
		t.Fatalf("open = %v, want %s", err, ErrCodeOSPermissionDenied)
	}
	if _, open := c.sinkFrameSpec(testSlot); open {
		t.Error("a failed open left the slot reserved")
	}
}

// D1 for adapters that cannot answer per slot: the recorded install state is
// what the catalog uses.
func TestSlotWithoutReadinessInterfaceIsJudgedByItsRecordedState(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	good := NewAdapterRegistry()
	good.Register(&toggleAdapter{})
	first, err := NewController(DefaultConfig(), good, NewStore(path))
	if err != nil {
		t.Fatal(err)
	}
	request := fakeSlotRequest()
	request.AdapterID = "toggle.test"
	if _, err := first.PutSlot(testSlot, request); err != nil {
		t.Fatal(err)
	}
	broken := NewAdapterRegistry()
	broken.Register(&toggleAdapter{fail: true})
	second, err := NewController(DefaultConfig(), broken, NewStore(path))
	if err != nil {
		t.Fatal(err)
	}
	if status, reason := resourceStatus(t, second, testSlot); status != svi.ResourceUnavailable || reason != "slot_device_unavailable" {
		t.Errorf("a slot the adapter could not ensure is published %s/%q", status, reason)
	}
}

// toggleAdapter takes frames in principle and has no per-slot readiness.
type toggleAdapter struct {
	plainAdapter
	fail bool
}

func (a *toggleAdapter) Describe() AdapterDescriptor {
	descriptor := a.plainAdapter.Describe()
	descriptor.AdapterID = "toggle.test"
	return descriptor
}
func (a *toggleAdapter) EnsureSlot(slot Slot) (string, error) {
	if a.fail {
		return "", errors.New("no device")
	}
	return a.plainAdapter.EnsureSlot(slot)
}
func (a *toggleAdapter) OpenFrames(Slot) (FrameSink, error) { return nil, errors.New("unused") }

// D1: a failed RemoveSlot must not leave the stored slot claiming a device the
// adapter may no longer have; the declaration is kept, the state says so, and a
// retry finishes the delete.
func TestDeleteSlotWhoseRemoveFailedKeepsTheDeclarationAndCanBeRetried(t *testing.T) {
	flaky := newFlakyAdapter()
	c := newFlakyController(t, filepath.Join(t.TempDir(), StateFileName), flaky)
	if _, err := c.PutSlot(testSlot, fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	flaky.set(func(a *flakyAdapter) { a.removeErr = errors.New("close failed") })
	if err := c.DeleteSlot(testSlot); err == nil {
		t.Fatal("delete succeeded although the adapter failed to remove the device")
	}
	slot, err := c.Slot(testSlot)
	if err != nil {
		t.Fatalf("the declaration is gone after a failed delete: %v", err)
	}
	if slot.InstallState != StateNotInstalled || slot.OSDeviceID != "" {
		t.Errorf("slot after a failed remove claims %q / %q", slot.InstallState, slot.OSDeviceID)
	}
	flaky.set(func(a *flakyAdapter) { a.removeErr = nil })
	if err := c.DeleteSlot(testSlot); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if _, err := c.Slot(testSlot); codeOf(err) != ErrCodeSlotNotFound {
		t.Errorf("slot after retry: %v", err)
	}
}

// D2: one Slot's broken device must not hide behind another Slot's good one.
func TestSlotReadinessIsPerSlot(t *testing.T) {
	flaky := newFlakyAdapter()
	c := newFlakyController(t, filepath.Join(t.TempDir(), StateFileName), flaky)
	for _, id := range []string{"camera-main", "camera-bad"} {
		if _, err := c.PutSlot(id, fakeSlotRequest()); err != nil {
			t.Fatal(err)
		}
	}
	flaky.set(func(a *flakyAdapter) { a.notReady["camera-bad"] = "/dev/video11 is busy" })
	if status, _ := resourceStatus(t, c, "camera-main"); status != svi.ResourceAvailable {
		t.Errorf("the healthy slot is %s", status)
	}
	if status, reason := resourceStatus(t, c, "camera-bad"); status != svi.ResourceUnavailable || reason != "slot_device_unavailable" {
		t.Errorf("the slot with the bad device is %s/%q, want unavailable", status, reason)
	}
	if _, err := c.PutProjection("proj-bad", ProjectionRequest{SlotID: "camera-bad", Source: Source{ResourceID: "r", EndpointID: "video"}, Generation: 1}); err != nil {
		t.Fatal(err)
	}
	view, _ := c.Projection("proj-bad")
	if view.Runtime.ObservedState != ProjectionWaitingDriver || !contains(view.Runtime.ReasonDetail, "/dev/video11 is busy") {
		t.Errorf("runtime of the bad slot: %q / %q", view.Runtime.ObservedState, view.Runtime.ReasonDetail)
	}
}

// D3: an update the adapter refuses must leave a live sink running.
func TestPutSlotThatTheAdapterRefusesKeepsTheLiveSink(t *testing.T) {
	flaky := newFlakyAdapter()
	c := newFlakyController(t, filepath.Join(t.TempDir(), StateFileName), flaky)
	if _, err := c.PutSlot(testSlot, fakeSlotRequest()); err != nil {
		t.Fatal(err)
	}
	sink, err := openFlakySink(t, c)
	if err != nil {
		t.Fatal(err)
	}
	defer sink.Close()

	flaky.set(func(a *flakyAdapter) { a.ensureErr = domainError(ErrCodeFormatIncompatible, "refused") })
	resized := fakeSlotRequest()
	resized.Format = &Format{Width: 320, Height: 240, FPS: 30, PixelFormat: "YUY2"}
	if _, err := c.PutSlot(testSlot, resized); err == nil {
		t.Fatal("the refused update succeeded")
	}
	if err := sink.Write(1, frameOf(1)); err != nil {
		t.Errorf("the live sink was cut by an update that did not happen: %v", err)
	}
	slot, _ := c.Slot(testSlot)
	if slot.AcceptedFormats[0].Width != 640 {
		t.Errorf("the refused update changed the stored format: %+v", slot.AcceptedFormats)
	}
}

// D3: 640x480 and 480x640 are the same number of bytes and not the same picture.
func TestSameByteCountDifferentResolutionClosesTheSink(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)
	turned := fakeSlotRequest()
	turned.Format = &Format{Width: 480, Height: 640, FPS: 30, PixelFormat: "YUY2"}
	if _, err := f.controller.PutSlot(testSlot, turned); err != nil {
		t.Fatal(err)
	}
	if f.fake.Frames(testSlot).Open {
		t.Error("a 640x480 -> 480x640 change left the old sink open")
	}
	if err := sink.Write(1, frameOf(1)); err == nil {
		t.Error("a frame of the old picture was accepted after the resolution changed")
	}
}

// D3: renaming a slot is not a reason to touch its picture.
func TestRenamingASlotLeavesTheLiveSinkAlone(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	sink := f.open(t)
	if err := sink.Write(1, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	renamed := fakeSlotRequest()
	renamed.DisplayName = "A different name"
	if _, err := f.controller.PutSlot(testSlot, renamed); err != nil {
		t.Fatal(err)
	}
	if !f.fake.Frames(testSlot).Open {
		t.Fatal("a display_name edit closed the sink")
	}
	if err := sink.Write(2, frameOf(2)); err != nil {
		t.Errorf("write after a rename: %v", err)
	}
	if got := f.fake.Frames(testSlot); got.Fallbacks != 0 || got.Closes != 0 {
		t.Errorf("a rename caused fallbacks=%d closes=%d", got.Fallbacks, got.Closes)
	}
}

// D5: a source that only ever sends wrong-sized frames is not active, even after
// it was once.
func TestRefusedFramesDegradeAnActiveProjectionUntilTheNextGoodOne(t *testing.T) {
	f := newFeedFixture(t)
	f.putSlot(t, testSlot)
	f.declareProjection(t)
	sink := f.open(t)
	if err := sink.Write(1, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	if got := f.runtime(t).ObservedState; got != ProjectionActive {
		t.Fatalf("after a good frame: %q", got)
	}
	for sequence := uint64(2); sequence < 5; sequence++ {
		_ = sink.Write(sequence, []byte{1, 2, 3})
	}
	got := f.runtime(t)
	if got.ObservedState != ProjectionDegraded || got.ReasonCode != ErrCodeFrameInvalid {
		t.Fatalf("only wrong-sized frames arrive: %q/%q, want degraded/%s", got.ObservedState, got.ReasonCode, ErrCodeFrameInvalid)
	}
	if err := sink.Write(5, frameOf(1)); err != nil {
		t.Fatal(err)
	}
	got = f.runtime(t)
	if got.ObservedState != ProjectionActive || got.ReasonCode != "" || got.ReasonDetail != "" {
		t.Errorf("a good frame did not clear it: %q/%q/%q", got.ObservedState, got.ReasonCode, got.ReasonDetail)
	}
}

// D6: a stopped slot stays stopped across a restart: no device work, state
// disabled.
func TestRestartDoesNotEnsureAStoppedSlot(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	first := newFlakyController(t, path, newFlakyAdapter())
	stopped := fakeSlotRequest()
	stopped.DesiredState = DesiredStopped
	if _, err := first.PutSlot(testSlot, stopped); err != nil {
		t.Fatal(err)
	}
	flaky := newFlakyAdapter()
	c := newFlakyController(t, path, flaky)
	if got := flaky.ensureCount(); got != 0 {
		t.Errorf("a stopped slot was ensured %d times at start-up", got)
	}
	slot, _ := c.Slot(testSlot)
	if slot.InstallState != StateDisabled || slot.Enabled {
		t.Errorf("stopped slot after restart: %q enabled=%v", slot.InstallState, slot.Enabled)
	}
	if got := flaky.RegisteredSlots(); len(got) != 0 {
		t.Errorf("a stopped slot was registered with the adapter: %v", got)
	}
}

// Proposal 10: a declaration that could not be saved is not a declaration, and
// the device made for it must not be left behind.
func TestPutSlotThatCannotBeSavedUndoesTheAdapter(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	flaky := newFlakyAdapter()
	c := newFlakyController(t, path, flaky)
	// Make every later save fail: the temporary file's name is taken by a directory.
	if err := os.Mkdir(path+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := c.PutSlot(testSlot, fakeSlotRequest()); err == nil {
		t.Fatal("PutSlot succeeded although the state could not be written")
	}
	if _, err := c.Slot(testSlot); codeOf(err) != ErrCodeSlotNotFound {
		t.Errorf("an unsaved slot is in memory: %v", err)
	}
	if got := flaky.RegisteredSlots(); len(got) != 0 {
		t.Errorf("the adapter still holds the unsaved slot: %v", got)
	}
}
