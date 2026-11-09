//go:build linux

package vdevice

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

// V4L2LoopbackAdapterID is the Linux adapter's id; it matches the placeholder
// plannedAdapters declares, so registering this adapter replaces it.
const V4L2LoopbackAdapterID = "linux.v4l2loopback"

// What is recalled about v4l2loopback and NOT verified on a real node yet. This
// adapter has been exercised against an injected fake v4l2Device only; the live
// tests (TERRA_VDEV_TEST_DEVICE) are what settle each point below, and they SKIP
// when no loopback node is present:
//   - a write(2) needs a format set first with VIDIOC_S_FMT on the same fd;
//   - a write succeeds even with no reader attached;
//   - one write(2) of exactly sizeimage bytes is one frame;
//   - the format is kept while at least one fd stays open on the node.

// v4l2Adapter writes YUY2 frames to pre-created v4l2loopback nodes.
type v4l2Adapter struct {
	devices map[string]string // slot id -> /dev/videoN
	open    func(path string) (v4l2Device, error)
	// moduleLoaded reports whether the v4l2loopback kernel module is present;
	// used only to word an error. Replaceable for tests.
	moduleLoaded func() bool
	// now is replaceable so tests can step the probe cache.
	now func() time.Time

	mu    sync.Mutex
	slots map[string]*v4l2Slot

	// probeCache remembers the last probe of each device path, so a catalog poll
	// that asks "is this Slot's device usable" does not open and QUERYCAP the
	// node every few seconds. Held Slots are never probed at all (holds). The
	// cache is dropped for a path whenever EnsureSlot or RemoveSlot touches it.
	probeMu    sync.Mutex
	probeCache map[string]probeResult
}

// probeCacheTTL bounds how stale a probe answer may be: a node that appears (or
// vanishes) is noticed within this long.
const probeCacheTTL = 2 * time.Second

type probeResult struct {
	at  time.Time
	err error
}

func newV4L2Adapter(devices map[string]string, open func(string) (v4l2Device, error)) *v4l2Adapter {
	copied := make(map[string]string, len(devices))
	for slotID, path := range devices {
		if path = strings.TrimSpace(path); path != "" {
			copied[slotID] = path
		}
	}
	return &v4l2Adapter{
		devices: copied,
		open:    open,
		moduleLoaded: func() bool {
			_, err := os.Stat("/sys/module/v4l2loopback")
			return err == nil
		},
		now:        time.Now,
		slots:      map[string]*v4l2Slot{},
		probeCache: map[string]probeResult{},
	}
}

// v4l2Slot is one ensured device. The descriptor belongs to the slot, not to a
// sink: sinks come and go with bindings, while the open handle is what keeps
// the format set on the node, so only RemoveSlot closes it. A Slot that is
// stopped, or whose sink closed, therefore still holds its /dev/videoN open
// until the Slot is deleted (or the module exits).
type v4l2Slot struct {
	path string
	dev  v4l2Device

	mu        sync.Mutex // serialises writes and format changes
	sizeImage int        // the driver's answer from G_FMT
	width     int
	height    int
	closed    atomic.Bool
}

