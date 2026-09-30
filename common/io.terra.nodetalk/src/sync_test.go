package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// httpDoor dispatches door calls to real handler servers by node id — the
// bench stand-in for host→Master→host, including the Master-stamped peer
// principal (callerNode). The module code under test cannot tell the
// difference: same doorFunc contract, same coded errors, same identity header.
func httpDoor(t *testing.T, callerNode string, servers map[string]*httptest.Server) doorFunc {
	return func(ctx context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		server, known := servers[node]
		if !known {
			return nil, &doorError{Code: "MODULE_UNAVAILABLE", Message: "no relay session for " + node}
		}
		var reader io.Reader
		if len(body) > 0 {
			reader = bytes.NewReader(body)
		}
		request, err := http.NewRequestWithContext(ctx, method, server.URL+path, reader)
		if err != nil {
			return nil, err
		}
		if callerNode != "" {
			request.Header.Set("X-Terra-Principal", peerPrincipalPrefix+callerNode)
		}
		if reader != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return nil, err
		}
		defer func() { _ = response.Body.Close() }()
		payload, err := io.ReadAll(response.Body)
		if err != nil {
			return nil, err
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			var envelope struct {
				Error apiError `json:"error"`
			}
			_ = json.Unmarshal(payload, &envelope)
			return nil, &doorError{Code: envelope.Error.Code, Message: envelope.Error.Message}
		}
		return payload, nil
	}
}

func newNode(t *testing.T, nodeID, dir string) (*talk.Store, *httptest.Server) {
	t.Helper()
	store, err := talk.NewStore(dir, func() string { return nodeID })
	if err != nil {
		t.Fatalf("store %s: %v", nodeID, err)
	}
	server := httptest.NewServer(newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID),
		Store:         store,
	}))
	t.Cleanup(server.Close)
	return store, server
}

