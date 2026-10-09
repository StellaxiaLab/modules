package main

// The allowlist of external MCP servers — what a person wrote down, nothing else.
//
// R1 is the whole point of this file: Terra does not discover MCP servers. A
// person registers one, by name, with the command to run, and an unregistered
// server does not exist. Registration is itself an act — it tells this node to
// execute a command — which is why it needs `agent.external` rather than the
// `agent.use` every session already has.
//
// Registration is not a note in a file. It STARTS the server, completes the
// handshake and asks what it offers, and stores that answer. A typo'd command
// or a server that cannot speak the protocol therefore fails in front of the
// person who registered it, not in the middle of a session three days later;
// and the allowlist is concrete — these tools, as offered then — rather than
// "whatever that command serves today".

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	agentcore "github.com/StellaxiaLab/terra-agent"
)

const mcpServersFileName = "mcp-servers.json"

// errMCPServerUnknown is answered when a session names a server nobody
// registered. It is the same answer for "never registered" and "removed": an
// agent learning which names once existed is not something this surface owes it.
var errMCPServerUnknown = errors.New("no such external MCP server is registered on this node; register it with `terra agent mcp add <name> -- <command>`")

// facts is the registration as a caller may see it. The env VALUES are not in
// it — they are the server's own secrets and live where the model API key lives
// (R7) — but the names are, because a person needs to see what they set.
func (c mcpServerConfig) facts() map[string]any {
	tools := make([]map[string]any, 0, len(c.Tools))
	for _, tool := range c.Tools {
		tools = append(tools, map[string]any{
			"name": tool.Name, "title": tool.Title, "description": tool.Description, "read_only": tool.ReadOnly,
		})
	}
	names := make([]string, 0, len(c.Env))
	for name := range c.Env {
		names = append(names, name)
	}
	sort.Strings(names)
	return map[string]any{
		"name":          c.Name,
		"command":       c.Command,
		"args":          append([]string{}, c.Args...),
		"env":           names,
		"tools":         tools,
		"registered_ms": c.RegisteredMS,
	}
}

// externalTools is this registration in the vocabulary agentcore projects from.
func (c mcpServerConfig) externalTools() []agentcore.ExternalTool {
	tools := make([]agentcore.ExternalTool, 0, len(c.Tools))
	for _, tool := range c.Tools {
		tools = append(tools, agentcore.ExternalTool{
			Server: c.Name, Name: tool.Name, Title: tool.Title,
			Description: tool.Description, InputSchema: tool.InputSchema, ReadOnly: tool.ReadOnly,
		})
	}
	return tools
}

type mcpServersFile struct {
	Servers map[string]mcpServerConfig `json:"servers"`
}

// mcpRegistry keeps the allowlist, in memory and on disk.
type mcpRegistry struct {
	mu      sync.Mutex
	path    string
	servers map[string]mcpServerConfig
}

func newMCPRegistry(root string) (*mcpRegistry, error) {
	registry := &mcpRegistry{path: filepath.Join(root, mcpServersFileName), servers: map[string]mcpServerConfig{}}
	raw, err := os.ReadFile(registry.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return registry, nil
	case err != nil:
		return nil, fmt.Errorf("read %s: %w", registry.path, err)
	}
	var file mcpServersFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, fmt.Errorf("decode %s: %w", registry.path, err)
	}
	if file.Servers != nil {
		registry.servers = file.Servers
	}
	return registry, nil
}

func (r *mcpRegistry) get(name string) (mcpServerConfig, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	config, ok := r.servers[name]
	return config, ok
}

func (r *mcpRegistry) put(config mcpServerConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.servers[config.Name] = config
	return r.saveLocked()
}

func (r *mcpRegistry) delete(name string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.servers[name]; !ok {
		return false, nil
	}
	delete(r.servers, name)
	return true, r.saveLocked()
}

func (r *mcpRegistry) names() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sortedNamesLocked()
}

func (r *mcpRegistry) list() []map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	rows := make([]map[string]any, 0, len(r.servers))
	for _, name := range r.sortedNamesLocked() {
		rows = append(rows, r.servers[name].facts())
	}
	return rows
}

func (r *mcpRegistry) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.servers)
}

// resolve answers the registrations a session asked for, refusing the first
// name nobody registered. A session that names four servers and gets three is
// a session whose surface silently differs from what was asked for.
func (r *mcpRegistry) resolve(names []string) ([]mcpServerConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	configs := make([]mcpServerConfig, 0, len(names))
	for _, name := range names {
		config, ok := r.servers[strings.TrimSpace(name)]
		if !ok {
			return nil, fmt.Errorf("%w: %s", errMCPServerUnknown, strings.TrimSpace(name))
		}
		configs = append(configs, config)
	}
	return configs, nil
}

func (r *mcpRegistry) sortedNamesLocked() []string {
	names := make([]string, 0, len(r.servers))
	for name := range r.servers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (r *mcpRegistry) saveLocked() error {
	// The env values make this file a secret file, so it is written the same
	// way the credential and provider files are (0600, atomically).
	return writeSecretFile(r.path, mcpServersFile{Servers: r.servers})
}

// probeMCPServer is registration's real work: run the command, shake hands, ask
// what it offers, stop it again. What comes back is what the allowlist records.
func probeMCPServer(ctx context.Context, config mcpServerConfig) ([]mcpToolRecord, error) {
	client, err := startMCPClient(ctx, config)
	if err != nil {
		return nil, err
	}
	defer func() { _ = client.Close() }()
	tools, err := client.ListTools(ctx)
	if err != nil {
		return nil, fmt.Errorf("mcp server %q did not answer tools/list: %w", config.Name, err)
	}
	return tools, nil
}

// markReadOnly applies the one thing only a person may say about an external
// tool (R4), and refuses a name the server does not offer.
//
// A misspelled --read-only that quietly did nothing would be the worst kind of
// failure here: the person would believe they had consented to a tool that
// still stops the session to ask, or — worse, were the defaults ever to
// invert — the reverse.
func markReadOnly(tools []mcpToolRecord, readOnly []string) ([]mcpToolRecord, error) {
	wanted := map[string]bool{}
	for _, name := range readOnly {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		wanted[name] = true
	}
	marked := make([]mcpToolRecord, 0, len(tools))
	for _, tool := range tools {
		if wanted[tool.Name] {
			tool.ReadOnly = true
			delete(wanted, tool.Name)
		}
		marked = append(marked, tool)
	}
	if len(wanted) > 0 {
		missing := make([]string, 0, len(wanted))
		for name := range wanted {
			missing = append(missing, name)
		}
		sort.Strings(missing)
		return nil, fmt.Errorf("this server offers no tool named %s; read_only must name tools it actually offers", strings.Join(missing, ", "))
	}
	return marked, nil
}

// projectableTools drops what could never appear in a surface and says which.
// Registering a server whose tools are all unnameable should answer at
// registration, not leave a person with an allowlist that projects nothing.
func projectableTools(tools []mcpToolRecord) ([]mcpToolRecord, []string) {
	kept := make([]mcpToolRecord, 0, len(tools))
	dropped := make([]string, 0)
	for _, tool := range tools {
		if !agentcore.ValidExternalName(tool.Name) {
			dropped = append(dropped, tool.Name)
			continue
		}
		kept = append(kept, tool)
	}
	return kept, dropped
}
