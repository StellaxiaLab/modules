package talk

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Replication (plan §3 M2). The receive discipline is the storage design's
// whole point: entries merge by (author, seq) — a union with no conflicts —
// and this node only ever APPENDS to a foreign author's log, in seq order,
// never rewriting. The sender's epoch is checked against ours so an old main's
// leftovers cannot slip in after a handover (M3 raises epochs; the gate stands
// from M2).

// ErrEpochStale is returned when a replica push carries an epoch lower than
// this node's view of the conversation.
var ErrEpochStale = errors.New("talk: sender epoch is stale")

// ReplicaSlice is one replica.pull answer: entries after the cursor, this
// node's marks, and whether more remain.
type ReplicaSlice struct {
	Entries        []Entry
	Epoch          int
	HasMore        bool
	HighWaterMarks map[string]int
}

// ReadReplica serves the peer-facing pull: author's entries with seq >
// afterSeq (author empty = every author, afterSeq applied per author).
// Transport is stripped — it records how an entry reached THIS node, and the
// peer will stamp its own arrival.
func (s *Store) ReadReplica(id, author string, afterSeq, limit int) (ReplicaSlice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return ReplicaSlice{}, err
	}

	authors := []string{}
	if author != "" {
		if !ValidNodeID(author) {
			return ReplicaSlice{}, fmt.Errorf("%w: author %q", ErrInvalid, author)
		}
		authors = append(authors, author)
	} else {
		marks, err := s.watermarksLocked(id)
		if err != nil {
			return ReplicaSlice{}, err
		}
		for known := range marks {
			authors = append(authors, known)
		}
		sort.Strings(authors)
	}

	slice := ReplicaSlice{Epoch: meta.Epoch, Entries: []Entry{}}
	for _, one := range authors {
		lines, err := readLog(filepath.Join(s.conversationDir(id), "log", one+".jsonl"))
		if err != nil {
			return ReplicaSlice{}, err
		}
		for _, line := range lines {
			if line.Seq <= afterSeq {
				continue
			}
			entry := line.Entry
			entry.Transport = nil // arrival instrumentation never travels
			slice.Entries = append(slice.Entries, entry)
		}
	}
	sort.Slice(slice.Entries, func(i, j int) bool {
		if slice.Entries[i].AuthorNodeID != slice.Entries[j].AuthorNodeID {
			return slice.Entries[i].AuthorNodeID < slice.Entries[j].AuthorNodeID
		}
		return slice.Entries[i].Seq < slice.Entries[j].Seq
	})
	if limit > 0 && len(slice.Entries) > limit {
		slice.Entries = slice.Entries[:limit]
		slice.HasMore = true
	}
	marks, err := s.watermarksLocked(id)
	if err != nil {
		return ReplicaSlice{}, err
	}
	slice.HighWaterMarks = marks
	return slice, nil
}

// MergeResult reports what a merge did — duplicates are the observable proof
// of idempotency (evidence ②).
type MergeResult struct {
	Accepted       int
	Duplicates     int
	HighWaterMarks map[string]int
}

// MergeEntries transcribes a peer's entries into the foreign author logs.
// Rules, in order:
//   - senderEpoch below ours → ErrEpochStale, nothing written.
//   - an entry authored by THIS node → duplicate (our own log is the sole
//     authority on our authorship; an echo can only ever repeat it).
//   - per author, ascending seq: seq ≤ watermark → duplicate; seq ==
//     watermark+1 → accepted (transport stamped, hub notified); a gap →
//     neither — the entry is simply not accepted, the caller sees
//     accepted+duplicates < sent and pulls the hole properly. Accepting gaps
//     would break the invariant that a watermark implies completeness below it.
func (s *Store) MergeEntries(id string, entries []Entry, senderEpoch int, transport *Transport) (MergeResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return MergeResult{}, err
	}
	if senderEpoch < meta.Epoch {
		return MergeResult{}, fmt.Errorf("%w: sender %d, local %d", ErrEpochStale, senderEpoch, meta.Epoch)
	}

	selfID := s.self()
	byAuthor := map[string][]Entry{}
	order := []string{}
	result := MergeResult{}
	for _, entry := range entries {
		if !ValidNodeID(entry.AuthorNodeID) || entry.Seq < 1 {
			result.Duplicates++ // unusable line; counted, never written
			continue
		}
		if entry.AuthorNodeID == selfID {
			result.Duplicates++
			continue
		}
		if _, known := byAuthor[entry.AuthorNodeID]; !known {
			order = append(order, entry.AuthorNodeID)
		}
		byAuthor[entry.AuthorNodeID] = append(byAuthor[entry.AuthorNodeID], entry)
	}

	for _, author := range order {
		lines := byAuthor[author]
		sort.Slice(lines, func(i, j int) bool { return lines[i].Seq < lines[j].Seq })
		logPath := filepath.Join(s.conversationDir(id), "log", author+".jsonl")
		existing, err := readLog(logPath)
		if err != nil {
			return result, err
		}
		mark := 0
		if len(existing) > 0 {
			mark = existing[len(existing)-1].Seq
		}
		for _, entry := range lines {
			switch {
			case entry.Seq <= mark:
				result.Duplicates++
			case entry.Seq == mark+1:
				entry.Transport = transport
				if err := appendLine(logPath, storedEntry{Entry: entry}); err != nil {
					return result, err
				}
				mark = entry.Seq
				result.Accepted++
				published := entry
				s.publishLocked(id, StreamEvent{Event: "entry", Entry: &published})
			default:
				// gap — see the contract above.
			}
		}
	}

	marks, err := s.watermarksLocked(id)
	if err != nil {
		return result, err
	}
	result.HighWaterMarks = marks
	return result, nil
}

