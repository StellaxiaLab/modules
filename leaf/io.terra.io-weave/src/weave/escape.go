package weave

import (
	"sync"
	"time"

	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
)

// The escape path (D-22).
//
// Capture and injection take the input away from whoever is sitting at the
// machine, and on Linux there is NO escape the operating system guarantees:
// EVIOCGRAB blocks every user-space consumer, so even the display server's VT
// switch is swallowed. Windows keeps Ctrl+Alt+Del out of reach of hooks;
// Linux keeps nothing. The design answers that with five layers, and the
// numbering is the order they are reached, not the order they matter:
//
//	1  hotkey                       — everyday "give it back"          (M4)
//	2  idle timeout                 — the person walked away           (M4)
//	3  heartbeat TTL (D-21)         — the sink stopped confirming      (next session)
//	4  hard timer + watchdog        — the process HUNG                 (here)
//	5  process death → kernel drops the fd                             (free, D-12)
//
// Layer 4 is the one that cannot be skipped to get the others, and it is the
// reason injection ships in this change rather than before it. A hung process
// is invisible to layer 5: the descriptor is still open, so the kernel sees a
// healthy owner and the device stays grabbed forever. Nothing outside the
// process can tell that apart from a quiet session, so the timer has to live
// inside it.
//
// What layer 4 measures here is progress, not traffic. A pointer that has not
// moved for a minute is a person reading; a single frame that has been
// half-injected for two seconds is a write that will never return. Timing out
// on silence would tear the device down under an idle user, which is layer 2's
// job with layer 2's much longer patience.

// EscapeReason is why injection stopped. It is a code rather than a sentence
// because §6.5 is explicit that the cursor coming back tells nobody anything:
// six different failures produce the same silence, and a person who cannot
// name which one they are looking at will guess at the network every time.
type EscapeReason string

const (
	// EscapeReleased is the orderly path: the binding ended.
	EscapeReleased EscapeReason = "released"
	// EscapeWatchdogExpired is layer 4 firing — an injection went in and did
	// not come back.
	EscapeWatchdogExpired EscapeReason = "watchdog_expired"
	// EscapeDeviceFailed is the device refusing a write for any other reason.
	EscapeDeviceFailed EscapeReason = "device_failed"
	// EscapeLockScreen is D-15: the node's session is locked, so the frames
	// that would unlock it are refused.
	EscapeLockScreen EscapeReason = "lock_screen"
)

// Escape is the last thing that stopped injection on this node.
type Escape struct {
	Reason EscapeReason `json:"reason"`
	Detail string       `json:"detail,omitempty"`
	At     string       `json:"at,omitempty"`
}

// defaultWatchdogTimeout is how long one injection may take before the device
// is assumed lost.
//
// A uinput write is a handful of microseconds — a copy into a kernel ring and a
// wake-up — so any value in the human range is orders of magnitude of slack.
// Two seconds is chosen from the other end: it is roughly the point at which a
// person who has lost their pointer starts reaching for the machine, and the
// guarantee is worth nothing if it arrives after they do.
const defaultWatchdogTimeout = 2 * time.Second

// injectionGuard owns the injector and the timer that can take it away.
//
// The lock discipline is the whole design and it has one rule: NOTHING that
// can block is done while holding mu. The stuck writer the watchdog exists to
// rescue is stuck inside the injector, so a watchdog that had to take the same
// lock to reach it would hang on exactly the case it was built for. So mu
// guards the pointer and the deadline, the injector's own serialisation is its
// business, and Close is called with mu released.
type injectionGuard struct {
	timeout time.Duration
	now     func() time.Time

	mu       sync.Mutex
	device   injector
	inFlight time.Time
	escape   Escape

	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{}
}

// newInjectionGuard takes ownership of a live injector and starts the timer.
//
// The ticker runs at a quarter of the timeout so that expiry is detected
// within a quarter of it rather than a whole one late, which matters because
// the budget is set by a person's patience and half of it is already spent by
// the time they notice.
func newInjectionGuard(device injector, timeout time.Duration, now func() time.Time) *injectionGuard {
	if timeout <= 0 {
		timeout = defaultWatchdogTimeout
	}
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	guard := &injectionGuard{
		timeout: timeout,
		now:     now,
		device:  device,
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	go guard.watch(timeout / 4)
	return guard
}

// watch is layer 4.
func (g *injectionGuard) watch(interval time.Duration) {
	defer close(g.done)
	if interval <= 0 {
		interval = time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-g.stop:
			return
		case <-ticker.C:
			if device := g.expireIfStuck(); device != nil {
				// Outside the lock, and deliberately: the writer this is
				// rescuing still holds the injector's own mutex, and closing
				// the descriptor is what unsticks it.
				_ = device.Close()
				return
			}
		}
	}
}

