package weave

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	ioweave "github.com/StellaxiaLab/modules/leaf/io.terra.io-weave/ioweave"
	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
)

// Mode is what this node does with a pointer frame that reaches it.
type Mode string

const (
	// ModeTranslate turns the remote pointer's gestures into terminal intent
	// (the Translation Profile). It is the mode that works on the nodes this
	// fleet actually has: every one of them runs without a display server,
	// where reproducing a cursor would reproduce nothing.
	ModeTranslate Mode = "translate"
	// ModeInject drives the operating system's own pointer through a virtual
	// device. A node reports this mode only while it really injects: the mode
	// is read from the live device, not from the settings that asked for one,
	// so a node whose device was never created or has been taken away by the
	// watchdog reports translate and says why.
	ModeInject Mode = "inject"
)

// maxRecordedActions bounds the translated-action log. It is a window for a
// person looking at what just happened, not a transcript: pointer traffic is
// high frequency, and an unbounded log on a long session is a memory leak with
// a friendly name.
const maxRecordedActions = 64

// Projection is the node's one projected pointer.
//
// It is deliberately not "a virtual device". On a node with no display server
// there is no cursor to move and nothing to point at, so what gets reproduced
// is the INTENT — scroll, select, paste — which is what the Translation
// Profile converts a pointer into. A node that can inject swaps the tail of
// this for a virtual device without changing anything above it: the wire, the
// binding and the permission tier are the same either way.
type Projection struct {
	injection InjectionStatus
	store     *SettingsStore
	now       func() time.Time
	// openInjector and lockState are swapped in tests. The watchdog and the
	// device are the concurrency in this file, and a test that could only
	// reach them through /dev/uinput would run on no machine in this fleet.
	openInjector    func() (injector, error)
	lockState       func() lockState
	watchdogTimeout time.Duration

	mu         sync.Mutex
	settings   Settings
	translator *ioweave.Translator
	bound      bool
	binding    string
	// guard owns the virtual device while one exists. Nil means this node is
	// translating, which is also what it means after the watchdog fires.
	guard  *injectionGuard
	escape Escape
	// applied counts frames that produced actions; refused counts frames that
	// did not. Both are reported: a projection that silently drops what it
	// cannot use is the failure the Translation Profile was written to avoid.
	applied  uint64
	refused  uint64
	last     protocol.PointerEvent
	lastSeen time.Time
	lastErr  string
	actions  []RecordedAction
}

// RecordedAction is one thing the projection did with a frame.
type RecordedAction struct {
	Sequence uint64 `json:"sequence"`
	Kind     string `json:"kind"`
	Intent   string `json:"intent"`
	// Bytes is what would be written to the target terminal. Nothing writes it
	// yet: choosing WHICH terminal on a node with several is an open question,
	// and guessing would type a remote person's clicks into whichever shell
	// happened to be first.
	Bytes string `json:"bytes,omitempty"`
	// Reason is why an unsupported gesture produced nothing. Present exactly
	// when Kind is "unsupported".
	Reason string `json:"reason,omitempty"`
}

// State is the projection's externally visible state.
type State struct {
	Mode       Mode   `json:"mode"`
	ModeDetail string `json:"mode_detail"`
	Profile    string `json:"profile"`
	Bound      bool   `json:"bound"`
	BindingID  string `json:"binding_id,omitempty"`
	Applied    uint64 `json:"applied_frames"`
	Refused    uint64 `json:"refused_frames"`
	LastError  string `json:"last_error,omitempty"`
	// Escape is the last reason injection stopped, present only once it has
	// stopped at least once. The cursor coming back says nothing by itself
	// (§6.5): a locked screen, a hung write and a node that was never allowed
	// to inject all look identical from the far end.
	Escape *Escape `json:"escape,omitempty"`

	LastPosition *protocol.PointerPosition `json:"last_position,omitempty"`
	LastButtons  []protocol.PointerButton  `json:"last_buttons,omitempty"`
	LastSeen     string                    `json:"last_seen,omitempty"`

	Actions   []RecordedAction `json:"recent_actions"`
	Injection InjectionStatus  `json:"injection"`
}

