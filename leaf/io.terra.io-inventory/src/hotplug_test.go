package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/discovery"
	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

func testHotplug() *Hotplug {
	return newHotplug(discovery.WatchStatus{Mode: discovery.WatchEvent, Platform: "test", Detail: "fake"})
}

func noNames(string) string { return "" }

func kinds(events []DeviceEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.Kind+":"+event.DeviceID)
	}
	return out
}

// A scan's Updated list is every device it looked at, not every device that
// changed. Emitting those would bury the two events that matter under one per
// device per scan — on a polling node, the whole device list every few seconds.
func TestHotplugRecordsOnlyPresenceChanges(t *testing.T) {
	hotplug := testHotplug()
	hotplug.record(inventory.SyncResult{
		Adapter: "adapter.os-discovery",
		Scanned: 3,
		Added:   []string{"dev-new"},
		Updated: []string{"dev-known-a", "dev-known-b"},
		Missing: []string{"dev-gone"},
	}, func(id string) string { return "name-of-" + id })

	events, latest, missed := hotplug.Since(0)
	if missed {
		t.Error("a reader starting from zero was told it missed events")
	}
	if latest != 2 {
		t.Errorf("latest = %d, want 2", latest)
	}
	got := kinds(events)
	want := []string{EventDeviceAdded + ":dev-new", EventDeviceMissing + ":dev-gone"}
	if len(got) != len(want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("events = %v, want %v", got, want)
		}
	}
	if events[0].Name != "name-of-dev-new" {
		t.Errorf("name = %q, want the device's name", events[0].Name)
	}
	if events[0].At == "" {
		t.Error("event carries no timestamp")
	}
}

// Sequences start at 1 so a reader holding the zero value has seen nothing —
// otherwise a fresh reader and a reader that has seen event 0 look alike.
func TestHotplugSequencesStartAtOne(t *testing.T) {
	hotplug := testHotplug()
	hotplug.record(inventory.SyncResult{Added: []string{"dev-1"}}, noNames)
	events, _, _ := hotplug.Since(0)
	if len(events) != 1 || events[0].Sequence != 1 {
		t.Fatalf("first event sequence = %+v, want 1", events)
	}
}

func TestHotplugSinceReturnsOnlyNewerEvents(t *testing.T) {
	hotplug := testHotplug()
	hotplug.record(inventory.SyncResult{Added: []string{"dev-1", "dev-2", "dev-3"}}, noNames)

	events, latest, missed := hotplug.Since(2)
	if missed {
		t.Error("a reader still inside the window was told it missed events")
	}
	if latest != 3 {
		t.Errorf("latest = %d, want 3", latest)
	}
	if len(events) != 1 || events[0].Sequence != 3 {
		t.Fatalf("Since(2) = %v, want only sequence 3", kinds(events))
	}

	caughtUp, _, _ := hotplug.Since(3)
	if len(caughtUp) != 0 {
		t.Fatalf("Since(latest) = %v, want nothing", kinds(caughtUp))
	}
}

// The window is a window. A reader that was away longer than it holds has to be
// told, or it believes it saw every change when the unplug it was waiting for
// had already aged out.
func TestHotplugReportsWhenTheWindowMovedPastTheReader(t *testing.T) {
	hotplug := testHotplug()
	for i := range maxRecordedEvents + 10 {
		hotplug.record(inventory.SyncResult{Added: []string{fmt.Sprintf("dev-%d", i)}}, noNames)
	}

	events, latest, missed := hotplug.Since(0)
	if !missed {
		t.Fatal("a reader whose events aged out was not told")
	}
	if len(events) != maxRecordedEvents {
		t.Fatalf("window holds %d events, want %d", len(events), maxRecordedEvents)
	}
	if latest != uint64(maxRecordedEvents+10) {
		t.Errorf("latest = %d, want %d", latest, maxRecordedEvents+10)
	}
	// Still ordered oldest first, and still consecutive.
	for i := 1; i < len(events); i++ {
		if events[i].Sequence != events[i-1].Sequence+1 {
			t.Fatalf("window is not consecutive at %d: %d then %d", i, events[i-1].Sequence, events[i].Sequence)
		}
	}
}

// A failure is counted, not turned into an event: nothing changed about any
// device, and inventing one would put a device id on a platform failure.
func TestHotplugRecordsFailuresWithoutEvents(t *testing.T) {
	hotplug := testHotplug()
	hotplug.recordFailure(errors.New("could not read /proc/bus/input/devices"))

	state := hotplug.State()
	if state.Failures != 1 {
		t.Errorf("failures = %d, want 1", state.Failures)
	}
	if state.Scans != 0 {
		t.Errorf("scans = %d, want 0 — a failed look is not a scan", state.Scans)
	}
	if state.LastError == "" {
		t.Error("a failed scan left no reason")
	}
	if len(state.Events) != 0 {
		t.Fatalf("a failure produced events: %v", kinds(state.Events))
	}
	if state.LastScan == "" {
		t.Error("a failed scan did not record when it was attempted")
	}
}

// LastError describes the current state, not the worst thing that ever
// happened: a node that recovered should not keep reporting the outage.
func TestHotplugClearsTheLastErrorOnASuccessfulScan(t *testing.T) {
	hotplug := testHotplug()
	hotplug.recordFailure(errors.New("transient"))
	hotplug.record(inventory.SyncResult{Updated: []string{"dev-1"}}, noNames)

	state := hotplug.State()
	if state.LastError != "" {
		t.Errorf("last_error = %q, want it cleared by the successful scan", state.LastError)
	}
	if state.Scans != 1 || state.Failures != 1 {
		t.Errorf("scans = %d, failures = %d, want 1 and 1 — both are reported", state.Scans, state.Failures)
	}
}

// A watcher whose source died must stop claiming it is watching. A caller
// reading "event" would expect the list to follow the hardware, and it no
// longer does.
func TestHotplugStoppedNoLongerClaimsToWatch(t *testing.T) {
	hotplug := testHotplug()
	if !hotplug.State().Watch.Watching() {
		t.Fatal("the fixture did not start out watching")
	}
	hotplug.stopped(errors.New("netlink socket closed"))

	watch := hotplug.State().Watch
	if watch.Watching() {
		t.Fatal("a stopped watch still reports that it is watching")
	}
	if watch.Mode != discovery.WatchNone {
		t.Errorf("mode = %q, want none", watch.Mode)
	}
	if watch.Detail == "" {
		t.Error("a stopped watch gives no reason")
	}
}

// State hands out a copy. A caller that could append to the returned slice
// would be writing into the window every other reader shares.
func TestHotplugStateDoesNotShareTheWindow(t *testing.T) {
	hotplug := testHotplug()
	hotplug.record(inventory.SyncResult{Added: []string{"dev-1"}}, noNames)

	state := hotplug.State()
	state.Events = append(state.Events, DeviceEvent{Kind: "forged"})
	state.Events[0].DeviceID = "overwritten"

	fresh := hotplug.State()
	if len(fresh.Events) != 1 {
		t.Fatalf("the window grew to %d through a returned copy", len(fresh.Events))
	}
	if fresh.Events[0].DeviceID != "dev-1" {
		t.Fatalf("device id = %q, want dev-1 — a caller wrote into the window", fresh.Events[0].DeviceID)
	}
}
