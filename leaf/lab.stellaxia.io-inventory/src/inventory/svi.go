package inventory

import (
	"fmt"
	"strings"

	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
	coresvi "github.com/StellaxiaLab/terra-sdk/svi"
)

// SVIResources describes the registry's devices as module-local SVI resource
// descriptors, ported from the daemon's IOGatewayAdapter. Module-local means:
// ResourceID is the suffix the daemon namespaces under svi.<node> (so the ids
// stay exactly what the in-daemon adapter produced), and NodeID/ProviderID/
// ExpiresAt are left for the daemon's remote adapter to stamp — node identity
// and TTL cadence are the host's, not the module's.
func (r *Registry) SVIResources() []coresvi.ResourceDescriptor {
	devices := r.List()
	resources := make([]coresvi.ResourceDescriptor, 0, len(devices))
	for _, device := range devices {
		schemaRef, encodings := deviceSchema(device.Kind)
		if adapterEncodings, ok := encodingsByAdapter[device.AdapterID]; ok {
			encodings = append([]string(nil), adapterEncodings...)
		}
		displayName := device.Name
		if strings.TrimSpace(device.Alias) != "" {
			displayName = device.Alias
		}
		status := resourceStatus(device)
		resources = append(resources, coresvi.ResourceDescriptor{
			ResourceID:    "io." + device.ID,
			Kind:          "io." + sviKindToken(device.Kind),
			CanonicalName: "io/" + sviKindToken(device.Kind) + "/" + device.ID,
			DisplayName:   displayName,
			Labels: map[string]string{
				"device":   device.ID,
				"presence": string(device.Presence),
				"approval": string(device.Approval),
				"enabled":  fmt.Sprintf("%t", device.Enabled),
			},
			Status: status,
			Endpoints: []coresvi.EndpointDescriptor{
				{
					EndpointID:   "output",
					Direction:    coresvi.DirectionSource,
					Interaction:  coresvi.InteractionStream,
					Operations:   []coresvi.Operation{coresvi.OperationInspect, coresvi.OperationSubscribe, coresvi.OperationBindSource},
					OutputSchema: schemaRef,
					Encodings:    encodings,
					QoSProfiles:  []coresvi.QoSProfile{coresvi.QoSRealtimeLatest},
					Sensitivity:  sensitivity(device.PermissionRequired),
					Status:       status,
					Metadata: map[string]any{
						"device_id":           device.ID,
						"alias":               device.Alias,
						"presence":            string(device.Presence),
						"approval":            string(device.Approval),
						"enabled":             device.Enabled,
						"runtime_state":       string(device.RuntimeState),
						"available":           device.Available,
						"permission_required": device.PermissionRequired,

						// Three slots reserved before anything fills them.
						// Adding a field to a published schema later is a
						// major version bump, and every one of these is
						// already known to be needed.
						//
						// permission_tier is what injecting through this
						// endpoint costs (D-9). It is published even though
						// nothing injects yet, because a consumer must be
						// able to see the price before asking.
						"permission_tier": string(protocol.InputTierForKind(sviKindToken(device.Kind))),
						// feedback is the reverse channel (D-10) — a sink's
						// CapsLock state going back to the source. Spelled
						// "none" rather than left out: "this endpoint carries
						// none" and "nobody thought about it" must not look
						// alike. Endpoint metadata holds scalars only, so the
						// eventual list arrives as a comma-separated value.
						"feedback": "none",
						// arbitration is the local-vs-remote contest (§6.1).
						// Unmeasured until the arbiter exists — and unmeasured
						// is not idle. Writing "idle" would tell a consumer
						// the device is free when nothing has looked.
						"arbitration_state":  "unmeasured",
						"arbitration_reason": "input arbiter not implemented on this node",
					},
				},
			},
		})
	}
	return resources
}

// sviKindToken spells a device kind the way SVI's kind grammar requires:
// lower-case segments joined by "." or "-", with no underscore
// (terra-svi/validation.go kindPattern).
//
// DeviceRawBus is "raw_bus", so the naive "io." + kind produced "io.raw_bus" —
// a kind the core rejects. That went unnoticed while the only registered
// devices were the module's three logical slots (camera, microphone, screen);
// the Windows discovery adapter is the first thing to report a raw_bus device,
// and every one of them made the daemon's provider refresh fail. **One invalid
// resource fails the whole refresh**, so the node's entire catalog silently
// stopped updating — the operator saw a stale resource list, not an error.
func sviKindToken(kind DeviceKind) string {
	return strings.ReplaceAll(string(kind), "_", "-")
}

func resourceStatus(device Device) coresvi.ResourceStatus {
	if device.Presence != PresencePresent {
		return coresvi.ResourceUnavailable
	}
	if device.Approval != ApprovalApproved || !device.Enabled {
		return coresvi.ResourceDisabled
	}
	switch device.RuntimeState {
	case RuntimeActive, RuntimeBusy, RuntimeOpening:
		return coresvi.ResourceBusy
	case RuntimeDegraded, RuntimeFailed:
		return coresvi.ResourceUnavailable
	default:
		if device.Available {
			return coresvi.ResourceAvailable
		}
		return coresvi.ResourceUnavailable
	}
}

// encodingsByAdapter overrides the kind's encodings where the adapter that
// opens the device says something different on the wire. The kind still picks
// the schema — an HTTP camera is a camera — but a consumer that binds it
// expecting H.264 and receives JPEG frames has been told something false. Keyed
// by adapter id rather than importing the manual package, so this package stays
// the OS-free, adapter-free core.
var encodingsByAdapter = map[string][]string{
	// Snapshot URLs answer one JPEG; MJPEG URLs answer a multipart stream of them.
	"manual.http-camera": {"image/jpeg", "multipart/x-mixed-replace"},
}

func deviceSchema(kind DeviceKind) (string, []string) {
	switch kind {
	case DeviceMicrophone:
		return "terra.audio.frame@1", []string{"audio/pcm"}
	case DeviceKeyboard:
		return "terra.input.keyboard@1", []string{"application/json"}
	case DeviceMouse:
		return "terra.input.mouse@1", []string{"application/json"}
	case DeviceRawBus:
		return "terra.io.raw@1", []string{"application/octet-stream"}
	default:
		return "terra.video.frame@1", []string{"video/h264"}
	}
}

func sensitivity(permissionRequired bool) string {
	if permissionRequired {
		return "sensitive"
	}
	return "normal"
}
