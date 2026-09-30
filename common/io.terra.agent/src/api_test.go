package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/terra-project/terra/products/common/packages/terra-testwait"
)

// The operation surface, driven the way the Gateway drives it: the same paths
// the contract binds, the caller's principal in the header the Gateway stamps.

type surface struct {
	*bench
	server *httptest.Server
}

func newSurface(t *testing.T, steps ...func(Request) (Response, error)) *surface {
	t.Helper()
	b := newBench(t, steps...)
	server := httptest.NewServer(newOperationsHandler(b.engine))
	t.Cleanup(server.Close)
	return &surface{bench: b, server: server}
}

func (s *surface) call(t *testing.T, principal, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, s.server.URL+apiPrefix+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if principal != "" {
		request.Header.Set(principalHeader, principal)
	}
	if reader != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	decoded := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("%s %s: not JSON: %s", method, path, raw)
		}
	}
	return response.StatusCode, decoded
}

func errorCode(body map[string]any) string {
	if fail, ok := body["error"].(map[string]any); ok {
		code, _ := fail["code"].(string)
		return code
	}
	return ""
}

func TestStatusReportsTheDoorAndRegistrations(t *testing.T) {
	s := newSurface(t)
	status, body := s.call(t, "", "GET", "/status", nil)
	if status != 200 || body["status"] != "ok" || body["delegate_door"] != true || body["models_registered"] != float64(1) {
		t.Fatalf("status = %d %v", status, body)
	}
}

func TestCredentialRegistrationAsksTheGatewayAndKeepsTheValue(t *testing.T) {
	s := newSurface(t)
	const bob = "bob"

	// A user session token is refused before the Gateway is even asked.
	status, body := s.call(t, bob, "PUT", "/credentials", map[string]any{"credential": "sess-bob-token-value"})
	if status != 400 || errorCode(body) != "INVALID_REQUEST" {
		t.Fatalf("session token: %d %v", status, body)
	}
	// A delegated credential the Gateway does not know is rejected, not stored.
	status, body = s.call(t, bob, "PUT", "/credentials", map[string]any{"credential": "tsa_unknown-value-here"})
	if status != 403 || errorCode(body) != "CREDENTIAL_REJECTED" {
		t.Fatalf("unknown credential: %d %v", status, body)
	}
	if _, registered := s.engine.credentials.get(bob); registered {
		t.Fatal("a rejected credential was stored")
	}
	// The live one is verified through the door and its facts come back — never the value.
	status, body = s.call(t, bob, "PUT", "/credentials", map[string]any{"credential": testCredential})
	if status != 200 || body["registered"] != true || body["delegate"] != "agent:agn_test" || body["principal"] != bob {
		t.Fatalf("register: %d %v", status, body)
	}
	if encoded, _ := json.Marshal(body); strings.Contains(string(encoded), testCredential) {
		t.Fatalf("the response carries the credential value: %s", encoded)
	}
	status, body = s.call(t, bob, "GET", "/credentials", nil)
	if status != 200 || body["registered"] != true || body["expired"] != false {
		t.Fatalf("get: %d %v", status, body)
	}
	if encoded, _ := json.Marshal(body); strings.Contains(string(encoded), testCredential) {
		t.Fatalf("get leaks the credential value: %s", encoded)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(s.root, credentialsFileName))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("credentials file mode = %o, want 600", info.Mode().Perm())
		}
	}
	status, body = s.call(t, bob, "DELETE", "/credentials", nil)
	if status != 200 || body["removed"] != true {
		t.Fatalf("delete: %d %v", status, body)
	}
	status, body = s.call(t, bob, "GET", "/credentials", nil)
	if status != 200 || body["registered"] != false {
		t.Fatalf("get after delete: %d %v", status, body)
	}
	// Without the Gateway's principal there is nobody to bind a credential to.
	if status, body = s.call(t, "", "PUT", "/credentials", map[string]any{"credential": testCredential}); status != 400 || errorCode(body) != "INVALID_REQUEST" {
		t.Fatalf("no principal: %d %v", status, body)
	}
}

