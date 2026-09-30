package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/discovery"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

// The module's reaction to the node's hardware changing.
//
// Until now the inventory only moved when somebody asked it to: the start-up
// sweep, or POST /scan. A device plugged in after start-up was absent from the
// list until an operator happened to rescan, and one unplugged stayed present
// and available — which is worse, because "available" is what a consumer reads
// before opening it.
//
// What arrives from the platform is a signal, never a device. The scan that
// follows is the authority (see discovery/watch.go), so this file holds no
// device knowledge of its own: it runs the same syncFrom the manual rescan
// runs, and turns what that reconciled into events.

// maxRecordedEvents bounds the event log. It is a window for a person looking
// at what just happened, not a transcript: a flapping cable can emit these as
// fast as the settle window allows, and an unbounded log on a long-running
// module is a memory leak with a friendly name.
const maxRecordedEvents = 128

// Event kinds. They are the two things a scan can conclude about a device's
// presence, named after the SyncResult fields they come from so there is no
// second vocabulary to drift from the first.
const (
	// EventDeviceAdded is a device the inventory had not seen before.
	EventDeviceAdded = "device.added"
	// EventDeviceMissing is a device that was present and no longer answers.
	// Never "deleted" — the policy for it outlives the cable (IO-3).
	EventDeviceMissing = "device.missing"
)

// DeviceEvent is one thing a scan concluded.
type DeviceEvent struct {
	// Sequence orders events and lets a reader ask for what it has not seen.
	// It starts at 1, so a reader holding 0 has seen nothing.
	Sequence uint64 `json:"sequence"`
	At       string `json:"at"`
	Kind     string `json:"kind"`
	DeviceID string `json:"device_id"`
	// Name is what to call the device, so a reader does not have to fetch it
	// separately for a device that has just gone missing.
	Name string `json:"name,omitempty"`
}

// HotplugState is what the watch surface answers.
type HotplugState struct {
	Watch discovery.WatchStatus `json:"watch"`
	// Scans counts completed reconciliations, Failures the ones that could not
	// look. Both are reported: a watcher that is firing but failing every scan
	// looks identical to an idle one if only successes are counted.
	Scans    uint64 `json:"scans"`
	Failures uint64 `json:"failures"`
	LastScan string `json:"last_scan,omitempty"`
	// LastError is why the most recent scan could not look. It is cleared by
	// the next scan that succeeds, so it always describes the current state
	// rather than the worst thing that ever happened.
	LastError string        `json:"last_error,omitempty"`
	Events    []DeviceEvent `json:"events"`
}

// Hotplug owns the watcher's state. Its zero value is not usable; see
// newHotplug.
type Hotplug struct {
	status discovery.WatchStatus
	now    func() time.Time

	mu       sync.Mutex
	events   []DeviceEvent
	sequence uint64
	scans    uint64
	failures uint64
	lastScan time.Time
	lastErr  string
}

func newHotplug(status discovery.WatchStatus) *Hotplug {
	return &Hotplug{
		status: status,
		now:    func() time.Time { return time.Now().UTC() },
		events: make([]DeviceEvent, 0, 16),
	}
}

// State reports the watcher's state and the events still in the window.
func (h *Hotplug) State() HotplugState {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := HotplugState{
		Watch:     h.status,
		Scans:     h.scans,
		Failures:  h.failures,
		LastError: h.lastErr,
		Events:    append([]DeviceEvent(nil), h.events...),
	}
	if !h.lastScan.IsZero() {
		state.LastScan = h.lastScan.Format(time.RFC3339)
	}
	return state
}

// Since reports the events after a sequence, and the sequence a reader should
// ask from next.
//
// The second return says whether anything was dropped: a reader that was away
// longer than the window holds gets told so rather than silently missing the
// unplug it was watching for. Asking again cannot recover them — the answer is
// to list the devices, which is the state the events were describing.
func (h *Hotplug) Since(sequence uint64) (events []DeviceEvent, latest uint64, missed bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	events = make([]DeviceEvent, 0, len(h.events))
	for _, event := range h.events {
		if event.Sequence > sequence {
			events = append(events, event)
		}
	}
	if len(h.events) > 0 && h.events[0].Sequence > sequence+1 {
		missed = true
	}
	return events, h.sequence, missed
}

