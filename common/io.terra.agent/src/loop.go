package main

// The planning loop — mode A's half of the agent (설계 §4.2).
//
// One turn: the model is asked, it answers with text and tool calls, each call
// goes through the SHARED gate (agentcore.Agent — the same code the MCP
// surface runs) and its result goes back, until the model stops calling or
// the step cap is hit. The loop owns the pacing and the record; it does not
// own any judgement about what may run. Where a judgement needs a person,
// the gate asks through the Approver below, which is the session's screen.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	agentcore "github.com/StellaxiaLab/terra-agent"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

// approvalTimeout is how long a turn waits for a person before giving up on
// one question. Long, because the person may be in another terminal; finite,
// because a turn that waits for ever holds the session for ever.
const approvalTimeout = 30 * time.Minute

type engine struct {
	sessions    *sessionStore
	credentials *credentialStore
	providers   *providerStore
	// mcp is the allowlist of external MCP servers a person registered (A8).
	// It is empty on most nodes and that is the intended state: R1 means a
	// server exists only because somebody wrote it down.
	mcp        *mcpRegistry
	core       *modulesdk.CoreClient
	httpClient *http.Client
	now        func() time.Time
	// openProvider builds the model client for a session. It is a field so a
	// test can put a scripted provider behind the loop.
	openProvider func(name string) (Provider, error)
	// transport builds the Gateway transport for an owner. A field for the
	// same reason.
	transport func(owner string) agentcore.Transport
	// approvalWait bounds one question; tests shorten it.
	approvalWait time.Duration
}

func newEngine(sessions *sessionStore, credentials *credentialStore, providers *providerStore, mcp *mcpRegistry, core *modulesdk.CoreClient, now func() time.Time) *engine {
	e := &engine{
		sessions: sessions, credentials: credentials, providers: providers, mcp: mcp, core: core, now: now,
		approvalWait: approvalTimeout,
	}
	e.openProvider = func(name string) (Provider, error) { return providers.open(name, e.httpClient) }
	e.transport = func(owner string) agentcore.Transport {
		return &doorTransport{core: core, credential: credentials.source(owner, now)}
	}
	return e
}

// prepare checks what a session needs before it exists: a registered, unexpired
// credential for the owner and a usable model provider. Failing here, before
// the session is created, is what keeps a half-made session out of the list.
func (e *engine) prepare(owner, providerName string) (Provider, error) {
	if _, err := e.credentials.source(owner, e.now)(); err != nil {
		return nil, err
	}
	provider, err := e.openProvider(providerName)
	if err != nil {
		return nil, err
	}
	return provider, nil
}

// allowsUnattended refuses an unattended session whose credential was not
// issued for one (A7).
//
// It would be safe to allow: an ordinary credential carries no pre-approval
// list, so every write would be refused anyway. But it would be safe and
// useless — a session that opens, plans, and then refuses everything it
// planned. Saying it at the door names the thing to fix (`terra agent grant
// --unattended --pre-approve …`) instead of leaving a run that looks broken.
func (e *engine) allowsUnattended(owner, autonomy string) error {
	if agentcore.Autonomy(autonomy) != agentcore.AutonomyUnattended {
		return nil
	}
	record, ok := e.credentials.get(owner)
	if !ok {
		return errCredentialMissing
	}
	if !record.Unattended {
		return errors.New("this credential was not issued to run unattended; a session with nobody to ask " +
			"needs one from `terra agent grant --unattended --pre-approve <operation-id>`")
	}
	if len(record.PreApproved) == 0 {
		return errors.New("this unattended credential pre-approves nothing, so the session could only read; " +
			"reissue it with --pre-approve <operation-id> for each operation that may run")
	}
	return nil
}

// errMCPUnattended is R5: the two do not combine. It is a sentinel so the
// surface can answer it with its own code — a person who asked for both should
// be told which of the two to drop, not given a generic 400.
var errMCPUnattended = errors.New("an unattended session does not use external MCP servers: nobody is present, " +
	"third-party text enters the context, and write consent was given in advance — open it with a different " +
	"autonomy, or without mcp_servers (설계 §7.10 R5)")

// errTurnOver is answered when a turn's external servers have already been shut
// down. It is not a failure a model can act on; it means the turn is over.
var errTurnOver = errors.New("this turn has ended and its external servers are closed")

