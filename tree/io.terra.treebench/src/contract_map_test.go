package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// ui/contract-map.js is generated from the Master contract by
// tools/generate-contract-map.mjs. The UI reads two things from it that the
// Gateway catalog does not carry — which authentication channel an operation
// answers on, and the field names in its input areas — so if the contract
// gains, loses or re-channels an operation and nobody reruns the generator,
// Treebench quietly stops covering the real surface. This test is what makes
// that loud.
//
// It reimplements the generator's projection rather than shelling out to node,
// so it fails on a stale file whether or not a JS toolchain is present.

type contractOperation struct {
	Security struct {
		Authentication []string `json:"authentication"`
	} `json:"security"`
	Input struct {
		Schema struct {
			Properties map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
				Required   []string                   `json:"required"`
			} `json:"properties"`
		} `json:"schema"`
	} `json:"input"`
}

type mapEntry struct {
	Channel       string   `json:"c"`
	Body          []string `json:"b,omitempty"`
	BodyRequired  []string `json:"br,omitempty"`
	Query         []string `json:"q,omitempty"`
	QueryRequired []string `json:"qr,omitempty"`
}

// channelCode mirrors the generator's CHANNEL table. Both sides fall back to
// "s" for a scheme they do not know, which would quietly put a machine-only
// operation on the browser screen — TestChannelSplitIsCovered holds this table
// against every scheme the contract mentions so that fallback stays unreachable.
var channelCode = map[string]string{
	"terra-session":      "s",
	"device-token":       "d",
	"service-credential": "v",
	"public":             "p",
}

// channelName is for failure messages only: "d" alone does not tell a reader
// which surface just moved.
var channelName = map[string]string{
	"s": "terra-session",
	"d": "device-token",
	"v": "service-credential",
	"p": "public",
}

// relayOnlyChannels are the channels a browser session cannot reach at all, so
// Treebench calls them through the relay with tester credentials.
var relayOnlyChannels = []string{"d", "v"}

func masterContractPath() string {
	return filepath.Join("..", "..", "..", "..", "products", "tree", "master", "contracts", "api", "terra-api.json")
}

func loadGeneratedMap(t *testing.T) map[string]mapEntry {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "ui", "contract-map.js"))
	if err != nil {
		t.Fatalf("read contract-map.js: %v", err)
	}
	const assignment = "window.TREEBENCH_CONTRACT_MAP="
	start := strings.Index(string(raw), assignment)
	if start < 0 {
		t.Fatal("contract-map.js does not assign window.TREEBENCH_CONTRACT_MAP")
	}
	payload := strings.TrimSpace(string(raw)[start+len(assignment):])
	payload = strings.TrimSuffix(strings.TrimSpace(strings.TrimSuffix(payload, "\n")), ";")

	var generated map[string]mapEntry
	if err := json.Unmarshal([]byte(payload), &generated); err != nil {
		t.Fatalf("decode generated map: %v", err)
	}
	return generated
}

