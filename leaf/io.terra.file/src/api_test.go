package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"
)

// contractPath is where the operations this module serves are declared. The
// repository rule is contract first, so this file is the authority and the
// handlers are what must agree with it.
const contractPath = "../contracts/api/terra-api.json"

// declaredErrorCodes reads the contract's error vocabulary.
func declaredErrorCodes(t *testing.T) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract struct {
		Errors     map[string]json.RawMessage `json:"errors"`
		Operations map[string]struct {
			Errors []string `json:"errors"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}
	declared := make(map[string]bool, len(contract.Errors))
	for code := range contract.Errors {
		declared[code] = true
	}
	// An operation may not cite a code the contract never defines; that would
	// send a reader looking for a definition that is not there.
	for operation, spec := range contract.Operations {
		for _, code := range spec.Errors {
			if !declared[code] {
				t.Errorf("operation %s cites %s, which the contract does not define", operation, code)
			}
		}
	}
	return declared
}

// emittedErrorCodes collects the codes the handlers actually write, by reading
// the literals passed to writeAPIError rather than by exercising every failure —
// some of these need a filesystem that refuses in a specific way, and the point
// here is coverage of the vocabulary, not of the conditions.
func emittedErrorCodes(t *testing.T) map[string]string {
	t.Helper()
	sources, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob sources: %v", err)
	}
	emitted := map[string]string{}
	fileSet := token.NewFileSet()
	for _, source := range sources {
		parsed, err := parser.ParseFile(fileSet, source, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", source, err)
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			name, ok := call.Fun.(*ast.Ident)
			if !ok || name.Name != "writeAPIError" || len(call.Args) < 3 {
				return true
			}
			literal, ok := call.Args[2].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			code, err := strconv.Unquote(literal.Value)
			if err != nil {
				return true
			}
			emitted[code] = source
			return true
		})
	}
	if len(emitted) == 0 {
		t.Fatal("no error codes were found in the handlers; the scan is broken, not the code")
	}
	return emitted
}

// TestEveryEmittedErrorCodeIsDeclared closes the gap that let the contract
// promise PATH_DENIED as FILE_PATH_DENIED for a whole release: nothing compared
// the two vocabularies, so the module answered with one spelling while the
// document other programs read carried another. A contract that names errors the
// module never sends is worse than no list — a caller writes a branch for a code
// that cannot arrive, and the branch that would have caught the real failure is
// the one they did not write.
func TestEveryEmittedErrorCodeIsDeclared(t *testing.T) {
	declared := declaredErrorCodes(t)
	emitted := emittedErrorCodes(t)

	missing := make([]string, 0)
	for code, source := range emitted {
		if !declared[code] {
			missing = append(missing, code+" ("+source+")")
		}
	}
	sort.Strings(missing)
	for _, code := range missing {
		t.Errorf("%s is written by a handler but the contract does not declare it", code)
	}
}

// TestEveryDeclaredErrorCodeIsReachable is the other direction, and it is the
// one that found FILE_DIRECTORY_NOT_EMPTY: a code the contract described, with a
// remedy spelled out for the operator, that no code path could ever produce.
func TestEveryDeclaredErrorCodeIsReachable(t *testing.T) {
	declared := declaredErrorCodes(t)
	emitted := emittedErrorCodes(t)

	unreachable := make([]string, 0)
	for code := range declared {
		if _, found := emitted[code]; !found {
			unreachable = append(unreachable, code)
		}
	}
	sort.Strings(unreachable)
	for _, code := range unreachable {
		t.Errorf("the contract declares %s but no handler writes it", code)
	}
}
