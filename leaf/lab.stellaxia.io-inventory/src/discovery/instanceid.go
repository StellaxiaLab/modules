package discovery

import (
	"regexp"
	"strings"
)

// Windows device instance ID parsing.
//
// Like procinput.go for Linux, this file holds no OS call — only the reading of
// what Windows says — so the derivation that decides a device's persistent id
// is unit-tested on every platform, not only on the one that can produce the
// input. That is the same split IO-7 draws for classification.
//
// An instance ID is three backslash-separated parts:
//
//	HID\VID_046D&PID_C534&MI_01&COL01\8&1e0f24a1&0&0000
//	└ enumerator  └ device id                    └ instance id
//
// The device id says what the hardware is; the instance id says which one. The
// PnP manager writes the device's own serial number there when the bus driver
// could read one, and otherwise a value it generates from the parent's path —
// which is why the two are told apart below rather than both trusted as a
// serial.

var (
	windowsVendorPattern    = regexp.MustCompile(`(?i)\b(?:VID|VEN)[_&]([0-9A-F]{4})`)
	windowsProductPattern   = regexp.MustCompile(`(?i)\b(?:PID|DEV)[_&]([0-9A-F]{4})`)
	windowsInterfacePattern = regexp.MustCompile(`(?i)\b(MI_[0-9A-F]{2}|COL[0-9A-F]{2})`)
)

// parseWindowsInstanceID reads a device instance ID into the identity fields
// that survive a reboot, and says which of them the bus driver actually knew.
func parseWindowsInstanceID(instance string) Identity {
	instance = strings.TrimSpace(instance)
	if instance == "" {
		return Identity{}
	}
	parts := strings.Split(instance, `\`)
	identity := Identity{Bus: strings.TrimSpace(parts[0])}

	device := ""
	if len(parts) > 1 {
		device = parts[1]
	}
	if match := windowsVendorPattern.FindStringSubmatch(device); match != nil {
		identity.Vendor = match[1]
	}
	if match := windowsProductPattern.FindStringSubmatch(device); match != nil {
		identity.Product = match[1]
	}
	// A composite device exposes several interfaces (MI_) and a HID device
	// several top-level collections (COL). Both belong to identity: one
	// receiver is a keyboard on one and a mouse on another, and they report the
	// same serial.
	identity.Interface = strings.Join(windowsInterfacePattern.FindAllString(device, -1), "+")
	if identity.Vendor == "" && identity.Product == "" {
		// ACPI\PNP0303, ROOT\SYSTEM and friends carry no vendor/product pair;
		// the hardware id itself is what says what they are.
		identity.Interface = strings.TrimSpace(device)
	}

	if len(parts) < 3 {
		return identity
	}
	// The instance segment is either the device's own serial or a value the bus
	// driver generated from its parent's instance path. The generated form is
	// the one carrying `&` separators (`8&1e0f24a1&0&0000`); a serial read off
	// the hardware cannot contain one. Calling a generated value a serial would
	// promise that the id survives a move to another port, which it does not.
	third := strings.TrimSpace(parts[2])
	if third == "" {
		return identity
	}
	if strings.Contains(third, "&") {
		identity.Location = third
		return identity
	}
	identity.Serial = third
	return identity
}