// NewProjection builds the node's projection from its stored settings. A nil
// store is a node that remembers nothing and runs on the defaults.
func NewProjection(store *SettingsStore, injection InjectionStatus) (*Projection, error) {
	settings, err := store.Load()
	if err != nil {
		return nil, err
	}
	translator, err := ioweave.NewTranslator(settings.Profile, settings.SourceLayout)
	if err != nil {
		return nil, err
	}
	return &Projection{
		injection:       injection,
		store:           store,
		now:             func() time.Time { return time.Now().UTC() },
		openInjector:    newInjector,
		lockState:       checkLockState,
		watchdogTimeout: defaultWatchdogTimeout,
		settings:        settings,
		translator:      translator,
	}, nil
}

// Settings reports the node's current projection settings.
func (p *Projection) Settings() Settings {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.settings
}

// Configure replaces the node's projection settings and persists them.
//
// Changing the profile rebuilds the translator, which releases any button the
// current source is holding. That is the safe direction: a drag that began
// under one profile has no meaning under the other, and inheriting a press
// across the change would leave a button down that nobody ever releases.
func (p *Projection) Configure(settings Settings) error {
	if strings.TrimSpace(settings.SourceLayout) == "" {
		settings.SourceLayout = DefaultSettings().SourceLayout
	}
	if err := settings.Validate(); err != nil {
		return err
	}
	translator, err := ioweave.NewTranslator(settings.Profile, settings.SourceLayout)
	if err != nil {
		return err
	}
	if err := p.store.Save(settings); err != nil {
		return err
	}
	p.mu.Lock()
	p.settings = settings
	p.translator = translator
	// Switching injection off takes effect now; switching it on waits for the
	// next binding. The asymmetry is deliberate. Stopping is a safety action
	// and an operator who turns it off means now, whereas starting is an
	// acquisition, and §6.5 is explicit that acquisition happens on a person's
	// action and never on its own — a binding that was agreed to as a
	// translating one must not quietly become a machine driving this cursor.
	var stopping *injectionGuard
	if settings.Injection != InjectionAuto && p.guard != nil {
		stopping = p.guard
		p.guard = nil
	}
	p.mu.Unlock()

	if stopping != nil {
		stopping.Close(EscapeReleased, "injection was switched off for this node")
		p.adoptEscape(stopping)
	}
	return nil
}

// ErrAlreadyBound refuses a second remote pointer. One sink holds one remote
// lease: two remote pointers on one node is the contest the arbiter does not
// exist to settle, and accepting both would interleave two people's gestures
// with no way to tell them apart.
var ErrAlreadyBound = errors.New("io-weave: the projected pointer already has a remote source")

// Attach claims the projection for one binding, and opens a virtual input
// device if this node is configured to be driven by one.
//
// Failing to open the device does NOT fail the attach. The binding still
// carries frames and the node still projects them as terminal intent, which is
// a smaller outcome than the operator asked for but a visible one: the state
// says translate, the escape reason says why, and nothing about it is silent.
// Refusing the binding instead would take away the working half to punish the
// missing one.
func (p *Projection) Attach(bindingID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.bound {
		return fmt.Errorf("%w (binding %s)", ErrAlreadyBound, p.binding)
	}
	p.bound = true
	p.binding = bindingID
	p.lastErr = ""
	p.escape = Escape{}
	p.startInjectionLocked()
	return nil
}

