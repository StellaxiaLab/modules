package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	agentcore "github.com/terra-project/terra/products/common/packages/terra-agent-core"

	"github.com/terra-project/terra/products/common/packages/terra-testwait"
)

// Each row of the design's decision table (§6.3) has a test here, run through
// the real loop and the real gate against the fake Gateway: what the model
// asks for, what reaches the Gateway, and what the record says.

// plan: reads run, a write is proposed and never called.
func TestPlanModeRunsReadsAndProposesWrites(t *testing.T) {
	b := newBench(t,
		always(toolResponse("looking", invokeCall("c1", opStatus, `{}`, "check"), invokeCall("c2", opRestart, `{"module_id":"io.terra.sample"}`, "restart it"))),
		always(textResponse("I propose restarting io.terra.sample; run it with terra module call.")),
	)
	current := b.runPrompt(t, "plan", false, "restart the dead module")

	if got := b.gateway.invoked(); len(got) != 1 || got[0] != opStatus {
		t.Fatalf("gateway invokes = %v, want only the read", got)
	}
	result, isError := lastToolResult(t, b.provider, "c2")
	if !isError || result["error"].(map[string]any)["code"] != agentcore.CodeApprovalRequired {
		t.Fatalf("the write was not refused as a proposal: %v", result)
	}
	calls := entriesOfKind(current, kindCall)
	refused := 0
	for _, line := range calls {
		if line.OperationID == opRestart && line.Decision == string(agentcore.DecisionPlan) && line.Status == agentcore.StatusRefused {
			refused++
		}
	}
	if refused != 1 {
		t.Fatalf("record does not carry the plan decision: %+v", calls)
	}
	if state := current.snapshot()["state"]; state != stateDone {
		t.Fatalf("state = %v", state)
	}
}

// ask: a write waits for the person; approval lets it through.
func TestAskModeWaitsForThePersonAndRunsOnApproval(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "it is dead"))),
		always(textResponse("restarted")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, err := b.engine.sessions.open(sessionOptions{Autonomy: "ask", Provider: "scripted", MaxSteps: 4}, testPrincipal)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.engine.submit(current, "restart the dead module", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "an approval request", func() bool { return current.pendingCount() == 1 })
	if state := current.snapshot()["state"]; state != stateWaiting {
		t.Fatalf("state while waiting = %v", state)
	}
	if got := b.gateway.invoked(); len(got) != 0 {
		t.Fatalf("the write reached the gateway before anyone answered: %v", got)
	}
	approvals := entriesOfKind(current, kindApproval)
	if len(approvals) != 1 || approvals[0].RequestID == "" || !strings.Contains(approvals[0].Text, "terra agent approve "+approvals[0].RequestID) {
		t.Fatalf("approval entry = %+v", approvals)
	}
	// A second line while waiting is refused as busy, not silently queued.
	if _, err := b.engine.submit(current, "hurry", testPrincipal, provider); !errors.Is(err, errSessionBusy) {
		t.Fatalf("submit while waiting = %v, want busy", err)
	}

	if _, ok := current.answerApproval("", true); !ok {
		t.Fatal("no pending approval to answer")
	}
	testwait.Until(t, "the turn to finish", func() bool { return current.snapshot()["state"] == stateIdle })
	if got := b.gateway.invoked(); len(got) != 1 || got[0] != opRestart {
		t.Fatalf("gateway invokes = %v, want the approved write", got)
	}
	if len(entriesOfKind(current, kindApproved)) != 1 {
		t.Fatal("the approval is not in the record")
	}
	result, isError := lastToolResult(t, b.provider, "c1")
	if isError || result["operationId"] != opRestart {
		t.Fatalf("the approved call did not succeed: %v", result)
	}
}