// trimmed drops blanks and trims the rest. Names reach here from a JSON array a
// person typed.
func trimmed(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			kept = append(kept, value)
		}
	}
	if len(kept) == 0 {
		return nil
	}
	return kept
}

// allowsExternal decides, at the door, whether a session may name external MCP
// servers — and refuses before the session exists if it may not (A8).
//
// Two refusals, and the order matters. R5 first: an unattended session does not
// use external servers at all, and saying so before looking names anything says
// the rule rather than the symptom. Then the allowlist: a name nobody
// registered is refused here, not at the first call three model turns in, so a
// session whose surface silently lacks a server it asked for cannot exist.
func (e *engine) allowsExternal(options sessionOptions) error {
	if len(options.MCPServers) == 0 {
		return nil
	}
	if agentcore.Autonomy(options.Autonomy) == agentcore.AutonomyUnattended {
		return errMCPUnattended
	}
	if e.mcp == nil {
		return errMCPServerUnknown
	}
	_, err := e.mcp.resolve(options.MCPServers)
	return err
}

// externalPool builds this turn's external servers, or nothing at all.
//
// Resolving again here rather than trusting what the session was opened with is
// deliberate: a person can remove a registration while a session is idle, and a
// turn that kept calling a server nobody has registered any more would be the
// allowlist quietly not applying.
func (e *engine) externalPool(meta sessionMeta) (*mcpPool, error) {
	if len(meta.MCPServers) == 0 {
		return nil, nil
	}
	if e.mcp == nil {
		return nil, errMCPServerUnknown
	}
	configs, err := e.mcp.resolve(meta.MCPServers)
	if err != nil {
		return nil, err
	}
	return newMCPPool(configs), nil
}

// submit records a person's line and starts the model's turn in the
// background. It refuses while a turn is in progress (SESSION_BUSY) and on a
// session that is over.
func (e *engine) submit(s *session, text, authorLabel string, provider Provider) (entry, error) {
	s.mu.Lock()
	switch s.meta.State {
	case stateDone, stateCancelled, stateFailed, stateArchived:
		s.mu.Unlock()
		return entry{}, errSessionFinished
	}
	if s.busy {
		s.mu.Unlock()
		return entry{}, errSessionBusy
	}
	s.busy = true
	line := s.appendLocked(entry{Kind: kindUser, Author: s.meta.Owner, AuthorLabel: authorLabel, Text: text})
	s.history = append(s.history, Message{Role: roleUser, Blocks: []Block{{Type: blockText, Text: text}}})
	if strings.TrimSpace(s.meta.Topic) == "" {
		s.meta.Topic = topicFrom(text)
	}
	s.mu.Unlock()
	go e.turn(context.Background(), s, provider, false)
	return line, nil
}

// run is the synchronous shape: one request, the whole turn, then the session
// is done. The Gateway's request context bounds it.
func (e *engine) run(ctx context.Context, s *session, text string, provider Provider) {
	s.mu.Lock()
	s.busy = true
	s.appendLocked(entry{Kind: kindUser, Author: s.meta.Owner, Text: text})
	s.history = append(s.history, Message{Role: roleUser, Blocks: []Block{{Type: blockText, Text: text}}})
	if strings.TrimSpace(s.meta.Topic) == "" {
		s.meta.Topic = topicFrom(text)
	}
	s.mu.Unlock()
	e.turn(ctx, s, provider, true)
}

// topicFrom makes a title out of a request: its first line, cut short.
func topicFrom(text string) string {
	first := strings.TrimSpace(strings.SplitN(strings.TrimSpace(text), "\n", 2)[0])
	runes := []rune(first)
	if len(runes) > 60 {
		return string(runes[:57]) + "…"
	}
	return first
}

// cancel stops a session: the running turn's context, every pending question,
// and the state. Calls already sent to the Gateway are not undone here.
func (e *engine) cancel(s *session) {
	s.mu.Lock()
	cancel := s.cancel
	for _, id := range append([]string(nil), s.order...) {
		if request, ok := s.pending[id]; ok {
			s.removeApprovalLocked(id)
			close(request.answer)
		}
	}
	wasBusy := s.busy
	s.setStateLocked(stateCancelled)
	s.appendLocked(entry{Kind: kindCancelled, Author: authorTerra})
	s.mu.Unlock()
	if cancel != nil && wasBusy {
		cancel()
	}
}

