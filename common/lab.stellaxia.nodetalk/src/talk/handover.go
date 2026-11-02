package talk

import (
	"errors"
	"fmt"
	"path/filepath"
	"time"
)

// Main handover and membership (plan §3 M3, idea doc §5). The main is the
// ordering-and-retention authority, never the write authority (D-1) — so a
// handover moves three powers (membership, deletion, epoch) and not one line
// of transcript. The four-step dance of §5.3 collapses tightly here:
//
//	① catch-up   — the claimant pulled until its marks cover the main's (M2)
//	② freeze     — this store's mutex: ordering is deterministic (lamport,
//	               author), so the only authority a claim must not race is
//	               membership/deletion, and those serialize on the same lock
//	③ epoch++    — ClaimMain, below, verifies and increments atomically
//	④ announce   — the raised epoch travels by adoption (M2 sync) and the
//	               local hub gets a main-changed event immediately
var (
	// ErrNotMain is returned when a main-only action is asked of a backup.
	ErrNotMain = errors.New("talk: this node is not the conversation's main")
	// ErrCatchUpIncomplete is returned when a claimant's marks do not cover the
	// main's — promotion before catch-up is transcript truncation (§5.3).
	ErrCatchUpIncomplete = errors.New("talk: claimant has not caught up")
	// ErrHandoverSuppressed is returned inside the post-handover hysteresis
	// window — the flapping brake (§5.5).
	ErrHandoverSuppressed = errors.New("talk: handover suppressed by hysteresis")

	// ErrMainLeaseLapsed: this node is still recorded as main, but no member
	// has reached it for longer than the lease, so it has stood down from the
	// decisions that need a single decider (lease.go, D-10).
	ErrMainLeaseLapsed = errors.New("talk: the main lease has lapsed")

	// ErrNotHighestRanked: some other active member outranks this one and is
	// the node that may promote itself. Exactly one node can, or a partition
	// promotes two.
	ErrNotHighestRanked = errors.New("talk: another active member outranks this node")
	// ErrMemberNotFound is returned when the addressed member is not in the
	// conversation.
	ErrMemberNotFound = errors.New("talk: member not found")
)

// HandoverResult is a successful claim's answer.
type HandoverResult struct {
	Epoch            int
	MainNodeID       string
	PreviousMainName string
}

// activeRank reports node's rank among ACTIVE members, or ok=false.
func activeRank(meta storedMeta, node string) (int, bool) {
	for _, member := range meta.Members {
		if member.NodeID == node && member.State == MemberActive {
			return member.Rank, true
		}
	}
	return 0, false
}

// ClaimMain runs ON THE CURRENT MAIN: the claimant asked this node to hand
// over. Refusals, in the order they are checked:
//   - not the main here → ErrNotMain (the claimant addressed the wrong node)
//   - claimant not an active member, or not outranking the current main →
//     ErrInvalid (rank is D-2's explicit order; a lower-priority node has no
//     claim while the main lives — forced demotion is M5's fault knob)
//   - claimedEpoch != current+1 → ErrEpochStale (a stale or skipping claim)
//   - inside the hysteresis window → ErrHandoverSuppressed
//   - claimant's marks do not cover ours → ErrCatchUpIncomplete, with the
//     first uncovered author named — the claimant knows what to pull
func (s *Store) ClaimMain(id, claimant string, claimedEpoch int, claimantMarks map[string]int, hysteresis time.Duration) (HandoverResult, error) {
	if !ValidNodeID(claimant) {
		return HandoverResult{}, fmt.Errorf("%w: claimant %q", ErrInvalid, claimant)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return HandoverResult{}, err
	}
	selfID := s.self()
	if meta.MainNodeID != selfID {
		return HandoverResult{}, fmt.Errorf("%w: main is %s", ErrNotMain, meta.MainNodeID)
	}
	claimantRank, isMember := activeRank(meta, claimant)
	if !isMember {
		return HandoverResult{}, fmt.Errorf("%w: claimant %s is not an active member", ErrInvalid, claimant)
	}
	mainRank, _ := activeRank(meta, selfID)
	if claimantRank >= mainRank {
		return HandoverResult{}, fmt.Errorf("%w: claimant rank %d does not outrank main rank %d",
			ErrInvalid, claimantRank, mainRank)
	}
	if claimedEpoch != meta.Epoch+1 {
		return HandoverResult{}, fmt.Errorf("%w: claimed %d, current %d", ErrEpochStale, claimedEpoch, meta.Epoch)
	}
	if hysteresis > 0 && meta.LastHandoverMs > 0 {
		since := time.Since(time.UnixMilli(meta.LastHandoverMs))
		if since < hysteresis {
			return HandoverResult{}, fmt.Errorf("%w: %s of %s elapsed", ErrHandoverSuppressed, since.Round(time.Millisecond), hysteresis)
		}
	}
	// The catch-up proof (§5.3's invariant): every author WE hold, the
	// claimant holds at least as far. Without this, promotion truncates.
	mine, err := s.watermarksLocked(id)
	if err != nil {
		return HandoverResult{}, err
	}
	for author, seq := range mine {
		if claimantMarks[author] < seq {
			return HandoverResult{}, fmt.Errorf("%w: author %s at %d, claimant holds %d",
				ErrCatchUpIncomplete, author, seq, claimantMarks[author])
		}
	}

	previous := meta.MainNodeID
	meta.Epoch++
	meta.MainNodeID = claimant
	meta.LastHandoverMs = time.Now().UnixMilli()
	if err := s.saveMetaLocked(meta); err != nil {
		return HandoverResult{}, err
	}
	epoch := meta.Epoch
	s.publishLocked(id, StreamEvent{Event: "main-changed", MainNodeID: claimant, Epoch: &epoch})
	return HandoverResult{Epoch: meta.Epoch, MainNodeID: claimant, PreviousMainName: previous}, nil
}

