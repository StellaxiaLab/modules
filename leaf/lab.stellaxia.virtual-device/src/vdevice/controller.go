package vdevice

import (
	"sort"
	"strings"
	"sync"
	"time"
)

// Controller holds the module's declared state and answers the control API.
// It is the only writer of the store, so the API layer never has to think about
// ordering.
type Controller struct {
	mu        sync.RWMutex
	config    Config
	adapters  *AdapterRegistry
	store     *Store
	state     State
	startedAt time.Time
	now       func() time.Time

	// storageState is what the last write to the state file actually did.
	// "unverified" is kept distinct from "ok": a store nobody has written to is
	// not a store known to work, and collapsing the two is how a module reports
	// healthy storage right up to the first failed save.
	storageState  string
	storageDetail string

	// feedMu guards the two maps below: the open frame sink of each Slot and the
	// counters of its latest session. The lock order is in feed.go.
	feedMu          sync.Mutex
	sinks           map[string]*feedSink
	feedStatsBySlot map[string]*feedStats
}

// NewController loads persisted desired state and re-registers each slot with
// its adapter, which is what makes a slot survive a restart: the declaration is
// on disk, and the device is put back before anything asks for it.
func NewController(config Config, adapters *AdapterRegistry, store *Store) (*Controller, error) {
	state, err := store.Load()
	if err != nil {
		return nil, err
	}
	controller := &Controller{
		config:    config,
		adapters:  adapters,
		store:     store,
		state:     state,
		startedAt: time.Now().UTC(),
		now:       func() time.Time { return time.Now().UTC() },

		sinks:           map[string]*feedSink{},
		feedStatsBySlot: map[string]*feedStats{},
	}
	controller.reconcileSlots()
	// One write at start-up: it normalizes the document and, more usefully,
	// answers whether this module can write at all — before an operator's first
	// slot declaration is the thing that discovers it cannot.
	controller.save()
	return controller, nil
}

// save writes the state and remembers what happened. The caller holds the
// write lock (or is the constructor, before anything else can see the
// controller).
func (c *Controller) save() error {
	err := c.store.Save(c.state)
	if err != nil {
		c.storageState = "failed"
		c.storageDetail = err.Error()
		return err
	}
	c.storageState = "ok"
	c.storageDetail = ""
	return nil
}

// reconcileSlots re-registers every stored slot with its adapter at start-up.
// A slot whose adapter is gone or refuses is kept in the declaration and
// reported with the refusal: losing the operator's declaration because a driver
// is missing today would mean they have to re-declare it when it is installed.
//
// A refusal here is not permanent. The device may simply not exist yet (the
// loopback module is loaded after this one starts), so OpenSink asks the adapter
// to ensure the Slot again before it opens frames, and resourceFor asks the
// adapter per Slot (SlotReadiness) rather than trusting the install state
// recorded here.
//
// A stopped (enabled=false) slot is not ensured: stopping means "no device
// work" (the same rule as PutSlot), and a restart must not bring a stopped
// device back.
func (c *Controller) reconcileSlots() {
	for id, slot := range c.state.Slots {
		if !slot.Enabled {
			slot.InstallState = StateDisabled
			c.state.Slots[id] = slot
			continue
		}
		adapter, ok := c.adapters.Lookup(slot.AdapterID)
		if !ok {
			slot.InstallState = StateNotInstalled
			slot.OSDeviceID = ""
			c.state.Slots[id] = slot
			continue
		}
		deviceID, err := adapter.EnsureSlot(slot)
		if err != nil {
			slot.InstallState = StateNotInstalled
			slot.OSDeviceID = ""
			c.state.Slots[id] = slot
			continue
		}
		slot.OSDeviceID = deviceID
		slot.InstallState = StateReady
		c.state.Slots[id] = slot
	}
}

// Adapters lists every adapter this build has (§16.2 GET /adapters).
func (c *Controller) Adapters() []AdapterDescriptor { return c.adapters.Describe() }

// Adapter reports one adapter (§16.2 GET /adapters/{adapter_id}).
func (c *Controller) Adapter(adapterID string) (AdapterDescriptor, error) {
	adapter, ok := c.adapters.Lookup(adapterID)
	if !ok {
		return AdapterDescriptor{}, domainError(ErrCodeAdapterUnavailable, "no adapter %q in this build", adapterID)
	}
	return adapter.Describe(), nil
}