// turn runs the loop until the model stops calling tools, the step cap, an
// error, or a cancel. finish says whether the session is over afterwards
// (a run) or waits for the next line (a chat).
func (e *engine) turn(parent context.Context, s *session, provider Provider, finish bool) {
	// The wall-clock ceiling is the turn's, and it is a real deadline rather
	// than a cancel: a turn that hit it is reported as having run out of time,
	// which is a different thing from a person stopping it.
	bounded, releaseDeadline := parent, context.CancelFunc(func() {})
	if seconds := s.meta.MaxSeconds; seconds > 0 {
		bounded, releaseDeadline = context.WithTimeout(parent, time.Duration(seconds)*time.Second)
	}
	defer releaseDeadline()
	ctx, cancel := context.WithCancel(bounded)
	s.mu.Lock()
	s.cancel = cancel
	s.setStateLocked(stateRunning)
	owner := s.meta.Owner
	meta := s.meta
	s.mu.Unlock()

	options := agentcore.Options{
		Autonomy: agentcore.Autonomy(meta.Autonomy),
		DryRun:   meta.Simulate,
		Approver: e.approver(s),
		Recorder: e.recorder(s),
		Now:      e.now,
	}
	// The external servers of this turn, started lazily and closed when the turn
	// ends however it ends (A8). A session that named none pays nothing: there
	// is no pool, and the surface is exactly what it was before A8.
	if pool, err := e.externalPool(meta); err != nil {
		// The names were checked when the session opened, so this is a server
		// that has since been removed. The turn does not silently run with a
		// smaller surface than the session was opened with.
		s.append(entry{Kind: kindError, Author: authorTerra, Text: err.Error(), ErrorCode: "MCP_SERVER_UNKNOWN"})
		s.mu.Lock()
		s.busy = false
		s.cancel = nil
		s.meta.LastError = err.Error()
		s.meta.LastErrorCode = "MCP_SERVER_UNKNOWN"
		s.setStateLocked(stateFailed)
		s.mu.Unlock()
		cancel()
		return
	} else if pool != nil {
		defer pool.Close()
		options.External = pool.tools()
		options.ExternalCaller = pool
	}

	agent := agentcore.New(e.transport(owner), options)
	request := Request{
		System:  systemPrompt,
		Context: sessionContext(meta),
		// This credential's surface, not a fixed one: the fleet tool is offered
		// only when the grant reaches past this node (A6), and the external
		// tools only for a session that named a registered server (A8).
		Tools: agent.ToolsFor(ctx),
	}

	end := func(state, failure, code string) {
		cancel()
		s.mu.Lock()
		defer s.mu.Unlock()
		s.busy = false
		s.cancel = nil
		if s.meta.State == stateCancelled {
			return
		}
		if failure != "" {
			s.meta.LastError = failure
			s.meta.LastErrorCode = code
		}
		if finish && state == stateIdle {
			state = stateDone
		}
		s.setStateLocked(state)
	}

	for step := 0; step < meta.MaxSteps; step++ {
		if stopped, state, reason, code := e.stopped(ctx, s); stopped {
			end(state, reason, code)
			return
		}
		request.Messages = s.historyCopy()
		// §8: what left this node is recorded before it leaves, so the answer
		// to "그때 뭐가 나갔지" does not depend on the call coming back.
		s.append(entry{
			Kind: kindModel, Author: authorTerra, SentBytes: promptBytes(request),
			Provider: provider.Name(), Model: provider.Model(),
			Note: fmt.Sprintf("%s/%s · %d B · %d tool result(s) carried", provider.Name(), provider.Model(),
				promptBytes(request), toolResultCount(request.Messages)),
		})
		response, err := provider.Complete(ctx, request)
		if err != nil {
			if stopped, state, reason, code := e.stopped(ctx, s); stopped {
				end(state, reason, code)
				return
			}
			// 모델 API 장애: 진행 중 호출은 끝냈고, 새 계획은 세우지 않고,
			// 세션 상태를 남기고 멈춘다(§13).
			s.append(entry{Kind: kindError, Author: authorTerra, Text: "model call failed: " + err.Error(), ErrorCode: "MODEL_UNAVAILABLE"})
			end(stateFailed, err.Error(), "MODEL_UNAVAILABLE")
			return
		}
		s.mu.Lock()
		s.meta.Steps++
		s.meta.Usage.add(response.Usage)
		s.history = append(s.history, response.Message)
		s.mu.Unlock()

		var toolUses []Block
		for _, block := range response.Message.Blocks {
			switch block.Type {
			case blockText:
				if strings.TrimSpace(block.Text) == "" {
					continue
				}
				s.append(entry{Kind: kindAssistant, Author: authorAgent, Text: block.Text})
				s.mu.Lock()
				s.meta.Answer = block.Text
				s.mu.Unlock()
			case blockToolUse:
				toolUses = append(toolUses, block)
			}
		}
		if response.StopReason == stopRefusal {
			text := "the model declined to continue"
			if response.Refusal != "" {
				text += " (" + response.Refusal + ")"
			}
			s.append(entry{Kind: kindError, Author: authorTerra, Text: text, ErrorCode: "MODEL_REFUSED"})
			end(stateIdle, text, "MODEL_REFUSED")
			return
		}
		if len(toolUses) == 0 {
			if response.StopReason == stopMaxTokens {
				s.append(entry{Kind: kindError, Author: authorTerra, Text: "the model's answer was cut at its token limit", ErrorCode: "MODEL_TRUNCATED"})
			}
			s.append(entry{Kind: kindDone, Author: authorTerra, Note: doneNote(s)})
			end(stateIdle, "", "")
			return
		}

		// Every call of one assistant message is answered in one user message.
		results := make([]Block, 0, len(toolUses))
		for _, call := range toolUses {
			result := agent.Call(ctx, call.Name, call.Input)
			results = append(results, toolResultBlock(call.ID, result))
			if stopped, state, reason, code := e.stopped(ctx, s); stopped {
				end(state, reason, code)
				return
			}
		}
		s.appendHistory(Message{Role: roleUser, Blocks: results})
	}
	s.append(entry{Kind: kindError, Author: authorTerra, Text: fmt.Sprintf("stopped: the session's limit of %d model turns was reached", meta.MaxSteps), ErrorCode: "STEP_LIMIT"})
	end(stateIdle, "step limit reached", "STEP_LIMIT")
}

