package talk

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDeleteAsMainRemovesEverythingButLeavesTheTombstone(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("삭제 대상", []string{"node-b", "node-c"}, "")
	id := conversation.ConversationID
	if _, err := store.AppendMessage(id, "곧 사라질 줄", ""); err != nil {
		t.Fatalf("append: %v", err)
	}

	tombstone, peers, err := store.DeleteAsMain(id)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if tombstone.ByNode != "node-a" || tombstone.DeletedAtEpoch != 0 {
		t.Fatalf("tombstone: %+v", tombstone)
	}
	if len(peers) != 2 {
		t.Fatalf("peers to notify: %v", peers)
	}
	// 원래 요구사항: 세션이 지워지면 메시지도 자동 삭제 — 디렉터리 하나.
	if _, err := os.Stat(filepath.Join(store.root, "conversations", id)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("conversation directory survived deletion")
	}
	// Every operation now answers "deleted", not "unknown".
	if _, _, err := store.Get(id); !errors.Is(err, ErrDeleted) {
		t.Fatalf("get after delete: %v", err)
	}
	if _, err := store.AppendMessage(id, "유령 줄", ""); !errors.Is(err, ErrDeleted) {
		t.Fatalf("append after delete: %v", err)
	}
	if _, err := store.MergeEntries(id, entriesOf("node-b", 1), 0, nil); !errors.Is(err, ErrDeleted) {
		t.Fatalf("merge after delete: %v", err)
	}

	// Idempotent: the second delete answers the recorded receipt.
	again, _, err := store.DeleteAsMain(id)
	if err != nil || again.DeletedAtMs != tombstone.DeletedAtMs {
		t.Fatalf("second delete: %v %+v", err, again)
	}
}

func TestDeleteIsMainOnly(t *testing.T) {
	origin := newTestStore(t, "node-a")
	conversation, _ := origin.Create("남의 것", []string{"node-b"}, "")
	view, _, _ := origin.Get(conversation.ConversationID)

	backup := newTestStore(t, "node-b")
	if _, err := backup.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if _, _, err := backup.DeleteAsMain(conversation.ConversationID); !errors.Is(err, ErrNotMain) {
		t.Fatalf("backup deleting: %v", err)
	}
}

func TestAcceptDeletionTrustsOnlyTheRecordedMain(t *testing.T) {
	origin := newTestStore(t, "node-a")
	conversation, _ := origin.Create("전파 삭제", []string{"node-b", "node-a"}, "")
	id := conversation.ConversationID
	view, _, _ := origin.Get(id)

	member := newTestStore(t, "node-b")
	if _, err := member.AdoptConversation(view); err != nil {
		t.Fatalf("adopt: %v", err)
	}
	// A node that is not the recorded main cannot push a deletion.
	if _, err := member.AcceptDeletion(id, "node-z"); !errors.Is(err, ErrNotMain) {
		t.Fatalf("stranger deletion: %v", err)
	}
	// After a handover (arriving here as an adopted higher epoch naming
	// node-b main), the EX-main's deletion bounces the same way.
	view.Epoch = 1
	view.MainNodeID = "node-b"
	if _, err := member.AdoptConversation(view); err != nil {
		t.Fatalf("adopt handover: %v", err)
	}
	if _, err := member.AcceptDeletion(id, "node-a"); !errors.Is(err, ErrNotMain) {
		t.Fatalf("ex-main deletion: %v", err)
	}
	// The recorded main's intent lands.
	tombstone, err := member.AcceptDeletion(id, "node-b")
	if err != nil || tombstone.ByNode != "node-b" || tombstone.DeletedAtEpoch != 1 {
		t.Fatalf("main deletion: %v %+v", err, tombstone)
	}
}

// The resurrection block (M4 evidence ①): a peer still carrying its copy
// cannot re-plant a deleted conversation — within the window. Past the
// window it CAN, which is D-4's documented limit, so the test pins both.
func TestTombstoneBlocksResurrectionWithinTheWindow(t *testing.T) {
	store := newTestStore(t, "node-a")
	conversation, _ := store.Create("부활 금지", []string{"node-b"}, "")
	id := conversation.ConversationID
	view, _, _ := store.Get(id)
	if _, _, err := store.DeleteAsMain(id); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if _, err := store.AdoptConversation(view); !errors.Is(err, ErrDeleted) {
		t.Fatalf("adoption within the window: %v", err)
	}
	deleted, err := store.IsDeleted(id)
	if err != nil || !deleted {
		t.Fatalf("IsDeleted: %v %v", deleted, err)
	}

	// Past the retention window the tombstone expires and the same adoption
	// succeeds — the limit is real, documented, and pinned here.
	store.SetTombstoneTTL(time.Millisecond)
	time.Sleep(5 * time.Millisecond)
	adopted, err := store.AdoptConversation(view)
	if err != nil || !adopted {
		t.Fatalf("adoption past the window: %v %v", adopted, err)
	}
}
