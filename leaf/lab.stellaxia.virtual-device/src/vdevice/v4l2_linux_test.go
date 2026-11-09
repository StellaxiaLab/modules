//go:build linux

package vdevice

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

func TestV4L2StructLayoutsMatchTheHeaders(t *testing.T) {
	// linux/videodev2.h on a 64-bit kernel.
	for _, check := range []struct {
		what      string
		got, want uintptr
	}{
		{"struct v4l2_capability", unsafe.Sizeof(v4l2Capability{}), 104},
		{"v4l2_capability.version", unsafe.Offsetof(v4l2Capability{}.Version), 80},
		{"v4l2_capability.capabilities", unsafe.Offsetof(v4l2Capability{}.Capabilities), 84},
		{"v4l2_capability.device_caps", unsafe.Offsetof(v4l2Capability{}.DeviceCaps), 88},
		{"v4l2_capability.reserved", unsafe.Offsetof(v4l2Capability{}.Reserved), 92},
		{"v4l2_capability.card", unsafe.Offsetof(v4l2Capability{}.Card), 16},
		{"v4l2_capability.bus_info", unsafe.Offsetof(v4l2Capability{}.BusInfo), 48},
		{"struct v4l2_pix_format", unsafe.Sizeof(v4l2PixFormat{}), 48},
		{"struct v4l2_format", unsafe.Sizeof(v4l2Format{}), 208},
		{"v4l2_format.pix", unsafe.Offsetof(v4l2Format{}.Pix), 8},
		{"pix.width", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Width), 8},
		{"pix.height", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Height), 12},
		{"pix.pixelformat", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.PixelFormat), 16},
		{"pix.field", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Field), 20},
		{"pix.bytesperline", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.BytesPerLine), 24},
		{"pix.sizeimage", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.SizeImage), 28},
		{"pix.colorspace", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Colorspace), 32},
		{"pix.priv", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Priv), 36},
		{"pix.flags", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Flags), 40},
		{"pix.ycbcr_enc", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.YcbcrEnc), 44},
		{"pix.quantization", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.Quantization), 48},
		{"pix.xfer_func", unsafe.Offsetof(v4l2Format{}.Pix) + unsafe.Offsetof(v4l2PixFormat{}.XferFunc), 52},
	} {
		if check.got != check.want {
			t.Errorf("%s = %d, want %d", check.what, check.got, check.want)
		}
	}
}

func TestV4L2RequestNumbersMatchTheHeaders(t *testing.T) {
	for _, check := range []struct {
		what      string
		got, want uintptr
	}{
		{"VIDIOC_QUERYCAP", vidiocQueryCap, 0x80685600},
		{"VIDIOC_G_FMT", vidiocGFmt, 0xC0D05604},
		{"VIDIOC_S_FMT", vidiocSFmt, 0xC0D05605},
		{"V4L2_CAP_VIDEO_OUTPUT", uintptr(v4l2CapVideoOutput), 0x2},
		{"V4L2_CAP_READWRITE", uintptr(v4l2CapReadWrite), 0x01000000},
		{"V4L2_CAP_DEVICE_CAPS", uintptr(v4l2CapDeviceCaps), 0x80000000},
		{"V4L2_BUF_TYPE_VIDEO_OUTPUT", uintptr(v4l2BufTypeOutput), 2},
		{"V4L2_PIX_FMT_YUYV", uintptr(v4l2PixFmtYUYV), 0x56595559},
		{"V4L2_FIELD_NONE", uintptr(v4l2FieldNone), 1},
	} {
		if check.got != check.want {
			t.Errorf("%s = %#x, want %#x", check.what, check.got, check.want)
		}
	}
	if v4l2PixFmtYUYV != uint32('Y')|uint32('U')<<8|uint32('Y')<<16|uint32('V')<<24 {
		t.Errorf("YUYV is not the fourcc 'YUYV'")
	}
}

func TestBuildOutputFormat(t *testing.T) {
	f, err := buildOutputFormat(640, 480)
	if err != nil {
		t.Fatal(err)
	}
	if f.Type != v4l2BufTypeOutput || f.Pix.Width != 640 || f.Pix.Height != 480 ||
		f.Pix.PixelFormat != v4l2PixFmtYUYV || f.Pix.Field != v4l2FieldNone ||
		f.Pix.BytesPerLine != 1280 || f.Pix.SizeImage != 614400 || f.Pix.Colorspace != v4l2ColorspaceRec709 {
		t.Errorf("unexpected format %+v", f)
	}
	for _, size := range [][2]int{{641, 480}, {0, 480}, {640, 0}, {-2, 4}} {
		if _, err := buildOutputFormat(size[0], size[1]); err == nil {
			t.Errorf("buildOutputFormat(%d,%d) accepted", size[0], size[1])
		}
	}
}

