package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestMain lets the test binary double as the program being supervised.
func TestMain(m *testing.M) {
	switch os.Getenv("WL_HELPER") {
	case "sleep":
		println("hello from helper")
		time.Sleep(time.Hour)
		os.Exit(0)
	case "exit":
		code, _ := strconv.Atoi(os.Getenv("WL_EXIT"))
		println("exiting", code)
		os.Exit(code)
	case "env":
		for _, kv := range os.Environ() {
			println("ENV " + kv)
		}
		time.Sleep(time.Hour)
	}
	os.Exit(m.Run())
}

func notElevated() (bool, error) { return false, nil }
func elevated() (bool, error)    { return true, nil }

func newTestService(t *testing.T) *service {
	t.Helper()
	elevationCheck = notElevated
	t.Cleanup(func() { elevationCheck = processElevated })
	st, err := newStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := newService(st)
	if err != nil {
		t.Fatal(err)
	}
	s.backoff = 20 * time.Millisecond
	t.Cleanup(func() {
		for _, w := range s.list() {
			_, _ = s.stop(w.WorkloadID, time.Second)
		}
	})
	return s
}

func helperInput(id, mode string, extra ...string) registerInput {
	exe, _ := os.Executable()
	return registerInput{WorkloadID: id, ExecPath: exe, EnvOverride: append([]string{"WL_HELPER=" + mode}, extra...)}
}

