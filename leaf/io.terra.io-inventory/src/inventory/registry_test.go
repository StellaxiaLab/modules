package inventory

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	coresvi "github.com/terra-project/terra/products/common/packages/terra-svi"
)

func TestRegistryEnforcesApprovalEnableAndPresence(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(Device{
		ID:                 "camera-1",
		Name:               "Camera",
		Kind:               DeviceCamera,
		Capabilities:       []string{"video.frame"},
		PermissionRequired: true,
	}); err != nil {
		t.Fatal(err)
	}

	device, err := registry.Get("camera-1")
	if err != nil {
		t.Fatal(err)
	}
	if device.Presence != PresenceUnknown || device.Approval != ApprovalPending || device.Enabled || device.Available {
		t.Fatalf("unexpected initial state: %#v", device)
	}
	if _, err := registry.SetEnabled("camera-1", true); !errors.Is(err, ErrDeviceNotApproved) {
		t.Fatalf("enable before approval error = %v", err)
	}
	if _, err := registry.SetApproval("camera-1", ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	device, err = registry.SetEnabled("camera-1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !device.Enabled || device.Available {
		t.Fatalf("unknown device must remain unavailable: %#v", device)
	}
	device, err = registry.SetPresence("camera-1", PresencePresent)
	if err != nil {
		t.Fatal(err)
	}
	if !device.Available || device.FirstSeenAt.IsZero() || device.LastSeenAt.IsZero() {
		t.Fatalf("present approved device must be available: %#v", device)
	}

	if err := registry.SetActive("camera-1", true); err != nil {
		t.Fatal(err)
	}
	device, _ = registry.Get("camera-1")
	usage, err := registry.UsageFor("camera-1")
	if err != nil {
		t.Fatal(err)
	}
	if usage.Sessions != 1 || device.RuntimeState != RuntimeActive {
		t.Fatalf("unexpected active state: device=%#v usage=%#v", device, usage)
	}
	device, err = registry.SetApproval("camera-1", ApprovalDenied)
	if err != nil {
		t.Fatal(err)
	}
	if device.Enabled || device.Available || device.Approval != ApprovalDenied {
		t.Fatalf("denied device must be disabled: %#v", device)
	}
}

func TestRegistryPreservesLegacyAvailableRegistration(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(Device{ID: "microphone-1", Name: "Microphone", Kind: DeviceMicrophone, Available: true}); err != nil {
		t.Fatal(err)
	}
	device, err := registry.Get("microphone-1")
	if err != nil {
		t.Fatal(err)
	}
	if device.Presence != PresencePresent || device.Approval != ApprovalApproved || !device.Enabled || !device.Available {
		t.Fatalf("legacy available registration was not normalized: %#v", device)
	}
}

func TestPersistentRegistryRestoresPolicyButNotPresence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "io", "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(Device{ID: "camera-1", Name: "Camera", Kind: DeviceCamera, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetApproval("camera-1", ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetEnabled("camera-1", true); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetAlias("camera-1", "Desk camera"); err != nil {
		t.Fatal(err)
	}

	restored, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.Register(Device{ID: "camera-1", Name: "Camera", Kind: DeviceCamera, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	device, err := restored.Get("camera-1")
	if err != nil {
		t.Fatal(err)
	}
	if device.Alias != "Desk camera" || device.Approval != ApprovalApproved || !device.Enabled {
		t.Fatalf("policy was not restored: %#v", device)
	}
	if device.Presence != PresenceUnknown || device.Available {
		t.Fatalf("live presence must not be restored from policy: %#v", device)
	}
}

func TestSyncMarksVanishedDevicesMissingAndKeepsPolicy(t *testing.T) {
	registry := NewRegistry()
	scanned := []Device{
		{ID: "mouse-1", Name: "Mouse", Kind: DeviceMouse, PermissionRequired: true},
		{ID: "keyboard-1", Name: "Keyboard", Kind: DeviceKeyboard, PermissionRequired: true},
	}

	result, err := registry.Sync("adapter.os-discovery", scanned)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Added) != 2 || len(result.Updated) != 0 || len(result.Missing) != 0 {
		t.Fatalf("first scan = %#v", result)
	}

	if _, err := registry.SetApproval("mouse-1", ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetAlias("mouse-1", "Desk mouse"); err != nil {
		t.Fatal(err)
	}

	// The mouse is unplugged: it must survive the scan as missing, carrying the
	// policy a person set for it.
	result, err = registry.Sync("adapter.os-discovery", scanned[1:])
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Added) != 0 || len(result.Updated) != 1 || len(result.Missing) != 1 || result.Missing[0] != "mouse-1" {
		t.Fatalf("second scan = %#v", result)
	}
	device, err := registry.Get("mouse-1")
	if err != nil {
		t.Fatal(err)
	}
	if device.Presence != PresenceMissing || device.Available {
		t.Fatalf("unplugged device = %#v", device)
	}
	if device.Approval != ApprovalApproved || device.Alias != "Desk mouse" {
		t.Fatalf("policy must outlive the cable: %#v", device)
	}

	// Still gone on the next scan, but no longer news.
	result, err = registry.Sync("adapter.os-discovery", scanned[1:])
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Missing) != 0 {
		t.Fatalf("missing must report what changed: %#v", result)
	}

	// Plugged back in: the device returns with its policy intact.
	result, err = registry.Sync("adapter.os-discovery", scanned)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Updated) != 2 || len(result.Added) != 0 {
		t.Fatalf("return scan = %#v", result)
	}
	if device, err = registry.Get("mouse-1"); err != nil {
		t.Fatal(err)
	}
	if device.Presence != PresencePresent || device.Alias != "Desk mouse" {
		t.Fatalf("returned device = %#v", device)
	}
}

