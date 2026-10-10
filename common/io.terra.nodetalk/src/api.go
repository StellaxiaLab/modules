package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
)

// apiPrefix is where the Gateway mounts this module's operations — every
// gateway-http binding in contracts/api/terra-api.json lives under it, and the
// module serves the same paths on its loopback endpoint so forwarded requests
// need no rewriting.
const apiPrefix = "/api/modules/io.terra.nodetalk/v1"

// operationRoute is one row of the module's surface: the contract operation it
// implements, the gateway-http binding it must match, and the milestone that
// implements it (empty = implemented now). The table is data so
// contract_map_test.go can hold it against the contract in both directions —
// with 15 routes living in two places, one-sided edits are this module's most
// likely accident.
type operationRoute struct {
	OperationID string
	Method      string
	Path        string // relative to apiPrefix, mux wildcard syntax = contract syntax
	Milestone   string // "" = implemented; otherwise the stage that implements it
	// Peer says what another NODE may do with this route. The zero value denies,
	// which is the point: a route added later is not exposed to the whole fleet
	// by having been forgotten.
	Peer peerAccess
}

// peerAccess is this module's answer to "who is calling".
//
// Until this existed the module's entire surface was open to any node in the
// cluster that had it installed: it could list every conversation on every
// node, pull the full transcript of conversations it was never in, and invite
// itself into the rest. The means to check was already here and already used in
// two handlers — the Master stamps X-Terra-Principal from the verified relay
// origin — so this was an omission, not a missing capability.
type peerAccess int

const (
	// peerDenied refuses the route to other nodes. Only this node's own operator
	// reaches it, through the Gateway with their own credentials.
	peerDenied peerAccess = iota
	// peerOpen names no conversation, so there is no membership to check. The
	// handler still narrows what it answers.
	peerOpen
	// peerMember requires the calling node to be an active member of the
	// conversation named in the path.
	peerMember
)

// operationRoutes mirrors the contract's bindings exactly. Milestones follow
// the implementation plan §3; M1 implemented status, probe, conversations
// and messages; M2 the replica pair; M3 handover and membership; M4 deletion;
// M5 fault injection. No stubs remain — the table pins that fact via its test.
var operationRoutes = []operationRoute{
	{OperationID: "io.terra.nodetalk.status.get", Method: "GET", Path: "/status", Peer: peerOpen},
	{OperationID: "io.terra.nodetalk.probe.post", Method: "POST", Path: "/probe"},
	{OperationID: "io.terra.nodetalk.conversations.list", Method: "GET", Path: "/conversations", Peer: peerOpen},
	{OperationID: "io.terra.nodetalk.conversations.create", Method: "POST", Path: "/conversations"},
	{OperationID: "io.terra.nodetalk.conversations.get", Method: "GET", Path: "/conversations/{conversation_id}", Peer: peerMember},
	{OperationID: "io.terra.nodetalk.conversations.delete", Method: "DELETE", Path: "/conversations/{conversation_id}", Peer: peerMember},
	{OperationID: "io.terra.nodetalk.members.add", Method: "POST", Path: "/conversations/{conversation_id}/members"},
	{OperationID: "io.terra.nodetalk.members.remove", Method: "DELETE", Path: "/conversations/{conversation_id}/members/{node_id}"},
	{OperationID: "io.terra.nodetalk.messages.list", Method: "GET", Path: "/conversations/{conversation_id}/messages"},
	{OperationID: "io.terra.nodetalk.messages.post", Method: "POST", Path: "/conversations/{conversation_id}/messages"},
	{OperationID: "io.terra.nodetalk.messages.stream", Method: "GET", Path: "/conversations/{conversation_id}/stream"},
	{OperationID: "io.terra.nodetalk.replica.pull", Method: "GET", Path: "/conversations/{conversation_id}/replica", Peer: peerMember},
	{OperationID: "io.terra.nodetalk.replica.push", Method: "POST", Path: "/conversations/{conversation_id}/replica", Peer: peerMember},
	{OperationID: "io.terra.nodetalk.main.claim", Method: "POST", Path: "/conversations/{conversation_id}/main", Peer: peerMember},
	{OperationID: "io.terra.nodetalk.faults.set", Method: "PUT", Path: "/faults"},
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

// writeStoreError maps talk sentinels to the contract's error codes. The
// 404/410 split is deliberate: 404 means "never here", 410 means "deleted, do
// not bring it back" — the sync loop's resurrection block reads exactly this
// difference.
//
// "This node does not know it" names WHICH node. One machine can run more than
// one — a Master host and a leaf daemon each run this module, each with its own
// conversations — and a delete that answered "이 노드가 모른다" while the room
// sat on the other one was a true sentence nobody could act on.
func (s *apiServer) writeStoreError(w http.ResponseWriter, r *http.Request, err error) {
	here := s.deps.ResolveNodeID(r.Context())
	if name := s.nameOf(here); name != "" && name != here {
		here = name + " (" + here + ")"
	}
	writeStoreErrorOn(w, here, err)
}

func writeStoreErrorOn(w http.ResponseWriter, here string, err error) {
	switch {
	case errors.Is(err, talk.ErrDeleted):
		writeAPIError(w, http.StatusGone, "CONVERSATION_DELETED",
			"삭제된 대화다 — 묘비가 보존 창 안에 있다: "+here+" 기준")
	case errors.Is(err, talk.ErrNotFound):
		writeAPIError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND",
			"지정한 대화를 이 노드가 모른다: "+here)
	case errors.Is(err, talk.ErrMainLeaseLapsed):
		writeAPIError(w, http.StatusConflict, "MAIN_LEASE_LAPSED",
			"이 노드는 메인 임차가 만료되어 물러났다 — 메시지는 계속 받지만 멤버십·삭제는 결정하지 않는다")
	case errors.Is(err, talk.ErrNotHighestRanked):
		writeAPIError(w, http.StatusConflict, "NOT_HIGHEST_RANKED", err.Error())
	case errors.Is(err, talk.ErrInvalid):
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
	default:
		writeAPIError(w, http.StatusServiceUnavailable, "NODETALK_UNAVAILABLE", err.Error())
	}
}

