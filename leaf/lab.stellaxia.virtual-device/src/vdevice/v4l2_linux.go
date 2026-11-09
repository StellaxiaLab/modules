//go:build linux

package vdevice

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// V4L2 kernel interface, written out by hand: pure syscall, no cgo, no
// dependency on a V4L2 binding. Only what a loopback *writer* needs is here:
// VIDIOC_QUERYCAP, VIDIOC_S_FMT, VIDIOC_G_FMT, and write(2).
//
// Layouts and request numbers are for 64-bit amd64/arm64 (linux/videodev2.h).
// v4l2_format contains a union that holds pointers in some members, which is
// what puts its payload at offset 8 and makes its size 208 on 64-bit; a 32-bit
// target would differ, and this module does not build for one. The tests pin
// every size, offset and request number against the numbers in the header.

// Linux ioctl encoding (asm-generic/ioctl.h).
const (
	v4l2IocWrite uintptr = 1
	v4l2IocRead  uintptr = 2
)

func v4l2Ioc(direction, typ, number, size uintptr) uintptr {
	return direction<<30 | size<<16 | typ<<8 | number
}

const v4l2IocType uintptr = 'V'

var (
	vidiocQueryCap = v4l2Ioc(v4l2IocRead, v4l2IocType, 0, unsafe.Sizeof(v4l2Capability{}))
	vidiocGFmt     = v4l2Ioc(v4l2IocRead|v4l2IocWrite, v4l2IocType, 4, unsafe.Sizeof(v4l2Format{}))
	vidiocSFmt     = v4l2Ioc(v4l2IocRead|v4l2IocWrite, v4l2IocType, 5, unsafe.Sizeof(v4l2Format{}))
)

const (
	v4l2CapVideoOutput   uint32 = 0x00000002
	v4l2CapReadWrite     uint32 = 0x01000000
	v4l2CapDeviceCaps    uint32 = 0x80000000
	v4l2BufTypeOutput    uint32 = 2
	v4l2PixFmtYUYV       uint32 = 0x56595559 // 'YUYV' little-endian; what Terra calls YUY2
	v4l2FieldNone        uint32 = 1
	v4l2ColorspaceRec709 uint32 = 3
)

// v4l2Capability is struct v4l2_capability (104 bytes).
type v4l2Capability struct {
	Driver       [16]byte
	Card         [32]byte
	BusInfo      [32]byte
	Version      uint32
	Capabilities uint32
	DeviceCaps   uint32
	Reserved     [3]uint32
}

// v4l2PixFormat is struct v4l2_pix_format (48 bytes), the member of the
// v4l2_format union this adapter uses.
type v4l2PixFormat struct {
	Width        uint32
	Height       uint32
	PixelFormat  uint32
	Field        uint32
	BytesPerLine uint32
	SizeImage    uint32
	Colorspace   uint32
	Priv         uint32
	Flags        uint32
	YcbcrEnc     uint32
	Quantization uint32
	XferFunc     uint32
}

// v4l2Format is struct v4l2_format (208 bytes on 64-bit): type, four bytes of
// padding, then a 200-byte union of which Pix is the front.
type v4l2Format struct {
	Type uint32
	_    uint32
	Pix  v4l2PixFormat
	_    [200 - unsafe.Sizeof(v4l2PixFormat{})]byte
}

// yuy2BytesPerPixel: YUY2 packs two pixels into four bytes.
const yuy2BytesPerPixel = 2

