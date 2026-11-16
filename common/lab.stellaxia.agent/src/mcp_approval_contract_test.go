package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// P13-5 (ADR-GW-014): registering or removing an external MCP server is an action
// the human must approve, so the contract declares execution.approval for both.
// env is the server's own secret: it is never listed as an approval input.
func TestMCPWritesCarryApproval(t *testing.T) {
	raw, err := os.ReadFile("../contracts/api/terra-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Operations map[string]struct {
			Execution struct {
				Approval *struct {
					Tier         string   `json:"tier"`
					Impact       string   `json:"impact"`
					Inputs       []string `json:"inputs"`
					SecretResult []string `json:"secret_result"`
				} `json:"approval"`
			} `json:"execution"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{
		"lab.stellaxia.agent.mcp.put":    {"server", "command", "args", "read_only"},
		"lab.stellaxia.agent.mcp.delete": {"server"},
	}
	for id, inputs := range want {
		operation, ok := document.Operations[id]
		if !ok {
			t.Fatalf("%s is not in the contract", id)
		}
		approval := operation.Execution.Approval
		if approval == nil {
			t.Fatalf("%s: no execution.approval", id)
		}
		if approval.Tier != "T3" || approval.Impact != "node" {
			t.Errorf("%s: tier/impact %s/%s, want T3/node", id, approval.Tier, approval.Impact)
		}
		if !reflect.DeepEqual(approval.Inputs, inputs) {
			t.Errorf("%s: inputs %v, want %v", id, approval.Inputs, inputs)
		}
		if len(approval.SecretResult) != 0 {
			t.Errorf("%s: response carries no secret, got secret_result %v", id, approval.SecretResult)
		}
	}
}
