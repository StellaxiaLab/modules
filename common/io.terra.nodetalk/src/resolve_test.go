package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// What a person typed, turned into what the module addresses things by.
//
// The failure these exist for: a display name typed where a node id belongs
// passed every check the module had — `guibench-a` is a well-formed node id —
// and joined a room as a member that would never arrive. Nothing reported it,
// because nothing had asked whether the node was real.

// resolvingNode wires a node whose door can reach exactly the peers given.
func resolvingNode(t *testing.T, nodeID string, reachable map[string]*httptest.Server) (*talk.Store, http.Handler, *directory) {
	t.Helper()
	root := t.TempDir()
	store, err := talk.NewStore(root, func() string { return nodeID })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	names := newDirectory(root)
	handler := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID), Store: store, Names: names,
		DisplayName: "이 노드", Door: httpDoor(t, nodeID, reachable),
	})
	return store, handler, names
}

// A name typed where an id belongs is refused, because the node it names does
// not answer. This is the whole defect in one assertion.
func TestInvitingANameTypedAsAnIDIsRefused(t *testing.T) {
	_, peer := newNode(t, "node-b", t.TempDir())
	store, handler, _ := resolvingNode(t, "node-a", map[string]*httptest.Server{"node-b": peer})
	conversation, err := store.Create("초대", nil, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	// "guibench-a" is a perfectly well-formed node id. Nothing about its SHAPE
	// says it is a name — only asking the node does.
	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "guibench-a"})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("a name typed as an id was accepted: %d %s", recorder.Code, recorder.Body.String())
	}
	// And nothing was added: the room is exactly as it was.
	view, _, _ := store.Get(id)
	for _, member := range view.Members {
		if member.NodeID == "guibench-a" {
			t.Fatal("the refused node was added anyway")
		}
	}

	// A real, reachable node still goes in.
	recorder = doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "node-b"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("a reachable node was refused: %d %s", recorder.Code, recorder.Body.String())
	}
}

// With the flag, the same string is a NAME and is looked up. Without it, it is
// an id. The module never guesses which was meant.
func TestInvitingByName(t *testing.T) {
	_, peer := newNode(t, "node-b", t.TempDir())
	store, handler, names := resolvingNode(t, "node-a", map[string]*httptest.Server{"node-b": peer})
	names.Learn("node-b", "부산 게이트웨이")
	conversation, _ := store.Create("이름으로 초대", nil, "")
	id := conversation.ConversationID

	recorder := doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "부산 게이트웨이", "node_by_name": true})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("invite by name: %d %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Member struct {
			NodeID string `json:"node_id"`
		} `json:"member"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Member.NodeID != "node-b" {
		t.Fatalf("the name resolved to %q", body.Member.NodeID)
	}

	// A name this node has never heard is refused rather than guessed at.
	recorder = doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "들어본 적 없음", "node_by_name": true})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("an unknown name was accepted: %d %s", recorder.Code, recorder.Body.String())
	}
	// And an id typed WITH the name flag is a name that nobody answers to.
	recorder = doJSON(t, handler, "POST", apiPrefix+"/conversations/"+id+"/members",
		map[string]any{"node_id": "node-b", "node_by_name": true})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("an id was silently accepted as a name: %d", recorder.Code)
	}
}

// Two nodes with one name is an ambiguity the caller has to settle, not one the
// module resolves by picking.
func TestAnAmbiguousNameIsRefused(t *testing.T) {
	store, handler, names := resolvingNode(t, "node-a", nil)
	names.Learn("node-b", "같은 이름")
	names.Learn("node-c", "같은 이름")
	conversation, _ := store.Create("모호", nil, "")

	recorder := doJSON(t, handler, "POST",
		apiPrefix+"/conversations/"+conversation.ConversationID+"/members",
		map[string]any{"node_id": "같은 이름", "node_by_name": true})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("an ambiguous name was resolved anyway: %d %s", recorder.Code, recorder.Body.String())
	}
}

// Removing must NOT require the node to answer. A member that cannot be reached
// is the main reason to remove one, and this is the path out of the room that
// the reported defect left no way to fix.
func TestRemovingAnUnreachableMemberWorks(t *testing.T) {
	store, handler, names := resolvingNode(t, "node-a", nil)
	conversation, err := store.Create("정리", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	names.Learn("node-b", "사라진 노드")

	// By id.
	recorder := doJSON(t, handler, "DELETE", apiPrefix+"/conversations/"+id+"/members/node-b", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("removing an unreachable member: %d %s", recorder.Code, recorder.Body.String())
	}

	// And by name, which also does not require an answer.
	if _, _, err := store.AddMember(id, "node-c", nil); err != nil {
		t.Fatalf("add: %v", err)
	}
	names.Learn("node-c", "또 사라진 노드")
	// The Gateway percent-encodes path parameters (params.go), so a name with a
	// space reaches the module intact; the test has to do the same by hand.
	recorder = doJSON(t, handler, "DELETE",
		apiPrefix+"/conversations/"+id+"/members/"+url.PathEscape("또 사라진 노드")+"?node_by_name=true", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("removing by name: %d %s", recorder.Code, recorder.Body.String())
	}
}

// A conversation can be named too, with the same rule: explicit flag, no
// guessing, ambiguity refused.
func TestConversationsResolveByName(t *testing.T) {
	store, handler, _ := resolvingNode(t, "node-a", nil)
	first, err := store.Create("현장 점검", nil, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.AppendMessage(first.ConversationID, "여기 있다", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+url.PathEscape("현장 점검")+"?conversation_by_name=true", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("by name: %d %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Conversation struct {
			ConversationID string `json:"conversation_id"`
		} `json:"conversation"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Conversation.ConversationID != first.ConversationID {
		t.Fatalf("resolved to %q", body.Conversation.ConversationID)
	}

	// And without the flag too. The flag used to be what turned the string into
	// a name; it is now only a way to be explicit, because a name that works on
	// one command and not the next is a rule nobody can hold in their head.
	recorder = doJSON(t, handler, "GET", apiPrefix+"/conversations/"+url.PathEscape("현장 점검"), nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("a name was refused without the flag: %d %s", recorder.Code, recorder.Body.String())
	}

	// A reference that is neither an id this node holds nor a name it knows is
	// still a miss, and still says so.
	recorder = doJSON(t, handler, "GET", apiPrefix+"/conversations/"+url.PathEscape("없는 방"), nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("an unknown reference was accepted: %d %s", recorder.Code, recorder.Body.String())
	}

	// Two rooms with one name is the caller's ambiguity to settle.
	if _, err := store.Create("현장 점검", nil, ""); err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, path := range []string{
		apiPrefix + "/conversations/" + url.PathEscape("현장 점검") + "?conversation_by_name=true",
		apiPrefix + "/conversations/" + url.PathEscape("현장 점검"),
	} {
		if recorder = doJSON(t, handler, "GET", path, nil); recorder.Code != http.StatusBadRequest {
			t.Fatalf("an ambiguous room name resolved anyway (%s): %d %s", path, recorder.Code, recorder.Body.String())
		}
	}
}