func code(err error) string {
	if ae, ok := err.(*apiError); ok {
		return ae.Code
	}
	return ""
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func logText(t *testing.T, s *service, id string) string {
	t.Helper()
	text, _, _, err := readLog(s.logDir(id), 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func mustGet(t *testing.T, s *service, id string) *Workload {
	t.Helper()
	w, err := s.get(id)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func TestElevatedDaemonRefusesRegisterStartAndUpdate(t *testing.T) {
	s := newTestService(t)
	if _, err := s.register(helperInput("local.keep", "sleep")); err != nil {
		t.Fatal(err)
	}
	elevationCheck = elevated

	_, err := s.register(helperInput("local.new", "sleep"))
	if code(err) != "WORKLOAD_DAEMON_ELEVATED" || !strings.Contains(err.Error(), "elevated") {
		t.Fatalf("register under elevation = %v", err)
	}
	if _, err := s.start("local.keep"); code(err) != "WORKLOAD_DAEMON_ELEVATED" {
		t.Fatalf("start under elevation = %v", err)
	}
	if _, err := s.restart("local.keep", time.Second); code(err) != "WORKLOAD_DAEMON_ELEVATED" {
		t.Fatalf("restart under elevation = %v", err)
	}
	name := "x"
	if _, err := s.update(updateInput{WorkloadID: "local.keep", DisplayName: &name}); code(err) != "WORKLOAD_DAEMON_ELEVATED" {
		t.Fatalf("update under elevation = %v", err)
	}
	// Reading, stopping and cleaning up stay possible: an operator must be able
	// to get a workload out from under an elevated daemon.
	if _, err := s.get("local.keep"); err != nil {
		t.Fatalf("get: %v", err)
	}
	if _, err := s.stop("local.keep", time.Second); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := s.remove("local.keep", false); err != nil {
		t.Fatalf("remove: %v", err)
	}
}

func TestUnreadableElevationIsTreatedAsElevated(t *testing.T) {
	s := newTestService(t)
	elevationCheck = func() (bool, error) { return false, os.ErrPermission }
	if _, err := s.register(helperInput("local.a1", "sleep")); code(err) != "WORKLOAD_DAEMON_ELEVATED" {
		t.Fatalf("got %v", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	s := newTestService(t)
	if _, err := s.register(helperInput("scriba", "sleep")); code(err) != "WORKLOAD_ID_INVALID" {
		t.Fatalf("id without local. prefix: %v", err)
	}
	bad := helperInput("local.nofile", "sleep")
	bad.ExecPath = os.TempDir() + "/definitely-missing-binary"
	if _, err := s.register(bad); code(err) != "WORKLOAD_EXEC_NOT_FOUND" {
		t.Fatalf("missing exec: %v", err)
	}
	if _, err := s.register(helperInput("local.dup", "sleep")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.register(helperInput("local.dup", "sleep")); code(err) != "WORKLOAD_ALREADY_EXISTS" {
		t.Fatalf("duplicate: %v", err)
	}
	again := helperInput("local.dup", "sleep")
	again.Force = true
	if _, err := s.register(again); err != nil {
		t.Fatalf("force replace: %v", err)
	}
	if _, err := s.get("local.other"); code(err) != "WORKLOAD_NOT_FOUND" {
		t.Fatalf("not found: %v", err)
	}
}

func TestStartLogsStopRemove(t *testing.T) {
	s := newTestService(t)
	if _, err := s.register(helperInput("local.run", "sleep")); err != nil {
		t.Fatal(err)
	}
	rec, err := s.start("local.run")
	if err != nil || rec.Status != StatusRunning || rec.Instance == nil || rec.Instance.PID == 0 {
		t.Fatalf("start = %+v, %v", rec, err)
	}
	if again, err := s.start("local.run"); err != nil || again.Instance.PID != rec.Instance.PID {
		t.Fatalf("start is not idempotent: %+v %v", again, err)
	}
	waitFor(t, "log line", func() bool { return strings.Contains(logText(t, s, "local.run"), "hello from helper") })

	if err := s.remove("local.run", false); code(err) != "WORKLOAD_RUNNING" {
		t.Fatalf("remove while running: %v", err)
	}
	res, err := s.stop("local.run", 3*time.Second)
	if err != nil || res.Status != StatusStopped {
		t.Fatalf("stop = %+v, %v", res, err)
	}
	if got := mustGet(t, s, "local.run"); got.Status != StatusStopped || got.Instance != nil || got.LastExit == nil {
		t.Fatalf("after stop: %+v", got)
	}
	// stopping a stopped program is a success that says so
	if res, err := s.stop("local.run", time.Second); err != nil || res.Status != StatusStopped {
		t.Fatalf("second stop = %+v, %v", res, err)
	}
	if err := s.remove("local.run", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.get("local.run"); code(err) != "WORKLOAD_NOT_FOUND" {
		t.Fatalf("after remove: %v", err)
	}
}

func TestRemoveForceStopsFirst(t *testing.T) {
	s := newTestService(t)
	s.register(helperInput("local.force", "sleep"))
	s.start("local.force")
	if err := s.remove("local.force", true); err != nil {
		t.Fatal(err)
	}
}

func TestExitCodeIsKept(t *testing.T) {
	s := newTestService(t)
	s.register(helperInput("local.exit7", "exit", "WL_EXIT=7"))
	if _, err := s.start("local.exit7"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "failed", func() bool { w, _ := s.get("local.exit7"); return w.Status == StatusFailed })
	w := mustGet(t, s, "local.exit7")
	if w.LastExit == nil || w.LastExit.Code != 7 || w.LastExit.Forced {
		t.Fatalf("last_exit = %+v", w.LastExit)
	}
	s.register(helperInput("local.exit0", "exit", "WL_EXIT=0"))
	s.start("local.exit0")
	waitFor(t, "stopped", func() bool { w, _ := s.get("local.exit0"); return w.Status == StatusStopped && w.LastExit != nil })
}

func TestRestartStormStops(t *testing.T) {
	s := newTestService(t)
	in := helperInput("local.storm", "exit", "WL_EXIT=1")
	in.Restart = RestartOnFailure
	two := 2
	in.MaxRestarts = &two
	s.register(in)
	if _, err := s.start("local.storm"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "storm", func() bool { w, _ := s.get("local.storm"); return w.Status == StatusFailed })
	events, _ := s.st.events("local.storm", 100)
	starts, storm := 0, false
	for _, e := range events {
		if e.Kind == "started" {
			starts++
		}
		if e.Kind == "restart_storm" {
			storm = true
		}
	}
	if starts != 3 || !storm { // first run + 2 restarts, then it gives up
		t.Fatalf("starts=%d storm=%v events=%v", starts, storm, events)
	}
}

func TestSnapshotReplayedAndNeverLeaksTerraKeysOrValues(t *testing.T) {
	s := newTestService(t)
	in := helperInput("local.env", "env", "SCRIBA_MODE=dev", "TERRA_DAEMON_TOKEN=override-secret")
	in.Snapshot = map[string]string{
		"CONDA_PREFIX": "C:/conda/scriba-secret-value", "TERRA_DAEMON_TOKEN": "snapshot-secret",
		"SYSTEMROOT": os.Getenv("SYSTEMROOT"), "PATH": os.Getenv("PATH"),
	}
	rec, err := s.register(in)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Spec.Env.Mode != EnvShellSnapshot {
		t.Fatalf("mode = %s", rec.Spec.Env.Mode)
	}
	if _, err := s.start("local.env"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "env dump", func() bool { return strings.Contains(logText(t, s, "local.env"), "ENV SCRIBA_MODE=dev") })
	out := logText(t, s, "local.env")
	if !strings.Contains(out, "ENV CONDA_PREFIX=C:/conda/scriba-secret-value") {
		t.Fatalf("snapshot not replayed:\n%s", out)
	}
	if strings.Contains(strings.ToUpper(out), "TERRA_") {
		t.Fatalf("a TERRA_ key reached the program:\n%s", out)
	}

	// Responses carry key names only, never values (NFR-13).
	for _, body := range []any{s.list(), mustGet(t, s, "local.env")} {
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "scriba-secret-value") || strings.Contains(string(raw), "snapshot-secret") {
			t.Fatalf("a snapshot value appeared in a response: %s", raw)
		}
	}
	keys := mustGet(t, s, "local.env").Spec.Env.Keys
	if len(keys) == 0 || keys[0] != "CONDA_PREFIX" {
		t.Fatalf("keys = %v", keys)
	}
	file, _ := os.ReadFile(s.st.dir("local.env") + "/env.snapshot")
	if strings.Contains(strings.ToUpper(string(file)), "TERRA_") {
		t.Fatalf("snapshot file kept a TERRA_ key: %s", file)
	}
}

func copyExec(t *testing.T) string {
	t.Helper()
	exe, _ := os.Executable()
	data, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	p := t.TempDir() + "/copy-" + strconv.Itoa(os.Getpid()) + exeSuffix()
	if err := os.WriteFile(p, data, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func exeSuffix() string {
	if os.PathSeparator == '\\' {
		return ".exe"
	}
	return ""
}

func TestRestoreAfterRestartAndMissingExecIsolated(t *testing.T) {
	s := newTestService(t)
	auto := helperInput("local.auto", "sleep")
	auto.AutoStart = true
	s.register(auto)
	s.register(helperInput("local.manual", "sleep"))
	gone := helperInput("local.gone", "sleep")
	gone.ExecPath = copyExec(t)
	gone.AutoStart = true
	s.register(gone)
	if err := os.Remove(gone.ExecPath); err != nil {
		t.Fatal(err)
	}

	// a new module process over the same data directory
	s2, err := newService(s.st)
	if err != nil {
		t.Fatal(err)
	}
	s2.backoff = 20 * time.Millisecond
	t.Cleanup(func() {
		for _, w := range s2.list() {
			s2.stop(w.WorkloadID, time.Second)
		}
	})
	s2.restore()

	if w := mustGet(t, s2, "local.auto"); w.Status != StatusRunning {
		t.Fatalf("auto_start not restored: %s", w.Status)
	}
	if w := mustGet(t, s2, "local.manual"); w.Status != StatusStopped {
		t.Fatalf("manual should stay stopped: %s", w.Status)
	}
	if w := mustGet(t, s2, "local.gone"); w.Status != StatusUnavailable {
		t.Fatalf("vanished exec should be unavailable: %s", w.Status)
	}
}

func TestDriftIsReportedNotRefused(t *testing.T) {
	s := newTestService(t)
	in := helperInput("local.drift", "sleep")
	in.ExecPath = copyExec(t)
	s.register(in)
	if mustGet(t, s, "local.drift").Source.Drift {
		t.Fatal("fresh registration should not drift")
	}
	f, _ := os.OpenFile(in.ExecPath, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString("changed")
	f.Close()
	if !mustGet(t, s, "local.drift").Source.Drift {
		t.Fatal("changed file should report drift")
	}
	if _, err := s.start("local.drift"); err != nil {
		t.Fatalf("drift must not block start: %v", err)
	}
}

func TestLogRotationBounded(t *testing.T) {
	dir := t.TempDir()
	l, err := newRotatingLog(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		l.Write([]byte(strings.Repeat("x", 30) + "\n"))
	}
	l.Close()
	entries, _ := os.ReadDir(dir)
	var total int64
	for _, e := range entries {
		info, _ := e.Info()
		total += info.Size()
	}
	if total > 300 {
		t.Fatalf("log grew without bound: %d bytes", total)
	}
	_, cursor, rotated, _ := readLog(dir, 0, 1<<30)
	if !rotated {
		t.Fatalf("a cursor past the end should report rotation; cursor=%d", cursor)
	}
}

func TestHTTPSurface(t *testing.T) {
	s := newTestService(t)
	srv := httptest.NewServer(newOperationsHandler(s, "test"))
	defer srv.Close()

	var body struct {
		Error apiErrorBody `json:"error"`
	}
	resp, _ := http.Get(srv.URL + apiBase + "/workloads/local.nope")
	json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 404 || body.Error.Code != "WORKLOAD_NOT_FOUND" {
		t.Fatalf("404 shape: %d %+v", resp.StatusCode, body)
	}

	exe, _ := os.Executable()
	reg, _ := json.Marshal(map[string]any{"workload_id": "local.http", "exec_path": exe, "env": []string{"WL_HELPER=sleep"}})
	resp, _ = http.Post(srv.URL+apiBase+"/workloads", "application/json", strings.NewReader(string(reg)))
	if resp.StatusCode != 201 {
		t.Fatalf("register status %d", resp.StatusCode)
	}
	resp, _ = http.Post(srv.URL+apiBase+"/workloads/local.http/start", "application/json", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("start status %d", resp.StatusCode)
	}
	elevationCheck = elevated
	body.Error = apiErrorBody{}
	resp, _ = http.Post(srv.URL+apiBase+"/workloads", "application/json", strings.NewReader(string(reg)))
	json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 403 || body.Error.Code != "WORKLOAD_DAEMON_ELEVATED" {
		t.Fatalf("elevated register over HTTP: %d %+v", resp.StatusCode, body)
	}
}

// The real probe must be answerable on this OS; its value depends on how the
// test was launched, so only readability is asserted.
func TestProcessElevatedIsReadable(t *testing.T) {
	v, err := processElevated()
	if err != nil {
		t.Fatalf("elevation unreadable: %v", err)
	}
	t.Logf("process elevated = %v", v)
}
