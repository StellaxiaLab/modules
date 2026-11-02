// Package ioweave turns projected input into something a node without a
// desktop can act on.
//
// A CLI-only node is the case the whole idea has to answer for. Injecting a
// pointer there is meaningless — there is no cursor and nothing to point at —
// so instead of reproducing the device this package reproduces the *intent*:
// a wheel becomes arrow keys, a right-click becomes a paste, a key becomes the
// bytes a terminal expects.
//
// Nothing here talks to a terminal. Translation produces actions and stops;
// choosing which tty receives them is a separate question with its own
// unknowns (which session, which pane, what happens when there is none), and
// mixing the two would make a wrong target look like a wrong translation.
//
// What this package refuses to do is guess. A gesture a profile has no answer
// for comes back as an explicit "unsupported" carrying the reason, because a
// dropped action and a translated one look identical from the sending side,
// and the person doing the gesture is the last one to find out.
package ioweave

import (
	"fmt"
	"strings"

	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
)

// ActionKind says what the caller is being asked to do.
type ActionKind string

const (
	// ActionKeys carries bytes to write to the terminal.
	ActionKeys ActionKind = "keys"
	// ActionClipboard needs the clipboard's contents, which this package does
	// not have. It is not a failure — it is the half of a paste that belongs
	// to whoever owns clipboard sync.
	ActionClipboard ActionKind = "clipboard"
	// ActionUnsupported is a gesture this profile cannot express. It is
	// returned rather than dropped so the reason can reach a person.
	ActionUnsupported ActionKind = "unsupported"
)

// Action is one translated intent.
type Action struct {
	Kind ActionKind
	// Intent names what the person did, in words rather than bytes, so a log
	// or a UI can say "scroll up" instead of "1b 5b 41".
	Intent string
	// Bytes is what to write, for ActionKeys.
	Bytes []byte
	// Reason explains an ActionUnsupported.
	Reason string
}

func keys(intent string, bytes ...byte) Action {
	return Action{Kind: ActionKeys, Intent: intent, Bytes: bytes}
}

func unsupported(intent, reason string) Action {
	return Action{Kind: ActionUnsupported, Intent: intent, Reason: reason}
}

// Profile is a named set of answers. Profiles differ because terminals differ:
// under tmux a wheel can scroll history because copy-mode exists, and on a
// bare shell it cannot, so the same gesture is a scroll in one and honestly
// unsupported in the other.
type Profile string

const (
	// ProfileShell targets a plain interactive shell.
	ProfileShell Profile = "shell"
	// ProfileTmux targets a tmux pane, where copy-mode gives scrollback and
	// selection somewhere to happen.
	ProfileTmux Profile = "tmux"
)

// Profiles lists what can be configured, for a CLI or a settings page.
func Profiles() []Profile { return []Profile{ProfileShell, ProfileTmux} }

// Translator converts projected events into actions for one profile.
//
// It is stateful because the events are stateless by design: a pointer event
// carries the full set of buttons held rather than a change, so working out
// that a button was *just pressed* means remembering the previous set.
type Translator struct {
	profile Profile
	layout  Layout
	// requestedLayout is what the source said it was using, and
	// layoutRecognized whether that name was one this package knows. Both are
	// kept so a caller can report a fallback once instead of per keystroke —
	// and so a name that IS recognised under another spelling ("en-US") does
	// not raise a false alarm. A warning nobody should have seen teaches
	// people to ignore warnings.
	requestedLayout  string
	layoutRecognized bool
	held            map[protocol.PointerButton]bool
	// Modifier state lives on the translator because a terminal takes
	// characters, not key states: the shift that turns "a" into "A" arrives
	// as its own event and has to be remembered until the next key.
	control, shift, alt bool
	// tmuxCopyMode tracks whether the pane has been put into copy-mode, since
	// entering it twice is not the same as entering it once.
	tmuxCopyMode bool
	// tmuxPrefix is the key that introduces a tmux command, as bytes.
	tmuxPrefix []byte
}

// NewTranslator builds a translator for a profile and the layout the source
// said it was typing under.
//
// An unknown profile is an error: a caller that misspells one should not
// silently get shell behaviour on a tmux node. An unknown *layout* is not —
// typing under a best guess is better than typing nothing, and refusing would
// make every unmapped layout a total outage. The fallback is reported through
// LayoutFallback so it can be said once.
func NewTranslator(profile Profile, sourceLayout string) (*Translator, error) {
	switch profile {
	case ProfileShell, ProfileTmux:
	default:
		return nil, fmt.Errorf("unknown translation profile %q (have %v)", profile, Profiles())
	}
	layout, recognized := layoutFor(sourceLayout)
	return &Translator{
		profile:          profile,
		layout:           layout,
		requestedLayout:  sourceLayout,
		layoutRecognized: recognized,
		held:             map[protocol.PointerButton]bool{},
		tmuxPrefix:       []byte{0x02}, // Ctrl-B, tmux's default prefix
	}, nil
}

// SetTmuxPrefix overrides the assumed Ctrl-B. A node whose tmux is configured
// differently would otherwise have every scroll swallowed as a stray keystroke.
func (t *Translator) SetTmuxPrefix(prefix []byte) {
	if len(prefix) > 0 {
		t.tmuxPrefix = append([]byte(nil), prefix...)
	}
}

// LayoutFallback reports whether the source's layout was unknown and what is
// being used instead. Callers report it once, at bind time — never per key.
func (t *Translator) LayoutFallback() (requested, using string, fellBack bool) {
	return t.requestedLayout, t.layout.Name, !t.layoutRecognized
}

