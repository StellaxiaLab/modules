package vdevice

// This file is the seam between the controller (which owns Slots and receives
// frames from the SVI sink) and an adapter (which owns the OS device). Keeping it
// in one small file lets the controller side and the OS adapters be written
// against the same contract.

// FrameSink receives the raw frames of one Slot, in order, one call per frame.
//
// This build carries raw frames only: the frame's pixel format and size are the
// Slot's. Nothing here decodes or scales — a frame whose length is not the
// Slot's frame size is refused by the controller before it reaches the adapter,
// so an adapter may assume len(frame) == the size it negotiated.
type FrameSink interface {
	// WriteFrame delivers one complete frame to the OS device.
	WriteFrame(frame []byte) error
	// ShowFallback puts the Slot's fallback picture (black) on the device. The
	// controller calls it when the source goes away — Lease expiry, revoke or a
	// closed binding — so the device never keeps showing the last live frame as
	// if it were current (design §14.3).
	ShowFallback() error
	// Close ends this sink and is safe to call more than once. Whether it also
	// releases the OS device handle is the adapter's choice and is NOT part of
	// the contract: the v4l2 adapter keeps one descriptor per Slot, because that
	// open descriptor is what keeps the format set on the loopback node, and
	// releases it only in RemoveSlot (Slot deleted) or when the module exits.
	// The Fake releases its record. Callers must not assume the device is free
	// after Close.
	Close() error
}

// FrameAdapter is an Adapter that can take frames. An Adapter that does not
// implement it can register Slots but cannot be projected onto.
type FrameAdapter interface {
	Adapter
	// OpenFrames returns the sink for a Slot the adapter has already ensured.
	// At most one sink is open per Slot; the controller enforces that.
	OpenFrames(slot Slot) (FrameSink, error)
}

// SlotReadiness is an optional interface of an Adapter that can say, per Slot,
// whether the OS device behind that Slot is usable right now. Adapter.Describe
// answers for the adapter as a whole ("at least one mapped device works"), which
// is the wrong question for a Slot: a camera whose own device is missing must
// not be published as available because a different Slot's device is fine. The
// controller uses SlotReady when the adapter implements it and falls back to
// the Slot's recorded install state when it does not.
//
// SlotReady may be called from a catalog poll, so an implementation must be
// cheap (cache any probe) and must not change the device.
type SlotReadiness interface {
	SlotReady(slotID string) (ready bool, reason string)
}

// MaxSinkFrameBytes is the largest raw frame the SVI sink path can carry.
//
// The module runtime caps a sink request's JSON body at 1 MiB and the frame is
// base64 in it, so about 780 KB of raw data is the ceiling. That constant lives
// in terra-sdk and a module cannot raise it. 640x480 YUY2 (614,400 bytes) fits;
// 1280x720 YUY2 (1,843,200) does not. A Slot whose frame size is larger than this
// is refused rather than accepted and then failed frame by frame.
const MaxSinkFrameBytes = 780 * 1000
