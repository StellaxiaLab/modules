package main

import (
	"errors"
	"net/http"
	"strings"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
)

// peerPrincipalPrefix is how the door's relay stamps a peer module instance
// (modulecatalog.PeerModulePrincipal): "module:<module-id>@<origin-node>".
const peerPrincipalPrefix = "module:io.terra.nodetalk@"

// writeHandoverError maps the M3 sentinels onto the contract's codes before
// falling back to the shared mapping.
func (s *apiServer) writeHandoverError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, talk.ErrNotMain):
		writeAPIError(w, http.StatusConflict, "NOT_MAIN", err.Error())
	case errors.Is(err, talk.ErrCatchUpIncomplete):
		writeAPIError(w, http.StatusConflict, "CATCH_UP_INCOMPLETE", err.Error())
	case errors.Is(err, talk.ErrHandoverSuppressed):
		writeAPIError(w, http.StatusConflict, "HANDOVER_SUPPRESSED", err.Error())
	case errors.Is(err, talk.ErrEpochStale):
		writeAPIError(w, http.StatusConflict, "EPOCH_STALE", err.Error())
	case errors.Is(err, talk.ErrMemberNotFound):
		writeAPIError(w, http.StatusNotFound, "MEMBER_NOT_FOUND", err.Error())
	default:
		s.writeStoreError(w, r, err)
	}
}

// mainClaim answers io.terra.nodetalk.main.claim — step ③ of the handover,
// running on the current main. When the call arrived through the peer door,
// the Master-stamped principal names the origin node; a claim whose body
// contradicts that verified identity is refused before the store sees it.
func (s *apiServer) mainClaim(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClaimantNodeID string         `json:"claimant_node_id"`
		ClaimedEpoch   *int           `json:"claimed_epoch"`
		HighWaterMarks map[string]int `json:"high_water_marks"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ClaimantNodeID == "" || body.ClaimedEpoch == nil || body.HighWaterMarks == nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST",
			"claimant_node_id, claimed_epoch, high_water_marks가 모두 필요하다")
		return
	}
	if principal := r.Header.Get("X-Terra-Principal"); strings.HasPrefix(principal, peerPrincipalPrefix) {
		if origin := strings.TrimPrefix(principal, peerPrincipalPrefix); origin != body.ClaimantNodeID {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST",
				"claimant_node_id가 검증된 origin("+origin+")과 다르다")
			return
		}
	}

	hysteresis := s.deps.HandoverHysteresis
	if override, overridden := s.deps.Faults.hysteresisOverride(); overridden {
		hysteresis = override
	}
	result, err := s.deps.Store.ClaimMain(r.PathValue("conversation_id"),
		body.ClaimantNodeID, *body.ClaimedEpoch, body.HighWaterMarks, hysteresis)
	if err != nil {
		s.writeHandoverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"epoch":                 result.Epoch,
		"main_node_id":          result.MainNodeID,
		"previous_main_node_id": result.PreviousMainName,
	})
}

// membersAdd / membersRemove — main-only membership changes, recorded as log
// entries so they replicate exactly like messages.
func (s *apiServer) membersAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NodeID             string `json:"node_id"`
		Rank               *int   `json:"rank"`
		NodeByName         bool   `json:"node_by_name"`
		ConversationByName bool   `json:"conversation_by_name"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	conversationID, err := s.conversationFrom(r, body.ConversationByName)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// The node has to be something this module can show is real. Until this
	// check, a display name typed where an id belongs passed every test — the
	// shape matches — and joined a room as a member that would never arrive.
	nodeID, err := s.resolveNode(r.Context(), body.NodeID, body.NodeByName)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	member, entry, err := s.deps.Store.AddMember(conversationID, nodeID, body.Rank)
	if err != nil {
		s.writeHandoverError(w, r, err)
		return
	}
	// A membership change is an ordinary log entry, so it travels the ordinary
	// way — including the immediate hop.
	s.fanOutEntry(conversationID, entry, entry.Epoch)
	writeJSON(w, http.StatusCreated, map[string]any{"member": member})
}

func (s *apiServer) membersRemove(w http.ResponseWriter, r *http.Request) {
	conversationID, err := s.conversationFrom(r, false)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// Removal resolves a name but does NOT require the node to answer. A member
	// that cannot be reached is the main reason to remove one, and demanding it
	// prove itself first would lock the room in the state being cleaned up.
	nodeID, resolveErr := s.nodeReference(r.PathValue("node_id"),
		s.deps.ResolveNodeID(r.Context()), r.URL.Query().Get("node_by_name") == "true")
	if resolveErr != nil {
		s.writeStoreError(w, r, resolveErr)
		return
	}
	member, entry, err := s.deps.Store.RemoveMember(conversationID, nodeID)
	if err != nil {
		s.writeHandoverError(w, r, err)
		return
	}
	s.fanOutEntry(conversationID, entry, entry.Epoch)
	writeJSON(w, http.StatusOK, map[string]any{"member": member})
}
