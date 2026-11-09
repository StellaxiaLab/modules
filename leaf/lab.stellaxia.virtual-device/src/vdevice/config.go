// Package vdevice holds the lab.stellaxia.virtual-device module: the
// configuration file, the Slot/Projection/Adapter contracts of the detailed
// design §9, the control API, the SVI sink that receives frames (feed.go), the
// in-memory Fake adapter and the Linux v4l2loopback adapter, and the state store
// that keeps declared desired state across restarts.
//
// Frames reach an adapter through the Daemon-opened SVI sink (the module has no
// connection of its own); the adapters are OS-specific and the rest is not.
package vdevice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ConfigSchemaVersion is the only configuration schema version this build
// accepts. A file naming another version is refused rather than read with the
// fields this build happens to recognise — a half-understood security block is
// worse than no file at all.
const ConfigSchemaVersion = 1

// Projection lifecycle values (design §9.3). They are declared here because
// the configuration file is the first place a reader meets them
// (projection.default_lifecycle); the domain model in model.go uses the same
// two constants.
const (
	// LifecyclePersistent survives a restart: the declaration is stored and
	// reconciled again when the module comes back.
	LifecyclePersistent = "persistent"
	// LifecycleSession lives only as long as the session that declared it.
	LifecycleSession = "session"
)

// ConfigFileName is the configuration file the module reads from its package
// directory. The example shipped in the package is
// config/virtual-device.example.json; an operator copies it to this name.
const ConfigFileName = "virtual-device.json"

// ModuleID is this module's manifest id.
const ModuleID = "lab.stellaxia.virtual-device"

// Config is the module configuration of the detailed design §18. The field
// names are those of the shipped example file, verbatim: a configuration whose
// keys differ from its own example is a configuration nobody can write.
//
// Most of what is in here is validated and reported (diagnostics) but NOT yet
// acted on. Each field's comment says which; the README table repeats it. A
// setting that parses is not a setting that works.
type Config struct {
	SchemaVersion int               `json:"schema_version"`
	ModuleID      string            `json:"module_id"`
	Daemon        DaemonConfig      `json:"daemon"`
	Projection    ProjectionConfig  `json:"projection"`
	Video         VideoConfig       `json:"video"`
	Audio         AudioConfig       `json:"audio"`
	Security      SecurityConfig    `json:"security"`
	Diagnostics   DiagnosticsConfig `json:"diagnostics"`
	Linux         LinuxConfig       `json:"linux"`
}

// LinuxConfig is read by the Linux v4l2loopback adapter and ignored elsewhere.
// This module never creates a loopback device (that is a kernel module the
// operator or Setup loads); it only writes into nodes that already exist.
type LinuxConfig struct {
	// Devices maps a Slot id to the loopback node that Slot writes into, for
	// example {"camera-main": "/dev/video10"}. Only /dev/video<N> is accepted:
	// the value is a path this process will open for writing, so an arbitrary
	// path here would be an arbitrary-file-write knob.
	Devices map[string]string `json:"devices"`
}

var videoDevicePattern = regexp.MustCompile(`^/dev/video[0-9]{1,3}$`)

// DaemonConfig describes how the module would reach the Daemon's local SVI
// broker. NOT YET IN EFFECT: the module makes no connection of its own (frames
// arrive through the SVI sink seam the Daemon opens), so these four values are
// only reported in diagnostics.
type DaemonConfig struct {
	Endpoint                  string `json:"endpoint"`
	ConnectTimeoutSec         int    `json:"connect_timeout_sec"`
	ReconnectInitialBackoffMS int    `json:"reconnect_initial_backoff_ms"`
	ReconnectMaxBackoffMS     int    `json:"reconnect_max_backoff_ms"`
}

type ProjectionConfig struct {
	// DefaultLifecycle is validated and reported; the declared lifecycle of a
	// projection is stored as given. HandleRenewBeforeSec is NOT YET IN EFFECT:
	// the module holds no Handle to renew.
	DefaultLifecycle     string `json:"default_lifecycle"`
	HandleRenewBeforeSec int    `json:"handle_renew_before_sec"`
}

