package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

// The manifest's contributions.cli turns this module's operations into real
// `terra nodetalk …` commands. Two things can rot silently there: a command
// declaration the platform quietly drops (a bad name, an unknown type — the
// host reports a reason and keeps the module running, so nothing fails loudly),
// and a pointer that no longer matches the operation's input schema after a
// contract change. Both would leave a command that exists in the manifest and
// does nothing useful in a shell, so both are asserted here against the
// platform's own validator and the shipped contract.

func loadManifest(t *testing.T) modulert.Manifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest modulert.Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	return manifest
}

// contractInputSchema returns one operation's input schema properties and its
// required set, from the shipped contract.
func contractInputSchema(t *testing.T, operationID string) (map[string]any, map[string]bool) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "contracts", "api", "terra-api.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract struct {
		Operations map[string]struct {
			Input struct {
				Schema struct {
					Properties map[string]any `json:"properties"`
					Required   []string       `json:"required"`
				} `json:"schema"`
			} `json:"input"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}
	operation, present := contract.Operations[operationID]
	if !present {
		t.Fatalf("%s: not in the contract", operationID)
	}
	required := map[string]bool{}
	for _, name := range operation.Input.Schema.Required {
		required[name] = true
	}
	return operation.Input.Schema.Properties, required
}

func TestEveryDeclaredCLICommandIsAccepted(t *testing.T) {
	commands, reasons := modulert.ManifestCLICommands(loadManifest(t))
	for _, reason := range reasons {
		t.Errorf("the platform dropped a declared command: %s", reason)
	}
	if len(commands) == 0 {
		t.Fatal("no CLI commands accepted — the contribution stopped being read")
	}
	for _, command := range commands {
		if !strings.HasPrefix(command.Name, "nodetalk ") {
			t.Errorf("%q: contributed commands must live under the module's own noun", command.Name)
		}
	}
}

// Every contributed command must name a real operation, and every arg/flag
// pointer must address a property that operation's input actually declares —
// a top-level pointer, because the Gateway maps the flat input onto the
// binding (path placeholders first, the rest to body or query).
func TestCLIPointersMatchTheContractInput(t *testing.T) {
	commands, _ := modulert.ManifestCLICommands(loadManifest(t))
	declared := map[string]bool{}
	for _, route := range operationRoutes {
		declared[route.OperationID] = true
	}

	for _, command := range commands {
		// A session names an operation per role rather than one at the top, so
		// the same checks run over there (cli_session_test.go) where the roles
		// are; running them here would only find an empty operation id.
		if command.IsSession() {
			continue
		}
		if !declared[command.OperationID] {
			t.Errorf("%q: names %s, which this module does not serve", command.Name, command.OperationID)
			continue
		}
		properties, required := contractInputSchema(t, command.OperationID)

		check := func(kind, name, pointer string, isRequired bool) {
			if !strings.HasPrefix(pointer, "/") || strings.Count(pointer, "/") != 1 {
				t.Errorf("%q %s %q: pointer %q must be a single top-level segment", command.Name, kind, name, pointer)
				return
			}
			property := strings.TrimPrefix(pointer, "/")
			schema, present := properties[property]
			if !present {
				t.Errorf("%q %s %q: pointer %q addresses no input property of %s",
					command.Name, kind, name, pointer, command.OperationID)
				return
			}
			// A CLI value is a scalar (string/integer/number/boolean); nothing
			// a shell word can become fills an array or an object. Declaring
			// one anyway produces a command that type-errors at the module
			// instead of failing here, where the fix is obvious.
			if typed, ok := schema.(map[string]any); ok {
				switch typed["type"] {
				case "array", "object":
					t.Errorf("%q %s %q: %s is %v — a CLI value cannot fill it",
						command.Name, kind, name, property, typed["type"])
				}
			}
			// A required input that no arg/flag marks required would fail at
			// the Gateway rather than in the shell, where the message is useful.
			if required[property] && !isRequired {
				t.Errorf("%q %s %q: %s is required by the contract but optional on the command",
					command.Name, kind, name, property)
			}
		}
		for _, arg := range command.Args {
			check("arg", arg.Name, arg.Pointer, arg.Required)
		}
		for _, flag := range command.Flags {
			check("flag", flag.Name, flag.Pointer, flag.Required)
		}

		// Conversely: a contract-required input with no way to supply it makes
		// the command unusable.
		supplied := map[string]bool{}
		for _, arg := range command.Args {
			supplied[strings.TrimPrefix(arg.Pointer, "/")] = true
		}
		for _, flag := range command.Flags {
			supplied[strings.TrimPrefix(flag.Pointer, "/")] = true
		}
		missing := []string{}
		for property := range required {
			if !supplied[property] {
				missing = append(missing, property)
			}
		}
		sort.Strings(missing)
		if len(missing) > 0 {
			t.Errorf("%q: no way to supply required input %v of %s", command.Name, missing, command.OperationID)
		}
	}
}
