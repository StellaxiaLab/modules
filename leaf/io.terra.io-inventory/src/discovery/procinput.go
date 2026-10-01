package discovery

import (
	"regexp"
	"strconv"
	"strings"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

// Linux input-device parsing.
//
// This file holds no OS call, only the reading of what Linux says, so the
// classification can be tested from any platform — the same split the package
// doc describes.
//
// The source is /proc/bus/input/devices rather than a walk of /sys/class/input:
// it is one world-readable file that already carries the three things needed —
// the name, the sysfs path that serves as the stable key, and the capability
// bitmaps that say what the device actually is. No root, no libudev, no cgo.
//
// The limit that comes with it: only devices with an input handler appear
// there. A raw HID collection with no evdev node is invisible, which is why a
// Linux scan reports fewer `raw` devices than a Windows scan of the same
// hardware.
//
// The same file is also where a device's persistent identity comes from. The
// `S: Sysfs=` path cannot carry it: it ends in the kernel's global input index,
// which is handed out in enumeration order, so it names a different device
// after every reboot. What survives is on the other lines — `U: Uniq=` when the
// device reports a serial, `P: Phys=` for where it is attached, and the
// vendor/product pair on `I:` for what it is. See identity.go.

// Linux event-type and code numbers (input-event-codes.h). Only the ones the
// classification actually consults are named.
const (
	evKey = 0x01
	evRel = 0x02

	relX = 0x00
	relY = 0x01

	btnLeft = 0x110

	keyEsc   = 1
	keyQ     = 16
	keyA     = 30
	keySpace = 57
)

// parseProcInputDevices turns the file's blocks into found devices. A block is
// a run of lines up to a blank one, and only blocks that carry a name, a sysfs
// path, and a class this package can describe survive.
func parseProcInputDevices(text string) []Found {
	found := make([]Found, 0, 16)
	name := ""
	sysfs := ""
	uniq := ""
	phys := ""
	var vendor, product uint16
	identity := Identity{}
	bitmaps := map[string]string{}

	flush := func() {
		if sysfs != "" && name != "" {
			identity.Serial = uniq
			identity.Location = phys
			identity.Interface = physInterface(phys)
			found = append(found, Found{
				Key: sysfs, Class: classForBitmaps(bitmaps), Name: name,
				Identity:  identity,
				Synthetic: protocol.IsTerraVirtualInput(vendor, product, sysfs),
			})
		}
		name, sysfs, uniq, phys, bitmaps = "", "", "", "", map[string]string{}
		vendor, product = 0, 0
		identity = Identity{}
	}

	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		switch {
		case strings.HasPrefix(line, "N: Name="):
			name = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "N: Name=")), `"`)
		case strings.HasPrefix(line, "I: "):
			// The identity line carries the vendor and product a uinput
			// creator stamps, which is half of what separates one of our own
			// projections from hardware. The other half is the sysfs path.
			// The same three fields are what says which model this is when the
			// device id is derived (identity.go).
			for _, field := range strings.Fields(strings.TrimPrefix(line, "I: ")) {
				key, value, ok := strings.Cut(field, "=")
				if !ok {
					continue
				}
				parsed, err := strconv.ParseUint(value, 16, 16)
				if err != nil {
					continue
				}
				switch key {
				case "Bus":
					identity.Bus = value
				case "Vendor":
					vendor = uint16(parsed)
					identity.Vendor = value
				case "Product":
					product = uint16(parsed)
					identity.Product = value
				}
			}
		case strings.HasPrefix(line, "S: Sysfs="):
			sysfs = strings.TrimSpace(strings.TrimPrefix(line, "S: Sysfs="))
		case strings.HasPrefix(line, "U: Uniq="):
			// The device's own serial, when it reports one. Most do not, and
			// an empty Uniq is the ordinary case rather than a parse failure.
			uniq = strings.TrimSpace(strings.TrimPrefix(line, "U: Uniq="))
		case strings.HasPrefix(line, "P: Phys="):
			phys = strings.TrimSpace(strings.TrimPrefix(line, "P: Phys="))
		case strings.HasPrefix(line, "B: "):
			field := strings.TrimPrefix(line, "B: ")
			if key, value, ok := strings.Cut(field, "="); ok {
				bitmaps[strings.TrimSpace(key)] = strings.TrimSpace(value)
			}
		}
	}
	flush()
	return found
}

// classForBitmaps decides what a device is from what it can emit, which is the
// same evidence udev's input_id builtin uses. The order matters: a device that
// reports relative motion *and* a mouse button is a pointer even when it also
// carries keys, because that is what a mouse with extra buttons looks like.
func classForBitmaps(bitmaps map[string]string) string {
	events := bitmaps["EV"]
	keys := bitmaps["KEY"]
	relative := bitmaps["REL"]

	if bitmapHas(events, evRel) && bitmapHas(relative, relX) && bitmapHas(relative, relY) && bitmapHas(keys, btnLeft) {
		return classMouse
	}
	// A keyboard is a device carrying the ordinary typing keys — not merely one
	// with EV_KEY, which nearly every input device has (a power button has one).
	if bitmapHas(events, evKey) && bitmapHas(keys, keyEsc) && bitmapHas(keys, keyQ) && bitmapHas(keys, keyA) && bitmapHas(keys, keySpace) {
		return classKeyboard
	}
	return classRawInput
}

// bitmapHas reports whether a bit is set in one of the kernel's bitmaps.
//
// The format is space-separated 64-bit hex words, **most significant first**,
// so the last word holds bits 0-63. Reading them right to left is what makes an
// index mean the same thing whatever the bitmap's width.
func bitmapHas(bitmap string, bit uint) bool {
	words := strings.Fields(bitmap)
	index := int(bit / 64)
	if index >= len(words) {
		return false
	}
	word, err := strconv.ParseUint(words[len(words)-1-index], 16, 64)
	if err != nil {
		return false
	}
	return word&(1<<(bit%64)) != 0
}

// physInterfacePattern matches the interface suffix the kernel appends to a
// physical path: `usb-0000:00:14.0-3/input1` is the second interface of the
// device in port 3.
var physInterfacePattern = regexp.MustCompile(`(?i)(^|/)(input[0-9]+)$`)

// physInterface pulls the interface number out of a physical path.
//
// It matters for exactly the devices that need identity most. A wireless
// receiver reports one serial and presents itself as both a keyboard and a
// mouse; without the interface both halves produce the same identity key, the
// key belongs to two devices, and assignIdentity has to drop both to the weaker
// tier. With it they are two identities, and each keeps the serial.
func physInterface(phys string) string {
	match := physInterfacePattern.FindStringSubmatch(strings.TrimSpace(phys))
	if match == nil {
		return ""
	}
	return match[2]
}