// stopped reports whether the turn must not continue, and how to say so. It
// folds the three ways a turn ends short of an answer into one place: a person
// cancelled it, its wall clock ran out, or the session spent its tokens.
func (e *engine) stopped(ctx context.Context, s *session) (bool, string, string, string) {
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			s.mu.Lock()
			seconds := s.meta.MaxSeconds
			s.mu.Unlock()
			reason := fmt.Sprintf("stopped: this turn ran past its limit of %ds", seconds)
			s.append(entry{Kind: kindError, Author: authorTerra, Text: reason, ErrorCode: "TIME_LIMIT"})
			return true, stateIdle, reason, "TIME_LIMIT"
		}
		return true, stateCancelled, "", ""
	}
	s.mu.Lock()
	budget, spent := s.meta.TokenBudget, s.meta.Usage.InputTokens+s.meta.Usage.OutputTokens
	s.mu.Unlock()
	if budget > 0 && spent >= budget {
		reason := fmt.Sprintf("stopped: this session spent its token budget (%d of %d)", spent, budget)
		s.append(entry{Kind: kindError, Author: authorTerra, Text: reason, ErrorCode: "TOKEN_BUDGET"})
		return true, stateIdle, reason, "TOKEN_BUDGET"
	}
	return false, "", "", ""
}

// promptBytes is how much of this request is content that leaves the node: the
// instructions, the conversation, and every tool result carried back into it.
// The provider's own re-encoding of the same material (Message.Native) is not
// counted twice, and the tool schemas are counted once because they do go out
// on every call.
func promptBytes(request Request) int {
	total := len(request.System) + len(request.Context)
	for _, tool := range request.Tools {
		total += len(tool.Name) + len(tool.Description) + len(tool.InputSchema)
	}
	for _, message := range request.Messages {
		for _, block := range message.Blocks {
			total += len(block.Text) + len(block.Input) + len(block.Content)
		}
	}
	return total
}