// ask, denied: the person says no, nothing reaches the Gateway, the model is told.
func TestAskModeDenialNeverReachesTheGateway(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "restart"))),
		always(textResponse("understood, not restarting")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "ask", Provider: "scripted", MaxSteps: 4}, testPrincipal)
	if _, err := b.engine.submit(current, "restart it", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "an approval request", func() bool { return current.pendingCount() == 1 })
	current.answerApproval("", false)
	testwait.Until(t, "the turn to finish", func() bool { return current.snapshot()["state"] == stateIdle })

	if got := b.gateway.invoked(); len(got) != 0 {
		t.Fatalf("a denied call reached the gateway: %v", got)
	}
	result, isError := lastToolResult(t, b.provider, "c1")
	if !isError || result["error"].(map[string]any)["code"] != agentcore.CodeApprovalDenied {
		t.Fatalf("the model was not told about the denial: %v", result)
	}
	if len(entriesOfKind(current, kindDenied)) != 1 {
		t.Fatal("the denial is not in the record")
	}
}

// auto: a reversible write runs unasked; a dangerous one still asks.
func TestAutoModeRunsReversibleWritesAndAsksForDangerous(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "restart"))),
		always(toolResponse("", invokeCall("c2", opExec, `{"command":"rm -rf /"}`, "clean"))),
		always(textResponse("done")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "auto", Provider: "scripted", MaxSteps: 5}, testPrincipal)
	if _, err := b.engine.submit(current, "fix the node", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "the dangerous call to ask", func() bool { return current.pendingCount() == 1 })
	if got := b.gateway.invoked(); len(got) != 1 || got[0] != opRestart {
		t.Fatalf("gateway invokes before approval = %v, want only the reversible write", got)
	}
	pending := current.snapshot()["pending_approvals"].([]approvalRequest)
	if pending[0].OperationID != opExec || !strings.Contains(pending[0].Judgement, "dangerous") {
		t.Fatalf("pending = %+v", pending)
	}
	current.answerApproval(pending[0].ID, false)
	testwait.Until(t, "the turn to finish", func() bool { return current.snapshot()["state"] == stateIdle })
	if got := b.gateway.invoked(); len(got) != 1 {
		t.Fatalf("gateway invokes = %v", got)
	}
}

