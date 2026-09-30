package talk

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Sentinel errors the API layer maps to contract error codes.
var (
	ErrNotFound = errors.New("talk: conversation not found")
	ErrInvalid  = errors.New("talk: invalid input")
)

// Store owns the module's data home (plan §5):
//
//	<root>/conversations/<conversation-id>/
//	  meta.json                # members, ranks, epoch, main — atomic replace
//	  log/<author-node>.jsonl  # per-author append-only
//
// The write discipline is the whole design: this node APPENDS only to its own
// author log; other authors' files are transcribed on receipt (M2), never
// edited. No file is ever rewritten in place except meta.json, which is
// replaced durably (durable.go) — so a torn write can lose at most the tail
// line an append had not finished, never corrupt history.
type Store struct {
	root string
	self func() string
	// logger receives damage the store recovered from without failing the
	// call. nil is allowed and means "recover unobserved" (durable.go).
	logger *log.Logger

	mu           sync.Mutex
	hubs         map[string]*hub
	tombstoneTTL time.Duration // 0 = DefaultTombstoneTTL (D-4: 30일)
	// peerContact is when a peer last reached this node about each conversation
	// — the main's lease (lease.go). Memory only, on purpose: a lease that
	// survived a restart would let a main that has spoken to nobody since
	// booting keep acting as one.
	peerContact map[string]time.Time
	// leaseTTL is how long this node may act as main unreached. 0 =
	// DefaultLeaseTTL; a negative value disables the lease, which is what an
	// assembly with no sync loop wants — nothing renews there.
	leaseTTL time.Duration
}

// storedEntry is the on-disk line: the API entry plus append-side bookkeeping
// that must never leave this node (the idempotency key is stripped before an
// entry is served or replicated).
type storedEntry struct {
	Entry
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// storedMeta is meta.json. CreateKey makes conversations.create idempotent
// across retries; like the entry key it is internal bookkeeping.
type storedMeta struct {
	ConversationID string   `json:"conversation_id"`
	CreatedBy      string   `json:"created_by"`
	DisplayName    string   `json:"display_name"`
	Epoch          int      `json:"epoch"`
	MainNodeID     string   `json:"main_node_id"`
	Members        []Member `json:"members"`
	// MembersRev is the membership clock; see Conversation.MembersRev.
	MembersRev int    `json:"members_rev,omitempty"`
	CreateKey  string `json:"create_key,omitempty"`
	// LastHandoverMs stamps the most recent main handover (wall clock) so the
	// hysteresis window survives a restart of the main.
	LastHandoverMs int64 `json:"last_handover_ms,omitempty"`
}

// NewStore opens (creating if needed) the data home. self resolves this node's
// id at call time — it may legitimately answer "unknown" on a host without a
// core plane; the store still works, it just authors under that name.
func NewStore(root string, self func() string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("talk: data root is required")
	}
	if self == nil {
		return nil, errors.New("talk: self node resolver is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "conversations"), 0o755); err != nil {
		return nil, fmt.Errorf("talk: create data home: %w", err)
	}
	return &Store{root: root, self: self, hubs: map[string]*hub{}}, nil
}

func (s *Store) conversationDir(id string) string {
	return filepath.Join(s.root, "conversations", id)
}

// Create makes a conversation. The creating node is the epoch-0 main, and the
// member list's order freezes into rank (D-2: explicit order). The creator
// joins at rank 0 whether or not the caller listed it — a conversation this
// node cannot see itself in is useless — so an empty member list is a
// conversation of one, which AddMember fills in later (the shape `terra
// nodetalk create` then `invite` produces, since a CLI flag cannot carry an
// array).
func (s *Store) Create(displayName string, memberIDs []string, key string) (Conversation, error) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || len(displayName) > 120 {
		return Conversation{}, fmt.Errorf("%w: display_name must be 1..120 chars", ErrInvalid)
	}
	selfID := s.self()
	if !ValidNodeID(selfID) {
		return Conversation{}, fmt.Errorf("%w: this node's id %q is not usable", ErrInvalid, selfID)
	}

	ordered := []string{}
	seen := map[string]bool{}
	for _, id := range memberIDs {
		id = strings.TrimSpace(id)
		if !ValidNodeID(id) {
			return Conversation{}, fmt.Errorf("%w: member node id %q", ErrInvalid, id)
		}
		if seen[id] {
			return Conversation{}, fmt.Errorf("%w: duplicate member %q", ErrInvalid, id)
		}
		seen[id] = true
		ordered = append(ordered, id)
	}
	if !seen[selfID] {
		ordered = append([]string{selfID}, ordered...)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Same create key → same conversation, however many times the request is
	// retried over a lossy path.
	if key != "" {
		metas, err := s.loadAllMetasLocked()
		if err != nil {
			return Conversation{}, err
		}
		for _, existing := range metas {
			if existing.CreateKey == key {
				return s.view(existing), nil
			}
		}
	}

	id, err := newConversationID()
	if err != nil {
		return Conversation{}, err
	}
	members := make([]Member, 0, len(ordered))
	for rank, nodeID := range ordered {
		members = append(members, Member{NodeID: nodeID, Rank: rank, State: MemberActive, JoinedEpoch: 0})
	}
	meta := storedMeta{
		ConversationID: id,
		CreatedBy:      selfID,
		DisplayName:    displayName,
		Epoch:          0,
		MainNodeID:     selfID,
		Members:        members,
		CreateKey:      key,
	}
	if err := os.MkdirAll(filepath.Join(s.conversationDir(id), "log"), 0o755); err != nil {
		return Conversation{}, fmt.Errorf("talk: create conversation dir: %w", err)
	}
	if err := s.saveMetaLocked(meta); err != nil {
		return Conversation{}, err
	}
	return s.view(meta), nil
}

// List returns every conversation this node holds, each with how far behind
// this node knows itself to be (from the peer marks the sync loop recorded —
// zero when no peer has reported, "known missing: none").
func (s *Store) List() ([]Summary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	metas, err := s.loadAllMetasLocked()
	if err != nil {
		return nil, err
	}
	summaries := make([]Summary, 0, len(metas))
	for _, meta := range metas {
		behind, lostOwn, err := s.behindLocked(meta.ConversationID)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, Summary{
			Behind: behind, LostOwn: lostOwn, Conversation: s.view(meta),
		})
	}
	sort.Slice(summaries, func(i, j int) bool {
		a, b := summaries[i].Conversation, summaries[j].Conversation
		if a.DisplayName != b.DisplayName {
			return a.DisplayName < b.DisplayName
		}
		return a.ConversationID < b.ConversationID
	})
	return summaries, nil
}