// toolResultCount is how many operation outputs this request carries back into
// the model's context — the other half of the §8 question.
func toolResultCount(messages []Message) int {
	count := 0
	for _, message := range messages {
		for _, block := range message.Blocks {
			if block.Type == blockToolResult {
				count++
			}
		}
	}
	return count
}

func doneNote(s *session) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return fmt.Sprintf("%d turn(s) · %d in / %d out tokens", s.meta.Steps, s.meta.Usage.InputTokens, s.meta.Usage.OutputTokens)
}

// toolResultBlock renders a gate result for the model. A refusal or error is
// an error result carrying the code, so the model reads the code rather than
// a prose description of it.
func toolResultBlock(toolUseID string, result agentcore.ToolResult) Block {
	if result.Err != nil {
		encoded, _ := json.Marshal(map[string]any{"error": result.Err})
		return Block{Type: blockToolResult, ToolUseID: toolUseID, Content: string(encoded), IsError: true}
	}
	content := string(result.Payload)
	if strings.TrimSpace(content) == "" {
		content = "null"
	}
	return Block{Type: blockToolResult, ToolUseID: toolUseID, Content: content}
}

// recorder turns the gate's records into transcript lines, so the session's
// own account of what was called comes from the gate and not from the model.
func (e *engine) recorder(s *session) agentcore.Recorder {
	return agentcore.RecorderFunc(func(record agentcore.Record) {
		line := entry{
			Kind: kindCall, Author: authorAgent, Subject: record.Tool,
			Decision: string(record.Decision), Status: record.Status, ErrorCode: record.ErrorCode,
			TraceID: record.TraceID, Reason: record.Reason, Judgement: record.Judgement,
		}
		if record.Tool == agentcore.ToolInvoke {
			line.Subject = record.OperationID
			line.OperationID = record.OperationID
		}
		if record.External {
			// An external call is named by its kind rather than by an
			// operation id it does not have, and the server is split back out
			// of the qualified name so a reader sees WHICH third party this
			// was without parsing anything (R8).
			line.Kind = kindExternal
			line.OperationID = ""
			line.ResultBytes = record.ResultBytes
			if server, _, ok := agentcore.ParseExternalToolName(record.Tool); ok {
				line.Server = server
			}
		}
		if record.Status == agentcore.StatusPlanned {
			line.Kind = kindPlanned
		}
		notes := []string{}
		if record.Decision != "" {
			notes = append(notes, string(record.Decision))
		}
		notes = append(notes, record.Status)
		if record.ErrorCode != "" {
			notes = append(notes, record.ErrorCode)
		}
		if record.TraceID != "" {
			// The join key rides in the note so a room shows it with the rest
			// of the instrument, and `terra agent log` prints it without a
			// second surface having to be invented for it.
			notes = append(notes, "trace="+record.TraceID)
		}
		if record.External {
			// Where a Gateway call prints its trace id, an external call prints
			// the fact that there is none to print. Saying "no gateway audit"
			// in the line itself is R8's second half: the absence has to be
			// visible where somebody is already looking.
			notes = append(notes, fmt.Sprintf("external · %d B · no gateway audit", record.ResultBytes))
		}
		line.Note = strings.Join(notes, " · ")
		s.append(line)
	})
}

