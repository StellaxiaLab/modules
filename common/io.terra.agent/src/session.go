package main

// Sessions: the transcript, the state, the people waiting to be asked.
//
// A session is the unit everything else hangs off — one owner, one
// conversation with the model, one append-only record of what was said and
// what was called. The record is written as JSONL under the module data
// directory as it happens, so "what did the agent actually do" survives the
// process (설계 §12); the model-side history lives only in memory, so a session
// found on disk after a restart is readable but not continuable (archived).

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Entry kinds. text present = speech; absent = something that happened.
const (
	kindUser      = "user"
	kindAssistant = "assistant"
	kindCall      = "call"
	// kindModel is one model call: what left this node for the provider. It
	// carries no text because nothing was said — it is the §8 line, the one
	// that answers "그때 뭐가 나갔지" with a size rather than a promise.
	kindModel = "model"
	// kindExternal is one call to a tool at an external MCP server (A8). It is
	// its own kind because it is the ONLY record of that call: an external call
	// does not go through the Gateway, so the Gateway audit has no line for it
	// (설계 §7.10 R8). Assuming otherwise is the accident this kind exists to
	// prevent.
	kindExternal  = "external"
	kindPlanned   = "planned"
	kindApproval  = "approval"
	kindApproved  = "approved"
	kindDenied    = "denied"
	kindDone      = "done"
	kindError     = "error"
	kindCancelled = "cancelled"
)

// Authors other than a person.
const (
	authorAgent = "agent"
	authorTerra = "terra"
)

// Session states.
const (
	stateIdle      = "idle"
	stateRunning   = "running"
	stateWaiting   = "waiting-approval"
	stateDone      = "done"
	stateCancelled = "cancelled"
	stateFailed    = "failed"
	stateArchived  = "archived"
)

const (
	sessionsDirName = "sessions"
	// subscriberBuffer is how far a slow stream reader may fall behind before
	// it loses events. The record on disk is the truth; the stream is a nudge.
	subscriberBuffer = 64
	defaultMaxSteps  = 24
	maxMaxSteps      = 100
	// defaultMaxSeconds bounds ONE turn — a model call, its tool calls, and the
	// next call — not the session, which may sit idle between turns for as long
	// as the person wants. The runaway this guards against is a loop, and a
	// loop happens inside a turn.
	defaultMaxSeconds = 900
	maxMaxSeconds     = 7200
)

// validSessionID mirrors the contract's pattern. Ids become file names, so the
// rule that keeps them canonical also keeps path traversal impossible.
var validSessionID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)

// entry is one line of the record, in the contract's shape.
type entry struct {
	Seq         int    `json:"seq"`
	Kind        string `json:"kind"`
	Author      string `json:"author"`
	AuthorLabel string `json:"author_label"`
	Text        string `json:"text,omitempty"`
	TimeMS      int64  `json:"time_ms"`
	Note        string `json:"note,omitempty"`
	Subject     string `json:"subject,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	Decision    string `json:"decision,omitempty"`
	Status      string `json:"status,omitempty"`
	ErrorCode   string `json:"error_code,omitempty"`
	RequestID   string `json:"request_id,omitempty"`
	// TraceID is the Gateway's id for a call line. It is what joins this
	// record to the Gateway's audit trail — the same call seen from the two
	// sides — and it is the reason a person can check the agent's account of
	// itself instead of believing it.
	TraceID string `json:"trace_id,omitempty"`
	// SentBytes is how much left this node on a model line (§8).
	SentBytes int `json:"sent_bytes,omitempty"`
	// Server is the registered external MCP server an external line called
	// (A8), and ResultBytes is how much it answered with after the cap (R6).
	Server      string `json:"server,omitempty"`
	ResultBytes int    `json:"result_bytes,omitempty"`
}

// sessionMeta is the state a caller may see, in the contract's shape.
type sessionMeta struct {
	ID       string `json:"session_id"`
	Topic    string `json:"topic,omitempty"`
	State    string `json:"state"`
	Autonomy string `json:"autonomy"`
	Simulate bool   `json:"simulate"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
	Owner    string `json:"owner"`
	Steps    int    `json:"steps"`
	// The three limits of §12. They are reported, not just enforced: a session
	// that stopped is only readable if the ceiling it hit is visible next to
	// the count that hit it.
	MaxSteps    int    `json:"max_steps"`
	MaxSeconds  int    `json:"max_seconds,omitempty"`
	TokenBudget int64  `json:"token_budget,omitempty"`
	CreatedMS   int64  `json:"created_ms"`
	UpdatedMS   int64  `json:"updated_ms"`
	LastError   string `json:"last_error,omitempty"`
	Answer      string `json:"answer,omitempty"`
	Usage       Usage  `json:"usage"`
	// MCPServers are the registered external MCP servers this session may use
	// (A8). It is frozen at open, like autonomy: a session's surface does not
	// widen under it, and a person reading the record later needs to know which
	// third parties could have put text into this conversation.
	MCPServers []string `json:"mcp_servers,omitempty"`
}

