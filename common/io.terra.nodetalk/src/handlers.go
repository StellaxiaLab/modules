package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

// ---- status -----------------------------------------------------------------

// statusGet answers io.terra.nodetalk.status.get with facts of this build:
// real conversation counts from the store, behind 0 (M1 has no replication so
// there is nothing the node knows it is missing), faults absent until M5.
func (s *apiServer) statusGet(w http.ResponseWriter, r *http.Request) {
	// A peer may ask whether this module is alive and what it is — that is what
	// an L1 probe measures the round trip of. It may not learn how many
	// conversations live here or which of them this node mains; those are facts
	// about rooms it may not be in.
	if origin, fromPeer := peerOrigin(r); fromPeer && origin != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "ok",
			"version":      moduleVersion,
			"node_id":      s.deps.ResolveNodeID(r.Context()),
			"display_name": s.deps.DisplayName,
		})
		return
	}
	total, mainOf, err := s.deps.Store.Counts()
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// behind_count answered a hard-coded 0 from M1, when there was no
	// replication to be behind. There has been since M2, and a status that
	// always says "nothing missing" is worse than no status at all.
	summaries, err := s.deps.Store.List()
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	behind, lostOwn := 0, 0
	for _, summary := range summaries {
		behind += summary.Behind
		lostOwn += summary.LostOwn
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"version":            moduleVersion,
		"node_id":            s.deps.ResolveNodeID(r.Context()),
		"display_name":       s.deps.DisplayName,
		"conversation_count": total,
		"main_of_count":      mainOf,
		"behind_count":       behind,
		"lost_own_count":     lostOwn,
		"faults_enabled":     s.deps.Faults.Enabled(),
	})
}

// ---- probe ------------------------------------------------------------------

// allRungs is the probe default: "생략하면 가용한 칸을 모두 잰다" — and in this
// module a rung that cannot be attempted is a RESULT, not an omission.
var allRungs = []string{"L0", "L1", "L2", "L3"}

// probeTimeout bounds one rung measurement. A rung that answers slower than
// this is reported as unreachable rather than left to hold the whole probe.
const probeTimeout = 10 * time.Second

// probePost measures what this PROCESS can measure and refuses the rest with a
// per-rung code. In M1 that is exactly one real measurement: L0 toward itself
// (a credential-guarded roundtrip to its own workload endpoint — the same wire
// a forwarded operation call rides). L1 toward a peer needs the module's
// outbound door, which M2 opens (terra.node.peer.invoke); until then the rung
// answers ok:false PEER_INVOKE_UNAVAILABLE. The GUI-side L0/L1 fetch timings
// are the client's own measurements and never pass through here.
func (s *apiServer) probePost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TargetNodeID string   `json:"target_node_id"`
		Rungs        []string `json:"rungs"`
		PayloadBytes int      `json:"payload_bytes"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.TargetNodeID) == "" {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "target_node_id가 필요하다")
		return
	}
	// A probe target is named the same way every other node is. It used to be
	// the one place that took an id and nothing else, which meant the command an
	// operator reaches for FIRST when something is wrong — "can I even see that
	// node?" — was the one that would not take the name they know it by.
	target, err := s.nodeReference(body.TargetNodeID, s.deps.ResolveNodeID(r.Context()), false)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	if !talk.ValidNodeID(target) {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "target_node_id가 node id 형식이 아니다")
		return
	}
	body.TargetNodeID = target
	rungs := body.Rungs
	if len(rungs) == 0 {
		rungs = allRungs
	}
	valid := map[string]bool{"L0": true, "L1": true, "L2": true, "L3": true}
	for _, rung := range rungs {
		if !valid[rung] {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "알 수 없는 rung: "+rung)
			return
		}
	}

	self := s.deps.ResolveNodeID(r.Context())
	results := make([]map[string]any, 0, len(rungs))
	for _, rung := range rungs {
		result := map[string]any{"rung": rung, "ok": false}
		switch {
		case rung == "L0" && body.TargetNodeID == self:
			if rtt, err := s.dialSelf(r); err != nil {
				result["error_code"] = "NODE_UNREACHABLE"
			} else {
				result["ok"] = true
				result["rtt_ms"] = rtt
			}
		case rung == "L0":
			// L0 is the loopback rung; toward another node it does not exist.
			result["error_code"] = "RUNG_UNAVAILABLE"
		case rung == "L1":
			// The door this measures is the same one every pushed line rides
			// (push.go). Until now the module stamped rung=L1 on arriving
			// messages while its own probe answered that L1 could not be
			// reached — an instrument that could not read the scale it was
			// already printing.
			if rtt, err := s.dialPeer(r.Context(), body.TargetNodeID); err != nil {
				var coded *doorError
				if errors.As(err, &coded) && coded.Code != "" {
					result["error_code"] = coded.Code
				} else {
					result["error_code"] = "NODE_UNREACHABLE"
				}
			} else {
				result["ok"] = true
				result["rtt_ms"] = rtt
			}
		default: // L2, L3
			result["error_code"] = "RUNG_UNAVAILABLE"
		}
		results = append(results, result)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"target_node_id": body.TargetNodeID,
		"results":        results,
	})
}

// dialPeer measures one roundtrip to this module on ANOTHER node, through the
// peer door — the rung a message crosses when it is pushed. status.get is the
// cheapest thing on the far side that proves the module answered rather than
// merely that a socket opened.
func (s *apiServer) dialPeer(ctx context.Context, target string) (int, error) {
	if s.deps.Door == nil {
		return 0, &doorError{Code: "PEER_INVOKE_UNAVAILABLE", Message: "이 조립에는 peer door가 없다"}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	started := time.Now()
	if _, err := s.deps.Door(ctx, target, "GET", apiPrefix+"/status", nil); err != nil {
		return 0, err
	}
	return int(time.Since(started).Milliseconds()), nil
}

// dialSelf measures one roundtrip to this module's own workload endpoint —
// readiness, with the credential, exactly as the host and the Broker reach it.
func (s *apiServer) dialSelf(r *http.Request) (int, error) {
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		"http://"+s.deps.Identity.Endpoint+modulert.ReadinessPath, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set(modulert.CredentialHeader, s.deps.Identity.Credential)
	started := time.Now()
	response, err := s.client.Do(request)
	if err != nil {
		return 0, err
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("readiness answered %d", response.StatusCode)
	}
	return int(time.Since(started).Milliseconds()), nil
}

// ---- conversations ----------------------------------------------------------

// conversationsList answers what the caller may see. For this node's own
// operator that is everything; for another node it is only the conversations
// that node is in.
//
// The sync loop already filtered by membership on its own side, but that is the
// wrong side to filter on — by then the ids, names and member lists of every
// other conversation have crossed the wire. This is where the filter belongs,
// and it is also what stops a stranger collecting the ids that every other
// peer-facing route is addressed by.
func (s *apiServer) conversationsList(w http.ResponseWriter, r *http.Request) {
	summaries, err := s.deps.Store.List()
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	if origin, fromPeer := peerOrigin(r); fromPeer {
		visible := []talk.Summary{}
		for _, summary := range summaries {
			for _, member := range summary.Conversation.Members {
				if member.NodeID == origin && member.State == talk.MemberActive {
					visible = append(visible, summary)
					break
				}
			}
		}
		summaries = visible
	}
	self := s.deps.ResolveNodeID(r.Context())
	named := make([]namedSummary, 0, len(summaries))
	for _, summary := range summaries {
		named = append(named, namedSummary{
			Behind: summary.Behind, OnNodeID: self, OnNodeName: s.nameOf(self),
			Conversation: s.nameConversation(summary.Conversation),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": named})
}

func (s *apiServer) conversationsCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DisplayName    string   `json:"display_name"`
		Members        []string `json:"members"`
		IdempotencyKey string   `json:"idempotency_key"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	conversation, err := s.deps.Store.Create(body.DisplayName, body.Members, body.IdempotencyKey)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"conversation": s.nameConversation(conversation)})
}

