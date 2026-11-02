package main

// The MCP client — Terra as the caller (A8, 설계 §7.10).
//
// The CLI has the other half: an MCP server that lets an outside host drive
// Terra. This is the mirror, and the asymmetry matters. There, Terra is the
// thing being asked and the Gateway judges every request. Here, Terra is
// asking, and what comes back is text from a process this node launched on a
// person's instruction — a new trust boundary, which is why §7.10's rules were
// written before this file.
//
// What this file is responsible for is the protocol and the process: start the
// server a person registered, agree on a version, list what it offers, call one
// tool, bound the answer. What may be called, and how the answer is handled
// once it is back, is agentcore's (DecideExternal, FenceExternal) — the same
// split as everywhere else, so the rules exist once.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// The protocol revision this client speaks. It is the same constant the CLI's
// server announces; a server that wants an older one gets what it asked for,
// the way the spec's negotiation expects.
const mcpProtocolVersion = "2025-06-18"

const (
	// mcpStartTimeout bounds the handshake. A server that cannot say hello in
	// this long is one a person should hear about at registration rather than
	// mid-session.
	mcpStartTimeout = 30 * time.Second
	// mcpCallTimeout bounds one tool call.
	mcpCallTimeout = 60 * time.Second
	// mcpResultLimit is R6: an external answer is finite. Past this the content
	// is cut and the cut is reported, so a server cannot spend a session's
	// whole token budget (§12) by itself.
	mcpResultLimit = 64 << 10
	// mcpLineLimit bounds one protocol line. A server that sends more than this
	// in a single message is not answering a tool call any more.
	mcpLineLimit = 8 << 20
)

// mcpServerConfig is one registered server: what to run, and what a person
// allowed when they registered it.
type mcpServerConfig struct {
	Name string `json:"name"`
	// Command and Args are what this node launches. There is no shell: the
	// command is executed directly, so a registered server cannot smuggle
	// shell syntax past the person who registered it.
	Command string   `json:"command"`
	Args    []string `json:"args,omitempty"`
	// Env is the server's OWN secrets (an API key of its own). Terra
	// credentials are never here and never passed — R7.
	Env map[string]string `json:"env,omitempty"`
	// Tools is what the server answered at registration, so the allowlist is
	// concrete rather than "whatever it offers today".
	Tools []mcpToolRecord `json:"tools,omitempty"`
	// RegisteredMS is when a person allowed it.
	RegisteredMS int64 `json:"registered_ms"`
}

// mcpToolRecord is one tool a registered server offered, plus the one thing
// only a person may say about it.
type mcpToolRecord struct {
	Name        string          `json:"name"`
	Title       string          `json:"title,omitempty"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema,omitempty"`
	// ReadOnly is the PERSON's mark, not the server's hint (R4).
	ReadOnly bool `json:"read_only,omitempty"`
}

// mcpClient is one running server process and the lock that keeps one
// conversation on its stdio at a time.
//
// MCP over stdio is a single pair of streams. Two requests in flight would
// need id matching and a reader goroutine; serialising instead is less code
// and cannot interleave two answers, which is the failure that would be
// hardest to see.
type mcpClient struct {
	mu      sync.Mutex
	config  mcpServerConfig
	command *exec.Cmd
	stdin   io.WriteCloser
	reader  *bufio.Reader
	nextID  int
	closed  bool
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int            `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *mcpError) Error() string { return fmt.Sprintf("mcp error %d: %s", e.Code, e.Message) }

// startMCPClient launches a registered server and completes the handshake.
func startMCPClient(ctx context.Context, config mcpServerConfig) (*mcpClient, error) {
	if strings.TrimSpace(config.Command) == "" {
		return nil, errors.New("an mcp server needs a command to run")
	}
	// No shell, and no inherited environment: the server gets exactly what the
	// person registered plus what a process needs to run at all. An inherited
	// environment is how a Terra credential would reach it by accident (R7).
	command := exec.Command(config.Command, config.Args...)
	command.Env = mcpEnvironment(config.Env)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	// The server's stderr is its own; it is not protocol and not context.
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start mcp server %q: %w", config.Name, err)
	}
	client := &mcpClient{config: config, command: command, stdin: stdin, reader: bufio.NewReaderSize(stdout, 64<<10)}

	handshake, cancel := context.WithTimeout(ctx, mcpStartTimeout)
	defer cancel()
	if err := client.initialize(handshake); err != nil {
		_ = client.Close()
		return nil, err
	}
	return client, nil
}

// mcpEnvironment is what the server process runs with: nothing inherited, the
// person's own registered values, and the minimum a program needs to start.
func mcpEnvironment(registered map[string]string) []string {
	environment := make([]string, 0, len(registered)+2)
	for name, value := range registered {
		environment = append(environment, name+"="+value)
	}
	// PATH is needed to resolve interpreters the command itself uses; it is not
	// a secret and withholding it would make most servers unrunnable.
	if path := os.Getenv("PATH"); path != "" {
		environment = append(environment, "PATH="+path)
	}
	if home := os.Getenv("HOME"); home != "" {
		environment = append(environment, "HOME="+home)
	}
	return environment
}

func (c *mcpClient) initialize(ctx context.Context) error {
	params, err := json.Marshal(map[string]any{
		"protocolVersion": mcpProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "terra-agent", "version": moduleVersion},
	})
	if err != nil {
		return err
	}
	if _, err := c.request(ctx, "initialize", params); err != nil {
		return fmt.Errorf("mcp server %q did not complete the handshake: %w", c.config.Name, err)
	}
	// A notification takes no id and gets no answer.
	return c.notify("notifications/initialized")
}

// ListTools asks what the server offers.
func (c *mcpClient) ListTools(ctx context.Context) ([]mcpToolRecord, error) {
	result, err := c.request(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	var listing struct {
		Tools []struct {
			Name        string          `json:"name"`
			Title       string          `json:"title"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(result, &listing); err != nil {
		return nil, fmt.Errorf("mcp server %q answered tools/list with something else: %w", c.config.Name, err)
	}
	tools := make([]mcpToolRecord, 0, len(listing.Tools))
	for _, tool := range listing.Tools {
		tools = append(tools, mcpToolRecord{
			Name: tool.Name, Title: tool.Title, Description: tool.Description,
			InputSchema: tool.InputSchema,
			// read_only is never taken from the server. Whatever it says about
			// itself, only a person's mark sets this (R4).
		})
	}
	return tools, nil
}