// approvalRequest is one question waiting for a person.
type approvalRequest struct {
	ID          string          `json:"request_id"`
	OperationID string          `json:"operation_id"`
	Reason      string          `json:"reason,omitempty"`
	Judgement   string          `json:"judgement,omitempty"`
	Input       json.RawMessage `json:"input,omitempty"`
	CreatedMS   int64           `json:"created_ms"`
	// Contract is what the operation's contract says about running it — the
	// facts a person approves, as opposed to Reason, which is the model's claim.
	// It is absent when there is no Gateway contract to read (an external tool).
	Contract *approvalContract `json:"contract,omitempty"`
	// ExpiresMS is when this question gives up waiting (Unix epoch ms): the
	// moment it was asked plus the earlier of the per-question wait and what is
	// left of the turn's wall-clock limit. After it the card cannot be answered.
	ExpiresMS int64 `json:"expires_ms,omitempty"`
	answer    chan bool
}

// approvalContract carries the contract's own words. A field the contract did
// not write is ABSENT from the JSON; a field it wrote as "none" or as an empty
// list is present. "Not written" and "none" are different facts (DC-17), so
// every value here is omitted when unwritten and never defaulted.
type approvalContract struct {
	Risk             string `json:"risk,omitempty"`
	ConfirmationMode string `json:"confirmation_mode,omitempty"`
	IdempotencyMode  string `json:"idempotency_mode,omitempty"`
	RetryMode        string `json:"retry_mode,omitempty"`
	OutputMode       string `json:"output_mode,omitempty"`
	// SideEffects and Permissions are pointers to slices so that an empty list
	// the contract wrote (`[]`) survives omitempty while an unwritten one does not.
	SideEffects *[]approvalSideEffect `json:"side_effects,omitempty"`
	Permissions *[]string             `json:"permissions,omitempty"`
}

type approvalSideEffect struct {
	ResourceID string `json:"resource_id,omitempty"`
	Action     string `json:"action,omitempty"`
}

type session struct {
	mu          sync.Mutex
	meta        sessionMeta
	entries     []entry
	history     []Message
	pending     map[string]*approvalRequest
	order       []string
	subscribers map[int]chan entry
	nextSub     int
	busy        bool
	cancel      context.CancelFunc
	// logPath is the record's path, not an open handle. A session a person
	// leaves open would otherwise hold a descriptor for the life of the
	// process, and on Windows that handle blocks the file's own removal.
	// Empty for the archived sessions load() brings back: their writes are
	// dropped on purpose.
	logPath string
	now     func() time.Time
}

// errors the surface maps to contract codes.
var (
	errSessionNotFound = errors.New("session not found")
	errSessionBusy     = errors.New("the model's turn is in progress; watch the stream for it to end, then send again")
	errSessionFinished = errors.New("this session is finished and takes no more messages")
	errNotOwner        = errors.New("this session belongs to someone else; sessions run as their owner's credential and cannot be shared")
	errApprovalMissing = errors.New("no such approval request, or it was already answered")
)

func millis(t time.Time) int64 { return t.UnixMilli() }

func randomID(prefix string, bytes int) string {
	buffer := make([]byte, bytes)
	if _, err := rand.Read(buffer); err != nil {
		return prefix + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return prefix + hex.EncodeToString(buffer)
}

// snapshot is the contract's session object.
func (s *session) snapshot() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *session) snapshotLocked() map[string]any {
	encoded, _ := json.Marshal(s.meta)
	view := map[string]any{}
	_ = json.Unmarshal(encoded, &view)
	pending := make([]approvalRequest, 0, len(s.order))
	for _, id := range s.order {
		if request, ok := s.pending[id]; ok {
			pending = append(pending, *request)
		}
	}
	view["pending_approvals"] = pending
	return view
}