// record turns one reconciliation into events.
//
// Only Added and Missing become events, and the omission is deliberate.
// SyncResult.Updated holds every device the scan saw that the registry already
// knew about, whether or not anything about it changed — it means "I looked at
// this", not "this is different". Emitting those would bury the two events that
// matter under one per device per scan, which on a polling node is the entire
// device list every few seconds.
func (h *Hotplug) record(result inventory.SyncResult, name func(string) string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.scans++
	h.lastScan = h.now()
	h.lastErr = ""
	at := h.lastScan.Format(time.RFC3339)
	for _, id := range result.Added {
		h.appendLocked(DeviceEvent{Kind: EventDeviceAdded, DeviceID: id, Name: name(id), At: at})
	}
	for _, id := range result.Missing {
		h.appendLocked(DeviceEvent{Kind: EventDeviceMissing, DeviceID: id, Name: name(id), At: at})
	}
}

// recordFailure notes a scan that could not look. It is not an event: nothing
// changed about any device, and inventing one would put a device id on a
// failure that was about the platform.
func (h *Hotplug) recordFailure(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.failures++
	h.lastScan = h.now()
	h.lastErr = err.Error()
}

func (h *Hotplug) appendLocked(event DeviceEvent) {
	h.sequence++
	event.Sequence = h.sequence
	h.events = append(h.events, event)
	if len(h.events) > maxRecordedEvents {
		h.events = append([]DeviceEvent(nil), h.events[len(h.events)-maxRecordedEvents:]...)
	}
}

// run reconciles the inventory every time the platform says something changed.
//
// It returns when ctx ends. A source failure ends it too: a watcher sitting on
// a socket that will never answer again is indistinguishable from a node whose
// hardware never changes, and the status has to be able to say which.
func (h *Hotplug) run(ctx context.Context, source discovery.Source, options discovery.WatchOptions, registry *inventory.Registry) error {
	if source != nil {
		defer func() { _ = source.Close() }()
	}
	return discovery.Watch(ctx, source, options, func() {
		result, err := scanDevices(registry)
		if err != nil {
			// ErrUnsupported cannot happen here — OpenWatch reports WatchNone
			// for a platform with no adapter and this never runs — but a scan
			// that starts failing later is exactly what the counters are for.
			h.recordFailure(err)
			return
		}
		h.record(result, func(id string) string {
			device, err := registry.Get(id)
			if err != nil {
				// A device that went missing and was forgotten between the
				// scan and this lookup has no name left to report. The id is
				// still the fact that matters.
				return ""
			}
			return device.Name
		})
	})
}

// startHotplug begins watching, or explains why it is not.
//
// It never fails start-up, for the same reason scanAtStartup does not: the
// policy surface is the half of this module that works everywhere, and a node
// that could not open a netlink socket should still be able to approve a
// device. The mode is reported either way so the answer is visible rather than
// guessed from a list that stopped moving.
func startHotplug(ctx context.Context, registry *inventory.Registry) *Hotplug {
	options := discovery.WatchOptions{}
	source, status := discovery.OpenWatch(options)
	hotplug := newHotplug(status)
	if !status.Watching() {
		fmt.Fprintln(os.Stderr, "terra-io-inventory: not watching for hardware changes:", status.Detail)
		return hotplug
	}
	fmt.Fprintf(os.Stderr, "terra-io-inventory: watching for hardware changes (%s, %s)\n", status.Mode, status.Detail)
	go func() {
		err := hotplug.run(ctx, source, options, registry)
		if err != nil && !errors.Is(err, context.Canceled) {
			// Loud: from here the device list only moves when somebody asks.
			fmt.Fprintln(os.Stderr, "terra-io-inventory: hardware change watch stopped:", err)
			hotplug.stopped(err)
		}
	}()
	return hotplug
}

// stopped marks the watch as no longer running. The mode becomes none, because
// that is what is true: a caller reading "event" off a watcher whose socket
// died would expect the list to follow the hardware, and it no longer does.
func (h *Hotplug) stopped(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.status.Mode = discovery.WatchNone
	h.status.PollIntervalSeconds = 0
	h.status.Detail = "watch stopped: " + err.Error() + "; the device list now moves only on scan or probe"
}
