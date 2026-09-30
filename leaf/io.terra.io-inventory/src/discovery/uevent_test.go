package discovery

import "testing"

// kernelUevent builds a message the way the kernel sends one: a header field
// with no "=", then NUL-separated KEY=VALUE.
func kernelUevent(header string, fields ...string) []byte {
	message := []byte(header)
	for _, field := range fields {
		message = append(message, 0)
		message = append(message, field...)
	}
	return append(message, 0)
}

func TestParseUevent(t *testing.T) {
	event, ok := ParseUevent(kernelUevent(
		"add@/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0/0003:046D:C52B.0001/input/input21",
		"ACTION=add",
		"DEVPATH=/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0/0003:046D:C52B.0001/input/input21",
		"SUBSYSTEM=input",
		"PRODUCT=3/46d/c52b/111",
		"SEQNUM=4821",
	))
	if !ok {
		t.Fatal("a kernel add event did not parse")
	}
	if event.Action != "add" {
		t.Errorf("action = %q, want add", event.Action)
	}
	if event.Subsystem != "input" {
		t.Errorf("subsystem = %q, want input", event.Subsystem)
	}
	if event.DevPath == "" {
		t.Error("devpath is empty")
	}
}

// The header field carries the same facts as ACTION/DEVPATH and is skipped.
// Reading it as a KEY=VALUE would put "add@/devices/…" somewhere.
func TestParseUeventIgnoresTheHeaderField(t *testing.T) {
	event, ok := ParseUevent(kernelUevent("remove@/devices/virtual/input/input9", "ACTION=remove", "SUBSYSTEM=input"))
	if !ok {
		t.Fatal("did not parse")
	}
	if event.Action != "remove" {
		t.Fatalf("action = %q, want remove — the header was read as a field", event.Action)
	}
}

// A libudev frame has a binary header. Parsing one as a kernel uevent reads
// that header as field names, and the symptom is a watcher that never fires.
func TestParseUeventRefusesLibudevFrame(t *testing.T) {
	message := append([]byte("libudev\x00"), []byte("\xfe\xed\xca\xfeACTION=add\x00SUBSYSTEM=input\x00")...)
	if _, ok := ParseUevent(message); ok {
		t.Fatal("a libudev frame was accepted as a kernel uevent")
	}
}

func TestParseUeventRefusesMessageWithoutAction(t *testing.T) {
	if _, ok := ParseUevent(kernelUevent("junk", "SUBSYSTEM=input", "SEQNUM=1")); ok {
		t.Fatal("a message with no ACTION was accepted")
	}
	if _, ok := ParseUevent(nil); ok {
		t.Fatal("an empty message was accepted")
	}
}

func TestChangesDevices(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		event Uevent
		want  bool
	}{
		{"input added", Uevent{Action: "add", Subsystem: "input"}, true},
		{"input removed", Uevent{Action: "remove", Subsystem: "input"}, true},
		{"input changed", Uevent{Action: "change", Subsystem: "input"}, true},
		{"hid bound", Uevent{Action: "bind", Subsystem: "hid"}, true},
		{"usb unbound", Uevent{Action: "unbind", Subsystem: "usb"}, true},

		// The traffic a watcher must not wake on. An idle machine emits these
		// constantly, and scanning on each one would make an event-driven
		// watcher more expensive than the poll it replaces.
		{"network interface", Uevent{Action: "add", Subsystem: "net"}, false},
		{"block device", Uevent{Action: "add", Subsystem: "block"}, false},
		{"power supply reading", Uevent{Action: "change", Subsystem: "power_supply"}, false},
		{"thermal zone", Uevent{Action: "change", Subsystem: "thermal"}, false},

		// move renames a sysfs path. identity.go derives a device's id from
		// what the device says about itself, not from where it sits, so a move
		// cannot change what the inventory holds.
		{"input moved", Uevent{Action: "move", Subsystem: "input"}, false},

		{"no subsystem", Uevent{Action: "add"}, false},
		{"no action", Uevent{Subsystem: "input"}, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := testCase.event.ChangesDevices(); got != testCase.want {
				t.Errorf("ChangesDevices() = %v, want %v", got, testCase.want)
			}
		})
	}
}
