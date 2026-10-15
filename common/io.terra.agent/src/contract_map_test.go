package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The 16 routes live in two places: contracts/api/terra-api.json (what the
// Gateway publishes) and operationRoutes in api.go (what the process serves).
// A one-sided edit leaves a route that looks published but answers 404, or a
// handler no caller can reach. This test holds the two against each other in
// both directions.

type contractBinding struct {
	Type   string `json:"type"`
	Method string `json:"method"`
	Path   string `json:"path"`
}

func loadContract(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "contracts", "api", "terra-api.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract map[string]any
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}
	return contract
}

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

// Every error code a handler can answer is one the contract declares, so a
// consumer reading the contract sees the whole failure surface.
func TestEveryAnsweredErrorCodeIsDeclared(t *testing.T) {
	contract := loadContract(t)
	declared := contract["errors"].(map[string]any)
	for _, code := range []string{
		"AGENT_UNAVAILABLE", "INVALID_REQUEST", "SESSION_NOT_FOUND", "SESSION_NOT_OWNED", "SESSION_BUSY",
		"SESSION_FINISHED", "APPROVAL_NOT_FOUND", "CREDENTIAL_MISSING", "CREDENTIAL_REJECTED",
		"CREDENTIAL_NOT_UNATTENDED",
		"MODEL_NOT_CONFIGURED", "MODEL_UNAVAILABLE",
	} {
		if _, ok := declared[code]; !ok {
			t.Errorf("%s is answered by a handler but not declared in the contract", code)
		}
	}
}

// loadManifest reads module.json as plain JSON — only the permission fields
// this file asserts on. The host's own manifest parser is not available to a
// module that builds without a Terra checkout; Terra checks that the host
// accepts this manifest (module-gateway-integration).
type manifestPermissions struct {
	Permissions *struct {
		CoreOperations []struct {
			ID string `json:"id"`
		} `json:"coreOperations"`
		Storage []string `json:"storage"`
	} `json:"permissions"`
}

func loadManifest(t *testing.T) manifestPermissions {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest manifestPermissions
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	return manifest
}

// The module's standing power is exactly two core operations: the delegate
// door, and a read-only question about which node this is. The first does
// nothing without a person's delegated credential; the second answers a fact
// the node already shows anyone who asks, and writes nothing. Any third
// operation is authority that exists whether or not a person delegated
// anything — the thing §11.4 forbids — so the set is pinned exactly and a new
// entry has to change this test, in review, on purpose.
func TestManifestDeclaresOnlyTheDoorAndTheNodeIdentityRead(t *testing.T) {
	manifest := loadManifest(t)
	if manifest.Permissions == nil {
		t.Fatal("manifest declares no permissions")
	}
	got := map[string]int{}
	for _, operation := range manifest.Permissions.CoreOperations {
		got[operation.ID]++
	}
	want := map[string]int{"terra.gateway.delegate": 1, "terra.node.identity.get": 1}
	if len(got) != len(want) || len(manifest.Permissions.CoreOperations) != len(want) {
		t.Fatalf("coreOperations = %+v, want exactly %v", manifest.Permissions.CoreOperations, want)
	}
	for id := range want {
		if got[id] != 1 {
			t.Fatalf("coreOperations = %+v, want exactly %v", manifest.Permissions.CoreOperations, want)
		}
	}
	if nodeIdentityOperationID != "terra.node.identity.get" {
		t.Fatalf("the code asks for %q, which is not the declared identity operation", nodeIdentityOperationID)
	}
	if len(manifest.Permissions.Storage) != 1 || manifest.Permissions.Storage[0] != "module-data" {
		t.Fatalf("storage = %v, want [module-data]", manifest.Permissions.Storage)
	}
}

// Secret inputs are declared as such, so every log and audit surface that
// reads the contract knows to redact them.
func TestSecretInputsAreDeclared(t *testing.T) {
	contract := loadContract(t)
	operations := contract["operations"].(map[string]any)
	want := map[string]string{
		"io.terra.agent.credentials.put": "/credential",
		"io.terra.agent.models.put":      "/api_key",
	}
	for id, pointer := range want {
		operation := operations[id].(map[string]any)
		pointers, _ := operation["input"].(map[string]any)["secretPointers"].([]any)
		found := false
		for _, candidate := range pointers {
			if candidate == pointer {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: secretPointers %v does not name %s", id, pointers, pointer)
		}
	}
}

// moduleVersion is what status.get reports and what the MCP client announces;
// module.json is what the host installs and lists. They are one number: a
// release bumps the manifest, and a constant left behind makes the running
// module say it is an older build than the one the host shows. Reading the
// manifest as plain JSON keeps this module buildable without a Terra checkout.
// (contractVersion and each operation's "version" in terra-api.json version the
// API surface, not the module, and move on their own.)
func TestModuleVersionMatchesManifest(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if manifest.Version == "" {
		t.Fatal("manifest declares no version")
	}
	if moduleVersion != manifest.Version {
		t.Fatalf("moduleVersion = %q but module.json version = %q — bump both together (src/main.go)", moduleVersion, manifest.Version)
	}
}
