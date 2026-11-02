package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	agentcore "github.com/StellaxiaLab/terra-agent"
)

// The adapter against a stand-in Messages API: what it sends (the key in the
// header and nowhere else, the cached system block, the tools with closed
// schemas, adaptive thinking) and what it makes of the answer (tool_use blocks,
// the vendor message replayed whole on the next call).

type messagesStub struct {
	mu       sync.Mutex
	requests []map[string]any
	headers  []http.Header
	replies  []string
}

func (m *messagesStub) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("request is not JSON: %v", err)
		}
		m.mu.Lock()
		m.requests = append(m.requests, body)
		m.headers = append(m.headers, r.Header.Clone())
		index := len(m.requests) - 1
		m.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if index < len(m.replies) {
			_, _ = w.Write([]byte(m.replies[index]))
			return
		}
		_, _ = w.Write([]byte(`{"id":"msg_x","type":"message","role":"assistant","model":"claude-opus-5","content":[{"type":"text","text":"done"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":1}}`))
	}
}

func TestAnthropicAdapterSendsWhatTheDesignSays(t *testing.T) {
	stub := &messagesStub{replies: []string{
		`{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5",
		  "content":[{"type":"text","text":"let me look"},{"type":"tool_use","id":"toolu_1","name":"terra_search_operations","input":{"query":"status"}}],
		  "stop_reason":"tool_use","stop_sequence":null,
		  "usage":{"input_tokens":120,"output_tokens":30,"cache_read_input_tokens":100,"cache_creation_input_tokens":0}}`,
	}}
	server := httptest.NewServer(stub.handler(t))
	defer server.Close()

	provider, err := newAnthropicProvider(providerConfig{Provider: "anthropic", APIKey: testAPIKey, BaseURL: server.URL, Model: "claude-opus-5"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := Request{
		System: "stable instructions", Context: "session context", Tools: agentcore.Tools(),
		Messages: []Message{{Role: roleUser, Blocks: []Block{{Type: blockText, Text: "how is the node?"}}}},
	}
	response, err := provider.Complete(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}

	// The key travels in the header only.
	if stub.headers[0].Get("x-api-key") != testAPIKey {
		t.Fatalf("x-api-key = %q", stub.headers[0].Get("x-api-key"))
	}
	raw, _ := json.Marshal(stub.requests[0])
	if strings.Contains(string(raw), testAPIKey) {
		t.Fatal("the api key is in the request body")
	}
	sent := stub.requests[0]
	if sent["model"] != "claude-opus-5" || sent["max_tokens"] != float64(anthropicMaxTokens) {
		t.Fatalf("model/max_tokens = %v/%v", sent["model"], sent["max_tokens"])
	}
	if thinking, _ := sent["thinking"].(map[string]any); thinking["type"] != "adaptive" {
		t.Fatalf("thinking = %v", sent["thinking"])
	}
	system := sent["system"].([]any)
	first := system[0].(map[string]any)
	if first["text"] != "stable instructions" || first["cache_control"].(map[string]any)["type"] != "ephemeral" {
		t.Fatalf("system[0] = %v", first)
	}
	if second := system[1].(map[string]any); second["text"] != "session context" || second["cache_control"] != nil {
		t.Fatalf("system[1] = %v", second)
	}
	tools := sent["tools"].([]any)
	if len(tools) != len(agentcore.Tools()) {
		t.Fatalf("%d tools sent", len(tools))
	}
	for _, raw := range tools {
		tool := raw.(map[string]any)
		schema := tool["input_schema"].(map[string]any)
		if schema["additionalProperties"] != false || schema["type"] != "object" {
			t.Fatalf("tool %v schema = %v", tool["name"], schema)
		}
	}

	// The answer's blocks, usage and the vendor message for replay.
	if response.StopReason != stopToolUse || len(response.Message.Blocks) != 2 {
		t.Fatalf("response = %+v", response)
	}
	call := response.Message.Blocks[1]
	if call.Type != blockToolUse || call.ID != "toolu_1" || call.Name != "terra_search_operations" || string(call.Input) != `{"query":"status"}` {
		t.Fatalf("tool_use block = %+v", call)
	}
	if response.Usage.InputTokens != 120 || response.Usage.CacheReadTokens != 100 {
		t.Fatalf("usage = %+v", response.Usage)
	}
	if response.Message.Native == nil {
		t.Fatal("the vendor message was not kept for replay")
	}

	// Second call: the assistant turn is replayed as it came and the tool
	// result follows in one user message.
	request.Messages = append(request.Messages, response.Message, Message{Role: roleUser, Blocks: []Block{
		{Type: blockToolResult, ToolUseID: "toolu_1", Content: `{"count":0}`},
	}})
	if _, err := provider.Complete(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	messages := stub.requests[1]["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("%d messages replayed", len(messages))
	}
	assistant := messages[1].(map[string]any)
	if assistant["role"] != "assistant" || !strings.Contains(mustJSON(assistant), `"toolu_1"`) {
		t.Fatalf("assistant turn = %v", assistant)
	}
	result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if result["type"] != "tool_result" || result["tool_use_id"] != "toolu_1" {
		t.Fatalf("tool result = %v", result)
	}
}

func TestAnthropicAdapterReportsRefusalsAndFailures(t *testing.T) {
	stub := &messagesStub{replies: []string{
		`{"id":"msg_r","type":"message","role":"assistant","model":"claude-opus-5","content":[],
		  "stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber","explanation":"no"},"stop_sequence":null,
		  "usage":{"input_tokens":1,"output_tokens":0}}`,
	}}
	server := httptest.NewServer(stub.handler(t))
	defer server.Close()
	provider, err := newAnthropicProvider(providerConfig{Provider: "anthropic", APIKey: testAPIKey, BaseURL: server.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := provider.Complete(context.Background(), Request{System: "s", Messages: []Message{{Role: roleUser, Blocks: []Block{{Type: blockText, Text: "hi"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if response.StopReason != stopRefusal || !strings.Contains(response.Refusal, "cyber") {
		t.Fatalf("refusal = %+v", response)
	}

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`))
	}))
	defer failing.Close()
	provider, _ = newAnthropicProvider(providerConfig{Provider: "anthropic", APIKey: testAPIKey, BaseURL: failing.URL}, nil)
	_, err = provider.Complete(context.Background(), Request{System: "s", Messages: []Message{{Role: roleUser, Blocks: []Block{{Type: blockText, Text: "hi"}}}}})
	var failure *providerError
	if err == nil || !errorsAs(err, &failure) || failure.Status != 429 {
		t.Fatalf("err = %v", err)
	}
}

func TestAnthropicAdapterNeedsAKey(t *testing.T) {
	if _, err := newAnthropicProvider(providerConfig{Provider: "anthropic"}, nil); err == nil {
		t.Fatal("a provider without a key was built")
	}
}

func mustJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