// VideoConfig: none of these four is in effect yet. The frame path has no queue
// (one Write is one device write; MaxQueueFrames is not used), the size limit is
// the fixed MaxSinkFrameBytes (MaxFrameBytes is not used), the fallback picture
// is always black on sink close (Fallback is validated, nothing else), and there
// is no stale-frame watchdog (StaleFrameAfterMS is not used; design §14.3's
// "source went silent" fallback is not built).
type VideoConfig struct {
	MaxQueueFrames    int    `json:"max_queue_frames"`
	MaxFrameBytes     int    `json:"max_frame_bytes"`
	Fallback          string `json:"fallback"`
	StaleFrameAfterMS int    `json:"stale_frame_after_ms"`
}

// FallbackBlack is the only fallback picture design §18 names.
const FallbackBlack = "black"

// AudioConfig is validated and reported only; audio is not built (Phase 5).
type AudioConfig struct {
	Underflow    string `json:"underflow"`
	MaxLatencyMS int    `json:"max_latency_ms"`
}

// SecurityConfig carries the two settings the design §18 lets an operator see.
// Both are invariants: the design fixes them false and Validate refuses a file
// that sets either true, so the file can express the value but not change it.
// They are present so an operator reading the file learns the rule, not so they
// can turn it off.
type SecurityConfig struct {
	ExternalListen       bool `json:"external_listen"`
	AllowUnsignedAdapter bool `json:"allow_unsigned_adapter"`
}

// DiagnosticsConfig currently carries one invariant: raw frame payloads are
// never persisted (design §18, §20.4).
type DiagnosticsConfig struct {
	PersistFramePayload bool `json:"persist_frame_payload"`
}

// DefaultConfig is what the module runs with when no configuration file is
// present. It is the shipped example's content, so "no file" and "the example
// copied unchanged" behave identically.
func DefaultConfig() Config {
	return Config{
		SchemaVersion: ConfigSchemaVersion,
		ModuleID:      ModuleID,
		Daemon: DaemonConfig{
			Endpoint:                  "auto",
			ConnectTimeoutSec:         5,
			ReconnectInitialBackoffMS: 500,
			ReconnectMaxBackoffMS:     30000,
		},
		Projection: ProjectionConfig{
			DefaultLifecycle:     LifecyclePersistent,
			HandleRenewBeforeSec: 30,
		},
		Video: VideoConfig{
			MaxQueueFrames:    3,
			MaxFrameBytes:     16777216,
			Fallback:          "black",
			StaleFrameAfterMS: 500,
		},
		Audio: AudioConfig{
			Underflow:    "silence",
			MaxLatencyMS: 100,
		},
		Security:    SecurityConfig{},
		Diagnostics: DiagnosticsConfig{},
	}
}

// ErrConfigNotFound reports that no configuration file exists at the resolved
// path. It is not a startup failure: the module runs on DefaultConfig and says
// so in diagnostics. LoadConfig returns it alongside the defaults so a caller
// that asked for a specific --config path can tell "absent" from "unreadable" —
// the two have different fixes, and reporting them as one is how a typo in a
// path becomes "the file has no effect and nobody knows why".
var ErrConfigNotFound = errors.New("virtual device configuration file not found")

// ResolveConfigPath decides which configuration file to read.
//
//	--config <path>          an explicit path wins, and its absence is reported
//	$TERRA_MODULE_DIR        the module host tells the process where its package
//	                         is; the file is config/virtual-device.json there
//	(neither)                config/virtual-device.json relative to the cwd
//
// The middle case is the one that matters in production. A hosted module gets
// no argv from the host — Manifest v2 has no args field at all — so the package
// directory has to come from the environment the host does set.
func ResolveConfigPath(flagValue string, lookupEnv func(string) string) string {
	if trimmed := strings.TrimSpace(flagValue); trimmed != "" {
		return trimmed
	}
	if lookupEnv != nil {
		if moduleDir := strings.TrimSpace(lookupEnv("TERRA_MODULE_DIR")); moduleDir != "" {
			return filepath.Join(moduleDir, "config", ConfigFileName)
		}
	}
	return filepath.Join("config", ConfigFileName)
}

