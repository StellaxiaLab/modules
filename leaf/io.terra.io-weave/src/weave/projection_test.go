package weave

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	ioweave "github.com/StellaxiaLab/modules/leaf/io.terra.io-weave/ioweave"
	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
	coresvi "github.com/terra-project/terra/products/common/packages/terra-svi"
)

func newTestProjection(t *testing.T, profile ioweave.Profile) *Projection {
	t.Helper()
	store := NewSettingsStore(filepath.Join(t.TempDir(), "settings.json"))
	if err := store.Save(Settings{Profile: profile, SourceLayout: "us"}); err != nil {
		t.Fatal(err)
	}
	projection, err := NewProjection(store, InjectionStatus{Platform: "test"})
	if err != nil {
		t.Fatal(err)
	}
	return projection
}

func frame(t *testing.T, event protocol.PointerEvent) []byte {
	t.Helper()
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// The resource this module publishes must survive the same validation the
// daemon applies on ingestion. A descriptor that fails there does not fail
// loudly: one invalid resource fails the whole provider refresh, so the node's
// catalog silently stops updating.
func TestPublishedResourceIsValidOnceTheDaemonNamespacesIt(t *testing.T) {
	resources := newTestProjection(t, ioweave.ProfileShell).Resources()
	if len(resources) != 1 {
		t.Fatalf("resources = %d, want exactly one (the node's own projected pointer)", len(resources))
	}
	resource := resources[0]
	if resource.ResourceID != PointerResourceID {
		t.Fatalf("resource id = %q, want the module-local suffix %q", resource.ResourceID, PointerResourceID)
	}

	// What the daemon's remote adapter stamps on ingestion.
	resource.ResourceID = "svi.node-a." + resource.ResourceID
	resource.NodeID = "node-a"
	resource.ProviderID = "module.io.terra.io-weave"
	resource.Owner = coresvi.SubjectRef{Type: coresvi.SubjectNode, ID: "node-a"}
	resource.ExpiresAt = resource.ExpiresAt.AddDate(0, 0, 1)
	if err := coresvi.ValidateResource(resource); err != nil {
		t.Fatalf("published resource is invalid: %v", err)
	}
}

// The endpoint is a sink and must stay one. A source endpoint here would
// re-open the loop the enumeration side closed: node C could bind to node B's
// copy of node A's pointer, adding a hop and an owner to every event and
// putting C outside the reach of revoking A's grant.
func TestProjectedPointerCannotBeBoundAsASource(t *testing.T) {
	endpoint := newTestProjection(t, ioweave.ProfileShell).Resources()[0].Endpoints[0]
	if endpoint.Direction != coresvi.DirectionSink {
		t.Fatalf("direction = %q, want sink", endpoint.Direction)
	}
	for _, operation := range endpoint.Operations {
		if operation == coresvi.OperationBindSource || operation == coresvi.OperationSubscribe || operation == coresvi.OperationRead {
			t.Fatalf("endpoint offers %q, which lets another node read this node's borrowed pointer", operation)
		}
	}
	decision := coresvi.EvaluateBinding(endpoint, endpoint)
	if decision.Result != coresvi.CompatibilityIncompatible {
		t.Fatalf("sink-as-source = %q, want incompatible", decision.Result)
	}
}

// The tier the endpoint advertises is the price of binding to it, and the
// tiers do not nest: a grant written for a pointer must never read as
// permission to type.
func TestEndpointAdvertisesThePointerTierOnly(t *testing.T) {
	metadata := newTestProjection(t, ioweave.ProfileShell).Resources()[0].Endpoints[0].Metadata
	if metadata["permission_tier"] != string(protocol.InputTierPointer) {
		t.Fatalf("permission_tier = %v, want %q", metadata["permission_tier"], protocol.InputTierPointer)
	}
	for _, key := range []string{"feedback", "arbitration_state", "arbitration_reason", "projection_mode"} {
		if value, exists := metadata[key]; !exists || value == "" {
			t.Fatalf("endpoint metadata is missing %q; the seat has to be reserved before anything fills it", key)
		}
	}
	if metadata["arbitration_state"] != "unmeasured" {
		t.Fatalf("arbitration_state = %v, want unmeasured — no arbiter has looked, and unmeasured is not idle", metadata["arbitration_state"])
	}
}

// io-inventory's resources must not be mistaken for this module's, and neither
// must another node's copy of the same suffix.
func TestOwnsResourceMatchesOnlyTheNamespacedPointer(t *testing.T) {
	for _, id := range []string{"svi.node-a.io-weave.pointer", "svi.node-b.io-weave.pointer"} {
		if !OwnsResource(id) {
			t.Fatalf("%s should be recognised as this module's pointer", id)
		}
	}
	for _, id := range []string{"io-weave.pointer", "svi.node-a.io.mouse-1", "svi.node-a.io-weave.pointer.extra", ""} {
		if OwnsResource(id) {
			t.Fatalf("%s should not be recognised as this module's pointer", id)
		}
	}
}

// One remote pointer per node. Two would interleave two people's gestures with
// no way to tell them apart, and there is no arbiter to settle the contest.
func TestSecondBindingIsRefusedWhileTheFirstHoldsThePointer(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	err := projection.Attach("bnd-2")
	if !errors.Is(err, ErrAlreadyBound) {
		t.Fatalf("second attach = %v, want ErrAlreadyBound", err)
	}
	// A stale close from a binding that no longer holds it must not free the
	// pointer out from under the one that does.
	projection.Detach("bnd-2")
	if !projection.State().Bound {
		t.Fatal("a detach naming another binding released the pointer")
	}
	projection.Detach("bnd-1")
	if projection.State().Bound {
		t.Fatal("the holder's detach did not release the pointer")
	}
	if err := projection.Attach("bnd-2"); err != nil {
		t.Fatalf("re-attach after release = %v", err)
	}
}

// A wheel on a bare shell is refused WITH A REASON rather than dropped. The
// person who turned the wheel is the last to know otherwise.
func TestUnsupportedGestureIsRecordedWithItsReason(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	if err := projection.Apply(1, frame(t, protocol.PointerEvent{ScrollY: 2})); err != nil {
		t.Fatal(err)
	}
	state := projection.State()
	if len(state.Actions) != 1 || state.Actions[0].Kind != string(ioweave.ActionUnsupported) {
		t.Fatalf("actions = %+v, want one unsupported action", state.Actions)
	}
	if !strings.Contains(state.Actions[0].Reason, "scrollback") {
		t.Fatalf("reason = %q, want it to say why a bare shell cannot scroll", state.Actions[0].Reason)
	}
	if state.Applied != 0 || state.Refused != 1 {
		t.Fatalf("applied=%d refused=%d, want 0/1", state.Applied, state.Refused)
	}
}

func TestWheelOnTmuxEntersCopyModeThenScrolls(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileTmux)
	if err := projection.Apply(7, frame(t, protocol.PointerEvent{ScrollY: 2})); err != nil {
		t.Fatal(err)
	}
	state := projection.State()
	if len(state.Actions) != 3 {
		t.Fatalf("actions = %+v, want copy-mode entry plus two arrows", state.Actions)
	}
	if state.Actions[0].Intent != "tmux-enter-copy-mode" {
		t.Fatalf("first action = %q, want the copy-mode entry; arrows sent to a shell walk history instead", state.Actions[0].Intent)
	}
	for _, action := range state.Actions {
		if action.Sequence != 7 {
			t.Fatalf("action %+v does not carry the frame sequence it came from", action)
		}
	}
	if state.Applied != 1 {
		t.Fatalf("applied = %d, want 1", state.Applied)
	}
}