func TestModelRegistrationNeverReturnsTheKey(t *testing.T) {
	s := newSurface(t)
	if _, err := s.engine.providers.delete("anthropic"); err != nil {
		t.Fatal(err)
	}
	status, body := s.call(t, testPrincipal, "PUT", "/models/openai", map[string]any{"api_key": "sk-something-long-enough"})
	if status != 400 || errorCode(body) != "INVALID_REQUEST" {
		t.Fatalf("unknown provider: %d %v", status, body)
	}
	status, body = s.call(t, testPrincipal, "PUT", "/models/anthropic", map[string]any{"api_key": "short"})
	if status != 400 {
		t.Fatalf("short key: %d %v", status, body)
	}
	status, body = s.call(t, testPrincipal, "PUT", "/models/anthropic", map[string]any{"api_key": testAPIKey, "model": "claude-opus-5"})
	if status != 200 || body["registered"] != true || body["default"] != true || body["model"] != "claude-opus-5" {
		t.Fatalf("register: %d %v", status, body)
	}
	status, body = s.call(t, testPrincipal, "GET", "/models", nil)
	if status != 200 || body["default"] != "anthropic" {
		t.Fatalf("list: %d %v", status, body)
	}
	if encoded, _ := json.Marshal(body); strings.Contains(string(encoded), testAPIKey) {
		t.Fatalf("the listing carries the key: %s", encoded)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(s.root, providersFileName))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("providers file mode = %o, want 600", info.Mode().Perm())
		}
	}
	status, body = s.call(t, testPrincipal, "DELETE", "/models/anthropic", nil)
	if status != 200 || body["removed"] != true {
		t.Fatalf("delete: %d %v", status, body)
	}
	if status, body = s.call(t, testPrincipal, "GET", "/models", nil); body["default"] != "" {
		t.Fatalf("default after delete: %d %v", status, body)
	}
}

func TestRunAnswersSynchronouslyWithTheWholeRecord(t *testing.T) {
	s := newSurface(t, always(toolResponse("", invokeCall("c1", opStatus, `{}`, "check"))), always(textResponse("all good")))
	status, body := s.call(t, testPrincipal, "POST", "/runs", map[string]any{"prompt": "how is the node?", "autonomy": "auto"})
	if status != 200 || body["state"] != stateDone || body["answer"] != "all good" || body["steps"] != float64(2) {
		t.Fatalf("run: %d %v", status, body)
	}
	entries := body["entries"].([]any)
	kinds := []string{}
	for _, raw := range entries {
		kinds = append(kinds, raw.(map[string]any)["kind"].(string))
	}
	// A model line precedes each turn: it is what left this node for the
	// provider, recorded before the answer came back (§8).
	if strings.Join(kinds, ",") != "user,model,call,model,assistant,done" {
		t.Fatalf("kinds = %v", kinds)
	}
	if got := s.gateway.invoked(); len(got) != 1 || got[0] != opStatus {
		t.Fatalf("invokes = %v", got)
	}
	// It is listed, with its owner, for `terra agent list`.
	status, body = s.call(t, testPrincipal, "GET", "/sessions", nil)
	if sessions := body["sessions"].([]any); status != 200 || len(sessions) != 1 || sessions[0].(map[string]any)["owner"] != testPrincipal {
		t.Fatalf("list: %d %v", status, body)
	}
}

