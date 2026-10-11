package main

// The operation surface — one route per contract binding, nothing else.
//
// The table below mirrors contracts/api/terra-api.json exactly, and
// contract_map_test.go holds the two against each other both ways. Every
// handler reads the caller's principal from the header the Gateway stamps
// (X-Terra-Principal): a session runs as its owner's registered credential,
// so who is asking decides which credential is spent, and nobody else may
// drive it.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	agentcore "github.com/StellaxiaLab/terra-agent"
)

const apiPrefix = "/api/modules/io.terra.agent/v1"

// principalHeader is the Gateway's assertion of who is calling. Inbound
// X-Terra-* headers are stripped by the Gateway pipeline, so a value here
// was set by it, not by the client.
const principalHeader = "X-Terra-Principal"

type operationRoute struct {
	OperationID string
	Method      string
	Path        string // relative to apiPrefix; mux wildcard syntax = contract syntax
	Handler     func(*apiServer, http.ResponseWriter, *http.Request)
}

var operationRoutes = []operationRoute{
	{"io.terra.agent.status.get", "GET", "/status", (*apiServer).status},
	{"io.terra.agent.credentials.put", "PUT", "/credentials", (*apiServer).credentialPut},
	{"io.terra.agent.credentials.get", "GET", "/credentials", (*apiServer).credentialGet},
	{"io.terra.agent.credentials.delete", "DELETE", "/credentials", (*apiServer).credentialDelete},
	{"io.terra.agent.models.put", "PUT", "/models/{provider}", (*apiServer).modelPut},
	{"io.terra.agent.models.list", "GET", "/models", (*apiServer).modelList},
	{"io.terra.agent.models.delete", "DELETE", "/models/{provider}", (*apiServer).modelDelete},
	{"io.terra.agent.mcp.put", "PUT", "/mcp/servers/{server}", (*apiServer).mcpPut},
	{"io.terra.agent.mcp.list", "GET", "/mcp/servers", (*apiServer).mcpList},
	{"io.terra.agent.mcp.delete", "DELETE", "/mcp/servers/{server}", (*apiServer).mcpDelete},
	{"io.terra.agent.runs.post", "POST", "/runs", (*apiServer).runPost},
	{"io.terra.agent.sessions.post", "POST", "/sessions", (*apiServer).sessionPost},
	{"io.terra.agent.sessions.list", "GET", "/sessions", (*apiServer).sessionList},
	{"io.terra.agent.sessions.get", "GET", "/sessions/{session_id}", (*apiServer).sessionGet},
	{"io.terra.agent.messages.list", "GET", "/sessions/{session_id}/messages", (*apiServer).messageList},
	{"io.terra.agent.messages.post", "POST", "/sessions/{session_id}/messages", (*apiServer).messagePost},
	{"io.terra.agent.messages.stream", "GET", "/sessions/{session_id}/stream", (*apiServer).messageStream},
	{"io.terra.agent.sessions.cancel", "POST", "/sessions/{session_id}/cancel", (*apiServer).sessionCancel},
	{"io.terra.agent.approvals.post", "POST", "/approvals/{request_id}", (*apiServer).approvalPost},
}

type apiServer struct {
	engine *engine
	now    func() time.Time
}