// Pointer translates one pointer event.
func (t *Translator) Pointer(event protocol.PointerEvent) []Action {
	actions := make([]Action, 0, 4)

	// Scroll first: it is the gesture that has a real answer here.
	if event.ScrollY != 0 {
		actions = append(actions, t.scroll(event.ScrollY)...)
	}
	if event.ScrollX != 0 {
		actions = append(actions, unsupported("scroll-horizontal",
			"a terminal has no horizontal scroll; left and right arrows would move the cursor in the line instead"))
	}

	pressed, released := t.buttonChanges(event.Buttons)
	for _, button := range pressed {
		actions = append(actions, t.press(button)...)
	}
	for _, button := range released {
		actions = append(actions, t.release(button)...)
	}
	return actions
}

// scroll turns wheel detents into movement. Positive is away from the person,
// which is the direction that shows earlier content.
func (t *Translator) scroll(detents int32) []Action {
	up := detents > 0
	count := int(detents)
	if count < 0 {
		count = -count
	}
	intent := "scroll-down"
	arrow := byte('B')
	if up {
		intent = "scroll-up"
		arrow = 'A'
	}

	actions := make([]Action, 0, count+1)
	if t.profile == ProfileTmux && !t.tmuxCopyMode {
		// Arrows sent to a shell walk its history instead of its output. Copy
		// mode is the only place a tmux pane will scroll.
		sequence := append(append([]byte(nil), t.tmuxPrefix...), '[')
		actions = append(actions, Action{Kind: ActionKeys, Intent: "tmux-enter-copy-mode", Bytes: sequence})
		t.tmuxCopyMode = true
	}
	if t.profile == ProfileShell {
		// Being explicit beats being clever: on a bare shell the arrows move
		// through command history, which is not scrolling and would look like
		// the remote wheel randomly retyping old commands.
		return []Action{unsupported(intent,
			"a bare shell has no scrollback to move through; arrows would walk command history instead. Use the tmux profile on a node running tmux")}
	}
	for index := 0; index < count; index++ {
		actions = append(actions, keys(intent, 0x1b, '[', arrow))
	}
	return actions
}

func (t *Translator) press(button protocol.PointerButton) []Action {
	switch button {
	case protocol.PointerButtonRight:
		// Paste is the one thing a right-click means in almost every terminal.
		// The bytes are not ours to produce — the clipboard lives with
		// whoever syncs it — so this names the intent and stops.
		return []Action{{Kind: ActionClipboard, Intent: "paste",
			Reason: "needs the clipboard contents, which arrive with clipboard sync"}}
	case protocol.PointerButtonLeft:
		if t.profile == ProfileTmux {
			t.tmuxCopyMode = true
			sequence := append(append([]byte(nil), t.tmuxPrefix...), '[')
			return []Action{
				{Kind: ActionKeys, Intent: "tmux-enter-copy-mode", Bytes: sequence},
				keys("selection-begin", 0x20), // space starts a selection in copy-mode
			}
		}
		return []Action{unsupported("selection-begin",
			"a bare shell has no selection; the terminal emulator owns it and there is none on this node")}
	case protocol.PointerButtonMiddle:
		return []Action{unsupported("middle-click",
			"middle-click pastes the X11 primary selection, which a node without a display server does not have")}
	default:
		return []Action{unsupported(string(button)+"-press", "no meaning defined for this button on a terminal")}
	}
}

func (t *Translator) release(button protocol.PointerButton) []Action {
	if button == protocol.PointerButtonLeft && t.profile == ProfileTmux {
		// Copy the selection and leave copy-mode, so the pane is back to
		// normal and the text is in tmux's buffer.
		return []Action{keys("selection-copy", 0x0d)}
	}
	return nil
}

// buttonChanges diffs the event's full button set against what was held.
func (t *Translator) buttonChanges(now []protocol.PointerButton) (pressed, released []protocol.PointerButton) {
	current := make(map[protocol.PointerButton]bool, len(now))
	for _, button := range now {
		current[button] = true
		if !t.held[button] {
			pressed = append(pressed, button)
		}
	}
	for button := range t.held {
		if !current[button] {
			released = append(released, button)
		}
	}
	t.held = current
	return pressed, released
}

// Key translates one key event.
//
// Releases produce nothing: a terminal takes a stream of characters, not key
// states, so the press is the whole event. Modifier keys are the exception —
// their state is what turns the next key into a control character — and they
// are tracked rather than emitted.
func (t *Translator) Key(event protocol.KeyEvent) []Action {
	if isModifier(event.Usage) {
		t.setModifier(event.Usage, event.Down)
		return nil
	}
	if !event.Down {
		return nil
	}
	if sequence, intent, ok := t.layout.Sequence(event.Usage, t.modifiers()); ok {
		return []Action{keys(intent, sequence...)}
	}
	return []Action{unsupported(fmt.Sprintf("key-usage-%#04x", event.Usage),
		"no mapping for this key in layout "+t.layout.Name)}
}

// Description is a one-line summary for a log or a status field.
func (t *Translator) Description() string {
	parts := []string{"profile=" + string(t.profile), "layout=" + t.layout.Name}
	if requested, using, fellBack := t.LayoutFallback(); fellBack {
		parts = append(parts, fmt.Sprintf("fallback(from %s to %s)", requested, using))
	}
	return strings.Join(parts, " ")
}
