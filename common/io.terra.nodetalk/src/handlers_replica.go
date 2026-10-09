package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
)

// replicaPull serves the peer-facing sync window (contract: replica.pull).
// Resumable and idempotent by construction: "author X after seq N" is the
// whole request, and re-reading a range answers the same lines.
func (s *apiServer) replicaPull(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	afterSeq := 0
	if raw := query.Get("after_seq"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "after_seq는 0 이상의 정수여야 한다")
			return
		}
		afterSeq = parsed
	}
	limit := 500
	if raw := query.Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 1000 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "limit은 1..1000이어야 한다")
			return
		}
		limit = parsed
	}
	slice, err := s.deps.Store.ReadReplica(r.PathValue("conversation_id"), query.Get("author_node_id"), afterSeq, limit)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries":          slice.Entries,
		"epoch":            slice.Epoch,
		"has_more":         slice.HasMore,
		"high_water_marks": slice.HighWaterMarks,
	})
}

// replicaPush transcribes a peer's entries (contract: replica.push). The
// response's duplicates count is the observable proof of idempotency — a
// re-sent slice answers duplicates, never double lines.
func (s *apiServer) replicaPush(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Entries     []talk.Entry `json:"entries"`
		SenderEpoch *int         `json:"sender_epoch"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Entries) == 0 || len(body.Entries) > 1000 || body.SenderEpoch == nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "entries(1..1000)와 sender_epoch가 필요하다")
		return
	}
	// A push carries what the pushing node itself just wrote (push.go). An entry
	// attributed to a THIRD node therefore did not come from its author, and
	// merging it would let one member write in another member's name — which the
	// per-author log exists precisely to make impossible.
	if origin, fromPeer := peerOrigin(r); fromPeer {
		for _, entry := range body.Entries {
			if entry.AuthorNodeID != origin {
				writeAPIError(w, http.StatusForbidden, "PEER_NOT_PERMITTED",
					"다른 노드의 이름으로 기록할 수 없다")
				return
			}
		}
	}
	// Arrival instrumentation: a push relayed through the peer door carries the
	// Master-stamped principal, which is proof it crossed L1. The duration is
	// not ours to claim — the sender measured the round trip, not us — so the
	// rung travels and the timing does not. A push with no such principal came
	// from somewhere this module cannot characterise, and is left unstamped.
	var arrival *talk.Transport
	if strings.HasPrefix(r.Header.Get("X-Terra-Principal"), peerPrincipalPrefix) {
		arrival = &talk.Transport{Rung: "L1"}
	}
	result, err := s.deps.Store.MergeEntries(r.PathValue("conversation_id"), body.Entries, *body.SenderEpoch, arrival)
	if err != nil {
		if errors.Is(err, talk.ErrEpochStale) {
			writeAPIError(w, http.StatusConflict, "EPOCH_STALE", err.Error())
			return
		}
		s.writeStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"accepted":         result.Accepted,
		"duplicates":       result.Duplicates,
		"high_water_marks": result.HighWaterMarks,
	})
}