// expireIfStuck hands back the injector to close, or nil when all is well.
func (g *injectionGuard) expireIfStuck() injector {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.device == nil || g.inFlight.IsZero() {
		return nil
	}
	stuck := g.now().Sub(g.inFlight)
	if stuck < g.timeout {
		return nil
	}
	device := g.device
	g.device = nil
	g.inFlight = time.Time{}
	g.escape = Escape{
		Reason: EscapeWatchdogExpired,
		Detail: "an injected frame did not complete within " + g.timeout.String() +
			"; the virtual input device was destroyed so the node's own input works again",
		At: g.now().Format(time.RFC3339Nano),
	}
	return device
}

// Inject drives one frame into the OS.
//
// The injector is fetched under the lock and called without it. Holding the
// lock across the call would make Inject and the watchdog contend for the same
// mutex, and the watchdog would lose precisely when it is needed.
func (g *injectionGuard) Inject(event protocol.PointerEvent) error {
	g.mu.Lock()
	device := g.device
	if device == nil {
		g.mu.Unlock()
		return errInjectionClosed
	}
	g.inFlight = g.now()
	g.mu.Unlock()

	err := device.Pointer(event)

	g.mu.Lock()
	// Only clear the marker if this call is still the one being timed. The
	// watchdog may have fired and handed the device away while the write was
	// out; clearing it then would erase the evidence of the expiry.
	owned := g.device == device
	if owned {
		g.inFlight = time.Time{}
	} else if err == nil {
		// The device was taken away while this write was out — by the
		// watchdog, or by a teardown. Whether the kernel accepted the bytes
		// first is not knowable from here, so the frame is reported as lost.
		// Claiming a success whose effect nobody can vouch for is how a
		// binding stays green while gestures disappear.
		err = errInjectionClosed
	}
	// A write that fails for any reason other than the device already being
	// gone ends injection. Retrying would be the quiet failure §6.5 names: the
	// binding stays green, every gesture disappears, and the person holding
	// the pointer is the last to find out.
	lost := err != nil && err != errInjectionClosed && owned
	if lost {
		g.device = nil
		g.escape = Escape{
			Reason: EscapeDeviceFailed,
			Detail: err.Error(),
			At:     g.now().Format(time.RFC3339Nano),
		}
	}
	g.mu.Unlock()

	if lost {
		_ = device.Close()
	}
	return err
}

// Live reports whether there is still a device to inject into.
func (g *injectionGuard) Live() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.device != nil
}

// Describe names the device, or says it is gone.
func (g *injectionGuard) Describe() string {
	g.mu.Lock()
	device := g.device
	g.mu.Unlock()
	if device == nil {
		return ""
	}
	return device.Describe()
}

// Escape reports the last reason injection stopped.
func (g *injectionGuard) Escape() Escape {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.escape
}

// Close ends injection on the orderly path: release what is held, destroy the
// device, stop the timer.
//
// Idempotent, because it races the watchdog by construction — a binding
// tearing down at the moment a write hangs is the ordinary case, not the
// exotic one.
func (g *injectionGuard) Close(reason EscapeReason, detail string) {
	g.mu.Lock()
	device := g.device
	g.device = nil
	g.inFlight = time.Time{}
	if device != nil {
		g.escape = Escape{Reason: reason, Detail: detail, At: g.now().Format(time.RFC3339Nano)}
	}
	g.mu.Unlock()

	if device != nil {
		// Release first so the OS sees the buttons come up rather than
		// inferring it from the device vanishing. The inference is reliable —
		// the kernel synthesises releases on unregister — but a release the
		// application can see arrive is easier to trust than one it cannot.
		_ = device.Release()
		_ = device.Close()
	}
	g.Stop()
}

// Stop ends the timer without claiming a reason.
//
// Separate from Close because the device can go before the timer does: a write
// that failed, or a watchdog that already fired, leaves a goroutine still
// ticking over nothing. Whoever notices calls this, and calling it after Close
// or twice is a no-op.
func (g *injectionGuard) Stop() {
	g.stopOnce.Do(func() { close(g.stop) })
	<-g.done
}