// LoadConfig reads and validates the configuration file at path. A missing file
// yields DefaultConfig and ErrConfigNotFound; anything else — unreadable,
// malformed, or violating an invariant — is a real error, because the operator
// wrote a file and it is not doing what they wrote.
func LoadConfig(path string) (Config, error) {
	config := DefaultConfig()
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return config, fmt.Errorf("%w: %s", ErrConfigNotFound, path)
		}
		return config, fmt.Errorf("read virtual device configuration %s: %w", path, err)
	}
	// Decoded onto the defaults, so a partial file keeps the documented value
	// for every key it does not mention.
	if err := json.Unmarshal(raw, &config); err != nil {
		return DefaultConfig(), fmt.Errorf("decode virtual device configuration %s: %w", path, err)
	}
	if err := config.Validate(); err != nil {
		return DefaultConfig(), fmt.Errorf("virtual device configuration %s: %w", path, err)
	}
	return config, nil
}

// Validate checks the schema version, the module id, and the security
// invariants the design §18 says configuration may not change.
func (c *Config) Validate() error {
	if c.SchemaVersion != ConfigSchemaVersion {
		return fmt.Errorf("unsupported schema_version %d (expected %d)", c.SchemaVersion, ConfigSchemaVersion)
	}
	if id := strings.TrimSpace(c.ModuleID); id != "" && id != ModuleID {
		return fmt.Errorf("module_id %q is not %s", id, ModuleID)
	}
	c.ModuleID = ModuleID
	if c.Security.ExternalListen {
		return errors.New("security.external_listen cannot be enabled: the module never listens on an external interface (design §18)")
	}
	if c.Security.AllowUnsignedAdapter {
		return errors.New("security.allow_unsigned_adapter cannot be enabled: unsigned adapters are never loaded (design §18)")
	}
	if c.Diagnostics.PersistFramePayload {
		return errors.New("diagnostics.persist_frame_payload cannot be enabled: raw frames are never written to disk (design §18, §20.4)")
	}
	switch c.Projection.DefaultLifecycle {
	case LifecyclePersistent, LifecycleSession:
	default:
		return fmt.Errorf("projection.default_lifecycle %q is not persistent or session", c.Projection.DefaultLifecycle)
	}
	if c.Video.MaxQueueFrames < 1 {
		return fmt.Errorf("video.max_queue_frames must be at least 1, got %d", c.Video.MaxQueueFrames)
	}
	if c.Video.MaxFrameBytes < 1 {
		return fmt.Errorf("video.max_frame_bytes must be positive, got %d", c.Video.MaxFrameBytes)
	}
	// Only the value the behaviour actually has is accepted: a file that says
	// "last_frame" would otherwise parse and then show black anyway.
	if c.Video.Fallback != FallbackBlack {
		return fmt.Errorf("video.fallback %q is not supported: only %q (design §18)", c.Video.Fallback, FallbackBlack)
	}
	seen := map[string]string{}
	for slotID, device := range c.Linux.Devices {
		if !validIdentifier(slotID) {
			return fmt.Errorf("linux.devices: key %q is not a valid slot id", slotID)
		}
		if !videoDevicePattern.MatchString(device) {
			return fmt.Errorf("linux.devices[%q] = %q: only /dev/video<N> is accepted", slotID, device)
		}
		if other, dup := seen[device]; dup {
			return fmt.Errorf("linux.devices: %s is named by both %q and %q; one loopback node serves one slot", device, other, slotID)
		}
		seen[device] = slotID
	}
	return nil
}
