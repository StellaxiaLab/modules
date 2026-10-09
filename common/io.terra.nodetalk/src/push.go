package main

import (
	"context"
	"encoding/json"
	"net/url"
	"time"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
)

// Immediate delivery (chat-room design §1). Replication's correctness lives in
// the pull loop: peers ask for what they are missing, merges are idempotent by
// (author, seq) and refuse gaps. That is exactly right and exactly too slow to
// talk over — a peer learns of a message on its next tick, which is seconds
// away.
//
// So the author also PUSHES, the moment it appends: one door hop into each
// active member's replica.push. The relationship is the same one the local SSE
// hub has with the transcript on disk — the store is the truth, the push is
// only the nudge that arrives sooner:
//
//   - Best effort. A failed push is a log line; the append already succeeded
//     and must never be blocked by reachability (D-1).
//   - Gap safe. A peer that is behind refuses the pushed entry (seq is not
//     watermark+1) and its own pull fills the hole properly.
//   - Duplicate safe. Push and pull carrying the same entry answer duplicates
//     the second time.
//
// Nothing on the receiving side changed to make this work.

// pushFanOutLimit bounds one append's fan-out (D-14). Beyond it the push is
// skipped entirely and the pull loop carries the conversation — a room that
// large is not what this bench is for, and quietly hammering the door would
// hide that fact rather than state it.
const pushFanOutLimit = 32

// pushTimeout bounds one peer's push. It is short on purpose: this is the
// latency path, and a peer that cannot answer quickly is a peer the pull loop
// should be handling instead.
const pushTimeout = 5 * time.Second

// fanOutEntry delivers one just-appended entry to every other active member.
// It returns immediately; the pushes run on their own goroutines with their
// own context, because the caller's request context dies with its response.
func (s *apiServer) fanOutEntry(conversationID string, entry talk.Entry, epoch int) {
	if s.deps.Door == nil {
		return // no outbound door in this assembly; the pull loop is the only path
	}
	conversation, _, err := s.deps.Store.Get(conversationID)
	if err != nil {
		s.logger.Printf("push %s: read members: %v", conversationID, err)
		return
	}
	self := s.deps.ResolveNodeID(context.Background())
	peers := make([]string, 0, len(conversation.Members))
	for _, member := range conversation.Members {
		if member.State == talk.MemberActive && member.NodeID != self {
			peers = append(peers, member.NodeID)
		}
	}
	if len(peers) == 0 {
		return
	}
	if len(peers) > pushFanOutLimit {
		// Said out loud rather than silently degraded: the room still works,
		// it just arrives on the pull loop's schedule.
		s.logger.Printf("push %s: %d members exceeds the fan-out limit of %d — leaving delivery to the sync loop",
			conversationID, len(peers), pushFanOutLimit)
		return
	}

	body, err := json.Marshal(map[string]any{
		"entries":      []talk.Entry{entry},
		"sender_epoch": epoch,
	})
	if err != nil {
		s.logger.Printf("push %s: encode: %v", conversationID, err)
		return
	}
	path := apiPrefix + "/conversations/" + url.PathEscape(conversationID) + "/replica"
	for _, peer := range peers {
		go func(peer string) {
			ctx, cancel := context.WithTimeout(context.Background(), pushTimeout)
			defer cancel()
			if _, err := s.deps.Door(ctx, peer, "POST", path, body); err != nil {
				// Normal weather for this module: the peer may be down, cut
				// off, or behind. The pull loop is the backstop.
				s.logger.Printf("push %s to %s: %v", conversationID, peer, err)
			}
		}(peer)
	}
}