func expectedMap(t *testing.T) map[string]mapEntry {
	t.Helper()
	raw, err := os.ReadFile(masterContractPath())
	if err != nil {
		t.Fatalf("read Master contract: %v", err)
	}
	var contract struct {
		Operations map[string]contractOperation `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode Master contract: %v", err)
	}

	expected := map[string]mapEntry{}
	for id, operation := range contract.Operations {
		authentication := "terra-session"
		if len(operation.Security.Authentication) > 0 {
			authentication = operation.Security.Authentication[0]
		}
		code, ok := channelCode[authentication]
		if !ok {
			code = "s"
		}
		entry := mapEntry{Channel: code}
		for area, target := range map[string]*struct {
			fields   *[]string
			required *[]string
		}{
			"body":  {&entry.Body, &entry.BodyRequired},
			"query": {&entry.Query, &entry.QueryRequired},
		} {
			schema, present := operation.Input.Schema.Properties[area]
			if !present || len(schema.Properties) == 0 {
				continue
			}
			names := make([]string, 0, len(schema.Properties))
			for name := range schema.Properties {
				names = append(names, name)
			}
			sort.Strings(names)
			*target.fields = names
			if len(schema.Required) > 0 {
				required := append([]string(nil), schema.Required...)
				sort.Strings(required)
				*target.required = required
			}
		}
		expected[strings.TrimPrefix(id, "terra.master.")] = entry
	}
	return expected
}

func TestGeneratedContractMapMatchesMasterContract(t *testing.T) {
	generated := loadGeneratedMap(t)
	expected := expectedMap(t)

	if len(generated) != len(expected) {
		t.Fatalf("operation count: generated %d, contract %d — rerun tools/generate-contract-map.mjs",
			len(generated), len(expected))
	}

	for id, want := range expected {
		got, present := generated[id]
		if !present {
			t.Errorf("%s: missing from contract-map.js — rerun the generator", id)
			continue
		}
		if got.Channel != want.Channel {
			t.Errorf("%s: channel %q, contract says %q", id, got.Channel, want.Channel)
		}
		compareFields(t, id, "body", got.Body, want.Body)
		compareFields(t, id, "body required", got.BodyRequired, want.BodyRequired)
		compareFields(t, id, "query", got.Query, want.Query)
		compareFields(t, id, "query required", got.QueryRequired, want.QueryRequired)
	}
	for id := range generated {
		if _, present := expected[id]; !present {
			t.Errorf("%s: in contract-map.js but not in the contract — rerun the generator", id)
		}
	}
}

func compareFields(t *testing.T, id, label string, got, want []string) {
	t.Helper()
	gotSorted := append([]string(nil), got...)
	wantSorted := append([]string(nil), want...)
	sort.Strings(gotSorted)
	sort.Strings(wantSorted)
	if strings.Join(gotSorted, ",") != strings.Join(wantSorted, ",") {
		t.Errorf("%s %s: generated %v, contract %v", id, label, gotSorted, wantSorted)
	}
}

// contractAuthenticationSchemes returns every authentication scheme the Master
// contract mentions, as one sorted set: the names in its top-level dictionary —
// every channel it says it has, whether or not an operation uses it yet — and
// the schemes its operations actually declare. The two need not agree, and an
// operation naming a scheme the dictionary omits is exactly the case the
// dictionary alone would miss.
func contractAuthenticationSchemes(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(masterContractPath())
	if err != nil {
		t.Fatalf("read Master contract: %v", err)
	}
	var contract struct {
		Authentication map[string]json.RawMessage   `json:"authentication"`
		Operations     map[string]contractOperation `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode Master contract: %v", err)
	}
	if len(contract.Authentication) == 0 {
		t.Fatal("contract declares no authentication schemes")
	}
	mentioned := map[string]struct{}{}
	for name := range contract.Authentication {
		mentioned[name] = struct{}{}
	}
	for _, operation := range contract.Operations {
		for _, scheme := range operation.Security.Authentication {
			mentioned[scheme] = struct{}{}
		}
	}
	names := make([]string, 0, len(mentioned))
	for name := range mentioned {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func channelSplit(entries map[string]mapEntry) map[string]int {
	counts := map[string]int{}
	for _, entry := range entries {
		counts[entry.Channel]++
	}
	return counts
}

func formatSplit(counts map[string]int) string {
	codes := make([]string, 0, len(counts))
	for code := range counts {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	parts := make([]string, 0, len(codes))
	for _, code := range codes {
		name := channelName[code]
		if name == "" {
			name = "unknown"
		}
		parts = append(parts, fmt.Sprintf("%s(%s)=%d", code, name, counts[code]))
	}
	return strings.Join(parts, " ")
}

// The channel split is the reason the machine-channel screen and the relay
// exist at all, so it is asserted directly. It used to be asserted as two
// literals — a total of 148 and a relay-reachable count of 29 — and those went
// stale every time the Master contract grew, three times, corrected by hand
// each time. A tripwire that fires on ordinary growth and has to be re-armed by
// hand is not watching channels; it is watching size, which the test above
// already watches better.
//
// So the numbers are derived and what is asserted is the shape:
//
//   - the generated map's split equals the contract's, channel by channel. A
//     moved operation still fails here, and the message names which channels it
//     moved between instead of only saying a total changed.
//   - every scheme the contract mentions has a code in channelCode. Both this
//     file and the generator fall back to "s" for an unknown scheme, so a fifth
//     channel would land silently on the browser screen — an operation the UI
//     cannot actually reach, listed as though it could. Reading the top-level
//     dictionary catches it the moment the Master declares the channel, before
//     any operation uses it; reading the operations too catches one that names a
//     scheme the dictionary never listed, where both sides fall back in step and
//     the split comparison above would agree on the wrong answer.
//   - both sides of the split stay populated. If the relay-only side empties,
//     the machine-channel screen has nothing to reach and the relay is dead
//     weight; if the session side empties, the UI does.
func TestChannelSplitIsCovered(t *testing.T) {
	for _, scheme := range contractAuthenticationSchemes(t) {
		if _, known := channelCode[scheme]; !known {
			t.Errorf("the contract mentions authentication scheme %q, which channelCode does not map — "+
				"it would fall back to \"s\" and appear on the browser screen. Add it here, to the "+
				"generator's CHANNEL table, and decide which screen reaches it.", scheme)
		}
	}

	generated := channelSplit(loadGeneratedMap(t))
	contract := channelSplit(expectedMap(t))
	if !reflect.DeepEqual(generated, contract) {
		t.Fatalf("channel split drift — rerun tools/generate-contract-map.mjs\n  generated: %s\n  contract:  %s",
			formatSplit(generated), formatSplit(contract))
	}

	// Session and public operations the UI calls itself; device and service
	// operations only the relay can reach.
	total, reachableByRelay := 0, 0
	for _, count := range generated {
		total += count
	}
	for _, code := range relayOnlyChannels {
		reachableByRelay += generated[code]
	}
	if reachableByRelay == 0 {
		t.Errorf("no operation is on a machine channel, so the machine-channel screen and the relay "+
			"have nothing to reach: %s", formatSplit(generated))
	}
	if total-reachableByRelay == 0 {
		t.Errorf("every operation is on a machine channel, so the session screen has nothing to reach: %s",
			formatSplit(generated))
	}
}
