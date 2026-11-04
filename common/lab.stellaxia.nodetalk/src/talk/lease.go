package talk

// The main's lease (D-10).
//
// Until this existed, a handover needed the LIVING main to accept it: the
// claimant asked, the main stepped down, atomically. That is safe and it is also
// a dead end — when the main dies, nobody can ask it anything, and the room
// keeps a main that will never answer again.
//
// Self-promotion is what fixes that, and the reason it was left out is that a
// partition is indistinguishable from a death. A node that promotes itself
// because "the main is gone" will do exactly the same thing when the main is
// merely unreachable, and then two nodes believe they are main at the same
// epoch.
//
// A lease closes that by making the two sides give up and take over at
// DIFFERENT times:
//
//	main:       stands down after leaseTTL of hearing from nobody
//	challenger: takes over after leaseTTL + graceMargin of reaching nobody
//
// The main has already stopped acting before anyone else starts. That is the
// whole of the safety argument, and it holds without agreement between them.
//
// **No clock is shared.** Both sides measure elapsed time on their own monotonic
// clock — "how long since anyone reached me" and "how long since I reached the
// main". Nothing compares one machine's wall clock to another's, so nothing
// breaks when they disagree about what time it is. What the argument does assume
// is that the two clocks do not RATE-drift by more than graceMargin over
// leaseTTL, which for monotonic clocks over tens of seconds is not a real risk.
//
// Standing down costs almost nothing, and that is D-1 paying off again: the main
// is the ordering and retention authority, not the write authority. A stood-down
// main still accepts messages — every member always could. It refuses only the
// two things that need a single decider: membership and deletion.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	// DefaultLeaseTTL is how long a main goes unreached before it stands down.
	// Long enough that an ordinary sync hiccup does not unseat anyone (the pull
	// loop runs every 10s), short enough that a dead main does not hold a room
	// for minutes.
	DefaultLeaseTTL = 45 * time.Second
	// DefaultLeaseGrace is how much longer a challenger waits than the main
	// does. It is the whole margin the safety argument has, so it is generous
	// relative to the drift it covers.
	DefaultLeaseGrace = 30 * time.Second
)

// SetLeaseTTL overrides how long this node may act as main unreached. A
// negative value turns the lease off entirely, for assemblies where nothing
// would ever renew it (single-node tests, benches with no sync loop) — there,
// standing down would refuse work nobody could have taken over anyway.
func (s *Store) SetLeaseTTL(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.leaseTTL = ttl
}

func (s *Store) leaseTTLLocked() time.Duration {
	if s.leaseTTL < 0 {
		return 0 // disabled
	}
	if s.leaseTTL > 0 {
		return s.leaseTTL
	}
	return DefaultLeaseTTL
}

// TouchPeerContact records that a peer reached this node about one conversation.
// This is the main's lease renewal, and it is deliberately not a message the
// main sends: being REACHED is the evidence that matters, and a main that could
// only renew by talking would keep its lease while shouting into a dead network.
func (s *Store) TouchPeerContact(id string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touchPeerContactLocked(id)
}

// contactLocked answers when a peer last reached this node about a
// conversation, from memory or from disk.
//
// It has to survive a restart. A node that was reached five minutes ago and then
// rebooted has still been out of touch for five minutes, and a challenger that
// synced before the reboot still holds the catch-up proof that lets it promote.
// Forgetting on restart would let a main come back believing nobody could
// challenge it, at exactly the moment somebody could.
func (s *Store) contactLocked(id string) (time.Time, bool) {
	if s.peerContact == nil {
		s.peerContact = map[string]time.Time{}
	}
	if last, known := s.peerContact[id]; known {
		return last, true
	}
	raw, err := os.ReadFile(s.leasePath(id))
	if err != nil {
		return time.Time{}, false
	}
	var document struct {
		LastContactS int64 `json:"last_contact_s"`
	}
	if json.Unmarshal(raw, &document) != nil || document.LastContactS <= 0 {
		return time.Time{}, false
	}
	last := time.Unix(document.LastContactS, 0)
	s.peerContact[id] = last
	return last, true
}

func (s *Store) leasePath(id string) string {
	return filepath.Join(s.conversationDir(id), "lease.json")
}

// leaseWriteInterval throttles the disk write. Contact happens on every peer
// pull — every ten seconds per peer — and the value only has to be accurate to
// well within the lease window.
const leaseWriteInterval = DefaultLeaseTTL / 4

func (s *Store) touchPeerContactLocked(id string) {
	if id == "" {
		return
	}
	previous, known := s.contactLocked(id)
	now := time.Now()
	s.peerContact[id] = now
	if known && now.Sub(previous) < leaseWriteInterval {
		return
	}
	encoded, err := json.Marshal(map[string]int64{"last_contact_s": now.Unix()})
	if err != nil {
		return
	}
	// Best effort: a lease record that cannot be written costs a restarted main
	// one fresh window, which the next contact closes. Failing the request the
	// peer was actually making would cost more.
	_ = os.WriteFile(s.leasePath(id), encoded, 0o600)
}

// MainLeaseHeld reports whether this node may still act as main of a
// conversation, and seeds the clock the first time it is asked.
//
// A conversation with no other active member needs no lease: there is nobody to
// be reached by and nobody to take over. Holding a room of one to a lease would
// stop its owner from inviting anyone into it, which is the one thing that
// would let the lease ever matter.
func (s *Store) MainLeaseHeld(id string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mainLeaseHeldLocked(id, ttl)
}

