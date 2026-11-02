package discovery

import (
	"context"
	"errors"
	"time"
)

// How the inventory learns that the node's hardware changed.
//
// Two halves, split the way the package doc describes. The platform half is a
// Source: it blocks until the operating system says something may have changed
// and reports nothing else. The neutral half is Watch: it decides when to look,
// and it is the part with the judgement in it, so it is testable from any
// platform with a fake Source.
//
// The Source deliberately carries no detail about WHAT changed. A kernel uevent
// names a sysfs path; a poll names nothing. Neither carries the capability
// bitmap the classification needs, so either way the answer comes from a fresh
// enumeration — and deriving half the device state from an event and half from
// a scan is how the two come to disagree. The event decides WHEN to scan; the
// scan decides WHAT is there.

// WatchMode says how a node finds out, which is a different question from
// whether it finds out at all. A poll notices a device a few seconds late; an
// event notices immediately. Both keep the inventory correct, and an operator
// reading a stale-looking list deserves to know which one is running.
type WatchMode string

const (
	// WatchEvent is the operating system telling us.
	WatchEvent WatchMode = "event"
	// WatchPoll is us asking on a timer, because this platform has no event
	// source in this build.
	WatchPoll WatchMode = "poll"
	// WatchNone is a node with no enumeration adapter at all — there is
	// nothing to scan, so there is nothing to watch, and a poll that answers
	// ErrUnsupported every few seconds is a busy loop dressed as a feature.
	WatchNone WatchMode = "none"
)

// WatchStatus is what a caller needs before expecting the inventory to follow
// the hardware on its own.
type WatchStatus struct {
	Mode WatchMode `json:"mode"`
	// Detail says why this mode and not another, in words meant for whoever
	// has to fix it.
	Detail string `json:"detail"`
	// Platform names what was checked, so a report from a node says which
	// question was asked of it.
	Platform string `json:"platform"`
	// PollIntervalSeconds is how long a WatchPoll node can be wrong for. Zero
	// for the other modes.
	PollIntervalSeconds int `json:"poll_interval_seconds,omitempty"`
}

// Watching reports whether this node reacts to hardware changes at all.
func (s WatchStatus) Watching() bool { return s.Mode == WatchEvent || s.Mode == WatchPoll }

// Source is the platform half: it blocks until the device set may have changed.
type Source interface {
	// Next returns nil when something may have changed. It returns the
	// context's error when the context ends, and any other error is fatal to
	// the watcher.
	Next(ctx context.Context) error
	// Close releases the platform resource.
	Close() error
}

// ErrWatchUnsupported is what a platform with no event source returns. It is
// not a failure — it selects the poll fallback — and it is distinct from an
// event source that exists and could not be opened, which IS worth reporting
// because someone can fix that.
var ErrWatchUnsupported = errors.New("no hardware change event source on this platform")

const (
	// defaultSettle is how long the watcher waits for the burst to end before
	// scanning.
	//
	// One plugged cable is not one event. A USB keyboard emits usb → hid →
	// input as the stack binds, a hub emits a burst per downstream port, and
	// scanning on each one would read /proc/bus/input/devices a dozen times to
	// reach the same answer. Waiting for quiet costs a quarter second of
	// latency and turns the burst into one scan.
	defaultSettle = 250 * time.Millisecond
	// defaultPollInterval is how often a node with no event source looks.
	//
	// Five seconds is a compromise with a stated cost: a device can be missing
	// from the list for up to five seconds after it is plugged in. It is not
	// tuned to a measurement, because the platform that uses it has an event
	// source available that nobody has built yet (see watch_windows.go), and
	// tuning a fallback is work the real source makes pointless.
	defaultPollInterval = 5 * time.Second
)

// WatchOptions configures a watcher. The zero value is the default.
type WatchOptions struct {
	// Settle is the quiet period after a signal before scanning.
	Settle time.Duration
	// PollInterval is how often to look when there is no event source.
	PollInterval time.Duration
	// After exists so a test drives time rather than sleeping through it.
	After func(time.Duration) <-chan time.Time
}

