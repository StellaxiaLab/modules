package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func auditCall(t *testing.T, h http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, apiBase+path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func auditEvents(t *testing.T, s *service, id string) []Event {
	t.Helper()
	items, err := s.st.events(id, 100)
	if err != nil {
		t.Fatal(err)
	}
	var out []Event
	for _, e := range items {
		if e.Kind == "audit" {
			out = append(out, e)
		}
	}
	return out
}

func TestWriteHandlersRecordTheGatewayPrincipal(t *testing.T) {
	s := newTestService(t)
	h := newOperationsHandler(s, "test")
	exe, _ := os.Executable()
	who := map[string]string{
		"X-Terra-Principal": "alice via app.x",
		"X-Terra-Subject":   "alice",
		// A token-like header must never be copied anywhere.
		"Authorization": "Bearer SECRET-TOKEN",
	}
	id := "local.audited"
	body := `{"workload_id":"` + id + `","exec_path":` + jsonString(exe) + `,"env":["WL_HELPER=sleep"]}`

	if r := auditCall(t, h, "POST", "/workloads", body, who); r.Code != 201 {
		t.Fatalf("register: %d %s", r.Code, r.Body)
	}
	if r := auditCall(t, h, "POST", "/workloads/"+id+"/start", "", who); r.Code != 200 {
		t.Fatalf("start: %d %s", r.Code, r.Body)
	}
	if r := auditCall(t, h, "POST", "/workloads/"+id+"/stop", "", who); r.Code != 200 {
		t.Fatalf("stop: %d %s", r.Code, r.Body)
	}
	if r := auditCall(t, h, "PATCH", "/workloads/"+id, `{"display_name":"renamed"}`, who); r.Code != 200 {
		t.Fatalf("update: %d %s", r.Code, r.Body)
	}

	ops := map[string]bool{}
	for _, e := range auditEvents(t, s, id) {
		if e.Detail["actor"] != "alice via app.x" || e.Detail["subject"] != "alice" {
			t.Fatalf("audit event lacks the caller: %+v", e)
		}
		ops[e.Detail["op"].(string)] = true
	}
	for _, op := range []string{"register", "start", "stop", "update"} {
		if !ops[op] {
			t.Errorf("no audit event for %s (got %v)", op, ops)
		}
	}
	raw, err := os.ReadFile(filepath.Join(s.st.dir(id), "events.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "SECRET-TOKEN") {
		t.Fatal("a credential header leaked into events.jsonl")
	}
}

func TestMissingPrincipalIsRecordedAsUnknown(t *testing.T) {
	s := newTestService(t)
	h := newOperationsHandler(s, "test")
	exe, _ := os.Executable()
	body := `{"workload_id":"local.anon","exec_path":` + jsonString(exe) + `}`
	if r := auditCall(t, h, "POST", "/workloads", body, nil); r.Code != 201 {
		t.Fatalf("register: %d %s", r.Code, r.Body)
	}
	evs := auditEvents(t, s, "local.anon")
	if len(evs) != 1 || evs[0].Detail["actor"] != unknownActor {
		t.Fatalf("want one audit event with actor unknown, got %+v", evs)
	}
	if _, has := evs[0].Detail["subject"]; has {
		t.Fatal("no subject header was sent, none may be recorded")
	}
}

func TestFailedWriteAndDeleteLeaveNoStrayHistory(t *testing.T) {
	s := newTestService(t)
	h := newOperationsHandler(s, "test")
	who := map[string]string{"X-Terra-Principal": "bob"}
	if r := auditCall(t, h, "POST", "/workloads/local.nope/start", "", who); r.Code != 404 {
		t.Fatalf("start of unknown id: %d", r.Code)
	}
	if _, err := os.Stat(s.st.dir("local.nope")); !os.IsNotExist(err) {
		t.Fatalf("a refused write must not create a workload directory: %v", err)
	}

	exe, _ := os.Executable()
	body := `{"workload_id":"local.gone","exec_path":` + jsonString(exe) + `}`
	auditCall(t, h, "POST", "/workloads", body, who)
	if r := auditCall(t, h, "DELETE", "/workloads/local.gone", "", who); r.Code != 200 {
		t.Fatalf("delete: %d %s", r.Code, r.Body)
	}
	if _, err := os.Stat(s.st.dir("local.gone")); !os.IsNotExist(err) {
		t.Fatalf("delete must not leave its directory behind: %v", err)
	}
}

func TestCleanHeaderStripsControlCharacters(t *testing.T) {
	got := cleanHeader("  mallory\r\nactor=root\t ")
	if strings.ContainsAny(got, "\r\n\t") {
		t.Fatalf("control characters survived: %q", got)
	}
	if long := cleanHeader(strings.Repeat("a", 500)); len(long) > maxActorLen {
		t.Fatalf("actor not bounded: %d", len(long))
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