// startInjectionLocked opens the virtual device when every precondition holds.
// Callers hold p.mu.
//
// The order of the checks is the order of their cost and their bluntness:
// what the operator asked for, then what this build can do, then what the
// platform allows, then what the node's session is doing right now. Each
// refusal names itself, because "the pointer did not move" has at least four
// causes here and a person who cannot tell them apart will reinstall the
// wrong thing.
func (p *Projection) startInjectionLocked() {
	if p.settings.Injection != InjectionAuto {
		return
	}
	if !p.injection.Ready() {
		p.escape = Escape{
			Reason: EscapeDeviceFailed,
			Detail: "injection is set to auto but unavailable here: " + p.injection.Detail,
			At:     p.now().Format(time.RFC3339Nano),
		}
		return
	}
	// D-15. Linux uinput reaches a lock screen exactly as a physical mouse
	// does, so the far end of a binding could unlock this machine. Checked
	// here rather than only per frame because the device itself is what a
	// locked session must not have.
	if state := p.lockState(); state.Locked {
		p.escape = Escape{
			Reason: EscapeLockScreen,
			Detail: "this node's session is locked, so injection stays off (" + state.Reason + ")",
			At:     p.now().Format(time.RFC3339Nano),
		}
		return
	}
	device, err := p.openInjector()
	if err != nil {
		p.escape = Escape{
			Reason: EscapeDeviceFailed,
			Detail: "could not create the virtual input device: " + err.Error(),
			At:     p.now().Format(time.RFC3339Nano),
		}
		return
	}
	// The watchdog starts with the device, never after it. D-22's ordering
	// constraint is the whole reason injection ships in this change and not an
	// earlier one: a device that exists without a timer able to take it away
	// is a grab with no way out.
	p.guard = newInjectionGuard(device, p.watchdogTimeout, p.now)
}

// Detach releases the projection. Releasing one that was never claimed, or was
// claimed by another binding, is a no-op: teardown races a restart, and a
// close that arrives twice must not free a sink somebody else just opened.
func (p *Projection) Detach(bindingID string) {
	p.mu.Lock()
	if !p.bound || p.binding != bindingID {
		p.mu.Unlock()
		return
	}
	p.bound = false
	p.binding = ""
	// Release the held buttons with the lease. A source that vanished
	// mid-drag otherwise leaves this side believing a button is still down,
	// and the next binding inherits somebody else's press.
	p.translator.Pointer(protocol.PointerEvent{})
	guard := p.guard
	p.guard = nil
	p.mu.Unlock()

	// Outside p.mu: the guard's Close releases the held buttons on the device
	// and waits for the watchdog goroutine, and holding the projection's lock
	// across that would let a stuck write block every reader of State — the
	// one thing a person needs while it is stuck.
	if guard != nil {
		guard.Close(EscapeReleased, "the binding ended")
		p.adoptEscape(guard)
	}
}

// adoptEscape copies the guard's last word into the projection, so the reason
// outlives the device it belonged to. A reason that vanished with the guard
// would answer "why did my pointer stop" with nothing at all.
func (p *Projection) adoptEscape(guard *injectionGuard) {
	escape := guard.Escape()
	if escape.Reason == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.escape = escape
}

// Apply decodes one frame and projects it.
//
// A frame that does not decode is an error, not a skip. The sink's write error
// fails the binding, which is the only way the person holding the pointer
// finds out — the alternative is a binding that stays green while every
// gesture disappears.
func (p *Projection) Apply(sequence uint64, frame []byte) error {
	var event protocol.PointerEvent
	decoder := json.NewDecoder(bytes.NewReader(frame))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&event); err != nil {
		p.recordError(fmt.Sprintf("frame %d is not a %s pointer event: %v", sequence, PointerSchema, err))
		return fmt.Errorf("decode pointer frame %d: %w", sequence, err)
	}
	if err := validatePointerEvent(event); err != nil {
		p.recordError(fmt.Sprintf("frame %d: %v", sequence, err))
		return err
	}

	p.mu.Lock()
	guard := p.guard
	p.mu.Unlock()
	if guard != nil {
		return p.inject(guard, sequence, event)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	produced := false
	for _, action := range p.translator.Pointer(event) {
		recorded := RecordedAction{Sequence: sequence, Kind: string(action.Kind), Intent: action.Intent}
		if action.Kind == ioweave.ActionUnsupported {
			recorded.Reason = action.Reason
		} else {
			recorded.Bytes = string(action.Bytes)
			produced = true
		}
		p.actions = append(p.actions, recorded)
	}
	if len(p.actions) > maxRecordedActions {
		p.actions = append([]RecordedAction(nil), p.actions[len(p.actions)-maxRecordedActions:]...)
	}
	p.last = event
	p.lastSeen = p.now()
	if produced {
		p.applied++
	} else {
		// Movement alone produces nothing on a terminal — there is no cursor
		// to move — and that is a correct outcome, not a fault. It counts as
		// refused so the two are never added together.
		p.refused++
	}
	return nil
}

