package weave

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	ioweave "github.com/terra-project/terra/products/common/packages/terra-io-weave"
	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"

	"github.com/terra-project/terra/products/common/packages/terra-testwait"
)

// fakeInjector stands in for a virtual input device.
//
// The real one needs /dev/uinput, which no node in this fleet has by default
// and no CI runner has at all, so the concurrency this file is about — a write
// that never returns and a watchdog that has to reach past it — would
// otherwise be tested nowhere. What it is NOT standing in for is the kernel
// contract: uinput_linux_test.go checks that against the kernel itself where
// one is available.
type fakeInjector struct {
	mu       sync.Mutex
	events   []protocol.PointerEvent
	released int
	closed   int

	// block is closed by the test to let a stuck Pointer call return. While it
	// is open, Pointer holds mu — which is exactly the shape of a hung write,
	// and the reason Close must not need mu.
	block chan struct{}
	// fail is returned by the next Pointer call.
	fail error
}

func (f *fakeInjector) Pointer(event protocol.PointerEvent) error {
	if f.block != nil {
		<-f.block
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	// A closed device refuses, as the real one does: writing to a destroyed
	// uinput descriptor returns an error rather than going nowhere quietly.
	if f.closed > 0 {
		return errInjectionClosed
	}
	if f.fail != nil {
		return f.fail
	}
	f.events = append(f.events, event)
	return nil
}

func (f *fakeInjector) Release() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.released++
	return nil
}

func (f *fakeInjector) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed++
	return nil
}

func (f *fakeInjector) Describe() string  { return "fake virtual pointer" }
func (f *fakeInjector) SysfsPath() string { return "/devices/virtual/input/input99" }
func (f *fakeInjector) closeCount() int   { f.mu.Lock(); defer f.mu.Unlock(); return f.closed }
func (f *fakeInjector) releaseCount() int { f.mu.Lock(); defer f.mu.Unlock(); return f.released }
func (f *fakeInjector) seen() []protocol.PointerEvent {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]protocol.PointerEvent(nil), f.events...)
}

// injectingProjection is a node configured to be driven, with the OS replaced.
func injectingProjection(t *testing.T, device injector) *Projection {
	t.Helper()
	store := NewSettingsStore(filepath.Join(t.TempDir(), "settings.json"))
	settings := Settings{Profile: ioweave.ProfileShell, SourceLayout: "us", Injection: InjectionAuto}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	projection, err := NewProjection(store, InjectionStatus{
		Implemented: true, Available: true, Platform: "test", Detail: "test backend",
	})
	if err != nil {
		t.Fatal(err)
	}
	projection.openInjector = func() (injector, error) { return device, nil }
	projection.lockState = func() lockState { return lockState{Reason: "test: nothing locked"} }
	projection.watchdogTimeout = 50 * time.Millisecond
	return projection
}

// A node that really drives its own pointer says inject. A node that does not
// says translate — and the difference is read from the device, not from the
// setting that asked for one.
func TestModeIsInjectOnlyWhileADeviceIsLive(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)

	if mode := projection.State().Mode; mode != ModeTranslate {
		t.Fatalf("mode before any binding = %q, want %q", mode, ModeTranslate)
	}
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	state := projection.State()
	if state.Mode != ModeInject {
		t.Fatalf("mode while bound = %q, want %q", state.Mode, ModeInject)
	}
	if state.ModeDetail != device.Describe() {
		t.Fatalf("mode detail = %q, want the device's own description", state.ModeDetail)
	}

	projection.Detach("bnd-1")
	state = projection.State()
	if state.Mode != ModeTranslate {
		t.Fatalf("mode after detach = %q, want %q", state.Mode, ModeTranslate)
	}
	if device.closeCount() != 1 {
		t.Fatalf("device closed %d times on detach, want once", device.closeCount())
	}
	if device.releaseCount() != 1 {
		t.Fatalf("buttons released %d times on detach, want once", device.releaseCount())
	}
	if state.Escape == nil || state.Escape.Reason != EscapeReleased {
		t.Fatalf("escape after detach = %+v, want %q", state.Escape, EscapeReleased)
	}
}

// A node that is not configured to be driven never opens a device, whatever
// the platform would allow. Turning on global input injection because a udev
// rule happened to be present is a grant nobody gave.
func TestInjectionStaysOffUntilTheNodeAsksForIt(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)
	if err := projection.Configure(Settings{Profile: ioweave.ProfileShell, SourceLayout: "us", Injection: InjectionOff}); err != nil {
		t.Fatal(err)
	}
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	defer projection.Detach("bnd-1")

	state := projection.State()
	if state.Mode != ModeTranslate {
		t.Fatalf("mode = %q with injection off, want %q", state.Mode, ModeTranslate)
	}
	if state.Escape != nil {
		t.Fatalf("escape = %+v; injection that was never asked for did not escape from anything", state.Escape)
	}
	if len(device.seen()) != 0 {
		t.Fatal("a device was opened for a node that did not ask to be driven")
	}
}

