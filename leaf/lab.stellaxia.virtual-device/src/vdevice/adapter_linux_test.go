//go:build linux

package vdevice

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// fakeV4L2 is a v4l2Device that records the call order and answers ioctls the
// way a loopback node would, with knobs for the cases that go wrong.
type fakeV4L2 struct {
	calls    []string
	caps     v4l2Capability
	adjust   func(*v4l2Format) // applied to the G_FMT answer
	sFmtErr  error
	writes   [][]byte
	writeN   int // when >0, report this many bytes written
	writeErr error
	closeN   int
	lastSFmt v4l2Format
}

func goodCaps() v4l2Capability {
	return v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: v4l2CapVideoOutput | v4l2CapReadWrite}
}

func (f *fakeV4L2) Ioctl(request uintptr, arg unsafe.Pointer) error {
	switch request {
	case vidiocQueryCap:
		f.calls = append(f.calls, "QUERYCAP")
		*(*v4l2Capability)(arg) = f.caps
	case vidiocSFmt:
		f.calls = append(f.calls, "S_FMT")
		if f.sFmtErr != nil {
			return f.sFmtErr
		}
		f.lastSFmt = *(*v4l2Format)(arg)
	case vidiocGFmt:
		f.calls = append(f.calls, "G_FMT")
		got := f.lastSFmt
		if f.adjust != nil {
			f.adjust(&got)
		}
		*(*v4l2Format)(arg) = got
	default:
		return syscall.ENOTTY
	}
	return nil
}

func (f *fakeV4L2) WriteOnce(p []byte) (int, error) {
	f.calls = append(f.calls, "write")
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	f.writes = append(f.writes, append([]byte(nil), p...))
	if f.writeN > 0 {
		return f.writeN, nil
	}
	return len(p), nil
}

func (f *fakeV4L2) Close() error {
	f.closeN++
	f.calls = append(f.calls, "close")
	return nil
}

func testAdapter(fake *fakeV4L2) *v4l2Adapter {
	a := newV4L2Adapter(map[string]string{"cam": "/dev/video10", "other": "  "}, func(path string) (v4l2Device, error) {
		return fake, nil
	})
	a.moduleLoaded = func() bool { return true }
	return a
}

var camSlot = Slot{SlotID: "cam", Kind: KindCamera}

func TestEnsureSlotCallOrderAndBlackFrame(t *testing.T) {
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	id, err := a.EnsureSlot(camSlot)
	if err != nil {
		t.Fatal(err)
	}
	if id != "/dev/video10" {
		t.Errorf("os_device_id = %q", id)
	}
	if got := strings.Join(fake.calls, ","); got != "QUERYCAP,S_FMT,G_FMT,write" {
		t.Errorf("call order = %s", got)
	}
	if len(fake.writes) != 1 || len(fake.writes[0]) != 614400 || fake.writes[0][0] != 0x10 || fake.writes[0][1] != 0x80 {
		t.Errorf("first write is not one 614400-byte black frame")
	}
	if fake.lastSFmt.Pix.BytesPerLine != 1280 || fake.lastSFmt.Type != v4l2BufTypeOutput {
		t.Errorf("S_FMT request %+v", fake.lastSFmt)
	}
}

func TestEnsureSlotTwiceIsAnUpdate(t *testing.T) {
	opens := 0
	fake := &fakeV4L2{caps: goodCaps()}
	a := newV4L2Adapter(map[string]string{"cam": "/dev/video10"}, func(string) (v4l2Device, error) {
		opens++
		return fake, nil
	})
	first, _ := a.EnsureSlot(camSlot)
	second, err := a.EnsureSlot(camSlot)
	if err != nil || first != second {
		t.Fatalf("second EnsureSlot = %q, %v", second, err)
	}
	if opens != 1 {
		t.Errorf("device opened %d times; an update must reuse the handle", opens)
	}
}

