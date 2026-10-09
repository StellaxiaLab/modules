//go:build linux

package weave

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
)

// The Linux injection backend: evdev's writing half, uinput.
//
// D-12 fixed this as the single Linux path. There is no X11 branch and no
// Wayland branch because uinput sits UNDER both — it asks the kernel to create
// an input device, and every display server reads the device the same way it
// reads a real mouse. The alternative (a portal, libei) is compositor- and
// version-dependent and buys nothing this milestone needs.
//
// Two properties of that choice are load-bearing elsewhere:
//
//   - The device dies with the file descriptor. When the process exits for any
//     reason the kernel unregisters the device and synthesises a release for
//     every button still down. That is D-22's fifth escape layer, and it costs
//     nothing to have.
//   - The device is indistinguishable from hardware once created. It appears in
//     /proc/bus/input/devices with the same fields as a real mouse, which is
//     why the identity below is stamped: io.terra.io-inventory enumerates the
//     same file and would otherwise publish this node's copy of another node's
//     mouse as this node's own device (G-27).

// uinputDeviceName is what the kernel will call the device. It names Terra and
// the module so a person reading `lsinput` or /proc/bus/input/devices on a node
// can tell where it came from without knowing this code exists.
const uinputDeviceName = "Terra io-weave projected pointer"

// uinputMaxNameSize is UINPUT_MAX_NAME_SIZE from linux/uinput.h.
const uinputMaxNameSize = 80

// Linux ioctl encoding (asm-generic/ioctl.h). Written out rather than
// hard-coded as hex so the numbers can be checked against the header they come
// from instead of trusted.
const (
	iocNone  uintptr = 0
	iocWrite uintptr = 1
	iocRead  uintptr = 2

	uinputIOCTLBase uintptr = 'U'
)

func ioc(direction, typ, number, size uintptr) uintptr {
	return direction<<30 | size<<16 | typ<<8 | number
}

// Event types and codes (linux/input-event-codes.h). Only the ones this device
// declares are named.
const (
	evSyn = 0x00
	evKey = 0x01
	evRel = 0x02
	evAbs = 0x03

	synReport = 0x00

	relHWheel = 0x06
	relWheel  = 0x08

	absX = 0x00
	absY = 0x01

	btnLeft   = 0x110
	btnRight  = 0x111
	btnMiddle = 0x112
)

// inputID is struct input_id: the identity the kernel reports for the device.
type inputID struct {
	BusType uint16
	Vendor  uint16
	Product uint16
	Version uint16
}

// uinputSetup is struct uinput_setup.
type uinputSetup struct {
	ID           inputID
	Name         [uinputMaxNameSize]byte
	FFEffectsMax uint32
}

// inputAbsInfo is struct input_absinfo.
type inputAbsInfo struct {
	Value      int32
	Minimum    int32
	Maximum    int32
	Fuzz       int32
	Flat       int32
	Resolution int32
}

// uinputAbsSetup is struct uinput_abs_setup. The unnamed padding is the
// kernel's: the struct declares a __u16 code followed by a 4-byte-aligned
// input_absinfo, so a Go struct without it would be two bytes short and every
// axis would be set up from the wrong offset.
type uinputAbsSetup struct {
	Code    uint16
	_       uint16
	AbsInfo inputAbsInfo
}

// inputEvent is struct input_event. The kernel overwrites Time on the way in,
// so it is sent zeroed; the field is still declared because its width is part
// of the layout.
type inputEvent struct {
	Time  syscall.Timeval
	Type  uint16
	Code  uint16
	Value int32
}