func TestRunNeedsACredentialAndAModel(t *testing.T) {
	s := newSurface(t)
	if _, err := s.engine.credentials.delete(testPrincipal); err != nil {
		t.Fatal(err)
	}
	status, body := s.call(t, testPrincipal, "POST", "/runs", map[string]any{"prompt": "hi"})
	if status != 409 || errorCode(body) != "CREDENTIAL_MISSING" {
		t.Fatalf("no credential: %d %v", status, body)
	}
	if err := s.engine.credentials.put(credentialRecord{Principal: testPrincipal, Credential: testCredential, ExpiresAt: "2000-01-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if status, body = s.call(t, testPrincipal, "POST", "/runs", map[string]any{"prompt": "hi"}); status != 409 || errorCode(body) != "CREDENTIAL_MISSING" {
		t.Fatalf("expired credential: %d %v", status, body)
	}
	if err := s.engine.credentials.put(credentialRecord{Principal: testPrincipal, Credential: testCredential}); err != nil {
		t.Fatal(err)
	}
	// With the real provider table and nothing registered, the model is missing.
	s.engine.openProvider = func(name string) (Provider, error) { return s.engine.providers.open(name, nil) }
	if _, err := s.engine.providers.delete("anthropic"); err != nil {
		t.Fatal(err)
	}
	if status, body = s.call(t, testPrincipal, "POST", "/runs", map[string]any{"prompt": "hi"}); status != 409 || errorCode(body) != "MODEL_NOT_CONFIGURED" {
		t.Fatalf("no model: %d %v", status, body)
	}
	if status, body = s.call(t, testPrincipal, "POST", "/runs", map[string]any{"prompt": "hi", "autonomy": "yolo"}); status != 409 && status != 400 {
		t.Fatalf("bad autonomy: %d %v", status, body)
	}
	if s.gateway.touched("POST /api/v1/operations") {
		t.Fatal("a refused run reached the gateway")
	}
}

func TestSessionsAreOwnedByWhoOpenedThem(t *testing.T) {
	s := newSurface(t)
	status, body := s.call(t, testPrincipal, "POST", "/sessions", map[string]any{"session_id": "s1", "autonomy": "ask"})
	if status != 200 || body["created"] != true || body["viewer"] != testPrincipal || body["autonomy"] != "ask" {
		t.Fatalf("open: %d %v", status, body)
	}
	status, body = s.call(t, testPrincipal, "POST", "/sessions", map[string]any{"session_id": "s1"})
	if status != 200 || body["created"] != false || body["autonomy"] != "ask" {
		t.Fatalf("reopen: %d %v", status, body)
	}
	for _, probe := range []struct{ method, path string }{
		{"GET", "/sessions/s1"}, {"GET", "/sessions/s1/messages"}, {"POST", "/sessions/s1/cancel"},
	} {
		if status, body = s.call(t, "bob", probe.method, probe.path, nil); status != 403 || errorCode(body) != "SESSION_NOT_OWNED" {
			t.Fatalf("bob %s %s: %d %v", probe.method, probe.path, status, body)
		}
	}
	if status, body = s.call(t, "bob", "POST", "/sessions", map[string]any{"session_id": "s1"}); status != 403 {
		t.Fatalf("bob join: %d %v", status, body)
	}
	if status, body = s.call(t, testPrincipal, "GET", "/sessions/nope", nil); status != 404 || errorCode(body) != "SESSION_NOT_FOUND" {
		t.Fatalf("missing: %d %v", status, body)
	}
	if status, body = s.call(t, testPrincipal, "POST", "/sessions", map[string]any{"session_id": "../etc"}); status != 400 {
		t.Fatalf("bad id: %d %v", status, body)
	}
}

// openStream follows the session's SSE push and hands back the entries it
// sees, until the wanted text arrives or the deadline passes.
func (s *surface) openStream(t *testing.T, principal, sessionID string) (<-chan entry, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, "GET", s.server.URL+apiPrefix+"/sessions/"+sessionID+"/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(principalHeader, principal)
	request.Header.Set("Accept", "text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream: %d %s", response.StatusCode, response.Header.Get("Content-Type"))
	}
	events := make(chan entry, 64)
	go func() {
		defer response.Body.Close()
		defer close(events)
		scanner := bufio.NewScanner(response.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var payload struct {
				Event string `json:"event"`
				Entry entry  `json:"entry"`
			}
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &payload) == nil && payload.Event == "entry" {
				events <- payload.Entry
			}
		}
	}()
	return events, cancel
}

func collectUntil(t *testing.T, events <-chan entry, wanted func(entry) bool) []entry {
	t.Helper()
	seen := []entry{}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case line, open := <-events:
			if !open {
				t.Fatalf("stream closed before the wanted entry; saw %+v", seen)
			}
			seen = append(seen, line)
			if wanted(line) {
				return seen
			}
		case <-deadline:
			t.Fatalf("timed out waiting on the stream; saw %+v", seen)
		}
	}
}

