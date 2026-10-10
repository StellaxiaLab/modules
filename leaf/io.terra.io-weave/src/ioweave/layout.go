package ioweave

import "strings"

// Keyboard layouts, and the L2 translation that uses them.
//
// L2 means Terra does the remapping: a key arrives as the physical key it was
// (a HID usage) and this side decides what character that is. The alternative,
// L1, is to tell the sink's OS to hold the source's layout on the virtual
// device and let it decide — which is better, and unmeasured, because no node
// in the fleet runs a graphical session to try it on. Nothing here forecloses
// it: the same SourceLayout field feeds either.
//
// Only the US layout is defined. Which layouts to carry is an open question
// (Q-15) between "every layout in the world" and "the ones nodes actually
// report", and answering it by quietly adding tables would answer it the wrong
// way — a half-populated global table looks complete and fails per-key.

// HID keyboard usage ids (usage page 0x07). Only the ones consulted here.
const (
	usageA          = 0x04
	usageZ          = 0x1D
	usage1          = 0x1E
	usage0          = 0x27
	usageEnter      = 0x28
	usageEscape     = 0x29
	usageBackspace  = 0x2A
	usageTab        = 0x2B
	usageSpace      = 0x2C
	usageMinus      = 0x2D
	usageEqual      = 0x2E
	usageLeftBrace  = 0x2F
	usageRightBrace = 0x30
	usageBackslash  = 0x31
	usageSemicolon  = 0x33
	usageQuote      = 0x34
	usageGrave      = 0x35
	usageComma      = 0x36
	usagePeriod     = 0x37
	usageSlash      = 0x38

	usageHome     = 0x4A
	usagePageUp   = 0x4B
	usageDelete   = 0x4C
	usageEnd      = 0x4D
	usagePageDown = 0x4E
	usageRight    = 0x4F
	usageLeft     = 0x50
	usageDown     = 0x51
	usageUp       = 0x52

	usageLeftControl  = 0xE0
	usageLeftShift    = 0xE1
	usageLeftAlt      = 0xE2
	usageRightControl = 0xE4
	usageRightShift   = 0xE5
	usageRightAlt     = 0xE6
)

type modifierState struct {
	control bool
	shift   bool
	alt     bool
}

func isModifier(usage uint16) bool {
	switch usage {
	case usageLeftControl, usageRightControl, usageLeftShift, usageRightShift, usageLeftAlt, usageRightAlt:
		return true
	default:
		return false
	}
}

func (t *Translator) setModifier(usage uint16, down bool) {
	switch usage {
	case usageLeftControl, usageRightControl:
		t.control = down
	case usageLeftShift, usageRightShift:
		t.shift = down
	case usageLeftAlt, usageRightAlt:
		t.alt = down
	}
}

func (t *Translator) modifiers() modifierState {
	return modifierState{control: t.control, shift: t.shift, alt: t.alt}
}

// Layout maps physical keys to the characters they produce.
type Layout struct {
	Name string
	// plain and shifted hold the printable characters, indexed by usage.
	plain   map[uint16]byte
	shifted map[uint16]byte
}

// LayoutUS is the layout every other one falls back to.
var LayoutUS = Layout{
	Name:    "us",
	plain:   usPlain(),
	shifted: usShifted(),
}

// layoutFor picks a layout by name, falling back to US.
//
// The fallback is deliberate and reported (Translator.LayoutFallback), not
// silent. A node that cannot type at all is worse than one that types a wrong
// punctuation mark, but a person told neither is worst of all.
func layoutFor(name string) (Layout, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "us", "en-us", "en_us":
		return LayoutUS, true
	default:
		return LayoutUS, false
	}
}