// D-15. uinput reaches a lock screen exactly as a physical mouse does, so the
// far end of a binding could unlock this machine. A locked session gets no
// device at all — not a device that refuses frames — and the reason says which
// of the four "my pointer does not move" causes this one is.
func TestALockedSessionGetsNoDevice(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)
	projection.lockState = func() lockState {
		return lockState{Locked: true, Reason: "logind session c1 reports LOCKED_HINT=yes"}
	}
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	defer projection.Detach("bnd-1")

	state := projection.State()
	if state.Mode != ModeInject {
		// The binding still carries frames; it just translates them.
	} else {
		t.Fatal("a locked node opened an input device")
	}
	if state.Escape == nil || state.Escape.Reason != EscapeLockScreen {
		t.Fatalf("escape = %+v, want %q", state.Escape, EscapeLockScreen)
	}
	if !strings.Contains(state.Escape.Detail, "LOCKED_HINT") {
		t.Fatalf("escape detail = %q, want what was consulted", state.Escape.Detail)
	}
}

// D-22 layer 4. A write that never returns leaves the device grabbed and the
// kernel none the wiser — the descriptor is still open, so layer 5 never
// fires. The timer inside the process is the only thing that can tell.
func TestWatchdogTakesTheDeviceBackFromAHungWrite(t *testing.T) {
	device := &fakeInjector{block: make(chan struct{})}
	projection := injectingProjection(t, device)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}

	applied := make(chan error, 1)
	go func() {
		applied <- projection.Apply(1, frame(t, protocol.PointerEvent{Position: protocol.PointerPosition{X: 1, Y: 2}}))
	}()

	// The watchdog must close the device WITHOUT the write returning first:
	// that is the failure it exists for, and a test that unblocked the write
	// would be testing the ordinary path.
	deadline := time.Now().Add(testwait.Budget())
	for device.closeCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the watchdog never took the device back from a write that did not return")
		}
		time.Sleep(5 * time.Millisecond)
	}

	state := projection.State()
	if state.Mode != ModeTranslate {
		t.Fatalf("mode after the watchdog fired = %q, want %q", state.Mode, ModeTranslate)
	}
	if state.Escape == nil || state.Escape.Reason != EscapeWatchdogExpired {
		t.Fatalf("escape = %+v, want %q", state.Escape, EscapeWatchdogExpired)
	}
	if state.Escape.At == "" {
		t.Fatal("escape carries no time; a reason with no when cannot be matched to what the person saw")
	}

	close(device.block)
	if err := <-applied; err == nil {
		t.Fatal("the stuck frame reported success after its device was destroyed")
	}

	// And the node goes on projecting. Losing the device is a smaller outcome
	// than the operator asked for, not a broken binding.
	if err := projection.Apply(2, frame(t, protocol.PointerEvent{ScrollY: 1})); err != nil {
		t.Fatalf("translation after the escape failed: %v", err)
	}
	if projection.State().Mode != ModeTranslate {
		t.Fatal("mode returned to inject without anyone asking for a new device")
	}
	projection.Detach("bnd-1")
}

// A device that refuses a write ends injection with a reason, rather than
// being retried into silence. §6.5: the binding staying green while every
// gesture disappears is the failure, not the error.
func TestADeviceThatRefusesAWriteEndsInjection(t *testing.T) {
	device := &fakeInjector{fail: errors.New("kernel said no")}
	projection := injectingProjection(t, device)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	defer projection.Detach("bnd-1")

	if err := projection.Apply(1, frame(t, protocol.PointerEvent{})); err == nil {
		t.Fatal("a refused frame reported success")
	}
	state := projection.State()
	if state.Mode != ModeTranslate {
		t.Fatalf("mode = %q after the device failed, want %q", state.Mode, ModeTranslate)
	}
	if state.Escape == nil || state.Escape.Reason != EscapeDeviceFailed {
		t.Fatalf("escape = %+v, want %q", state.Escape, EscapeDeviceFailed)
	}
	if !strings.Contains(state.Escape.Detail, "kernel said no") {
		t.Fatalf("escape detail = %q, want what the device said", state.Escape.Detail)
	}
}