func (s *apiServer) conversationsGet(w http.ResponseWriter, r *http.Request) {
	conversationID, err := s.conversationFrom(r, false)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	conversation, marks, err := s.deps.Store.Get(conversationID)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// Which node answered, for the same reason the listing carries it. Here the
	// output is a single object, so the renderer shows it beside the rest.
	self := s.deps.ResolveNodeID(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"on_node_id":       self,
		"on_node_name":     s.nameOf(self),
		"conversation":     s.nameConversation(conversation),
		"high_water_marks": marks,
	})
}

// ---- messages ---------------------------------------------------------------

func (s *apiServer) messagesList(w http.ResponseWriter, r *http.Request) {
	afterLamport := 0
	if raw := r.URL.Query().Get("after_lamport"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "after_lamport는 0 이상의 정수여야 한다")
			return
		}
		afterLamport = parsed
	}
	limit := 200
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 500 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "limit은 1..500이어야 한다")
			return
		}
		limit = parsed
	}
	conversationID, err := s.conversationFrom(r, false)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	entries, hasMore, err := s.deps.Store.Entries(conversationID, afterLamport, limit)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries": s.nameEntries(entries), "has_more": hasMore,
	})
}

func (s *apiServer) messagesPost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text               string `json:"text"`
		IdempotencyKey     string `json:"idempotency_key"`
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
	entry, err := s.deps.Store.AppendMessage(conversationID, body.Text, body.IdempotencyKey)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// Deliver now rather than on the peers' next tick (chat-room design §1).
	// The answer does not wait on it: the append already succeeded, and
	// reachability never gates a write (D-1).
	s.fanOutEntry(conversationID, entry, entry.Epoch)
	writeJSON(w, http.StatusCreated, map[string]any{"entry": s.nameEntry(entry)})
}

// messagesStream serves the local-GUI-only SSE push (idea doc §11: the remote
// hop cannot carry a stream, so this endpoint is deliberately per-node). The
// Gateway relays it live when the caller Accepts text/event-stream.
func (s *apiServer) messagesStream(w http.ResponseWriter, r *http.Request) {
	conversationID, err := s.conversationFrom(r, false)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	events, cancel, err := s.deps.Store.Subscribe(conversationID)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	defer cancel()

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusServiceUnavailable, "NODETALK_UNAVAILABLE", "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, open := <-events:
			if !open {
				return
			}
			payload, err := json.Marshal(s.nameStreamEvent(event))
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Event, payload)
			flusher.Flush()
		case <-keepalive.C:
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