// decodeBody strictly decodes a JSON body: the contract's input schemas all
// declare additionalProperties:false, so an unknown field is the caller's bug
// and is answered as one instead of being silently dropped.
func decodeBody(w http.ResponseWriter, r *http.Request, value any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "본문을 읽을 수 없다: "+err.Error())
		return false
	}
	return true
}

// serverDeps wires the API surface. Identity is used by probe's self-L0 dial
// (the module measures the roundtrip to its own workload endpoint).
type serverDeps struct {
	ResolveNodeID func(context.Context) string
	Store         *talk.Store
	Identity      modulert.WorkloadIdentity
	// HandoverHysteresis paces main claims (§5.5); zero disables — tests and
	// deliberately-flapping bench assemblies use that.
	HandoverHysteresis time.Duration
	// Door reaches this module on peer nodes (deletion fan-out). nil = no door
	// in this assembly; fan-out then reports every peer as pending.
	Door doorFunc
	// Names labels nodes for the surfaces a person reads (directory.go). nil
	// falls back to showing ids, which is what every surface did before.
	Names *directory
	// DisplayName is what THIS node calls itself, reported to peers so they can
	// fill their own directories. Empty means the host did not say, and the id
	// stands in.
	DisplayName string
	// Faults is the M5 injection state; nil or disabled = shipped behaviour.
	Faults *faultState
	// Peers learns the origin of inbound door traffic so an invited node can
	// discover who to pull from (peerlearn.go). nil = no learning.
	Peers *peerLearner
}

type apiServer struct {
	deps   serverDeps
	client *http.Client
	logger *log.Logger
}

// newOperationsHandler mounts every contract route: implemented operations get
// their handler, the rest refuse honestly with their milestone.
func newOperationsHandler(deps serverDeps) http.Handler {
	server := &apiServer{deps: deps, client: &http.Client{}, logger: log.New(os.Stderr, "nodetalk: ", log.LstdFlags)}
	mux := http.NewServeMux()
	for _, route := range operationRoutes {
		pattern := route.Method + " " + apiPrefix + route.Path
		mux.HandleFunc(pattern, server.guardPeer(route, server.handlerFor(route)))
	}
	// force_offline is a real partition: inbound door traffic from the
	// offlined node is refused here, before any handler — and before the
	// learner, so a cut peer is not discovered through the cut.
	return faultInboundMiddleware(deps.Faults, learnPeerMiddleware(deps.Peers, server.logger, mux))
}

