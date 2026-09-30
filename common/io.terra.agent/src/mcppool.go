package main

// The live external servers of one turn (A8, 설계 §7.10).
//
// A registration is a row in a file; this is what a turn actually talks to. The
// lifetime is deliberately the TURN, not the session and not the process: a
// turn that ends — answered, refused, cancelled, out of time — closes every
// server it started. A pool that outlived the turn would be a process this node
// keeps running for a conversation nobody is having, and the bug where it is
// still running after the session is gone is the kind that is found months
// later by somebody reading `ps`.
//
// The servers start lazily. A session may name four and use one, and the other
// three should not be running.

import (
	"context"
	"encoding/json"
	"sync"

	agentcore "github.com/terra-project/terra/products/common/packages/terra-agent-core"
)

// mcpPool is one turn's external servers, and the ExternalCaller agentcore
// reaches them through.
type mcpPool struct {
	mu      sync.Mutex
	order   []string
	configs map[string]mcpServerConfig
	clients map[string]*mcpClient
	closed  bool
}

func newMCPPool(configs []mcpServerConfig) *mcpPool {
	pool := &mcpPool{configs: map[string]mcpServerConfig{}, clients: map[string]*mcpClient{}}
	for _, config := range configs {
		if _, seen := pool.configs[config.Name]; seen {
			continue
		}
		pool.order = append(pool.order, config.Name)
		pool.configs[config.Name] = config
	}
	return pool
}

// tools is the surface these servers contribute, in registration order.
//
// It comes from the ALLOWLIST, not from a live tools/list: what the model may
// call is what a person allowed when they registered, and a server that grew a
// new tool since then has not been allowed it. Re-registering is how a person
// says yes to the new one.
func (p *mcpPool) tools() []agentcore.ExternalTool {
	p.mu.Lock()
	defer p.mu.Unlock()
	tools := make([]agentcore.ExternalTool, 0, len(p.order))
	for _, name := range p.order {
		tools = append(tools, p.configs[name].externalTools()...)
	}
	return tools
}

func (p *mcpPool) empty() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.order) == 0
}

// CallExternal runs one tool at one of this turn's servers.
//
// Whether the call MAY be made was already decided by agentcore (DecideExternal
// plus the approver). This is the transport, and it checks one thing of its
// own: that the server is one this turn was opened with. That check is not
// redundant with agentcore's — it is the difference between "the model named a
// tool nobody registered" and "something reached the transport with a server
// name the session never had", and the second one should not be possible.
func (p *mcpPool) CallExternal(ctx context.Context, server, tool string, arguments json.RawMessage) (agentcore.ExternalResult, error) {
	client, err := p.client(ctx, server)
	if err != nil {
		return agentcore.ExternalResult{}, err
	}
	content, truncated, isError, err := client.CallTool(ctx, tool, arguments)
	if err != nil {
		return agentcore.ExternalResult{}, err
	}
	return agentcore.ExternalResult{Content: content, Truncated: truncated, IsError: isError}, nil
}

// client returns the running server, starting it on first use.
func (p *mcpPool) client(ctx context.Context, server string) (*mcpClient, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errTurnOver
	}
	if existing, ok := p.clients[server]; ok {
		p.mu.Unlock()
		return existing, nil
	}
	config, ok := p.configs[server]
	if !ok {
		p.mu.Unlock()
		return nil, errMCPServerUnknown
	}
	p.mu.Unlock()

	// Started outside the lock: a server that takes its time to come up must
	// not hold every other call on this pool while it does.
	client, err := startMCPClient(ctx, config)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	// Two things can have happened while the process was starting: the turn
	// ended, or another call started the same server. In both cases this
	// process is surplus and is closed — two processes for one allowlist entry
	// would double whatever side effects that server has.
	switch existing, started := p.clients[server]; {
	case p.closed:
		p.mu.Unlock()
		_ = client.Close()
		return nil, errTurnOver
	case started:
		p.mu.Unlock()
		_ = client.Close()
		return existing, nil
	}
	p.clients[server] = client
	p.mu.Unlock()
	return client, nil
}

// Close stops every server this turn started. It is safe to call twice.
func (p *mcpPool) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	clients := make([]*mcpClient, 0, len(p.clients))
	for _, client := range p.clients {
		clients = append(clients, client)
	}
	p.clients = map[string]*mcpClient{}
	p.mu.Unlock()
	for _, client := range clients {
		_ = client.Close()
	}
}
