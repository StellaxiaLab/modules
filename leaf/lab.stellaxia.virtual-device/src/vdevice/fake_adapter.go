package vdevice

import (
	"fmt"
	"sort"
	"sync"
)

// FakeAdapterID is the in-memory adapter (design §25 Phase 0, §24.1); it stays in
// every build next to the real adapters.
// The id says what it is in the id itself, because an operator reading a list
// of adapters reads ids before they read detail text.
const FakeAdapterID = "fake.in-memory"

// FakeAdapter is the in-memory adapter: it registers slots in a map and records
// the frames written to them, nothing else. No OS device appears, no driver is
// installed, nothing outside this process changes.
//
// It reports itself as a Fake — Simulated true, health "simulated", an
// os_device_id that begins with "fake:" — and this is not decoration. An
// adapter that reported a device as ready when no device exists would send an
// operator to look for a camera in their OS settings that was never there, and
// would make the whole /adapters surface untrustworthy the first time someone
// checked. install_state is `ready` because the adapter itself genuinely is
// ready to do its (simulated) job; what it is ready to do is stated next to it.
type FakeAdapter struct {
	mu     sync.Mutex
	slots  map[string]string
	frames map[string]*FakeFrames
}

// FakeFrames is what the fake recorded for one Slot's frame sink, for tests.
// The fake keeps counts and the last frame only: it shows nothing anywhere.
type FakeFrames struct {
	// Open is true while a sink is open for the Slot.
	Open bool
	// Opens counts OpenFrames calls; Closes counts sink Close calls.
	Opens, Closes int
	// Frames and Bytes count accepted WriteFrame calls and their payload.
	Frames, Bytes int
	// Fallbacks counts ShowFallback calls.
	Fallbacks int
	// Last is a copy of the most recent accepted frame.
	Last []byte
	// WriteErr, when set through SetWriteError, is returned by WriteFrame.
	WriteErr error
}

// NewFakeAdapter builds the in-memory adapter.
func NewFakeAdapter() *FakeAdapter {
	return &FakeAdapter{slots: map[string]string{}, frames: map[string]*FakeFrames{}}
}

var (
	_ FrameAdapter  = (*FakeAdapter)(nil)
	_ SlotReadiness = (*FakeAdapter)(nil)
)

// SlotReady: the fake has no device that can be missing, so every camera slot
// is ready. (It still says "simulated" everywhere else.)
func (a *FakeAdapter) SlotReady(string) (bool, string) { return true, "" }

// Describe reports the fake as a fake.
func (a *FakeAdapter) Describe() AdapterDescriptor {
	return AdapterDescriptor{
		AdapterID:    FakeAdapterID,
		Kind:         KindCamera,
		OS:           "any",
		Version:      "0.1.0",
		Capabilities: []string{"slot.register", "slot.remove", "frame.write"},
		InstallState: StateReady,
		Health:       "simulated",
		Simulated:    true,
		// 640x480 only: the SVI sink carries at most MaxSinkFrameBytes per
		// frame, and a format the module would refuse is not one to advertise.
		SupportedFormats: []Format{
			{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"},
		},
		Detail: "In-memory adapter. It registers slots and counts the frames written to them inside this process only: no operating-system device is created and no driver is installed. Use it to exercise the control API and the frame path, never to check whether a camera works.",
	}
}

// EnsureSlot records the slot and returns a synthetic device id.
func (a *FakeAdapter) EnsureSlot(slot Slot) (string, error) {
	if slot.Kind != KindCamera {
		return "", domainError(ErrCodeAdapterUnavailable, "the fake adapter models camera slots only, not %q", slot.Kind)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	// Re-registering an existing slot keeps its device id. §9.2: os_device_id
	// survives a source change, and an update is not a new device.
	if existing, ok := a.slots[slot.SlotID]; ok {
		return existing, nil
	}
	deviceID := fmt.Sprintf("fake:%s", slot.SlotID)
	a.slots[slot.SlotID] = deviceID
	return deviceID, nil
}

// RemoveSlot forgets the slot. Removing one that is not there succeeds.
func (a *FakeAdapter) RemoveSlot(slotID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.slots, slotID)
	return nil
}

// OpenFrames opens the recording sink of a registered slot.
func (a *FakeAdapter) OpenFrames(slot Slot) (FrameSink, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.slots[slot.SlotID]; !ok {
		return nil, domainError(ErrCodeSlotNotFound, "the fake adapter has no slot %q registered", slot.SlotID)
	}
	record := a.frames[slot.SlotID]
	if record == nil {
		record = &FakeFrames{}
		a.frames[slot.SlotID] = record
	}
	if record.Open {
		return nil, domainError(ErrCodeSlotBusy, "the fake adapter already has a sink open for slot %q", slot.SlotID)
	}
	record.Open = true
	record.Opens++
	return &fakeFrameSink{adapter: a, slotID: slot.SlotID}, nil
}

// Frames reports what the fake recorded for a slot (a zero value for a slot it
// never opened). The returned copy is detached from the fake.
func (a *FakeAdapter) Frames(slotID string) FakeFrames {
	a.mu.Lock()
	defer a.mu.Unlock()
	record := a.frames[slotID]
	if record == nil {
		return FakeFrames{}
	}
	copied := *record
	copied.Last = append([]byte(nil), record.Last...)
	return copied
}

// SetWriteError makes WriteFrame fail with err until it is called with nil.
func (a *FakeAdapter) SetWriteError(slotID string, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	record := a.frames[slotID]
	if record == nil {
		record = &FakeFrames{}
		a.frames[slotID] = record
	}
	record.WriteErr = err
}

// fakeFrameSink records into its adapter. The controller serializes calls to one
// sink; the adapter mutex is for the test accessors.
type fakeFrameSink struct {
	adapter *FakeAdapter
	slotID  string
	closed  bool
}

func (s *fakeFrameSink) record() *FakeFrames { return s.adapter.frames[s.slotID] }

func (s *fakeFrameSink) WriteFrame(frame []byte) error {
	s.adapter.mu.Lock()
	defer s.adapter.mu.Unlock()
	record := s.record()
	if s.closed {
		return domainError(ErrCodeHandleOpenFailed, "write to a closed fake sink")
	}
	if record.WriteErr != nil {
		return record.WriteErr
	}
	record.Frames++
	record.Bytes += len(frame)
	record.Last = append(record.Last[:0], frame...)
	return nil
}

func (s *fakeFrameSink) ShowFallback() error {
	s.adapter.mu.Lock()
	defer s.adapter.mu.Unlock()
	s.record().Fallbacks++
	return nil
}

func (s *fakeFrameSink) Close() error {
	s.adapter.mu.Lock()
	defer s.adapter.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	record := s.record()
	record.Open = false
	record.Closes++
	return nil
}

// RegisteredSlots lists the slot ids the fake currently holds, for tests and
// for the diagnostics summary.
func (a *FakeAdapter) RegisteredSlots() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	ids := make([]string, 0, len(a.slots))
	for id := range a.slots {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
