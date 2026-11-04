package main

// The provider-neutral model surface.
//
// The planning loop speaks only these types. A provider adapter turns them
// into one vendor's request and back, and knows nothing about Terra — not the
// credential, not the permissions, not the approval table (설계 §4: "model
// provider 어댑터 — 프롬프트·도구 호출 형식 변환. Terra 권한을 알지 않는다").
// That is what keeps a second provider a new file rather than a fork of the
// loop.

import (
	"context"
	"encoding/json"

	agentcore "github.com/StellaxiaLab/terra-agent"
)

// Block kinds a Message may carry.
const (
	blockText       = "text"
	blockToolUse    = "tool_use"
	blockToolResult = "tool_result"
)

// Message roles.
const (
	roleUser      = "user"
	roleAssistant = "assistant"
)

// Stop reasons the loop distinguishes. Anything else ends the turn.
const (
	stopToolUse   = "tool_use"
	stopEndTurn   = "end_turn"
	stopMaxTokens = "max_tokens"
	stopRefusal   = "refusal"
)

// Block is one piece of a message.
type Block struct {
	Type string
	// Text carries blockText.
	Text string
	// ID, Name and Input carry blockToolUse: the model's call.
	ID    string
	Name  string
	Input json.RawMessage
	// ToolUseID, Content and IsError carry blockToolResult: the answer.
	ToolUseID string
	Content   string
	IsError   bool
}

// Message is one turn of the conversation.
type Message struct {
	Role   string
	Blocks []Block
	// Native is the provider's own form of an assistant message, kept so the
	// same provider can replay it verbatim on the next call — some carry
	// reasoning state that survives only whole. Another provider ignores it
	// and rebuilds from Blocks. The loop never reads it.
	Native any
}

// Request is one model call.
type Request struct {
	// System is the stable instruction text. Adapters may cache it; it must not
	// change between calls of one session.
	System string
	// Context is the per-session text (mode, limits) appended after System.
	Context   string
	Tools     []agentcore.Tool
	Messages  []Message
	MaxTokens int
}

// Usage is what one call cost.
type Usage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
}

func (u *Usage) add(other Usage) {
	u.InputTokens += other.InputTokens
	u.OutputTokens += other.OutputTokens
	u.CacheReadTokens += other.CacheReadTokens
	u.CacheWriteTokens += other.CacheWriteTokens
}

// Response is the model's answer to one Request.
type Response struct {
	Message    Message
	StopReason string
	// Refusal explains a stopRefusal, when the provider says.
	Refusal string
	Usage   Usage
}

// Provider is one model vendor.
type Provider interface {
	Name() string
	Model() string
	Complete(ctx context.Context, request Request) (Response, error)
}

// providerError is a provider failure the loop reports as MODEL_UNAVAILABLE.
// Status is the vendor's HTTP status when there was one.
type providerError struct {
	Status  int
	Message string
}

func (e *providerError) Error() string { return e.Message }
