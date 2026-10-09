package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/internal/testkit/climanifest"
)

// contributions.cli is what turns this module's operations into `terra agent
// …` commands. Two things rot silently there: a declaration the platform
// quietly drops, and a pointer that no longer matches the operation's input
// schema after a contract change. Both are asserted against the shipped
// contract; the platform's own validator runs in CI (`terra module pack`).

func loadCommands(t *testing.T) ([]climanifest.Command, []string) {
	t.Helper()
	commands, problems, err := climanifest.Load(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	return commands, problems
}

func contractInputSchema(t *testing.T, operationID string) (map[string]any, map[string]bool) {
	t.Helper()
	contract := loadContract(t)
	operation, present := contract["operations"].(map[string]any)[operationID]
	if !present {
		t.Fatalf("%s: not in the contract", operationID)
	}
	schema := operation.(map[string]any)["input"].(map[string]any)["schema"].(map[string]any)
	properties, _ := schema["properties"].(map[string]any)
	required := map[string]bool{}
	if list, ok := schema["required"].([]any); ok {
		for _, name := range list {
			required[name.(string)] = true
		}
	}
	return properties, required
}

func TestEveryDeclaredCLICommandIsAccepted(t *testing.T) {
	commands, reasons := loadCommands(t)
	for _, reason := range reasons {
		t.Errorf("the platform dropped a declared command: %s", reason)
	}
	if len(commands) < 10 {
		t.Fatalf("only %d CLI commands accepted — the contribution stopped being read", len(commands))
	}
	for _, command := range commands {
		if !strings.HasPrefix(command.Name, "agent ") {
			t.Errorf("%q: contributed commands live under `terra agent`, the open group", command.Name)
		}
		for _, own := range []string{"agent grant", "agent revoke", "agent whoami", "agent levels"} {
			if command.Name == own {
				t.Errorf("%q is the CLI's own subcommand; a contribution there can never run", command.Name)
			}
		}
	}
}

// Every pointer a command writes is a property of the operation it calls, and
// every required property has a way to be supplied.
func TestCLIPointersMatchTheContract(t *testing.T) {
	commands, _ := loadCommands(t)
	check := func(commandName, operationID string, pointers map[string]bool) {
		properties, required := contractInputSchema(t, operationID)
		for pointer := range pointers {
			field := strings.TrimPrefix(pointer, "/")
			if _, ok := properties[field]; !ok {
				t.Errorf("%s → %s: writes %s, which the operation's input does not declare", commandName, operationID, pointer)
			}
		}
		for field := range required {
			if !pointers["/"+field] {
				t.Errorf("%s → %s: required input %s has no arg or flag", commandName, operationID, field)
			}
		}
	}
	for _, command := range commands {
		pointers := map[string]bool{}
		for _, arg := range command.Args {
			pointers[arg.Pointer] = true
		}
		for _, flag := range command.Flags {
			pointers[flag.Pointer] = true
		}
		if command.IsSession() {
			for _, operationID := range command.Session.OperationIDs() {
				rolePointers := pointers
				if operationID == command.Session.Send.OperationID {
					// The room supplies the typed line at textPointer itself.
					rolePointers = map[string]bool{command.Session.Send.TextPointer: true}
					for pointer := range pointers {
						rolePointers[pointer] = true
					}
				}
				check(command.Name, operationID, rolePointers)
			}
			continue
		}
		check(command.Name, command.OperationID, pointers)
	}
}

// The secrets arrive on standard input and nowhere else.
func TestSecretsAreStdinFlags(t *testing.T) {
	commands, _ := loadCommands(t)
	want := map[string]string{"agent credential set": "/credential", "agent model add": "/api_key"}
	for _, command := range commands {
		pointer, expected := want[command.Name]
		if !expected {
			continue
		}
		found := false
		for _, flag := range command.Flags {
			if flag.Pointer == pointer {
				found = true
				if !flag.ReadsStdin() {
					t.Errorf("%s: %s is taken from the command line; a secret must come from stdin", command.Name, pointer)
				}
			}
		}
		if !found {
			t.Errorf("%s: no flag writes %s", command.Name, pointer)
		}
		delete(want, command.Name)
	}
	for name := range want {
		t.Errorf("command %s is not declared", name)
	}
}

// The room's roles point at operations that answer the shapes the renderer
// reads: identity at the viewer, history at entries, stream at the entry, send
// at the text.
func TestChatSessionRolesMatchTheContract(t *testing.T) {
	commands, _ := loadCommands(t)
	var chat *climanifest.Command
	for index := range commands {
		if commands[index].Name == "agent chat" {
			chat = &commands[index]
		}
	}
	if chat == nil || !chat.IsSession() {
		t.Fatal("agent chat is not declared as a session")
	}
	session := chat.Session
	contract := loadContract(t)
	operations := contract["operations"].(map[string]any)
	outputHas := func(operationID, field string) bool {
		operation, ok := operations[operationID].(map[string]any)
		if !ok {
			return false
		}
		schema := operation["output"].(map[string]any)["schema"].(map[string]any)
		properties, _ := schema["properties"].(map[string]any)
		_, present := properties[field]
		return present
	}
	if session.Identity == nil || !outputHas(session.Identity.OperationID, strings.TrimPrefix(session.Identity.Pointer, "/")) {
		t.Errorf("identity role %+v does not read a declared output field", session.Identity)
	}
	if session.Title == nil || !outputHas(session.Title.OperationID, strings.TrimPrefix(session.Title.Pointer, "/")) {
		t.Errorf("title role %+v does not read a declared output field", session.Title)
	}
	if !outputHas(session.History.OperationID, strings.TrimPrefix(session.History.ItemsPointer, "/")) {
		t.Errorf("history role %+v does not read a declared output field", session.History)
	}
	if !outputHas(session.Stream.OperationID, strings.TrimPrefix(session.Stream.ItemPointer, "/")) {
		t.Errorf("stream role %+v does not read a declared output field", session.Stream)
	}
	properties, _ := contractInputSchema(t, session.Send.OperationID)
	if _, ok := properties[strings.TrimPrefix(session.Send.TextPointer, "/")]; !ok {
		t.Errorf("send role %+v does not write a declared input field", session.Send)
	}
	// The item pointers name entry fields the record actually carries.
	var sample entry
	encoded, _ := json.Marshal(entry{Seq: 1, Kind: kindUser, Author: "a", AuthorLabel: "a", Text: "t", TimeMS: 1, Note: "n", Subject: "s", RequestID: "r"})
	var fields map[string]any
	_ = json.Unmarshal(encoded, &fields)
	_ = sample
	for _, pointer := range []string{session.Item.AuthorPointer, session.Item.TextPointer, session.Item.TimePointer, session.Item.KindPointer, session.Item.SeqPointer, session.Item.NotePointer, session.Item.SubjectPointer, session.Item.AuthorLabelPointer} {
		if pointer == "" {
			continue
		}
		if _, ok := fields[strings.TrimPrefix(pointer, "/")]; !ok {
			t.Errorf("item pointer %s names no entry field", pointer)
		}
	}
}