// unattended: nobody to ask, so a write is refused outright — no question is
// even raised.
func TestUnattendedModeRefusesWritesWithoutAsking(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"x"}`, "restart"))),
		always(textResponse("cannot")),
	)
	current := b.runPrompt(t, "unattended", false, "restart it")
	if len(entriesOfKind(current, kindApproval)) != 0 {
		t.Fatal("unattended mode asked a person who is not there")
	}
	if got := b.gateway.invoked(); len(got) != 0 {
		t.Fatalf("gateway invokes = %v", got)
	}
	result, isError := lastToolResult(t, b.provider, "c1")
	if !isError || result["error"].(map[string]any)["code"] != agentcore.CodeApprovalRequired {
		t.Fatalf("result = %v", result)
	}
}

// simulate: nothing is invoked, ever — not even a read — but the catalog is
// consulted and the plan is recorded with the decision it would have met.
func TestSimulateNeverInvokesAnything(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", toolCall("s1", "terra_search_operations", `{"query":"status"}`), invokeCall("c1", opStatus, `{}`, "check"), invokeCall("c2", opRestart, `{"module_id":"x"}`, "restart"))),
		always(textResponse("in a real run I would read status then restart")),
	)
	current := b.runPrompt(t, "auto", true, "restart the dead module")
	if b.gateway.touched("POST /api/v1/operations") {
		t.Fatal("a simulation reached an operation invoke")
	}
	if !b.gateway.touched("GET /api/v1/catalog") {
		t.Fatal("the simulation did not even read the catalog; it cannot have planned")
	}
	planned := entriesOfKind(current, kindPlanned)
	if len(planned) != 2 || planned[0].Status != agentcore.StatusPlanned {
		t.Fatalf("planned entries = %+v", planned)
	}
	result, isError := lastToolResult(t, b.provider, "c2")
	if isError || result["dryRun"] != true || result["approval"] != string(agentcore.DecisionRun) {
		t.Fatalf("simulated invoke result = %v", result)
	}
}

// The credential value and the API key never appear in anything the model is
// shown. This is a snapshot of every request the provider received.
func TestSecretsNeverReachTheModel(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", toolCall("s1", "terra_session", `{}`), invokeCall("c1", opStatus, `{}`, "check"))),
		always(textResponse("ok")),
	)
	b.runPrompt(t, "auto", false, "what can you do here?")
	requests := b.provider.seen()
	if len(requests) < 2 {
		t.Fatalf("provider saw %d requests", len(requests))
	}
	for index, request := range requests {
		encoded, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{testCredential, testAPIKey} {
			if strings.Contains(string(encoded), secret) {
				t.Fatalf("request %d carries a secret: %s", index, secret)
			}
		}
		if !strings.Contains(request.System, "terra_invoke") {
			t.Fatalf("request %d lost the system prompt", index)
		}
	}
	// And the session tool's own answer, which the model does see, names the
	// delegate but not the value.
	result, _ := lastToolResult(t, b.provider, "s1")
	if encoded, _ := json.Marshal(result); strings.Contains(string(encoded), testCredential) {
		t.Fatalf("terra_session leaked the credential: %s", encoded)
	}
}

// A write the contract says must never be retried is not repeated by the
// loop after an ambiguous failure, however the model asks.
func TestRetryNeverIsNotRepeatedAfterAnAmbiguousFailure(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"x"}`, "restart"))),
		always(toolResponse("retrying", invokeCall("c2", opRestart, `{"module_id":"x"}`, "retry"))),
		always(textResponse("gave up")),
	)
	b.gateway.invokeStatus[opRestart] = 502
	current := b.runPrompt(t, "auto", false, "restart x")
	if got := b.gateway.invoked(); len(got) != 1 {
		t.Fatalf("gateway invokes = %v, want exactly one attempt", got)
	}
	result, isError := lastToolResult(t, b.provider, "c2")
	if !isError || result["error"].(map[string]any)["code"] != agentcore.CodeRetryRefused {
		t.Fatalf("the repeat was not refused: %v", result)
	}
	if lines := entriesOfKind(current, kindCall); len(lines) < 2 || lines[len(lines)-1].ErrorCode != agentcore.CodeRetryRefused {
		t.Fatalf("record = %+v", lines)
	}
}

// The step cap ends a loop that never stops calling tools.
func TestStepLimitStopsTheLoop(t *testing.T) {
	search := always(toolResponse("", toolCall("s", "terra_search_operations", `{"query":"x"}`)))
	b := newBench(t, search, search, search, search, search)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "plan", Provider: "scripted", MaxSteps: 3}, testPrincipal)
	b.engine.run(context.Background(), current, "loop", provider)
	view := current.snapshot()
	if view["steps"] != float64(3) {
		t.Fatalf("steps = %v", view["steps"])
	}
	errorsSeen := entriesOfKind(current, kindError)
	if len(errorsSeen) != 1 || errorsSeen[0].ErrorCode != "STEP_LIMIT" {
		t.Fatalf("errors = %+v", errorsSeen)
	}
}

// A model failure stops the turn without a new plan and leaves the state
// readable (§13: 모델 API 장애).
func TestModelFailureStopsWithoutANewPlan(t *testing.T) {
	b := newBench(t, func(Request) (Response, error) {
		return Response{}, &providerError{Status: 529, Message: "anthropic: overloaded"}
	})
	current := b.runPrompt(t, "auto", false, "hello")
	view := current.snapshot()
	if view["state"] != stateFailed || !strings.Contains(view["last_error"].(string), "overloaded") {
		t.Fatalf("view = %v", view)
	}
	if len(b.provider.seen()) != 1 {
		t.Fatal("the loop planned again after the model failed")
	}
}

