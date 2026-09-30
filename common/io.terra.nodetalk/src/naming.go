package main

// Putting names on the way out.
//
// A name is resolved when a line is READ, never when it is written. The log is
// per-author and append-only: a line written in March records who wrote it, and
// if that node is renamed in April the March line should say the new name, not
// preserve the old one forever. Storing the name would also put a mutable,
// hearsay field into the one structure this module treats as immutable, and
// replicate it to every peer as though it were fact.
//
// So these types wrap what the store holds and add the label beside it. The
// embedded struct keeps the wire shape identical for everything that was already
// there — a reader that does not know about names sees exactly what it saw
// before.
//
// The peer-facing replica routes deliberately get NONE of this. What crosses
// between nodes is the log, and the log has no names in it.

import "github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"

// namedEntry is one transcript line with the labels a person reads.
type namedEntry struct {
	talk.Entry
	// AuthorName is what to call the author, falling back to the id so this
	// field is always something a renderer can print.
	AuthorName string `json:"author_name"`
	// MemberName is the same for the node a membership line is ABOUT; empty on
	// lines that are not about anyone.
	MemberName string `json:"member_name,omitempty"`
}

// namedMember is one member of a conversation with its label.
type namedMember struct {
	talk.Member
	DisplayName string `json:"display_name"`
}

// namedConversation is a conversation whose members and main carry labels.
type namedConversation struct {
	talk.Conversation
	Members      []namedMember `json:"members"`
	MainNodeName string        `json:"main_node_name"`
}

// namedSummary is one row of the conversation list.
//
// OnNodeID and OnNodeName say WHICH NODE this row came from, and they are on
// every row rather than beside the list because that is the only place a table
// will show them: the renderer takes the first array in an object as its rows
// and drops the scalars next to it.
//
// The repetition buys the one thing the listing could not say. A machine can run
// more than one node — a Master host and a leaf daemon both run this module —
// and each keeps its own conversations. A list with no node on it looks like THE
// list, and "지정한 대화를 이 노드가 모른다" is an honest answer that helps
// nobody when the reader cannot tell which node "this node" was.
type namedSummary struct {
	Behind       int               `json:"behind"`
	OnNodeID     string            `json:"on_node_id"`
	OnNodeName   string            `json:"on_node_name"`
	Conversation namedConversation `json:"conversation"`
}

func (s *apiServer) nameOf(nodeID string) string {
	if s.deps.Names == nil {
		return nodeID
	}
	return s.deps.Names.Name(nodeID)
}

func (s *apiServer) nameEntry(entry talk.Entry) namedEntry {
	named := namedEntry{Entry: entry, AuthorName: s.nameOf(entry.AuthorNodeID)}
	if entry.MemberNodeID != "" {
		named.MemberName = s.nameOf(entry.MemberNodeID)
	}
	return named
}

func (s *apiServer) nameEntries(entries []talk.Entry) []namedEntry {
	named := make([]namedEntry, 0, len(entries))
	for _, entry := range entries {
		named = append(named, s.nameEntry(entry))
	}
	return named
}

func (s *apiServer) nameConversation(conversation talk.Conversation) namedConversation {
	named := namedConversation{
		Conversation: conversation,
		Members:      make([]namedMember, 0, len(conversation.Members)),
		MainNodeName: s.nameOf(conversation.MainNodeID),
	}
	for _, member := range conversation.Members {
		named.Members = append(named.Members, namedMember{
			Member: member, DisplayName: s.nameOf(member.NodeID),
		})
	}
	return named
}

// namedStreamEvent is one live event with its labels. The room reads history and
// stream through the same declaration, so they have to answer the same shape —
// otherwise names appear on what was already said and ids on everything after.
type namedStreamEvent struct {
	Event        string      `json:"event"`
	Entry        *namedEntry `json:"entry,omitempty"`
	MainNodeID   string      `json:"main_node_id,omitempty"`
	MainNodeName string      `json:"main_node_name,omitempty"`
	Epoch        *int        `json:"epoch,omitempty"`
}

func (s *apiServer) nameStreamEvent(event talk.StreamEvent) namedStreamEvent {
	named := namedStreamEvent{Event: event.Event, MainNodeID: event.MainNodeID, Epoch: event.Epoch}
	if event.Entry != nil {
		entry := s.nameEntry(*event.Entry)
		named.Entry = &entry
	}
	if event.MainNodeID != "" {
		named.MainNodeName = s.nameOf(event.MainNodeID)
	}
	return named
}
