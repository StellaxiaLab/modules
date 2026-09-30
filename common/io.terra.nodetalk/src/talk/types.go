// Package talk owns io.terra.nodetalk's conversation model and its on-disk
// form: per-author append-only logs under the module's data home (idea doc
// §4, plan §5). The shapes here mirror contracts/api/terra-api.json exactly —
// the contract is the source of truth, this package conforms to it.
package talk

import "regexp"

// Entry kinds. Messages arrived in M1; membership entries in M3 (the contract
// gained member_node_id first — contractVersion 0.2.0); deletion follows in M4.
const (
	KindMessage       = "message"
	KindMemberAdded   = "member-added"
	KindMemberRemoved = "member-removed"
	KindDeleted       = "deleted"
)

// Member states.
const (
	MemberActive  = "active"
	MemberRemoved = "removed"
)

// Transport is the instrumentation an entry carries about how it reached THIS
// node. It is empty on the authoring node — the author didn't travel.
type Transport struct {
	Rung         string `json:"rung"`
	RTTMs        int    `json:"rtt_ms,omitempty"`
	Attempts     int    `json:"attempts,omitempty"`
	FellBackFrom string `json:"fell_back_from,omitempty"`
}

// Entry is one log line. Its key is (conversation, author_node_id, seq): seq is
// monotonic within one author only, which is why merging replicas is a union
// with no conflicts. Display order is the (lamport, author_node_id) total
// order — wall_ms is for humans, never for sorting.
type Entry struct {
	AuthorNodeID string     `json:"author_node_id"`
	Kind         string     `json:"kind"`
	Lamport      int        `json:"lamport"`
	Seq          int        `json:"seq"`
	Epoch        int        `json:"epoch"`
	Text         string     `json:"text,omitempty"`
	MemberNodeID string     `json:"member_node_id,omitempty"` // kind=member-added/-removed의 대상
	Transport    *Transport `json:"transport,omitempty"`
	WallMs       int64      `json:"wall_ms,omitempty"`
}

// Member is one conversation member with its handover priority.
type Member struct {
	NodeID      string `json:"node_id"`
	Rank        int    `json:"rank"`
	State       string `json:"state"`
	JoinedEpoch int    `json:"joined_epoch"`
}

// Conversation is the API view of one conversation's control state. Role is
// computed per serving node (main_node_id == self), so it lives here and not
// in the stored meta.
type Conversation struct {
	ConversationID string   `json:"conversation_id"`
	CreatedBy      string   `json:"created_by,omitempty"`
	DisplayName    string   `json:"display_name"`
	Epoch          int      `json:"epoch"`
	MainNodeID     string   `json:"main_node_id"`
	Members        []Member `json:"members"`
	// MembersRev counts membership changes the main has made. The epoch is the
	// handover clock and does not move when someone joins, so without a second
	// number a node cannot tell a newer member list from the one it already
	// has — and would keep the list it joined with forever.
	MembersRev int    `json:"members_rev,omitempty"`
	Role       string `json:"role"`
}

// Summary is one conversations.list row: the conversation plus how many
// entries this node knows it is missing. M1 has no replication, so behind is
// honestly zero — "known missing: none", not "up to date with everyone".
type Summary struct {
	Behind int `json:"behind"`
	// LostOwn is the part of Behind this node wrote itself. Replication will
	// never close it — a node refuses its own lines back from a peer — so a
	// non-zero value here means the lines are gone from HERE and nowhere else.
	LostOwn      int          `json:"lost_own"`
	Conversation Conversation `json:"conversation"`
}

// StreamEvent is one messages.stream payload (contract output schema).
type StreamEvent struct {
	Event      string `json:"event"`
	Entry      *Entry `json:"entry,omitempty"`
	MainNodeID string `json:"main_node_id,omitempty"`
	Epoch      *int   `json:"epoch,omitempty"`
}

// Identifier rules. Conversation ids and author node ids become file and
// directory names under the data root, so the same rule that keeps them
// canonical also keeps path traversal impossible — an id that fails this
// pattern never reaches the filesystem.
var (
	validConversationID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
	validNodeID         = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)
)

// ValidNodeID reports whether id is usable as an author/member node id.
func ValidNodeID(id string) bool { return validNodeID.MatchString(id) }

// ValidConversationID reports whether id is usable as a conversation id.
func ValidConversationID(id string) bool { return validConversationID.MatchString(id) }