var (
	uiDevCreate  = ioc(iocNone, uinputIOCTLBase, 1, 0)
	uiDevDestroy = ioc(iocNone, uinputIOCTLBase, 2, 0)
	uiDevSetup   = ioc(iocWrite, uinputIOCTLBase, 3, unsafe.Sizeof(uinputSetup{}))
	uiAbsSetup   = ioc(iocWrite, uinputIOCTLBase, 4, unsafe.Sizeof(uinputAbsSetup{}))
	uiSetEvBit   = ioc(iocWrite, uinputIOCTLBase, 100, unsafe.Sizeof(int32(0)))
	uiSetKeyBit  = ioc(iocWrite, uinputIOCTLBase, 101, unsafe.Sizeof(int32(0)))
	uiSetRelBit  = ioc(iocWrite, uinputIOCTLBase, 102, unsafe.Sizeof(int32(0)))
	uiSetAbsBit  = ioc(iocWrite, uinputIOCTLBase, 103, unsafe.Sizeof(int32(0)))
)

// uiGetSysname asks the kernel what it named the device in sysfs. The length
// is part of the request number, so it cannot be a constant.
func uiGetSysname(size uintptr) uintptr {
	return ioc(iocRead, uinputIOCTLBase, 44, size)
}

// pointerButtonCodes maps the wire's button names to the kernel's codes.
//
// The wire carries names rather than numbers precisely so the two ends cannot
// disagree silently (protocol.PointerButton), and this is the one place the
// name becomes a number on this side.
var pointerButtonCodes = map[protocol.PointerButton]uint16{
	protocol.PointerButtonLeft:   btnLeft,
	protocol.PointerButtonRight:  btnRight,
	protocol.PointerButtonMiddle: btnMiddle,
}

// uinputPointer is one created virtual pointer.
type uinputPointer struct {
	file    *os.File
	sysfs   string
	sysname string

	// closed is checked and set without the write mutex on purpose. The
	// watchdog has to be able to tear this down while a write is stuck, which
	// is the whole point of D-22's fourth layer, so it must never wait on a
	// lock the stuck writer holds.
	closed atomic.Bool

	// mu serialises event batches. A batch is a run of events terminated by
	// SYN_REPORT and the kernel reads it as one state change, so two
	// interleaved batches would produce a state neither caller asked for.
	mu   sync.Mutex
	held map[protocol.PointerButton]bool
}

// newUinputPointer creates the node's virtual pointer.
//
// It is an ABSOLUTE pointing device. Relative deltas were measured and
// rejected (§8.8, protocol.PointerPosition): acceleration sits in the path, so
// a delta is not a distance and two machines would drift apart for as long as
// the session lasted. An absolute axis spanning the whole normalized range is
// the same thing the wire already carries, so the conversion here is an
// assignment rather than a policy.
func newUinputPointer() (*uinputPointer, error) {
	file, err := os.OpenFile(uinputDevice, os.O_WRONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", uinputDevice, err)
	}
	device := &uinputPointer{file: file, held: map[protocol.PointerButton]bool{}}
	if err := device.configure(); err != nil {
		_ = file.Close()
		return nil, err
	}
	return device, nil
}

func (d *uinputPointer) configure() error {
	bits := []struct {
		request uintptr
		value   int32
		what    string
	}{
		{uiSetEvBit, evKey, "EV_KEY"},
		{uiSetEvBit, evAbs, "EV_ABS"},
		{uiSetEvBit, evRel, "EV_REL"},
		{uiSetKeyBit, btnLeft, "BTN_LEFT"},
		{uiSetKeyBit, btnRight, "BTN_RIGHT"},
		{uiSetKeyBit, btnMiddle, "BTN_MIDDLE"},
		{uiSetAbsBit, absX, "ABS_X"},
		{uiSetAbsBit, absY, "ABS_Y"},
		{uiSetRelBit, relWheel, "REL_WHEEL"},
		{uiSetRelBit, relHWheel, "REL_HWHEEL"},
	}
	for _, bit := range bits {
		if err := d.ioctl(bit.request, uintptr(bit.value)); err != nil {
			return fmt.Errorf("enable %s on %s: %w", bit.what, uinputDevice, err)
		}
	}

	// The axis range is the wire's range. A device that declared a screen's
	// pixel range instead would have to be recreated whenever the display
	// changed, and would be wrong on every node with a different one.
	for _, axis := range []struct {
		code uint16
		what string
	}{{absX, "ABS_X"}, {absY, "ABS_Y"}} {
		setup := uinputAbsSetup{
			Code:    axis.code,
			AbsInfo: inputAbsInfo{Minimum: 0, Maximum: protocol.PointerPositionMax},
		}
		if err := d.ioctl(uiAbsSetup, uintptr(unsafe.Pointer(&setup))); err != nil {
			return fmt.Errorf("set up %s range on %s: %w", axis.what, uinputDevice, err)
		}
	}

	setup := pointerDeviceSetup()
	if err := d.ioctl(uiDevSetup, uintptr(unsafe.Pointer(&setup))); err != nil {
		return fmt.Errorf("stamp the virtual pointer's identity on %s: %w", uinputDevice, err)
	}
	if err := d.ioctl(uiDevCreate, 0); err != nil {
		return fmt.Errorf("create the virtual pointer on %s: %w", uinputDevice, err)
	}
	d.sysname, d.sysfs = d.locate()
	return nil
}