// Position alone produces nothing on a terminal — there is no cursor — and it
// is counted as refused rather than applied so the two are never added
// together. It is still recorded: where the remote pointer is remains the
// answer to "is this link alive".
func TestMovementIsRecordedButCountedApart(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	position := protocol.NormalizePixels(1280, 720, 2560, 1440)
	if err := projection.Apply(1, frame(t, protocol.PointerEvent{Position: position})); err != nil {
		t.Fatal(err)
	}
	state := projection.State()
	if state.Applied != 0 || state.Refused != 1 {
		t.Fatalf("applied=%d refused=%d, want movement counted apart from applied", state.Applied, state.Refused)
	}
	if state.LastPosition == nil || *state.LastPosition != position {
		t.Fatalf("last position = %+v, want %+v", state.LastPosition, position)
	}
	if state.LastSeen == "" {
		t.Fatal("last_seen is empty; a projection with no clock cannot answer whether the link is alive")
	}
}

// A frame that is not a pointer event fails the write, which fails the
// binding. Skipping it would leave the binding green while every gesture
// disappeared.
func TestUndecodableFrameFailsTheWrite(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	for name, payload := range map[string][]byte{
		"not json":       []byte("{"),
		"another schema": []byte(`{"usage":4,"down":true}`),
		"unknown button": []byte(`{"position":{"x":0,"y":0},"buttons":["thumb"]}`),
	} {
		if err := projection.Apply(1, payload); err == nil {
			t.Fatalf("%s: write succeeded; a frame this side cannot use must fail the binding", name)
		}
	}
	if state := projection.State(); state.Refused != 3 || state.LastError == "" {
		t.Fatalf("refused=%d last_error=%q, want three refusals with a reason", state.Refused, state.LastError)
	}
}