// Cancel unblocks a turn that is waiting for a person.
func TestCancelStopsAWaitingTurn(t *testing.T) {
	b := newBench(t, always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"x"}`, "restart"))))
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "ask", Provider: "scripted", MaxSteps: 4}, testPrincipal)
	if _, err := b.engine.submit(current, "restart", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "an approval request", func() bool { return current.pendingCount() == 1 })
	b.engine.cancel(current)
	testwait.Until(t, "the turn to end", func() bool {
		current.mu.Lock()
		defer current.mu.Unlock()
		return !current.busy
	})
	if state := current.snapshot()["state"]; state != stateCancelled {
		t.Fatalf("state = %v", state)
	}
	if _, err := b.engine.submit(current, "again", testPrincipal, provider); !errors.Is(err, errSessionFinished) {
		t.Fatalf("submit after cancel = %v", err)
	}
	if got := b.gateway.invoked(); len(got) != 0 {
		t.Fatalf("gateway invokes = %v", got)
	}
}

// An unanswered question times out as a denial; the session is not stuck.
func TestUnansweredApprovalTimesOut(t *testing.T) {
	b := newBench(t, always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"x"}`, "restart"))), always(textResponse("nobody answered")))
	b.engine.approvalWait = 200 * time.Millisecond
	current := b.runPrompt(t, "ask", false, "restart")
	if got := b.gateway.invoked(); len(got) != 0 {
		t.Fatalf("gateway invokes = %v", got)
	}
	if current.pendingCount() != 0 {
		t.Fatal("the question is still pending after the timeout")
	}
	result, isError := lastToolResult(t, b.provider, "c1")
	if !isError || !strings.Contains(result["error"].(map[string]any)["message"].(string), "nobody answered") {
		t.Fatalf("result = %v", result)
	}
}

// The record on disk survives the process: a session found after a restart is
// readable and archived, never continuable.
func TestSessionRecordSurvivesRestartAsArchived(t *testing.T) {
	b := newBench(t, always(textResponse("hello")))
	current := b.runPrompt(t, "plan", false, "hi")
	reloaded, err := newSessionStore(b.root, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	found, ok := reloaded.get(current.meta.ID)
	if !ok {
		t.Fatal("the session record was not found on disk")
	}
	if found.meta.State != stateDone {
		t.Fatalf("state after reload = %s", found.meta.State)
	}
	if len(found.entriesAfter(0, 0)) != len(current.entriesAfter(0, 0)) {
		t.Fatal("entries were lost on reload")
	}
	// An unfinished session comes back archived.
	open, _, _ := reloaded.open(sessionOptions{Autonomy: "plan"}, testPrincipal)
	open.setState(stateRunning)
	again, _ := newSessionStore(b.root, time.Now)
	if archived, _ := again.get(open.meta.ID); archived.meta.State != stateArchived {
		t.Fatalf("unfinished session reloaded as %s", archived.meta.State)
	}
}

// A door refusal for a wrong credential surfaces as the Gateway's own code.
func TestAWrongCredentialIsTheGatewaysRefusal(t *testing.T) {
	b := newBench(t, always(toolResponse("", invokeCall("c1", opStatus, `{}`, "check"))), always(textResponse("no access")))
	b.gateway.credential = "tsa_something-else"
	b.runPrompt(t, "auto", false, "status")
	result, isError := lastToolResult(t, b.provider, "c1")
	if !isError || result["error"].(map[string]any)["code"] != "AUTH_INVALID" {
		t.Fatalf("result = %v", result)
	}
}

// A5 — 기록과 관측: the limits that keep one planning loop from becoming the
// node's whole workload, and the line that says what left it (§12, §8).

// blocks is a model step that never answers, so the turn's own clock is the
// only thing that can end it.
func blocks() func(Request) (Response, error) {
	return func(Request) (Response, error) {
		// The adapter is the one holding the context, so this step just takes
		// longer than the turn is allowed; the provider abandons it.
		time.Sleep(30 * time.Second)
		return textResponse("too late"), nil
	}
}

func TestATurnStopsAtItsWallClock(t *testing.T) {
	b := newBench(t, blocks(), blocks())
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, err := b.engine.sessions.open(sessionOptions{Autonomy: "plan", Provider: "scripted", MaxSteps: 6, MaxSeconds: 1}, testPrincipal)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	b.engine.run(context.Background(), current, "think for ever", provider)
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Fatalf("the turn ran %s past its 1s limit", elapsed)
	}
	stops := entriesOfKind(current, kindError)
	if len(stops) != 1 || stops[0].ErrorCode != "TIME_LIMIT" || !strings.Contains(stops[0].Text, "1s") {
		t.Fatalf("stop entry = %+v", stops)
	}
	if view := current.snapshot(); view["state"] != stateDone || !strings.Contains(view["last_error"].(string), "past its limit") {
		t.Fatalf("view = %v", view)
	}
	// A cancelled turn and a turn that ran out of time are different things,
	// and the record says which happened.
	if len(entriesOfKind(current, kindCancelled)) != 0 {
		t.Fatal("a wall-clock stop was recorded as a cancellation")
	}
}

