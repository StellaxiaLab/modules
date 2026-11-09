package vdevice

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// The domain model of the detailed design §9. Three objects, deliberately not
// two:
//
//	Adapter      what this build can talk to on this OS
//	Slot         the stable device the operating system shows (§9.2)
//	Projection   the SVI endpoint currently feeding a Slot (§9.3)
//
// Slot and Projection are separate because design principle §4.2 says they are:
// the device an external program picked from its list must not disappear when
// the source behind it changes. Folding them into one object is exactly how a
// source switch turns into an unregister/re-register, and the user's Zoom
// dropdown loses the camera mid-call.

// Adapter install and health states (§10.1).
const (
	StateNotInstalled       = "not_installed"
	StateInstallRequired    = "install_required"
	StateInstalling         = "installing"
	StateUserActionRequired = "user_action_required"
	StateRebootRequired     = "reboot_required"
	StateReady              = "ready"
	StateDisabled           = "disabled"
	StateFailed             = "failed"
	StateUninstalling       = "uninstalling"
)

// Projection observed states (§10.2).
const (
	ProjectionRequested     = "requested"
	ProjectionValidating    = "validating"
	ProjectionWaitingDriver = "waiting_driver"
	ProjectionOpeningHandle = "opening_handle"
	ProjectionPriming       = "priming"
	ProjectionActive        = "active"
	ProjectionDegraded      = "degraded"
	ProjectionDenied        = "denied"
	ProjectionExpired       = "expired"
	ProjectionFailed        = "failed"
	ProjectionClosing       = "closing"
	ProjectionClosed        = "closed"
)

// Desired states a caller may declare.
const (
	DesiredActive  = "active"
	DesiredStopped = "stopped"
	DesiredReady   = "ready"
)

// Device kinds. Camera is the only kind built; audio arrives in Phase 5. Virtual HID is an explicit non-goal (§3.2, §15.4) and has no
// constant here on purpose — a name is the first step to an implementation.
const (
	KindCamera = "camera"
	KindAudio  = "audio"
)

// Slot scopes (§9.2).
const (
	ScopeMachine = "machine"
	ScopeUser    = "user"
)

// Error codes of the design §21. These are the contract's vocabulary; the
// contract JSON declares the same set and a test holds the two together.
const (
	ErrCodeAdapterUnavailable    = "VDEV_ADAPTER_UNAVAILABLE"
	ErrCodeDriverInstallRequired = "VDEV_DRIVER_INSTALL_REQUIRED"
	ErrCodeUserActionRequired    = "VDEV_USER_ACTION_REQUIRED"
	ErrCodeRebootRequired        = "VDEV_REBOOT_REQUIRED"
	ErrCodeOSPermissionDenied    = "VDEV_OS_PERMISSION_DENIED"
	ErrCodeSlotNotFound          = "VDEV_SLOT_NOT_FOUND"
	ErrCodeSlotBusy              = "VDEV_SLOT_BUSY"
	ErrCodeSourceUnavailable     = "VDEV_SOURCE_UNAVAILABLE"
	ErrCodeHandleOpenFailed      = "VDEV_HANDLE_OPEN_FAILED"
	ErrCodeLeaseExpired          = "VDEV_LEASE_EXPIRED"
	ErrCodeFormatIncompatible    = "VDEV_FORMAT_INCOMPATIBLE"
	ErrCodeFrameInvalid          = "VDEV_FRAME_INVALID"
	ErrCodeStaleGeneration       = "VDEV_STALE_GENERATION"
	// ErrCodeInvalidRequest is not in §21: §21 enumerates the domain failures,
	// and a malformed request is not one of them. It is named here rather than
	// stretched onto a domain code, because answering a bad JSON body with
	// VDEV_SLOT_NOT_FOUND sends the caller looking for a slot.
	ErrCodeInvalidRequest = "VDEV_INVALID_REQUEST"
	// ErrCodeNotImplemented answers a route this phase declares but does not
	// serve, so "not built yet" never reads as "your request was wrong".
	ErrCodeNotImplemented = "VDEV_NOT_IMPLEMENTED"
)

// Format is a negotiated or requested media format (§13). This module carries it
// and does not convert: §9 says the format is explicit, so an unset field stays
// unset rather than being inferred.
type Format struct {
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	FPS         int    `json:"fps,omitempty"`
	PixelFormat string `json:"pixel_format,omitempty"`
	SampleRate  int    `json:"sample_rate,omitempty"`
	Channels    int    `json:"channels,omitempty"`
	SampleType  string `json:"sample_type,omitempty"`
}

// AdapterDescriptor is §9.1. Simulated is not in the design's field list and is
// the one addition: one adapter is a Fake, and an API that reports a
// Fake the same way it reports a v4l2loopback would teach an operator to trust
// a device that does not exist. It is reported, never inferred.
type AdapterDescriptor struct {
	AdapterID        string   `json:"adapter_id"`
	Kind             string   `json:"kind"`
	OS               string   `json:"os"`
	Version          string   `json:"version"`
	Capabilities     []string `json:"capabilities"`
	InstallState     string   `json:"install_state"`
	Health           string   `json:"health"`
	SupportedFormats []Format `json:"supported_formats"`
	Simulated        bool     `json:"simulated"`
	Detail           string   `json:"detail,omitempty"`
}