// Slots lists declared slots, ordered by id (§16.2 GET /slots).
func (c *Controller) Slots() []Slot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	slots := make([]Slot, 0, len(c.state.Slots))
	for _, slot := range c.state.Slots {
		slots = append(slots, slot)
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i].SlotID < slots[j].SlotID })
	return slots
}

// Slot reports one slot (§16.2 GET /slots/{slot_id}).
func (c *Controller) Slot(slotID string) (Slot, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	slot, ok := c.state.Slots[slotID]
	if !ok {
		return Slot{}, domainError(ErrCodeSlotNotFound, "no slot %q", slotID)
	}
	return slot, nil
}

// PutSlot creates or updates a slot (§16.2 PUT /slots/{slot_id}).
//
// An update never re-creates the OS device: slot_id, display_name and
// os_device_id are what an external program picked from its device list, and
// design principle §4.8 says they stay. The adapter is asked to ensure the
// slot, not to replace it.
func (c *Controller) PutSlot(slotID string, request SlotRequest) (Slot, error) {
	if err := request.Validate(slotID); err != nil {
		return Slot{}, err
	}
	adapter, ok := c.adapters.Lookup(request.AdapterID)
	if !ok {
		return Slot{}, domainError(ErrCodeAdapterUnavailable, "no adapter %q in this build; GET /adapters lists what there is", request.AdapterID)
	}
	// Refused here rather than at the first frame: a format the SVI sink cannot
	// carry (non-YUY2, or a frame over MaxSinkFrameBytes such as 1280x720) would
	// otherwise be accepted and then fail binding after binding.
	if err := validateSlotFormats(request.AcceptedFormats()); err != nil {
		return Slot{}, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	slot, existed := c.state.Slots[slotID]
	if !existed {
		slot = Slot{SlotID: slotID, CreatedAt: now}
	}
	if existed && slot.AdapterID != request.AdapterID {
		// Moving a slot between adapters is a different OS device, so it is not
		// an update. Refusing is the honest answer; the caller deletes and
		// re-creates, and sees that the device changes.
		return Slot{}, domainError(ErrCodeInvalidRequest,
			"slot %q is on adapter %q; delete it before declaring it on %q", slotID, slot.AdapterID, request.AdapterID)
	}
	previous := slot
	slot.Kind = request.Kind
	slot.DisplayName = strings.TrimSpace(request.DisplayName)
	slot.Scope = request.Scope
	slot.OwnerSubject = request.OwnerSubject
	slot.AdapterID = request.AdapterID
	slot.AcceptedFormats = request.AcceptedFormats()
	slot.Enabled = request.DesiredState == DesiredReady
	slot.UpdatedAt = now

	// The adapter is asked first, and a live sink is touched only once it has
	// said yes: a refused update (device vanished, format refused) must leave the
	// running picture alone rather than cut it for nothing.
	if slot.Enabled {
		deviceID, err := adapter.EnsureSlot(slot)
		if err != nil {
			return Slot{}, err
		}
		slot.OSDeviceID = deviceID
		slot.InstallState = StateReady
	} else {
		slot.InstallState = StateDisabled
	}

	// A stopped Slot, or one whose frame (width, height or pixel format, not
	// merely its byte count: 640x480 and 480x640 are the same size and different
	// pictures) changed, cannot keep its open sink: the device goes black and the
	// source's next Write fails, so the binding reports it. The sink is reopened
	// by the binding, not silently resized. An update that leaves the frame as it
	// was (a display_name edit) leaves the sink alone.
	if sinkSpec, open := c.sinkFrameSpec(slotID); open {
		if spec, err := frameSpecFor(slot.AcceptedFormats); !slot.Enabled || err != nil || spec != sinkSpec {
			c.closeSink(slotID)
		}
	}

	c.state.Slots[slotID] = slot
	if err := c.save(); err != nil {
		// Not persisted, so not declared: put memory back and undo the adapter
		// side, or the next restart finds a device nobody declared (new slot) or
		// a format the stored declaration does not name (update).
		if existed {
			c.state.Slots[slotID] = previous
			if previous.Enabled && slot.Enabled {
				_, _ = adapter.EnsureSlot(previous)
			}
		} else {
			delete(c.state.Slots, slotID)
			if slot.Enabled {
				_ = adapter.RemoveSlot(slotID)
			}
		}
		return Slot{}, err
	}
	return slot, nil
}

// DeleteSlot removes a slot (§16.2 DELETE /slots/{slot_id}).
//
// §9.2: an active projection is ended first. This refuses instead of ending it
// silently — a slot deleted out from under a live projection is a device that
// disappears from someone's call, and the caller is the one who knows whether
// that is what they meant.
func (c *Controller) DeleteSlot(slotID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	slot, ok := c.state.Slots[slotID]
	if !ok {
		return domainError(ErrCodeSlotNotFound, "no slot %q", slotID)
	}
	for _, declaration := range c.state.Projections {
		if declaration.SlotID == slotID && declaration.DesiredState == DesiredActive {
			return domainError(ErrCodeSlotBusy,
				"projection %q still declares slot %q active; stop or delete it first", declaration.ProjectionID, slotID)
		}
	}
	// Close the sink first (black fallback) so the adapter is not asked to remove
	// a device a sink is still writing to.
	c.closeSink(slotID)
	if adapter, found := c.adapters.Lookup(slot.AdapterID); found {
		if err := adapter.RemoveSlot(slotID); err != nil {
			// Which side is the truth? The stored declaration: it is what the
			// operator asked for and what a restart reconciles from. The adapter's
			// state after a failed RemoveSlot is unknown (the v4l2 adapter has
			// already forgotten the slot when its Close errors), so the slot is
			// kept, marked as not confirmed on the adapter, and the error is
			// returned. Retrying DELETE is safe because RemoveSlot is idempotent,
			// and a sink open meanwhile re-ensures the slot first (OpenSink).
			slot.InstallState = StateNotInstalled
			slot.OSDeviceID = ""
			c.state.Slots[slotID] = slot
			_ = c.save()
			return err
		}
	}
	delete(c.state.Slots, slotID)
	for id, declaration := range c.state.Projections {
		if declaration.SlotID == slotID {
			delete(c.state.Projections, id)
		}
	}
	return c.save()
}

// Projections lists every declared projection with its runtime (§16.2).
func (c *Controller) Projections() []ProjectionView {
	c.mu.RLock()
	defer c.mu.RUnlock()
	views := make([]ProjectionView, 0, len(c.state.Projections))
	for _, declaration := range c.state.Projections {
		views = append(views, ProjectionView{Declaration: declaration, Runtime: c.runtimeFor(declaration)})
	}
	sort.Slice(views, func(i, j int) bool {
		return views[i].Declaration.ProjectionID < views[j].Declaration.ProjectionID
	})
	return views
}

// Projection reports one projection's declaration and runtime (§16.2).
func (c *Controller) Projection(projectionID string) (ProjectionView, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	declaration, ok := c.state.Projections[projectionID]
	if !ok {
		return ProjectionView{}, domainError(ErrCodeSlotNotFound, "no projection %q", projectionID)
	}
	return ProjectionView{Declaration: declaration, Runtime: c.runtimeFor(declaration)}, nil
}

// PutProjection applies a projection desired state (§16.2, §16.4).
//
// Generation is the concurrency rule: the same id at the same generation is the
// same request and returns the same result; an older generation is refused with
// VDEV_STALE_GENERATION so two operators cannot silently overwrite each other's
// source switch.
func (c *Controller) PutProjection(projectionID string, request ProjectionRequest) (ProjectionView, error) {
	if err := request.Validate(projectionID); err != nil {
		return ProjectionView{}, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.state.Slots[request.SlotID]; !ok {
		return ProjectionView{}, domainError(ErrCodeSlotNotFound, "no slot %q to project onto", request.SlotID)
	}
	existing, existed := c.state.Projections[projectionID]
	if existed && request.Generation < existing.Generation {
		return ProjectionView{}, domainError(ErrCodeStaleGeneration,
			"projection %q is at generation %d; %d is older", projectionID, existing.Generation, request.Generation)
	}
	// §9.2: at most one active source per slot.
	if request.DesiredState == DesiredActive {
		for id, declaration := range c.state.Projections {
			if id != projectionID && declaration.SlotID == request.SlotID && declaration.DesiredState == DesiredActive {
				return ProjectionView{}, domainError(ErrCodeSlotBusy,
					"slot %q already has active projection %q", request.SlotID, id)
			}
		}
	}

	now := c.now()
	declaration := ProjectionDeclaration{
		ProjectionID:    projectionID,
		SlotID:          request.SlotID,
		Source:          request.Source,
		RequestedFormat: request.RequestedFormat,
		QoS:             request.QoS,
		Lifecycle:       request.Lifecycle,
		DesiredState:    request.DesiredState,
		OwnerSubject:    request.OwnerSubject,
		TTLSeconds:      request.TTLSeconds,
		Generation:      request.Generation,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if existed {
		declaration.CreatedAt = existing.CreatedAt
		if request.Generation == existing.Generation {
			// Same generation is the same request: replaying it must not move
			// updated_at, or a retry looks like a change.
			declaration.UpdatedAt = existing.UpdatedAt
		}
	}
	c.state.Projections[projectionID] = declaration
	if err := c.save(); err != nil {
		return ProjectionView{}, err
	}
	return ProjectionView{Declaration: declaration, Runtime: c.runtimeFor(declaration)}, nil
}

// DeleteProjection stops and removes a projection (§16.2).
func (c *Controller) DeleteProjection(projectionID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.state.Projections[projectionID]; !ok {
		return domainError(ErrCodeSlotNotFound, "no projection %q", projectionID)
	}
	delete(c.state.Projections, projectionID)
	return c.save()
}

// runtimeFor reports what is actually happening to a declaration. Caller holds
// the lock.
//
// The frame path is the SVI sink: the Daemon opens the Slot's resource when an
// operator binds a source to it. A declaration says what the operator
// wants; only the sink says what is true, so:
//
//	no sink open                 degraded / VDEV_SOURCE_UNAVAILABLE
//	sink open, no frame yet      priming
//	sink open, frames reaching   active
//	device refusing frames       degraded / the adapter's code
//
// The declaration alone never produces `active`. Declaring a projection does not
// create the binding either (that is the operator's step in this phase), and the
// detail says so. §10.2 has no waiting_source state; degraded is its "source
// supply cannot be maintained right now".
func (c *Controller) runtimeFor(declaration ProjectionDeclaration) ProjectionRuntime {
	runtime := ProjectionRuntime{UpdatedAt: c.now()}
	if declaration.DesiredState == DesiredStopped {
		runtime.ObservedState = ProjectionClosed
		runtime.ReasonDetail = "desired_state is stopped"
		return runtime
	}
	slot, ok := c.state.Slots[declaration.SlotID]
	if !ok {
		runtime.ObservedState = ProjectionFailed
		runtime.ReasonCode = ErrCodeSlotNotFound
		runtime.ReasonDetail = "the slot this projection names no longer exists"
		return runtime
	}
	descriptor, err := c.Adapter(slot.AdapterID)
	if err != nil || descriptor.InstallState != StateReady {
		runtime.ObservedState = ProjectionWaitingDriver
		runtime.ReasonCode = ErrCodeAdapterUnavailable
		runtime.ReasonDetail = "the slot's adapter is not ready on this machine"
		return runtime
	}
	// The adapter being ready is not this Slot's device being usable.
	if adapter, ok := c.adapters.Lookup(slot.AdapterID); ok {
		if readiness, ok := adapter.(SlotReadiness); ok {
			if ready, reason := readiness.SlotReady(slot.SlotID); !ready {
				runtime.ObservedState = ProjectionWaitingDriver
				runtime.ReasonCode = ErrCodeAdapterUnavailable
				runtime.ReasonDetail = "the slot's own device is not usable: " + reason
				return runtime
			}
		}
	}

	feed := c.feedSnapshot(slot.SlotID)
	runtime.FramesIn = feed.Stats.FramesIn
	runtime.FramesOut = feed.Stats.FramesOut
	runtime.FramesDropped = feed.Stats.Dropped
	runtime.LastFrameAt = feed.Stats.LastFrameAt
	if feed.Stats.Opens > 1 {
		runtime.ReconnectCount = feed.Stats.Opens - 1
	}
	if !feed.Open {
		runtime.ObservedState = ProjectionDegraded
		runtime.ReasonCode = ErrCodeSourceUnavailable
		runtime.ReasonDetail = "no source is delivering frames: the Slot's SVI sink (resource *.vdevice." + slot.SlotID +
			", endpoint input) is not open. The device shows black. Declaring a projection does not create the binding; an operator binds a source to that sink."
		return runtime
	}
	runtime.StartedAt = feed.Stats.StartedAt
	format := feed.Spec.Format
	runtime.NegotiatedFormat = &format
	switch {
	case feed.Stats.LastErrCode != "":
		runtime.ObservedState = ProjectionDegraded
		runtime.ReasonCode = feed.Stats.LastErrCode
		runtime.ReasonDetail = feed.Stats.LastErrDetail
	case feed.Stats.FramesOut == 0:
		runtime.ObservedState = ProjectionPriming
		runtime.ReasonDetail = "sink open; no frame has reached the device yet"
	default:
		runtime.ObservedState = ProjectionActive
	}
	return runtime
}

// sinkFrameSpec is the frame of the Slot's open sink; open is false when none is.
func (c *Controller) sinkFrameSpec(slotID string) (frameSpec, bool) {
	c.feedMu.Lock()
	defer c.feedMu.Unlock()
	if sink := c.sinks[slotID]; sink != nil {
		return sink.spec, true
	}
	return frameSpec{}, false
}

// Status is the GET /status answer (§16.2).
type Status struct {
	Status      string         `json:"status"`
	ModuleID    string         `json:"module_id"`
	Version     string         `json:"version"`
	Phase       string         `json:"phase"`
	UptimeSec   int64          `json:"uptime_sec"`
	Daemon      DaemonStatus   `json:"daemon"`
	Adapters    AdapterSummary `json:"adapters"`
	Storage     StorageStatus  `json:"storage"`
	Slots       int            `json:"slots"`
	Projections int            `json:"projections"`
}

// DaemonStatus reports the module's own connection to the Daemon. Connected
// is always false and says why: the module holds no connection of its own. Frames arrive through the SVI sink seam, which the Daemon opens toward the
// module, and that works without Connected ever being true.
type DaemonStatus struct {
	Connected bool   `json:"connected"`
	Endpoint  string `json:"endpoint"`
	Detail    string `json:"detail"`
}

// AdapterSummary counts adapters by what they can actually do. Simulated is
// counted apart from Ready on purpose — a summary that added them together
// would report "1 ready adapter" on a machine with no virtual camera at all.
type AdapterSummary struct {
	Total     int `json:"total"`
	Ready     int `json:"ready"`
	Simulated int `json:"simulated"`
	Unbuilt   int `json:"unbuilt"`
}

// StorageStatus reports where declared state lives (§19) and what the last
// write to it did.
type StorageStatus struct {
	Path string `json:"path"`
	// State is "ok", "failed" or "unverified" — never a bare boolean, because
	// "nobody has written yet" is not the same answer as "the write worked".
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
}

// ModuleVersion is the module version reported by /status; it tracks
// module.json.
const ModuleVersion = "0.2.0"

// PhaseLabel names the implementation phase this build is, so an operator
// reading /status is not left to infer it from missing features.
//
// "phase-1+linux-adapter": design §25 Phase 1 (control API, SVI sink, frame
// delivery) plus the Linux v4l2loopback adapter (design Phase 2's scope), which
// has only been exercised against an injected fake device so far. The value says
// both, instead of "phase-1" alone, which would hide that a real adapter exists.
const PhaseLabel = "phase-1+linux-adapter"

// Status answers GET /status.
func (c *Controller) Status() Status {
	c.mu.RLock()
	defer c.mu.RUnlock()
	summary := AdapterSummary{}
	for _, descriptor := range c.adapters.Describe() {
		summary.Total++
		switch {
		case descriptor.Simulated:
			summary.Simulated++
		case descriptor.InstallState == StateReady:
			summary.Ready++
		default:
			summary.Unbuilt++
		}
	}
	overall := "degraded"
	if summary.Ready > 0 {
		overall = "ok"
	}
	storage := StorageStatus{Path: c.store.Path(), State: c.storageState, Detail: c.storageDetail}
	if storage.State == "" {
		storage.State = "unverified"
	}
	return Status{
		// "ok" only when a real (non-simulated) adapter is ready. With just the
		// Fake the module can serve its API and move simulated frames, and
		// that is not a working virtual camera; calling it ok would make the
		// word mean nothing on the day it matters.
		Status:    overall,
		ModuleID:  ModuleID,
		Version:   ModuleVersion,
		Phase:     PhaseLabel,
		UptimeSec: int64(c.now().Sub(c.startedAt).Seconds()),
		Daemon: DaemonStatus{
			Connected: false,
			Endpoint:  c.config.Daemon.Endpoint,
			Detail:    "No direct Daemon connection. Frames arrive through the SVI sink seam: each Slot is published as a sink resource and the Daemon opens it when an operator creates a binding to it. Declaring a projection does not create that binding yet.",
		},
		Adapters:    summary,
		Storage:     storage,
		Slots:       len(c.state.Slots),
		Projections: len(c.state.Projections),
	}
}

// Diagnostics is the GET /diagnostics answer (§16.2): a redacted summary.
// It carries no source ids, no owner subjects, no tokens and no frames — §20.4
// lists exactly those as the things that must not be written down, and a
// diagnostics bundle is the most-copied artefact there is.
type Diagnostics struct {
	Status           Status              `json:"status"`
	Adapters         []AdapterDescriptor `json:"adapters"`
	Config           ConfigSummary       `json:"config"`
	SlotStates       map[string]int      `json:"slot_states"`
	ProjectionStates map[string]int      `json:"projection_states"`
	Notes            []string            `json:"notes"`
}

// ConfigSummary is the configuration as it took effect, minus anything an
// operator would not want in a support bundle. Everything §18 carries is a
// policy number, so what is dropped here is the paths.
type ConfigSummary struct {
	SchemaVersion        int    `json:"schema_version"`
	DaemonEndpoint       string `json:"daemon_endpoint"`
	DefaultLifecycle     string `json:"default_lifecycle"`
	MaxQueueFrames       int    `json:"max_queue_frames"`
	MaxFrameBytes        int    `json:"max_frame_bytes"`
	VideoFallback        string `json:"video_fallback"`
	AudioUnderflow       string `json:"audio_underflow"`
	ExternalListen       bool   `json:"external_listen"`
	AllowUnsignedAdapter bool   `json:"allow_unsigned_adapter"`
	PersistFramePayload  bool   `json:"persist_frame_payload"`
}

// Diagnostics answers GET /diagnostics.
func (c *Controller) Diagnostics() Diagnostics {
	status := c.Status()
	c.mu.RLock()
	defer c.mu.RUnlock()
	slotStates := map[string]int{}
	for _, slot := range c.state.Slots {
		slotStates[slot.InstallState]++
	}
	projectionStates := map[string]int{}
	for _, declaration := range c.state.Projections {
		projectionStates[c.runtimeFor(declaration).ObservedState]++
	}
	return Diagnostics{
		Status:   status,
		Adapters: c.adapters.Describe(),
		Config: ConfigSummary{
			SchemaVersion:        c.config.SchemaVersion,
			DaemonEndpoint:       c.config.Daemon.Endpoint,
			DefaultLifecycle:     c.config.Projection.DefaultLifecycle,
			MaxQueueFrames:       c.config.Video.MaxQueueFrames,
			MaxFrameBytes:        c.config.Video.MaxFrameBytes,
			VideoFallback:        c.config.Video.Fallback,
			AudioUnderflow:       c.config.Audio.Underflow,
			ExternalListen:       c.config.Security.ExternalListen,
			AllowUnsignedAdapter: c.config.Security.AllowUnsignedAdapter,
			PersistFramePayload:  c.config.Diagnostics.PersistFramePayload,
		},
		SlotStates:       slotStates,
		ProjectionStates: projectionStates,
		Notes: []string{
			"Phase 1 build plus the Linux adapter: control API, one SVI sink resource per Slot, and frame delivery to the Slot's adapter (raw YUY2, at most 780 KB per frame). The Fake adapter creates no operating-system device; this module installs no driver.",
			"Bindings are created by the operator; a projection declaration does not create one. Real OS adapters: Linux v4l2loopback (writes into pre-created /dev/videoN nodes; not yet verified on a real loopback device), Windows and macOS later. No stale-frame watchdog: a source that stops sending while its sink stays open leaves the last frame showing and the projection active.",
			"Redaction: this summary carries no resource ids, owner subjects, credentials or frame payloads (design §20.4).",
		},
	}
}
