package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

func staticNodeID(id string) func(context.Context) string {
	return func(context.Context) string { return id }
}

func newTestDeps(t *testing.T, self string) serverDeps {
	t.Helper()
	store, err := talk.NewStore(t.TempDir(), func() string { return self })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	return serverDeps{ResolveNodeID: staticNodeID(self), Store: store}
}

// probePath turns a route's wildcard path into a concrete request path.
func probePath(route operationRoute) string {
	path := strings.ReplaceAll(route.Path, "{conversation_id}", "cv-test")
	path = strings.ReplaceAll(path, "{node_id}", "node-test")
	return apiPrefix + path
}

func doJSON(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeInto(t *testing.T, recorder *httptest.ResponseRecorder, value any) {
	t.Helper()
	if err := json.Unmarshal(recorder.Body.Bytes(), value); err != nil {
		t.Fatalf("decode response: %v\n%s", err, recorder.Body.String())
	}
}

func TestStatusAnswersTheContractShape(t *testing.T) {
	handler := newOperationsHandler(newTestDeps(t, "node-a"))
	recorder := doJSON(t, handler, "GET", apiPrefix+"/status", nil)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", recorder.Code)
	}
	var status struct {
		Status            string `json:"status"`
		Version           string `json:"version"`
		NodeID            string `json:"node_id"`
		ConversationCount *int   `json:"conversation_count"`
		FaultsEnabled     *bool  `json:"faults_enabled"`
	}
	decodeInto(t, recorder, &status)
	if status.Status != "ok" || status.Version != moduleVersion || status.NodeID != "node-a" {
		t.Fatalf("status fields: %+v", status)
	}
	// The contract requires these; a missing field would pass a zero-value
	// check, so presence is asserted through pointers.
	if status.ConversationCount == nil || status.FaultsEnabled == nil {
		t.Fatal("status is missing contract-required fields conversation_count / faults_enabled")
	}
}

// Every unimplemented route must be mounted (the published surface matches the
// contract) and must refuse honestly: 501, NOT_IMPLEMENTED, naming its
// milestone — never a 404 that reads as a publication bug, never a fake 200.
func TestUnimplementedRoutesRefuseHonestly(t *testing.T) {
	handler := newOperationsHandler(newTestDeps(t, "node-a"))
	stubbed := 0
	for _, route := range operationRoutes {
		if route.Milestone == "" {
			continue
		}
		stubbed++
		recorder := doJSON(t, handler, route.Method, probePath(route), nil)
		if recorder.Code != http.StatusNotImplemented {
			t.Errorf("%s: got %d, want 501", route.OperationID, recorder.Code)
			continue
		}
		var envelope struct {
			Error apiError `json:"error"`
		}
		decodeInto(t, recorder, &envelope)
		if envelope.Error.Code != "NOT_IMPLEMENTED" {
			t.Errorf("%s: code %q, want NOT_IMPLEMENTED", route.OperationID, envelope.Error.Code)
		}
		if !strings.Contains(envelope.Error.Message, route.Milestone) {
			t.Errorf("%s: message does not name milestone %s: %q", route.OperationID, route.Milestone, envelope.Error.Message)
		}
	}
	// M5 closed the last stubs. The loop above still stands guard: if a future
	// operation lands in the table with a milestone, it must refuse honestly
	// until implemented.
	if stubbed != 0 {
		t.Fatalf("stubbed routes: %d, want 0 — every contract operation is implemented", stubbed)
	}
}

// The M1 happy path over the mounted mux: create → list → get → post → list,
// each response in the contract's shape.
func TestConversationRoundtrip(t *testing.T) {
	handler := newOperationsHandler(newTestDeps(t, "node-a"))

	created := doJSON(t, handler, "POST", apiPrefix+"/conversations", map[string]any{
		"display_name": "릴레이 점검",
		"members":      []string{"node-b"},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create: got %d: %s", created.Code, created.Body.String())
	}
	var createdBody struct {
		Conversation talk.Conversation `json:"conversation"`
	}
	decodeInto(t, created, &createdBody)
	conversation := createdBody.Conversation
	if conversation.Role != "main" || conversation.Epoch != 0 || len(conversation.Members) != 2 {
		t.Fatalf("created conversation: %+v", conversation)
	}

	listed := doJSON(t, handler, "GET", apiPrefix+"/conversations", nil)
	var listBody struct {
		Conversations []talk.Summary `json:"conversations"`
	}
	decodeInto(t, listed, &listBody)
	if len(listBody.Conversations) != 1 || listBody.Conversations[0].Behind != 0 {
		t.Fatalf("list: %+v", listBody)
	}

	posted := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+conversation.ConversationID+"/messages",
		map[string]any{"text": "L0로 갑니다"})
	if posted.Code != http.StatusCreated {
		t.Fatalf("post: got %d: %s", posted.Code, posted.Body.String())
	}
	var postBody struct {
		Entry talk.Entry `json:"entry"`
	}
	decodeInto(t, posted, &postBody)
	if postBody.Entry.AuthorNodeID != "node-a" || postBody.Entry.Seq != 1 || postBody.Entry.Kind != talk.KindMessage {
		t.Fatalf("posted entry: %+v", postBody.Entry)
	}

	messages := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+conversation.ConversationID+"/messages", nil)
	var messagesBody struct {
		Entries []talk.Entry `json:"entries"`
		HasMore bool         `json:"has_more"`
	}
	decodeInto(t, messages, &messagesBody)
	if len(messagesBody.Entries) != 1 || messagesBody.Entries[0].Text != "L0로 갑니다" {
		t.Fatalf("messages: %+v", messagesBody)
	}

	got := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+conversation.ConversationID, nil)
	var getBody struct {
		Conversation   talk.Conversation `json:"conversation"`
		HighWaterMarks map[string]int    `json:"high_water_marks"`
	}
	decodeInto(t, got, &getBody)
	if getBody.HighWaterMarks["node-a"] != 1 {
		t.Fatalf("watermarks: %+v", getBody.HighWaterMarks)
	}
}