// pointerDeviceSetup is the identity the kernel will report for this device.
//
// The reserved bus/vendor/product triple (protocol.VirtualInput*) is the whole
// of what separates one of Terra's own projections from hardware on the
// enumerating side. Without it io.terra.io-inventory reads this device out of
// /proc/bus/input/devices as one of THIS node's own, publishes it as this
// node's SVI resource, and node C subscribes to node B's copy of node A's
// mouse — the loop G-27 closed. So this is not a label and not a nicety: it is
// the device's identity line, and it is built in one function so that a test
// can ask what will be stamped without a kernel to stamp it into.
func pointerDeviceSetup() uinputSetup {
	setup := uinputSetup{ID: inputID{
		BusType: protocol.VirtualInputBus,
		Vendor:  protocol.VirtualInputVendor,
		Product: protocol.VirtualInputProduct,
		Version: 1,
	}}
	copy(setup.Name[:uinputMaxNameSize-1], uinputDeviceName)
	return setup
}

// locate asks the kernel where it put the device.
//
// Reported rather than assumed. The sysfs path is half of what separates one
// of Terra's own projections from hardware (protocol.IsTerraVirtualInput), and
// a node that cannot say where its device landed cannot be checked against
// that filter by anything but faith. An empty answer is left empty for the
// same reason: not knowing and being at the root are different.
func (d *uinputPointer) locate() (string, string) {
	raw := make([]byte, 64)
	if err := d.ioctl(uiGetSysname(uintptr(len(raw))), uintptr(unsafe.Pointer(&raw[0]))); err != nil {
		return "", ""
	}
	sysname := strings.TrimRight(string(raw), "\x00")
	if sysname == "" {
		return "", ""
	}
	// The class symlink appears asynchronously: UI_DEV_CREATE returns before
	// the device is registered everywhere it will be visible. A short bounded
	// wait is the difference between "no path" and "the path was not there
	// yet", and the two must not look alike.
	deadline := time.Now().Add(500 * time.Millisecond)
	for {
		resolved, err := filepath.EvalSymlinks(filepath.Join("/sys/class/input", sysname))
		if err == nil {
			return sysname, strings.TrimPrefix(resolved, "/sys")
		}
		if !errors.Is(err, os.ErrNotExist) || time.Now().After(deadline) {
			return sysname, ""
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Pointer places the pointer and reconciles its buttons and wheel.
//
// Buttons arrive as the full held set rather than a change (protocol.Pointer
// Event.Buttons), so the diff is taken here: a sink that missed a frame still
// ends in the state the source is in, which is what a QoS of realtime-latest
// requires of the receiving end.
func (d *uinputPointer) Pointer(event protocol.PointerEvent) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed.Load() {
		return errInjectionClosed
	}

	batch := make([]inputEvent, 0, 8)
	batch = append(batch,
		inputEvent{Type: evAbs, Code: absX, Value: int32(event.Position.X)},
		inputEvent{Type: evAbs, Code: absY, Value: int32(event.Position.Y)},
	)

	wanted := make(map[protocol.PointerButton]bool, len(event.Buttons))
	for _, button := range event.Buttons {
		wanted[button] = true
	}
	for button, code := range pointerButtonCodes {
		switch {
		case wanted[button] && !d.held[button]:
			batch = append(batch, inputEvent{Type: evKey, Code: code, Value: 1})
		case !wanted[button] && d.held[button]:
			batch = append(batch, inputEvent{Type: evKey, Code: code, Value: 0})
		default:
			continue
		}
		d.held[button] = wanted[button]
	}

	if event.ScrollY != 0 {
		batch = append(batch, inputEvent{Type: evRel, Code: relWheel, Value: event.ScrollY})
	}
	if event.ScrollX != 0 {
		batch = append(batch, inputEvent{Type: evRel, Code: relHWheel, Value: event.ScrollX})
	}
	return d.emit(batch)
}

// Release drops every button this device is holding.
//
// Called on the orderly path only. The disorderly one is covered by the kernel:
// unregistering an input device synthesises a release for each key still down,
// so a crash or a watchdog teardown cannot leave a button pressed either.
func (d *uinputPointer) Release() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed.Load() {
		return nil
	}
	batch := make([]inputEvent, 0, len(d.held))
	for button, down := range d.held {
		if !down {
			continue
		}
		batch = append(batch, inputEvent{Type: evKey, Code: pointerButtonCodes[button], Value: 0})
		d.held[button] = false
	}
	if len(batch) == 0 {
		return nil
	}
	return d.emit(batch)
}

// emit writes one batch and terminates it with SYN_REPORT. Callers hold mu.
func (d *uinputPointer) emit(batch []inputEvent) error {
	batch = append(batch, inputEvent{Type: evSyn, Code: synReport})
	size := int(unsafe.Sizeof(inputEvent{}))
	encoded := make([]byte, 0, len(batch)*size)
	for i := range batch {
		encoded = append(encoded, unsafe.Slice((*byte)(unsafe.Pointer(&batch[i])), size)...)
	}
	if _, err := d.file.Write(encoded); err != nil {
		if errors.Is(err, os.ErrClosed) {
			return errInjectionClosed
		}
		return fmt.Errorf("write to the virtual pointer: %w", err)
	}
	return nil
}

// Close destroys the device.
//
// Safe to call while a write is in flight, and deliberately so: the watchdog
// calls it without the write mutex. Closing the file is the guarantee — the
// kernel unregisters the device when the last descriptor goes — and
// UI_DEV_DESTROY is only the tidy way of getting there, so its failure is not
// reported.
func (d *uinputPointer) Close() error {
	if d.closed.Swap(true) {
		return nil
	}
	_ = d.ioctl(uiDevDestroy, 0)
	if err := d.file.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
		return fmt.Errorf("close the virtual pointer: %w", err)
	}
	return nil
}

// Describe names what was created, for the state a person reads.
func (d *uinputPointer) Describe() string {
	description := "uinput device " + strconv.Quote(uinputDeviceName)
	if d.sysname != "" {
		description += " (" + d.sysname
		if d.sysfs != "" {
			description += " at " + d.sysfs
		}
		description += ")"
	}
	return description
}

// SysfsPath is where the kernel put the device, or empty when it would not say.
func (d *uinputPointer) SysfsPath() string { return d.sysfs }

// ioctl issues one request against the device.
//
// It goes through SyscallConn rather than File.Fd(): Fd() takes the descriptor
// out of the runtime's poller and makes it blocking, which would turn a stuck
// write into a stuck goroutine the watchdog cannot reach through Close.
func (d *uinputPointer) ioctl(request, argument uintptr) error {
	connection, err := d.file.SyscallConn()
	if err != nil {
		return err
	}
	var errno syscall.Errno
	if err := connection.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, request, argument)
	}); err != nil {
		return err
	}
	if errno != 0 {
		return errno
	}
	return nil
}