// The M2 evidence, in process: a member that was never told anything catches
// up entirely by its own loop — adoption, marks, entries — and a node
// restarted over the same data dir catches up again without losing a line.
func TestSyncLoopCatchesUpAndSurvivesRestart(t *testing.T) {
	ctx := context.Background()
	dirA, dirB := t.TempDir(), t.TempDir()

	storeA, serverA := newNode(t, "node-a", dirA)
	storeB, serverB := newNode(t, "node-b", dirB)
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	// A creates the conversation naming B and writes two lines. B has nothing.
	conversation, err := storeA.Create("동기화 실증", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	for _, text := range []string{"첫 줄", "둘째 줄"} {
		if _, err := storeA.AppendMessage(id, text, ""); err != nil {
			t.Fatalf("append: %v", err)
		}
	}

	// B's loop, pointed at A only by the bootstrap peer list — exactly the
	// invited-while-offline shape.
	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.tick(ctx)

	adopted, marks, err := storeB.Get(id)
	if err != nil {
		t.Fatalf("B did not adopt the conversation: %v", err)
	}
	if adopted.MainNodeID != "node-a" || adopted.Role != "backup" {
		t.Fatalf("adopted view: %+v", adopted)
	}
	if marks["node-a"] != 2 {
		t.Fatalf("B's marks after sync: %v", marks)
	}
	entries, _, err := storeB.Entries(id, 0, 0)
	if err != nil || len(entries) != 2 {
		t.Fatalf("B transcript: %v %d", err, len(entries))
	}
	// The pulled lines carry the arrival instrumentation the loop measured.
	if entries[0].Transport == nil || entries[0].Transport.Rung != "L1" {
		t.Fatalf("pulled entry transport: %+v", entries[0].Transport)
	}

	// A writes a third line while "B is down" (its loop simply not running),
	// then B RESTARTS: fresh store over the same directory, fresh loop.
	if _, err := storeA.AppendMessage(id, "셋째 줄 — B 꺼진 사이", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	storeB2, serverB2 := newNode(t, "node-b", dirB)
	servers["node-b"] = serverB2
	loopB2 := newSyncLoop(storeB2, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	// No static peers this time: the restarted node knows its peers from the
	// conversation it already holds on disk.
	loopB2.staticPeers = nil
	loopB2.tick(ctx)

	entries, _, err = storeB2.Entries(id, 0, 0)
	if err != nil || len(entries) != 3 {
		t.Fatalf("B after restart: %v %d entries", err, len(entries))
	}
	if entries[2].Text != "셋째 줄 — B 꺼진 사이" {
		t.Fatalf("caught-up line: %+v", entries[2])
	}

	// Behind converges to zero on both sides once each has pulled (A pulls B's
	// marks too — symmetric loops).
	loopA := newSyncLoop(storeA, httpDoor(t, "node-a", servers), staticNodeID("node-a"), t.TempDir())
	loopA.tick(ctx)
	for name, store := range map[string]*talk.Store{"A": storeA, "B": storeB2} {
		behind, _, err := store.Behind(id)
		if err != nil {
			t.Fatalf("%s behind: %v", name, err)
		}
		if behind != 0 {
			t.Fatalf("%s behind = %d, want 0", name, behind)
		}
	}

	// A second identical tick moves nothing — the loop is idempotent end to end.
	before, _, _ := storeB2.Entries(id, 0, 0)
	loopB2.tick(ctx)
	after, _, _ := storeB2.Entries(id, 0, 0)
	if len(before) != len(after) {
		t.Fatalf("idle tick changed the transcript: %d -> %d", len(before), len(after))
	}
}

// Two nodes both writing while apart, then syncing: the union merges with no
// conflict and both read the SAME total order — the split-brain scenario the
// per-author design dissolves (D-1).
func TestSyncMergesConcurrentWritersIntoOneOrder(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, serverB := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	conversation, err := storeA.Create("분단 병합", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	// B adopts first (one tick), then both write "during the partition" —
	// no loop running.
	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.tick(ctx)
	for _, text := range []string{"a1", "a2"} {
		if _, err := storeA.AppendMessage(id, text, ""); err != nil {
			t.Fatal(err)
		}
	}
	for _, text := range []string{"b1", "b2"} {
		if _, err := storeB.AppendMessage(id, text, ""); err != nil {
			t.Fatal(err)
		}
	}

	// Partition heals: both loops tick.
	loopA := newSyncLoop(storeA, httpDoor(t, "node-a", servers), staticNodeID("node-a"), t.TempDir())
	loopA.tick(ctx)
	loopB.tick(ctx)
	// One more round so marks recorded before the last merge settle.
	loopA.tick(ctx)
	loopB.tick(ctx)

	texts := func(store *talk.Store) string {
		entries, _, err := store.Entries(id, 0, 0)
		if err != nil {
			t.Fatalf("entries: %v", err)
		}
		joined := ""
		for _, entry := range entries {
			joined += entry.Text + "|"
		}
		return joined
	}
	orderA, orderB := texts(storeA), texts(storeB)
	if orderA != orderB {
		t.Fatalf("orders diverge:\nA: %s\nB: %s", orderA, orderB)
	}
	if len(orderA) == 0 || bytes.Count([]byte(orderA), []byte("|")) != 4 {
		t.Fatalf("union incomplete: %s", orderA)
	}
}

// The push endpoint's duplicates field is the wire-observable idempotency
// proof (evidence ②): the same slice twice answers duplicates the second time.
func TestReplicaPushAnswersDuplicatesOnResend(t *testing.T) {
	store, server := newNode(t, "node-a", t.TempDir())
	conversation, err := store.Create("push 멱등", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID

	push := func() (accepted, duplicates int) {
		t.Helper()
		payload := map[string]any{
			"sender_epoch": 0,
			"entries": []map[string]any{
				{"author_node_id": "node-b", "kind": "message", "lamport": 1, "seq": 1, "text": "밀어넣기"},
			},
		}
		raw, _ := json.Marshal(payload)
		response, err := http.Post(server.URL+apiPrefix+"/conversations/"+id+"/replica", "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Fatalf("push: %v", err)
		}
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode != http.StatusAccepted {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("push status %d: %s", response.StatusCode, body)
		}
		var result struct {
			Accepted   int `json:"accepted"`
			Duplicates int `json:"duplicates"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatalf("decode push result: %v", err)
		}
		return result.Accepted, result.Duplicates
	}

	if accepted, duplicates := push(); accepted != 1 || duplicates != 0 {
		t.Fatalf("first push: accepted=%d duplicates=%d", accepted, duplicates)
	}
	if accepted, duplicates := push(); accepted != 0 || duplicates != 1 {
		t.Fatalf("resend: accepted=%d duplicates=%d — idempotency must be observable", accepted, duplicates)
	}
}

// A push carrying a stale epoch is refused with the contract's code.
func TestReplicaPushRefusesStaleEpoch(t *testing.T) {
	store, server := newNode(t, "node-a", t.TempDir())
	conversation, err := store.Create("epoch 거절", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	view, _, _ := store.Get(conversation.ConversationID)
	view.Epoch = 3
	if _, err := store.AdoptConversation(view); err != nil {
		t.Fatalf("raise epoch: %v", err)
	}

	payload, _ := json.Marshal(map[string]any{
		"sender_epoch": 1,
		"entries": []map[string]any{
			{"author_node_id": "node-b", "kind": "message", "lamport": 1, "seq": 1, "text": "낡은 소식"},
		},
	})
	response, err := http.Post(server.URL+apiPrefix+"/conversations/"+conversation.ConversationID+"/replica",
		"application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("stale push status: %d", response.StatusCode)
	}
	var envelope struct {
		Error apiError `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil || envelope.Error.Code != "EPOCH_STALE" {
		t.Fatalf("stale push code: %v %+v", err, envelope)
	}
}

// The M3 evidence, in process: node-b outranks the creating main (explicit
// order — D-2), catches up, claims, and mainship moves with epoch+1; the
// ex-main adopts its demotion on its own next tick; a message posted around
// the handover survives on both sides (evidence ④).
func TestSyncHandoverMovesMainToOutrankingNode(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, serverB := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	// Creator lists itself SECOND: node-b rank 0, node-a rank 1 — yet node-a,
	// having opened the conversation, is the epoch-0 main (the user model:
	// 먼저 연 노드가 메인, 우선순위는 초대 순서).
	conversation, err := storeA.Create("인수인계 실증", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if conversation.MainNodeID != "node-a" || conversation.Members[0].NodeID != "node-b" {
		t.Fatalf("fixture: %+v", conversation)
	}
	if _, err := storeA.AppendMessage(id, "메인 시절의 한 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	// A settle window that has not elapsed must hold the claim (§5.5).
	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour
	loopB.tick(ctx)
	if view, _, err := storeB.Get(id); err != nil || view.MainNodeID != "node-a" {
		t.Fatalf("settle window did not hold the claim: %v %+v", err, view)
	}

	// With the window elapsed (settle 0), the same eligibility claims.
	loopB.settle = 0
	loopB.tick(ctx)
	viewB, _, err := storeB.Get(id)
	if err != nil {
		t.Fatalf("get B: %v", err)
	}
	if viewB.MainNodeID != "node-b" || viewB.Epoch != 1 || viewB.Role != "main" {
		t.Fatalf("handover did not land on B: %+v", viewB)
	}

	// Evidence ④: the ex-main keeps writing — appends need no main (D-1).
	if _, err := storeA.AppendMessage(id, "인수인계 언저리의 한 줄", ""); err != nil {
		t.Fatalf("append around handover: %v", err)
	}

	// The ex-main learns of its demotion by its own loop, and the transcripts
	// converge to the same total order.
	loopA := newSyncLoop(storeA, httpDoor(t, "node-a", servers), staticNodeID("node-a"), t.TempDir())
	loopA.settle = 0
	loopA.tick(ctx)
	viewA, _, err := storeA.Get(id)
	if err != nil {
		t.Fatalf("get A: %v", err)
	}
	if viewA.MainNodeID != "node-b" || viewA.Epoch != 1 || viewA.Role != "backup" {
		t.Fatalf("ex-main did not adopt its demotion: %+v", viewA)
	}
	loopB.tick(ctx)
	entriesA, _, _ := storeA.Entries(id, 0, 0)
	entriesB, _, _ := storeB.Entries(id, 0, 0)
	if len(entriesA) != 2 || len(entriesB) != 2 {
		t.Fatalf("transcripts after handover: A=%d B=%d", len(entriesA), len(entriesB))
	}
	for i := range entriesA {
		if entriesA[i].Text != entriesB[i].Text {
			t.Fatalf("order diverged at %d: %q vs %q", i, entriesA[i].Text, entriesB[i].Text)
		}
	}

	// The now-backup ex-main never claims back (rank 1 does not outrank 0).
	loopA.tick(ctx)
	if view, _, _ := storeA.Get(id); view.MainNodeID != "node-b" {
		t.Fatalf("underranked node claimed back: %+v", view)
	}
}

// A door-relayed claim whose body contradicts the Master-stamped principal is
// refused before the store sees it.
func TestMainClaimEndpointVerifiesPeerPrincipal(t *testing.T) {
	store, server := newNode(t, "node-a", t.TempDir())
	conversation, err := store.Create("주장 검증", []string{"node-b", "node-a"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	payload, _ := json.Marshal(map[string]any{
		"claimant_node_id": "node-b",
		"claimed_epoch":    1,
		"high_water_marks": map[string]int{},
	})
	request, _ := http.NewRequest("POST",
		server.URL+apiPrefix+"/conversations/"+conversation.ConversationID+"/main", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	// A stranger forging a claim is now stopped one step earlier, by not being a
	// member at all — and answered 404, so it does not learn the conversation
	// exists (api.go peerAccess). The handler's own check is what catches the
	// case that gets past that: a real MEMBER claiming in another member's name.
	request.Header.Set("X-Terra-Principal", "module:io.terra.nodetalk@node-x")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("stranger claim: got %d, want 404", response.StatusCode)
	}

	member, _ := http.NewRequest("POST",
		server.URL+apiPrefix+"/conversations/"+conversation.ConversationID+"/main", bytes.NewReader(payload))
	member.Header.Set("Content-Type", "application/json")
	member.Header.Set("X-Terra-Principal", "module:io.terra.nodetalk@node-a")
	memberResponse, err := http.DefaultClient.Do(member)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	defer func() { _ = memberResponse.Body.Close() }()
	if memberResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("member forging another member's claim: got %d, want 400", memberResponse.StatusCode)
	}
}

// newFaultyNode is newNode with an injectable fault state wired into the
// handler (inbound middleware + status).
func newFaultyNode(t *testing.T, nodeID, dir string, faults *faultState) (*talk.Store, *httptest.Server) {
	t.Helper()
	store, err := talk.NewStore(dir, func() string { return nodeID })
	if err != nil {
		t.Fatalf("store %s: %v", nodeID, err)
	}
	server := httptest.NewServer(newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID(nodeID),
		Store:         store,
		Faults:        faults,
	}))
	t.Cleanup(server.Close)
	return store, server
}

func enabledFaults() *faultState {
	state := newFaultState()
	state.enabled = true
	return state
}

// M4, the whole arc in process: the main deletes while a member is offline —
// the receipt says so (pending_nodes) — and the member, coming back with its
// copy, learns the 410 from its recorded main, tombstones, and cannot be
// resurrected from either side.
func TestDeletionPropagatesAndBlocksResurrection(t *testing.T) {
	ctx := context.Background()
	dirB := t.TempDir()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, serverB := newNode(t, "node-b", dirB)
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}
	doorA := httpDoor(t, "node-a", servers)

	conversation, err := storeA.Create("삭제 전파", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := storeA.AppendMessage(id, "지워질 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}
	loopB := newSyncLoop(storeB, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour
	loopB.tick(ctx)
	if _, _, err := storeB.Get(id); err != nil {
		t.Fatalf("B never adopted: %v", err)
	}

	// B goes "offline": its server closes, so the fan-out cannot reach it.
	serverB.Close()
	delete(servers, "node-b")

	// A (main) deletes through its own endpoint, door wired for fan-out.
	handlerA := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID("node-a"), Store: storeA, Door: doorA,
	})
	recorder := httptest.NewRecorder()
	handlerA.ServeHTTP(recorder, httptest.NewRequest("DELETE", apiPrefix+"/conversations/"+id, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", recorder.Code, recorder.Body.String())
	}
	var receipt struct {
		AcknowledgedBy []string `json:"acknowledged_by"`
		PendingNodes   []string `json:"pending_nodes"`
	}
	decodeInto(t, recorder, &receipt)
	if len(receipt.PendingNodes) != 1 || receipt.PendingNodes[0] != "node-b" {
		t.Fatalf("receipt must name the unreachable member: %+v", receipt)
	}

	// A's own copy is one removed directory + a tombstone: 410 from now on.
	if _, _, err := storeA.Get(id); !errors.Is(err, talk.ErrDeleted) {
		t.Fatalf("A after delete: %v", err)
	}

	// B comes back with its copy. Its loop asks its recorded main about the
	// conversation the main no longer lists, hears 410, and accepts.
	storeB2, serverB2 := newNode(t, "node-b", dirB)
	servers["node-b"] = serverB2
	loopB2 := newSyncLoop(storeB2, httpDoor(t, "node-b", servers), staticNodeID("node-b"), t.TempDir())
	loopB2.settle = time.Hour
	loopB2.tick(ctx)
	if _, _, err := storeB2.Get(id); !errors.Is(err, talk.ErrDeleted) {
		t.Fatalf("B did not learn the deletion: %v", err)
	}

	// And the resurrection is blocked: a stale copy cannot be adopted back.
	if _, err := storeA.AdoptConversation(conversation); !errors.Is(err, talk.ErrDeleted) {
		t.Fatalf("resurrection on A: %v", err)
	}
}

// M5 evidence: a forced partition reproduces the split-brain arc on purpose —
// both sides write while cut, nothing crosses, and healing converges both
// transcripts to one order.
func TestFaultPartitionReproducesSplitAndHeal(t *testing.T) {
	ctx := context.Background()
	faultsA, faultsB := enabledFaults(), enabledFaults()
	storeA, serverA := newFaultyNode(t, "node-a", t.TempDir(), faultsA)
	storeB, serverB := newFaultyNode(t, "node-b", t.TempDir(), faultsB)
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	conversation, err := storeA.Create("분단 주입", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	loopA := newSyncLoop(storeA, faultDoor(faultsA, httpDoor(t, "node-a", servers)), staticNodeID("node-a"), t.TempDir())
	loopA.settle = time.Hour
	loopA.faults = faultsA
	loopB := newSyncLoop(storeB, faultDoor(faultsB, httpDoor(t, "node-b", servers)), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour
	loopB.faults = faultsB
	loopB.tick(ctx)

	// The cut: A offlines node-b outbound; B refuses node-a inbound — both
	// directions of module traffic die while the screens keep working.
	faultsA.byNode["node-b"] = faultRule{ForceOffline: true}
	faultsB.byNode["node-a"] = faultRule{ForceOffline: true}

	if _, err := storeA.AppendMessage(id, "a: during the cut", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := storeB.AppendMessage(id, "b: during the cut", ""); err != nil {
		t.Fatal(err)
	}
	loopA.tick(ctx)
	loopB.tick(ctx)
	entriesA, _, _ := storeA.Entries(id, 0, 0)
	entriesB, _, _ := storeB.Entries(id, 0, 0)
	if len(entriesA) != 1 || len(entriesB) != 1 {
		t.Fatalf("partition leaked: A=%d B=%d", len(entriesA), len(entriesB))
	}

	// Heal and converge.
	delete(faultsA.byNode, "node-b")
	delete(faultsB.byNode, "node-a")
	loopA.tick(ctx)
	loopB.tick(ctx)
	entriesA, _, _ = storeA.Entries(id, 0, 0)
	entriesB, _, _ = storeB.Entries(id, 0, 0)
	if len(entriesA) != 2 || len(entriesB) != 2 {
		t.Fatalf("heal did not converge: A=%d B=%d", len(entriesA), len(entriesB))
	}
	for i := range entriesA {
		if entriesA[i].Text != entriesB[i].Text {
			t.Fatalf("orders diverge at %d", i)
		}
	}
}

// Retries are data: a pull that lands after injected failures carries the true
// attempt count, and the injected drop announces itself with its own code.
func TestInjectedDropsStampTrueAttemptCounts(t *testing.T) {
	ctx := context.Background()
	storeA, serverA := newNode(t, "node-a", t.TempDir())
	storeB, _ := newNode(t, "node-b", t.TempDir())
	servers := map[string]*httptest.Server{"node-a": serverA}

	conversation, err := storeA.Create("재시도 계측", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	if _, err := storeA.AppendMessage(id, "세 번 만에 온 줄", ""); err != nil {
		t.Fatal(err)
	}

	// A door that fails twice before delegating — the shape any drop_rate
	// produces, made deterministic for the assertion.
	failures := 0
	inner := httpDoor(t, "node-b", servers)
	flaky := func(ctx context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		if strings.Contains(path, "/replica") && failures < 2 {
			failures++
			return nil, &doorError{Code: "FAULT_INJECTED_DROP", Message: "fault: dropped by injected rate"}
		}
		return inner(ctx, node, method, path, body)
	}
	loopB := newSyncLoop(storeB, flaky, staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour
	loopB.tick(ctx) // adopt + first pull attempt fails
	loopB.tick(ctx) // second pull attempt fails
	loopB.tick(ctx) // third lands
	entries, _, err := storeB.Entries(id, 0, 0)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries: %v %d", err, len(entries))
	}
	if entries[0].Transport == nil || entries[0].Transport.Attempts != 3 {
		t.Fatalf("attempts not stamped truthfully: %+v", entries[0].Transport)
	}

	// The injector itself: rate 1.0 always drops, with its own code.
	state := enabledFaults()
	state.global = faultRule{DropRate: 1}
	dropped := faultDoor(state, inner)
	if _, err := dropped(ctx, "node-a", "GET", apiPrefix+"/status", nil); err == nil ||
		!strings.Contains(err.Error(), "FAULT_INJECTED_DROP") {
		t.Fatalf("drop rate 1.0 did not drop: %v", err)
	}
}

// The faults surface is a dev-assembly gate (D-7): disabled answers the
// contract error, enabled applies and counts.
func TestFaultsEndpointGate(t *testing.T) {
	_, serverOff := newNode(t, "node-a", t.TempDir())
	request, err := http.NewRequest("PUT", serverOff.URL+apiPrefix+"/faults", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	answered, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = answered.Body.Close() }()
	if answered.StatusCode != http.StatusNotFound {
		t.Fatalf("disabled faults: got %d, want 404", answered.StatusCode)
	}

	faults := enabledFaults()
	_, serverOn := newFaultyNode(t, "node-b", t.TempDir(), faults)
	payload := []byte(`{"target_node_id":"node-c","force_offline":true,"delay_ms":100}`)
	apply, _ := http.NewRequest("PUT", serverOn.URL+apiPrefix+"/faults", bytes.NewReader(payload))
	apply.Header.Set("Content-Type", "application/json")
	applied, err := http.DefaultClient.Do(apply)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = applied.Body.Close() }()
	var result struct {
		Applied      bool `json:"applied"`
		ActiveFaults int  `json:"active_faults"`
	}
	if err := json.NewDecoder(applied.Body).Decode(&result); err != nil || !result.Applied || result.ActiveFaults != 1 {
		t.Fatalf("apply: %v %+v", err, result)
	}
	if !faults.ruleFor("node-c").ForceOffline {
		t.Fatal("rule did not land in state")
	}
}

// R0's safety claim, end to end: push is the fast path and pull is the truth.
// The cut makes every push fail; the healed loop still converges, and nothing
// is lost or doubled — which is what lets delivery be best-effort at all.
func TestPushFailsUnderPartitionAndPullStillConverges(t *testing.T) {
	ctx := context.Background()
	faultsA, faultsB := enabledFaults(), enabledFaults()
	storeA, serverA := newFaultyNode(t, "node-a", t.TempDir(), faultsA)
	storeB, serverB := newFaultyNode(t, "node-b", t.TempDir(), faultsB)
	servers := map[string]*httptest.Server{"node-a": serverA, "node-b": serverB}

	conversation, err := storeA.Create("push 실패 후 pull", []string{"node-b"}, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := conversation.ConversationID
	loopB := newSyncLoop(storeB, faultDoor(faultsB, httpDoor(t, "node-b", servers)), staticNodeID("node-b"), t.TempDir())
	loopB.staticPeers = []string{"node-a"}
	loopB.settle = time.Hour
	loopB.faults = faultsB
	loopB.tick(ctx)

	// Cut both directions, then write on A. Every push A attempts dies here.
	faultsA.byNode["node-b"] = faultRule{ForceOffline: true}
	faultsB.byNode["node-a"] = faultRule{ForceOffline: true}
	handlerA := newOperationsHandler(serverDeps{
		ResolveNodeID: staticNodeID("node-a"), Store: storeA,
		Door: faultDoor(faultsA, httpDoor(t, "node-a", servers)),
	})
	for _, text := range []string{"분단 중 1", "분단 중 2"} {
		recorder := doJSON(t, handlerA, "POST", apiPrefix+"/conversations/"+id+"/messages",
			map[string]any{"text": text})
		if recorder.Code != http.StatusCreated {
			t.Fatalf("post during the cut: %d %s", recorder.Code, recorder.Body.String())
		}
	}
	time.Sleep(300 * time.Millisecond) // let the doomed pushes finish failing
	loopB.tick(ctx)
	if entries, _, _ := storeB.Entries(id, 0, 0); len(entries) != 0 {
		t.Fatalf("nothing may cross the cut, got %d", len(entries))
	}

	// Heal. The pull loop alone recovers both lines, in order, exactly once.
	delete(faultsA.byNode, "node-b")
	delete(faultsB.byNode, "node-a")
	loopB.tick(ctx)
	entries, _, err := storeB.Entries(id, 0, 0)
	if err != nil || len(entries) != 2 {
		t.Fatalf("pull did not fill the hole: %v %d", err, len(entries))
	}
	if entries[0].Text != "분단 중 1" || entries[1].Text != "분단 중 2" {
		t.Fatalf("order: %+v", entries)
	}

	// And a late push of what pull already delivered is a duplicate, not a
	// second copy — the two paths overlap harmlessly by design.
	recorder := doJSON(t, handlerA, "POST", apiPrefix+"/conversations/"+id+"/messages",
		map[string]any{"text": "치유 후"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("post after heal: %d", recorder.Code)
	}
	time.Sleep(400 * time.Millisecond) // the push lands on its own now
	loopB.tick(ctx)                    // and the pull runs over the same ground
	entries, _, _ = storeB.Entries(id, 0, 0)
	if len(entries) != 3 {
		t.Fatalf("push and pull together produced %d entries, want 3", len(entries))
	}
}