func TestASessionStopsWhenItsTokenBudgetIsSpent(t *testing.T) {
	// Each scripted turn reports 10 in / 5 out, so a budget of 20 is spent
	// after the second turn and the third never starts.
	b := newBench(t,
		always(toolResponse("", toolCall("s1", "terra_search_operations", `{"query":"x"}`))),
		always(toolResponse("", toolCall("s2", "terra_search_operations", `{"query":"y"}`))),
		always(textResponse("this turn should never run")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "plan", Provider: "scripted", MaxSteps: 6, TokenBudget: 20}, testPrincipal)
	b.engine.run(context.Background(), current, "search until the budget is gone", provider)

	if len(b.provider.seen()) != 2 {
		t.Fatalf("model was called %d times; the budget did not stop the loop", len(b.provider.seen()))
	}
	stops := entriesOfKind(current, kindError)
	if len(stops) != 1 || stops[0].ErrorCode != "TOKEN_BUDGET" || !strings.Contains(stops[0].Text, "30 of 20") {
		t.Fatalf("stop entry = %+v", stops)
	}
	// The ceiling is reported next to the count that hit it, or a person
	// reading the session cannot tell why it stopped.
	view := current.snapshot()
	if view["token_budget"] != float64(20) || view["max_steps"] != float64(6) {
		t.Fatalf("limits are not visible in the session: %v", view)
	}
}

// §8 무엇이 나갔는지 남는다: every model call leaves a line saying how much of
// this node went out with it, recorded before the answer came back.
func TestTheModelLineRecordsWhatLeftTheNode(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opStatus, `{}`, "check"))),
		always(textResponse("all good")),
	)
	current := b.runPrompt(t, "auto", false, "how is the node?")

	sent := entriesOfKind(current, kindModel)
	if len(sent) != 2 {
		t.Fatalf("model lines = %d, want one per model call", len(sent))
	}
	for index, line := range sent {
		if line.SentBytes <= 0 || line.Text != "" {
			t.Fatalf("model line %d = %+v; it is a fact about size, not a thing that was said", index, line)
		}
		if !strings.Contains(line.Note, "scripted/scripted-1") {
			t.Fatalf("model line %d does not name where it went: %q", index, line.Note)
		}
	}
	// The second call carries the first call's result back into the context,
	// so more went out — which is exactly what the question "그때 뭐가 나갔지"
	// is asking about.
	if sent[1].SentBytes <= sent[0].SentBytes {
		t.Fatalf("carrying a tool result back did not grow what went out: %d then %d", sent[0].SentBytes, sent[1].SentBytes)
	}
	if !strings.Contains(sent[1].Note, "1 tool result(s) carried") {
		t.Fatalf("the second call does not say what it carried: %q", sent[1].Note)
	}
	// And the operation whose output went back is named on its own line, so
	// the two together answer the question.
	calls := entriesOfKind(current, kindCall)
	if len(calls) != 1 || calls[0].OperationID != opStatus || calls[0].TraceID == "" {
		t.Fatalf("call lines = %+v", calls)
	}
}