func newOperationsHandler(e *engine) http.Handler {
	server := &apiServer{engine: e, now: e.now}
	mux := http.NewServeMux()
	for _, route := range operationRoutes {
		handler := route.Handler
		mux.HandleFunc(route.Method+" "+apiPrefix+route.Path, func(w http.ResponseWriter, r *http.Request) {
			handler(server, w, r)
		})
	}
	return mux
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

// writeEngineError maps the engine's sentinels onto the contract's codes.
func writeEngineError(w http.ResponseWriter, err error) {
	var provider *providerError
	switch {
	case errors.Is(err, errSessionNotFound):
		writeAPIError(w, http.StatusNotFound, "SESSION_NOT_FOUND", err.Error())
	case errors.Is(err, errNotOwner):
		writeAPIError(w, http.StatusForbidden, "SESSION_NOT_OWNED", err.Error())
	case errors.Is(err, errSessionBusy):
		writeAPIError(w, http.StatusConflict, "SESSION_BUSY", err.Error())
	case errors.Is(err, errSessionFinished):
		writeAPIError(w, http.StatusConflict, "SESSION_FINISHED", err.Error())
	case errors.Is(err, errApprovalMissing):
		writeAPIError(w, http.StatusNotFound, "APPROVAL_NOT_FOUND", err.Error())
	case errors.Is(err, errCredentialMissing), strings.Contains(err.Error(), "expired at"):
		writeAPIError(w, http.StatusConflict, "CREDENTIAL_MISSING", err.Error())
	case errors.Is(err, errModelNotConfigured), strings.Contains(err.Error(), "is not registered"):
		writeAPIError(w, http.StatusConflict, "MODEL_NOT_CONFIGURED", err.Error())
	case errors.As(err, &provider):
		writeAPIError(w, http.StatusBadGateway, "MODEL_UNAVAILABLE", err.Error())
	case errors.Is(err, errMCPServerUnknown):
		writeAPIError(w, http.StatusNotFound, "MCP_SERVER_UNKNOWN", err.Error())
	case errors.Is(err, errMCPUnattended):
		writeAPIError(w, http.StatusConflict, "MCP_UNATTENDED_CONFLICT", err.Error())
	case errors.Is(err, errNoDoor):
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
	default:
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
	}
}

// decodeBody strictly decodes a JSON body: the contract's input schemas all
// declare additionalProperties:false, so an unknown field is the caller's bug
// and is answered as one instead of being silently dropped.
func decodeBody(w http.ResponseWriter, r *http.Request, value any) bool {
	if r.Body == nil || r.ContentLength == 0 {
		return true
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil && !errors.Is(err, io.EOF) {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "cannot read the body: "+err.Error())
		return false
	}
	return true
}

// principal is who the Gateway says is calling. Without it there is no one
// to bind a credential or a session to, so the request is refused.
func principal(w http.ResponseWriter, r *http.Request) (string, bool) {
	name := strings.TrimSpace(r.Header.Get(principalHeader))
	if name == "" || name == "anonymous" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "the caller's principal is missing; this surface is reached through the Gateway")
		return "", false
	}
	return name, true
}

// ownedSession resolves a session the caller owns. Another person's session
// is reported as not owned rather than not found: it exists, and hiding that
// would only make the listing and the refusal disagree.
func (s *apiServer) ownedSession(w http.ResponseWriter, r *http.Request) (*session, string, bool) {
	owner, ok := principal(w, r)
	if !ok {
		return nil, "", false
	}
	current, found := s.engine.sessions.get(r.PathValue("session_id"))
	if !found {
		writeEngineError(w, errSessionNotFound)
		return nil, "", false
	}
	if current.meta.Owner != owner {
		writeEngineError(w, errNotOwner)
		return nil, "", false
	}
	return current, owner, true
}

func (s *apiServer) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":            "ok",
		"version":           moduleVersion,
		"sessions":          s.engine.sessions.count(),
		"models_registered": s.engine.providers.count(),
		"delegate_door":     s.engine.core != nil,
	})
}