func TestChatFlowsThroughMessagesStreamAndApprovals(t *testing.T) {
	s := newSurface(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"io.terra.sample"}`, "it is dead"))),
		always(textResponse("restarted io.terra.sample")),
	)
	if status, body := s.call(t, testPrincipal, "POST", "/sessions", map[string]any{"session_id": "chat", "autonomy": "ask"}); status != 200 {
		t.Fatalf("open: %d %v", status, body)
	}
	events, closeStream := s.openStream(t, testPrincipal, "chat")
	defer closeStream()

	status, body := s.call(t, testPrincipal, "POST", "/sessions/chat/messages", map[string]any{"session_id": "chat", "text": "restart the dead module"})
	if status != 201 || body["entry"].(map[string]any)["kind"] != kindUser {
		t.Fatalf("send: %d %v", status, body)
	}
	// The room sees its own line come back on the stream, then the question.
	seen := collectUntil(t, events, func(line entry) bool { return line.Kind == kindApproval })
	if seen[0].Kind != kindUser || seen[0].Author != testPrincipal || seen[0].Text != "restart the dead module" {
		t.Fatalf("first streamed entry = %+v", seen[0])
	}
	requestID := seen[len(seen)-1].RequestID

	status, body = s.call(t, testPrincipal, "GET", "/sessions/chat", nil)
	pending := body["pending_approvals"].([]any)
	if status != 200 || body["state"] != stateWaiting || len(pending) != 1 || pending[0].(map[string]any)["request_id"] != requestID {
		t.Fatalf("show: %d %v", status, body)
	}
	// Another person's approval is refused; the session is not theirs.
	if status, body = s.call(t, "bob", "POST", "/approvals/"+requestID, map[string]any{"request_id": requestID}); status != 403 {
		t.Fatalf("bob approve: %d %v", status, body)
	}
	status, body = s.call(t, testPrincipal, "POST", "/approvals/"+requestID, map[string]any{"request_id": requestID})
	if status != 200 || body["decision"] != "approved" || body["operation_id"] != opRestart || body["session_id"] != "chat" {
		t.Fatalf("approve: %d %v", status, body)
	}
	// Answered once: a second answer finds nothing.
	if status, body = s.call(t, testPrincipal, "POST", "/approvals/"+requestID, map[string]any{"request_id": requestID}); status != 404 || errorCode(body) != "APPROVAL_NOT_FOUND" {
		t.Fatalf("second answer: %d %v", status, body)
	}
	seen = collectUntil(t, events, func(line entry) bool { return line.Kind == kindDone })
	// The call line carries the Gateway's own id for the call — the key that
	// joins this record to the Gateway's audit trail.
	for _, line := range seen {
		if line.Kind == kindCall && line.OperationID == opRestart {
			if want := traceFor("POST", "/api/v1/operations/"+opRestart+"/invoke"); line.TraceID != want {
				t.Fatalf("call line trace = %q, want the id the gateway answered with (%q)", line.TraceID, want)
			}
			if !strings.Contains(line.Note, "trace="+line.TraceID) {
				t.Fatalf("the note does not show the join key: %q", line.Note)
			}
		}
	}
	kinds := []string{}
	for _, line := range seen {
		kinds = append(kinds, line.Kind)
	}
	if strings.Join(kinds, ",") != "approved,call,model,assistant,done" {
		t.Fatalf("streamed after approval: %v", kinds)
	}
	if got := s.gateway.invoked(); len(got) != 1 || got[0] != opRestart {
		t.Fatalf("invokes = %v", got)
	}
	status, body = s.call(t, testPrincipal, "GET", "/sessions/chat/messages?after_seq=2", nil)
	// user(1) model(2) | approval(3) approved(4) call(5) model(6) assistant(7) done(8)
	if entries := body["entries"].([]any); status != 200 || len(entries) != 6 || entries[0].(map[string]any)["seq"] != float64(3) {
		t.Fatalf("history after 2: %d %v", status, body)
	}
}

func TestATypedAnswerResolvesTheQuestion(t *testing.T) {
	s := newSurface(t,
		always(toolResponse("", invokeCall("c1", opRestart, `{"module_id":"x"}`, "restart"))),
		always(textResponse("done")),
	)
	s.call(t, testPrincipal, "POST", "/sessions", map[string]any{"session_id": "typed", "autonomy": "ask"})
	if status, body := s.call(t, testPrincipal, "POST", "/sessions/typed/messages", map[string]any{"session_id": "typed", "text": "restart"}); status != 201 {
		t.Fatalf("send: %d %v", status, body)
	}
	current, _ := s.engine.sessions.get("typed")
	testwait.Until(t, "a question", func() bool { return current.pendingCount() == 1 })
	// While waiting, an ordinary line is busy; "deny" is an answer.
	if status, body := s.call(t, testPrincipal, "POST", "/sessions/typed/messages", map[string]any{"session_id": "typed", "text": "also check logs"}); status != 409 || errorCode(body) != "SESSION_BUSY" {
		t.Fatalf("busy: %d %v", status, body)
	}
	if status, body := s.call(t, testPrincipal, "POST", "/sessions/typed/messages", map[string]any{"session_id": "typed", "text": "deny"}); status != 201 {
		t.Fatalf("deny: %d %v", status, body)
	}
	testwait.Until(t, "the turn to end", func() bool { return current.snapshot()["state"] == stateIdle })
	if got := s.gateway.invoked(); len(got) != 0 {
		t.Fatalf("a denied call reached the gateway: %v", got)
	}
	if status, body := s.call(t, testPrincipal, "POST", "/sessions/typed/cancel", nil); status != 200 || body["state"] != stateCancelled {
		t.Fatalf("cancel: %d %v", status, body)
	}
	if status, body := s.call(t, testPrincipal, "POST", "/sessions/typed/messages", map[string]any{"session_id": "typed", "text": "more"}); status != 409 || errorCode(body) != "SESSION_FINISHED" {
		t.Fatalf("after cancel: %d %v", status, body)
	}
}