// The trace id on a call line is the id the Gateway answered with, and it is
// shown in the note so a room and `terra agent log` both surface it.
func TestCallLinesCarryTheGatewaysTraceId(t *testing.T) {
	b := newBench(t, always(toolResponse("", invokeCall("c1", opStatus, `{}`, "check"))), always(textResponse("ok")))
	current := b.runPrompt(t, "auto", false, "status")
	calls := entriesOfKind(current, kindCall)
	want := traceFor("POST", "/api/v1/operations/"+opStatus+"/invoke")
	if len(calls) != 1 || calls[0].TraceID != want {
		t.Fatalf("call trace = %+v, want %q", calls, want)
	}
	if !strings.Contains(calls[0].Note, "trace="+want) {
		t.Fatalf("note = %q", calls[0].Note)
	}
}

// A7 — unattended. A session with nobody to ask needs a credential that was
// issued for exactly that, and the refusal names what to do about it.
func TestAnUnattendedSessionNeedsAnUnattendedCredential(t *testing.T) {
	b := newBench(t, always(textResponse("never reached")))

	// The bench's credential is an ordinary one.
	err := b.engine.allowsUnattended(testPrincipal, "unattended")
	if err == nil || !strings.Contains(err.Error(), "--unattended") {
		t.Fatalf("err = %v, want a refusal that names the fix", err)
	}
	// Every other mode is unaffected.
	for _, autonomy := range []string{"plan", "ask", "auto"} {
		if err := b.engine.allowsUnattended(testPrincipal, autonomy); err != nil {
			t.Fatalf("%s was refused: %v", autonomy, err)
		}
	}

	// An unattended credential that pre-approves nothing could only read, so
	// opening the session is refused rather than left to fail call by call.
	record, _ := b.engine.credentials.get(testPrincipal)
	record.Unattended = true
	if err := b.engine.credentials.put(record); err != nil {
		t.Fatal(err)
	}
	if err := b.engine.allowsUnattended(testPrincipal, "unattended"); err == nil ||
		!strings.Contains(err.Error(), "pre-approves nothing") {
		t.Fatalf("err = %v", err)
	}

	// With a list, it opens.
	record.PreApproved = []string{opRestart}
	if err := b.engine.credentials.put(record); err != nil {
		t.Fatal(err)
	}
	if err := b.engine.allowsUnattended(testPrincipal, "unattended"); err != nil {
		t.Fatalf("an unattended credential with a list was refused: %v", err)
	}
}

// End to end through the real loop: the pre-approved write runs with nobody
// there, and the one nobody named stops the run instead of waiting for an
// answer that is never coming.
func TestUnattendedRunsThePreApprovedWriteAndStopsAtTheRest(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "nightly restart"))),
		always(toolResponse("", invokeCall("c2", opExec, `{"command":"rm -rf /"}`, "cleanup"))),
		always(textResponse("restarted the module; the cleanup was not pre-approved")),
	)
	b.gateway.whoami = `{"principal":"` + testPrincipal + `","permissions":["node.read","node.control"],` +
		`"delegate":"agent:agn_test","reach":"local","reachLimited":true,"unattended":true,` +
		`"preApproved":["` + opRestart + `"]}`

	current := b.runPrompt(t, "unattended", false, "do the nightly job")

	if got := b.gateway.invoked(); len(got) != 1 || got[0] != opRestart {
		t.Fatalf("gateway invokes = %v, want only the pre-approved one", got)
	}
	if len(entriesOfKind(current, kindApproval)) != 0 {
		t.Fatal("an unattended session asked a person who is not there")
	}
	calls := entriesOfKind(current, kindCall)
	if len(calls) != 2 || calls[0].Status != agentcore.StatusOK || calls[1].Status != agentcore.StatusRefused {
		t.Fatalf("record = %+v", calls)
	}
	if calls[0].Decision != string(agentcore.DecisionRun) || calls[1].Decision != string(agentcore.DecisionRefuse) {
		t.Fatalf("decisions = %q then %q", calls[0].Decision, calls[1].Decision)
	}
}