// Buttons held across a lease that ends must not survive it: the next binding
// would inherit somebody else's press.
func TestDetachReleasesHeldButtons(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileTmux)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	if err := projection.Apply(1, frame(t, protocol.PointerEvent{Buttons: []protocol.PointerButton{protocol.PointerButtonLeft}})); err != nil {
		t.Fatal(err)
	}
	projection.Detach("bnd-1")
	if err := projection.Attach("bnd-2"); err != nil {
		t.Fatal(err)
	}
	if err := projection.Apply(2, frame(t, protocol.PointerEvent{Buttons: []protocol.PointerButton{protocol.PointerButtonLeft}})); err != nil {
		t.Fatal(err)
	}
	// A press that was never released would make this second press invisible.
	found := false
	for _, action := range projection.State().Actions {
		if action.Sequence == 2 && action.Intent == "selection-begin" {
			found = true
		}
	}
	if !found {
		t.Fatal("the new binding's press produced nothing; the previous lease's button was still held")
	}
}

// The recorded action window is bounded. Pointer traffic is high frequency and
// an unbounded log is a memory leak with a friendly name.
func TestRecordedActionsAreAWindowNotATranscript(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	for sequence := uint64(0); sequence < maxRecordedActions*3; sequence++ {
		if err := projection.Apply(sequence, frame(t, protocol.PointerEvent{ScrollY: 1})); err != nil {
			t.Fatal(err)
		}
	}
	state := projection.State()
	if len(state.Actions) != maxRecordedActions {
		t.Fatalf("recorded actions = %d, want the window size %d", len(state.Actions), maxRecordedActions)
	}
	if state.Actions[len(state.Actions)-1].Sequence != maxRecordedActions*3-1 {
		t.Fatalf("window keeps the wrong end: last sequence = %d", state.Actions[len(state.Actions)-1].Sequence)
	}
}

// Whether this node can inject is reported from the first version, because a
// module that is installed while the thing it installs for quietly does not
// work is the trap that keeps getting sprung.
//
// The two halves are pinned separately and on purpose. Implemented follows the
// build — Linux has a uinput backend, nothing else does yet — and Available
// follows the machine. Folding them into one boolean would answer "why is my
// pointer not moving" with one word for two problems that are fixed by
// different people: one by installing a udev rule on this node, the other by
// shipping a different build to it.
func TestInjectionStatusIsAlwaysReportedWithAReason(t *testing.T) {
	status := ProbeInjection()
	wantImplemented := runtime.GOOS == "linux"
	if status.Implemented != wantImplemented {
		t.Fatalf("implemented = %v on %s, want %v", status.Implemented, runtime.GOOS, wantImplemented)
	}
	if status.Platform == "" || status.Detail == "" {
		t.Fatalf("injection status = %+v, want the platform checked and why", status)
	}
	// Ready is the only place the two are allowed to meet.
	if status.Ready() != (status.Implemented && status.Available) {
		t.Fatalf("Ready() = %v for %+v", status.Ready(), status)
	}
}
