package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

// The test bench: a fake host that answers the delegate door with a fake
// Gateway, and a scripted model provider. The door transport, the credential
// and provider stores, the session store and the loop are all real — what is
// faked is exactly the two things outside this module: the Gateway behind the
// door and the model behind the adapter.

const (
	testPrincipal  = "alice"
	testCredential = "tsa_test-secret-credential-value"
	testAPIKey     = "sk-ant-test-api-key-value-0001"
)

// Catalog entries in the Gateway's own projection (apicontract.CatalogOperation).
const (
	opStatus  = "terra.daemon.status.get"
	opRestart = "terra.daemon.modules.by-module-id.restart.post"
	opExec    = "terra.daemon.commands.execute.post"
)

var testCatalog = map[string]string{
	opStatus: `{"operationId":"terra.daemon.status.get","title":"Status","permissions":["node.read"],
		"execution":{"risk":"read","idempotencyMode":"safe","retryMode":"safe-only"},"output":{"mode":"immediate"},
		"sideEffects":[{"action":"read"}]}`,
	opRestart: `{"operationId":"terra.daemon.modules.by-module-id.restart.post","title":"Restart module","permissions":["node.control"],
		"execution":{"risk":"write","idempotencyMode":"idempotent","retryMode":"never"},"output":{"mode":"immediate"},
		"sideEffects":[{"action":"update"}]}`,
	opExec: `{"operationId":"terra.daemon.commands.execute.post","title":"Execute","permissions":["process.execute"],
		"execution":{"risk":"dangerous","idempotencyMode":"none","retryMode":"never"},"output":{"mode":"accepted-job"}}`,
}

// fakeGateway is what the door reaches. It checks the credential the door
// presents, serves the catalog, and records invokes.
type fakeGateway struct {
	mu           sync.Mutex
	credential   string
	invokes      []string
	invokeStatus map[string]int
	seenPaths    []string
	// whoami is what the Gateway says about the presented credential. A test
	// that changes it is changing the credential, which is where reach and
	// pre-approval actually live.
	whoami string
}

// traceFor is the id this fake Gateway stamps on a call, derived from the call
// so a test can assert the record carries the SAME id the Gateway answered
// with rather than merely a non-empty one.
func traceFor(method, path string) string {
	return "trace-" + strings.NewReplacer(" ", "-", "/", "_", "?", "-").Replace(method+path)
}

func (g *fakeGateway) serve(input modulert.GatewayDelegateInput) modulert.GatewayDelegateOutput {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.seenPaths = append(g.seenPaths, input.Method+" "+input.Path)
	if input.Credential != g.credential {
		return modulert.GatewayDelegateOutput{Status: 401, Body: []byte(`{"error":{"code":"AUTH_INVALID","message":"unknown credential"}}`)}
	}
	path := input.Path
	if q := strings.IndexByte(path, '?'); q >= 0 {
		path = path[:q]
	}
	switch {
	case path == "/api/v1/agent/whoami":
		answer := g.whoami
		if answer == "" {
			answer = `{"principal":"` + testPrincipal + `","permissions":["node.read","node.control"],"delegate":"agent:agn_test","reach":"local","reachLimited":true,"expiresAt":"2999-01-01T00:00:00Z"}`
		}
		return modulert.GatewayDelegateOutput{Status: 200, Body: []byte(answer)}
	case path == "/api/v1/catalog":
		items := []string{}
		for _, id := range []string{opStatus, opRestart, opExec} {
			items = append(items, testCatalog[id])
		}
		return modulert.GatewayDelegateOutput{Status: 200, Body: []byte(`{"count":3,"operations":[` + strings.Join(items, ",") + `]}`)}
	case strings.HasPrefix(path, "/api/v1/catalog/operations/"):
		id := strings.TrimPrefix(path, "/api/v1/catalog/operations/")
		if body, ok := testCatalog[id]; ok {
			return modulert.GatewayDelegateOutput{Status: 200, Body: []byte(body)}
		}
		return modulert.GatewayDelegateOutput{Status: 404, Body: []byte(`{"error":{"code":"OPERATION_NOT_FOUND","message":"no"}}`)}
	case strings.HasPrefix(path, "/api/v1/operations/") && strings.HasSuffix(path, "/invoke"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/operations/"), "/invoke")
		g.invokes = append(g.invokes, id)
		if status, ok := g.invokeStatus[id]; ok && status >= 400 {
			return modulert.GatewayDelegateOutput{Status: status, Body: []byte(`{"error":{"code":"UPSTREAM_FAILED","message":"boom","traceId":"t1"}}`)}
		}
		return modulert.GatewayDelegateOutput{Status: 200, Body: []byte(`{"ok":true,"operation":"` + id + `"}`)}
	}
	return modulert.GatewayDelegateOutput{Status: 404, Body: []byte(`{"error":{"code":"NOT_FOUND","message":"off surface"}}`)}
}

func (g *fakeGateway) invoked() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.invokes...)
}