// buildOutputFormat is the S_FMT request for a YUY2 output of width x height.
// YUY2 shares one chroma pair between two horizontal pixels, so an odd width has
// no valid frame; it is refused here rather than rounded by the driver.
func buildOutputFormat(width, height int) (v4l2Format, error) {
	if width <= 0 || height <= 0 {
		return v4l2Format{}, fmt.Errorf("frame size %dx%d is not positive", width, height)
	}
	if width%2 != 0 {
		return v4l2Format{}, fmt.Errorf("YUY2 needs an even width, got %d", width)
	}
	return v4l2Format{
		Type: v4l2BufTypeOutput,
		Pix: v4l2PixFormat{
			Width:        uint32(width),
			Height:       uint32(height),
			PixelFormat:  v4l2PixFmtYUYV,
			Field:        v4l2FieldNone,
			BytesPerLine: uint32(width * yuy2BytesPerPixel),
			SizeImage:    uint32(width * height * yuy2BytesPerPixel),
			Colorspace:   v4l2ColorspaceRec709,
		},
	}, nil
}

// effectiveCaps is the capability word that describes this node. The kernel
// sets V4L2_CAP_DEVICE_CAPS in capabilities when device_caps is valid, and on a
// video node device_caps is the one that is about this node rather than the
// whole driver.
func effectiveCaps(c v4l2Capability) uint32 {
	if c.Capabilities&v4l2CapDeviceCaps != 0 {
		return c.DeviceCaps
	}
	return c.Capabilities
}

// checkOutputCaps says why a node cannot be written to, or nil if it can.
//
// v4l2loopback loaded with exclusive_caps=1 shows a node as OUTPUT-only until a
// producer has set a format, and CAPTURE-only afterwards (as far as recalled;
// the live test confirms). So a missing OUTPUT bit before S_FMT usually means
// the module was loaded without exclusive_caps handling, or the node is not a
// loopback node at all, not that it is busy.
func checkOutputCaps(c v4l2Capability) error {
	caps := effectiveCaps(c)
	if caps&v4l2CapVideoOutput == 0 {
		return errors.New("the device does not offer V4L2_CAP_VIDEO_OUTPUT: it is not a v4l2loopback output node " +
			"(a capture-only device, or a loopback node whose producer side is already taken)")
	}
	if caps&v4l2CapReadWrite == 0 {
		return errors.New("the device does not offer V4L2_CAP_READWRITE, so frames cannot be written with write(2)")
	}
	return nil
}

// cString trims a NUL-padded kernel string.
func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// v4l2Device is the handle the adapter drives. It is an interface so the
// ioctl sequence and the write path can be tested without a kernel module.
type v4l2Device interface {
	// Ioctl issues one request; arg points at the request's struct.
	Ioctl(request uintptr, arg unsafe.Pointer) error
	// WriteOnce issues exactly one write(2) and reports what the kernel took. It
	// never loops: a short write is the caller's to see.
	WriteOnce(p []byte) (int, error)
	Close() error
}

// v4l2File is the real device: an *os.File opened O_RDWR|O_NONBLOCK.
type v4l2File struct{ file *os.File }

func openV4L2File(path string) (v4l2Device, error) {
	file, err := os.OpenFile(path, os.O_RDWR|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	return &v4l2File{file: file}, nil
}

// Ioctl goes through SyscallConn rather than File.Fd(): Fd() takes the
// descriptor out of the runtime poller and makes it blocking.
func (d *v4l2File) Ioctl(request uintptr, arg unsafe.Pointer) error {
	connection, err := d.file.SyscallConn()
	if err != nil {
		return err
	}
	var errno syscall.Errno
	if err := connection.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(arg))
	}); err != nil {
		return err
	}
	if errno != 0 {
		return errno
	}
	return nil
}

// WriteOnce uses RawConn.Write with a callback that always reports "done", so
// the runtime never retries it: os.File.Write would loop on a short write and
// turn one frame into several write(2) calls, which on a loopback device is
// several frames.
func (d *v4l2File) WriteOnce(p []byte) (int, error) {
	connection, err := d.file.SyscallConn()
	if err != nil {
		return 0, err
	}
	var (
		n    int
		werr error
	)
	if err := connection.Write(func(fd uintptr) bool {
		n, werr = syscall.Write(int(fd), p)
		return true
	}); err != nil {
		return 0, err
	}
	return n, werr
}

func (d *v4l2File) Close() error { return d.file.Close() }