func (s *apiServer) handlerFor(route operationRoute) http.HandlerFunc {
	switch route.OperationID {
	case "io.terra.nodetalk.status.get":
		return s.statusGet
	case "io.terra.nodetalk.probe.post":
		return s.probePost
	case "io.terra.nodetalk.conversations.list":
		return s.conversationsList
	case "io.terra.nodetalk.conversations.create":
		return s.conversationsCreate
	case "io.terra.nodetalk.conversations.get":
		return s.conversationsGet
	case "io.terra.nodetalk.messages.list":
		return s.messagesList
	case "io.terra.nodetalk.messages.post":
		return s.messagesPost
	case "io.terra.nodetalk.messages.stream":
		return s.messagesStream
	case "io.terra.nodetalk.replica.pull":
		return s.replicaPull
	case "io.terra.nodetalk.replica.push":
		return s.replicaPush
	case "io.terra.nodetalk.main.claim":
		return s.mainClaim
	case "io.terra.nodetalk.members.add":
		return s.membersAdd
	case "io.terra.nodetalk.members.remove":
		return s.membersRemove
	case "io.terra.nodetalk.conversations.delete":
		return s.conversationsDelete
	case "io.terra.nodetalk.faults.set":
		return s.faultsSet
	default:
		return notImplementedHandler(route)
	}
}

// notImplementedHandler is the honest answer for a mounted-but-unbuilt
// operation: 501 with the milestone that implements it. The route existing at
// all is deliberate — it proves the published surface matches the contract
// (evidence: zero ROUTE_NO_HTTP_BINDING), while the 501 keeps the module from
// pretending. The daemon speaks 501 the same way (CodeUnavailable).
func notImplementedHandler(route operationRoute) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeAPIError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED",
			route.OperationID+"은 아직 구현 전이다 — "+route.Milestone+"에서 구현된다 (docs/implementation/nodetalk-implementation-plan.md §3)")
	}
}

// peerOrigin names the node a request came from, and whether it came from another
// node at all. The Master stamps this from the authenticated relay session and
// discards whatever the payload claimed, so it is as trustworthy as the door it
// arrived through.
//
// A malformed principal counts as a peer with NO identity rather than as a local
// caller: the local path is the one that grants everything, and a parse failure
// must never fall into it.
func peerOrigin(r *http.Request) (string, bool) {
	principal := r.Header.Get("X-Terra-Principal")
	if !strings.HasPrefix(principal, peerPrincipalPrefix) {
		return "", false
	}
	origin := strings.TrimPrefix(principal, peerPrincipalPrefix)
	if !talk.ValidNodeID(origin) {
		return "", true
	}
	return origin, true
}

// guardPeer applies a route's peer policy.
//
// A request with no peer principal is this node's own operator arriving through
// the Gateway — already authorized there, against permissions this module does
// not own — and passes untouched. That includes the fleet-wide GUI, whose remote
// calls carry the USER's principal, not a module one.
func (s *apiServer) guardPeer(route operationRoute, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin, fromPeer := peerOrigin(r)
		if !fromPeer {
			next(w, r)
			return
		}
		switch route.Peer {
		case peerOpen:
		case peerMember:
			// Being reached is how a main renews its lease (talk/lease.go). It is
			// recorded before the membership check so that a peer who has been
			// removed still proves the network works — the lease is about
			// reachability, and refusing to notice a caller would let a main
			// stand down while the fleet was talking to it perfectly well.
			s.deps.Store.TouchPeerContact(r.PathValue("conversation_id"))
			if !s.originMayReach(r.PathValue("conversation_id"), origin) {
				// 404 rather than 403. A node that is not a member must not
				// learn that a conversation exists by being refused it.
				writeAPIError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND",
					"지정한 대화를 이 노드가 모른다")
				return
			}
		default:
			writeAPIError(w, http.StatusForbidden, "PEER_NOT_PERMITTED",
				route.OperationID+"은 다른 노드가 호출할 수 없다")
			return
		}
		next(w, r)
	}
}

// originMayReach answers whether the calling node may touch this conversation.
//
// A conversation this node cannot read is NOT a refusal here, and that is
// deliberate twice over. The push that tells an invited node about its invitation
// necessarily names a conversation the receiver has never seen — refusing it
// would close the very door peerlearn.go listens at. And a tombstoned
// conversation must still answer 410, because that is how a peer learns a
// deletion happened at all.
func (s *apiServer) originMayReach(conversationID, origin string) bool {
	if conversationID == "" || origin == "" {
		return false
	}
	conversation, _, err := s.deps.Store.Get(conversationID)
	if err != nil {
		return true // unreadable here: let the handler give its own answer
	}
	for _, member := range conversation.Members {
		if member.NodeID == origin && member.State == talk.MemberActive {
			return true
		}
	}
	return false
}