// CallTool runs one tool and returns its text, bounded.
func (c *mcpClient) CallTool(ctx context.Context, tool string, arguments json.RawMessage) (string, bool, bool, error) {
	if len(strings.TrimSpace(string(arguments))) == 0 {
		arguments = json.RawMessage(`{}`)
	}
	params, err := json.Marshal(map[string]any{"name": tool, "arguments": arguments})
	if err != nil {
		return "", false, false, err
	}
	call, cancel := context.WithTimeout(ctx, mcpCallTimeout)
	defer cancel()
	result, err := c.request(call, "tools/call", params)
	if err != nil {
		return "", false, false, err
	}
	var answer struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(result, &answer); err != nil {
		return "", false, false, fmt.Errorf("mcp server %q answered tools/call with something else: %w", c.config.Name, err)
	}
	var text strings.Builder
	for _, part := range answer.Content {
		// Only text comes back into a model's context here. An image or a
		// resource reference from a third party is a thing to fetch, and
		// fetching it is a second boundary this stage does not open.
		if part.Type != "" && part.Type != "text" {
			continue
		}
		if text.Len() > 0 {
			text.WriteString("\n")
		}
		text.WriteString(part.Text)
	}
	content, truncated := boundExternalText(text.String())
	return content, truncated, answer.IsError, nil
}

// boundExternalText applies R6.
func boundExternalText(text string) (string, bool) {
	if len(text) <= mcpResultLimit {
		return text, false
	}
	// Cut on a rune boundary so the fence does not end mid-character.
	cut := mcpResultLimit
	for cut > 0 && !isUTF8Start(text[cut]) {
		cut--
	}
	return text[:cut], true
}

func isUTF8Start(b byte) bool { return b&0xC0 != 0x80 }

// request sends one call and waits for the answer with that id.
func (c *mcpClient) request(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("mcp server " + c.config.Name + " is closed")
	}
	c.nextID++
	id := c.nextID
	encoded, err := json.Marshal(mcpRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params})
	if err != nil {
		return nil, err
	}
	if _, err := c.stdin.Write(append(encoded, '\n')); err != nil {
		return nil, fmt.Errorf("write to mcp server %q: %w", c.config.Name, err)
	}

	// The read is bounded by the context through a goroutine: a server that
	// stops answering must not hold a turn for ever, and bufio has no deadline.
	type outcome struct {
		result json.RawMessage
		err    error
	}
	answered := make(chan outcome, 1)
	go func() {
		for {
			line, err := c.readLine()
			if err != nil {
				answered <- outcome{nil, err}
				return
			}
			if len(strings.TrimSpace(string(line))) == 0 {
				continue
			}
			var response mcpResponse
			if err := json.Unmarshal(line, &response); err != nil {
				answered <- outcome{nil, fmt.Errorf("mcp server %q sent something that is not JSON-RPC: %w", c.config.Name, err)}
				return
			}
			// A notification or a request FROM the server (sampling, roots) has
			// no matching id. This client advertises no capabilities, so there
			// is nothing to answer; skipping is the whole handling.
			if response.ID == nil || *response.ID != id {
				continue
			}
			if response.Error != nil {
				answered <- outcome{nil, response.Error}
				return
			}
			answered <- outcome{response.Result, nil}
			return
		}
	}()
	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("mcp server %q did not answer %s in time: %w", c.config.Name, method, ctx.Err())
	case out := <-answered:
		return out.result, out.err
	}
}

// readLine reads one newline-delimited message, bounded.
func (c *mcpClient) readLine() ([]byte, error) {
	line, err := c.reader.ReadBytes('\n')
	if len(line) > mcpLineLimit {
		return nil, errors.New("mcp server " + c.config.Name + " sent a message past the line limit")
	}
	if err != nil && len(line) == 0 {
		return nil, err
	}
	return line, nil
}

func (c *mcpClient) notify(method string) error {
	encoded, err := json.Marshal(mcpRequest{JSONRPC: "2.0", Method: method})
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.stdin.Write(append(encoded, '\n'))
	return err
}

// Close ends the conversation and the process.
func (c *mcpClient) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	_ = c.stdin.Close()
	c.mu.Unlock()
	// A server that does not exit on a closed stdin is killed: this node
	// started the process and owns ending it.
	done := make(chan error, 1)
	go func() { done <- c.command.Wait() }()
	select {
	case <-time.After(5 * time.Second):
		_ = c.command.Process.Kill()
		<-done
	case <-done:
	}
	return nil
}
