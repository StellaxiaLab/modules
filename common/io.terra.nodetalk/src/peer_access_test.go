package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
)

// What another NODE may do here.
//
// Before api.go's peerAccess, the answer was "everything": any node in the
// cluster with this module installed could list every conversation on every
// other node, pull the full transcript of conversations it was never in, and —
// through members.add — invite itself into the rest. The module already knew who
// was calling, because the Master stamps the origin on every relayed request. It
// simply never asked.
//
// These tests are that question, asked once per route.

const strangerNode = "node-x"

// asPeer makes the request another node would make. The principal is what the
// Master stamps from the verified relay session; nothing here is self-reported.
func asPeer(t *testing.T, server *httptest.Server, origin, method, path string, body any) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}
	request, err := http.NewRequest(method, server.URL+apiPrefix+path, reader)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if origin != "" {
		request.Header.Set("X-Terra-Principal", peerPrincipalPrefix+origin)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return response
}

func peerStatus(t *testing.T, server *httptest.Server, origin, method, path string, body any) int {
	t.Helper()
	response := asPeer(t, server, origin, method, path, body)
	_ = response.Body.Close()
	return response.StatusCode
}

// a room on node-a whose only other member is node-b; node-x is a stranger.
func roomWithMember(t *testing.T) (*talk.Store, *httptest.Server, string) {
	t.Helper()
	store, server := newNode(t, "node-a", t.TempDir())
	conversation, err := store.Create("접근 제어", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.AppendMessage(conversation.ConversationID, "비밀은 아니지만 남의 것", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	return store, server, conversation.ConversationID
}

// The listing was how a stranger collected the ids that every other peer-facing
// route is addressed by. It now answers only what the caller is in.
func TestListingShowsAPeerOnlyItsOwnConversations(t *testing.T) {
	store, server, _ := roomWithMember(t)
	if _, err := store.Create("남의 방", nil, ""); err != nil {
		t.Fatalf("create: %v", err)
	}

	decode := func(origin string) []talk.Summary {
		t.Helper()
		response := asPeer(t, server, origin, "GET", "/conversations", nil)
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("list as %q: %d", origin, response.StatusCode)
		}
		var body struct {
			Conversations []talk.Summary `json:"conversations"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return body.Conversations
	}

	if got := decode(strangerNode); len(got) != 0 {
		t.Errorf("a stranger saw %d conversation(s): %+v", len(got), got)
	}
	if got := decode("node-b"); len(got) != 1 {
		t.Errorf("the member saw %d conversation(s), want its own 1", len(got))
	}
	// This node's own operator, arriving through the Gateway with no peer
	// principal, still sees everything — that is the GUI and the CLI.
	if got := decode(""); len(got) != 2 {
		t.Errorf("the local caller saw %d of 2 conversations", len(got))
	}
}

// A stranger is answered 404, not 403: being refused would itself confirm that
// the conversation exists, which is the thing being withheld.
func TestStrangerCannotReachAConversationAndIsNotToldItExists(t *testing.T) {
	_, server, id := roomWithMember(t)
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/conversations/" + id, nil},
		{"GET", "/conversations/" + id + "/replica?author_node_id=node-a", nil},
		{"POST", "/conversations/" + id + "/replica", map[string]any{
			"sender_epoch": 0,
			"entries": []map[string]any{{"author_node_id": strangerNode,
				"kind": "message", "lamport": 1, "seq": 1, "text": "끼어들기"}}}},
		{"POST", "/conversations/" + id + "/main", map[string]any{
			"claimant_node_id": strangerNode, "claimed_epoch": 1,
			"high_water_marks": map[string]int{}}},
		{"DELETE", "/conversations/" + id, nil},
	} {
		if got := peerStatus(t, server, strangerNode, probe.method, probe.path, probe.body); got != http.StatusNotFound {
			t.Errorf("stranger %s %s: got %d, want 404", probe.method, probe.path, got)
		}
	}
	// And the transcript really did not travel: a member gets it, a stranger
	// does not, from the same endpoint.
	response := asPeer(t, server, "node-b", "GET", "/conversations/"+id+"/replica?author_node_id=node-a", nil)
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("member pull: %d", response.StatusCode)
	}
	var slice struct {
		Entries []talk.Entry `json:"entries"`
	}
	if err := json.NewDecoder(response.Body).Decode(&slice); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(slice.Entries) != 1 || slice.Entries[0].Text != "비밀은 아니지만 남의 것" {
		t.Fatalf("member pull returned %+v", slice.Entries)
	}
}

// Routes no peer has any business calling are refused outright — including the
// one that let a node invite itself into a conversation it had merely heard of.
func TestRoutesNoPeerMayCall(t *testing.T) {
	_, server, id := roomWithMember(t)
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{"POST", "/probe", map[string]any{"target_node_id": "node-a"}},
		{"POST", "/conversations", map[string]any{"display_name": "남의 노드에 만들기"}},
		{"GET", "/conversations/" + id + "/messages", nil},
		{"POST", "/conversations/" + id + "/messages", map[string]any{"text": "남의 이름으로"}},
		{"GET", "/conversations/" + id + "/stream", nil},
		{"POST", "/conversations/" + id + "/members", map[string]any{"node_id": strangerNode}},
		{"DELETE", "/conversations/" + id + "/members/node-b", nil},
		{"PUT", "/faults", map[string]any{"enabled": true}},
	} {
		// Asked as a MEMBER, so what is being refused is the route itself and
		// not the caller: node-b belongs here and still may not do these.
		if got := peerStatus(t, server, "node-b", probe.method, probe.path, probe.body); got != http.StatusForbidden {
			t.Errorf("member %s %s: got %d, want 403", probe.method, probe.path, got)
		}
	}
}

// The same routes stay open to this node's own operator, who arrives with no
// peer principal and was already authorized by the Gateway. Breaking this would
// break the GUI and every `terra nodetalk` command.
func TestTheLocalCallerIsUnaffected(t *testing.T) {
	_, server, id := roomWithMember(t)
	for _, probe := range []struct {
		method, path string
		body         any
		want         int
	}{
		{"GET", "/status", nil, http.StatusOK},
		{"GET", "/conversations/" + id + "/messages", nil, http.StatusOK},
		{"POST", "/conversations/" + id + "/messages", map[string]any{"text": "내 노드에서"}, http.StatusCreated},
		{"POST", "/conversations/" + id + "/members", map[string]any{"node_id": "node-c"}, http.StatusCreated},
	} {
		if got := peerStatus(t, server, "", probe.method, probe.path, probe.body); got != probe.want {
			t.Errorf("local %s %s: got %d, want %d", probe.method, probe.path, got, probe.want)
		}
	}
}

// A member may not write in another member's name. The log is per-author exactly
// so that cannot happen, and a push is only ever the pusher's own line.
func TestAPeerCannotPushSomeoneElsesLines(t *testing.T) {
	_, server, id := roomWithMember(t)
	forged := map[string]any{
		"sender_epoch": 0,
		"entries": []map[string]any{{"author_node_id": "node-c", "kind": "message",
			"lamport": 1, "seq": 1, "text": "내가 쓴 게 아니다"}},
	}
	if got := peerStatus(t, server, "node-b", "POST", "/conversations/"+id+"/replica", forged); got != http.StatusForbidden {
		t.Errorf("forged author: got %d, want 403", got)
	}
	honest := map[string]any{
		"sender_epoch": 0,
		"entries": []map[string]any{{"author_node_id": "node-b", "kind": "message",
			"lamport": 1, "seq": 1, "text": "내가 쓴 게 맞다"}},
	}
	if got := peerStatus(t, server, "node-b", "POST", "/conversations/"+id+"/replica", honest); got != http.StatusAccepted {
		t.Errorf("own line: got %d, want 202", got)
	}
}

// The invitation path depends on a push for a conversation the receiver has
// never seen reaching the handler — that failed push is what teaches an invited
// node who invited it (peerlearn.go). Membership cannot be checked for something
// this node does not have, and refusing it here would close that door.
func TestAPushForAnUnknownConversationStillReachesTheHandler(t *testing.T) {
	_, server := newNode(t, "node-a", t.TempDir())
	body := map[string]any{
		"sender_epoch": 0,
		"entries": []map[string]any{{"author_node_id": "node-b", "kind": "member-added",
			"lamport": 1, "seq": 1, "member_node_id": "node-a"}},
	}
	if got := peerStatus(t, server, "node-b", "POST", "/conversations/cv-unknown/replica", body); got != http.StatusNotFound {
		t.Errorf("push for an unknown conversation: got %d, want the handler's 404", got)
	}
}

// A deleted conversation must still answer 410 to a peer, because that is the
// only way a peer learns a deletion happened (sync.go discoverDeletions).
func TestATombstoneStillAnswersAPeer(t *testing.T) {
	store, server, id := roomWithMember(t)
	if _, _, err := store.DeleteAsMain(id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := peerStatus(t, server, "node-b", "GET", "/conversations/"+id, nil); got != http.StatusGone {
		t.Errorf("member asking about a tombstone: got %d, want 410", got)
	}
}

// A principal that is present but unparseable is a peer with no identity, never
// a local caller — the local path is the one that grants everything.
func TestAMalformedPrincipalIsNotTreatedAsLocal(t *testing.T) {
	_, server, id := roomWithMember(t)
	request, err := http.NewRequest("GET", server.URL+apiPrefix+"/conversations/"+id, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	request.Header.Set("X-Terra-Principal", peerPrincipalPrefix+"not a node id")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("malformed principal: got %d, want 404", response.StatusCode)
	}
}

// Every route's peer policy is a deliberate line in the table, and the zero
// value denies. A route added later without a thought is therefore closed, which
// is the property that makes this fix hold rather than decay.
func TestPeerPolicyIsDeclaredForEveryRoute(t *testing.T) {
	allowed := map[string]peerAccess{
		// status answers a NARROWED view to a peer (handlers.go): alive, which
		// version, which node. It is open because an L1 probe has to measure the
		// round trip of something, and this is the cheapest thing on the far
		// side that proves the module answered rather than that a socket opened.
		"io.terra.nodetalk.status.get":           peerOpen,
		"io.terra.nodetalk.conversations.list":   peerOpen,
		"io.terra.nodetalk.conversations.get":    peerMember,
		"io.terra.nodetalk.conversations.delete": peerMember,
		"io.terra.nodetalk.replica.pull":         peerMember,
		"io.terra.nodetalk.replica.push":         peerMember,
		"io.terra.nodetalk.main.claim":           peerMember,
	}
	for _, route := range operationRoutes {
		want, named := allowed[route.OperationID]
		if !named {
			want = peerDenied
		}
		if route.Peer != want {
			t.Errorf("%s: peer access %d, want %d — every opening must be deliberate",
				route.OperationID, route.Peer, want)
		}
	}
	// And the sync loop only ever calls what is open to it, so the policy above
	// is not merely tight but also sufficient.
	for _, needed := range []string{
		"io.terra.nodetalk.conversations.list", "io.terra.nodetalk.conversations.get",
		"io.terra.nodetalk.replica.pull", "io.terra.nodetalk.replica.push",
		"io.terra.nodetalk.main.claim", "io.terra.nodetalk.conversations.delete",
	} {
		if _, open := allowed[needed]; !open {
			t.Errorf("%s is needed by the sync loop but denied to peers", needed)
		}
	}
}

// What a peer learns from status is bounded: that the module is alive, which
// version it is, and which node answered. How many conversations live here and
// which of them this node mains are facts about rooms the caller may not be in.
func TestStatusTellsAPeerLessThanItTellsTheOperator(t *testing.T) {
	store, server, _ := roomWithMember(t)
	if _, err := store.Create("두 번째 방", nil, ""); err != nil {
		t.Fatalf("create: %v", err)
	}

	read := func(origin string) map[string]any {
		t.Helper()
		response := asPeer(t, server, origin, "GET", "/status", nil)
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("status as %q: %d", origin, response.StatusCode)
		}
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return body
	}

	peer := read("node-b")
	for _, told := range []string{"status", "version", "node_id"} {
		if _, present := peer[told]; !present {
			t.Errorf("a peer was not told %q, which a probe needs", told)
		}
	}
	for _, withheld := range []string{"conversation_count", "main_of_count", "behind_count", "faults_enabled"} {
		if _, leaked := peer[withheld]; leaked {
			t.Errorf("a peer was told %q", withheld)
		}
	}
	local := read("")
	if count, _ := local["conversation_count"].(float64); count != 2 {
		t.Errorf("the operator's own status lost its counts: %v", local)
	}
}

// The instrument reads its own scale. Every pushed line arrives stamped rung=L1
// (push.go, handlers_replica.go); until this worked, `nodetalk probe` answered
// that L1 could not be reached — the module printing a measurement it claimed
// it could not take.
func TestProbeMeasuresL1ThroughTheDoor(t *testing.T) {
	_, peerServer := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-b": peerServer}
	storeA, err := talk.NewStore(t.TempDir(), func() string { return "node-a" })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	handler := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID("node-a"), Store: storeA,
		Door: httpDoor(t, "node-a", servers),
	})

	recorder := doJSON(t, handler, "POST", apiPrefix+"/probe",
		map[string]any{"target_node_id": "node-b", "rungs": []string{"L1"}})
	if recorder.Code != http.StatusOK {
		t.Fatalf("probe: %d %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Results []struct {
			Rung      string `json:"rung"`
			OK        bool   `json:"ok"`
			RTTMs     *int   `json:"rtt_ms"`
			ErrorCode string `json:"error_code"`
		} `json:"results"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Results) != 1 || body.Results[0].Rung != "L1" {
		t.Fatalf("results: %+v", body.Results)
	}
	if !body.Results[0].OK {
		t.Fatalf("L1 was not measured: %+v", body.Results[0])
	}
	if body.Results[0].RTTMs == nil {
		t.Fatal("L1 reported ok with no round trip — an ok with no number is not a measurement")
	}

	// An assembly with no door still answers honestly rather than claiming zero.
	doorless := newOperationsHandler(serverDeps{ResolveNodeID: staticNodeID("node-a"), Store: storeA})
	recorder = doJSON(t, doorless, "POST", apiPrefix+"/probe",
		map[string]any{"target_node_id": "node-b", "rungs": []string{"L1"}})
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Results[0].OK || body.Results[0].ErrorCode != "PEER_INVOKE_UNAVAILABLE" {
		t.Fatalf("without a door: %+v", body.Results[0])
	}
}
