package ioweave

import (
	"bytes"
	"testing"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

func press(usage uint16) protocol.KeyEvent {
	return protocol.KeyEvent{Usage: usage, Down: true}
}

// Ctrl+C is not the letter "c". Getting this wrong makes a remote session
// impossible to interrupt, which is the one thing a person reaches for when a
// remote session has gone wrong.
func TestControlLettersBecomeControlCharacters(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	translator.Key(protocol.KeyEvent{Usage: 0xE0, Down: true}) // Ctrl down

	for usage, want := range map[uint16]byte{
		0x06: 0x03, // c -> ETX, the interrupt
		0x04: 0x01, // a -> SOH, start of line
		0x07: 0x04, // d -> EOT, end of input
	} {
		actions := translator.Key(press(usage))
		if len(actions) != 1 || len(actions[0].Bytes) != 1 || actions[0].Bytes[0] != want {
			t.Errorf("ctrl+usage %#x produced %+v, want byte %#x", usage, actions, want)
		}
	}

	// Releasing Ctrl restores plain typing. A stuck modifier turns every
	// keystroke afterwards into a control character.
	translator.Key(protocol.KeyEvent{Usage: 0xE0, Down: false})
	actions := translator.Key(press(0x06))
	if len(actions) != 1 || !bytes.Equal(actions[0].Bytes, []byte{'c'}) {
		t.Errorf("after releasing ctrl, c produced %+v, want the letter", actions)
	}
}

func TestShiftSelectsTheShiftedCharacter(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	if actions := translator.Key(press(0x04)); !bytes.Equal(actions[0].Bytes, []byte{'a'}) {
		t.Fatalf("plain a produced %+v", actions)
	}
	translator.Key(protocol.KeyEvent{Usage: 0xE1, Down: true}) // Shift down
	if actions := translator.Key(press(0x04)); !bytes.Equal(actions[0].Bytes, []byte{'A'}) {
		t.Errorf("shifted a produced %+v, want A", actions)
	}
	// The digit row's shifted symbols do not follow from the digits, so they
	// get checked rather than assumed: shift+1 is "!" and shift+0 is ")".
	if actions := translator.Key(press(0x1E)); !bytes.Equal(actions[0].Bytes, []byte{'!'}) {
		t.Errorf("shift+1 produced %+v, want !", actions)
	}
	if actions := translator.Key(press(0x27)); !bytes.Equal(actions[0].Bytes, []byte{')'}) {
		t.Errorf("shift+0 produced %+v, want )", actions)
	}
}

// The digit row wraps: usage 0x1E is "1" and 0x27 is "0", not "9"+1. An
// off-by-one here types the wrong number, which no one would notice until a
// wrong command had already run.
func TestDigitRowWrapsAtZero(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	want := "1234567890"
	for index := 0; index < len(want); index++ {
		actions := translator.Key(press(uint16(0x1E + index)))
		if len(actions) != 1 || actions[0].Bytes[0] != want[index] {
			t.Errorf("usage %#x produced %+v, want %q", 0x1E+index, actions, want[index])
		}
	}
}

// Backspace sends DEL (0x7f), not BS (0x08). Terminals have done this since
// the vt220; 0x08 moves the cursor left without erasing, so the line fills up
// with text the person believes they deleted.
func TestBackspaceSendsDelete(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	actions := translator.Key(press(0x2A))
	if len(actions) != 1 || !bytes.Equal(actions[0].Bytes, []byte{0x7f}) {
		t.Errorf("backspace produced %+v, want 0x7f", actions)
	}
}

func TestArrowsAndNavigationKeys(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	for usage, want := range map[uint16][]byte{
		0x52: {0x1b, '[', 'A'},      // up
		0x51: {0x1b, '[', 'B'},      // down
		0x4F: {0x1b, '[', 'C'},      // right
		0x50: {0x1b, '[', 'D'},      // left
		0x4B: {0x1b, '[', '5', '~'}, // page up
		0x4C: {0x1b, '[', '3', '~'}, // delete
	} {
		actions := translator.Key(press(usage))
		if len(actions) != 1 || !bytes.Equal(actions[0].Bytes, want) {
			t.Errorf("usage %#x produced %+v, want %v", usage, actions, want)
		}
	}
}

// Alt is carried as an ESC prefix, which is how a terminal has always spelled
// Meta.
func TestAltPrefixesEscape(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	translator.Key(protocol.KeyEvent{Usage: 0xE2, Down: true})
	actions := translator.Key(press(0x05)) // b
	if len(actions) != 1 || !bytes.Equal(actions[0].Bytes, []byte{0x1b, 'b'}) {
		t.Errorf("alt+b produced %+v, want ESC b", actions)
	}
}

// A key release produces nothing — a terminal takes characters, not key
// states — but it must not produce a *stray* character either.
func TestReleasesProduceNothing(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	if actions := translator.Key(protocol.KeyEvent{Usage: 0x04, Down: false}); len(actions) != 0 {
		t.Errorf("a key release produced %+v", actions)
	}
}

// An unmapped key is reported, not swallowed, and the report names the usage
// so it can be added.
func TestUnmappedKeyIsReported(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	actions := translator.Key(press(0x68)) // F13, deliberately unmapped
	if len(actions) != 1 || actions[0].Kind != ActionUnsupported {
		t.Fatalf("unmapped key produced %+v, want an unsupported action", actions)
	}
	if actions[0].Reason == "" || actions[0].Intent == "" {
		t.Error("an unmapped key was reported without saying which key or which layout")
	}
}

// An unknown layout falls back to US so the node can still type, but the
// fallback is reported — once, at bind time, not per keystroke.
func TestUnknownLayoutFallsBackAndSaysSo(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "ko-KR")
	requested, using, fellBack := translator.LayoutFallback()
	if !fellBack {
		t.Fatal("an unmapped layout was used silently")
	}
	if requested != "ko-KR" || using != "us" {
		t.Errorf("fallback reported %q -> %q", requested, using)
	}
	// It still types.
	if actions := translator.Key(press(0x04)); len(actions) != 1 || actions[0].Kind != ActionKeys {
		t.Errorf("fallback layout refused to type: %+v", actions)
	}

	// A known layout reports no fallback.
	if _, _, fellBack := mustTranslator(t, ProfileShell, "us").LayoutFallback(); fellBack {
		t.Error("the US layout reported itself as a fallback")
	}
}

// A layout named under another spelling is the same layout. Reporting it as a
// fallback would be a false alarm, and a warning nobody should have seen
// teaches people to ignore warnings.
func TestRecognisedSpellingsDoNotReportAFallback(t *testing.T) {
	for _, name := range []string{"us", "US", "en-US", "en_us", " us ", ""} {
		if _, _, fellBack := mustTranslator(t, ProfileShell, name).LayoutFallback(); fellBack {
			t.Errorf("layout %q reported a fallback to itself", name)
		}
	}
}
