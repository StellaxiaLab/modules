package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteAtomicReplacesAndLeavesNoTemp(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "record.json")
	for _, content := range []string{"one", "two"} {
		if err := writeAtomic(p, []byte(content)); err != nil {
			t.Fatal(err)
		}
		got, _ := os.ReadFile(p)
		if string(got) != content {
			t.Fatalf("got %q want %q", got, content)
		}
	}
	if _, err := os.Stat(p + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temp file left behind: %v", err)
	}
	// A failing write (missing directory) must surface, not be swallowed.
	if err := writeAtomic(filepath.Join(dir, "nope", "x"), []byte("x")); err == nil {
		t.Fatal("expected an error for a missing directory")
	}
}

func TestCorruptRecordIsSkippedButReported(t *testing.T) {
	elevationCheck = notElevated
	t.Cleanup(func() { elevationCheck = processElevated })
	st, err := newStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	st.stderr = &logs
	good := &Workload{WorkloadID: "local.good", Status: StatusStopped}
	if err := st.save(good); err != nil {
		t.Fatal(err)
	}
	badDir := st.dir("local.bad")
	if err := os.MkdirAll(badDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(badDir, "record.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	s, err := newService(st)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.list(); len(got) != 1 || got[0].WorkloadID != "local.good" {
		t.Fatalf("list = %+v, want only local.good", got)
	}
	if c := st.corruptRecords(); len(c) != 1 || c[0].ID != "local.bad" {
		t.Fatalf("corrupt = %+v", c)
	}
	if !strings.Contains(logs.String(), "local.bad") {
		t.Fatalf("stderr log does not name the corrupt record: %q", logs.String())
	}
	evs, err := st.events("local.bad", 10)
	if err != nil || len(evs) != 1 || evs[0].Kind != "corrupt_record" {
		t.Fatalf("events = %+v err=%v", evs, err)
	}
	// The damaged file is left alone for a person to look at.
	if data, _ := os.ReadFile(filepath.Join(badDir, "record.json")); string(data) != "{not json" {
		t.Fatalf("corrupt record was modified: %q", data)
	}
}

func TestEventsRotateAndReadSpansBothFiles(t *testing.T) {
	st, err := newStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	st.maxEvents = 400
	for i := 0; i < 40; i++ {
		st.appendEvent("local.ev", "tick", map[string]any{"n": i})
	}
	cur := filepath.Join(st.dir("local.ev"), "events.jsonl")
	info, err := os.Stat(cur)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > st.maxEvents {
		t.Fatalf("current file is %d bytes, over the %d cap", info.Size(), st.maxEvents)
	}
	if _, err := os.Stat(cur + ".1"); err != nil {
		t.Fatalf("no rotated copy: %v", err)
	}
	if _, err := os.Stat(cur + ".2"); !os.IsNotExist(err) {
		t.Fatal("only one rotated copy is kept")
	}
	all, err := st.events("local.ev", 0)
	if err != nil {
		t.Fatal(err)
	}
	if n := all[len(all)-1].Detail["n"]; n != float64(39) {
		t.Fatalf("newest event n = %v, want 39", n)
	}
	last5, _ := st.events("local.ev", 5)
	if len(last5) != 5 || last5[4].Detail["n"] != float64(39) || last5[0].Detail["n"] != float64(35) {
		t.Fatalf("last5 = %+v", last5)
	}
}

func TestPersistFailureIsLoggedAndRecorded(t *testing.T) {
	s := newTestService(t)
	var logs bytes.Buffer
	s.st.stderr = &logs
	if _, err := s.register(helperInput("local.p", "sleep")); err != nil {
		t.Fatal(err)
	}
	// Make the record unwritable: a non-empty directory squats on the temp name.
	if err := os.MkdirAll(filepath.Join(s.st.dir("local.p"), "record.json.tmp", "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.persistLocked(s.entries["local.p"])
	s.mu.Unlock()
	if !strings.Contains(logs.String(), "local.p") {
		t.Fatalf("no stderr line: %q", logs.String())
	}
	evs, _ := s.st.events("local.p", 10)
	found := false
	for _, e := range evs {
		found = found || e.Kind == "persist_failed"
	}
	if !found {
		t.Fatalf("no persist_failed event in %+v", evs)
	}
}

func TestInputErrorsUseInputCodeAndOverridesAreKeysOnly(t *testing.T) {
	s := newTestService(t)
	if _, err := s.register(helperInput("local.o", "sleep", "SECRET=hunter2")); err != nil {
		t.Fatal(err)
	}
	in := helperInput("local.o2", "sleep")
	in.EnvOverride = []string{"no-equals"}
	if _, err := s.register(in); code(err) != "WORKLOAD_INPUT_INVALID" {
		t.Fatalf("bad env pair: %v", err)
	}
	in = helperInput("local.o2", "sleep")
	in.Restart = "sometimes"
	if _, err := s.register(in); code(err) != "WORKLOAD_INPUT_INVALID" {
		t.Fatalf("bad restart: %v", err)
	}
	if _, err := s.register(helperInput("bad", "sleep")); code(err) != "WORKLOAD_ID_INVALID" {
		t.Fatalf("bad id must stay WORKLOAD_ID_INVALID: %v", err)
	}

	h := newOperationsHandler(s, "t")
	for _, path := range []string{"/workloads/local.o", "/workloads"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", apiBase+path, nil))
		body := rec.Body.String()
		if strings.Contains(body, "hunter2") || strings.Contains(body, `"overrides"`) {
			t.Fatalf("%s leaks declared values: %s", path, body)
		}
		if !strings.Contains(body, `"override_keys"`) || !strings.Contains(body, "SECRET") {
			t.Fatalf("%s lacks override key names: %s", path, body)
		}
	}
	// The value is still stored for launching.
	if data, _ := os.ReadFile(filepath.Join(s.st.dir("local.o"), "record.json")); !strings.Contains(string(data), "hunter2") {
		t.Fatal("record.json must keep the declared value so the program can be launched")
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", apiBase+"/workloads/local.o/stop", strings.NewReader("{bad"))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "WORKLOAD_INPUT_INVALID") {
		t.Fatalf("bad JSON: %d %s", rec.Code, rec.Body.String())
	}
}
