package main

// The door transport — agentcore.Transport over terra.gateway.delegate (A3).
//
// Every Gateway request this module makes goes through the host's delegate
// door, AS the credential the session's owner registered. The module never
// speaks to the Gateway directly (§12.1·§14.4) and never holds a user session
// token (§15.3): the door refuses anything that is not a delegated credential,
// and the Gateway judges the request exactly as it would judge the same person
// calling from the CLI — permissions, reach, audit, all of it (설계 §11.4).
//
// The credential is resolved per call rather than captured at session start,
// so a person who re-registers a fresh grant after the old one expired does
// not have to open a new session: the next call simply carries the new one.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	agentcore "github.com/terra-project/terra/products/common/packages/terra-agent-core"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

// doorTimeout bounds one relayed Gateway call. The door caps it at two
// minutes on its side; a minute is long enough for any immediate operation
// and short enough that a hung provider does not hold a turn for ever.
const doorTimeout = 60 * time.Second

// errNoDoor means the host wired no Core plane, so there is no way to reach
// the Gateway at all. It is the module saying "this host does not do this".
var errNoDoor = errors.New("the host offers no core capability plane; terra.gateway.delegate is unreachable")

// credentialSource answers the delegated credential a call should carry, or
// an error naming why there is none (nothing registered, or it expired).
type credentialSource func() (string, error)

// doorTransport implements agentcore.Transport by invoking the delegate door.
type doorTransport struct {
	core       *modulesdk.CoreClient
	credential credentialSource
}

// Do makes one Gateway request as the delegated credential. Gateway refusals
// come back as an answer — the agent core reads the error envelope and keeps
// its code — while door refusals and transport failures are Go errors. The
// answer carries the Gateway's trace id, which is what makes the session
// record and the Gateway's audit line joinable afterwards (A5).
func (d *doorTransport) Do(ctx context.Context, method, path string, body []byte) (agentcore.Answer, error) {
	if d.core == nil {
		return agentcore.Answer{}, errNoDoor
	}
	credential, err := d.credential()
	if err != nil {
		return agentcore.Answer{}, err
	}
	input, err := json.Marshal(modulert.GatewayDelegateInput{
		Credential: credential,
		Method:     method,
		Path:       path,
		Body:       body,
		TimeoutMS:  int(doorTimeout / time.Millisecond),
	})
	if err != nil {
		return agentcore.Answer{}, err
	}
	result, err := d.core.Invoke(ctx, modulert.CoreInvocation{
		OperationID: modulert.GatewayDelegateOperationID,
		Input:       input,
		TimeoutMS:   int((doorTimeout + 5*time.Second) / time.Millisecond),
	})
	if err != nil {
		return agentcore.Answer{}, fmt.Errorf("gateway delegate door: %w", err)
	}
	var output modulert.GatewayDelegateOutput
	if err := json.Unmarshal(result.Output, &output); err != nil {
		return agentcore.Answer{}, fmt.Errorf("gateway delegate door answered something that is not its output: %w", err)
	}
	return agentcore.Answer{Status: output.Status, Body: output.Body, TraceID: output.TraceID}, nil
}
