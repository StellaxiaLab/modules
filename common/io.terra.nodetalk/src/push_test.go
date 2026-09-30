package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"

	"github.com/terra-project/terra/products/common/packages/terra-testwait"
)

// recordingDoor captures every door call and answers success, so a test can
// assert who a fan-out actually reached.
type recordingDoor struct {
	mu    sync.Mutex
	calls []doorCall
	fail  bool
}

type doorCall struct {
	Node   string
	Method string
	Path   string
	Body   []byte
}

func (d *recordingDoor) fn() doorFunc {
	return func(_ context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		d.mu.Lock()
		d.calls = append(d.calls, doorCall{Node: node, Method: method, Path: path, Body: append([]byte(nil), body...)})
		failing := d.fail
		d.mu.Unlock()
		if failing {
			return nil, &doorError{Code: "MODULE_UNAVAILABLE", Message: "test: peer down"}
		}
		return json.RawMessage(`{"accepted":1,"duplicates":0,"high_water_marks":{}}`), nil
	}
}

// settled waits for the fan-out goroutines to land — they are deliberately
// off the request path, so a test has to wait for them rather than for the
// response.
func (d *recordingDoor) settled(t *testing.T, want int) []doorCall {
	t.Helper()
	deadline := time.Now().Add(testwait.Scale(3 * time.Second))
	for time.Now().Before(deadline) {
		d.mu.Lock()
		got := len(d.calls)
		d.mu.Unlock()
		if got >= want {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	// A short settle so an unexpected EXTRA call has a chance to show up too.
	time.Sleep(150 * time.Millisecond)
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]doorCall(nil), d.calls...)
}

func newPushNode(t *testing.T, nodeID string, door doorFunc) (*talk.Store, http.Handler) {
	t.Helper()
	store, err := talk.NewStore(t.TempDir(), func() string { return nodeID })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	handler := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID),
		Store:         store,
		Door:          door,
	})
	return store, handler
}