// Get returns one conversation and this node's per-author high-water marks —
// the replica.pull resume point and the main.claim catch-up proof material.
func (s *Store) Get(id string) (Conversation, map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return Conversation{}, nil, err
	}
	marks, err := s.watermarksLocked(id)
	if err != nil {
		return Conversation{}, nil, err
	}
	return s.view(meta), marks, nil
}

// AppendMessage appends one message to THIS node's own author log. It needs no
// main role and no reachability — that invariant (D-1) is what makes failover
// lossless, and messages.post's contract pins it.
func (s *Store) AppendMessage(id, text, key string) (Entry, error) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 4000 {
		return Entry{}, fmt.Errorf("%w: text must be 1..4000 chars", ErrInvalid)
	}
	selfID := s.self()
	if !ValidNodeID(selfID) {
		return Entry{}, fmt.Errorf("%w: this node's id %q is not usable", ErrInvalid, selfID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return Entry{}, err
	}

	ownLog := filepath.Join(s.conversationDir(id), "log", selfID+".jsonl")
	own, err := readLog(ownLog)
	if err != nil {
		return Entry{}, err
	}
	// Idempotency: the same key answers the same entry, and the log gains no
	// second line — duplicates on a lossy path stay harmless.
	if key != "" {
		for _, line := range own {
			if line.IdempotencyKey == key {
				return line.Entry, nil
			}
		}
	}

	clock, err := s.lamportClockLocked(id)
	if err != nil {
		return Entry{}, err
	}
	lastSeq := 0
	if len(own) > 0 {
		lastSeq = own[len(own)-1].Seq
	}
	entry := Entry{
		AuthorNodeID: selfID,
		Kind:         KindMessage,
		Lamport:      clock + 1,
		Seq:          lastSeq + 1,
		Epoch:        meta.Epoch,
		Text:         text,
		WallMs:       time.Now().UnixMilli(),
	}
	if err := appendLine(ownLog, storedEntry{Entry: entry, IdempotencyKey: key}); err != nil {
		return Entry{}, err
	}
	s.publishLocked(id, StreamEvent{Event: "entry", Entry: &entry})
	return entry, nil
}

