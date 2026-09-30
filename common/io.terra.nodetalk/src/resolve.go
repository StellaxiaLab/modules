package main

// Turning what a person typed into what the module addresses things by.
//
// A node id and a display name once looked alike enough that one got typed where
// the other belonged — `guibench-a` passed every shape check a node id had. The
// module accepted it, put a node that does not exist into a room, and there was
// no way to tell until nothing ever arrived from it. **A name that reaches the
// wrong field is worse than a name that is rejected**, because the room keeps
// working just enough to look fine.
//
// The first answer was to make resolution explicit: a `--display-name` flag said
// "this one is a name". That fixed the ambiguity and created a worse problem. The
// flag existed on two of this module's eleven commands, so a name worked for
// `invite` and was an unknown option everywhere else, and no other module had
// anything like it — while `terra node get` had accepted names all along. The
// operator-visible rule became "it depends which command you are in".
//
// Resolution is transparent now, and the ambiguity is closed at the source
// instead: a display name may no longer be SHAPED like a node id or a cluster
// address (terra-protocol/noderef.go, enforced by the Master when a name is
// set). With the shapes disjoint there is nothing left to guess between, so
// asking the operator to declare which kind they meant bought nothing and cost
// them the flag.
//
// The `*_by_name` inputs are still accepted. The CLI no longer sends them — it
// resolves before it calls — but the GUI and direct API callers may, and a
// caller that says "this is a name" is answered as one.

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// conversationFrom resolves the conversation a request names.
//
// The by-name flag arrives as a query parameter on the methods that carry no
// body and in the body on the ones that do — that is where the Gateway puts a
// flat input for each. Callers that decoded a body pass what they found.
//
// Peer-facing routes never call this: what crosses between nodes is always an
// id, because a name is this node's opinion and the peer has its own.
func (s *apiServer) conversationFrom(r *http.Request, byNameFromBody bool) (string, error) {
	byName := byNameFromBody || r.URL.Query().Get("conversation_by_name") == "true"
	return s.resolveConversation(r.PathValue("conversation_id"), byName)
}

// resolveConversation answers the conversation id for what a caller typed.
//
// A name that matches two conversations is refused rather than resolved to the
// first: acting on one of two rooms someone might have meant is the kind of
// wrong that only shows up afterwards.
// An id this node holds wins over a name, because the id is what the log is
// keyed by and a name is a label somebody chose. Only when nothing answers to
// the reference as an id is it looked up as a name.
//
// byName forces the name lookup and skips the id step. It is what a caller sets
// to say "this is definitely a name" — which matters for a room deliberately
// named after another room's id, the one case the precedence above gets wrong.
func (s *apiServer) resolveConversation(reference string, byName bool) (string, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", fmt.Errorf("%w: 대화를 지정해야 한다", talk.ErrInvalid)
	}
	summaries, err := s.deps.Store.List()
	if err != nil {
		return "", err
	}
	if !byName {
		for _, summary := range summaries {
			if summary.Conversation.ConversationID == reference {
				return reference, nil
			}
		}
	}
	matches := []string{}
	for _, summary := range summaries {
		if summary.Conversation.DisplayName == reference {
			matches = append(matches, summary.Conversation.ConversationID)
		}
	}
	sort.Strings(matches)
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		if byName {
			return "", fmt.Errorf("%w: %q라는 이름의 대화가 이 노드에 없다", talk.ErrNotFound, reference)
		}
		// Not an id this node holds and not a name it knows. The reference is
		// still returned as an id so the caller gets the store's own
		// "이 노드가 모른다" — this function refusing first would replace a
		// precise answer with a vaguer one.
		return reference, nil
	default:
		return "", fmt.Errorf("%w: %q라는 이름의 대화가 %d개다 — id로 지정해야 한다",
			talk.ErrInvalid, reference, len(matches))
	}
}

