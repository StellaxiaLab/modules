package discovery

import (
	"bytes"
	"strings"
)

// Kernel uevent parsing.
//
// This file holds no OS call, only the reading of what the kernel says, so the
// filtering can be tested from any platform — the same split procinput.go
// describes for enumeration.
//
// A kernel uevent arrives on the netlink socket as a NUL-separated list whose
// first field is "ACTION@DEVPATH" and whose rest are KEY=VALUE:
//
//	add@/devices/pci0000:00/…/input/input5\0ACTION=add\0DEVPATH=/devices/…\0SUBSYSTEM=input\0…
//
// Every device on the machine emits these — network interfaces coming up, block
// devices, power supply readings, thermal zones. Acting on all of them would
// rescan the node's I/O every few seconds on an idle machine, so the filter
// below is what makes an event-driven watcher cheaper than a poll rather than
// more expensive.

// libudevMagic marks a message multicast by udev rather than by the kernel.
// Those carry a 40-byte binary header before the payload, so parsing one as a
// kernel uevent reads the header as a field name. The watcher binds the kernel
// group only, so this should never arrive; it is recognised anyway because the
// symptom of getting it wrong — a silent stream of unparseable events — looks
// exactly like a node whose hardware never changes.
var libudevMagic = []byte("libudev\x00")

// Uevent is the part of a kernel uevent this module acts on.
type Uevent struct {
	// Action is what happened: add, remove, change, bind, unbind, move.
	Action string
	// Subsystem is the kernel subsystem that emitted it — input, usb, hid, net…
	Subsystem string
	// DevPath is the sysfs path, without the /sys prefix.
	DevPath string
}

// ParseUevent reads one netlink message. The second return is false for a
// message this module cannot act on: a libudev frame, or one with no ACTION.
func ParseUevent(message []byte) (Uevent, bool) {
	if bytes.HasPrefix(message, libudevMagic) {
		return Uevent{}, false
	}
	var event Uevent
	for _, field := range bytes.Split(message, []byte{0}) {
		key, value, ok := strings.Cut(string(field), "=")
		if !ok {
			// The leading "ACTION@DEVPATH" header, or padding. The same facts
			// arrive as proper fields below, so nothing is read from it.
			continue
		}
		switch key {
		case "ACTION":
			event.Action = value
		case "SUBSYSTEM":
			event.Subsystem = value
		case "DEVPATH":
			event.DevPath = value
		}
	}
	if event.Action == "" {
		return Uevent{}, false
	}
	return event, true
}

// deviceSubsystems are the kernel subsystems whose events can change what an
// enumeration returns.
//
// "input" is the one that matters on this node: /proc/bus/input/devices — the
// file the Linux adapter reads — lists exactly the devices with an input
// handler, so an input event is the only kind that can change its contents.
//
// "usb" and "hid" are here because they arrive FIRST. Plugging a USB keyboard
// emits usb → hid → input as the stack binds, and the input event is last by a
// few milliseconds. Waking on the earlier ones does not make the scan wrong —
// the settle window below absorbs the burst into one rescan either way — but it
// starts the clock when the person plugged the cable in rather than when the
// kernel finished, which is what someone watching the device list expects.
var deviceSubsystems = map[string]struct{}{
	"input": {},
	"usb":   {},
	"hid":   {},
}

// deviceActions are the actions that can change the device set.
//
// "change" is included because a device that re-reports itself may have
// changed the capability bitmap the classification reads. "move" is not: it
// renames a sysfs path, and identity.go deliberately derives a device's id from
// what the device says about itself rather than from where it sits, so a move
// cannot change what the inventory holds.
var deviceActions = map[string]struct{}{
	"add":    {},
	"remove": {},
	"change": {},
	"bind":   {},
	"unbind": {},
}

// ChangesDevices reports whether this event can change what an enumeration
// returns. Everything else is someone else's kernel traffic.
func (e Uevent) ChangesDevices() bool {
	if _, ok := deviceActions[e.Action]; !ok {
		return false
	}
	_, ok := deviceSubsystems[e.Subsystem]
	return ok
}