func TestBlackFrameYUY2(t *testing.T) {
	frame := blackFrameYUY2(614400)
	if len(frame) != 614400 {
		t.Fatalf("len %d", len(frame))
	}
	if !bytes.Equal(frame[:8], []byte{0x10, 0x80, 0x10, 0x80, 0x10, 0x80, 0x10, 0x80}) ||
		!bytes.Equal(frame[len(frame)-4:], []byte{0x10, 0x80, 0x10, 0x80}) {
		t.Errorf("pattern wrong: % x ... % x", frame[:8], frame[len(frame)-4:])
	}
}

func TestEffectiveCapsAndOutputCheck(t *testing.T) {
	both := v4l2CapVideoOutput | v4l2CapReadWrite
	cases := []struct {
		what string
		c    v4l2Capability
		ok   bool
	}{
		{"device_caps valid, output+rw", v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: both}, true},
		{"device_caps valid and wins over capabilities", v4l2Capability{Capabilities: v4l2CapDeviceCaps | both, DeviceCaps: 0x1}, false},
		{"device_caps not flagged: capabilities used", v4l2Capability{Capabilities: both, DeviceCaps: 0}, true},
		{"no output bit", v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: v4l2CapReadWrite | 0x1}, false},
		{"no readwrite bit", v4l2Capability{Capabilities: v4l2CapDeviceCaps, DeviceCaps: v4l2CapVideoOutput}, false},
	}
	for _, tc := range cases {
		err := checkOutputCaps(tc.c)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.what, err, tc.ok)
		}
	}
	if err := checkOutputCaps(v4l2Capability{Capabilities: v4l2CapDeviceCaps}); err == nil || !strings.Contains(err.Error(), "VIDEO_OUTPUT") {
		t.Errorf("message does not name the missing capability: %v", err)
	}
}

func TestCString(t *testing.T) {
	if got := cString([]byte("loop\x00junk")); got != "loop" {
		t.Errorf("got %q", got)
	}
	if got := cString([]byte("full")); got != "full" {
		t.Errorf("got %q", got)
	}
}

// requireV4L2Loopback skips unless TERRA_VDEV_TEST_DEVICE names a node this
// process can open. The skip message says which of the three situations it is.
func requireV4L2Loopback(t *testing.T) string {
	t.Helper()
	path := os.Getenv("TERRA_VDEV_TEST_DEVICE")
	if path == "" {
		t.Skipf("TERRA_VDEV_TEST_DEVICE is not set: as root run `modprobe v4l2loopback video_nr=10 exclusive_caps=1`, then TERRA_VDEV_TEST_DEVICE=/dev/video10 go test -run V4L2")
	}
	dev, err := os.OpenFile(path, os.O_RDWR|syscall.O_NONBLOCK, 0)
	switch {
	case errors.Is(err, os.ErrNotExist):
		t.Skipf("%s does not exist: the v4l2loopback module is not loaded or was loaded with another video_nr", path)
	case errors.Is(err, os.ErrPermission):
		t.Skipf("%s: permission denied: add this user to the video group (or run the test as a user that can open it)", path)
	case err != nil:
		t.Skipf("cannot open %s: %v", path, err)
	}
	dev.Close()
	return path
}

// TestV4L2LoopbackLive drives the real kernel module. Every assumption listed
// in adapter_linux.go is settled here, not in the unit tests.
func TestV4L2LoopbackLive(t *testing.T) {
	path := requireV4L2Loopback(t)
	adapter := newV4L2Adapter(map[string]string{"live-cam": path}, openV4L2File)
	if got := adapter.Describe(); got.InstallState != StateReady {
		t.Fatalf("Describe on %s: %s / %s", path, got.InstallState, got.Detail)
	}
	slot := Slot{SlotID: "live-cam", Kind: KindCamera, AcceptedFormats: []Format{{Width: 640, Height: 480, FPS: 30, PixelFormat: "YUY2"}}}
	id, err := adapter.EnsureSlot(slot)
	if err != nil {
		t.Fatalf("EnsureSlot: %v", err)
	}
	if id != path {
		t.Errorf("os_device_id = %q, want %q", id, path)
	}
	defer adapter.RemoveSlot("live-cam")
	sink, err := adapter.OpenFrames(slot)
	if err != nil {
		t.Fatal(err)
	}
	defer sink.Close()
	if err := sink.WriteFrame(make([]byte, 640*480*2)); err != nil {
		t.Errorf("WriteFrame with no reader attached: %v", err)
	}
	if err := sink.ShowFallback(); err != nil {
		t.Errorf("ShowFallback: %v", err)
	}
	if err := sink.WriteFrame(make([]byte, 10)); err == nil {
		t.Errorf("a wrong-sized frame was accepted")
	}
}
