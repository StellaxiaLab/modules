package vdevice

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
	"github.com/StellaxiaLab/terra-sdk/svi"
)

// The frame path: the Daemon opens an SVI sink for a Slot's resource
// when an operator creates a binding that targets it, then pushes one frame per
// Write. This file publishes that resource, answers the sink open, and keeps
// what the Projection runtime reports about it.
//
// Locking, in the one order every path follows:
//
//	Controller.mu  ->  Controller.feedMu  (never the reverse)
//	Controller.mu  ->  feedSink.mu        (PutSlot/DeleteSlot/OpenSink close a sink
//	                                       while holding Controller.mu)
//	feedSink.mu    ->  Controller.feedMu  (never the reverse)
//
// Nothing takes Controller.mu while holding feedSink.mu or feedMu, which is what
// keeps the first two edges from forming a cycle.
//
// feedSink.mu serializes one sink's Write and Close, so an adapter sees calls in
// order and never concurrently. feedMu guards only the two maps on the
// Controller and is held for a few assignments, never across an adapter call.
// Write takes no Controller.mu at all, so a slow device write cannot stall the
// control API; the cost is that DeleteSlot and PutSlot, which close a sink while
// holding Controller.mu, wait for an in-flight Write of that sink to return.

const (
	// SinkResourcePrefix is the module-local resource id prefix; the Daemon
	// namespaces it as svi.<node>.vdevice.<slot_id>.
	SinkResourcePrefix = "vdevice."
	// SinkEndpointID is the one endpoint of a Slot resource.
	SinkEndpointID = "input"
	// SinkSchema is the video schema family the catalog already uses
	// (terra.video.frame@1, see the SVI core contract decisions). A source
	// bound here must publish it; the raw-YUY2 framing is stated in Encodings
	// and Metadata, because the ref names a family and a major, not a framing.
	SinkSchema = "terra.video.frame@1"
	// SinkEncoding is what one Write carries: one raw YUY2 frame.
	SinkEncoding = "video/x-raw;format=YUY2"
	// SinkResourceKind is the catalog kind of a camera Slot.
	SinkResourceKind = "virtual-device.camera"

	pixelFormatYUY2 = "YUY2"
)

// frameSpec is the frame the sink of one Slot carries.
type frameSpec struct {
	Format Format
	Bytes  int
}

// validateSinkFormat checks one declared format against what the sink can
// carry: raw YUY2 whose frame fits one sink request.
func validateSinkFormat(format Format) (frameSpec, error) {
	if !strings.EqualFold(strings.TrimSpace(format.PixelFormat), pixelFormatYUY2) {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible,
			"pixel_format %q is not supported: this build carries raw %s only", format.PixelFormat, pixelFormatYUY2)
	}
	if format.Width <= 0 || format.Height <= 0 {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible,
			"width and height are required and must be positive (got %dx%d): formats are explicit, never inferred", format.Width, format.Height)
	}
	if format.Width%2 != 0 {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible, "width %d is odd; YUY2 packs two pixels per four bytes", format.Width)
	}
	// Bound each factor before multiplying so the product cannot overflow.
	if format.Width > MaxSinkFrameBytes || format.Height > MaxSinkFrameBytes {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible, "%dx%d is larger than the sink can carry", format.Width, format.Height)
	}
	bytes := format.Width * format.Height * 2
	if bytes > MaxSinkFrameBytes {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible,
			"%dx%d %s is %d bytes per frame; the SVI sink carries at most %d (640x480 fits, 1280x720 does not)",
			format.Width, format.Height, pixelFormatYUY2, bytes, MaxSinkFrameBytes)
	}
	format.PixelFormat = pixelFormatYUY2
	return frameSpec{Format: format, Bytes: bytes}, nil
}

// frameSpecFor picks the frame a Slot's sink carries: its first declared format.
func frameSpecFor(formats []Format) (frameSpec, error) {
	if len(formats) == 0 {
		return frameSpec{}, domainError(ErrCodeFormatIncompatible, "the slot declares no format, so there is no frame size to accept")
	}
	return validateSinkFormat(formats[0])
}

// validateSlotFormats refuses a Slot whose declared formats the sink cannot
// carry. Declaring none is allowed: the Slot exists but publishes itself as
// unavailable until it has a format.
func validateSlotFormats(formats []Format) error {
	for _, format := range formats {
		if _, err := validateSinkFormat(format); err != nil {
			return err
		}
	}
	return nil
}