// approver is how the shared gate reaches the person: it puts the question in
// the transcript and waits for `terra agent approve` or a typed answer.
func (e *engine) approver(s *session) agentcore.Approver {
	return agentcore.ApproverFunc(func(ctx context.Context, request agentcore.ApprovalRequest) (bool, error) {
		wait := e.approvalWait
		if wait <= 0 {
			wait = approvalTimeout
		}
		// What is left of the turn is measured on the real clock the deadline
		// runs on, then added to the session's own notion of "now".
		var left time.Duration
		deadline, hasDeadline := ctx.Deadline()
		if hasDeadline {
			left = time.Until(deadline)
		}
		pending := s.addApproval(request.OperationID, request.Reason, request.Judgement.Reason, request.Input, approvalContractOf(request.Operation),
			func(asked time.Time) int64 { return approvalExpiry(asked, wait, left, hasDeadline) })
		s.mu.Lock()
		s.setStateLocked(stateWaiting)
		s.appendLocked(entry{
			Kind: kindApproval, Author: authorTerra, RequestID: pending.ID, Subject: request.OperationID,
			OperationID: request.OperationID, Decision: string(request.Judgement.Decision), Note: request.Judgement.Reason,
			Text: approvalText(pending, request),
		})
		s.mu.Unlock()

		timer := time.NewTimer(wait)
		defer timer.Stop()
		var approved bool
		var answered bool
		select {
		case approved, answered = <-pending.answer:
		case <-ctx.Done():
			s.removeApproval(pending.ID)
			return false, ctx.Err()
		case <-timer.C:
			s.removeApproval(pending.ID)
			s.append(entry{Kind: kindDenied, Author: authorTerra, RequestID: pending.ID, Subject: request.OperationID, Note: "no answer within " + wait.String()})
			return false, errors.New("nobody answered within " + wait.String())
		}
		if !answered {
			// The channel was closed: the session was cancelled underneath.
			return false, errors.New("the session was cancelled while waiting for approval")
		}
		s.mu.Lock()
		if s.meta.State == stateWaiting {
			s.setStateLocked(stateRunning)
		}
		kind := kindDenied
		if approved {
			kind = kindApproved
		}
		s.appendLocked(entry{Kind: kind, Author: authorTerra, RequestID: pending.ID, Subject: request.OperationID, OperationID: request.OperationID})
		s.mu.Unlock()
		return approved, nil
	})
}

// approvalContractOf reads the facts off the catalog operation the gate already
// holds. It returns nil when there is no operation (nothing was read).
func approvalContractOf(operation agentcore.CatalogOperation) *approvalContract {
	if operation.OperationID == "" {
		return nil
	}
	contract := &approvalContract{}
	if execution := operation.Execution; execution != nil {
		contract.Risk = execution.Risk
		contract.ConfirmationMode = execution.ConfirmationMode
		contract.IdempotencyMode = execution.IdempotencyMode
		contract.RetryMode = execution.RetryMode
	}
	if operation.Output != nil {
		contract.OutputMode = operation.Output.Mode
	}
	if operation.SideEffects != nil {
		effects := make([]approvalSideEffect, 0, len(operation.SideEffects))
		for _, effect := range operation.SideEffects {
			effects = append(effects, approvalSideEffect{ResourceID: effect.ResourceID, Action: effect.Action})
		}
		contract.SideEffects = &effects
	}
	if operation.Permissions != nil {
		permissions := append([]string{}, operation.Permissions...)
		contract.Permissions = &permissions
	}
	return contract
}

// approvalExpiry is when a question asked at `asked` stops being answerable:
// asked plus the earlier of the per-question wait and what is left of the
// turn (`left`), whose deadline cancels the context under the waiting approver.
// A turn with no deadline is bounded by the wait alone.
func approvalExpiry(asked time.Time, wait, left time.Duration, hasDeadline bool) int64 {
	span := wait
	if hasDeadline && left < span {
		span = left
	}
	if span < 0 {
		span = 0
	}
	return millis(asked.Add(span))
}

// approvalText is what the person reads. It separates the contract's facts
// from the model's claim, because the person is approving the call, not the
// model's description of it.
func approvalText(pending *approvalRequest, request agentcore.ApprovalRequest) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "Approval needed — %s\n", request.OperationID)
	fmt.Fprintf(&builder, "why a person: %s\n", request.Judgement.Reason)
	if strings.TrimSpace(request.Reason) != "" {
		fmt.Fprintf(&builder, "the model says: %s\n", request.Reason)
	}
	if len(request.Input) > 0 && string(request.Input) != "{}" {
		fmt.Fprintf(&builder, "input: %s\n", string(request.Input))
	}
	fmt.Fprintf(&builder, "answer: approve %s / deny %s (or: terra agent approve %s [--deny])", pending.ID, pending.ID, pending.ID)
	return builder.String()
}

// answerText reads a typed "approve [id]" / "deny [id]". ok is false when the
// line is an ordinary message.
func answerText(text string) (id string, approved bool, ok bool) {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(text)))
	if len(fields) == 0 || len(fields) > 2 {
		return "", false, false
	}
	switch fields[0] {
	case "approve", "yes", "y":
		approved = true
	case "deny", "no", "n":
		approved = false
	default:
		return "", false, false
	}
	if len(fields) == 2 {
		id = strings.Fields(strings.TrimSpace(text))[1]
	}
	return id, approved, true
}