// inject drives one frame into the OS through the guarded device.
//
// Called with p.mu released, because the guard's Inject can be as slow as the
// kernel is and the watchdog's whole purpose is to survive it being slower
// than that. A frame the device refuses is an error on the sink's write, which
// fails the binding — the same treatment a frame that would not decode gets,
// and for the same reason: the person holding the pointer has no other way to
// learn that it stopped arriving.
func (p *Projection) inject(guard *injectionGuard, sequence uint64, event protocol.PointerEvent) error {
	err := guard.Inject(event)

	p.mu.Lock()
	p.last = event
	p.lastSeen = p.now()
	if err == nil {
		p.applied++
		p.mu.Unlock()
		return nil
	}
	p.refused++
	p.lastErr = fmt.Sprintf("frame %d was not injected: %v", sequence, err)
	// The guard has already given up the device by the time it reports an
	// error, so dropping the reference here is bookkeeping rather than policy:
	// the next frame translates, and State says which reason took the device.
	if p.guard == guard {
		p.guard = nil
	}
	p.mu.Unlock()

	p.adoptEscape(guard)
	// The device is gone either way; this stops the timer that was watching
	// it. Without it a node that lost one device would carry its watchdog
	// goroutine for the rest of the process's life.
	guard.Stop()
	return fmt.Errorf("inject pointer frame %d: %w", sequence, err)
}

func (p *Projection) recordError(detail string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.refused++
	p.lastErr = detail
}

// State snapshots what the projection is doing.
//
// The mode is read from the live device rather than from the settings that
// asked for one. Those two disagree for four ordinary reasons — the platform
// refused, the build has no backend, the session is locked, the watchdog
// fired — and reporting the request instead of the outcome would tell a
// consumer that their pointer is moving something while it moves nothing.
func (p *Projection) State() State {
	p.mu.Lock()
	defer p.mu.Unlock()
	state := State{
		Mode:       ModeTranslate,
		ModeDetail: p.translator.Description(),
		Profile:    string(p.settings.Profile),
		Bound:      p.bound,
		BindingID:  p.binding,
		Applied:    p.applied,
		Refused:    p.refused,
		LastError:  p.lastErr,
		Actions:    append([]RecordedAction{}, p.actions...),
		Injection:  p.injection,
	}
	if p.guard != nil && p.guard.Live() {
		state.Mode = ModeInject
		state.ModeDetail = p.guard.Describe()
	}
	escape := p.escape
	if p.guard != nil {
		// A guard that died between frames has the newer word. Nothing has
		// asked it for one yet, because nothing has tried to inject since.
		if latest := p.guard.Escape(); latest.Reason != "" {
			escape = latest
		}
	}
	if escape.Reason != "" {
		state.Escape = &escape
	}
	if !p.lastSeen.IsZero() {
		position := p.last.Position
		state.LastPosition = &position
		state.LastButtons = append([]protocol.PointerButton{}, p.last.Buttons...)
		state.LastSeen = p.lastSeen.Format(time.RFC3339Nano)
	}
	return state
}

// validatePointerEvent rejects a frame whose button names this side does not
// know.
//
// Names travel the wire instead of numbers precisely so the two ends cannot
// disagree silently, and honouring that means refusing an unknown name rather
// than guessing which button it meant. A pointer with a fourth button is a
// real thing; mapping it to "middle" because that is closest would click the
// wrong thing on someone else's machine.
func validatePointerEvent(event protocol.PointerEvent) error {
	for _, button := range event.Buttons {
		switch button {
		case protocol.PointerButtonLeft, protocol.PointerButtonRight, protocol.PointerButtonMiddle:
		default:
			return fmt.Errorf("unknown pointer button %q", button)
		}
	}
	return nil
}
