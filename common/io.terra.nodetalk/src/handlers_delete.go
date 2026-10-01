package main

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// conversationsDelete answers io.terra.nodetalk.conversations.delete — the
// replicated intent of §6, on either of its two legs:
//
//   - relayed leg (door principal present): a member receives the recorded
//     main's intent. AcceptDeletion verifies the origin IS the recorded main —
//     a stale ex-main's deletion bounces exactly like its pushes do.
//   - issuing leg (no door principal): the main deletes locally (tombstone
//     first, then the one directory — messages go with it), then fans the
//     intent out to every active member and reports, honestly, who confirmed
//     and who could not be reached. The unreachable learn later, from their
//     own sync loop's 410 discovery.
func (s *apiServer) conversationsDelete(w http.ResponseWriter, r *http.Request) {
	id, resolveErr := s.conversationFrom(r, false)
	if resolveErr != nil {
		s.writeStoreError(w, r, resolveErr)
		return
	}

	if principal := r.Header.Get("X-Terra-Principal"); strings.HasPrefix(principal, peerPrincipalPrefix) {
		origin := strings.TrimPrefix(principal, peerPrincipalPrefix)
		tombstone, err := s.deps.Store.AcceptDeletion(id, origin)
		if err != nil {
			s.writeHandoverError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"acknowledged_by":  []string{s.deps.ResolveNodeID(r.Context())},
			"deleted_at_epoch": tombstone.DeletedAtEpoch,
			"pending_nodes":    []string{},
		})
		return
	}

	tombstone, peers, err := s.deps.Store.DeleteAsMain(id)
	if err != nil {
		s.writeHandoverError(w, r, err)
		return
	}
	selfID := s.deps.ResolveNodeID(r.Context())
	acknowledged := []string{selfID}
	pending := []string{}
	for _, peer := range peers {
		if s.deps.Door == nil {
			pending = append(pending, peer) // no door in this assembly — honest
			continue
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		_, doorErr := s.deps.Door(ctx, peer, "DELETE",
			apiPrefix+"/conversations/"+url.PathEscape(id), nil)
		cancel()
		if doorErr != nil {
			pending = append(pending, peer)
			continue
		}
		acknowledged = append(acknowledged, peer)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"acknowledged_by":  acknowledged,
		"deleted_at_epoch": tombstone.DeletedAtEpoch,
		"pending_nodes":    pending,
	})
}