func TestConversationErrorsSpeakTheContract(t *testing.T) {
	handler := newOperationsHandler(newTestDeps(t, "node-a"))

	missing := doJSON(t, handler, "GET", apiPrefix+"/conversations/cv-none", nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing conversation: got %d", missing.Code)
	}
	var envelope struct {
		Error apiError `json:"error"`
	}
	decodeInto(t, missing, &envelope)
	if envelope.Error.Code != "CONVERSATION_NOT_FOUND" {
		t.Fatalf("code: %q", envelope.Error.Code)
	}

	invalid := doJSON(t, handler, "POST", apiPrefix+"/conversations", map[string]any{
		"display_name": "", "members": []string{"node-b"},
	})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid create: got %d", invalid.Code)
	}
	decodeInto(t, invalid, &envelope)
	if envelope.Error.Code != "INVALID_REQUEST" {
		t.Fatalf("code: %q", envelope.Error.Code)
	}

	// additionalProperties:false — an unknown field is the caller's bug.
	unknown := doJSON(t, handler, "POST", apiPrefix+"/conversations", map[string]any{
		"display_name": "x", "members": []string{"node-b"}, "surprise": true,
	})
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field: got %d", unknown.Code)
	}
}

// The stream is the local push path: subscribe over real HTTP, post, and the
// entry must arrive as an SSE event without polling.
func TestMessagesStreamDeliversPostedEntries(t *testing.T) {
	deps := newTestDeps(t, "node-a")
	handler := newOperationsHandler(deps)
	server := httptest.NewServer(handler)
	defer server.Close()

	conversation, err := deps.Store.Create("실시간", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	request, err := http.NewRequest("GET", server.URL+apiPrefix+"/conversations/"+conversation.ConversationID+"/stream", nil)
	if err != nil {
		t.Fatalf("build stream request: %v", err)
	}
	request.Header.Set("Accept", "text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream response: %d %s", response.StatusCode, response.Header.Get("Content-Type"))
	}

	reader := bufio.NewReader(response.Body)
	// First frame is the ": connected" comment; consume until its blank line.
	if err := readSSEFrame(reader, nil); err != nil {
		t.Fatalf("read connected frame: %v", err)
	}

	if _, err := deps.Store.AppendMessage(conversation.ConversationID, "실시간 한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	frame := map[string]any{}
	done := make(chan error, 1)
	go func() { done <- readSSEFrame(reader, &frame) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("read event: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no SSE event within 5s")
	}
	if frame["event"] != "entry" {
		t.Fatalf("event payload: %v", frame)
	}
	entry, ok := frame["entry"].(map[string]any)
	if !ok || entry["text"] != "실시간 한 줄" {
		t.Fatalf("entry payload: %v", frame)
	}
}

// readSSEFrame reads one frame (up to a blank line). When payload is non-nil,
// the frame's data: line is JSON-decoded into it and a frame without data
// keeps reading (skips keepalive comments).
func readSSEFrame(reader *bufio.Reader, payload *map[string]any) error {
	for {
		data := ""
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return err
			}
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				break
			}
			if strings.HasPrefix(line, "data:") {
				data += strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			}
		}
		if payload == nil {
			return nil
		}
		if data == "" {
			continue // comment/keepalive frame — not what we wait for
		}
		return json.Unmarshal([]byte(data), payload)
	}
}