func TestEnsureSlotRefusals(t *testing.T) {
	t.Run("no mapping", func(t *testing.T) {
		a := testAdapter(&fakeV4L2{caps: goodCaps()})
		_, err := a.EnsureSlot(Slot{SlotID: "unmapped", Kind: KindCamera})
		assertCode(t, err, ErrCodeAdapterUnavailable, "unmapped")
	})
	t.Run("capture only node", func(t *testing.T) {
		fake := &fakeV4L2{caps: v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: 0x1 | v4l2CapReadWrite}}
		_, err := testAdapter(fake).EnsureSlot(camSlot)
		assertCode(t, err, ErrCodeAdapterUnavailable, "VIDEO_OUTPUT")
		if fake.closeN != 1 {
			t.Errorf("handle not closed after refusal")
		}
	})
	t.Run("no readwrite", func(t *testing.T) {
		fake := &fakeV4L2{caps: v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: v4l2CapVideoOutput}}
		_, err := testAdapter(fake).EnsureSlot(camSlot)
		assertCode(t, err, ErrCodeAdapterUnavailable, "READWRITE")
	})
	t.Run("S_FMT fails", func(t *testing.T) {
		fake := &fakeV4L2{caps: goodCaps(), sFmtErr: syscall.EBUSY}
		_, err := testAdapter(fake).EnsureSlot(camSlot)
		assertCode(t, err, ErrCodeFormatIncompatible, "S_FMT")
		if fake.closeN != 1 {
			t.Errorf("handle not closed after refusal")
		}
	})
	t.Run("driver adjusts sizeimage", func(t *testing.T) {
		fake := &fakeV4L2{caps: goodCaps(), adjust: func(f *v4l2Format) { f.Pix.SizeImage += 4096 }}
		_, err := testAdapter(fake).EnsureSlot(camSlot)
		assertCode(t, err, ErrCodeFormatIncompatible, "sizeimage")
	})
	t.Run("driver adjusts size", func(t *testing.T) {
		fake := &fakeV4L2{caps: goodCaps(), adjust: func(f *v4l2Format) { f.Pix.Width = 320 }}
		_, err := testAdapter(fake).EnsureSlot(camSlot)
		assertCode(t, err, ErrCodeFormatIncompatible, "adjusted")
	})
	t.Run("not YUY2", func(t *testing.T) {
		_, err := testAdapter(&fakeV4L2{caps: goodCaps()}).EnsureSlot(Slot{SlotID: "cam", AcceptedFormats: []Format{{Width: 640, Height: 480, PixelFormat: "NV12"}}})
		assertCode(t, err, ErrCodeFormatIncompatible, "NV12")
	})
	t.Run("too big for the sink path", func(t *testing.T) {
		_, err := testAdapter(&fakeV4L2{caps: goodCaps()}).EnsureSlot(Slot{SlotID: "cam", AcceptedFormats: []Format{{Width: 1280, Height: 720, PixelFormat: "YUY2"}}})
		assertCode(t, err, ErrCodeFormatIncompatible, "limit")
	})
	t.Run("odd width", func(t *testing.T) {
		_, err := testAdapter(&fakeV4L2{caps: goodCaps()}).EnsureSlot(Slot{SlotID: "cam", AcceptedFormats: []Format{{Width: 641, Height: 480, PixelFormat: "YUY2"}}})
		assertCode(t, err, ErrCodeFormatIncompatible, "even")
	})
}

func assertCode(t *testing.T, err error, code, contains string) {
	t.Helper()
	var de *DomainError
	if !errors.As(err, &de) {
		t.Fatalf("err = %v, want a DomainError %s", err, code)
	}
	if de.Code != code {
		t.Errorf("code = %s, want %s (%s)", de.Code, code, de.Message)
	}
	if !strings.Contains(de.Message, contains) {
		t.Errorf("message %q does not mention %q", de.Message, contains)
	}
}

func TestOpenErrorsAreDistinguished(t *testing.T) {
	cases := []struct {
		what   string
		err    error
		loaded bool
		code   string
		text   string
	}{
		{"module missing", os.ErrNotExist, false, ErrCodeAdapterUnavailable, "not loaded"},
		{"node missing", os.ErrNotExist, true, ErrCodeAdapterUnavailable, "video_nr"},
		{"permission", os.ErrPermission, true, ErrCodeOSPermissionDenied, "video group"},
		{"busy", syscall.EBUSY, true, ErrCodeHandleOpenFailed, "busy"},
	}
	for _, tc := range cases {
		a := newV4L2Adapter(map[string]string{"cam": "/dev/video10"}, func(string) (v4l2Device, error) { return nil, tc.err })
		loaded := tc.loaded
		a.moduleLoaded = func() bool { return loaded }
		_, err := a.EnsureSlot(camSlot)
		t.Run(tc.what, func(t *testing.T) {
			assertCode(t, err, tc.code, tc.text)
			d := a.Describe()
			if d.InstallState != StateNotInstalled || !strings.Contains(d.Detail, tc.text) {
				t.Errorf("Describe = %s %q", d.InstallState, d.Detail)
			}
		})
	}
}

