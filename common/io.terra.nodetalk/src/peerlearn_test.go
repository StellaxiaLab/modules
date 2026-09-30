package main

import (
	"context"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// newLearningNode is newNode with the peer learner exposed — the bootstrap
// tests need to see what a node learned from being knocked on.
func newLearningNode(t *testing.T, nodeID, dir string) (*talk.Store, *httptest.Server, *peerLearner) {
	t.Helper()
	store, err := talk.NewStore(dir, func() string { return nodeID })
	if err != nil {
		t.Fatalf("store %s: %v", nodeID, err)
	}
	learner := newPeerLearner()
	server := httptest.NewServer(newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID),
		Store:         store,
		Peers:         learner,
	}))
	t.Cleanup(server.Close)
	return store, server, learner
}

// The bootstrap that could not happen before: two nodes, one invite, and
// NOTHING handed to the invited side — no static peers, no peers.json, no
// conversation to mine members from. Every other sync test seeds
// loopB.staticPeers, which is exactly why this hole survived: the tests handed
// B the answer the product could not.
//
// What crosses the gap is the main's own pull. A's loop reaches every active
// member each tick, so the invite alone puts A's knock on B's door, and the
// knock is signed by the Master (X-Terra-Principal) rather than by A.
func TestAnInvitedNodeLearnsItsPeerFromTheKnock(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, serverB, learnedByB := newLearningNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	conversation, err := storeA.Create("첫 대화", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := storeA.AppendMessage(id, "안녕", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	// B knows nobody, so B asks nobody — and stays empty however long it ticks.
	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.learned = learnedByB
	loopB.tick(ctx)
	if _, _, err := storeB.Get(id); err == nil {
		t.Fatal("B adopted a conversation while it knew no peer to pull from")
	}

	// A's ordinary tick: it pulls from every active member, so it knocks on B.
	loopA := newSyncLoop(storeA, httpDoor(t, "node-a", servers), staticNodeID("node-a"), t.TempDir())
	loopA.tick(ctx)

	if got := learnedByB.known(); len(got) != 1 || got[0] != "node-a" {
		t.Fatalf("B learned %v from the knock, want [node-a]", got)
	}

	// Now B has somebody to ask — and the conversation crosses by B's own pull.
	loopB.tick(ctx)
	adopted, marks, err := storeB.Get(id)
	if err != nil {
		t.Fatalf("B did not adopt after learning its peer: %v", err)
	}
	if adopted.MainNodeID != "node-a" {
		t.Fatalf("adopted view: %+v", adopted)
	}
	if marks["node-a"] != 1 {
		t.Fatalf("B's marks after the catch-up: %v", marks)
	}
	entries, _, err := storeB.Entries(id, 0, 0)
	if err != nil || len(entries) != 1 {
		t.Fatalf("B transcript: %v %d", err, len(entries))
	}
}

// A cut node must not become discoverable by knocking on the door that is
// refusing it — the learner sits BEHIND the fault middleware, so a
// force_offline partition teaches nothing.
func TestACutPeerIsNotLearnedThroughTheCut(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())

	faultsB := enabledFaults()
	faultsB.byNode["node-a"] = faultRule{ForceOffline: true}
	storeB, err := talk.NewStore(t.TempDir(), func() string { return "node-b" })
	if err != nil {
		t.Fatalf("store node-b: %v", err)
	}
	learnedByB := newPeerLearner()
	serverB := httptest.NewServer(newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID("node-b"),
		Store:         storeB,
		Faults:        faultsB,
		Peers:         learnedByB,
	}))
	t.Cleanup(serverB.Close)

	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}
	if _, err := storeA.Create("차단된 초대", []string{"node-b"}, ""); err != nil {
		t.Fatalf("create: %v", err)
	}

	loopA := newSyncLoop(storeA, httpDoor(t, "node-a", servers), staticNodeID("node-a"), t.TempDir())
	loopA.tick(ctx)

	if got := learnedByB.known(); len(got) != 0 {
		t.Fatalf("B learned %v through a cut that was refusing node-a", got)
	}
}

// The set is bounded: a fleet cannot grow this map without end.
func TestTheLearnedPeerSetIsBounded(t *testing.T) {
	learner := newPeerLearner()
	for i := 0; i < learnedPeerLimit+50; i++ {
		learner.learn("node-" + strconv.Itoa(i) + "-peer")
	}
	if got := len(learner.known()); got > learnedPeerLimit {
		t.Fatalf("learned set grew to %d, past the %d bound", got, learnedPeerLimit)
	}
	// A malformed id is not a peer.
	if learner.learn("   ") || learner.learn("") {
		t.Fatal("learner accepted an invalid node id")
	}
}