// Describe reports the adapter as a whole: ready when at least one mapped
// device is usable. That is an adapter-level fact only. Whether a particular
// Slot can be projected onto is SlotReady's answer, and the controller asks that
// per Slot, so a broken device of another Slot is neither hidden behind this
// "ready" nor able to unmake it.
func (a *v4l2Adapter) Describe() AdapterDescriptor {
	descriptor := AdapterDescriptor{
		AdapterID:        V4L2LoopbackAdapterID,
		Kind:             KindCamera,
		OS:               "linux",
		Version:          "0.1.0",
		Capabilities:     []string{"slot.register", "slot.remove", "frame.write"},
		InstallState:     StateNotInstalled,
		Simulated:        false,
		SupportedFormats: []Format{{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"}},
	}
	if len(a.devices) == 0 {
		descriptor.Health = "not_configured"
		descriptor.Detail = "No slot has a /dev/videoN device mapped in the module configuration. Create a node with `modprobe v4l2loopback exclusive_caps=1` (as root) and map slot ids to it."
		return descriptor
	}
	slotIDs := make([]string, 0, len(a.devices))
	for slotID := range a.devices {
		slotIDs = append(slotIDs, slotID)
	}
	sort.Strings(slotIDs)
	usable := 0
	var problems []string
	for _, slotID := range slotIDs {
		if ready, reason := a.SlotReady(slotID); ready {
			usable++
		} else {
			problems = append(problems, fmt.Sprintf("slot %s -> %s: %s", slotID, a.devices[slotID], reason))
		}
	}
	switch {
	case usable == len(slotIDs):
		descriptor.InstallState = StateReady
		descriptor.Health = "ok"
		descriptor.Detail = fmt.Sprintf("All %d mapped /dev/videoN nodes are usable output nodes.", usable)
	case usable > 0:
		descriptor.InstallState = StateReady
		descriptor.Health = "degraded"
		descriptor.Detail = fmt.Sprintf("%d of %d mapped nodes are usable; unusable: %s", usable, len(slotIDs), strings.Join(problems, "; "))
	default:
		descriptor.Health = "unavailable"
		descriptor.Detail = strings.Join(problems, "; ")
	}
	return descriptor
}

// SlotReady reports whether the device mapped to one Slot can be written to
// right now. A node this adapter already holds is ready by construction (the
// held handle is the proof; a second QUERYCAP could read CAPTURE-only under
// exclusive_caps). Otherwise the node is probed (open + QUERYCAP, nothing
// changed) and the answer is cached for probeCacheTTL.
func (a *v4l2Adapter) SlotReady(slotID string) (bool, string) {
	path, ok := a.devices[slotID]
	if !ok {
		return false, fmt.Sprintf("slot %s has no /dev/videoN mapping in the module configuration", slotID)
	}
	if a.holds(slotID) {
		return true, ""
	}
	if err := a.probeCached(path); err != nil {
		return false, err.Error()
	}
	return true, ""
}

func (a *v4l2Adapter) probeCached(path string) error {
	a.probeMu.Lock()
	cached, ok := a.probeCache[path]
	a.probeMu.Unlock()
	if ok && a.now().Sub(cached.at) < probeCacheTTL {
		return cached.err
	}
	err := a.probe(path)
	a.probeMu.Lock()
	a.probeCache[path] = probeResult{at: a.now(), err: err}
	a.probeMu.Unlock()
	return err
}

func (a *v4l2Adapter) forgetProbe(path string) {
	a.probeMu.Lock()
	delete(a.probeCache, path)
	a.probeMu.Unlock()
}

func (a *v4l2Adapter) holds(slotID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	slot, ok := a.slots[slotID]
	return ok && !slot.closed.Load()
}

// probe opens the node and asks QUERYCAP, then lets go. It changes nothing.
func (a *v4l2Adapter) probe(path string) error {
	dev, err := a.open(path)
	if err != nil {
		return errors.New(a.explainOpenError(path, err))
	}
	defer dev.Close()
	var caps v4l2Capability
	if err := dev.Ioctl(vidiocQueryCap, unsafe.Pointer(&caps)); err != nil {
		return errors.New(explainQueryCapError(path, err))
	}
	return checkOutputCaps(caps)
}

// explainOpenError names the cause the operator can act on.
func (a *v4l2Adapter) explainOpenError(path string, err error) string {
	switch {
	case errors.Is(err, os.ErrNotExist):
		if !a.moduleLoaded() {
			return fmt.Sprintf("%s does not exist and the v4l2loopback kernel module is not loaded (as root: modprobe v4l2loopback video_nr=10 exclusive_caps=1)", path)
		}
		return fmt.Sprintf("%s does not exist although v4l2loopback is loaded (check its video_nr= and devices= options)", path)
	case errors.Is(err, os.ErrPermission):
		return fmt.Sprintf("permission denied opening %s: the user running this module needs read/write access (usually membership of the video group)", path)
	case errors.Is(err, syscall.EBUSY):
		return fmt.Sprintf("%s is busy: another process holds it open", path)
	default:
		return fmt.Sprintf("cannot open %s: %v", path, err)
	}
}

func explainQueryCapError(path string, err error) string {
	if errors.Is(err, syscall.ENOTTY) || errors.Is(err, syscall.EINVAL) {
		return fmt.Sprintf("%s is not a V4L2 device (VIDIOC_QUERYCAP refused)", path)
	}
	return fmt.Sprintf("VIDIOC_QUERYCAP on %s failed: %v", path, err)
}

// slotFormat picks the width and height for the slot: the first accepted YUY2
// format, or 640x480 when the slot names none.
func slotFormat(slot Slot) (int, int, error) {
	width, height := 640, 480
	if len(slot.AcceptedFormats) > 0 {
		f := slot.AcceptedFormats[0]
		if pf := strings.ToUpper(strings.TrimSpace(f.PixelFormat)); pf != "" && pf != "YUY2" && pf != "YUYV" {
			return 0, 0, domainError(ErrCodeFormatIncompatible, "pixel format %q is not supported by %s: only YUY2", f.PixelFormat, V4L2LoopbackAdapterID)
		}
		if f.Width > 0 || f.Height > 0 {
			width, height = f.Width, f.Height
		}
	}
	if width > 0 && height > 0 && width*height*yuy2BytesPerPixel > MaxSinkFrameBytes {
		return 0, 0, domainError(ErrCodeFormatIncompatible,
			"%dx%d YUY2 is %d bytes, over the %d-byte frame limit of the sink path", width, height, width*height*yuy2BytesPerPixel, MaxSinkFrameBytes)
	}
	return width, height, nil
}

// EnsureSlot opens the mapped node, checks it can take output, sets and reads
// back the format, and shows a black frame. Called again it reuses the handle it
// already holds and returns the same device id; it re-applies the format (and
// shows the black frame) only when the width/height actually changed, so an
// idempotent re-ensure (a display_name edit, a retry from OpenSink) never
// disturbs a live picture.
func (a *v4l2Adapter) EnsureSlot(slot Slot) (string, error) {
	path, ok := a.devices[slot.SlotID]
	if !ok {
		return "", domainError(ErrCodeAdapterUnavailable,
			"slot %s has no /dev/videoN mapping in the module configuration; map it to a v4l2loopback node", slot.SlotID)
	}
	width, height, err := slotFormat(slot)
	if err != nil {
		return "", err
	}
	want, err := buildOutputFormat(width, height)
	if err != nil {
		return "", domainError(ErrCodeFormatIncompatible, "%v", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.forgetProbe(path)
	if existing, ok := a.slots[slot.SlotID]; ok && !existing.closed.Load() {
		if existing.hasFormat(want) {
			return existing.path, nil
		}
		if err := existing.applyFormat(want); err != nil {
			return "", err
		}
		return existing.path, nil
	}

	dev, err := a.open(path)
	if err != nil {
		code := ErrCodeHandleOpenFailed
		if errors.Is(err, os.ErrPermission) {
			code = ErrCodeOSPermissionDenied
		} else if errors.Is(err, os.ErrNotExist) {
			code = ErrCodeAdapterUnavailable
		}
		return "", domainError(code, "%s", a.explainOpenError(path, err))
	}
	var caps v4l2Capability
	if err := dev.Ioctl(vidiocQueryCap, unsafe.Pointer(&caps)); err != nil {
		dev.Close()
		return "", domainError(ErrCodeAdapterUnavailable, "%s", explainQueryCapError(path, err))
	}
	if err := checkOutputCaps(caps); err != nil {
		dev.Close()
		return "", domainError(ErrCodeAdapterUnavailable, "%s: %v", path, err)
	}
	state := &v4l2Slot{path: path, dev: dev}
	if err := state.applyFormat(want); err != nil {
		dev.Close()
		return "", err
	}
	a.slots[slot.SlotID] = state
	return path, nil
}

// hasFormat reports whether the slot already runs exactly this format.
func (s *v4l2Slot) hasFormat(want v4l2Format) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sizeImage != 0 && s.width == int(want.Pix.Width) && s.height == int(want.Pix.Height) &&
		s.sizeImage == int(want.Pix.SizeImage)
}

// applyFormat runs S_FMT then G_FMT, keeps the driver's answer, and shows a
// black frame so the node never starts on stale or empty pixels.
func (s *v4l2Slot) applyFormat(want v4l2Format) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	req := want
	if err := s.dev.Ioctl(vidiocSFmt, unsafe.Pointer(&req)); err != nil {
		return domainError(ErrCodeFormatIncompatible, "VIDIOC_S_FMT %dx%d YUYV on %s failed: %v", want.Pix.Width, want.Pix.Height, s.path, err)
	}
	got := v4l2Format{Type: v4l2BufTypeOutput}
	if err := s.dev.Ioctl(vidiocGFmt, unsafe.Pointer(&got)); err != nil {
		return domainError(ErrCodeFormatIncompatible, "VIDIOC_G_FMT on %s failed: %v", s.path, err)
	}
	if got.Pix.Width != want.Pix.Width || got.Pix.Height != want.Pix.Height || got.Pix.PixelFormat != v4l2PixFmtYUYV {
		return domainError(ErrCodeFormatIncompatible,
			"%s adjusted the format to %dx%d pixelformat 0x%08x; wanted %dx%d YUYV",
			s.path, got.Pix.Width, got.Pix.Height, got.Pix.PixelFormat, want.Pix.Width, want.Pix.Height)
	}
	if got.Pix.SizeImage != want.Pix.SizeImage {
		return domainError(ErrCodeFormatIncompatible,
			"%s reports sizeimage %d for %dx%d YUY2, expected %d: frames would not line up",
			s.path, got.Pix.SizeImage, want.Pix.Width, want.Pix.Height, want.Pix.SizeImage)
	}
	s.width, s.height, s.sizeImage = int(got.Pix.Width), int(got.Pix.Height), int(got.Pix.SizeImage)
	return s.writeLocked(blackFrameYUY2(s.sizeImage))
}

// blackFrameYUY2 is n bytes of YUY2 black: Y=0x10, U=V=0x80 (limited range).
func blackFrameYUY2(n int) []byte {
	frame := make([]byte, n)
	for i := 0; i+3 < n; i += 4 {
		frame[i], frame[i+1], frame[i+2], frame[i+3] = 0x10, 0x80, 0x10, 0x80
	}
	return frame
}

// writeLocked sends one frame with a single write(2). Callers hold s.mu.
func (s *v4l2Slot) writeLocked(frame []byte) error {
	if s.closed.Load() {
		return domainError(ErrCodeHandleOpenFailed, "the device %s is closed", s.path)
	}
	if len(frame) != s.sizeImage {
		return domainError(ErrCodeFrameInvalid, "frame is %d bytes, the device frame is %d", len(frame), s.sizeImage)
	}
	n, err := s.dev.WriteOnce(frame)
	if err != nil {
		return domainError(ErrCodeHandleOpenFailed, "write to %s failed: %v", s.path, err)
	}
	if n != len(frame) {
		return domainError(ErrCodeHandleOpenFailed, "short write to %s: %d of %d bytes", s.path, n, len(frame))
	}
	return nil
}

// RemoveSlot closes the slot's handle. Unknown slots are not an error. The
// adapter forgets the slot before it closes the descriptor, so a Close error
// leaves the adapter without the slot; the controller treats its stored
// declaration as the truth and re-ensures on demand (see Controller.DeleteSlot).
func (a *v4l2Adapter) RemoveSlot(slotID string) error {
	a.mu.Lock()
	slot, ok := a.slots[slotID]
	delete(a.slots, slotID)
	if path, mapped := a.devices[slotID]; mapped {
		a.forgetProbe(path)
	}
	a.mu.Unlock()
	if !ok {
		return nil
	}
	slot.closed.Store(true)
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if err := slot.dev.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
		return err
	}
	return nil
}

// OpenFrames returns the sink for an ensured slot.
func (a *v4l2Adapter) OpenFrames(slot Slot) (FrameSink, error) {
	a.mu.Lock()
	state, ok := a.slots[slot.SlotID]
	a.mu.Unlock()
	if !ok || state.closed.Load() {
		return nil, domainError(ErrCodeSlotNotFound, "slot %s has no open %s device; EnsureSlot comes first", slot.SlotID, V4L2LoopbackAdapterID)
	}
	return &v4l2Sink{slot: state}, nil
}

// v4l2Sink writes frames to one slot's device. Closing it ends this sink only:
// the descriptor stays with the slot (see v4l2Slot) so the format survives until
// RemoveSlot. Close does NOT release the device handle.
type v4l2Sink struct {
	slot   *v4l2Slot
	closed atomic.Bool
}

func (k *v4l2Sink) WriteFrame(frame []byte) error {
	if k.closed.Load() {
		return domainError(ErrCodeHandleOpenFailed, "the frame sink for %s is closed", k.slot.path)
	}
	k.slot.mu.Lock()
	defer k.slot.mu.Unlock()
	return k.slot.writeLocked(frame)
}

func (k *v4l2Sink) ShowFallback() error {
	if k.closed.Load() {
		return domainError(ErrCodeHandleOpenFailed, "the frame sink for %s is closed", k.slot.path)
	}
	k.slot.mu.Lock()
	defer k.slot.mu.Unlock()
	return k.slot.writeLocked(blackFrameYUY2(k.slot.sizeImage))
}

func (k *v4l2Sink) Close() error {
	k.closed.Store(true)
	return nil
}