// probe.post measures what the process can measure and refuses the rest with a
// per-rung code — an unreachable rung is a RESULT, not an omission.
func TestProbeMeasuresSelfAndRefusesTheRest(t *testing.T) {
	// A stand-in workload endpoint so the self-L0 dial has something real to
	// measure: readiness behind the credential guard, like the SDK serves it.
	credential := "probe-credential"
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != modulert.ReadinessPath || r.Header.Get(modulert.CredentialHeader) != credential {
			http.Error(w, "forbidden", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ready":true}`))
	}))
	defer endpoint.Close()

	deps := newTestDeps(t, "node-a")
	deps.Identity = modulert.WorkloadIdentity{
		Endpoint:   strings.TrimPrefix(endpoint.URL, "http://"),
		Credential: credential,
	}
	handler := newOperationsHandler(deps)

	recorder := doJSON(t, handler, "POST", apiPrefix+"/probe", map[string]any{
		"target_node_id": "node-a",
		"rungs":          []string{"L0", "L1", "L2"},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("probe self: got %d: %s", recorder.Code, recorder.Body.String())
	}
	var result struct {
		TargetNodeID string `json:"target_node_id"`
		Results      []struct {
			Rung      string `json:"rung"`
			OK        bool   `json:"ok"`
			RTTMs     *int   `json:"rtt_ms"`
			ErrorCode string `json:"error_code"`
		} `json:"results"`
	}
	decodeInto(t, recorder, &result)
	if len(result.Results) != 3 {
		t.Fatalf("results: %+v", result)
	}
	byRung := map[string]int{}
	for i, r := range result.Results {
		byRung[r.Rung] = i
	}
	if l0 := result.Results[byRung["L0"]]; !l0.OK || l0.RTTMs == nil {
		t.Fatalf("self L0 did not measure: %+v", l0)
	}
	if l1 := result.Results[byRung["L1"]]; l1.OK || l1.ErrorCode != "PEER_INVOKE_UNAVAILABLE" {
		t.Fatalf("L1 must refuse until M2 opens the door: %+v", l1)
	}
	if l2 := result.Results[byRung["L2"]]; l2.OK || l2.ErrorCode != "RUNG_UNAVAILABLE" {
		t.Fatalf("L2: %+v", l2)
	}

	// Toward a peer, every rung refuses — including L0, which is loopback-only.
	toward := doJSON(t, handler, "POST", apiPrefix+"/probe", map[string]any{
		"target_node_id": "node-b",
		"rungs":          []string{"L0", "L1"},
	})
	decodeInto(t, toward, &result)
	for _, r := range result.Results {
		if r.OK || r.ErrorCode == "" {
			t.Fatalf("peer probe rung %s did not refuse: %+v", r.Rung, r)
		}
	}
}

// The module side of "reaches ready": boot the real SDK server on a loopback
// endpoint and drive the exact probes the host drives — handshake and
// readiness, credential-guarded — plus one operation. This is what the host's
// Activate() sees; the host side (leaf daemon, tree master) is exercised in
// the platform's own suites.
func TestServerBootsAndAnswersTheHostProbes(t *testing.T) {
	identity := modulert.WorkloadIdentity{
		ModuleID:   "io.terra.nodetalk",
		InstanceID: "instance-test",
		Epoch:      1,
		Nonce:      "nonce-test",
		Credential: "credential-test",
		Endpoint:   "127.0.0.1:0",
	}
	deps := newTestDeps(t, "node-a")
	deps.Identity = identity
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(deps),
	})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Serve(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("server did not shut down")
		}
	}()

	base := "http://" + server.Addr()
	get := func(path string, credential string) *http.Response {
		t.Helper()
		request, err := http.NewRequest("GET", base+path, nil)
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		if credential != "" {
			request.Header.Set(modulert.CredentialHeader, credential)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		return response
	}

	// Without the workload credential nothing answers — the guard covers the
	// control paths and the operations alike.
	if response := get(modulert.HandshakePath, ""); response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unguarded handshake: got %d, want 401", response.StatusCode)
	}

	response := get(modulert.HandshakePath, identity.Credential)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("handshake: got %d, want 200", response.StatusCode)
	}
	var handshake modulert.HandshakeResponse
	if err := json.NewDecoder(response.Body).Decode(&handshake); err != nil {
		t.Fatalf("decode handshake: %v", err)
	}
	if handshake.InstanceID != identity.InstanceID || handshake.Nonce != identity.Nonce {
		t.Fatalf("handshake echo mismatch: %+v", handshake)
	}

	response = get(modulert.ReadinessPath, identity.Credential)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("readiness: got %d, want 200", response.StatusCode)
	}
	var readiness modulert.ReadinessResponse
	if err := json.NewDecoder(response.Body).Decode(&readiness); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if !readiness.Ready {
		t.Fatalf("readiness: not ready: %+v", readiness)
	}

	if response := get(apiPrefix+"/status", identity.Credential); response.StatusCode != http.StatusOK {
		t.Fatalf("status over workload endpoint: got %d, want 200", response.StatusCode)
	}
}