// Slot is §9.2: the stable device the OS shows. slot_id, display_name and
// os_device_id survive every source change.
//
// DisplayName is Terra's label for the Slot (the SVI catalog name). It is NOT
// what the OS shows: on Linux the name an application lists is the v4l2loopback
// node's own card label, fixed when the node was created (`modprobe v4l2loopback
// card_label=...`), and this module cannot change it. OSDeviceID is the device
// path (/dev/videoN) on Linux.
type Slot struct {
	SlotID          string    `json:"slot_id"`
	Kind            string    `json:"kind"`
	DisplayName     string    `json:"display_name"`
	Scope           string    `json:"scope"`
	OwnerSubject    string    `json:"owner_subject,omitempty"`
	AdapterID       string    `json:"adapter_id"`
	OSDeviceID      string    `json:"os_device_id,omitempty"`
	AcceptedFormats []Format  `json:"accepted_formats"`
	InstallState    string    `json:"install_state"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// SlotRequest is the PUT /slots/{slot_id} body (§16.3).
type SlotRequest struct {
	Kind         string   `json:"kind"`
	DisplayName  string   `json:"display_name"`
	Scope        string   `json:"scope"`
	AdapterID    string   `json:"adapter_id"`
	DesiredState string   `json:"desired_state"`
	Format       *Format  `json:"format,omitempty"`
	OwnerSubject string   `json:"owner_subject,omitempty"`
	Formats      []Format `json:"accepted_formats,omitempty"`
}

// Source names an SVI resource endpoint (§9.3).
type Source struct {
	ResourceID string `json:"resource_id"`
	EndpointID string `json:"endpoint_id"`
}

// QoS is the queue policy of §14, declared per projection (§16.4).
type QoS struct {
	Mode           string `json:"mode,omitempty"`
	MaxQueueFrames int    `json:"max_queue_frames,omitempty"`
	MaxLatencyMS   int    `json:"max_latency_ms,omitempty"`
}

// ProjectionDeclaration is §9.3 — the desired state, which outlives the daemon
// and the source. That is the whole reason it is separate from the runtime
// below: a user's intent to connect must not be forgotten because a source
// blinked.
type ProjectionDeclaration struct {
	ProjectionID    string    `json:"projection_id"`
	SlotID          string    `json:"slot_id"`
	Source          Source    `json:"source"`
	RequestedFormat *Format   `json:"requested_format,omitempty"`
	QoS             *QoS      `json:"qos,omitempty"`
	Lifecycle       string    `json:"lifecycle"`
	DesiredState    string    `json:"desired_state"`
	OwnerSubject    string    `json:"owner_subject,omitempty"`
	TTLSeconds      int       `json:"ttl,omitempty"`
	Generation      int64     `json:"generation"`
	IdempotencyKey  string    `json:"idempotency_key,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// ProjectionRuntime is §9.4 — what is actually happening. It is derived from the
// Slot's SVI sink, never from the declaration: a declared projection with no
// source delivering frames observes waiting_driver, degraded or priming, and is
// active only while frames reach the device.
type ProjectionRuntime struct {
	ObservedState    string     `json:"observed_state"`
	ReasonCode       string     `json:"reason_code,omitempty"`
	ReasonDetail     string     `json:"reason_detail,omitempty"`
	HandleID         string     `json:"handle_id,omitempty"`
	LeaseExpiresAt   *time.Time `json:"lease_expires_at,omitempty"`
	NegotiatedFormat *Format    `json:"negotiated_format,omitempty"`
	QueueDepth       int        `json:"queue_depth"`
	FramesIn         uint64     `json:"frames_in"`
	FramesOut        uint64     `json:"frames_out"`
	FramesDropped    uint64     `json:"frames_dropped"`
	ReconnectCount   int        `json:"reconnect_count"`
	LastFrameAt      *time.Time `json:"last_frame_at,omitempty"`
	StartedAt        *time.Time `json:"started_at,omitempty"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// ProjectionView is what GET /projections/{id} returns: declaration and runtime
// side by side, never merged (§9.4).
type ProjectionView struct {
	Declaration ProjectionDeclaration `json:"declaration"`
	Runtime     ProjectionRuntime     `json:"runtime"`
}

// ProjectionRequest is the PUT /projections/{projection_id} body (§16.4).
type ProjectionRequest struct {
	SlotID          string  `json:"slot_id"`
	Source          Source  `json:"source"`
	RequestedFormat *Format `json:"requested_format,omitempty"`
	QoS             *QoS    `json:"qos,omitempty"`
	Lifecycle       string  `json:"lifecycle"`
	DesiredState    string  `json:"desired_state"`
	OwnerSubject    string  `json:"owner_subject,omitempty"`
	TTLSeconds      int     `json:"ttl,omitempty"`
	Generation      int64   `json:"generation"`
}

// DomainError carries a §21 code out of the domain so the API layer maps one
// vocabulary, not two.
type DomainError struct {
	Code      string
	Message   string
	Retryable bool
}

func (e *DomainError) Error() string { return e.Code + ": " + e.Message }

func domainError(code, format string, args ...any) *DomainError {
	return &DomainError{Code: code, Message: fmt.Sprintf(format, args...), Retryable: retryableCode(code)}
}

// retryableCode mirrors the "재시도" column of §21. "조건부" is reported as
// retryable — the caller is told it may retry and why; the alternative is
// telling them it is terminal when it is not.
func retryableCode(code string) bool {
	switch code {
	case ErrCodeSourceUnavailable, ErrCodeHandleOpenFailed, ErrCodeSlotBusy,
		ErrCodeLeaseExpired, ErrCodeDriverInstallRequired, ErrCodeUserActionRequired,
		ErrCodeRebootRequired, ErrCodeOSPermissionDenied, ErrCodeStaleGeneration:
		return true
	default:
		return false
	}
}

// identifierPattern bounds slot and projection ids. They become path segments
// and, for a slot, part of an OS device name, so an unbounded string here is a
// path traversal and a device name nobody can type.
var identifierPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,63}$`)

func validIdentifier(value string) bool { return identifierPattern.MatchString(value) }

// Validate checks a slot request against §9.2 and §16.3.
func (r *SlotRequest) Validate(slotID string) error {
	if !validIdentifier(slotID) {
		return domainError(ErrCodeInvalidRequest,
			"slot id %q must be 2-64 characters of [a-z0-9-] starting with a letter or digit", slotID)
	}
	r.Kind = strings.ToLower(strings.TrimSpace(r.Kind))
	switch r.Kind {
	case KindCamera:
	case KindAudio:
		return domainError(ErrCodeAdapterUnavailable,
			"audio slots arrive with the Virtual Audio adapters in Phase 5 (design §25)")
	case "":
		return domainError(ErrCodeInvalidRequest, "kind is required")
	default:
		return domainError(ErrCodeInvalidRequest, "kind %q is not camera", r.Kind)
	}
	if strings.TrimSpace(r.DisplayName) == "" {
		return domainError(ErrCodeInvalidRequest, "display_name is required: it is this slot's label in Terra")
	}
	if r.Scope == "" {
		r.Scope = ScopeMachine
	}
	if r.Scope != ScopeMachine && r.Scope != ScopeUser {
		return domainError(ErrCodeInvalidRequest, "scope %q is not machine or user", r.Scope)
	}
	if r.DesiredState == "" {
		r.DesiredState = DesiredReady
	}
	if r.DesiredState != DesiredReady && r.DesiredState != DesiredStopped {
		return domainError(ErrCodeInvalidRequest, "desired_state %q is not ready or stopped", r.DesiredState)
	}
	if strings.TrimSpace(r.AdapterID) == "" {
		return domainError(ErrCodeInvalidRequest, "adapter_id is required: GET /adapters lists what this build has")
	}
	return nil
}

// AcceptedFormats folds the §16.3 single `format` field and the plural
// `accepted_formats` into one list without inventing entries for either.
func (r *SlotRequest) AcceptedFormats() []Format {
	formats := append([]Format(nil), r.Formats...)
	if r.Format != nil {
		formats = append(formats, *r.Format)
	}
	return formats
}

// Validate checks a projection request against §9.3 and §16.4.
func (r *ProjectionRequest) Validate(projectionID string) error {
	if !validIdentifier(projectionID) {
		return domainError(ErrCodeInvalidRequest,
			"projection id %q must be 2-64 characters of [a-z0-9-] starting with a letter or digit", projectionID)
	}
	if !validIdentifier(r.SlotID) {
		return domainError(ErrCodeInvalidRequest, "slot_id %q is not a valid slot id", r.SlotID)
	}
	if strings.TrimSpace(r.Source.ResourceID) == "" || strings.TrimSpace(r.Source.EndpointID) == "" {
		return domainError(ErrCodeInvalidRequest, "source.resource_id and source.endpoint_id are required")
	}
	if r.Lifecycle == "" {
		r.Lifecycle = LifecyclePersistent
	}
	if r.Lifecycle != LifecyclePersistent && r.Lifecycle != LifecycleSession {
		return domainError(ErrCodeInvalidRequest, "lifecycle %q is not persistent or session", r.Lifecycle)
	}
	if r.DesiredState == "" {
		r.DesiredState = DesiredActive
	}
	if r.DesiredState != DesiredActive && r.DesiredState != DesiredStopped {
		return domainError(ErrCodeInvalidRequest, "desired_state %q is not active or stopped", r.DesiredState)
	}
	if r.Generation < 1 {
		return domainError(ErrCodeInvalidRequest, "generation must be 1 or greater; a source change increments it (§16.4)")
	}
	return nil
}