// append adds one line: it is numbered, timed, written to disk and pushed to
// every stream subscriber. It is the only way a line gets into the record.
func (s *session) append(line entry) entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.appendLocked(line)
}

func (s *session) appendLocked(line entry) entry {
	line.Seq = len(s.entries) + 1
	if line.TimeMS == 0 {
		line.TimeMS = millis(s.now())
	}
	if line.AuthorLabel == "" {
		line.AuthorLabel = line.Author
	}
	s.entries = append(s.entries, line)
	s.meta.UpdatedMS = line.TimeMS
	s.writeLocked(map[string]any{"entry": line})
	for _, subscriber := range s.subscribers {
		select {
		case subscriber <- line:
		default:
		}
	}
	return line
}

// setState changes the state and records the meta line so a reader of the
// file knows how the session ended.
func (s *session) setState(state string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.setStateLocked(state)
}

func (s *session) setStateLocked(state string) {
	s.meta.State = state
	s.meta.UpdatedMS = millis(s.now())
	s.writeLocked(map[string]any{"meta": s.meta})
}

func (s *session) writeLocked(line map[string]any) {
	if s.logPath == "" {
		return
	}
	encoded, err := json.Marshal(line)
	if err != nil {
		return
	}
	// A write that fails must not fail the session: a full disk should cost
	// the record, not the work the record is about. The open costs one
	// syscall per record, and a session writes at human pace, not in a loop.
	file, err := os.OpenFile(s.logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = file.Write(append(encoded, '\n'))
	_ = file.Close()
}

func (s *session) entriesAfter(afterSeq, limit int) []entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]entry, 0)
	for _, line := range s.entries {
		if line.Seq <= afterSeq {
			continue
		}
		result = append(result, line)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result
}

func (s *session) subscribe() (<-chan entry, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextSub++
	id := s.nextSub
	events := make(chan entry, subscriberBuffer)
	s.subscribers[id] = events
	return events, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if _, live := s.subscribers[id]; live {
			delete(s.subscribers, id)
			close(events)
		}
	}
}

// historyCopy is the conversation as the next model call should see it.
func (s *session) historyCopy() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.history...)
}

func (s *session) appendHistory(message Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.history = append(s.history, message)
}

// addApproval registers a question and returns it; the loop waits on answer.
func (s *session) addApproval(operationID, reason, judgement string, input json.RawMessage, contract *approvalContract, expiry func(asked time.Time) int64) *approvalRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	asked := s.now()
	request := &approvalRequest{
		ID: randomID("apr_", 4), OperationID: operationID, Reason: reason, Judgement: judgement,
		Input: input, Contract: contract, CreatedMS: millis(asked), ExpiresMS: expiry(asked), answer: make(chan bool, 1),
	}
	s.pending[request.ID] = request
	s.order = append(s.order, request.ID)
	return request
}

// answerApproval resolves one question. An empty id means the oldest one —
// what a person typing "approve" in the room means.
func (s *session) answerApproval(id string, approved bool) (*approvalRequest, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == "" {
		for _, candidate := range s.order {
			if _, ok := s.pending[candidate]; ok {
				id = candidate
				break
			}
		}
	}
	request, ok := s.pending[id]
	if !ok {
		return nil, false
	}
	s.removeApprovalLocked(id)
	request.answer <- approved
	return request, true
}

func (s *session) removeApproval(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeApprovalLocked(id)
}

func (s *session) removeApprovalLocked(id string) {
	delete(s.pending, id)
	kept := s.order[:0]
	for _, candidate := range s.order {
		if candidate != id {
			kept = append(kept, candidate)
		}
	}
	s.order = kept
}

func (s *session) pendingCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.pending)
}

// sessionOptions is what a session is opened with.
type sessionOptions struct {
	ID          string
	Autonomy    string
	Simulate    bool
	Provider    string
	Model       string
	Topic       string
	MaxSteps    int
	MaxSeconds  int
	TokenBudget int64
	MCPServers  []string
}

// sessionStore keeps the live sessions and the records on disk.
type sessionStore struct {
	mu       sync.Mutex
	root     string
	sessions map[string]*session
	now      func() time.Time
}

