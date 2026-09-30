package talk

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Deletion (plan §3 M4, idea doc §6): deleting a conversation is not a local
// act but a replicated INTENT. Locally it is one directory — removing
// conversations/<id>/ takes the messages with it, which is the original
// requirement ("세션이 지워지면 메시지도 자동 삭제") — but a tombstone stays
// behind for the retention window (D-4: 30 days), because a member that was
// offline at deletion time will come back carrying its copy, and a naive
// union merge would resurrect the conversation on every screen but the
// deleter's.
//
// The documented limit stands with the window: a node offline LONGER than the
// retention window can resurrect — infinite retention is not the answer, and
// the UI says so rather than hiding it.

// ErrDeleted marks a conversation that is gone but remembered: operations
// against it answer the contract's CONVERSATION_DELETED (410), which is what
// blocks resurrection — a peer holding a stale copy learns the difference
// between "never existed here" (404) and "deleted, do not bring it back".
var ErrDeleted = errors.New("talk: conversation is deleted (tombstoned)")

// DefaultTombstoneTTL is D-4's decided retention window.
const DefaultTombstoneTTL = 30 * 24 * time.Hour

// Tombstone records one deletion.
type Tombstone struct {
	ConversationID string `json:"conversation_id"`
	DeletedAtEpoch int    `json:"deleted_at_epoch"`
	ByNode         string `json:"by_node"`
	DeletedAtMs    int64  `json:"deleted_at_ms"`
}

// SetTombstoneTTL overrides the retention window (bench and expiry tests; the
// default is D-4's 30 days).
func (s *Store) SetTombstoneTTL(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tombstoneTTL = ttl
}

func (s *Store) tombstonePath() string {
	return filepath.Join(s.root, "tombstones.jsonl")
}

func (s *Store) ttlLocked() time.Duration {
	if s.tombstoneTTL > 0 {
		return s.tombstoneTTL
	}
	return DefaultTombstoneTTL
}

// loadTombstonesLocked reads the live (unexpired) tombstones. Expired lines
// are dropped on read; compaction happens on the next write.
func (s *Store) loadTombstonesLocked() (map[string]Tombstone, error) {
	raw, err := os.ReadFile(s.tombstonePath())
	if errors.Is(err, os.ErrNotExist) {
		return map[string]Tombstone{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("talk: read tombstones: %w", err)
	}
	cutoff := time.Now().Add(-s.ttlLocked()).UnixMilli()
	live := map[string]Tombstone{}
	for _, line := range splitLines(raw) {
		var tombstone Tombstone
		if json.Unmarshal(line, &tombstone) != nil {
			continue // a torn tail line, same tolerance as the logs
		}
		if tombstone.DeletedAtMs >= cutoff {
			live[tombstone.ConversationID] = tombstone
		}
	}
	return live, nil
}

// writeTombstoneLocked appends one tombstone, compacting expired lines away.
func (s *Store) writeTombstoneLocked(tombstone Tombstone) error {
	live, err := s.loadTombstonesLocked()
	if err != nil {
		return err
	}
	live[tombstone.ConversationID] = tombstone
	payload := []byte{}
	for _, one := range live {
		line, err := json.Marshal(one)
		if err != nil {
			return fmt.Errorf("talk: encode tombstone: %w", err)
		}
		payload = append(payload, line...)
		payload = append(payload, '\n')
	}
	return replaceFileDurable(s.root, ".tombstones-*.tmp", s.tombstonePath(), payload)
}

// IsDeleted reports whether id is tombstoned within the retention window.
func (s *Store) IsDeleted(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	live, err := s.loadTombstonesLocked()
	if err != nil {
		return false, err
	}
	_, deleted := live[id]
	return deleted, nil
}

// DeleteAsMain executes the deletion intent on the issuing node: main-only,
// tombstone first, then the directory — the messages go with it. Deleting an
// already-tombstoned conversation answers the recorded receipt (the operation
// is idempotent per its contract).
func (s *Store) DeleteAsMain(id string) (Tombstone, []string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if errors.Is(err, ErrDeleted) {
		// Idempotent: a second delete answers the recorded receipt.
		live, loadErr := s.loadTombstonesLocked()
		if loadErr != nil {
			return Tombstone{}, nil, loadErr
		}
		return live[id], nil, nil
	}
	if err != nil {
		return Tombstone{}, nil, err
	}
	selfID := s.self()
	if meta.MainNodeID != selfID {
		return Tombstone{}, nil, fmt.Errorf("%w: main is %s", ErrNotMain, meta.MainNodeID)
	}
	peers := []string{}
	for _, member := range meta.Members {
		if member.State == MemberActive && member.NodeID != selfID {
			peers = append(peers, member.NodeID)
		}
	}
	tombstone := Tombstone{
		ConversationID: id,
		DeletedAtEpoch: meta.Epoch,
		ByNode:         selfID,
		DeletedAtMs:    time.Now().UnixMilli(),
	}
	if err := s.removeWithTombstoneLocked(id, tombstone); err != nil {
		return Tombstone{}, nil, err
	}
	return tombstone, peers, nil
}

// AcceptDeletion executes a RELAYED deletion intent: fromNode must be the
// main this node has on record — a stale ex-main's deletion bounces off the
// epoch history the same way its pushes do (its identity is no longer the
// recorded main after a handover). Idempotent like the main's own path.
func (s *Store) AcceptDeletion(id, fromNode string) (Tombstone, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if errors.Is(err, ErrDeleted) {
		live, loadErr := s.loadTombstonesLocked()
		if loadErr != nil {
			return Tombstone{}, loadErr
		}
		return live[id], nil
	}
	if err != nil {
		return Tombstone{}, err
	}
	if meta.MainNodeID != fromNode {
		return Tombstone{}, fmt.Errorf("%w: deletion from %s, recorded main is %s", ErrNotMain, fromNode, meta.MainNodeID)
	}
	tombstone := Tombstone{
		ConversationID: id,
		DeletedAtEpoch: meta.Epoch,
		ByNode:         fromNode,
		DeletedAtMs:    time.Now().UnixMilli(),
	}
	if err := s.removeWithTombstoneLocked(id, tombstone); err != nil {
		return Tombstone{}, err
	}
	return tombstone, nil
}

// removeWithTombstoneLocked is the shared teardown: tombstone durable FIRST
// (a crash between the two steps must err toward "deleted"), then the local
// subscribers hear about it, then the directory goes.
func (s *Store) removeWithTombstoneLocked(id string, tombstone Tombstone) error {
	if err := s.writeTombstoneLocked(tombstone); err != nil {
		return err
	}
	epoch := tombstone.DeletedAtEpoch
	s.publishLocked(id, StreamEvent{Event: "deleted", Epoch: &epoch})
	if err := os.RemoveAll(s.conversationDir(id)); err != nil {
		return fmt.Errorf("talk: remove conversation dir: %w", err)
	}
	return nil
}

// splitLines yields the non-empty lines of raw.
func splitLines(raw []byte) [][]byte {
	lines := [][]byte{}
	start := 0
	for i := 0; i <= len(raw); i++ {
		if i == len(raw) || raw[i] == '\n' {
			line := raw[start:i]
			if len(line) > 0 {
				lines = append(lines, line)
			}
			start = i + 1
		}
	}
	return lines
}