func (g *fakeGateway) touched(prefix string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, seen := range g.seenPaths {
		if strings.HasPrefix(seen, prefix) {
			return true
		}
	}
	return false
}

// fakeHost serves the core capability plane the SDK client speaks, and routes
// terra.gateway.delegate to the fake Gateway.
func fakeHost(t *testing.T, gateway *fakeGateway) *modulesdk.CoreClient {
	t.Helper()
	const credential = "workload-credential"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != modulert.CoreInvokePath || r.Header.Get(modulert.CredentialHeader) != credential {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var invocation modulert.CoreInvocation
		if err := json.NewDecoder(r.Body).Decode(&invocation); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if invocation.OperationID != modulert.GatewayDelegateOperationID {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"code":"CORE_OPERATION_DENIED","message":"not declared"}}`))
			return
		}
		var input modulert.GatewayDelegateInput
		if err := json.Unmarshal(invocation.Input, &input); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		answer := gateway.serve(input)
		// A real Gateway stamps X-Terra-Trace-Id on every response and the door
		// carries it; the fake does the same so the join is exercised.
		answer.TraceID = traceFor(input.Method, input.Path)
		output, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(modulert.CoreResult{Output: output})
	}))
	t.Cleanup(server.Close)
	return modulesdk.NewCoreClient(server.Listener.Addr().String(), credential, nil)
}

// scriptedProvider answers each model call from a script and keeps every
// request it saw, so a test can look at what the model was shown.
type scriptedProvider struct {
	mu       sync.Mutex
	steps    []func(Request) (Response, error)
	requests []Request
}

func (p *scriptedProvider) Name() string  { return "scripted" }
func (p *scriptedProvider) Model() string { return "scripted-1" }

// Complete honours the context the way a real adapter's HTTP client does: the
// call is abandoned when the turn's clock runs out, rather than returning an
// answer nobody is waiting for any more.
func (p *scriptedProvider) Complete(ctx context.Context, request Request) (Response, error) {
	p.mu.Lock()
	p.requests = append(p.requests, request)
	index := len(p.requests) - 1
	step := func(Request) (Response, error) { return textResponse("done"), nil }
	if index < len(p.steps) {
		step = p.steps[index]
	}
	p.mu.Unlock()

	type outcome struct {
		response Response
		err      error
	}
	answered := make(chan outcome, 1)
	go func() {
		response, err := step(request)
		answered <- outcome{response, err}
	}()
	select {
	case <-ctx.Done():
		return Response{}, ctx.Err()
	case out := <-answered:
		return out.response, out.err
	}
}

func (p *scriptedProvider) seen() []Request {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]Request(nil), p.requests...)
}

func textResponse(text string) Response {
	return Response{Message: Message{Role: roleAssistant, Blocks: []Block{{Type: blockText, Text: text}}}, StopReason: stopEndTurn, Usage: Usage{InputTokens: 10, OutputTokens: 5}}
}

func toolCall(id, name, input string) Block {
	return Block{Type: blockToolUse, ID: id, Name: name, Input: json.RawMessage(input)}
}

func toolResponse(text string, calls ...Block) Response {
	blocks := []Block{}
	if text != "" {
		blocks = append(blocks, Block{Type: blockText, Text: text})
	}
	blocks = append(blocks, calls...)
	return Response{Message: Message{Role: roleAssistant, Blocks: blocks}, StopReason: stopToolUse, Usage: Usage{InputTokens: 10, OutputTokens: 5}}
}

func always(response Response) func(Request) (Response, error) {
	return func(Request) (Response, error) { return response, nil }
}

// invokeCall is the model asking terra_invoke for one operation.
func invokeCall(id, operationID, input, reason string) Block {
	arguments, _ := json.Marshal(map[string]any{"operationId": operationID, "input": json.RawMessage(input), "reason": reason})
	return toolCall(id, "terra_invoke", string(arguments))
}

// lastToolResult reads the tool_result content the model was handed for a
// given tool_use id, from the requests the provider saw.
func lastToolResult(t *testing.T, provider *scriptedProvider, toolUseID string) (map[string]any, bool) {
	t.Helper()
	requests := provider.seen()
	for i := len(requests) - 1; i >= 0; i-- {
		for _, message := range requests[i].Messages {
			for _, block := range message.Blocks {
				if block.Type == blockToolResult && block.ToolUseID == toolUseID {
					var decoded map[string]any
					if err := json.Unmarshal([]byte(block.Content), &decoded); err != nil {
						t.Fatalf("tool result for %s is not JSON: %s", toolUseID, block.Content)
					}
					return decoded, block.IsError
				}
			}
		}
	}
	return nil, false
}

type bench struct {
	engine   *engine
	gateway  *fakeGateway
	provider *scriptedProvider
	root     string
}

func newBench(t *testing.T, steps ...func(Request) (Response, error)) *bench {
	t.Helper()
	root := t.TempDir()
	credentials, err := newCredentialStore(root)
	if err != nil {
		t.Fatal(err)
	}
	providers, err := newProviderStore(root)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := newSessionStore(root, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	gateway := &fakeGateway{credential: testCredential, invokeStatus: map[string]int{}}
	core := fakeHost(t, gateway)
	mcp, err := newMCPRegistry(root)
	if err != nil {
		t.Fatalf("mcp registry: %v", err)
	}
	e := newEngine(sessions, credentials, providers, mcp, core, time.Now)
	provider := &scriptedProvider{steps: steps}
	e.openProvider = func(string) (Provider, error) { return provider, nil }
	e.approvalWait = 5 * time.Second
	if err := credentials.put(credentialRecord{Principal: testPrincipal, Credential: testCredential, Delegate: "agent:agn_test", Reach: "local", Permissions: []string{"node.read", "node.control"}, ExpiresAt: "2999-01-01T00:00:00Z", RegisteredMS: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.put(providerConfig{Provider: "anthropic", APIKey: testAPIKey}, true); err != nil {
		t.Fatal(err)
	}
	return &bench{engine: e, gateway: gateway, provider: provider, root: root}
}

// runPrompt opens a session and runs one prompt to completion.
func (b *bench) runPrompt(t *testing.T, autonomy string, simulate bool, prompt string) *session {
	t.Helper()
	provider, err := b.engine.prepare(testPrincipal, "")
	if err != nil {
		t.Fatal(err)
	}
	current, _, err := b.engine.sessions.open(sessionOptions{Autonomy: autonomy, Simulate: simulate, Provider: provider.Name(), Model: provider.Model(), MaxSteps: 6}, testPrincipal)
	if err != nil {
		t.Fatal(err)
	}
	b.engine.run(context.Background(), current, prompt, provider)
	return current
}

func entriesOfKind(s *session, kind string) []entry {
	result := []entry{}
	for _, line := range s.entriesAfter(0, 0) {
		if line.Kind == kind {
			result = append(result, line)
		}
	}
	return result
}
