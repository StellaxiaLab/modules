package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The 15 routes live in two places: contracts/api/terra-api.json (what the
// Gateway publishes) and operationRoutes in api.go (what the process serves).
// A one-sided edit leaves a route that looks published but answers 404, or a
// handler no caller can reach — the most likely accident in this module. This
// test holds the two against each other in both directions, so the drift fails
// here instead of surfacing as a puzzle behind a live Gateway.

type contractBinding struct {
	Type   string `json:"type"`
	Method string `json:"method"`
	Path   string `json:"path"`
}

// loadContractBindings returns operation id → its gateway-http binding.
func loadContractBindings(t *testing.T) map[string]contractBinding {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "contracts", "api", "terra-api.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract struct {
		Operations map[string]struct {
			Bindings []contractBinding `json:"bindings"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}

	bindings := map[string]contractBinding{}
	for id, operation := range contract.Operations {
		for _, binding := range operation.Bindings {
			if binding.Type != "gateway-http" {
				continue
			}
			if _, duplicate := bindings[id]; duplicate {
				t.Fatalf("%s: more than one gateway-http binding", id)
			}
			bindings[id] = binding
		}
	}
	return bindings
}

func TestEveryContractBindingHasARoute(t *testing.T) {
	bindings := loadContractBindings(t)
	if len(bindings) == 0 {
		t.Fatal("no gateway-http bindings found — the contract moved or the parse rule rotted")
	}

	routes := map[string]operationRoute{}
	for _, route := range operationRoutes {
		routes[route.OperationID] = route
	}

	for id, binding := range bindings {
		route, present := routes[id]
		if !present {
			t.Errorf("%s: in the contract but not in operationRoutes — the Gateway would publish a route this process answers 404 on", id)
			continue
		}
		if route.Method != binding.Method {
			t.Errorf("%s: method %q, contract says %q", id, route.Method, binding.Method)
		}
		if got := apiPrefix + route.Path; got != binding.Path {
			t.Errorf("%s: path %q, contract says %q", id, got, binding.Path)
		}
	}
}

func TestEveryRouteIsInTheContract(t *testing.T) {
	bindings := loadContractBindings(t)
	for _, route := range operationRoutes {
		if _, present := bindings[route.OperationID]; !present {
			t.Errorf("%s: served by this process but absent from the contract — no caller can be authorized to reach it", route.OperationID)
		}
	}
	if len(operationRoutes) != len(bindings) {
		t.Errorf("route count: code %d, contract %d", len(operationRoutes), len(bindings))
	}
}

// Every binding must stay inside this module's namespace; the Gateway refuses
// paths outside it (operation.binding.semantic), but that check runs on the
// contract — this one runs on the table the code actually mounts.
func TestEveryRouteStaysInTheModuleNamespace(t *testing.T) {
	for _, route := range operationRoutes {
		if !strings.HasPrefix(apiPrefix+route.Path, "/api/modules/io.terra.nodetalk/") {
			t.Errorf("%s: path %q leaves the module namespace", route.OperationID, route.Path)
		}
	}
}
