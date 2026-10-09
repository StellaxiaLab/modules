package ioweave

import (
	"bytes"
	"testing"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

func mustTranslator(t *testing.T, profile Profile, layout string) *Translator {
	t.Helper()
	translator, err := NewTranslator(profile, layout)
	if err != nil {
		t.Fatal(err)
	}
	return translator
}

// Nothing may vanish. Every event this package is handed comes back as at
// least one action, even when the answer is "this profile cannot do that" —
// a translated gesture and a dropped one look identical from the sending
// side, and the person making the gesture is the last to find out.
func TestNoGestureIsSilentlyDropped(t *testing.T) {
	for _, profile := range Profiles() {
		events := []protocol.PointerEvent{
			{ScrollY: 1},
			{ScrollY: -1},
			{ScrollX: 1},
			{Buttons: []protocol.PointerButton{protocol.PointerButtonRight}},
			{Buttons: []protocol.PointerButton{protocol.PointerButtonMiddle}},
			{Buttons: []protocol.PointerButton{protocol.PointerButtonLeft}},
		}
		for _, event := range events {
			translator := mustTranslator(t, profile, "us")
			if actions := translator.Pointer(event); len(actions) == 0 {
				t.Errorf("%s: %+v produced nothing", profile, event)
			}
		}
	}
}

// Every unsupported action must say why, in words a person can act on.
func TestUnsupportedActionsCarryAReason(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	actions := translator.Pointer(protocol.PointerEvent{ScrollY: 3, ScrollX: 1})
	found := 0
	for _, action := range actions {
		if action.Kind != ActionUnsupported {
			continue
		}
		found++
		if action.Reason == "" {
			t.Errorf("%q is unsupported with no reason", action.Intent)
		}
		if action.Intent == "" {
			t.Error("an action with no intent cannot be reported to anyone")
		}
	}
	if found == 0 {
		t.Fatal("expected the shell profile to refuse scrolling")
	}
}

// A shell has no scrollback; tmux does. The same wheel is therefore a real
// scroll in one profile and an honest refusal in the other — this is the
// whole reason profiles exist.
func TestWheelScrollsUnderTmuxAndIsRefusedUnderShell(t *testing.T) {
	shell := mustTranslator(t, ProfileShell, "us")
	for _, action := range shell.Pointer(protocol.PointerEvent{ScrollY: 2}) {
		if action.Kind == ActionKeys {
			t.Errorf("shell profile emitted keys for a wheel: %q would walk command history", action.Intent)
		}
	}

	tmux := mustTranslator(t, ProfileTmux, "us")
	actions := tmux.Pointer(protocol.PointerEvent{ScrollY: 2})
	if len(actions) != 3 {
		t.Fatalf("got %d actions, want copy-mode entry plus two arrows: %+v", len(actions), actions)
	}
	if actions[0].Intent != "tmux-enter-copy-mode" {
		t.Errorf("first action = %q, want copy-mode entry; arrows sent to a shell walk history instead of scrolling", actions[0].Intent)
	}
	for _, action := range actions[1:] {
		if !bytes.Equal(action.Bytes, []byte{0x1b, '[', 'A'}) {
			t.Errorf("scroll-up emitted %v, want the up-arrow sequence", action.Bytes)
		}
	}

	// Already in copy-mode: entering again is not the same as entering once.
	again := tmux.Pointer(protocol.PointerEvent{ScrollY: 1})
	if len(again) != 1 || again[0].Intent != "scroll-up" {
		t.Errorf("second scroll re-entered copy-mode: %+v", again)
	}
}

// Down is down. An inverted wheel is not a crash, just a thing that feels
// wrong forever, so the direction gets a test of its own.
func TestWheelDirection(t *testing.T) {
	tmux := mustTranslator(t, ProfileTmux, "us")
	tmux.Pointer(protocol.PointerEvent{ScrollY: 1}) // enter copy-mode
	for _, testCase := range []struct {
		detents int32
		want    byte
		intent  string
	}{
		{1, 'A', "scroll-up"},
		{-1, 'B', "scroll-down"},
	} {
		actions := tmux.Pointer(protocol.PointerEvent{ScrollY: testCase.detents})
		if len(actions) != 1 || actions[0].Intent != testCase.intent {
			t.Fatalf("detents %d produced %+v", testCase.detents, actions)
		}
		if actions[0].Bytes[2] != testCase.want {
			t.Errorf("detents %d sent arrow %q, want %q", testCase.detents, actions[0].Bytes[2], testCase.want)
		}
	}
}

// A right-click is a paste, and a paste needs the clipboard — which this
// package does not have. It says so instead of emitting bytes that would
// paste whatever happened to be there.
func TestRightClickAsksForTheClipboard(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	actions := translator.Pointer(protocol.PointerEvent{Buttons: []protocol.PointerButton{protocol.PointerButtonRight}})
	if len(actions) != 1 || actions[0].Kind != ActionClipboard {
		t.Fatalf("right-click produced %+v, want a clipboard request", actions)
	}
	if len(actions[0].Bytes) != 0 {
		t.Error("a clipboard action carries no bytes: this package does not know what to paste")
	}
}

// The events are stateless by design — each carries the full set of buttons
// held — so a press must be recognised by diffing against the last set, and a
// button held across two events must not press twice.
func TestButtonHeldAcrossEventsPressesOnce(t *testing.T) {
	translator := mustTranslator(t, ProfileShell, "us")
	held := []protocol.PointerButton{protocol.PointerButtonRight}
	first := translator.Pointer(protocol.PointerEvent{Buttons: held})
	second := translator.Pointer(protocol.PointerEvent{Buttons: held})
	if len(first) != 1 {
		t.Fatalf("first event produced %+v", first)
	}
	if len(second) != 0 {
		t.Errorf("holding the same button pasted again: %+v", second)
	}
	// Releasing it and pressing again is a second paste.
	translator.Pointer(protocol.PointerEvent{})
	if third := translator.Pointer(protocol.PointerEvent{Buttons: held}); len(third) != 1 {
		t.Errorf("press after release produced %+v, want one paste", third)
	}
}

func TestUnknownProfileIsRefused(t *testing.T) {
	if _, err := NewTranslator("screen", "us"); err == nil {
		t.Fatal("a misspelled profile silently became shell behaviour")
	}
}