// The core of R0: posting a message reaches every other active member at once,
// through the door, as a replica push carrying exactly that entry.
func TestPostFansOutToEveryOtherMember(t *testing.T) {
	door := &recordingDoor{}
	store, handler := newPushNode(t, "node-a", door.fn())
	conversation, err := store.Create("즉시 전달", []string{"node-b", "node-c"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/messages",
		map[string]any{"text": "지금 바로"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("post: %d %s", recorder.Code, recorder.Body.String())
	}

	calls := door.settled(t, 2)
	if len(calls) != 2 {
		t.Fatalf("fan-out reached %d peers, want 2 (self must be excluded): %+v", len(calls), calls)
	}
	reached := map[string]bool{}
	for _, call := range calls {
		reached[call.Node] = true
		if call.Method != "POST" || !strings.HasSuffix(call.Path, "/conversations/"+id+"/replica") {
			t.Fatalf("fan-out call shape: %+v", call)
		}
		var body struct {
			Entries     []talk.Entry `json:"entries"`
			SenderEpoch *int         `json:"sender_epoch"`
		}
		if err := json.Unmarshal(call.Body, &body); err != nil {
			t.Fatalf("decode pushed body: %v", err)
		}
		if len(body.Entries) != 1 || body.Entries[0].Text != "지금 바로" || body.Entries[0].AuthorNodeID != "node-a" {
			t.Fatalf("pushed entries: %+v", body.Entries)
		}
		if body.SenderEpoch == nil {
			t.Fatal("pushed body carries no sender_epoch — the receiver's epoch gate needs it")
		}
	}
	if !reached["node-b"] || !reached["node-c"] || reached["node-a"] {
		t.Fatalf("reached: %v", reached)
	}
}

// A membership change is an ordinary log entry, so it travels the same way —
// otherwise an invite would sit invisible on the other members until their
// next tick.
func TestMembershipChangeFansOut(t *testing.T) {
	door := &recordingDoor{}
	store, handler := newPushNode(t, "node-a", door.fn())
	conversation, err := store.Create("초대 전파", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "node-c"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("add member: %d %s", recorder.Code, recorder.Body.String())
	}
	// Inviting now also asks the node to prove it exists (resolve.go), so the
	// door carries a status call as well as the pushes. Count what was PUSHED.
	pushes := []doorCall{}
	for _, call := range door.settled(t, 3) {
		if call.Method == "POST" {
			pushes = append(pushes, call)
		}
	}
	if len(pushes) != 2 {
		t.Fatalf("membership fan-out reached %d, want 2 (b and the new c): %+v", len(pushes), pushes)
	}
	var body struct {
		Entries []talk.Entry `json:"entries"`
	}
	if err := json.Unmarshal(pushes[0].Body, &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Entries) != 1 || body.Entries[0].Kind != talk.KindMemberAdded ||
		body.Entries[0].MemberNodeID != "node-c" {
		t.Fatalf("pushed membership entry: %+v", body.Entries)
	}
}

// Delivery is best effort and the append is not: a door that refuses every
// peer must not turn a successful write into a failure (D-1).
func TestFanOutFailureDoesNotBreakThePost(t *testing.T) {
	door := &recordingDoor{fail: true}
	store, handler := newPushNode(t, "node-a", door.fn())
	conversation, _ := store.Create("최선 노력", []string{"node-b"}, "")
	id := conversation.ConversationID

	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/messages",
		map[string]any{"text": "상대가 꺼져 있어도"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("post with a dead peer: %d %s", recorder.Code, recorder.Body.String())
	}
	door.settled(t, 1)
	entries, _, err := store.Entries(id, 0, 0)
	if err != nil || len(entries) != 1 {
		t.Fatalf("the line must be on disk regardless: %v %d", err, len(entries))
	}
}

// An assembly with no outbound door still works — it simply has no immediate
// path, and the pull loop is the only one.
func TestFanOutWithoutADoorIsSilent(t *testing.T) {
	store, handler := newPushNode(t, "node-a", nil)
	conversation, _ := store.Create("문 없음", []string{"node-b"}, "")
	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+conversation.ConversationID+"/messages",
		map[string]any{"text": "문이 없어도 게시는 된다"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("post without a door: %d", recorder.Code)
	}
}

// D-14: past the fan-out limit the push is skipped entirely rather than
// hammering the door, and the pull loop carries the room.
func TestFanOutSkipsOversizedRooms(t *testing.T) {
	door := &recordingDoor{}
	store, handler := newPushNode(t, "node-a", door.fn())
	members := make([]string, 0, pushFanOutLimit+1)
	for i := 0; i <= pushFanOutLimit; i++ {
		members = append(members, "node-"+string(rune('a'+i%26))+strings.Repeat("x", i/26+1))
	}
	conversation, err := store.Create("큰 방", members, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+conversation.ConversationID+"/messages",
		map[string]any{"text": "상한 초과"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("post: %d", recorder.Code)
	}
	time.Sleep(300 * time.Millisecond)
	door.mu.Lock()
	calls := len(door.calls)
	door.mu.Unlock()
	if calls != 0 {
		t.Fatalf("oversized room pushed %d times; it must defer to the pull loop", calls)
	}
}

// A push relayed through the peer door proves it crossed L1 (the Master stamps
// the principal), so the receiver marks the arrival — pushed lines carry a
// badge the way pulled ones do. A push without that principal stays unstamped.
func TestPushedEntriesCarryTheirArrivalRung(t *testing.T) {
	store, handler := newPushNode(t, "node-b", nil)
	origin, _ := newPushNode(t, "node-a", nil)
	conversation, err := origin.Create("도착 계측", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	view, _, _ := origin.Get(conversation.ConversationID)
	if _, err := store.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	id := conversation.ConversationID
	server := httptest.NewServer(handler)
	defer server.Close()

	push := func(principal string, seq int) {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{
			"sender_epoch": 0,
			"entries": []map[string]any{{
				"author_node_id": "node-a", "kind": "message",
				"lamport": seq, "seq": seq, "text": "seq" + string(rune('0'+seq)),
			}},
		})
		request, _ := http.NewRequest("POST", server.URL+apiPrefix+"/conversations/"+id+"/replica",
			strings.NewReader(string(payload)))
		request.Header.Set("Content-Type", "application/json")
		if principal != "" {
			request.Header.Set("X-Terra-Principal", principal)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("push: %v", err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusAccepted {
			t.Fatalf("push status: %d", response.StatusCode)
		}
	}

	push(peerPrincipalPrefix+"node-a", 1)
	push("", 2)

	entries, _, err := store.Entries(id, 0, 0)
	if err != nil || len(entries) != 2 {
		t.Fatalf("entries: %v %d", err, len(entries))
	}
	if entries[0].Transport == nil || entries[0].Transport.Rung != "L1" {
		t.Fatalf("door-relayed push must be stamped L1: %+v", entries[0].Transport)
	}
	if entries[0].Transport.RTTMs != 0 {
		t.Fatalf("the receiver did not measure a duration and must not claim one: %+v", entries[0].Transport)
	}
	if entries[1].Transport != nil {
		t.Fatalf("a push with no peer principal must stay unstamped: %+v", entries[1].Transport)
	}
}