func (o WatchOptions) settle() time.Duration {
	if o.Settle > 0 {
		return o.Settle
	}
	return defaultSettle
}

func (o WatchOptions) pollInterval() time.Duration {
	if o.PollInterval > 0 {
		return o.PollInterval
	}
	return defaultPollInterval
}

func (o WatchOptions) after() func(time.Duration) <-chan time.Time {
	if o.After != nil {
		return o.After
	}
	return time.After
}

// OpenWatch picks the best source this platform offers and reports which.
//
// It never fails. Every outcome is a mode a caller can act on, because the
// alternative — an error that makes the module refuse to start — would take the
// working half of the inventory down over a feature that is an improvement on
// the manual rescan, not a replacement for it.
func OpenWatch(options WatchOptions) (Source, WatchStatus) {
	status := WatchStatus{Platform: watchPlatform}
	if !enumerationAvailable {
		status.Mode = WatchNone
		status.Detail = "this platform has no I/O enumeration adapter, so there is nothing to watch"
		return nil, status
	}
	source, detail, err := newPlatformSource()
	if err == nil {
		status.Mode = WatchEvent
		status.Detail = detail
		return source, status
	}
	status.Mode = WatchPoll
	status.PollIntervalSeconds = int(options.pollInterval() / time.Second)
	if errors.Is(err, ErrWatchUnsupported) {
		status.Detail = detail
	} else {
		// An event source that exists and would not open is worth naming: a
		// permission or a missing kernel option is something a person can fix,
		// and silently polling would hide that the node could do better.
		status.Detail = "event source unavailable, polling instead: " + err.Error()
	}
	return nil, status
}

// Watch runs until ctx ends, calling onChange once per settled burst.
//
// A nil source polls. onChange is called from this goroutine, so a slow one
// delays the next scan rather than piling up behind it — the safe direction:
// two scans of the same hardware racing would have the later one's "missing"
// verdict fight the earlier one's "present".
func Watch(ctx context.Context, source Source, options WatchOptions, onChange func()) error {
	if onChange == nil {
		return errors.New("discovery: a watch needs somewhere to report changes")
	}
	if source == nil {
		return pollLoop(ctx, options, onChange)
	}

	// One reader, never two. Next is called from this goroutine alone: a second
	// concurrent Next on the same socket would have two readers splitting one
	// event stream, and whichever lost the race would look like a device that
	// changed and was never noticed.
	signals := make(chan struct{}, 1)
	failures := make(chan error, 1)
	reading := make(chan struct{})
	go func() {
		defer close(reading)
		for {
			if err := source.Next(ctx); err != nil {
				failures <- err
				return
			}
			// Coalesce at the door. A full buffer already means "there is work",
			// and a second token would only make the loop run the same scan twice.
			select {
			case signals <- struct{}{}:
			default:
			}
		}
	}()

	// Do not return while the reader is still inside the source.
	//
	// The caller closes the source when this returns, and closing a descriptor
	// out from under a blocked read is the race the receive timeout exists to
	// avoid: the number can be reused between the close and the wakeup, and the
	// read then returns someone else's bytes. Waiting costs one receive timeout
	// on shutdown and makes that impossible instead of unlikely.
	defer func() { <-reading }()

	after := options.after()
	settle := options.settle()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-failures:
			return err
		case <-signals:
			// Drain the rest of the burst: each further signal restarts the
			// quiet period, so a hub enumerating twenty ports is one scan.
			for settled := false; !settled; {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case err := <-failures:
					return err
				case <-signals:
				case <-after(settle):
					settled = true
				}
			}
			onChange()
		}
	}
}

func pollLoop(ctx context.Context, options WatchOptions, onChange func()) error {
	after := options.after()
	interval := options.pollInterval()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-after(interval):
			onChange()
		}
	}
}