// Entries returns the merged transcript in (lamport, author) total order,
// after the given lamport, capped at limit.
func (s *Store) Entries(id string, afterLamport, limit int) ([]Entry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadMetaLocked(id); err != nil {
		return nil, false, err
	}
	all, err := s.allEntriesLocked(id)
	if err != nil {
		return nil, false, err
	}
	filtered := make([]Entry, 0, len(all))
	for _, entry := range all {
		if entry.Lamport > afterLamport {
			filtered = append(filtered, entry)
		}
	}
	hasMore := false
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[:limit]
		hasMore = true
	}
	return filtered, hasMore, nil
}

// Counts reports how many conversations this node holds and how many it is
// currently main of — status.get's numbers.
func (s *Store) Counts() (total, mainOf int, err error) {
	summaries, err := s.List()
	if err != nil {
		return 0, 0, err
	}
	for _, summary := range summaries {
		if summary.Conversation.Role == "main" {
			mainOf++
		}
	}
	return len(summaries), mainOf, nil
}

// ---- internals -------------------------------------------------------------

func (s *Store) view(meta storedMeta) Conversation {
	role := "backup"
	if meta.MainNodeID == s.self() {
		role = "main"
	}
	members := make([]Member, len(meta.Members))
	copy(members, meta.Members)
	return Conversation{
		ConversationID: meta.ConversationID,
		CreatedBy:      meta.CreatedBy,
		DisplayName:    meta.DisplayName,
		Epoch:          meta.Epoch,
		MainNodeID:     meta.MainNodeID,
		Members:        members,
		MembersRev:     meta.MembersRev,
		Role:           role,
	}
}

func (s *Store) loadMetaLocked(id string) (storedMeta, error) {
	if !ValidConversationID(id) {
		return storedMeta{}, ErrNotFound
	}
	raw, err := os.ReadFile(filepath.Join(s.conversationDir(id), "meta.json"))
	if errors.Is(err, os.ErrNotExist) {
		// Gone — but "deleted, do not resurrect" (410) and "never here" (404)
		// are different answers, and every operation inherits the distinction
		// from this one place.
		if live, tombErr := s.loadTombstonesLocked(); tombErr == nil {
			if _, deleted := live[id]; deleted {
				return storedMeta{}, ErrDeleted
			}
		}
		return storedMeta{}, ErrNotFound
	}
	if err != nil {
		return storedMeta{}, fmt.Errorf("talk: read meta: %w", err)
	}
	var meta storedMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return storedMeta{}, fmt.Errorf("talk: decode meta for %s: %w", id, err)
	}
	return meta, nil
}

func (s *Store) loadAllMetasLocked() ([]storedMeta, error) {
	entries, err := os.ReadDir(filepath.Join(s.root, "conversations"))
	if err != nil {
		return nil, fmt.Errorf("talk: list conversations: %w", err)
	}
	metas := []storedMeta{}
	for _, entry := range entries {
		if !entry.IsDir() || !ValidConversationID(entry.Name()) {
			continue
		}
		meta, err := s.loadMetaLocked(entry.Name())
		if errors.Is(err, ErrNotFound) {
			continue // directory without meta.json: a half-created leftover
		}
		if err != nil {
			return nil, err
		}
		metas = append(metas, meta)
	}
	return metas, nil
}

// saveMetaLocked replaces meta.json atomically: full temp write, then rename.
// Same idiom as io.terra.io-inventory's state store.
func (s *Store) saveMetaLocked(meta storedMeta) error {
	payload, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("talk: encode meta: %w", err)
	}
	dir := s.conversationDir(meta.ConversationID)
	return replaceFileDurable(dir, ".meta-*.tmp", filepath.Join(dir, "meta.json"), append(payload, '\n'))
}