// credentialPut registers the caller's delegated credential after asking the
// Gateway, through the door, what it is. A value the Gateway rejects is never
// stored: the store holds only credentials that were live when registered.
func (s *apiServer) credentialPut(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	var input struct {
		Credential string `json:"credential"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	credential := strings.TrimSpace(input.Credential)
	if !validCredentialShape(credential) {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST",
			"credential is required and must be a delegated credential (tsa_…) issued by `terra agent grant`; a user session token is never accepted")
		return
	}
	if s.engine.core == nil {
		writeEngineError(w, errNoDoor)
		return
	}
	probe := &doorTransport{core: s.engine.core, credential: func() (string, error) { return credential, nil }}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	facts, err := agentcore.NewClient(probe).Whoami(ctx)
	if err != nil {
		var gatewayErr *agentcore.Error
		if errors.As(err, &gatewayErr) && gatewayErr.Status > 0 && gatewayErr.Status < 500 {
			writeAPIError(w, http.StatusForbidden, "CREDENTIAL_REJECTED", "the Gateway did not accept this credential: "+gatewayErr.Error())
			return
		}
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", "could not verify the credential at the Gateway: "+err.Error())
		return
	}
	if facts.Delegate == "" {
		// The Gateway answered as a person, not as a delegate — the value was
		// not a delegated credential after all. The door should have refused
		// it; refusing here too keeps the store honest either way.
		writeAPIError(w, http.StatusForbidden, "CREDENTIAL_REJECTED", "the Gateway did not treat this value as a delegated credential")
		return
	}
	record := credentialRecord{
		Principal: owner, Credential: credential, Delegate: facts.Delegate,
		Permissions: facts.Permissions, Reach: facts.Reach, ExpiresAt: facts.ExpiresAt,
		Unattended: facts.Unattended, PreApproved: facts.PreApproved,
		RegisteredMS: millis(s.now()),
	}
	if err := s.engine.credentials.put(record); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", "cannot store the credential: "+err.Error())
		return
	}
	response := record.facts(s.now())
	delete(response, "expired")
	writeJSON(w, http.StatusOK, response)
}

func (s *apiServer) credentialGet(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	record, found := s.engine.credentials.get(owner)
	if !found {
		writeJSON(w, http.StatusOK, map[string]any{"registered": false})
		return
	}
	writeJSON(w, http.StatusOK, record.facts(s.now()))
}

func (s *apiServer) credentialDelete(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	removed, err := s.engine.credentials.delete(owner)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

func (s *apiServer) modelPut(w http.ResponseWriter, r *http.Request) {
	if _, ok := principal(w, r); !ok {
		return
	}
	name := strings.TrimSpace(r.PathValue("provider"))
	var input struct {
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
		Model    string `json:"model"`
		BaseURL  string `json:"base_url"`
		Default  bool   `json:"default"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if !knownProvider(name) {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "unknown model provider "+strconv.Quote(name)+"; this build knows: anthropic")
		return
	}
	if len(strings.TrimSpace(input.APIKey)) < 8 {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "api_key is required; give it on standard input (--api-key-stdin), never as an argument")
		return
	}
	config := providerConfig{Provider: name, APIKey: strings.TrimSpace(input.APIKey), Model: strings.TrimSpace(input.Model), BaseURL: strings.TrimSpace(input.BaseURL)}
	isDefault, err := s.engine.providers.put(config, input.Default)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", "cannot store the provider: "+err.Error())
		return
	}
	stored, _ := s.engine.providers.resolve(name)
	writeJSON(w, http.StatusOK, stored.facts(isDefault))
}

func (s *apiServer) modelList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.engine.providers.list())
}

func (s *apiServer) modelDelete(w http.ResponseWriter, r *http.Request) {
	if _, ok := principal(w, r); !ok {
		return
	}
	name := strings.TrimSpace(r.PathValue("provider"))
	removed, err := s.engine.providers.delete(name)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider": name, "removed": removed})
}