// slotIDFromResource extracts the slot id from a node-canonical resource id.
//
// Matched by shape, not by rebuilding svi.<node>.<local>: the module is not
// told its node id. Slot ids contain no dot, so the last ".vdevice." is
// unambiguous even when a node id has dots of its own.
func slotIDFromResource(resourceID string) (string, bool) {
	if !strings.HasPrefix(resourceID, "svi.") {
		return "", false
	}
	marker := "." + SinkResourcePrefix
	index := strings.LastIndex(resourceID, marker)
	if index < 0 {
		return "", false
	}
	slotID := resourceID[index+len(marker):]
	if !validIdentifier(slotID) {
		return "", false
	}
	return slotID, true
}

// feedStats is what one Slot's sink has done. Counters belong to the latest
// sink session and are reset when a new one opens; Opens survives, so a
// reconnect is countable.
type feedStats struct {
	Opens       int
	FramesIn    uint64
	FramesOut   uint64
	Dropped     uint64
	LastFrameAt *time.Time
	StartedAt   *time.Time
	// LastErrCode/Detail are set by a frame that did not reach the device, either
	// refused for its size (VDEV_FRAME_INVALID) or failed in the adapter, and
	// cleared by the next successful one: degraded lasts exactly as long as the
	// frames are being refused. A source that only ever sends wrong-sized frames
	// therefore never reads as active.
	LastErrCode   string
	LastErrDetail string
}

// feedSnapshot is a copy of one Slot's feed state for the runtime report.
type feedSnapshot struct {
	Open  bool
	Spec  frameSpec
	Stats feedStats
}

func (c *Controller) feedSnapshot(slotID string) feedSnapshot {
	c.feedMu.Lock()
	defer c.feedMu.Unlock()
	snapshot := feedSnapshot{}
	if stats := c.feedStatsBySlot[slotID]; stats != nil {
		snapshot.Stats = *stats
	}
	if sink := c.sinks[slotID]; sink != nil {
		snapshot.Open = true
		snapshot.Spec = sink.spec
	}
	return snapshot
}

// Resources publishes the current Slot set as SVI resources: one per Slot,
// rebuilt on every call. The module host polls this, so a new, removed or busy
// Slot shows up on the next poll without any push machinery here.
func (c *Controller) Resources(context.Context) ([]svi.ResourceDescriptor, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	slots := make([]Slot, 0, len(c.state.Slots))
	for _, slot := range c.state.Slots {
		if slot.Kind == KindCamera {
			slots = append(slots, slot)
		}
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i].SlotID < slots[j].SlotID })
	resources := make([]svi.ResourceDescriptor, 0, len(slots))
	for _, slot := range slots {
		resources = append(resources, c.resourceFor(slot))
	}
	return resources, nil
}

// resourceFor describes one Slot. Caller holds c.mu.
//
// "available" is published only for a Slot whose own device is usable. An
// adapter that implements SlotReadiness answers that live (v4l2: is this Slot's
// /dev/videoN there), and the answer wins over the install state recorded at the
// last EnsureSlot: a Slot whose device appeared after start-up is offered, and
// OpenSink then ensures it. An adapter without SlotReadiness is judged by the
// recorded install state.
func (c *Controller) resourceFor(slot Slot) svi.ResourceDescriptor {
	status, reason := svi.ResourceAvailable, ""
	spec, specErr := frameSpecFor(slot.AcceptedFormats)
	simulated := false
	if adapter, ok := c.adapters.Lookup(slot.AdapterID); ok {
		descriptor := adapter.Describe()
		simulated = descriptor.Simulated
		_, canFrame := adapter.(FrameAdapter)
		slotReady := slot.InstallState == StateReady
		if readiness, ok := adapter.(SlotReadiness); ok && slot.Enabled && descriptor.InstallState == StateReady {
			slotReady, _ = readiness.SlotReady(slot.SlotID)
		}
		switch {
		case !slot.Enabled:
			status, reason = svi.ResourceUnavailable, "slot_disabled"
		case descriptor.InstallState != StateReady:
			status, reason = svi.ResourceUnavailable, "adapter_unavailable"
		case !canFrame:
			status, reason = svi.ResourceUnavailable, "adapter_cannot_take_frames"
		case specErr != nil:
			status, reason = svi.ResourceUnavailable, "format_unsupported"
		case !slotReady:
			status, reason = svi.ResourceUnavailable, "slot_device_unavailable"
		}
	} else {
		status, reason = svi.ResourceUnavailable, "adapter_unavailable"
	}
	if status == svi.ResourceAvailable {
		c.feedMu.Lock()
		if c.sinks[slot.SlotID] != nil {
			status = svi.ResourceBusy
		}
		c.feedMu.Unlock()
	}

	metadata := map[string]any{"simulated": simulated}
	if specErr == nil {
		metadata["width"] = spec.Format.Width
		metadata["height"] = spec.Format.Height
		if spec.Format.FPS > 0 {
			metadata["fps"] = spec.Format.FPS
		}
		metadata["pixel_format"] = spec.Format.PixelFormat
		metadata["frame_bytes"] = spec.Bytes
	}
	return svi.ResourceDescriptor{
		ResourceID:    SinkResourcePrefix + slot.SlotID,
		Kind:          SinkResourceKind,
		CanonicalName: "virtual-device/" + slot.SlotID,
		DisplayName:   slot.DisplayName,
		Labels: map[string]string{
			"slot_id":    slot.SlotID,
			"adapter_id": slot.AdapterID,
			"simulated":  fmt.Sprintf("%t", simulated),
		},
		Status:       status,
		StatusReason: reason,
		Endpoints: []svi.EndpointDescriptor{{
			EndpointID:  SinkEndpointID,
			Direction:   svi.DirectionSink,
			Interaction: svi.InteractionStream,
			Operations:  []svi.Operation{svi.OperationInspect, svi.OperationBindTarget},
			InputSchema: SinkSchema,
			Encodings:   []string{SinkEncoding},
			QoSProfiles: []svi.QoSProfile{svi.QoSRealtimeLatest},
			// What lands here is shown to whatever program picked this camera,
			// so the catalog should say it is not an ordinary sink.
			Sensitivity: "sensitive",
			// One source per device: a second binding would interleave two
			// pictures into one camera.
			Exclusive:    true,
			MaxConsumers: 1,
			Status:       status,
			Metadata:     metadata,
		}},
	}
}