func TestDescribe(t *testing.T) {
	t.Run("nothing mapped", func(t *testing.T) {
		d := newV4L2Adapter(nil, nil).Describe()
		if d.InstallState != StateNotInstalled || d.Simulated || d.AdapterID != "linux.v4l2loopback" || d.Detail == "" {
			t.Errorf("%+v", d)
		}
	})
	t.Run("probe passes", func(t *testing.T) {
		fake := &fakeV4L2{caps: goodCaps()}
		d := testAdapter(fake).Describe()
		if d.InstallState != StateReady || d.Health != "ok" || d.Simulated {
			t.Errorf("%+v", d)
		}
		if len(d.SupportedFormats) != 1 || d.SupportedFormats[0] != (Format{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"}) {
			t.Errorf("formats %+v", d.SupportedFormats)
		}
		if strings.Join(fake.calls, ",") != "QUERYCAP,close" {
			t.Errorf("probe calls %v: it must only query and release", fake.calls)
		}
	})
	t.Run("not a v4l2 device", func(t *testing.T) {
		a := newV4L2Adapter(map[string]string{"cam": "/dev/null"}, func(string) (v4l2Device, error) { return &fakeV4L2{caps: goodCaps()}, nil })
		a.open = func(string) (v4l2Device, error) { return &noQueryCap{}, nil }
		d := a.Describe()
		if d.InstallState != StateNotInstalled || !strings.Contains(d.Detail, "not a V4L2 device") {
			t.Errorf("%+v", d)
		}
	})
	t.Run("ready while the slot is held", func(t *testing.T) {
		fake := &fakeV4L2{caps: goodCaps()}
		a := testAdapter(fake)
		a.EnsureSlot(camSlot)
		fake.caps = v4l2Capability{} // a second QUERYCAP would now fail
		if d := a.Describe(); d.InstallState != StateReady {
			t.Errorf("%+v", d)
		}
	})
}

type noQueryCap struct{ fakeV4L2 }

func (*noQueryCap) Ioctl(uintptr, unsafe.Pointer) error { return syscall.ENOTTY }

func TestSinkWritesOneFramePerCall(t *testing.T) {
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	a.EnsureSlot(camSlot)
	sink, err := a.OpenFrames(camSlot)
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 614400)
	frame[0] = 7
	if err := sink.WriteFrame(frame); err != nil {
		t.Fatal(err)
	}
	if n := len(fake.writes); n != 2 || fake.writes[1][0] != 7 {
		t.Errorf("writes = %d", n)
	}
	if err := sink.WriteFrame(frame[:100]); err == nil {
		t.Error("short frame accepted")
	} else {
		assertCode(t, err, ErrCodeFrameInvalid, "614400")
	}
	if len(fake.writes) != 2 {
		t.Errorf("a refused frame reached the device")
	}
	if err := sink.ShowFallback(); err != nil || len(fake.writes) != 3 || fake.writes[2][0] != 0x10 {
		t.Errorf("ShowFallback: %v, writes=%d", err, len(fake.writes))
	}
}

func TestSinkUsesTheDriversSizeImage(t *testing.T) {
	// A driver that reports a padded-but-consistent answer is still refused at
	// EnsureSlot (see TestEnsureSlotRefusals), so the size the sink uses is the
	// G_FMT one and equals the request here; this pins that the sink follows the
	// stored G_FMT value, not a recomputation.
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	a.EnsureSlot(camSlot)
	a.mu.Lock()
	a.slots["cam"].sizeImage = 8
	a.mu.Unlock()
	sink, _ := a.OpenFrames(camSlot)
	if err := sink.WriteFrame(make([]byte, 8)); err != nil {
		t.Errorf("frame of the stored sizeimage refused: %v", err)
	}
	if err := sink.WriteFrame(make([]byte, 614400)); err == nil {
		t.Error("frame of the requested size accepted although G_FMT said otherwise")
	}
}

