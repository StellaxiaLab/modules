package vdevice

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMissingStateFileIsAnEmptyStateNotAnError(t *testing.T) {
	state, err := NewStore(filepath.Join(t.TempDir(), StateFileName)).Load()
	if err != nil {
		t.Fatalf("a module that has never been configured must load cleanly: %v", err)
	}
	if len(state.Slots) != 0 || len(state.Projections) != 0 {
		t.Fatal("an absent file produced content")
	}
}

func TestCorruptStateFileIsAnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	if err := os.WriteFile(path, []byte("{oops"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path).Load(); err == nil {
		t.Fatal("a corrupt state file loaded as if it were empty; the operator's slots would vanish silently")
	}
}

func TestSaveIsStableAcrossRewrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	store := NewStore(path)
	state := newState()
	moment := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	for _, id := range []string{"camera-b", "camera-a"} {
		state.Slots[id] = Slot{SlotID: id, Kind: KindCamera, AdapterID: FakeAdapterID, CreatedAt: moment, UpdatedAt: moment}
	}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("rewriting unchanged state produced different bytes; map order leaked into the file")
	}
}

// §19.2 lists the tables; Phase 0 writes the ones it has content for. The empty
// list is written rather than omitted, because "this module installed nothing"
// and "this file does not say" are different statements.
func TestSaveWritesTheSectionNamesOfTheDesign(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	if err := NewStore(path).Save(newState()); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	for _, section := range []string{"schema_version", "adapter_installations", "slots", "projection_declarations"} {
		if _, ok := document[section]; !ok {
			t.Errorf("the state document has no %q section", section)
		}
	}
}

func TestUnknownSchemaVersionIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	if err := os.WriteFile(path, []byte(`{"schema_version":99,"slots":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path).Load(); err == nil {
		t.Fatal("a state file from a future build was read with this build's field set")
	}
}

// §19.2: no token, no lease secret, no frame payload on disk. The Slot and
// Declaration types have no field for any of them; this holds that shape.
func TestNothingSecretReachesTheStateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), StateFileName)
	store := NewStore(path)
	state := newState()
	state.Slots["camera-main"] = Slot{SlotID: "camera-main", Kind: KindCamera, AdapterID: FakeAdapterID}
	state.Projections["proj-camera-main"] = ProjectionDeclaration{
		ProjectionID: "proj-camera-main",
		SlotID:       "camera-main",
		Source:       Source{ResourceID: "io.camera.usb-7", EndpointID: "video"},
		Generation:   1,
	}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	declarations, _ := document["projection_declarations"].([]any)
	if len(declarations) != 1 {
		t.Fatalf("declarations = %d, want 1", len(declarations))
	}
	stored, _ := declarations[0].(map[string]any)
	for _, forbidden := range []string{"handle_id", "lease", "token", "credential", "frame", "secret"} {
		if _, present := stored[forbidden]; present {
			t.Errorf("the state file carries %q; §19.2 forbids it", forbidden)
		}
	}
}