// OpenSink is the module's answer to "can you take this binding's frames".
//
//   - not mine (ErrSVISinkNotServed): another backend may own it, and the daemon
//     goes on asking. Not an error.
//   - mine but refused: a plain error carrying a VDEV_* code, which lands in the
//     binding's status detail.
//   - mine and open: the Slot is claimed until Close.
//
// c.mu is held exclusively for the whole open so a concurrent DeleteSlot or
// PutSlot cannot slip between "the Slot exists" and "its sink is registered",
// and because a successful re-ensure (below) updates the Slot's recorded state.
//
// The adapter is asked to ensure the Slot before frames are opened. EnsureSlot
// is idempotent, and this is what recovers a Slot whose start-up reconcile
// failed because its device did not exist yet: without it that Slot would stay
// "not found" at the adapter for as long as the module runs.
func (c *Controller) OpenSink(_ context.Context, resourceID, endpointID string) (modulesdk.SVISink, error) {
	slotID, ok := slotIDFromResource(resourceID)
	if !ok || endpointID != SinkEndpointID {
		return nil, modulesdk.ErrSVISinkNotServed
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	slot, found := c.state.Slots[slotID]
	if !found || slot.Kind != KindCamera {
		return nil, modulesdk.ErrSVISinkNotServed
	}
	if !slot.Enabled {
		return nil, domainError(ErrCodeAdapterUnavailable, "slot %q is stopped (desired_state stopped)", slotID)
	}
	adapter, found := c.adapters.Lookup(slot.AdapterID)
	if !found {
		return nil, domainError(ErrCodeAdapterUnavailable, "slot %q names adapter %q, which this build does not have", slotID, slot.AdapterID)
	}
	if descriptor := adapter.Describe(); descriptor.InstallState != StateReady {
		return nil, domainError(ErrCodeAdapterUnavailable, "adapter %q is %s: %s", slot.AdapterID, descriptor.InstallState, descriptor.Detail)
	}
	frameAdapter, ok := adapter.(FrameAdapter)
	if !ok {
		return nil, domainError(ErrCodeAdapterUnavailable, "adapter %q registers slots but cannot take frames", slot.AdapterID)
	}
	spec, err := frameSpecFor(slot.AcceptedFormats)
	if err != nil {
		return nil, err
	}

	sink := &feedSink{controller: c, slotID: slotID, spec: spec}
	// Reserve before touching the device: two bindings racing for one Slot must
	// not both open the OS handle.
	c.feedMu.Lock()
	if c.sinks[slotID] != nil {
		c.feedMu.Unlock()
		return nil, domainError(ErrCodeSlotBusy, "slot %q already has a source delivering frames", slotID)
	}
	c.sinks[slotID] = sink
	c.feedMu.Unlock()

	release := func() {
		c.feedMu.Lock()
		delete(c.sinks, slotID)
		c.feedMu.Unlock()
	}
	deviceID, err := frameAdapter.EnsureSlot(slot)
	if err != nil {
		release()
		var domain *DomainError
		if errors.As(err, &domain) {
			return nil, err
		}
		return nil, domainError(ErrCodeAdapterUnavailable, "ensure %s: %v", slot.AdapterID, err)
	}
	if slot.InstallState != StateReady || slot.OSDeviceID != deviceID {
		slot.InstallState, slot.OSDeviceID = StateReady, deviceID
		c.state.Slots[slotID] = slot
		_ = c.save() // a failed write is on /status; the in-memory state is what is true now
	}

	frames, err := frameAdapter.OpenFrames(slot)
	if err != nil {
		release()
		var domain *DomainError
		if errors.As(err, &domain) {
			return nil, err
		}
		return nil, domainError(ErrCodeHandleOpenFailed, "open %s: %v", slot.AdapterID, err)
	}
	sink.adapter = frames

	now := c.now()
	c.feedMu.Lock()
	opens := 1
	if previous := c.feedStatsBySlot[slotID]; previous != nil {
		opens = previous.Opens + 1
	}
	c.feedStatsBySlot[slotID] = &feedStats{Opens: opens, StartedAt: &now}
	c.feedMu.Unlock()
	return sink, nil
}

// closeSink closes the open sink of a Slot, if any, without waiting for the
// daemon: the Slot is going away or changing frame size, and the sink's next
// Write fails so the binding says so.
func (c *Controller) closeSink(slotID string) {
	c.feedMu.Lock()
	sink := c.sinks[slotID]
	c.feedMu.Unlock()
	if sink != nil {
		_ = sink.Close()
	}
}

// feedSink is one open destination for a Slot's frames; it is the
// modulesdk.SVISink the daemon writes to. The SDK serializes Write per sink and
// closes each opened sink exactly once, but the controller also closes sinks
// (Slot deleted or changed), so mu makes that safe and Close idempotent.
type feedSink struct {
	controller *Controller
	slotID     string
	spec       frameSpec

	mu      sync.Mutex
	adapter FrameSink
	closed  bool
}

// Write delivers one frame. The sequence is ignored: the SDK guarantees order
// and no duplicates, and the device has no use for it.
func (s *feedSink) Write(_ uint64, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return domainError(ErrCodeSourceUnavailable, "the sink of slot %q is closed", s.slotID)
	}
	s.controller.noteFrame(s, func(stats *feedStats) { stats.FramesIn++ })
	if len(data) != s.spec.Bytes {
		err := domainError(ErrCodeFrameInvalid, "frame is %d bytes; slot %q takes exactly %d (%dx%d %s)",
			len(data), s.slotID, s.spec.Bytes, s.spec.Format.Width, s.spec.Format.Height, s.spec.Format.PixelFormat)
		s.controller.noteFrame(s, func(stats *feedStats) {
			stats.Dropped++
			stats.LastErrCode, stats.LastErrDetail = err.Code, err.Message
		})
		return err
	}
	if err := s.adapter.WriteFrame(data); err != nil {
		var domain *DomainError
		if !errors.As(err, &domain) {
			domain = domainError(ErrCodeAdapterUnavailable, "device write failed: %v", err)
		}
		s.controller.noteFrame(s, func(stats *feedStats) {
			stats.Dropped++
			stats.LastErrCode, stats.LastErrDetail = domain.Code, domain.Message
		})
		return domain
	}
	now := s.controller.now()
	s.controller.noteFrame(s, func(stats *feedStats) {
		stats.FramesOut++
		stats.LastFrameAt = &now
		stats.LastErrCode, stats.LastErrDetail = "", ""
	})
	return nil
}

