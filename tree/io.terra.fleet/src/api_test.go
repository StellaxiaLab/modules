package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

// fakeCore stands in for the host's Core capability plane: it records the
// invocation the module relayed and answers with a canned output.
type fakeCore struct {
	server     *httptest.Server
	invocation *modulert.CoreInvocation
	credential string
	output     string
}

func newFakeCore(t *testing.T, output string) *fakeCore {
	t.Helper()
	core := &fakeCore{output: output}
	core.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != modulert.CoreInvokePath {
			t.Errorf("core path = %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		core.credential = r.Header.Get(modulert.CredentialHeader)
		var invocation modulert.CoreInvocation
		if err := json.NewDecoder(r.Body).Decode(&invocation); err != nil {
			t.Error(err)
		}
		core.invocation = &invocation
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(modulert.CoreResult{Output: json.RawMessage(core.output)})
	}))
	t.Cleanup(core.server.Close)
	return core
}

func (c *fakeCore) client() *modulesdk.CoreClient {
	endpoint := strings.TrimPrefix(c.server.URL, "http://")
	return modulesdk.NewCoreClient(endpoint, "workload-credential", nil)
}

func (c *fakeCore) inputMap(t *testing.T) map[string]any {
	t.Helper()
	if c.invocation == nil {
		t.Fatal("core was never invoked")
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(c.invocation.Input, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func request(t *testing.T, handler http.Handler, method, path, principal, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if principal != "" {
		req.Header.Set(principalHeader, principal)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

// The module's whole authorization job is relaying the verified principal and
// the addressed path into the core invocation, unchanged.
func TestHandlersRelayPrincipalAndPathIntoTheCoreInvocation(t *testing.T) {
	core := newFakeCore(t, `{"fleet":{},"slots":[]}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodGet, apiPrefix+"/fleets/fleet-1", "user-9", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if core.invocation.OperationID != "terra.fleet.fleets.get" {
		t.Fatalf("operation = %q", core.invocation.OperationID)
	}
	input := core.inputMap(t)
	if input["owner_user_id"] != "user-9" || input["fleet_id"] != "fleet-1" {
		t.Fatalf("input = %#v", input)
	}
	if core.credential != "workload-credential" {
		t.Fatalf("core call carried credential %q", core.credential)
	}
	if response.Body.String() != `{"fleet":{},"slots":[]}` {
		t.Fatalf("output was not streamed verbatim: %s", response.Body.String())
	}
}

// Without a dispatch-verified principal there is no one to act as; the module
// refuses before the core plane is ever reached.
func TestMissingPrincipalIsRefusedWithoutInvokingCore(t *testing.T) {
	core := newFakeCore(t, `{}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodGet, apiPrefix+"/fleets", "", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "FLEET_PRINCIPAL_REQUIRED") {
		t.Fatalf("body = %s", response.Body.String())
	}
	if core.invocation != nil {
		t.Fatal("core was invoked despite the missing principal")
	}
}

func TestCodeIssueMapsBodyAndAnswers201(t *testing.T) {
	core := newFakeCore(t, `{"code":"tjc_x","code_id":"fjc_1"}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodPost, apiPrefix+"/fleets/fleet-1/codes", "user-9",
		`{"slot_id":"slot-3","max_uses":4}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	input := core.inputMap(t)
	if input["slot_id"] != "slot-3" || input["max_uses"] != float64(4) || input["fleet_id"] != "fleet-1" {
		t.Fatalf("input = %#v", input)
	}
}

func TestSlotDeleteAddressesTheSeat(t *testing.T) {
	core := newFakeCore(t, `{"slot_id":"slot-3","fleet_id":"fleet-1","node_deleted":true}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodDelete, apiPrefix+"/fleets/fleet-1/slots/slot-3", "user-9", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if core.invocation.OperationID != "terra.fleet.slots.delete" {
		t.Fatalf("operation = %q", core.invocation.OperationID)
	}
	input := core.inputMap(t)
	if input["slot_id"] != "slot-3" || input["fleet_id"] != "fleet-1" {
		t.Fatalf("input = %#v", input)
	}
}

// Declaring a fleet is the one write whose body is the declaration itself, so
// the relay must carry every field through — and must NOT invent a cell block
// for a plain node fleet, which would declare a Cell with no Leaves.
func TestFleetCreateRelaysDeclarationAndOmitsAbsentCell(t *testing.T) {
	core := newFakeCore(t, `{"fleet":{"fleet_id":"fleet-9","slug":"io-workers"}}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodPost, apiPrefix+"/fleets", "user-9",
		`{"slug":"io-workers","image_ref":"terra-daemon:latest","max_nodes":8}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if core.invocation.OperationID != "terra.fleet.fleets.create" {
		t.Fatalf("operation = %q", core.invocation.OperationID)
	}
	input := core.inputMap(t)
	if input["slug"] != "io-workers" || input["image_ref"] != "terra-daemon:latest" || input["max_nodes"] != float64(8) {
		t.Fatalf("input = %#v", input)
	}
	if _, present := input["cell"]; present {
		t.Fatalf("a node-profile declaration carried a cell block: %#v", input)
	}
	if input["owner_user_id"] != "user-9" {
		t.Fatalf("principal was not stamped: %#v", input)
	}
}

// A tree-profile declaration must carry the cell block, since that is what
// tells the seeder how many Leaves to raise inside each Cell.
func TestFleetCreateCarriesCellForTreeProfile(t *testing.T) {
	core := newFakeCore(t, `{"fleet":{"fleet_id":"fleet-cell"}}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodPost, apiPrefix+"/fleets", "user-9",
		`{"slug":"robot-cell","profile":"tree","cell":{"leaf_image_ref":"leaf:1","leaf_count":2}}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	input := core.inputMap(t)
	cell, ok := input["cell"].(map[string]any)
	if !ok {
		t.Fatalf("cell block missing: %#v", input)
	}
	if cell["leaf_image_ref"] != "leaf:1" || cell["leaf_count"] != float64(2) {
		t.Fatalf("cell = %#v", cell)
	}
}

func TestSlotAddRelaysPlacementAndCount(t *testing.T) {
	core := newFakeCore(t, `{"slots":[{"slot_id":"slot-1"}]}`)
	handler := newOperationsHandler(core.client())

	response := request(t, handler, http.MethodPost, apiPrefix+"/fleets/fleet-1/slots", "user-9",
		`{"host_node_id":"node-h","count":3}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if core.invocation.OperationID != "terra.fleet.slots.add" {
		t.Fatalf("operation = %q", core.invocation.OperationID)
	}
	input := core.inputMap(t)
	if input["fleet_id"] != "fleet-1" || input["host_node_id"] != "node-h" || input["count"] != float64(3) {
		t.Fatalf("input = %#v", input)
	}
}

// Start may carry a placement; stop never does — stopping a seat is not a move,
// so the stop relay must not smuggle a host into the core input.
func TestSlotStartAndStopAddressTheSeat(t *testing.T) {
	start := newFakeCore(t, `{"desired":{"state":"running"}}`)
	response := request(t, newOperationsHandler(start.client()), http.MethodPost,
		apiPrefix+"/fleets/fleet-1/slots/slot-3/start", "user-9", `{"host_node_id":"node-h"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("start status = %d: %s", response.Code, response.Body.String())
	}
	if start.invocation.OperationID != "terra.fleet.slots.start" {
		t.Fatalf("start operation = %q", start.invocation.OperationID)
	}
	startInput := start.inputMap(t)
	if startInput["slot_id"] != "slot-3" || startInput["host_node_id"] != "node-h" {
		t.Fatalf("start input = %#v", startInput)
	}

	stop := newFakeCore(t, `{"desired":{"state":"stopped"}}`)
	response = request(t, newOperationsHandler(stop.client()), http.MethodPost,
		apiPrefix+"/fleets/fleet-1/slots/slot-3/stop", "user-9", "")
	if response.Code != http.StatusOK {
		t.Fatalf("stop status = %d: %s", response.Code, response.Body.String())
	}
	if stop.invocation.OperationID != "terra.fleet.slots.stop" {
		t.Fatalf("stop operation = %q", stop.invocation.OperationID)
	}
	stopInput := stop.inputMap(t)
	if _, present := stopInput["host_node_id"]; present {
		t.Fatalf("stop carried a placement: %#v", stopInput)
	}
	if stopInput["slot_id"] != "slot-3" {
		t.Fatalf("stop input = %#v", stopInput)
	}
}