func TestSinkWriteFailures(t *testing.T) {
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	a.EnsureSlot(camSlot)
	sink, _ := a.OpenFrames(camSlot)
	frame := make([]byte, 614400)

	fake.writeN = 1000
	assertCode(t, sink.WriteFrame(frame), ErrCodeHandleOpenFailed, "short write")
	fake.writeN = 0
	fake.writeErr = syscall.EAGAIN
	assertCode(t, sink.WriteFrame(frame), ErrCodeHandleOpenFailed, "write to")
}

func TestSinkCloseAndRemoveSlot(t *testing.T) {
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	a.EnsureSlot(camSlot)
	sink, _ := a.OpenFrames(camSlot)
	frame := make([]byte, 614400)

	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}
	if err := sink.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
	if err := sink.WriteFrame(frame); err == nil {
		t.Error("write after sink Close succeeded")
	}
	if err := sink.ShowFallback(); err == nil {
		t.Error("fallback after sink Close succeeded")
	}
	if fake.closeN != 0 {
		t.Error("sink Close released the slot's descriptor")
	}
	// A new sink for the same slot still works: the handle stayed.
	sink2, err := a.OpenFrames(camSlot)
	if err != nil || sink2.WriteFrame(frame) != nil {
		t.Errorf("second sink: %v", err)
	}

	if err := a.RemoveSlot("cam"); err != nil {
		t.Fatal(err)
	}
	if err := a.RemoveSlot("cam"); err != nil {
		t.Errorf("RemoveSlot is not idempotent: %v", err)
	}
	if err := a.RemoveSlot("never-seen"); err != nil {
		t.Errorf("RemoveSlot of an unknown slot: %v", err)
	}
	if fake.closeN != 1 {
		t.Errorf("descriptor closed %d times", fake.closeN)
	}
	if err := sink2.WriteFrame(frame); err == nil {
		t.Error("write after RemoveSlot succeeded")
	}
	if _, err := a.OpenFrames(camSlot); err == nil {
		t.Error("OpenFrames after RemoveSlot succeeded")
	} else {
		assertCode(t, err, ErrCodeSlotNotFound, "EnsureSlot")
	}
}

func TestOpenFramesBeforeEnsure(t *testing.T) {
	_, err := testAdapter(&fakeV4L2{caps: goodCaps()}).OpenFrames(camSlot)
	assertCode(t, err, ErrCodeSlotNotFound, "EnsureSlot")
}

// TestRealFileWriteOnce exercises the real v4l2File write path against an
// ordinary file: one call, whole buffer, and a closed file is an error.
func TestRealFileWriteOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "frames")
	dev, err := openV4L2File(path)
	if err == nil {
		dev.Close()
		t.Fatal("openV4L2File created a missing node; it must not")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v", err)
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	dev, err = openV4L2File(path)
	if err != nil {
		t.Fatal(err)
	}
	payload := make([]byte, 614400)
	n, err := dev.WriteOnce(payload)
	if err != nil || n != len(payload) {
		t.Fatalf("WriteOnce = %d, %v", n, err)
	}
	// An ioctl on a regular file is refused with ENOTTY: the error path works.
	var caps v4l2Capability
	if err := dev.Ioctl(vidiocQueryCap, unsafe.Pointer(&caps)); !errors.Is(err, syscall.ENOTTY) {
		t.Errorf("ioctl on a regular file = %v, want ENOTTY", err)
	}
	dev.Close()
	if _, err := dev.WriteOnce(payload); err == nil {
		t.Error("write after close succeeded")
	}
	if fi, _ := os.Stat(path); fi.Size() != int64(len(payload)) {
		t.Errorf("file holds %d bytes", fi.Size())
	}
}