// AdoptConversation makes a peer-announced conversation local: unknown → the
// meta is written whole; known at a LOWER epoch → replaced (a handover
// happened while we were away); known at ours or higher → untouched. Only a
// conversation this node is an active member of may be adopted — a peer
// cannot plant transcripts on a bystander.
func (s *Store) AdoptConversation(view Conversation) (bool, error) {
	if !ValidConversationID(view.ConversationID) {
		return false, fmt.Errorf("%w: conversation id %q", ErrInvalid, view.ConversationID)
	}
	selfID := s.self()
	member := false
	for _, m := range view.Members {
		if m.NodeID == selfID && m.State == MemberActive {
			member = true
		}
		if !ValidNodeID(m.NodeID) {
			return false, fmt.Errorf("%w: member id %q", ErrInvalid, m.NodeID)
		}
	}
	if !member {
		return false, fmt.Errorf("%w: this node is not an active member of %s", ErrInvalid, view.ConversationID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.loadMetaLocked(view.ConversationID)
	if errors.Is(err, ErrDeleted) {
		// The resurrection block (§6): a peer still carrying its copy cannot
		// plant a deleted conversation back within the retention window.
		return false, ErrDeleted
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return false, err
	}
	known := err == nil
	if known {
		// Two clocks, and they answer different questions. The epoch says who
		// the main is and always wins — a view from before a handover must
		// never put the old main back. Within one epoch the main may still add
		// and remove members, and that does not touch the epoch, so a second
		// clock has to say which member list is newer.
		//
		// Without it a node kept the membership it joined with forever: a peer
		// added later was refused (guardPeer answers 404 to a non-member) and
		// silently skipped by that peer's sync loop, so the two never spoke
		// directly again and routed everything through the main instead.
		switch {
		case existing.Epoch > view.Epoch:
			return false, nil
		case existing.Epoch == view.Epoch && view.MembersRev <= existing.MembersRev:
			return false, nil
		}
	}
	meta := storedMeta{
		ConversationID: view.ConversationID,
		CreatedBy:      view.CreatedBy,
		DisplayName:    view.DisplayName,
		Epoch:          view.Epoch,
		MainNodeID:     view.MainNodeID,
		Members:        append([]Member(nil), view.Members...),
		MembersRev:     view.MembersRev,
	}
	if known {
		// Local bookkeeping the peer's view cannot carry survives adoption:
		// the create-idempotency key, and this node's own handover pacing.
		meta.CreateKey = existing.CreateKey
		meta.LastHandoverMs = existing.LastHandoverMs
	}
	// A promotion lands HERE for the new main — adopting a higher epoch that
	// names this node opens its hysteresis window now (§5.5): the claims it
	// will be asked to judge are paced from the moment it took the seat.
	if view.MainNodeID == selfID && (!known || existing.MainNodeID != selfID) {
		meta.LastHandoverMs = time.Now().UnixMilli()
	}
	if err := os.MkdirAll(filepath.Join(s.conversationDir(meta.ConversationID), "log"), 0o755); err != nil {
		return false, fmt.Errorf("talk: create adopted conversation dir: %w", err)
	}
	if err := s.saveMetaLocked(meta); err != nil {
		return false, err
	}
	return true, nil
}

// ---- peer cursor: what the peers were last seen holding ---------------------

// cursorDocument is cursor.json — per peer, the author marks that peer
// reported. It is knowledge ABOUT others; this node's own marks derive from
// its logs and are never stored.
type cursorDocument struct {
	Peers map[string]map[string]int `json:"peers"`
}

// UpdatePeerMarks records what peer reported holding (its high_water_marks).
func (s *Store) UpdatePeerMarks(id, peer string, marks map[string]int) error {
	if !ValidNodeID(peer) {
		return fmt.Errorf("%w: peer %q", ErrInvalid, peer)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadMetaLocked(id); err != nil {
		return err
	}
	document, err := s.loadCursorLocked(id)
	if err != nil {
		return err
	}
	if document.Peers == nil {
		document.Peers = map[string]map[string]int{}
	}
	document.Peers[peer] = marks
	return s.saveCursorLocked(id, document)
}

// Behind reports how many entries peers hold that this node does not: per
// author, the highest seq any peer reported minus ours, summed. Zero when no
// peer has reported yet — "known missing: none".
//
// lostOwn is the part of that total this node WROTE ITSELF, and it is reported
// separately because replication will never close it. A node is the authority
// on its own log and refuses its own lines back from a peer (MergeEntries), so
// a node that lost its data — a moved directory, a wiped disk — sees a hole
// where its own words were, forever, while every peer still has them.
//
// Saying so is the whole point. A "behind 3" that never becomes 0 and never
// explains itself is worse than a hole, because it looks like a sync that is
// still trying.
func (s *Store) Behind(id string) (behind, lostOwn int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadMetaLocked(id); err != nil {
		return 0, 0, err
	}
	return s.behindLocked(id)
}

func (s *Store) behindLocked(id string) (int, int, error) {
	document, err := s.loadCursorLocked(id)
	if err != nil {
		return 0, 0, err
	}
	mine, err := s.watermarksLocked(id)
	if err != nil {
		return 0, 0, err
	}
	selfID := s.self()
	best := map[string]int{}
	for _, marks := range document.Peers {
		for author, seq := range marks {
			if seq > best[author] {
				best[author] = seq
			}
		}
	}
	behind, lostOwn := 0, 0
	for author, seq := range best {
		gap := seq - mine[author]
		if gap <= 0 {
			continue
		}
		behind += gap
		if author == selfID {
			lostOwn += gap
		}
	}
	return behind, lostOwn, nil
}

// PeerMarks returns the recorded marks for one peer (nil when none).
func (s *Store) PeerMarks(id, peer string) (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadMetaLocked(id); err != nil {
		return nil, err
	}
	document, err := s.loadCursorLocked(id)
	if err != nil {
		return nil, err
	}
	return document.Peers[peer], nil
}

func (s *Store) cursorPath(id string) string {
	return filepath.Join(s.conversationDir(id), "cursor.json")
}

func (s *Store) loadCursorLocked(id string) (cursorDocument, error) {
	raw, err := os.ReadFile(s.cursorPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return cursorDocument{}, nil
	}
	if err != nil {
		return cursorDocument{}, fmt.Errorf("talk: read cursor: %w", err)
	}
	var document cursorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		// This file is knowledge ABOUT others — a cache the next sync tick
		// rebuilds from what the peers report. Refusing to answer because it
		// is unreadable costs the caller its whole conversation LIST, since
		// Behind reads this file for every row: one damaged room takes the
		// healthy ones down with it. The loss that actually happened is an
		// inaccurate "behind" count until the next tick, so that is the loss
		// this node takes.
		kept := quarantineCorruptFile(s.cursorPath(id))
		where := kept
		if where == "" {
			where = "in place (could not be moved aside)"
		}
		s.warnf("cursor for conversation %s was unreadable (%v); starting over with no peer marks, damaged file kept at %s", id, err, where)
		return cursorDocument{}, nil
	}
	return document, nil
}

// saveCursorLocked replaces cursor.json durably, same as meta.
func (s *Store) saveCursorLocked(id string, document cursorDocument) error {
	payload, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("talk: encode cursor: %w", err)
	}
	dir := s.conversationDir(id)
	return replaceFileDurable(dir, ".cursor-*.tmp", s.cursorPath(id), append(payload, '\n'))
}

// ActiveMemberPeers returns every active member of every local conversation,
// excluding this node — the sync loop's peer set.
func (s *Store) ActiveMemberPeers() ([]string, error) {
	summaries, err := s.List()
	if err != nil {
		return nil, err
	}
	selfID := s.self()
	seen := map[string]bool{}
	peers := []string{}
	for _, summary := range summaries {
		for _, member := range summary.Conversation.Members {
			if member.State != MemberActive || member.NodeID == selfID || seen[member.NodeID] {
				continue
			}
			seen[member.NodeID] = true
			peers = append(peers, member.NodeID)
		}
	}
	sort.Strings(peers)
	return peers, nil
}
