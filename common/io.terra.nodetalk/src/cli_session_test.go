package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"

	"github.com/StellaxiaLab/modules/internal/testkit/climanifest"
)

// The `nodetalk join` room is assembled entirely from pointers into this
// module's own contract. That makes one failure possible that no one-call
// command can have: a pointer that stops matching the contract does not error —
// the room simply opens EMPTY, with no title, no transcript, or lines with no
// author. Nothing crashes and nothing says why.
//
// So the declaration is held against the shipped contract on both sides: every
// role must name an operation this module serves and be callable with what the
// command supplies, and every pointer must address something the contract
// actually answers.

func contractOutputSchema(t *testing.T, operationID string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "contracts", "api", "terra-api.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract struct {
		Operations map[string]struct {
			Output struct {
				Schema map[string]any `json:"schema"`
			} `json:"output"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode contract: %v", err)
	}
	operation, present := contract.Operations[operationID]
	if !present {
		t.Fatalf("%s: not in the contract", operationID)
	}
	return operation.Output.Schema
}

// schemaAt walks a JSON Schema by an RFC 6901 pointer over property names,
// stepping through an array's items when the pointer continues past it.
func schemaAt(schema map[string]any, pointer string) (map[string]any, bool) {
	current := schema
	if pointer == "" {
		return current, true
	}
	for _, token := range strings.Split(strings.TrimPrefix(pointer, "/"), "/") {
		if current["type"] == "array" {
			items, ok := current["items"].(map[string]any)
			if !ok {
				return nil, false
			}
			current = items
		}
		properties, ok := current["properties"].(map[string]any)
		if !ok {
			return nil, false
		}
		next, ok := properties[climanifest.DecodePointerToken(token)].(map[string]any)
		if !ok {
			return nil, false
		}
		current = next
	}
	return current, true
}

func sessionCommand(t *testing.T) climanifest.Command {
	t.Helper()
	commands, reasons := loadCommands(t)
	for _, reason := range reasons {
		t.Errorf("the platform dropped a declared command: %s", reason)
	}
	for _, command := range commands {
		if command.IsSession() {
			return command
		}
	}
	t.Fatal("no session declared — the room has no way to be opened")
	return climanifest.Command{}
}

// Every role names an operation this module serves, and is callable with what
// the command actually supplies. A role that needs an input nobody provides
// fails at the Gateway, inside a full-screen room, where the message has
// nowhere to go.
func TestSessionRolesAreCallable(t *testing.T) {
	command := sessionCommand(t)
	session := command.Session

	served := map[string]bool{}
	for _, route := range operationRoutes {
		served[route.OperationID] = true
	}
	supplied := map[string]bool{}
	for _, arg := range command.Args {
		supplied[strings.TrimPrefix(arg.Pointer, "/")] = true
	}
	for _, flag := range command.Flags {
		supplied[strings.TrimPrefix(flag.Pointer, "/")] = true
	}
	// The send role supplies one input itself: the typed text.
	sendText := strings.TrimPrefix(session.Send.TextPointer, "/")

	check := func(role, operationID string, mode string) {
		if !served[operationID] {
			t.Errorf("%s: names %s, which this module does not serve", role, operationID)
			return
		}
		_, required := contractInputSchema(t, operationID)
		for property := range required {
			if role == "send" && property == sendText {
				continue
			}
			if mode == climanifest.InputNone {
				t.Errorf("%s: %s requires %q, but the role declared input \"none\"",
					role, operationID, property)
				continue
			}
			if !supplied[property] {
				t.Errorf("%s: %s requires %q, which the command has no arg or flag for",
					role, operationID, property)
			}
		}
	}
	if session.Identity != nil {
		check("identity", session.Identity.OperationID, session.Identity.Input)
	}
	if session.Title != nil {
		check("title", session.Title.OperationID, session.Title.Input)
	}
	check("history", session.History.OperationID, session.History.Input)
	check("stream", session.Stream.OperationID, session.Stream.Input)
	check("send", session.Send.OperationID, session.Send.Input)
}

// Every pointer addresses something the contract answers. This is the check
// that catches a silently empty room.
func TestSessionPointersAddressRealOutput(t *testing.T) {
	session := sessionCommand(t).Session

	mustResolve := func(role, operationID, pointer string) map[string]any {
		t.Helper()
		found, ok := schemaAt(contractOutputSchema(t, operationID), pointer)
		if !ok {
			t.Errorf("%s: pointer %q addresses nothing in %s's output — the room would show nothing here",
				role, pointer, operationID)
		}
		return found
	}

	if session.Identity != nil {
		mustResolve("identity", session.Identity.OperationID, session.Identity.Pointer)
	}
	if session.Title != nil {
		mustResolve("title", session.Title.OperationID, session.Title.Pointer)
	}

	// history's pointer must reach a LIST; a room walks it.
	entries := mustResolve("history", session.History.OperationID, session.History.ItemsPointer)
	if entries != nil && entries["type"] != "array" {
		t.Errorf("history: %s is %v, not an array", session.History.ItemsPointer, entries["type"])
	}
	streamItem := mustResolve("stream", session.Stream.OperationID, session.Stream.ItemPointer)
	if session.Stream.KindPointer != "" {
		mustResolve("stream", session.Stream.OperationID, session.Stream.KindPointer)
	}

	// The item pointers are read against BOTH the history element and the
	// stream item, because a room draws the same line from either and a
	// declaration that fits only one produces a transcript that changes shape
	// halfway down.
	for label, shape := range map[string]map[string]any{
		"history item": entries,
		"stream item":  streamItem,
	} {
		if shape == nil {
			continue
		}
		for role, pointer := range map[string]string{
			"authorPointer":      session.Item.AuthorPointer,
			"authorLabelPointer": session.Item.AuthorLabelPointer,
			"textPointer":        session.Item.TextPointer,
			"timePointer":        session.Item.TimePointer,
			"notePointer":        session.Item.NotePointer,
			"kindPointer":        session.Item.KindPointer,
			"seqPointer":         session.Item.SeqPointer,
			"subjectPointer":     session.Item.SubjectPointer,
		} {
			if pointer == "" {
				continue
			}
			if _, ok := schemaAt(shape, pointer); !ok {
				t.Errorf("%s: item %s %q addresses nothing", label, role, pointer)
			}
		}
	}
}

// The send role writes the typed text into the operation's input, so the
// pointer has to address an input property that can hold a line of text.
func TestSessionSendWritesARealInput(t *testing.T) {
	session := sessionCommand(t).Session
	properties, _ := contractInputSchema(t, session.Send.OperationID)
	property := strings.TrimPrefix(session.Send.TextPointer, "/")
	schema, present := properties[property]
	if !present {
		t.Fatalf("send: %q addresses no input property of %s", session.Send.TextPointer, session.Send.OperationID)
	}
	if typed, ok := schema.(map[string]any); ok && typed["type"] != "string" {
		t.Errorf("send: %s is %v — the typed line is a string", property, typed["type"])
	}
}

// A membership line has no text and is drawn as a notice named by its kind, so
// the kind and the member it names must both be declared. This is the pointer
// pair that was missing from the contract when the room was built: the module
// emitted member_node_id and the closed entry schema did not admit it.
func TestSessionCanDrawAMembershipLine(t *testing.T) {
	session := sessionCommand(t).Session
	if session.Item.KindPointer == "" {
		t.Fatal("item declares no kindPointer — a line with no text would render nameless")
	}
	entries, _ := schemaAt(contractOutputSchema(t, session.History.OperationID), session.History.ItemsPointer)
	if entries == nil {
		t.Fatal("history items did not resolve")
	}
	items, _ := entries["items"].(map[string]any)
	if items == nil {
		t.Fatal("history items has no element schema")
	}
	properties, _ := items["properties"].(map[string]any)
	if _, present := properties["member_node_id"]; !present {
		t.Error("the entry schema does not declare member_node_id, so a membership entry " +
			"cannot be described by this contract even though the module emits one")
	}
}

// A membership line has no text, so the room draws it as a sentence built from
// the subject and a label the MODULE supplies. Both halves have to be real: a
// label for a kind that is never emitted is dead words, and a kind emitted with
// no label reads as a raw identifier in the middle of a conversation.
func TestSessionLabelsCoverTheKindsThisModuleEmits(t *testing.T) {
	session := sessionCommand(t).Session
	if session.Item.SubjectPointer == "" {
		t.Fatal("no subjectPointer — an invitation line could not name who was invited")
	}
	// Every entry kind that carries no text, and every stream event that carries
	// no item, reaches the screen as a notice and therefore needs words.
	for _, kind := range []string{talk.KindMemberAdded, talk.KindMemberRemoved, "main-changed", "deleted"} {
		if session.Label(kind) == kind {
			t.Errorf("kind %q has no label — it would appear raw in the transcript", kind)
		}
	}
	// And nothing is labelled that this module never says.
	emitted := map[string]bool{
		talk.KindMemberAdded: true, talk.KindMemberRemoved: true,
		"main-changed": true, "deleted": true, talk.KindMessage: true, "entry": true,
		"membership": true,
	}
	for kind := range session.Labels {
		if !emitted[kind] {
			t.Errorf("label for %q, which this module never emits", kind)
		}
	}
}

// Without seqPointer the room cannot tell a repeat from a new line, and a
// reconnection has to choose between leaving a gap and drawing a line twice.
// This module has per-author sequences, so it should say so.
func TestSessionDeclaresItemIdentity(t *testing.T) {
	session := sessionCommand(t).Session
	if session.Item.SeqPointer == "" {
		t.Fatal("no seqPointer — a rejoined stream would repeat or lose a line")
	}
	entries, _ := schemaAt(contractOutputSchema(t, session.History.OperationID), session.History.ItemsPointer)
	items, _ := entries["items"].(map[string]any)
	properties, _ := items["properties"].(map[string]any)
	for _, pointer := range []string{session.Item.SeqPointer, session.Item.SubjectPointer} {
		if _, present := properties[pointer[1:]]; !present {
			t.Errorf("%s addresses no property of an entry", pointer)
		}
	}
}

// The author pointer must address an IDENTITY, not a label. The room compares it
// against what the identity role answered to decide which lines are the viewer's
// own; a name there would never match, and two nodes sharing a name would each
// see the other's lines as theirs. The label is a separate pointer for exactly
// that reason.
func TestTheAuthorPointerIsAnIdentityAndTheLabelIsSeparate(t *testing.T) {
	command := sessionCommand(t)
	session := command.Session
	if session.Identity == nil {
		t.Fatal("no identity role — the room could not tell its own lines apart at all")
	}
	if session.Item.AuthorPointer != "/author_node_id" {
		t.Errorf("authorPointer is %q; it has to be the id the identity role answers",
			session.Item.AuthorPointer)
	}
	if session.Identity.Pointer != "/node_id" {
		t.Errorf("identity pointer is %q; it has to be the same kind of value the author is",
			session.Identity.Pointer)
	}
	if session.Item.AuthorLabelPointer == "" {
		t.Error("no authorLabelPointer — every line would be addressed by a node id")
	}
	// And the label has to be something the contract actually answers.
	entries, _ := schemaAt(contractOutputSchema(t, session.History.OperationID), session.History.ItemsPointer)
	items, _ := entries["items"].(map[string]any)
	properties, _ := items["properties"].(map[string]any)
	for _, pointer := range []string{session.Item.AuthorLabelPointer, session.Item.SubjectPointer} {
		if pointer == "" {
			continue
		}
		if _, present := properties[pointer[1:]]; !present {
			t.Errorf("%s addresses no property of an entry", pointer)
		}
	}
}