func TestSyncLeavesOtherAdaptersAlone(t *testing.T) {
	registry := NewRegistry()
	// A logical provider slot, exactly as main.go registers them.
	if err := registry.Register(Device{ID: "camera-default", Name: "Default camera", Kind: DeviceCamera, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetPresence("camera-default", PresencePresent); err != nil {
		t.Fatal(err)
	}

	result, err := registry.Sync("adapter.os-discovery", []Device{{ID: "mouse-1", Name: "Mouse", Kind: DeviceMouse}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Missing) != 0 {
		t.Fatalf("a scan must not touch another adapter's devices: %#v", result)
	}
	slot, err := registry.Get("camera-default")
	if err != nil {
		t.Fatal(err)
	}
	if slot.Presence != PresencePresent {
		t.Fatalf("logical slot = %#v", slot)
	}
	if _, err := registry.Sync("", nil); err == nil {
		t.Fatal("an adapter id is required")
	}
}

func TestSVIResourcesPassCoreValidation(t *testing.T) {
	registry := NewRegistry()
	// One device of every kind, so the mapping is checked against the core's
	// grammar rather than against whichever kinds happen to be registered.
	for _, kind := range []DeviceKind{DeviceCamera, DeviceMicrophone, DeviceScreen, DeviceKeyboard, DeviceMouse, DeviceRawBus} {
		if err := registry.Register(Device{ID: string(kind) + "-1", Name: string(kind), Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}

	now := time.Now().UTC()
	for _, resource := range registry.SVIResources() {
		// The module leaves these for the daemon's remote adapter to stamp;
		// fill them in so the check is about what the module owns.
		resource.NodeID = "node-1"
		resource.ProviderID = "module.io.terra.io-inventory"
		resource.Owner = coresvi.SubjectRef{Type: coresvi.SubjectNode, ID: "node-1"}
		resource.ExpiresAt = now.Add(time.Minute)
		if err := coresvi.ValidateResource(resource); err != nil {
			t.Fatalf("kind %q: %v", resource.Kind, err)
		}
	}
}

// An HTTP camera is a camera — same kind, same schema — but it sends JPEG, not
// H.264. Publishing the kind's encoding would tell a consumer something false
// about what arrives when it binds the endpoint. An RTSP camera keeps the
// kind's encoding.
func TestSVIEncodingsFollowTheAdapter(t *testing.T) {
	registry := NewRegistry()
	for _, device := range []Device{
		{ID: "camera-http", Name: "Porch", Kind: DeviceCamera, AdapterID: "manual.http-camera"},
		{ID: "camera-rtsp", Name: "Door", Kind: DeviceCamera, AdapterID: "manual.rtsp"},
	} {
		if err := registry.Register(device); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	encodings := map[string][]string{}
	for _, resource := range registry.SVIResources() {
		endpoint := resource.Endpoints[0]
		if endpoint.OutputSchema != "terra.video.frame@1" {
			t.Errorf("%s schema = %s, want terra.video.frame@1", resource.ResourceID, endpoint.OutputSchema)
		}
		encodings[resource.ResourceID] = endpoint.Encodings
		resource.NodeID = "node-1"
		resource.ProviderID = "module.io.terra.io-inventory"
		resource.Owner = coresvi.SubjectRef{Type: coresvi.SubjectNode, ID: "node-1"}
		resource.ExpiresAt = now.Add(time.Minute)
		if err := coresvi.ValidateResource(resource); err != nil {
			t.Fatalf("%s: %v", resource.ResourceID, err)
		}
	}
	if got := encodings["io.camera-http"]; len(got) != 2 || got[0] != "image/jpeg" || got[1] != "multipart/x-mixed-replace" {
		t.Errorf("HTTP camera encodings = %v, want [image/jpeg multipart/x-mixed-replace]", got)
	}
	if got := encodings["io.camera-rtsp"]; len(got) != 1 || got[0] != "video/h264" {
		t.Errorf("RTSP camera encodings = %v, want [video/h264]", got)
	}
}

// The three slots reserved for io-weave must be published from the start.
// Adding one later is a schema_ref major bump, and each is already known to be
// needed: what injection costs (D-9), where the reverse channel will go
// (D-10), and who currently holds the device (§6.1).
//
// The arbitration slot has a second job. Nothing arbitrates yet, so it must
// say "unmeasured" — never "idle". A consumer told a device is idle will take
// it; a consumer told nobody has looked will ask.
func TestPublishedEndpointsKeepTheReservedSlots(t *testing.T) {
	registry := NewRegistry()
	for _, kind := range []DeviceKind{DeviceMouse, DeviceKeyboard, DeviceRawBus, DeviceCamera} {
		if err := registry.Register(Device{ID: string(kind) + "-1", Name: string(kind), Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}

	wantTier := map[string]string{
		"io.mouse": "pointer", "io.keyboard": "keyboard",
		"io.raw-bus": "raw", "io.camera": "observe",
	}
	seen := map[string]bool{}
	for _, resource := range registry.SVIResources() {
		metadata := resource.Endpoints[0].Metadata
		tier, ok := metadata["permission_tier"].(string)
		if !ok {
			t.Fatalf("%s: no permission_tier — a consumer cannot see what injection costs", resource.Kind)
		}
		if want := wantTier[resource.Kind]; tier != want {
			t.Errorf("%s: permission_tier = %q, want %q", resource.Kind, tier, want)
		}
		if _, ok := metadata["feedback"]; !ok {
			t.Errorf("%s: no feedback slot", resource.Kind)
		}
		if state := metadata["arbitration_state"]; state != "unmeasured" {
			t.Errorf("%s: arbitration_state = %v, want unmeasured — nothing arbitrates yet", resource.Kind, state)
		}
		if reason, _ := metadata["arbitration_reason"].(string); reason == "" {
			t.Errorf("%s: arbitration_state is unmeasured with no reason", resource.Kind)
		}
		seen[resource.Kind] = true
	}
	for kind := range wantTier {
		if !seen[kind] {
			t.Errorf("%s was not published at all", kind)
		}
	}
}

// TestForgetIsNotWhatAMissingDeviceGets holds the two verbs apart. They are the
// pair a person will confuse first, and the wrong one silently destroys policy
// the other exists to protect.
func TestForgetIsNotWhatAMissingDeviceGets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"mouse-1", "keyboard-1"} {
		if err := registry.Register(Device{ID: id, Name: id, Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := registry.SetApproval(id, ApprovalApproved); err != nil {
			t.Fatal(err)
		}
		if _, err := registry.SetAlias(id, "Desk "+id); err != nil {
			t.Fatal(err)
		}
	}

	// The cable comes out of one of them.
	if _, err := registry.SetPresence("mouse-1", PresenceMissing); err != nil {
		t.Fatal(err)
	}
	missing, err := registry.Get("mouse-1")
	if err != nil {
		t.Fatal(err)
	}
	if missing.Approval != ApprovalApproved || missing.Alias != "Desk mouse-1" {
		t.Fatalf("a device that went missing lost its policy: %#v", missing)
	}

	// The person says the other one is not theirs any more.
	tombstone, err := registry.Forget("keyboard-1")
	if err != nil {
		t.Fatal(err)
	}
	if tombstone.DeviceID != "keyboard-1" || tombstone.Approval != ApprovalApproved || tombstone.Alias != "Desk keyboard-1" {
		t.Fatalf("tombstone = %#v; it has to record what was forgotten, not only that something was", tombstone)
	}
	if tombstone.ForgottenAt.IsZero() {
		t.Fatal("a tombstone with no time is not a record")
	}
	if _, err := registry.Get("keyboard-1"); !errors.Is(err, ErrDeviceNotFound) {
		t.Fatalf("forgotten device still listed: %v", err)
	}
	if _, err := registry.UsageFor("keyboard-1"); !errors.Is(err, ErrDeviceNotFound) {
		t.Fatalf("forgotten device still carries usage: %v", err)
	}
	if _, err := registry.Forget("keyboard-1"); !errors.Is(err, ErrDeviceNotFound) {
		t.Fatalf("forgetting twice = %v, want not found", err)
	}
}

// TestTombstonesAndTheDroppedPolicySurviveARestart is the part a response body
// cannot prove. A forget that is only in memory is a forget that a restart
// undoes — and the policy would come back with it.
func TestTombstonesAndTheDroppedPolicySurviveARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(Device{ID: "mouse-1", Name: "Mouse", Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetApproval("mouse-1", ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Forget("mouse-1"); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	tombstones := restarted.Tombstones()
	if len(tombstones) != 1 || tombstones[0].DeviceID != "mouse-1" {
		t.Fatalf("tombstones after restart = %#v", tombstones)
	}

	// The same hardware is enumerated again. It comes back — a tombstone is
	// history, not a blocklist — but through the default-deny door, because the
	// approval the person gave it went with the forget.
	if err := restarted.Register(Device{ID: "mouse-1", Name: "Mouse", Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	device, err := restarted.Get("mouse-1")
	if err != nil {
		t.Fatal(err)
	}
	if device.Approval != ApprovalPending || device.Available {
		t.Fatalf("a forgotten device came back already approved: %#v", device)
	}
	if len(restarted.Tombstones()) != 1 {
		t.Fatal("rediscovery erased the record that a person had forgotten this device")
	}
}

// TestAdoptPoliciesMovesPolicyOntoTheNewId is the upgrade path. Without it,
// deriving a better id would itself do the damage it exists to prevent: every
// approval and alias on every running node stranded under a name nothing
// answers to.
func TestAdoptPoliciesMovesPolicyOntoTheNewId(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(Device{ID: "mouse-legacy", Name: "Mouse", Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetApproval("mouse-legacy", ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetEnabled("mouse-legacy", true); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetAlias("mouse-legacy", "Desk mouse"); err != nil {
		t.Fatal(err)
	}

	// A restart: policy comes back, devices do not (IO-5), and the scan now
	// derives a different id for the same hardware.
	restarted, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	adopted, err := restarted.AdoptPolicies(map[string]string{"mouse-046d-c534-2f417bd9": "mouse-legacy"})
	if err != nil {
		t.Fatal(err)
	}
	if len(adopted) != 1 || adopted[0] != "mouse-046d-c534-2f417bd9" {
		t.Fatalf("adopted = %v", adopted)
	}
	if err := restarted.Register(Device{ID: "mouse-046d-c534-2f417bd9", Name: "Mouse", Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	device, err := restarted.Get("mouse-046d-c534-2f417bd9")
	if err != nil {
		t.Fatal(err)
	}
	if device.Approval != ApprovalApproved || device.Alias != "Desk mouse" || !device.Available {
		t.Fatalf("policy did not follow the device onto its new id: %#v", device)
	}

	// Running it again finds nothing left to move, and the legacy entry is gone
	// from disk rather than left to accumulate.
	again, err := restarted.AdoptPolicies(map[string]string{"mouse-046d-c534-2f417bd9": "mouse-legacy"})
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("second adoption = %v, want nothing", again)
	}
	reloaded, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := reloaded.Register(Device{ID: "mouse-legacy", Name: "Mouse", Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
		t.Fatal(err)
	}
	stale, err := reloaded.Get("mouse-legacy")
	if err != nil {
		t.Fatal(err)
	}
	if stale.Approval != ApprovalPending {
		t.Fatalf("the legacy policy is still on disk: %#v", stale)
	}
}

// AdoptPolicies must never take policy away from a device that already has it.
func TestAdoptPoliciesNeverOverwritesPolicyThatIsAlreadyThere(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"mouse-current", "mouse-legacy"} {
		if err := registry.Register(Device{ID: id, Name: id, Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent, PermissionRequired: true}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := registry.SetAlias("mouse-current", "the one in use"); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.SetAlias("mouse-legacy", "the old name"); err != nil {
		t.Fatal(err)
	}

	adopted, err := registry.AdoptPolicies(map[string]string{"mouse-current": "mouse-legacy"})
	if err != nil {
		t.Fatal(err)
	}
	if len(adopted) != 0 {
		t.Fatalf("adopted = %v; the current id already carried policy", adopted)
	}
	current, err := registry.Get("mouse-current")
	if err != nil {
		t.Fatal(err)
	}
	if current.Alias != "the one in use" {
		t.Fatalf("alias = %q", current.Alias)
	}
}

// The state file must not grow without bound on a node where devices come and
// go, and what it drops has to be the oldest.
func TestTombstonesAreCappedOldestFirst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	registry, err := NewPersistentRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < maxTombstones+5; index++ {
		id := "mouse-" + time.Unix(int64(index), 0).UTC().Format("150405.000")
		if err := registry.Register(Device{ID: id, Name: id, Kind: DeviceMouse, AdapterID: "adapter.os-discovery", Presence: PresencePresent}); err != nil {
			t.Fatal(err)
		}
		if _, err := registry.Forget(id); err != nil {
			t.Fatal(err)
		}
	}
	tombstones := registry.Tombstones()
	if len(tombstones) != maxTombstones {
		t.Fatalf("tombstones = %d, want %d", len(tombstones), maxTombstones)
	}
	for index := 1; index < len(tombstones); index++ {
		if tombstones[index].ForgottenAt.After(tombstones[index-1].ForgottenAt) {
			t.Fatal("tombstones are not newest first")
		}
	}
}