// mcpPut registers an external MCP server — R1's one door.
//
// It does the registration for real: the command runs, the handshake completes
// and the server says what it offers, all before anything is stored. The cost
// is that this operation is slow and can fail for reasons outside Terra; the
// benefit is that a registration which succeeded is one a session can use, and
// a typo answers the person who made it.
func (s *apiServer) mcpPut(w http.ResponseWriter, r *http.Request) {
	if _, ok := principal(w, r); !ok {
		return
	}
	name := strings.TrimSpace(r.PathValue("server"))
	var input struct {
		Server   string            `json:"server"`
		Command  string            `json:"command"`
		Args     []string          `json:"args"`
		Env      map[string]string `json:"env"`
		ReadOnly []string          `json:"read_only"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	// The name must be one the surface can carry. agentcore drops an
	// unprojectable name at projection time, which is correct and silent —
	// refusing it here is what makes it visible (R3).
	if !agentcore.ValidExternalName(name) {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST",
			"server name "+strconv.Quote(name)+": letters, digits, '.', '_' and '-' only, at most 64 — it becomes part of the tool name the model sees")
		return
	}
	if strings.TrimSpace(input.Command) == "" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "command is required: registration runs it to find out what the server offers")
		return
	}
	config := mcpServerConfig{
		Name: name, Command: strings.TrimSpace(input.Command), Args: input.Args,
		Env: input.Env, RegisteredMS: millis(s.now()),
	}

	offered, err := probeMCPServer(r.Context(), config)
	if err != nil {
		// The failure is the external server's, not the request's. Saying so
		// with its own code keeps "your command is wrong" apart from "Terra is
		// unwell", which are different things for the person reading it.
		writeAPIError(w, http.StatusBadGateway, "MCP_SERVER_FAILED", err.Error())
		return
	}
	kept, dropped := projectableTools(offered)
	marked, err := markReadOnly(kept, input.ReadOnly)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	config.Tools = marked
	if err := s.engine.mcp.put(config); err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", "cannot store the registration: "+err.Error())
		return
	}
	facts := config.facts()
	if len(dropped) > 0 {
		facts["dropped"] = dropped
	}
	writeJSON(w, http.StatusOK, facts)
}

func (s *apiServer) mcpList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"servers": s.engine.mcp.list()})
}

func (s *apiServer) mcpDelete(w http.ResponseWriter, r *http.Request) {
	if _, ok := principal(w, r); !ok {
		return
	}
	name := strings.TrimSpace(r.PathValue("server"))
	removed, err := s.engine.mcp.delete(name)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "removed": removed})
}

// sessionInput is what runs.post and sessions.post share.
type sessionInput struct {
	SessionID   string   `json:"session_id"`
	Prompt      string   `json:"prompt"`
	Autonomy    string   `json:"autonomy"`
	Simulate    bool     `json:"simulate"`
	MaxSteps    int      `json:"max_steps"`
	MaxSeconds  int      `json:"max_seconds"`
	TokenBudget int64    `json:"token_budget"`
	Provider    string   `json:"provider"`
	Topic       string   `json:"topic"`
	MCPServers  []string `json:"mcp_servers"`
}

func (in sessionInput) options(provider Provider) (sessionOptions, error) {
	autonomy := strings.TrimSpace(in.Autonomy)
	if autonomy == "" {
		autonomy = string(agentcore.AutonomyPlan)
	}
	if !agentcore.KnownAutonomy(autonomy) {
		return sessionOptions{}, fmt.Errorf("unknown autonomy %q; expected plan, ask, auto or unattended", in.Autonomy)
	}
	if in.MaxSteps < 0 || in.MaxSteps > maxMaxSteps {
		return sessionOptions{}, fmt.Errorf("max_steps must be between 1 and %d", maxMaxSteps)
	}
	if in.MaxSeconds < 0 || in.MaxSeconds > maxMaxSeconds {
		return sessionOptions{}, fmt.Errorf("max_seconds must be between 1 and %d", maxMaxSeconds)
	}
	if in.TokenBudget < 0 {
		return sessionOptions{}, fmt.Errorf("token_budget cannot be negative")
	}
	return sessionOptions{
		ID: in.SessionID, Autonomy: autonomy, Simulate: in.Simulate,
		MaxSteps: in.MaxSteps, MaxSeconds: in.MaxSeconds, TokenBudget: in.TokenBudget,
		Provider: provider.Name(), Model: provider.Model(), Topic: strings.TrimSpace(in.Topic),
		MCPServers: trimmed(in.MCPServers),
	}, nil
}

func (s *apiServer) runPost(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	var input sessionInput
	if !decodeBody(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Prompt) == "" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "prompt is required")
		return
	}
	provider, err := s.engine.prepare(owner, input.Provider)
	if err != nil {
		writeEngineError(w, err)
		return
	}
	options, err := input.options(provider)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := s.engine.allowsUnattended(owner, options.Autonomy); err != nil {
		writeAPIError(w, http.StatusForbidden, "CREDENTIAL_NOT_UNATTENDED", err.Error())
		return
	}
	if err := s.engine.allowsExternal(options); err != nil {
		writeEngineError(w, err)
		return
	}
	options.ID = randomID("run-", 4)
	current, _, err := s.engine.sessions.open(options, owner)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", err.Error())
		return
	}
	s.engine.run(r.Context(), current, input.Prompt, provider)
	view := current.snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": current.meta.ID, "state": view["state"], "answer": view["answer"], "steps": view["steps"],
		"entries": current.entriesAfter(0, 0), "usage": view["usage"], "last_error": view["last_error"],
	})
}

func (s *apiServer) sessionPost(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	var input sessionInput
	if !decodeBody(w, r, &input) {
		return
	}
	if existing, found := s.engine.sessions.get(strings.TrimSpace(input.SessionID)); found {
		if existing.meta.Owner != owner {
			writeEngineError(w, errNotOwner)
			return
		}
		writeJSON(w, http.StatusOK, sessionOpened(existing, owner, false))
		return
	}
	provider, err := s.engine.prepare(owner, input.Provider)
	if err != nil {
		writeEngineError(w, err)
		return
	}
	options, err := input.options(provider)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := s.engine.allowsUnattended(owner, options.Autonomy); err != nil {
		writeAPIError(w, http.StatusForbidden, "CREDENTIAL_NOT_UNATTENDED", err.Error())
		return
	}
	if err := s.engine.allowsExternal(options); err != nil {
		writeEngineError(w, err)
		return
	}
	current, created, err := s.engine.sessions.open(options, owner)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessionOpened(current, owner, created))
}

func sessionOpened(current *session, viewer string, created bool) map[string]any {
	current.mu.Lock()
	defer current.mu.Unlock()
	return map[string]any{
		"session_id": current.meta.ID, "viewer": viewer, "state": current.meta.State,
		"autonomy": current.meta.Autonomy, "simulate": current.meta.Simulate,
		"provider": current.meta.Provider, "model": current.meta.Model, "created": created,
	}
}

func (s *apiServer) sessionList(w http.ResponseWriter, r *http.Request) {
	// A list is not addressed by an id, so ownership cannot refuse it the way
	// it refuses a read of one session: it filters. A session of someone else
	// is absent here, along with its topic, answer and pending approvals.
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.engine.sessions.list(owner)})
}

func (s *apiServer) sessionGet(w http.ResponseWriter, r *http.Request) {
	current, _, ok := s.ownedSession(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, current.snapshot())
}

func (s *apiServer) messageList(w http.ResponseWriter, r *http.Request) {
	current, _, ok := s.ownedSession(w, r)
	if !ok {
		return
	}
	afterSeq, err := queryInt(r, "after_seq", 0)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	limit, err := queryInt(r, "limit", 500)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session_id": current.meta.ID, "entries": current.entriesAfter(afterSeq, limit)})
}

func queryInt(r *http.Request, name string, fallback int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return value, nil
}

// messagePost takes a person's line. A typed "approve"/"deny" answers the
// waiting question; anything else starts the model's next turn.
func (s *apiServer) messagePost(w http.ResponseWriter, r *http.Request) {
	current, owner, ok := s.ownedSession(w, r)
	if !ok {
		return
	}
	var input struct {
		SessionID string `json:"session_id"`
		Text      string `json:"text"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	text := strings.TrimSpace(input.Text)
	if text == "" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "text is required")
		return
	}
	if id, approved, isAnswer := answerText(text); isAnswer && current.pendingCount() > 0 {
		line := current.append(entry{Kind: kindUser, Author: owner, Text: text})
		if _, answered := current.answerApproval(id, approved); !answered {
			writeEngineError(w, errApprovalMissing)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entry": line})
		return
	}
	provider, err := s.engine.prepare(owner, current.meta.Provider)
	if err != nil {
		writeEngineError(w, err)
		return
	}
	line, err := s.engine.submit(current, text, owner, provider)
	if err != nil {
		writeEngineError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"entry": line})
}

