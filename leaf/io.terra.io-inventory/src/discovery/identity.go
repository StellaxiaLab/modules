package discovery

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

// Persistent device identity.
//
// The first release hashed the operating system's own key — on Linux the sysfs
// path, on Windows the device instance ID. That key answers "where is this
// device attached", and the two questions only look alike while nothing moves.
// A Linux sysfs path ends in the kernel's global input index (`input5`) and
// carries the HID enumeration counter above it, so **every reboot renamed every
// device**; a Windows instance ID survives a reboot but not a different port.
// Either way the node re-registered known hardware as a new device, and the
// approval and alias a person had set stayed behind on an id nothing would
// answer to again — the exact loss Sync's missing-not-deleted rule exists to
// prevent, arriving through the other door.
//
// So identity now rests on what the device says about *itself*, and the OS key
// is only the last resort.

// Identity is a device's own account of itself, separate from where it is
// attached. Each adapter fills in what its platform can say; empty fields are
// "this platform did not tell us", never "the device has none" — which is why
// the tiers below step down rather than guess.
type Identity struct {
	// Bus is the transport the device is attached through: the Linux `Bus=`
	// code, the Windows enumerator (HID, USB, ACPI, BTHENUM).
	Bus string
	// Vendor and Product are the USB/HID ids as four hex digits. PS/2 and
	// platform devices report zeros or nothing at all.
	Vendor  string
	Product string
	// Serial is the device's own serial number — Linux `U: Uniq=`, the Windows
	// instance segment when the bus driver read one off the device. It is the
	// only field that survives being moved to another port.
	Serial string
	// Interface distinguishes the several logical devices one piece of hardware
	// exposes: a wireless receiver is a keyboard on one interface and a mouse
	// on another, and both report the same serial. Without this they would be
	// one identity and neither could keep it.
	Interface string
	// Location is where the device is attached — the Linux `P: Phys=` path, the
	// Windows bus-generated instance segment. It survives a reboot but not a
	// move to another port, so it ranks below Serial.
	Location string
}

// identityTier names the evidence an id rests on. It is recorded per scan so an
// operator can tell a device whose id will survive a re-plug from one whose id
// only survives a reboot — "stable" and "stable so far" are different promises.
type identityTier string

const (
	// tierSerial — vendor, product, interface and the device's own serial.
	// Survives a reboot and a move to another port.
	tierSerial identityTier = "serial"
	// tierLocation — the same model fields plus where it is attached. Survives
	// a reboot; a move to another port makes it a new device.
	tierLocation identityTier = "location"
	// tierPath — the raw OS key, which is what the first release used for
	// everything. Kept for devices that say nothing about themselves, so they
	// still get an id rather than being dropped.
	tierPath identityTier = "path"
)

type identityCandidate struct {
	tier identityTier
	key  string
}

// identityCandidates lists the keys one device's id may rest on, strongest
// first. A tier is offered only when the platform actually filled it in.
func identityCandidates(entry Found) []identityCandidate {
	model := identityModel(entry.Identity)
	list := make([]identityCandidate, 0, 3)
	if serial := identityToken(entry.Identity.Serial); serial != "" {
		list = append(list, identityCandidate{tier: tierSerial, key: "serial|" + model + "|" + serial})
	}
	if location := identityToken(entry.Identity.Location); location != "" {
		list = append(list, identityCandidate{tier: tierLocation, key: "location|" + model + "|" + location})
	}
	return append(list, identityCandidate{tier: tierPath, key: "path|" + identityToken(entry.Key)})
}

// identityModel is the part of the key that says what the device is, shared by
// the serial and location tiers so the two answer the same question about the
// same hardware.
func identityModel(identity Identity) string {
	return strings.Join([]string{
		identityToken(identity.Bus),
		identityToken(identity.Vendor),
		identityToken(identity.Product),
		identityToken(identity.Interface),
	}, "|")
}

