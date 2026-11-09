package vdevice

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The routes live in two places: contracts/api/terra-api.json, which is what
// the Gateway publishes, and NewHandler, which is what this process serves. A
// one-sided edit leaves a route that looks published and answers 404, or a
// handler no caller can reach. This file holds the two against each other in
// both directions, plus the error vocabulary and its HTTP statuses.

const contractRelativePath = "../../contracts/api/terra-api.json"

type contractDocument struct {
	Errors map[string]struct {
		Retryable  bool `json:"retryable"`
		HTTPStatus int  `json:"httpStatus"`
	} `json:"errors"`
	Operations map[string]struct {
		Bindings []struct {
			Type   string `json:"type"`
			Method string `json:"method"`
			Path   string `json:"path"`
		} `json:"bindings"`
		Errors []string `json:"errors"`
	} `json:"operations"`
	Provider struct {
		ID string `json:"id"`
	} `json:"provider"`
}

func loadContract(t *testing.T) contractDocument {
	t.Helper()
	raw, err := os.ReadFile(contractRelativePath)
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var document contractDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("decode contract: %v", err)
	}
	return document
}

// contractRoutes is the set of "METHOD path" the contract publishes.
func contractRoutes(t *testing.T) map[string]string {
	t.Helper()
	routes := map[string]string{}
	for id, operation := range loadContract(t).Operations {
		bindings := 0
		for _, binding := range operation.Bindings {
			if binding.Type != "gateway-http" {
				continue
			}
			bindings++
			key := binding.Method + " " + binding.Path
			if existing, duplicate := routes[key]; duplicate {
				t.Fatalf("%s and %s both bind %s", existing, id, key)
			}
			routes[key] = id
		}
		if bindings != 1 {
			t.Fatalf("%s has %d gateway-http bindings, want exactly 1", id, bindings)
		}
	}
	return routes
}

// handlerRoutes reads the patterns NewHandler registers, by parsing api.go
// rather than by exercising the server: a route registered but unreachable and
// a route never registered look the same from the outside, and the point here
// is the registration.
func handlerRoutes(t *testing.T) map[string]bool {
	t.Helper()
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "api.go", nil, 0)
	if err != nil {
		t.Fatalf("parse api.go: %v", err)
	}
	routes := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) == 0 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "HandleFunc" {
			return true
		}
		pattern, ok := routePattern(call.Args[0])
		if !ok || pattern == "/" {
			return true
		}
		routes[pattern] = true
		return true
	})
	return routes
}

// routePattern renders `"GET " + APIPrefix + "/status"` back into a string.
func routePattern(expression ast.Expr) (string, bool) {
	switch typed := expression.(type) {
	case *ast.BasicLit:
		if typed.Kind != token.STRING {
			return "", false
		}
		value, err := strconv.Unquote(typed.Value)
		if err != nil {
			return "", false
		}
		return value, true
	case *ast.Ident:
		if typed.Name == "APIPrefix" {
			return APIPrefix, true
		}
		return "", false
	case *ast.BinaryExpr:
		if typed.Op != token.ADD {
			return "", false
		}
		left, okLeft := routePattern(typed.X)
		right, okRight := routePattern(typed.Y)
		if !okLeft || !okRight {
			return "", false
		}
		return left + right, true
	default:
		return "", false
	}
}

func TestEveryContractRouteIsServed(t *testing.T) {
	served := handlerRoutes(t)
	for route, operation := range contractRoutes(t) {
		if !served[route] {
			t.Errorf("%s publishes %q and no handler serves it: the route answers 404", operation, route)
		}
	}
}

func TestEveryServedRouteIsInTheContract(t *testing.T) {
	published := contractRoutes(t)
	for route := range handlerRoutes(t) {
		if _, ok := published[route]; !ok {
			t.Errorf("api.go serves %q and the contract does not publish it: no caller can reach it", route)
		}
	}
}