func usPlain() map[uint16]byte {
	table := map[uint16]byte{}
	for usage := uint16(usageA); usage <= usageZ; usage++ {
		table[usage] = byte('a' + (usage - usageA))
	}
	// The digit row wraps: usage 0x1E is "1" and 0x27 is "0", not "9"+1.
	digits := "1234567890"
	for index := 0; index < len(digits); index++ {
		table[uint16(usage1+index)] = digits[index]
	}
	for usage, character := range map[uint16]byte{
		usageMinus: '-', usageEqual: '=', usageLeftBrace: '[', usageRightBrace: ']',
		usageBackslash: '\\', usageSemicolon: ';', usageQuote: '\'', usageGrave: '`',
		usageComma: ',', usagePeriod: '.', usageSlash: '/', usageSpace: ' ',
	} {
		table[usage] = character
	}
	return table
}

func usShifted() map[uint16]byte {
	table := map[uint16]byte{}
	for usage := uint16(usageA); usage <= usageZ; usage++ {
		table[usage] = byte('A' + (usage - usageA))
	}
	symbols := "!@#$%^&*()"
	for index := 0; index < len(symbols); index++ {
		table[uint16(usage1+index)] = symbols[index]
	}
	for usage, character := range map[uint16]byte{
		usageMinus: '_', usageEqual: '+', usageLeftBrace: '{', usageRightBrace: '}',
		usageBackslash: '|', usageSemicolon: ':', usageQuote: '"', usageGrave: '~',
		usageComma: '<', usagePeriod: '>', usageSlash: '?', usageSpace: ' ',
	} {
		table[usage] = character
	}
	return table
}

// Sequence returns the bytes a terminal expects for one key press.
func (l Layout) Sequence(usage uint16, modifiers modifierState) ([]byte, string, bool) {
	// Control characters first: Ctrl+C is not the letter "c", and treating it
	// as one is how a remote session becomes impossible to interrupt.
	if modifiers.control && usage >= usageA && usage <= usageZ {
		letter := byte('a' + (usage - usageA))
		return []byte{byte(usage-usageA) + 1}, "ctrl-" + string(letter), true
	}

	if sequence, intent, ok := controlKeySequence(usage); ok {
		return withAlt(sequence, modifiers), intent, true
	}

	table := l.plain
	if modifiers.shift {
		table = l.shifted
	}
	if character, ok := table[usage]; ok {
		return withAlt([]byte{character}, modifiers), "type-" + string(character), true
	}
	return nil, "", false
}

// controlKeySequence covers the keys whose meaning is a terminal escape rather
// than a character.
func controlKeySequence(usage uint16) ([]byte, string, bool) {
	switch usage {
	case usageEnter:
		return []byte{'\r'}, "enter", true
	case usageEscape:
		return []byte{0x1b}, "escape", true
	case usageBackspace:
		// 0x7f (DEL), not 0x08. Terminals have sent DEL for the backspace key
		// since the vt220, and 0x08 moves the cursor without erasing.
		return []byte{0x7f}, "backspace", true
	case usageTab:
		return []byte{'\t'}, "tab", true
	case usageUp:
		return []byte{0x1b, '[', 'A'}, "up", true
	case usageDown:
		return []byte{0x1b, '[', 'B'}, "down", true
	case usageRight:
		return []byte{0x1b, '[', 'C'}, "right", true
	case usageLeft:
		return []byte{0x1b, '[', 'D'}, "left", true
	case usageHome:
		return []byte{0x1b, '[', 'H'}, "home", true
	case usageEnd:
		return []byte{0x1b, '[', 'F'}, "end", true
	case usagePageUp:
		return []byte{0x1b, '[', '5', '~'}, "page-up", true
	case usagePageDown:
		return []byte{0x1b, '[', '6', '~'}, "page-down", true
	case usageDelete:
		return []byte{0x1b, '[', '3', '~'}, "delete", true
	default:
		return nil, "", false
	}
}

// withAlt prefixes ESC, which is how a terminal carries a Meta/Alt press.
func withAlt(sequence []byte, modifiers modifierState) []byte {
	if !modifiers.alt {
		return sequence
	}
	return append([]byte{0x1b}, sequence...)
}