// messageStream is the local SSE push the room follows. The Gateway relays it
// live when the caller accepts text/event-stream.
func (s *apiServer) messageStream(w http.ResponseWriter, r *http.Request) {
	current, _, ok := s.ownedSession(w, r)
	if !ok {
		return
	}
	flusher, canFlush := w.(http.Flusher)
	if !canFlush {
		writeAPIError(w, http.StatusServiceUnavailable, "AGENT_UNAVAILABLE", "streaming unsupported")
		return
	}
	events, cancel := current.subscribe()
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case line, open := <-events:
			if !open {
				return
			}
			payload, err := json.Marshal(map[string]any{"event": "entry", "entry": line})
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "event: entry\ndata: %s\n\n", payload)
			flusher.Flush()
		case <-keepalive.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (s *apiServer) sessionCancel(w http.ResponseWriter, r *http.Request) {
	current, _, ok := s.ownedSession(w, r)
	if !ok {
		return
	}
	s.engine.cancel(current)
	writeJSON(w, http.StatusOK, map[string]any{"session_id": current.meta.ID, "state": current.snapshot()["state"]})
}

func (s *apiServer) approvalPost(w http.ResponseWriter, r *http.Request) {
	owner, ok := principal(w, r)
	if !ok {
		return
	}
	var input struct {
		RequestID string `json:"request_id"`
		Deny      bool   `json:"deny"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	requestID := strings.TrimSpace(r.PathValue("request_id"))
	current, found := s.engine.sessions.findApproval(requestID)
	if !found {
		writeEngineError(w, errApprovalMissing)
		return
	}
	if current.meta.Owner != owner {
		writeEngineError(w, errNotOwner)
		return
	}
	request, answered := current.answerApproval(requestID, !input.Deny)
	if !answered {
		writeEngineError(w, errApprovalMissing)
		return
	}
	decision := "approved"
	if input.Deny {
		decision = "denied"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"request_id": requestID, "session_id": current.meta.ID, "operation_id": request.OperationID, "decision": decision,
	})
}