// D2: readiness is a per-slot answer. A broken device of one slot neither hides
// behind a working one nor takes it down.
func TestSlotReadyIsPerSlot(t *testing.T) {
	good := &fakeV4L2{caps: goodCaps()}
	bad := &noQueryCap{}
	a := newV4L2Adapter(map[string]string{"cam": "/dev/video10", "bad": "/dev/video11"}, func(path string) (v4l2Device, error) {
		if path == "/dev/video11" {
			return bad, nil
		}
		return good, nil
	})
	if ok, reason := a.SlotReady("cam"); !ok {
		t.Errorf("cam: not ready: %s", reason)
	}
	if ok, reason := a.SlotReady("bad"); ok || !strings.Contains(reason, "not a V4L2 device") {
		t.Errorf("bad: ready=%v reason=%q", ok, reason)
	}
	if ok, reason := a.SlotReady("unmapped"); ok || !strings.Contains(reason, "no /dev/videoN mapping") {
		t.Errorf("unmapped: ready=%v reason=%q", ok, reason)
	}
	d := a.Describe()
	if d.InstallState != StateReady || d.Health != "degraded" || !strings.Contains(d.Detail, "1 of 2") || !strings.Contains(d.Detail, "slot bad") {
		t.Errorf("Describe with one bad device: %s/%s %q", d.InstallState, d.Health, d.Detail)
	}
	var _ SlotReadiness = a
}

// Describe/SlotReady are called from every catalog poll: the probe is cached,
// dropped when the slot is ensured, and never repeated on a held slot.
func TestProbeIsCachedAndNotRepeatedOnAHeldSlot(t *testing.T) {
	opens := 0
	fake := &fakeV4L2{caps: goodCaps()}
	a := newV4L2Adapter(map[string]string{"cam": "/dev/video10"}, func(string) (v4l2Device, error) {
		opens++
		return fake, nil
	})
	clock := time.Unix(1000, 0)
	a.now = func() time.Time { return clock }

	for i := 0; i < 5; i++ {
		a.SlotReady("cam")
		a.Describe()
	}
	if opens != 1 {
		t.Fatalf("10 readiness questions opened the node %d times, want 1", opens)
	}
	clock = clock.Add(probeCacheTTL + time.Millisecond)
	a.SlotReady("cam")
	if opens != 2 {
		t.Errorf("after the TTL the node was opened %d times in all, want 2", opens)
	}

	if _, err := a.EnsureSlot(camSlot); err != nil { // opens: 3 (EnsureSlot's own handle)
		t.Fatal(err)
	}
	before := opens
	for i := 0; i < 5; i++ {
		if ok, _ := a.SlotReady("cam"); !ok {
			t.Fatal("held slot not ready")
		}
		a.Describe()
	}
	if opens != before {
		t.Errorf("a held slot was probed again (%d extra opens)", opens-before)
	}
}

// D3: ensuring the slot again with the format it already has is not an update:
// no S_FMT and, above all, no black frame over a live picture.
func TestEnsureSlotWithTheSameFormatTouchesNothing(t *testing.T) {
	fake := &fakeV4L2{caps: goodCaps()}
	a := testAdapter(fake)
	if _, err := a.EnsureSlot(camSlot); err != nil {
		t.Fatal(err)
	}
	renamed := camSlot
	renamed.DisplayName = "other name"
	before := len(fake.calls)
	if _, err := a.EnsureSlot(renamed); err != nil {
		t.Fatal(err)
	}
	if len(fake.calls) != before {
		t.Errorf("an idempotent EnsureSlot made calls: %v", fake.calls[before:])
	}
	// A real change still re-applies the format and blacks the picture once.
	resized := camSlot
	resized.AcceptedFormats = []Format{{Width: 320, Height: 240, FPS: 30, PixelFormat: "YUY2"}}
	if _, err := a.EnsureSlot(resized); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(fake.calls[before:], ","); got != "S_FMT,G_FMT,write" {
		t.Errorf("a real format change made calls %s", got)
	}
}

func TestCapabilityNameMatchesTheFake(t *testing.T) {
	caps := map[string]bool{}
	for _, c := range newV4L2Adapter(nil, nil).Describe().Capabilities {
		caps[c] = true
	}
	for _, c := range NewFakeAdapter().Describe().Capabilities {
		if !caps[c] {
			t.Errorf("fake advertises %q, v4l2 does not", c)
		}
	}
}
