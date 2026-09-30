package main

// The Anthropic adapter — one vendor's shape of Request and Response.
//
// Everything Terra-specific stops at the package boundary above this file:
// the adapter sees a system text, a tool list and a conversation, and hands
// back blocks. It does not know what a credential is. What it does know is
// this SDK's request surface (설계 §4.3): adaptive thinking, the stable
// system text under a cache breakpoint, the tools rendered first, and the
// vendor's own assistant messages replayed whole so reasoning state survives
// between calls.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	agentcore "github.com/terra-project/terra/products/common/packages/terra-agent-core"
)

// anthropicMaxTokens is the default answer ceiling. Non-streaming calls keep
// it under the SDK's request timeout; a planning turn rarely needs more.
const anthropicMaxTokens = 16000

type anthropicProvider struct {
	client anthropic.Client
	model  string
}

func newAnthropicProvider(config providerConfig, httpClient *http.Client) (Provider, error) {
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("anthropic: an api key is required")
	}
	options := []option.RequestOption{option.WithAPIKey(config.APIKey), option.WithMaxRetries(2)}
	if base := strings.TrimSpace(config.BaseURL); base != "" {
		options = append(options, option.WithBaseURL(base))
	}
	if httpClient != nil {
		options = append(options, option.WithHTTPClient(httpClient))
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		model = defaultModels["anthropic"]
	}
	return &anthropicProvider{client: anthropic.NewClient(options...), model: model}, nil
}

func (p *anthropicProvider) Name() string  { return "anthropic" }
func (p *anthropicProvider) Model() string { return p.model }

func (p *anthropicProvider) Complete(ctx context.Context, request Request) (Response, error) {
	tools, err := anthropicTools(request.Tools)
	if err != nil {
		return Response{}, err
	}
	messages, err := anthropicMessages(request.Messages)
	if err != nil {
		return Response{}, err
	}
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = anthropicMaxTokens
	}
	// The stable text sits under the cache breakpoint; the per-session text
	// comes after it, so a mode change does not throw the whole prefix away.
	system := []anthropic.TextBlockParam{{Text: request.System, CacheControl: anthropic.NewCacheControlEphemeralParam()}}
	if context := strings.TrimSpace(request.Context); context != "" {
		system = append(system, anthropic.TextBlockParam{Text: context})
	}
	message, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: int64(maxTokens),
		System:    system,
		Tools:     tools,
		Messages:  messages,
		Thinking:  anthropic.ThinkingConfigParamUnion{OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{}},
	})
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			return Response{}, &providerError{Status: apiErr.StatusCode, Message: "anthropic: " + apiErr.Error()}
		}
		return Response{}, &providerError{Message: "anthropic: " + err.Error()}
	}

	response := Response{
		StopReason: string(message.StopReason),
		Usage: Usage{
			InputTokens:      message.Usage.InputTokens,
			OutputTokens:     message.Usage.OutputTokens,
			CacheReadTokens:  message.Usage.CacheReadInputTokens,
			CacheWriteTokens: message.Usage.CacheCreationInputTokens,
		},
		Message: Message{Role: roleAssistant, Native: message.ToParam()},
	}
	for _, block := range message.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			response.Message.Blocks = append(response.Message.Blocks, Block{Type: blockText, Text: variant.Text})
		case anthropic.ToolUseBlock:
			response.Message.Blocks = append(response.Message.Blocks, Block{
				Type: blockToolUse, ID: variant.ID, Name: variant.Name,
				Input: json.RawMessage(variant.JSON.Input.Raw()),
			})
		}
	}
	if message.StopReason == anthropic.StopReasonRefusal {
		response.Refusal = strings.TrimSpace(string(message.StopDetails.Category) + ": " + message.StopDetails.Explanation)
	}
	return response, nil
}

// anthropicTools renders the meta-tools. additionalProperties:false travels in
// ExtraFields because the SDK's schema param has no field for it, and without
// it the model may invent arguments the tool will then refuse.
func anthropicTools(tools []agentcore.Tool) ([]anthropic.ToolUnionParam, error) {
	rendered := make([]anthropic.ToolUnionParam, 0, len(tools))
	for _, tool := range tools {
		var schema struct {
			Properties map[string]any `json:"properties"`
			Required   []string       `json:"required"`
		}
		if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			return nil, fmt.Errorf("tool %s: input schema: %w", tool.Name, err)
		}
		if schema.Properties == nil {
			schema.Properties = map[string]any{}
		}
		param := anthropic.ToolParam{
			Name:        tool.Name,
			Description: anthropic.String(tool.Description),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties:  schema.Properties,
				Required:    schema.Required,
				ExtraFields: map[string]any{"additionalProperties": false},
			},
		}
		rendered = append(rendered, anthropic.ToolUnionParam{OfTool: &param})
	}
	return rendered, nil
}

// anthropicMessages renders the conversation. An assistant message this
// adapter produced is replayed as it came (Native); anything else is rebuilt
// from its blocks.
func anthropicMessages(messages []Message) ([]anthropic.MessageParam, error) {
	rendered := make([]anthropic.MessageParam, 0, len(messages))
	for index, message := range messages {
		if native, ok := message.Native.(anthropic.MessageParam); ok {
			rendered = append(rendered, native)
			continue
		}
		blocks := make([]anthropic.ContentBlockParamUnion, 0, len(message.Blocks))
		for _, block := range message.Blocks {
			switch block.Type {
			case blockText:
				// The API refuses an empty text block; there is nothing to say
				// with one anyway.
				if strings.TrimSpace(block.Text) == "" {
					continue
				}
				blocks = append(blocks, anthropic.NewTextBlock(block.Text))
			case blockToolUse:
				var input any
				if len(block.Input) > 0 {
					if err := json.Unmarshal(block.Input, &input); err != nil {
						return nil, fmt.Errorf("message %d: tool_use input: %w", index, err)
					}
				}
				if input == nil {
					input = map[string]any{}
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(block.ID, input, block.Name))
			case blockToolResult:
				blocks = append(blocks, anthropic.NewToolResultBlock(block.ToolUseID, block.Content, block.IsError))
			default:
				return nil, fmt.Errorf("message %d: unknown block type %q", index, block.Type)
			}
		}
		if len(blocks) == 0 {
			return nil, fmt.Errorf("message %d has no content", index)
		}
		if message.Role == roleAssistant {
			rendered = append(rendered, anthropic.NewAssistantMessage(blocks...))
		} else {
			rendered = append(rendered, anthropic.NewUserMessage(blocks...))
		}
	}
	return rendered, nil
}