func (s *Store) watermarksLocked(id string) (map[string]int, error) {
	marks := map[string]int{}
	logDir := filepath.Join(s.conversationDir(id), "log")
	files, err := os.ReadDir(logDir)
	if errors.Is(err, os.ErrNotExist) {
		return marks, nil
	}
	if err != nil {
		return nil, fmt.Errorf("talk: list logs: %w", err)
	}
	for _, file := range files {
		author, ok := strings.CutSuffix(file.Name(), ".jsonl")
		if !ok || !ValidNodeID(author) {
			continue
		}
		lines, err := readLog(filepath.Join(logDir, file.Name()))
		if err != nil {
			return nil, err
		}
		if len(lines) > 0 {
			marks[author] = lines[len(lines)-1].Seq
		}
	}
	return marks, nil
}

func (s *Store) allEntriesLocked(id string) ([]Entry, error) {
	logDir := filepath.Join(s.conversationDir(id), "log")
	files, err := os.ReadDir(logDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("talk: list logs: %w", err)
	}
	all := []Entry{}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".jsonl") {
			continue
		}
		lines, err := readLog(filepath.Join(logDir, file.Name()))
		if err != nil {
			return nil, err
		}
		for _, line := range lines {
			all = append(all, line.Entry)
		}
	}
	// The (lamport, author) pair is a total order: no two entries tie, however
	// skewed the wall clocks are.
	sort.Slice(all, func(i, j int) bool {
		if all[i].Lamport != all[j].Lamport {
			return all[i].Lamport < all[j].Lamport
		}
		return all[i].AuthorNodeID < all[j].AuthorNodeID
	})
	return all, nil
}

func (s *Store) lamportClockLocked(id string) (int, error) {
	all, err := s.allEntriesLocked(id)
	if err != nil {
		return 0, err
	}
	clock := 0
	for _, entry := range all {
		if entry.Lamport > clock {
			clock = entry.Lamport
		}
	}
	return clock, nil
}

// readLog reads one author log. A malformed FINAL line is tolerated silently —
// that is the torn tail of an interrupted append, and append-only means it can
// only ever be the last line. A malformed line elsewhere is real corruption
// and errors loudly.
func readLog(path string) ([]storedEntry, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("talk: open log: %w", err)
	}
	defer func() { _ = file.Close() }()

	lines := []storedEntry{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	malformedAt := -1
	malformedLost := false
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		if malformedAt >= 0 {
			return nil, fmt.Errorf("talk: corrupt log %s: unreadable line %d is not the tail", path, malformedAt)
		}
		var line storedEntry
		if err := json.Unmarshal([]byte(text), &line); err != nil {
			malformedAt = lineNo
			// An interrupted append leaves a PREFIX of the JSON being
			// written. NUL bytes are not a prefix of anything this store
			// writes: they are what a record looks like when its bytes were
			// lost. Reading that as "the tail did not finish" would report a
			// conversation whose log was lost as an empty one — the quietest
			// possible way to lose a transcript.
			malformedLost = holdsNUL(text)
			continue
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("talk: read log %s: %w", path, err)
	}
	if malformedLost {
		return nil, fmt.Errorf("talk: corrupt log %s: line %d holds NUL bytes — its contents were lost, not half-written", path, malformedAt)
	}
	return lines, nil
}

func appendLine(path string, line storedEntry) error {
	payload, err := json.Marshal(line)
	if err != nil {
		return fmt.Errorf("talk: encode entry: %w", err)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("talk: open log for append: %w", err)
	}
	defer func() { _ = file.Close() }()
	if _, err := file.Write(append(payload, '\n')); err != nil {
		return fmt.Errorf("talk: append entry: %w", err)
	}
	// This returning nil is what tells the caller its message was accepted,
	// and the caller says so to a person. Without the flush that promise
	// outruns the disk by however long the page cache feels like.
	return syncFile(file, path)
}

func newConversationID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("talk: conversation id: %w", err)
	}
	return "cv-" + hex.EncodeToString(buf), nil
}
