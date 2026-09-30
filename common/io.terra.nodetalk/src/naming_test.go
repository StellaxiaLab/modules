package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// Names are put on when a line is read and never when it is written.
//
// The alternative — storing the name beside the author — puts a mutable piece of
// hearsay into the one structure this module treats as immutable, replicates it
// to every peer as fact, and freezes March's name onto March's lines forever.

func namedNode(t *testing.T, nodeID string) (*talk.Store, http.Handler, *directory, string) {
	t.Helper()
	root := t.TempDir()
	store, err := talk.NewStore(root, func() string { return nodeID })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	names := newDirectory(root)
	handler := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID), Store: store,
		Names: names, DisplayName: "이 노드",
	})
	return store, handler, names, root
}

// What a person reads is labelled; what is stored and what crosses to a peer is
// not.
func TestNamesAreAddedOnReadAndNeverStored(t *testing.T) {
	store, handler, names, root := namedNode(t, "node-a")
	names.Learn("node-b", "부산 게이트웨이")

	conversation, err := store.Create("이름", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := store.MergeEntries(id, []talk.Entry{{
		AuthorNodeID: "node-b", Kind: talk.KindMessage, Lamport: 1, Seq: 1, Text: "저쪽에서",
	}}, 0, nil); err != nil {
		t.Fatalf("merge: %v", err)
	}

	// Read: the label is there, and it is the learned name.
	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+id+"/messages", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list: %d", recorder.Code)
	}
	var listed struct {
		Entries []map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed.Entries) != 1 {
		t.Fatalf("entries: %+v", listed.Entries)
	}
	if listed.Entries[0]["author_name"] != "부산 게이트웨이" {
		t.Errorf("author_name = %v", listed.Entries[0]["author_name"])
	}
	// The identity is still there beside it — the room compares that, not this.
	if listed.Entries[0]["author_node_id"] != "node-b" {
		t.Errorf("the identity was replaced by the label: %v", listed.Entries[0])
	}

	// Stored: no name anywhere in the log.
	log, err := os.ReadFile(filepath.Join(root, "conversations", id, "log", "node-b.jsonl"))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if strings.Contains(string(log), "부산") || strings.Contains(string(log), "author_name") {
		t.Errorf("a name was written into the log:\n%s", log)
	}

	// Crossing to a peer: still no name. What replicates is the log.
	recorder = doJSON(t, handler, "GET",
		apiPrefix+"/conversations/"+id+"/replica?author_node_id=node-b", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("replica: %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "author_name") {
		t.Errorf("the replica window carried labels: %s", recorder.Body.String())
	}
}

// A node nobody has named shows its id. The fallback is what lets every surface
// print the field without checking, and a blank where a speaker belongs would be
// worse than an unreadable one.
func TestAnUnknownNodeShowsItsID(t *testing.T) {
	store, handler, _, _ := namedNode(t, "node-a")
	conversation, _ := store.Create("모르는 노드", []string{"node-b"}, "")
	id := conversation.ConversationID
	if _, err := store.AppendMessage(id, "내 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+id+"/messages", nil)
	var listed struct {
		Entries []map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if listed.Entries[0]["author_name"] != "node-a" {
		t.Errorf("an unnamed node did not fall back to its id: %v", listed.Entries[0])
	}
}

// The members of a conversation are labelled too — that is the list someone
// reads before deciding whom to invite or remove.
func TestConversationMembersCarryNames(t *testing.T) {
	store, handler, names, _ := namedNode(t, "node-a")
	names.Learn("node-b", "부산 게이트웨이")
	conversation, _ := store.Create("멤버 이름", []string{"node-b"}, "")

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+conversation.ConversationID, nil)
	var body struct {
		Conversation struct {
			MainNodeName string `json:"main_node_name"`
			Members      []struct {
				NodeID      string `json:"node_id"`
				DisplayName string `json:"display_name"`
			} `json:"members"`
		} `json:"conversation"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	found := map[string]string{}
	for _, member := range body.Conversation.Members {
		found[member.NodeID] = member.DisplayName
	}
	if found["node-b"] != "부산 게이트웨이" {
		t.Errorf("member labels: %v", found)
	}
	if found["node-a"] != "node-a" {
		t.Errorf("the local node should fall back to its id here: %v", found)
	}
	if body.Conversation.MainNodeName != "node-a" {
		t.Errorf("main_node_name = %q", body.Conversation.MainNodeName)
	}
}

// A name is hearsay a peer told us, so it is never allowed to stand in for an
// identity: the directory refuses a name that IS the id (that is the fallback,
// not a name) and refuses to file one under something that is not a node id.
func TestTheDirectoryRefusesNonsense(t *testing.T) {
	names := newDirectory(t.TempDir())
	names.Learn("node-b", "node-b")
	if got := names.Name("node-b"); got != "node-b" {
		t.Errorf("name = %q", got)
	}
	names.Learn("not a node id", "이름")
	if got := names.Name("not a node id"); got != "not a node id" {
		t.Errorf("a name was filed under a non-id: %q", got)
	}
	names.Learn("node-c", "")
	if got := names.Name("node-c"); got != "node-c" {
		t.Errorf("an empty name was stored: %q", got)
	}
}

// What a node has heard survives a restart: names are learned from peers, and
// re-learning every one of them on every boot would leave a room addressed by
// ids until the next sweep.
func TestTheDirectorySurvivesARestart(t *testing.T) {
	root := t.TempDir()
	first := newDirectory(root)
	first.Learn("node-b", "부산 게이트웨이")

	second := newDirectory(root)
	if got := second.Name("node-b"); got != "부산 게이트웨이" {
		t.Errorf("after a restart: %q", got)
	}
	if second.NeedsRefresh("node-b") {
		t.Error("a name just learned was already considered stale")
	}
	if !second.NeedsRefresh("node-z") {
		t.Error("a node never heard of should be asked about")
	}
}

// A node labels its own lines too. Names arrive from peers and a node never asks
// itself, so without a seed every surface would name everyone except the person
// reading it — the one missing label they would actually notice.
func TestANodeKnowsItsOwnName(t *testing.T) {
	root := t.TempDir()
	names := newDirectory(root)
	names.Learn("node-a", "내 기계")

	store, err := talk.NewStore(root, func() string { return "node-a" })
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	handler := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID("node-a"), Store: store,
		Names: names, DisplayName: "내 기계",
	})
	conversation, _ := store.Create("내 이름", []string{"node-b"}, "")
	if _, err := store.AppendMessage(conversation.ConversationID, "내가 쓴 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	recorder := doJSON(t, handler, "GET",
		apiPrefix+"/conversations/"+conversation.ConversationID+"/messages", nil)
	var listed struct {
		Entries []map[string]any `json:"entries"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if listed.Entries[0]["author_name"] != "내 기계" {
		t.Errorf("a node did not know its own name: %v", listed.Entries[0])
	}
}

// Every listing says which node it came from, on every row.
//
// This is the whole of a real confusion: one machine ran a Master host and a
// leaf daemon, each with its own nodetalk and its own conversations. A listing
// showing none looked like THE listing showing none, a delete answered
// "지정한 대화를 이 노드가 모른다" — perfectly true — and nothing anywhere said
// which node "this node" was. Three honest screens read as a contradiction.
//
// It goes on the ROW because the table renderer takes the first array in an
// object as its rows and drops the scalars beside it; a field next to the list
// would be correct and invisible.
func TestEveryListingSaysWhichNodeItCameFrom(t *testing.T) {
	store, handler, names, _ := namedNode(t, "node-a")
	names.Learn("node-a", "marui-server")
	if _, err := store.Create("어느 노드의 목록인가", nil, ""); err != nil {
		t.Fatalf("create: %v", err)
	}

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations", nil)
	var listed struct {
		Conversations []struct {
			OnNodeID   string `json:"on_node_id"`
			OnNodeName string `json:"on_node_name"`
		} `json:"conversations"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed.Conversations) != 1 {
		t.Fatalf("conversations: %+v", listed.Conversations)
	}
	if listed.Conversations[0].OnNodeID != "node-a" || listed.Conversations[0].OnNodeName != "marui-server" {
		t.Errorf("a row did not say where it came from: %+v", listed.Conversations[0])
	}
}

// And so does a single conversation, where the output is one object and the
// field can sit beside the rest.
func TestShowSaysWhichNodeAnswered(t *testing.T) {
	store, handler, names, _ := namedNode(t, "node-a")
	names.Learn("node-a", "marui-server")
	conversation, err := store.Create("어느 노드가 답했나", nil, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/"+conversation.ConversationID, nil)
	var body struct {
		OnNodeID   string `json:"on_node_id"`
		OnNodeName string `json:"on_node_name"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.OnNodeID != "node-a" || body.OnNodeName != "marui-server" {
		t.Errorf("show did not say which node answered: %+v", body)
	}
}

// The error a person actually saw. "지정한 대화를 이 노드가 모른다" was true and
// useless: the room was on the machine's OTHER node, and nothing in the sentence
// said which node had answered it.
func TestNotFoundNamesTheNodeThatDidNotKnow(t *testing.T) {
	_, handler, names, _ := namedNode(t, "node-a")
	names.Learn("node-a", "marui-server")

	recorder := doJSON(t, handler, "GET", apiPrefix+"/conversations/cv-nowhere", nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status: %d", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "marui-server") || !strings.Contains(body, "node-a") {
		t.Errorf("the refusal did not say which node refused: %s", body)
	}
}

// A node that lost its own lines is told they are gone from HERE, not that a
// sync is still trying.
//
// This happened: a data directory moved and the module's conversations did not
// move with it. The node re-adopted the room from its peer, pulled everyone
// else's lines, and could not pull its own — a node refuses its own lines back
// because it is the authority on its own log. "behind 3" then sat there forever,
// looking like replication in progress. It was not; it was a hole.
func TestLostOwnLinesAreReportedApartFromOrdinaryLag(t *testing.T) {
	store, handler, _, _ := namedNode(t, "node-a")
	conversation, err := store.Create("잃어버린 내 줄", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	// The peer holds three lines by THIS node and two by itself; this node holds
	// none of either.
	if err := store.UpdatePeerMarks(id, "node-b", map[string]int{"node-a": 3, "node-b": 2}); err != nil {
		t.Fatalf("marks: %v", err)
	}

	behind, lostOwn, err := store.Behind(id)
	if err != nil {
		t.Fatalf("behind: %v", err)
	}
	if behind != 5 || lostOwn != 3 {
		t.Fatalf("behind=%d lostOwn=%d, want 5 and 3", behind, lostOwn)
	}

	// And status says both rather than the hard-coded zero it used to.
	recorder := doJSON(t, handler, "GET", apiPrefix+"/status", nil)
	var body struct {
		BehindCount  int `json:"behind_count"`
		LostOwnCount int `json:"lost_own_count"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.BehindCount != 5 || body.LostOwnCount != 3 {
		t.Fatalf("status: %+v", body)
	}
}