// §16.2 lists two more routes than Phase 0 serves. They are absent from both
// sides on purpose, and this records which — so the next phase adds them rather
// than rediscovering the gap.
func TestTheTwoDeferredRoutesAreInNeitherSide(t *testing.T) {
	deferred := []string{
		"POST " + APIPrefix + "/adapters/{adapter_id}/driver-plan",
		"GET " + APIPrefix + "/events",
	}
	published := contractRoutes(t)
	served := handlerRoutes(t)
	for _, route := range deferred {
		if _, ok := published[route]; ok {
			t.Errorf("the contract publishes %q; Phase 0 does not serve it", route)
		}
		if served[route] {
			t.Errorf("api.go serves %q; the contract does not publish it", route)
		}
	}
}

// Every §21 code the Go side can emit must be in the contract's vocabulary, and
// every code the contract defines must be reachable from Go. A code in one and
// not the other is a caller reading a definition for something that never
// happens, or receiving a code with no definition to look up.
func TestErrorVocabulariesMatch(t *testing.T) {
	contract := loadContract(t)
	goCodes := goErrorCodes(t)

	declared := map[string]bool{}
	for code := range contract.Errors {
		declared[code] = true
		if !goCodes[code] {
			t.Errorf("the contract defines %s and no Go constant names it", code)
		}
	}
	for code := range goCodes {
		if !declared[code] {
			t.Errorf("Go can emit %s and the contract does not define it", code)
		}
	}

	// An operation may not cite a code the contract never defines.
	for id, operation := range contract.Operations {
		for _, code := range operation.Errors {
			if !declared[code] {
				t.Errorf("%s cites %s, which the contract does not define", id, code)
			}
		}
	}
}

// retryable and httpStatus are promises printed in the contract. The process
// has to keep them.
func TestRetryableAndHTTPStatusAgreeWithTheContract(t *testing.T) {
	for code, definition := range loadContract(t).Errors {
		if got := retryableCode(code); got != definition.Retryable {
			t.Errorf("%s: Go says retryable=%v, the contract says %v", code, got, definition.Retryable)
		}
		if definition.HTTPStatus == 0 {
			t.Errorf("%s declares no httpStatus", code)
			continue
		}
		if got := httpStatusFor(code); got != definition.HTTPStatus {
			t.Errorf("%s: Go answers %d, the contract says %d", code, got, definition.HTTPStatus)
		}
	}
}

// goErrorCodes reads the VDEV_* string constants out of model.go, so a code
// added in Go without a contract entry fails here rather than in production.
func goErrorCodes(t *testing.T) map[string]bool {
	t.Helper()
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "model.go", nil, 0)
	if err != nil {
		t.Fatalf("parse model.go: %v", err)
	}
	codes := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(literal.Value)
		if err != nil || !strings.HasPrefix(value, "VDEV_") {
			return true
		}
		codes[value] = true
		return true
	})
	if len(codes) == 0 {
		t.Fatal("no VDEV_ codes found in model.go — the sweep stopped matching")
	}
	return codes
}

// The provider id is what the Gateway routes this module by, and the module
// directory is what names the package.
func TestProviderIDMatchesTheModuleDirectory(t *testing.T) {
	if got := loadContract(t).Provider.ID; got != ModuleID {
		t.Fatalf("provider.id = %q, want %q", got, ModuleID)
	}
	absolute, err := filepath.Abs(contractRelativePath)
	if err != nil {
		t.Fatal(err)
	}
	if base := filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(absolute)))); base != ModuleID {
		t.Fatalf("the contract path names %q, not %q", base, ModuleID)
	}
}

// A small readability guard: the operation ids are all namespaced under the
// module id, so a catalog listing them groups them together.
//
// No count is pinned here. The route cross-check above already forces the
// number from both sides, and a hand-maintained total is the thing that goes
// stale — this repository removed three such pins for exactly that reason
// (implemented-features §13 2-1). A sweep that matched nothing would pass
// silently though, so that much is checked.
func TestOperationIDsAreNamespacedUnderTheModule(t *testing.T) {
	ids := []string{}
	for id := range loadContract(t).Operations {
		ids = append(ids, id)
		if !strings.HasPrefix(id, ModuleID+".") {
			t.Errorf("operation %q is not namespaced under %q", id, ModuleID)
		}
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		t.Fatal("the contract declares no operations — the decode stopped matching")
	}
}