func newSessionStore(root string, now func() time.Time) (*sessionStore, error) {
	store := &sessionStore{root: filepath.Join(root, sessionsDirName), sessions: map[string]*session{}, now: now}
	if err := os.MkdirAll(store.root, 0o700); err != nil {
		return nil, fmt.Errorf("create sessions directory: %w", err)
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

// open creates a session, or returns the one already under that id.
func (st *sessionStore) open(options sessionOptions, owner string) (*session, bool, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	id := strings.TrimSpace(options.ID)
	if id == "" {
		id = randomID("s-", 4)
	}
	if !validSessionID.MatchString(id) {
		return nil, false, fmt.Errorf("session id %q: letters, digits, '.', '_' and '-' only", id)
	}
	if existing, ok := st.sessions[id]; ok {
		return existing, false, nil
	}
	maxSteps := options.MaxSteps
	if maxSteps <= 0 {
		maxSteps = defaultMaxSteps
	}
	if maxSteps > maxMaxSteps {
		maxSteps = maxMaxSteps
	}
	maxSeconds := options.MaxSeconds
	if maxSeconds <= 0 {
		maxSeconds = defaultMaxSeconds
	}
	if maxSeconds > maxMaxSeconds {
		maxSeconds = maxMaxSeconds
	}
	now := st.now()
	current := &session{
		meta: sessionMeta{
			ID: id, Topic: options.Topic, State: stateIdle, Autonomy: options.Autonomy, Simulate: options.Simulate,
			Provider: options.Provider, Model: options.Model, Owner: owner,
			MaxSteps: maxSteps, MaxSeconds: maxSeconds, TokenBudget: options.TokenBudget,
			MCPServers: append([]string(nil), options.MCPServers...),
			CreatedMS:  millis(now), UpdatedMS: millis(now),
		},
		pending: map[string]*approvalRequest{}, subscribers: map[int]chan entry{}, now: st.now,
	}
	// Created here rather than at the first write so an unwritable root is
	// reported when the session opens, not silently much later.
	path := filepath.Join(st.root, id+".jsonl")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, false, fmt.Errorf("open session record: %w", err)
	}
	_ = file.Close()
	current.logPath = path
	current.writeLocked(map[string]any{"meta": current.meta})
	st.sessions[id] = current
	return current, true, nil
}

func (st *sessionStore) get(id string) (*session, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	current, ok := st.sessions[id]
	return current, ok
}

func (st *sessionStore) list() []map[string]any {
	st.mu.Lock()
	sessions := make([]*session, 0, len(st.sessions))
	for _, current := range st.sessions {
		sessions = append(sessions, current)
	}
	st.mu.Unlock()
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].meta.CreatedMS > sessions[j].meta.CreatedMS })
	rows := make([]map[string]any, 0, len(sessions))
	for _, current := range sessions {
		rows = append(rows, current.snapshot())
	}
	return rows
}

func (st *sessionStore) count() int {
	st.mu.Lock()
	defer st.mu.Unlock()
	return len(st.sessions)
}

// findApproval locates the session holding a pending request id.
func (st *sessionStore) findApproval(requestID string) (*session, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, current := range st.sessions {
		current.mu.Lock()
		_, ok := current.pending[requestID]
		current.mu.Unlock()
		if ok {
			return current, true
		}
	}
	return nil, false
}

// load reads the records left by earlier processes. They come back readable
// and archived: the model-side history was never on disk, and pretending a
// conversation can continue from a transcript would have the model answer a
// history it never saw.
func (st *sessionStore) load() error {
	names, err := filepath.Glob(filepath.Join(st.root, "*.jsonl"))
	if err != nil {
		return err
	}
	for _, name := range names {
		current, err := readSessionRecord(name, st.now)
		if err != nil {
			// One unreadable record must not stop the module; it stays on disk
			// for a person to look at.
			fmt.Fprintf(os.Stderr, "terra-agent: skipping session record %s: %v\n", name, err)
			continue
		}
		st.sessions[current.meta.ID] = current
	}
	return nil
}

func readSessionRecord(path string, now func() time.Time) (*session, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	current := &session{pending: map[string]*approvalRequest{}, subscribers: map[int]chan entry{}, now: now}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for scanner.Scan() {
		var line struct {
			Meta  *sessionMeta `json:"meta"`
			Entry *entry       `json:"entry"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			return nil, err
		}
		if line.Meta != nil {
			current.meta = *line.Meta
		}
		if line.Entry != nil {
			current.entries = append(current.entries, *line.Entry)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if current.meta.ID == "" {
		return nil, errors.New("record has no session meta")
	}
	switch current.meta.State {
	case stateDone, stateCancelled, stateFailed:
	default:
		current.meta.State = stateArchived
	}
	return current, nil
}