// AddMember invites a node (main only). rank nil appends at the end; an
// explicit rank inserts there and shifts the actives at or below it down. A
// previously removed member is re-activated. The change is recorded as a
// member-added entry in the main's own log — same merge rules as any line.
func (s *Store) AddMember(id, node string, rank *int) (Member, Entry, error) {
	if !ValidNodeID(node) {
		return Member{}, Entry{}, fmt.Errorf("%w: member node id %q", ErrInvalid, node)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return Member{}, Entry{}, err
	}
	selfID := s.self()
	if meta.MainNodeID != selfID {
		return Member{}, Entry{}, fmt.Errorf("%w: main is %s", ErrNotMain, meta.MainNodeID)
	}
	// Only ADDING is gated. Two mains adding different members at different
	// ranks produce two different rooms; two mains removing, or deleting,
	// converge on the smaller one.
	//
	// And the asymmetry is what leaves an operator a way out. A main whose only
	// other member is a node that will never exist would otherwise be locked out
	// of its own conversation forever: unable to remove the member that stopped
	// the lease from renewing, unable to delete the room, unable to do anything
	// but talk into it. Losing a room to a partition is recoverable. Losing the
	// ability to clean one up is not.
	if err := s.requireMainLeaseLocked(id); err != nil {
		return Member{}, Entry{}, err
	}
	if _, active := activeRank(meta, node); active {
		return Member{}, Entry{}, fmt.Errorf("%w: %s is already an active member", ErrInvalid, node)
	}

	maxRank := -1
	for _, member := range meta.Members {
		if member.State == MemberActive && member.Rank > maxRank {
			maxRank = member.Rank
		}
	}
	newRank := maxRank + 1
	if rank != nil {
		if *rank < 0 {
			return Member{}, Entry{}, fmt.Errorf("%w: rank must be ≥ 0", ErrInvalid)
		}
		newRank = *rank
		if newRank > maxRank+1 {
			newRank = maxRank + 1
		}
		for i := range meta.Members {
			if meta.Members[i].State == MemberActive && meta.Members[i].Rank >= newRank {
				meta.Members[i].Rank++
			}
		}
	}

	added := Member{NodeID: node, Rank: newRank, State: MemberActive, JoinedEpoch: meta.Epoch}
	reactivated := false
	for i := range meta.Members {
		if meta.Members[i].NodeID == node {
			meta.Members[i] = added
			reactivated = true
			break
		}
	}
	if !reactivated {
		meta.Members = append(meta.Members, added)
	}
	// The membership moved, so the clock a peer compares against moves with it.
	meta.MembersRev++
	if err := s.saveMetaLocked(meta); err != nil {
		return Member{}, Entry{}, err
	}
	entry, err := s.appendMembershipEntryLocked(id, meta, KindMemberAdded, node)
	if err != nil {
		return Member{}, Entry{}, err
	}
	return added, entry, nil
}

// RemoveMember removes a node (main only). The main cannot remove itself —
// handing over first is the claim's job. The member's log files stay on disk:
// history is not rewritten, the member simply stops being one.
func (s *Store) RemoveMember(id, node string) (Member, Entry, error) {
	if !ValidNodeID(node) {
		return Member{}, Entry{}, fmt.Errorf("%w: member node id %q", ErrInvalid, node)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return Member{}, Entry{}, err
	}
	selfID := s.self()
	if meta.MainNodeID != selfID {
		return Member{}, Entry{}, fmt.Errorf("%w: main is %s", ErrNotMain, meta.MainNodeID)
	}
	if node == selfID {
		return Member{}, Entry{}, fmt.Errorf("%w: the main cannot remove itself — hand over first", ErrInvalid)
	}
	removed := Member{}
	found := false
	for i := range meta.Members {
		if meta.Members[i].NodeID == node && meta.Members[i].State == MemberActive {
			meta.Members[i].State = MemberRemoved
			removed = meta.Members[i]
			found = true
			break
		}
	}
	if !found {
		return Member{}, Entry{}, fmt.Errorf("%w: %s", ErrMemberNotFound, node)
	}
	meta.MembersRev++
	if err := s.saveMetaLocked(meta); err != nil {
		return Member{}, Entry{}, err
	}
	entry, err := s.appendMembershipEntryLocked(id, meta, KindMemberRemoved, node)
	if err != nil {
		return Member{}, Entry{}, err
	}
	return removed, entry, nil
}

// appendMembershipEntryLocked writes a membership change into the main's own
// author log — the same append discipline as a message, so the change
// replicates, merges and orders exactly like one.
func (s *Store) appendMembershipEntryLocked(id string, meta storedMeta, kind, member string) (Entry, error) {
	selfID := s.self()
	ownLog := filepath.Join(s.conversationDir(id), "log", selfID+".jsonl")
	own, err := readLog(ownLog)
	if err != nil {
		return Entry{}, err
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
		Kind:         kind,
		Lamport:      clock + 1,
		Seq:          lastSeq + 1,
		Epoch:        meta.Epoch,
		MemberNodeID: member,
		WallMs:       time.Now().UnixMilli(),
	}
	if err := appendLine(ownLog, storedEntry{Entry: entry}); err != nil {
		return Entry{}, err
	}
	s.publishLocked(id, StreamEvent{Event: "membership", Entry: &entry})
	return entry, nil
}
