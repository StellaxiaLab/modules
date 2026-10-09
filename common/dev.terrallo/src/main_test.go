package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/StellaxiaLab/modules/internal/testkit/climanifest"
)

// This module is a probe for the registration → publication → distribution →
// installation pipeline. So the thing worth testing is not its logic, of which
// there is none, but the three places its declaration is written down: the
// contract the Gateway publishes routes from, the manifest's CLI contribution,
// and the handler paths this process serves. A one-sided edit to any of them
// leaves `terra hello` answering 404 on a route that looks correctly
// published — which is exactly the failure the module exists to rule out.

func readJSON(t *testing.T, parts ...string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatalf("read %v: %v", parts, err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("decode %v: %v", parts, err)
	}
	return value
}

// contractPaths maps operation id → its gateway-http path.
func contractPaths(t *testing.T) map[string]string {
	t.Helper()
	contract := readJSON(t, "..", "contracts", "api", "terra-api.json")
	operations, ok := contract["operations"].(map[string]any)
	if !ok {
		t.Fatal("contract has no operations object")
	}
	paths := map[string]string{}
	for id, raw := range operations {
		operation, _ := raw.(map[string]any)
		bindings, _ := operation["bindings"].([]any)
		for _, item := range bindings {
			binding, _ := item.(map[string]any)
			if binding["type"] != "gateway-http" {
				continue
			}
			path, _ := binding["path"].(string)
			paths[id] = path
		}
	}
	return paths
}

func TestPathsMatchTheContract(t *testing.T) {
	paths := contractPaths(t)
	for id, want := range map[string]string{
		"dev.terrallo.status.get": statusPath,
		"dev.terrallo.hello.get":  helloPath,
	} {
		got, declared := paths[id]
		if !declared {
			t.Fatalf("%s has no gateway-http binding in the contract", id)
		}
		if got != want {
			t.Fatalf("%s: contract publishes %q, the process serves %q", id, got, want)
		}
	}
	if len(paths) != 2 {
		t.Fatalf("contract declares %d gateway-http operations, the process serves 2: %v", len(paths), paths)
	}
}

// The manifest's contributions.cli is what makes `terra hello` a real command.
// It names an operation by id, and an id that no longer exists produces a
// command that dispatches into nothing.
func TestCLIContributionNamesARealOperation(t *testing.T) {
	manifest := readJSON(t, "..", "module.json")
	contributions, _ := manifest["contributions"].(map[string]any)
	cli, _ := contributions["cli"].(map[string]any)
	commands, _ := cli["commands"].([]any)
	if len(commands) != 1 {
		t.Fatalf("expected exactly one contributed command, got %d", len(commands))
	}
	command, _ := commands[0].(map[string]any)
	if name := command["name"]; name != "hello" {
		t.Fatalf("contributed command is %q, not \"hello\" — `terra hello` would not dispatch", name)
	}
	operationID, _ := command["operationId"].(string)
	if _, declared := contractPaths(t)[operationID]; !declared {
		t.Fatalf("contributed command names %q, which the contract does not declare", operationID)
	}
}

// The manifest's readiness probe names an operation too. If it names one this
// process does not serve, the module never reaches ready and its routes are
// never published — a failure that looks like the distribution broke.
func TestReadinessProbeNamesAServedOperation(t *testing.T) {
	manifest := readJSON(t, "..", "module.json")
	readiness, _ := manifest["readiness"].(map[string]any)
	operationID, _ := readiness["operationId"].(string)
	path, declared := contractPaths(t)[operationID]
	if !declared {
		t.Fatalf("readiness names %q, which the contract does not declare", operationID)
	}
	recorder := httptest.NewRecorder()
	newOperationsHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("readiness path %s answered %d", path, recorder.Code)
	}
}

func TestHelloAnswersHelloTerra(t *testing.T) {
	recorder := httptest.NewRecorder()
	newOperationsHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, helloPath, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The literal is spelled out rather than compared to the constant: this
	// asserts what a person will see, and a typo in the constant would
	// otherwise assert itself.
	if body.Message != "hello terra" {
		t.Fatalf("message = %q, want %q", body.Message, "hello terra")
	}
}

// The contract's own example is what `terra module example dev.terrallo.hello.get`
// prints, so a stale example teaches the wrong answer.
func TestContractExampleMatchesWhatTheModuleAnswers(t *testing.T) {
	contract := readJSON(t, "..", "contracts", "api", "terra-api.json")
	operations, _ := contract["operations"].(map[string]any)
	hello, _ := operations["dev.terrallo.hello.get"].(map[string]any)
	output, _ := hello["output"].(map[string]any)
	examples, _ := output["examples"].([]any)
	if len(examples) == 0 {
		t.Fatal("hello declares no output example")
	}
	example, _ := examples[0].(map[string]any)
	value, _ := example["value"].(map[string]any)
	if value["message"] != greeting {
		t.Fatalf("contract example says %q, the module answers %q", value["message"], greeting)
	}
}

func TestOperationsRefuseNonGET(t *testing.T) {
	for _, path := range []string{statusPath, helloPath} {
		recorder := httptest.NewRecorder()
		newOperationsHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, nil))
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s = %d, want 405", path, recorder.Code)
		}
	}
}

// The three tests above read the manifest as plain JSON, which proves the file
// says what we think it says but not that the PLATFORM agrees. The host
// drops a malformed command with a reason rather than failing the module — so a
// bad declaration would ship quietly and `terra hello` would simply not exist.
// climanifest reads the declaration as written and reports what is visibly
// wrong; the host's own validator runs in CI (`terra module pack`).
func TestPlatformAcceptsTheCLIContribution(t *testing.T) {
	commands, reasons, err := climanifest.Load(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if len(reasons) != 0 {
		t.Fatalf("the host would drop a contributed command: %v", reasons)
	}
	if len(commands) != 1 {
		t.Fatalf("the host sees %d contributed commands, want 1", len(commands))
	}
	if got := commands[0].Name; got != "hello" {
		t.Fatalf("the host registers %q, so `terra hello` would not dispatch", got)
	}
	if got := commands[0].OperationID; got != "dev.terrallo.hello.get" {
		t.Fatalf("contributed command invokes %q", got)
	}
}
