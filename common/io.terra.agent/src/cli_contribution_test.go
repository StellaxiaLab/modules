package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// contributions.cli is what turns this module's operations into `terra agent
// …` commands. The host's own validator — does it accept every declaration,
// does each pointer match the shipped contract, do the secrets come from
// stdin — lives in Terra, in module-gateway-integration
// (agent_cli_contribution_test.go): it needs the host's manifest parser, and
// this module builds without a Terra checkout.
//
// What stays here is the one check that needs this module's own types: the
// chat room's item pointers must name fields the module's entry record
// actually carries. The manifest is read as plain JSON, not through the host.

func TestChatSessionItemPointersNameEntryFields(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest struct {
		Contributions struct {
			CLI struct {
				Commands []struct {
					Name    string `json:"name"`
					Session *struct {
						Item map[string]string `json:"item"`
					} `json:"session"`
				} `json:"commands"`
			} `json:"cli"`
		} `json:"contributions"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	var item map[string]string
	for _, command := range manifest.Contributions.CLI.Commands {
		if command.Name == "agent chat" && command.Session != nil {
			item = command.Session.Item
		}
	}
	if len(item) == 0 {
		t.Fatal("agent chat is not declared as a session with item pointers")
	}

	// The item pointers name entry fields the record actually carries.
	encoded, err := json.Marshal(entry{Seq: 1, Kind: kindUser, Author: "a", AuthorLabel: "a", Text: "t", TimeMS: 1, Note: "n", Subject: "s", RequestID: "r"})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for role, pointer := range item {
		if !strings.HasSuffix(role, "Pointer") || pointer == "" {
			continue
		}
		if _, ok := fields[strings.TrimPrefix(pointer, "/")]; !ok {
			t.Errorf("item pointer %s (%s) names no entry field", pointer, role)
		}
	}
}
