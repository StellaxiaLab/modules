// Package weave is io.terra.io-weave's body: the node's projected input
// devices and the sink that feeds them.
//
// The split with io.terra.io-inventory is fixed (design decision D-26): the
// inventory knows the node's real devices and publishes them, io-weave
// borrows another node's and reproduces it here. io-weave therefore publishes
// no device — the one resource it does publish is the destination it offers,
// which is a thing this node owns and no other node's copy.
package weave

import (
	"strings"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
	coresvi "github.com/terra-project/terra/products/common/packages/terra-svi"
)

// PointerResourceID is this module's local resource id — the suffix the daemon
// namespaces under svi.<node>. It is not a device id: there is exactly one
// projected pointer per node, because there is exactly one lease (D-23).
const PointerResourceID = "io-weave.pointer"

// PointerEndpointID is the sink endpoint a binding targets.
const PointerEndpointID = "input"

// PointerSchema is what this endpoint accepts. It is the schema
// io.terra.io-inventory already publishes for a mouse, which is what makes the
// two bindable without a transform.
//
// One frame is ONE JSON-encoded protocol.PointerEvent. That sentence is the
// whole encoding contract and it lives here because nothing else states it:
// the schema ref names a family and a major, not a framing, and a source that
// packed several events per frame would be accepted by every compatibility
// check and then dropped on the floor by this decoder.
const (
	PointerSchema   = "terra.input.mouse@1"
	PointerEncoding = "application/json"
)

// OwnsResource reports whether a node-canonical resource id names this
// module's pointer.
//
// Matched by suffix rather than by rebuilding "svi.<node>.<local>": the daemon
// owns the namespace and the module does not know the node id at the moment a
// sink is opened (it is empty until enrollment, and the module is not told
// when that changes). The daemon only ever asks a module about resources that
// module published, so the suffix is unambiguous.
func OwnsResource(resourceID string) bool {
	return strings.HasPrefix(resourceID, "svi.") && strings.HasSuffix(resourceID, "."+PointerResourceID)
}

// Resources describes what this module contributes to the node catalog.
//
// Exactly one resource, and it is a sink. A sink endpoint cannot be bound as a
// source — EvaluateBinding rejects the direction before anything else — so the
// loop G-27 closed on the enumeration side cannot reopen here: node C cannot
// bind to node B's copy of node A's mouse, because B's copy is not offered as
// something to read.
func (p *Projection) Resources() []coresvi.ResourceDescriptor {
	state := p.State()
	return []coresvi.ResourceDescriptor{{
		ResourceID:    PointerResourceID,
		Kind:          "io-weave.pointer",
		CanonicalName: "io-weave/pointer",
		DisplayName:   "Projected pointer",
		Labels: map[string]string{
			"projection": string(state.Mode),
			"profile":    state.Profile,
			"bound":      boolLabel(state.Bound),
		},
		Status: coresvi.ResourceAvailable,
		Endpoints: []coresvi.EndpointDescriptor{{
			EndpointID:  PointerEndpointID,
			Direction:   coresvi.DirectionSink,
			Interaction: coresvi.InteractionStream,
			Operations:  []coresvi.Operation{coresvi.OperationInspect, coresvi.OperationBindTarget},
			InputSchema: PointerSchema,
			Encodings:   []string{PointerEncoding},
			QoSProfiles: []coresvi.QoSProfile{coresvi.QoSRealtimeLatest},
			// A pointer that can be driven from another node is not an
			// ordinary resource, and the catalog should say so before anyone
			// grants it.
			Sensitivity: "sensitive",
			// One remote lease per sink (D-23). Declared rather than assumed:
			// two remote pointers arriving at one node is the contest the
			// arbiter does not exist to resolve yet.
			MaxConsumers: 1,
			Status:       coresvi.ResourceAvailable,
			Metadata: map[string]any{
				// What binding here costs (D-9). The tiers do not nest, so a
				// pointer sink says pointer and nothing more: a grant written
				// against this endpoint must never be readable as permission
				// to type.
				"permission_tier": string(protocol.InputTierPointer),
				// D-10's reserved seat. "none" rather than absent: an endpoint
				// that carries no feedback and an endpoint nobody thought
				// about must not look alike.
				"feedback": "none",
				// §6.1's local-vs-remote contest. Still unmeasured — there is
				// no arbiter — and unmeasured is not idle.
				"arbitration_state":  "unmeasured",
				"arbitration_reason": "input arbiter not implemented on this node",
				// What actually happens to a frame that lands here. The
				// projection mode is the difference between "your pointer moved
				// something" and "your pointer was recorded", and a consumer
				// that cannot see which is being told the first while getting
				// the second.
				"projection_mode":   string(state.Mode),
				"projection_detail": state.ModeDetail,
			},
		}},
	}}
}

func boolLabel(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