// identityToken normalizes one field before it reaches a digest. Upper-casing
// is not cosmetic: Windows instance IDs are case-insensitive and the case they
// are reported in is not guaranteed stable, so the same device read twice would
// otherwise hash to two ids.
func identityToken(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

// assignIdentity picks the strongest tier this device may keep to itself.
//
// `taken` counts how many devices of the same kind produced each tier key. A
// key two devices produce is not an identity — two identical keyboards with the
// same blank serial say the same thing about themselves — so both step down to
// the next tier rather than one of them winning. Deciding it by count instead
// of by who was enumerated first is what keeps the outcome the same across
// reboots, when the enumeration order is not.
func assignIdentity(kind inventory.DeviceKind, entry Found, taken map[string]int) (string, identityTier) {
	candidates := identityCandidates(entry)
	for _, candidate := range candidates {
		if taken[string(kind)+"\x00"+candidate.key] == 1 {
			return deviceID(kind, entry, candidate.key), candidate.tier
		}
	}
	// Every tier was shared, which the path tier can only reach if two entries
	// carried the same OS key — devicesFrom collapses those before it gets
	// here. Answering with the path id anyway keeps the device in the list.
	last := candidates[len(candidates)-1]
	return deviceID(kind, entry, last.key), last.tier
}

// countIdentityCandidates tallies every tier key the batch produces, so
// assignIdentity can tell a key that belongs to one device from one that two
// devices share.
func countIdentityCandidates(entries []Found, kinds []inventory.DeviceKind) map[string]int {
	taken := make(map[string]int, len(entries)*3)
	for index, entry := range entries {
		for _, candidate := range identityCandidates(entry) {
			taken[string(kinds[index])+"\x00"+candidate.key]++
		}
	}
	return taken
}

// vendorProductPattern picks the USB vendor and product out of an OS key such
// as `HID\VID_046D&PID_C534&MI_01\8&1e0f24a1&0&0000`. Keys without one — PS/2
// and Bluetooth devices — simply do not match. The adapters fill Identity in
// directly now; this remains for legacyDeviceID, which has to keep reproducing
// exactly what the first release wrote.
var vendorProductPattern = regexp.MustCompile(`(?i)VID[_&]([0-9A-F]{4}).*?PID[_&]([0-9A-F]{4})`)

// deviceID renders the id a person reads and the SVI ResourceID carries.
//
// Identity rests entirely on the digest of the tier key: the id must not
// contain a path separator (Registry.Register rejects those and OS keys are
// full of them) and it becomes an SVI ResourceID suffix (SVI-P0-003). The
// vendor and product pair sits in front of it for the person reading a device
// list — it is decoration, not lookup, and a device that reports zeros for both
// is left without it rather than given a prefix that says nothing.
func deviceID(kind inventory.DeviceKind, entry Found, key string) string {
	digest := sha256.Sum256([]byte(key))
	suffix := hex.EncodeToString(digest[:4])
	vendor, product := entry.Identity.Vendor, entry.Identity.Product
	if vendor == "" || product == "" {
		if match := vendorProductPattern.FindStringSubmatch(entry.Key); match != nil {
			vendor, product = match[1], match[2]
		}
	}
	if isNamingHex(vendor) && isNamingHex(product) {
		return fmt.Sprintf("%s-%s-%s-%s", kind, strings.ToLower(vendor), strings.ToLower(product), suffix)
	}
	return fmt.Sprintf("%s-%s", kind, suffix)
}

// isNamingHex accepts the vendor/product values worth putting in front of a
// device id. An all-zero vendor is the kernel saying "no USB vendor here", and
// prefixing every ACPI button with `0000-0001` groups unrelated devices under
// one meaningless heading.
func isNamingHex(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || strings.Trim(value, "0") == "" {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune("0123456789abcdefABCDEF", character) {
			return false
		}
	}
	return true
}

// legacyDeviceID reproduces the id derivation that shipped before persistent
// identity: the digest of the OS key alone.
//
// It is not dead code and must not drift. A node that has been running carries
// approvals and aliases stored under these ids, and the first scan after the
// upgrade is the one chance to move that policy onto the new id
// (Registry.AdoptPolicies). Changing what this returns would strand exactly the
// policy the new derivation exists to protect.
func legacyDeviceID(kind inventory.DeviceKind, key string) string {
	digest := sha256.Sum256([]byte(strings.ToUpper(strings.TrimSpace(key))))
	suffix := hex.EncodeToString(digest[:4])
	if match := vendorProductPattern.FindStringSubmatch(key); match != nil {
		return fmt.Sprintf("%s-%s-%s-%s", kind, strings.ToLower(match[1]), strings.ToLower(match[2]), suffix)
	}
	return fmt.Sprintf("%s-%s", kind, suffix)
}
