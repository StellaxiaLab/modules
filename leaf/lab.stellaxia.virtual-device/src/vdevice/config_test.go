package vdevice

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The shipped example is the one configuration file an operator actually
// starts from. If its keys do not decode into Config, every field they edit is
// silently ignored — the failure nobody sees, because the process starts fine.
func TestShippedExampleFileDecodesAndValidates(t *testing.T) {
	example := filepath.Join("..", "..", "config", "virtual-device.example.json")
	raw, err := os.ReadFile(example)
	if err != nil {
		t.Fatalf("read shipped example: %v", err)
	}

	config := DefaultConfig()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		t.Fatalf("the shipped example has a key Config does not know: %v", err)
	}
	if err := config.Validate(); err != nil {
		t.Fatalf("the shipped example does not validate: %v", err)
	}

	// Decoding is not enough: a field could decode into a zero value because
	// its json tag is wrong. Check the values the example actually sets.
	if config.Video.MaxFrameBytes != 16777216 {
		t.Errorf("video.max_frame_bytes = %d, want 16777216", config.Video.MaxFrameBytes)
	}
	if config.Daemon.ReconnectMaxBackoffMS != 30000 {
		t.Errorf("daemon.reconnect_max_backoff_ms = %d, want 30000", config.Daemon.ReconnectMaxBackoffMS)
	}
	if config.Audio.Underflow != "silence" {
		t.Errorf("audio.underflow = %q, want silence", config.Audio.Underflow)
	}
	if config.Video.StaleFrameAfterMS != 500 {
		t.Errorf("video.stale_frame_after_ms = %d, want 500", config.Video.StaleFrameAfterMS)
	}
}

func TestMissingFileIsDefaultsAndIsReportedAsMissing(t *testing.T) {
	config, err := LoadConfig(filepath.Join(t.TempDir(), "absent.json"))
	if !errors.Is(err, ErrConfigNotFound) {
		t.Fatalf("err = %v, want ErrConfigNotFound", err)
	}
	if config.Video.MaxQueueFrames != DefaultConfig().Video.MaxQueueFrames {
		t.Fatal("a missing file must leave the defaults in place")
	}
}

func TestUnreadableFileIsNotReportedAsMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfig(path)
	if err == nil {
		t.Fatal("a malformed file must be an error")
	}
	if errors.Is(err, ErrConfigNotFound) {
		t.Fatal("a malformed file reported as missing hides the operator's typo")
	}
}

func TestPartialFileKeepsDocumentedDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), ConfigFileName)
	if err := os.WriteFile(path, []byte(`{"schema_version":1,"video":{"max_queue_frames":8}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if config.Video.MaxQueueFrames != 8 {
		t.Errorf("max_queue_frames = %d, want the file's 8", config.Video.MaxQueueFrames)
	}
	if config.Video.MaxFrameBytes != DefaultConfig().Video.MaxFrameBytes {
		t.Errorf("max_frame_bytes = %d, want the default", config.Video.MaxFrameBytes)
	}
	if config.Projection.DefaultLifecycle != LifecyclePersistent {
		t.Errorf("default_lifecycle = %q, want the default", config.Projection.DefaultLifecycle)
	}
}

// The three security invariants are expressible in the file and refused by it.
// That is the point: an operator reading the file learns the rule; an operator
// flipping it learns the rule harder.
func TestSecurityInvariantsCannotBeTurnedOn(t *testing.T) {
	for _, body := range []string{
		`{"schema_version":1,"security":{"external_listen":true}}`,
		`{"schema_version":1,"security":{"allow_unsigned_adapter":true}}`,
		`{"schema_version":1,"diagnostics":{"persist_frame_payload":true}}`,
	} {
		path := filepath.Join(t.TempDir(), ConfigFileName)
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadConfig(path); err == nil {
			t.Errorf("%s was accepted; the design fixes this value", body)
		}
	}
}

func TestWrongSchemaVersionIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), ConfigFileName)
	if err := os.WriteFile(path, []byte(`{"schema_version":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("a file naming another schema version must be refused, not half-read")
	}
}

func TestResolveConfigPathPrefersFlagThenModuleDir(t *testing.T) {
	env := func(key string) string {
		if key == "TERRA_MODULE_DIR" {
			return filepath.Join("opt", "terra", "module", ModuleID)
		}
		return ""
	}
	if got := ResolveConfigPath("/etc/custom.json", env); got != "/etc/custom.json" {
		t.Errorf("flag path = %q, want the flag to win", got)
	}
	want := filepath.Join("opt", "terra", "module", ModuleID, "config", ConfigFileName)
	if got := ResolveConfigPath("", env); got != want {
		t.Errorf("module dir path = %q, want %q", got, want)
	}
	if got := ResolveConfigPath("", func(string) string { return "" }); got != filepath.Join("config", ConfigFileName) {
		t.Errorf("fallback path = %q, want config/%s", got, ConfigFileName)
	}
}

func TestLinuxDevicesAcceptOnlyVideoNodes(t *testing.T) {
	valid := DefaultConfig()
	valid.Linux.Devices = map[string]string{"camera-main": "/dev/video10", "camera-two": "/dev/video11"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid devices refused: %v", err)
	}
	for name, devices := range map[string]map[string]string{
		"arbitrary path":     {"camera-main": "/etc/passwd"},
		"traversal":          {"camera-main": "/dev/video0/../../etc/passwd"},
		"relative":           {"camera-main": "video10"},
		"trailing text":      {"camera-main": "/dev/video10x"},
		"not a video node":   {"camera-main": "/dev/null"},
		"bad slot id":        {"Camera Main": "/dev/video10"},
		"one node two slots": {"camera-main": "/dev/video10", "camera-two": "/dev/video10"},
		"empty path":         {"camera-main": ""},
		"number too long":    {"camera-main": "/dev/video12345"},
		"windows style":      {"camera-main": `\.\video10`},
	} {
		config := DefaultConfig()
		config.Linux.Devices = devices
		if err := config.Validate(); err == nil {
			t.Errorf("%s: %v was accepted", name, devices)
		}
	}
}

func TestLinuxDevicesComeFromTheConfigurationFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "virtual-device.json")
	if err := os.WriteFile(path, []byte(`{"schema_version":1,"linux":{"devices":{"camera-main":"/dev/video10"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := config.Linux.Devices["camera-main"]; got != "/dev/video10" {
		t.Errorf("linux.devices[camera-main] = %q", got)
	}
	if err := os.WriteFile(path, []byte(`{"schema_version":1,"linux":{"devices":{"camera-main":"/tmp/x"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(path); err == nil {
		t.Error("a non-/dev/video path in the file was accepted")
	}
}

// video.fallback only has one behaviour. A value the module would not honour is
// refused rather than accepted and silently shown as black.
func TestVideoFallbackAcceptsOnlyBlack(t *testing.T) {
	config := DefaultConfig()
	if err := config.Validate(); err != nil {
		t.Fatalf("default: %v", err)
	}
	for _, bad := range []string{"last_frame", "", "BLACK"} {
		config := DefaultConfig()
		config.Video.Fallback = bad
		if err := config.Validate(); err == nil {
			t.Errorf("video.fallback %q was accepted", bad)
		}
	}
}
