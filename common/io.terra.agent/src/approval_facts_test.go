package main

import (
	"encoding/json"
	"strings"
	"testing"

	agentcore "github.com/StellaxiaLab/terra-agent"

	"github.com/StellaxiaLab/modules/common/io.terra.agent/internal/testwait"
)

// 승인 카드의 "계약이 말하는 것"(M-2). 값은 계약 그대로이고, 계약이 적지 않은
// 칸은 "없음"이 아니라 "적지 않음"이다 — JSON에서 키가 없다(DC-17).

// pendingJSON asks for the first pending approval exactly as the wire sees it.
func pendingJSON(t *testing.T, current *session) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(current.snapshot())
	if err != nil {
		t.Fatal(err)
	}
	var view map[string]any
	if err := json.Unmarshal(encoded, &view); err != nil {
		t.Fatal(err)
	}
	list, _ := view["pending_approvals"].([]any)
	if len(list) != 1 {
		t.Fatalf("pending_approvals = %v", view["pending_approvals"])
	}
	return list[0].(map[string]any)
}

func TestPendingApprovalCarriesContractFactsAsWritten(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opExec, `{"command":"rm -rf /"}`, "clean"))),
		always(textResponse("done")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "auto", Provider: "scripted", MaxSteps: 4}, testPrincipal)
	if _, err := b.engine.submit(current, "clean up", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "an approval request", func() bool { return current.pendingCount() == 1 })
	pending := pendingJSON(t, current)
	contract, ok := pending["contract"].(map[string]any)
	if !ok {
		t.Fatalf("pending approval has no contract: %v", pending)
	}
	want := map[string]any{
		"risk": "dangerous", "idempotency_mode": "none", "retry_mode": "never", "output_mode": "accepted-job",
	}
	for key, value := range want {
		if contract[key] != value {
			t.Errorf("contract[%s] = %v, want %v", key, contract[key], value)
		}
	}
	if perms, _ := contract["permissions"].([]any); len(perms) != 1 || perms[0] != "process.execute" {
		t.Errorf("permissions = %v", contract["permissions"])
	}
	// opExec's contract writes neither confirmation nor sideEffects: absent, not "none".
	for _, key := range []string{"confirmation_mode", "side_effects"} {
		if _, present := contract[key]; present {
			t.Errorf("contract[%s] is present (%v) but the contract did not write it", key, contract[key])
		}
	}
	current.answerApproval("", false)
	testwait.Until(t, "the turn to finish", func() bool { return current.snapshot()["state"] == stateIdle })
}

func TestPendingApprovalCarriesDeclaredSideEffects(t *testing.T) {
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "it is dead"))),
		always(textResponse("restarted")),
	)
	provider, _ := b.engine.prepare(testPrincipal, "")
	current, _, _ := b.engine.sessions.open(sessionOptions{Autonomy: "ask", Provider: "scripted", MaxSteps: 4}, testPrincipal)
	if _, err := b.engine.submit(current, "restart", testPrincipal, provider); err != nil {
		t.Fatal(err)
	}
	testwait.Until(t, "an approval request", func() bool { return current.pendingCount() == 1 })
	contract := pendingJSON(t, current)["contract"].(map[string]any)
	effects, _ := contract["side_effects"].([]any)
	if len(effects) != 1 || effects[0].(map[string]any)["action"] != "update" {
		t.Errorf("side_effects = %v", contract["side_effects"])
	}
	if contract["risk"] != "write" || contract["idempotency_mode"] != "idempotent" {
		t.Errorf("contract = %v", contract)
	}
	current.answerApproval("", false)
	testwait.Until(t, "the turn to finish", func() bool { return current.snapshot()["state"] == stateIdle })
}

// A contract that writes an EMPTY list says "none"; one that writes nothing says
// nothing. The two must not collapse into the same JSON.
func TestApprovalContractSeparatesEmptyFromUnwritten(t *testing.T) {
	none := approvalContractOf(agentcore.CatalogOperation{
		OperationID: "x", SideEffects: []agentcore.CatalogSideEffect{}, Permissions: []string{},
		Execution: &agentcore.CatalogExecution{Risk: "read", ConfirmationMode: "none"},
	})
	encoded, _ := json.Marshal(none)
	for _, part := range []string{`"side_effects":[]`, `"permissions":[]`, `"confirmation_mode":"none"`} {
		if !strings.Contains(string(encoded), part) {
			t.Errorf("explicit none lost: %s lacks %s", encoded, part)
		}
	}
	silent := approvalContractOf(agentcore.CatalogOperation{OperationID: "x"})
	encoded, _ = json.Marshal(silent)
	if string(encoded) != `{}` {
		t.Errorf("a contract that wrote nothing encodes as %s, want {}", encoded)
	}
	// No operation at all (an external tool has no Gateway contract): no object.
	if approvalContractOf(agentcore.CatalogOperation{}) != nil {
		t.Error("an unknown operation must have no contract object")
	}
}
