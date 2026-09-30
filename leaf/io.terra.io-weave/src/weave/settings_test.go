package weave

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	ioweave "github.com/terra-project/terra/products/common/packages/terra-io-weave"
	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

// A node that has said nothing gets the assumption that refuses the most and
// invents the least: a bare shell declines a wheel with a reason, where
// assuming tmux would send arrow keys into a shell and walk its history.
func TestUnconfiguredNodeDefaultsToTheProfileThatRefuses(t *testing.T) {
	settings, err := NewSettingsStore(filepath.Join(t.TempDir(), "settings.json")).Load()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Profile != ioweave.ProfileShell {
		t.Fatalf("default profile = %q, want shell", settings.Profile)
	}
}

func TestSettingsSurviveARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	projection, err := NewProjection(NewSettingsStore(path), InjectionStatus{Platform: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := projection.Configure(Settings{Profile: ioweave.ProfileTmux, SourceLayout: "us"}); err != nil {
		t.Fatal(err)
	}
	// A fresh projection over the same file is what a module restart is.
	restarted, err := NewProjection(NewSettingsStore(path), InjectionStatus{Platform: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Settings().Profile != ioweave.ProfileTmux {
		t.Fatalf("profile after restart = %q, want tmux", restarted.Settings().Profile)
	}
	if restarted.State().Profile != string(ioweave.ProfileTmux) {
		t.Fatalf("reported profile = %q", restarted.State().Profile)
	}
}

// An unknown profile is refused rather than quietly replaced. A node answering
// gestures in a way nobody chose looks exactly like a working configuration.
func TestUnknownProfileIsRefusedRatherThanDefaulted(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	projection, err := NewProjection(NewSettingsStore(path), InjectionStatus{Platform: "test"})
	if err != nil {
		t.Fatal(err)
	}
	err = projection.Configure(Settings{Profile: "screen"})
	if err == nil {
		t.Fatal("an unknown profile was accepted")
	}
	if !strings.Contains(err.Error(), "screen") {
		t.Fatalf("error = %v, want it to name what was asked for", err)
	}
	if projection.Settings().Profile != ioweave.ProfileShell {
		t.Fatalf("a refused change took effect: %q", projection.Settings().Profile)
	}
	if _, statErr := os.Stat(path); statErr == nil {
		t.Fatal("a refused change was persisted")
	}
}

// A stored file this build cannot make sense of stops the module rather than
// starting it on a guess. Silently reverting to defaults would answer a
// remote pointer differently from how the node was set up, with nothing
// anywhere saying so.
func TestUnreadableSettingsStopStartupInsteadOfDefaulting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, []byte(`{"schema_version":99,"settings":{"profile":"shell"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewProjection(NewSettingsStore(path), InjectionStatus{Platform: "test"}); err == nil {
		t.Fatal("a settings file from a future schema started the module anyway")
	}
}

// Changing the profile mid-lease releases what is held. A drag that began
// under one profile means nothing under the other, and a press carried across
// would be a button nobody ever releases.
func TestConfigureReleasesTheHeldButton(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileTmux)
	if err := projection.Attach("bnd-1"); err != nil {
		t.Fatal(err)
	}
	if err := projection.Apply(1, frame(t, protocol.PointerEvent{Buttons: []protocol.PointerButton{protocol.PointerButtonLeft}})); err != nil {
		t.Fatal(err)
	}
	if err := projection.Configure(Settings{Profile: ioweave.ProfileTmux, SourceLayout: "us"}); err != nil {
		t.Fatal(err)
	}
	if err := projection.Apply(2, frame(t, protocol.PointerEvent{Buttons: []protocol.PointerButton{protocol.PointerButtonLeft}})); err != nil {
		t.Fatal(err)
	}
	pressedAgain := false
	for _, action := range projection.State().Actions {
		if action.Sequence == 2 && action.Intent == "selection-begin" {
			pressedAgain = true
		}
	}
	if !pressedAgain {
		t.Fatal("the button held before the change was still held after it")
	}
	// The lease itself is untouched: reconfiguring is not a reason to drop a
	// binding the Master orchestrated.
	if !projection.State().Bound {
		t.Fatal("reconfiguring released the binding")
	}
}