// Close ends the sink: the device shows black instead of freezing on the last
// live frame (design §14.3), the adapter's sink is closed, and the Slot's
// runtime goes back to waiting for a source. It covers Lease expiry, revoke and
// a closed binding alike; the daemon reports all three as Close.
//
// Closing the sink does not necessarily release the OS device: the v4l2 adapter
// keeps its descriptor until the Slot is deleted (see v4l2Slot), the Fake does
// release its record. The Slot stays reserved until the adapter's Close has
// returned, so a new sink cannot open it while this one is still tearing down.
//
// Limits, stated rather than hidden: nothing here watches for a source that
// goes silent while the sink stays open (design §14.3's stale-frame fallback is
// not built), and a Daemon that vanishes without calling Close leaves the Slot
// reserved (busy) until the module restarts or the Slot is stopped and started.
func (s *feedSink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	var err error
	if s.adapter != nil {
		err = errors.Join(s.adapter.ShowFallback(), s.adapter.Close())
	}
	s.controller.feedMu.Lock()
	if s.controller.sinks[s.slotID] == s {
		delete(s.controller.sinks, s.slotID)
	}
	s.controller.feedMu.Unlock()
	return err
}

// noteFrame applies update to the Slot's stats while this sink is the open one.
func (c *Controller) noteFrame(sink *feedSink, update func(*feedStats)) {
	c.feedMu.Lock()
	defer c.feedMu.Unlock()
	if c.sinks[sink.slotID] != sink {
		return
	}
	if stats := c.feedStatsBySlot[sink.slotID]; stats != nil {
		update(stats)
	}
}