// Turning injection off is a safety action, so it applies to the binding that
// is running rather than the next one.
func TestSwitchingInjectionOffStopsTheLiveDevice(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	defer projection.Detach("bnd-1")
	if projection.State().Mode != ModeInject {
		t.Fatal("setup: the node is not injecting")
	}

	if err := projection.Configure(Settings{Profile: ioweave.ProfileShell, SourceLayout: "us", Injection: InjectionOff}); err != nil {
		t.Fatal(err)
	}
	if device.closeCount() != 1 {
		t.Fatalf("device closed %d times, want once — switching off must not wait for the binding to end", device.closeCount())
	}
	state := projection.State()
	if state.Mode != ModeTranslate {
		t.Fatalf("mode = %q after switching injection off, want %q", state.Mode, ModeTranslate)
	}
	if state.Escape == nil || state.Escape.Reason != EscapeReleased {
		t.Fatalf("escape = %+v, want %q", state.Escape, EscapeReleased)
	}
}

// Frames reach the device, and the position is the wire's own normalized
// space — not pixels, not deltas.
func TestInjectedFramesCarryTheWirePosition(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	defer projection.Detach("bnd-1")

	event := protocol.PointerEvent{
		Position: protocol.PointerPosition{X: protocol.PointerPositionMax, Y: 0},
		Buttons:  []protocol.PointerButton{protocol.PointerButtonLeft},
	}
	if err := projection.Apply(1, frame(t, event)); err != nil {
		t.Fatal(err)
	}
	seen := device.seen()
	if len(seen) != 1 {
		t.Fatalf("device saw %d frames, want 1", len(seen))
	}
	if seen[0].Position != event.Position || len(seen[0].Buttons) != 1 {
		t.Fatalf("device saw %+v, want %+v", seen[0], event)
	}

	// An injecting node counts the frame as applied, and records no terminal
	// action: there is nothing to translate when the pointer really moved.
	state := projection.State()
	if state.Applied != 1 || state.Refused != 0 {
		t.Fatalf("applied/refused = %d/%d, want 1/0", state.Applied, state.Refused)
	}
	if len(state.Actions) != 0 {
		t.Fatalf("recorded %d translated actions while injecting: %+v", len(state.Actions), state.Actions)
	}
}

// An unknown injection mode is refused rather than quietly read as off. A node
// whose operator asked for something this build does not have must hear that,
// not run in a mode nobody chose.
func TestUnknownInjectionModeIsRefused(t *testing.T) {
	projection := injectingProjection(t, &fakeInjector{})
	err := projection.Configure(Settings{Profile: ioweave.ProfileShell, SourceLayout: "us", Injection: "on"})
	if err == nil {
		t.Fatal("an unknown injection mode was accepted")
	}
	if !strings.Contains(err.Error(), "injection mode") {
		t.Fatalf("error = %v, want it to name the field it rejected", err)
	}
}

// A settings document written before the injection field existed still means
// what it meant: injection off, not an invalid document.
func TestSettingsWithoutAnInjectionFieldDefaultToOff(t *testing.T) {
	settings := Settings{Profile: ioweave.ProfileShell, SourceLayout: "us"}
	if err := settings.Validate(); err != nil {
		t.Fatalf("a document from before the field existed is invalid: %v", err)
	}
	store := NewSettingsStore(filepath.Join(t.TempDir(), "settings.json"))
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Injection != InjectionOff {
		t.Fatalf("injection = %q, want %q", loaded.Injection, InjectionOff)
	}
}

// The device handle and the watchdog are the only concurrency in this module,
// and they are the kind that passes every ordinary test and then deadlocks on
// a node at three in the morning: a timer that must reach a resource a stuck
// writer is holding. Run under -race, this is the shape that catches a lock
// taken in the wrong order or a field read outside one.
func TestConcurrentFramesTeardownAndStateAreRaceFree(t *testing.T) {
	device := &fakeInjector{}
	projection := injectingProjection(t, device)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}

	const writers = 8
	var wait sync.WaitGroup
	for writer := 0; writer < writers; writer++ {
		wait.Add(1)
		go func(writer int) {
			defer wait.Done()
			for sequence := 0; sequence < 200; sequence++ {
				// Errors are expected once teardown wins the race; the point
				// is that nothing here corrupts or deadlocks.
				_ = projection.Apply(uint64(writer*1000+sequence), frame(t, protocol.PointerEvent{
					Position: protocol.PointerPosition{X: uint16(sequence), Y: uint16(writer)},
				}))
			}
		}(writer)
	}
	wait.Add(1)
	go func() {
		defer wait.Done()
		for i := 0; i < 200; i++ {
			_ = projection.State()
		}
	}()

	projection.Detach("bnd-1")
	wait.Wait()

	if projection.State().Mode != ModeTranslate {
		t.Fatal("still injecting after the binding ended")
	}
	if device.closeCount() != 1 {
		t.Fatalf("device closed %d times, want exactly once however the calls interleaved", device.closeCount())
	}
}