// resolveNode answers the node id for what a caller typed, and refuses anything
// this node cannot show to be real.
//
// "Real" means the node answers through the peer door. That is a stronger test
// than any list this module could keep: a name in the directory is hearsay, and
// a node id that merely looks well-formed proves nothing at all. It also means a
// node that is switched off cannot be invited, which is the deliberate trade —
// the failure being fixed is a member that could never arrive, and an invitation
// to a node nobody can reach is indistinguishable from one.
func (s *apiServer) resolveNode(ctx context.Context, reference string, byName bool) (string, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", fmt.Errorf("%w: 노드를 지정해야 한다", talk.ErrInvalid)
	}
	self := s.deps.ResolveNodeID(ctx)

	nodeID, err := s.nodeReference(reference, self, byName)
	if err != nil {
		return "", err
	}
	if !talk.ValidNodeID(nodeID) {
		return "", fmt.Errorf("%w: %q는 node id 형식이 아니다", talk.ErrInvalid, nodeID)
	}
	if nodeID == self {
		return nodeID, nil
	}
	if err := s.confirmNodeExists(ctx, nodeID); err != nil {
		return "", err
	}
	return nodeID, nil
}

// nodeByName looks a name up in what this node has heard (directory.go).
func (s *apiServer) nodeByName(name, self string) (string, error) {
	if s.deps.Names == nil {
		return "", fmt.Errorf("%w: 이 조립에는 노드 이름을 아는 곳이 없다", talk.ErrInvalid)
	}
	if s.deps.DisplayName == name {
		return self, nil
	}
	matches := s.deps.Names.Lookup(name)
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		return "", fmt.Errorf("%w: %q라는 이름의 노드를 이 노드가 모른다 — 이름은 이야기해 본 적 있는 노드만 안다",
			talk.ErrNotFound, name)
	default:
		return "", fmt.Errorf("%w: %q라는 이름의 노드가 %d개다 — id로 지정해야 한다",
			talk.ErrInvalid, name, len(matches))
	}
}

// confirmNodeExists asks the node itself. A door that answers is the only
// evidence this module can produce that a node id names something.
func (s *apiServer) confirmNodeExists(ctx context.Context, nodeID string) error {
	if s.deps.Door == nil {
		// No door means this assembly cannot check, and refusing every
		// invitation would be worse than accepting one it cannot verify.
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	if _, err := s.deps.Door(ctx, nodeID, "GET", apiPrefix+"/status", nil); err != nil {
		return fmt.Errorf("%w: %s에 닿지 못했다 — 없는 노드이거나 꺼져 있다 (%v)",
			talk.ErrNotFound, nodeID, err)
	}
	return nil
}

// nodeReference decides whether what was typed is an id or a name, and answers
// the id either way.
//
// The order matters and it is the reverse of the obvious one. A name is checked
// FIRST, against nodes this module has actually spoken to, because that check is
// free — it reads a local map. Deciding "id" first would mean confirming the id
// through the door, and confirming a display name as an id costs a full probe
// timeout before it can fail.
//
// Preferring a known name cannot shadow a real node id, because a display name
// may not be shaped like one: the Master refuses such names when they are set
// (terra-protocol/noderef.go). byName still forces the name lookup for a caller
// that wants to be explicit.
func (s *apiServer) nodeReference(reference, self string, byName bool) (string, error) {
	if byName {
		return s.nodeByName(reference, self)
	}
	if s.deps.DisplayName == reference {
		return self, nil
	}
	if s.deps.Names != nil {
		switch matches := s.deps.Names.Lookup(reference); len(matches) {
		case 1:
			return matches[0], nil
		case 0:
			// Not a name this node knows, so it is an id — or a name belonging
			// to a node this one has never spoken to, which the door check
			// reports as unreachable.
		default:
			return "", fmt.Errorf("%w: %q라는 이름의 노드가 %d개다 — id로 지정해야 한다",
				talk.ErrInvalid, reference, len(matches))
		}
	}
	return reference, nil
}