func (s *Store) mainLeaseHeldLocked(id string, ttl time.Duration) (bool, error) {
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return false, err
	}
	if ttl <= 0 || meta.MainNodeID != s.self() {
		return true, nil
	}
	others := 0
	for _, member := range meta.Members {
		if member.State == MemberActive && member.NodeID != s.self() {
			others++
		}
	}
	if others == 0 {
		return true, nil
	}
	if s.peerContact == nil {
		s.peerContact = map[string]time.Time{}
	}
	// No contact ever recorded means NO CHALLENGER CAN EXIST, so there is
	// nothing for standing down to protect. A node can only promote itself over
	// a main it has synced with — that is where its catch-up proof comes from —
	// and syncing with a main is reaching it, which is what would have been
	// recorded here.
	//
	// Getting this wrong is what broke a live room: the clock used to start when
	// the seat was taken, so a main whose only other member was a node that
	// never existed stood down after 45 seconds and could no longer manage its
	// own conversation. It had lost a race nobody was running.
	last, seen := s.contactLocked(id)
	if !seen {
		return true, nil
	}
	return time.Since(last) < ttl, nil
}

// requireMainLeaseLocked is the guard the main-only operations share.
func (s *Store) requireMainLeaseLocked(id string) error {
	ttl := s.leaseTTLLocked()
	held, err := s.mainLeaseHeldLocked(id, ttl)
	if err != nil {
		return err
	}
	if !held {
		return fmt.Errorf("%w: no member has reached this node for %s", ErrMainLeaseLapsed, ttl)
	}
	return nil
}

// PromoteSelf takes the main seat without asking, which is only legitimate when
// the incumbent has already given it up.
//
// The caller establishes that by not having reached the main for longer than the
// main's own lease plus the grace margin (sync.go). Everything else is checked
// here, and the checks are the same ones a cooperative claim passes — being
// unable to ask does not lower the bar for taking over:
//
//   - the claimant is an active member and outranks the incumbent
//   - and outranks every OTHER active member, so exactly one node can do this.
//     If a higher-ranked member is down too, nobody promotes until it returns.
//     That is a real availability limit, taken deliberately: a rule that lets
//     the second-ranked node promote when the first is merely quiet is a rule
//     that promotes two nodes in a three-way partition.
//   - it holds everything the main was last known to hold. Lines the main wrote
//     after that are not lost — per-author logs merge when it returns — but a
//     promotion that skipped known lines would reorder the transcript.
func (s *Store) PromoteSelf(id string, lastKnownMainMarks map[string]int, hysteresis time.Duration) (HandoverResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.loadMetaLocked(id)
	if err != nil {
		return HandoverResult{}, err
	}
	selfID := s.self()
	if meta.MainNodeID == selfID {
		return HandoverResult{}, fmt.Errorf("%w: already main", ErrInvalid)
	}
	selfRank, isMember := activeRank(meta, selfID)
	if !isMember {
		return HandoverResult{}, fmt.Errorf("%w: not an active member", ErrInvalid)
	}
	mainRank, mainActive := activeRank(meta, meta.MainNodeID)
	if mainActive && selfRank >= mainRank {
		return HandoverResult{}, fmt.Errorf("%w: rank %d does not outrank main rank %d",
			ErrInvalid, selfRank, mainRank)
	}
	for _, member := range meta.Members {
		if member.State != MemberActive || member.NodeID == selfID || member.NodeID == meta.MainNodeID {
			continue
		}
		if member.Rank < selfRank {
			return HandoverResult{}, fmt.Errorf("%w: %s outranks this node and may promote instead",
				ErrNotHighestRanked, member.NodeID)
		}
	}
	if hysteresis > 0 && meta.LastHandoverMs > 0 {
		if since := time.Since(time.UnixMilli(meta.LastHandoverMs)); since < hysteresis {
			return HandoverResult{}, fmt.Errorf("%w: %s of %s elapsed",
				ErrHandoverSuppressed, since.Round(time.Millisecond), hysteresis)
		}
	}
	mine, err := s.watermarksLocked(id)
	if err != nil {
		return HandoverResult{}, err
	}
	for author, seq := range lastKnownMainMarks {
		if mine[author] < seq {
			return HandoverResult{}, fmt.Errorf("%w: author %s at %d, this node holds %d",
				ErrCatchUpIncomplete, author, seq, mine[author])
		}
	}

	previous := meta.MainNodeID
	meta.Epoch++
	meta.MainNodeID = selfID
	meta.LastHandoverMs = time.Now().UnixMilli()
	if err := s.saveMetaLocked(meta); err != nil {
		return HandoverResult{}, err
	}
	// The new main starts its own lease now rather than inheriting a clock that
	// has already run out — otherwise it would stand down the instant it stood up.
	if s.peerContact == nil {
		s.peerContact = map[string]time.Time{}
	}
	s.peerContact[id] = time.Now()

	epoch := meta.Epoch
	s.publishLocked(id, StreamEvent{Event: "main-changed", MainNodeID: selfID, Epoch: &epoch})
	return HandoverResult{Epoch: meta.Epoch, MainNodeID: selfID, PreviousMainName: previous}, nil
}
