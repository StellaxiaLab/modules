package main

// What this node calls itself — one read-only question to the host's core
// capability plane (terra.node.identity.get), asked only so status.get can
// carry a name a person recognises. It needs no delegated credential and
// writes nothing; it is the second of exactly two core operations the
// manifest declares (the other is the delegate door), and a test pins that.

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
)

const nodeIdentityOperationID = "terra.node.identity.get"

// nodeIdentityTimeout keeps an unresponsive host from holding a readiness
// probe: status.get's own budget is two seconds by default.
const nodeIdentityTimeout = 1500 * time.Millisecond

// nodeName answers the node's display name, else its id, else "" — and ""
// means the caller leaves the key out. There is no stand-in: no core plane, a
// refused or failed call, or an answer without either field are all "unknown".
// A name that was found is kept for the life of the process (the answer cannot
// change within a launch); a failure is not, so the next probe asks again.
func (e *engine) nodeName(ctx context.Context) string {
	e.nameMu.Lock()
	defer e.nameMu.Unlock()
	if e.nodeNameKnown != "" {
		return e.nodeNameKnown
	}
	if e.core == nil {
		return ""
	}
	result, err := e.core.Invoke(ctx, modulert.CoreInvocation{
		OperationID: nodeIdentityOperationID,
		TimeoutMS:   int(nodeIdentityTimeout / time.Millisecond),
	})
	if err != nil {
		return ""
	}
	var identity struct {
		NodeID      string `json:"node_id"`
		DisplayName string `json:"display_name"`
	}
	if json.Unmarshal(result.Output, &identity) != nil {
		return ""
	}
	name := strings.TrimSpace(identity.DisplayName)
	if name == "" {
		name = strings.TrimSpace(identity.NodeID)
	}
	e.nodeNameKnown = name
	return name
}
