//go:build !windows

package main

import (
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The helper modes live in init() rather than TestMain because service_test.go
// already owns TestMain; init runs first and exits before any test starts.
func init() {
	switch os.Getenv("WL2_HELPER") {
	case "":
		return
	case "tree":
		// Spawn a grandchild (optionally in its own session, escaping the
		// process group), publish its pid, then idle.
		child := exec.Command(os.Args[0])
		child.Env = []string{"WL2_HELPER=idle"}
		child.Stdout, child.Stderr = os.Stdout, os.Stderr // inherit the log pipe
		if os.Getenv("WL2_SETSID") == "1" {
			child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		}
		if err := child.Start(); err != nil {
			os.Exit(3)
		}
		_ = os.WriteFile(os.Getenv("WL2_PIDFILE"), []byte(strconv.Itoa(child.Process.Pid)), 0o600)
		println("ready")
		time.Sleep(time.Hour)
	case "idle":
		time.Sleep(time.Hour)
	case "term-exit":
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGTERM)
		println("ready")
		<-ch
		os.Exit(0)
	case "term-ignore":
		signal.Ignore(syscall.SIGTERM)
		println("ready")
		time.Sleep(time.Hour)
	case "life":
		ms, _ := strconv.Atoi(os.Getenv("WL2_LIFE_MS"))
		code, _ := strconv.Atoi(os.Getenv("WL2_EXIT"))
		time.Sleep(time.Duration(ms) * time.Millisecond)
		os.Exit(code)
	}
	os.Exit(0)
}

func helper2(id, mode string, extra ...string) registerInput {
	exe, _ := os.Executable()
	return registerInput{WorkloadID: id, ExecPath: exe, EnvOverride: append([]string{"WL2_HELPER=" + mode}, extra...)}
}

func pidAlive(pid int) bool {
	if syscall.Kill(pid, 0) != nil {
		return false
	}
	// A zombie still answers signal 0; treat it as gone.
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err == nil {
		if i := strings.LastIndexByte(string(b), ')'); i >= 0 && i+2 < len(b) && b[i+2] == 'Z' {
			return false
		}
	}
	return true
}

func readPid(t *testing.T, path string) int {
	t.Helper()
	pid := 0
	waitFor(t, "grandchild pid file", func() bool {
		b, err := os.ReadFile(path)
		if err != nil {
			return false
		}
		pid, err = strconv.Atoi(string(b))
		return err == nil && pid > 0
	})
	return pid
}

func countEvents(s *service, id, kind string) int {
	events, _ := s.st.events(id, 1000)
	n := 0
	for _, e := range events {
		if e.Kind == kind {
			n++
		}
	}
	return n
}

func waitReady(t *testing.T, s *service, id string) {
	t.Helper()
	waitFor(t, "helper ready", func() bool { return strings.Contains(logText(t, s, id), "ready") })
}

func TestStopKillsGrandchildInSameGroup(t *testing.T) {
	s := newTestService(t)
	pidFile := filepath.Join(t.TempDir(), "gc.pid")
	if _, err := s.register(helper2("local.tree", "tree", "WL2_PIDFILE="+pidFile)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.start("local.tree"); err != nil {
		t.Fatal(err)
	}
	gc := readPid(t, pidFile)
	if !pidAlive(gc) {
		t.Fatal("grandchild should be alive before stop")
	}
	if _, err := s.stop("local.tree", 300*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "grandchild gone", func() bool { return !pidAlive(gc) })
}

// A grandchild that left the process group with setsid must still not outlive
// a stop; otherwise "stop" would leave a running orphan.
func TestStopKillsGrandchildThatLeftTheGroup(t *testing.T) {
	s := newTestService(t)
	pidFile := filepath.Join(t.TempDir(), "gc.pid")
	if _, err := s.register(helper2("local.setsid", "tree", "WL2_PIDFILE="+pidFile, "WL2_SETSID=1")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.start("local.setsid"); err != nil {
		t.Fatal(err)
	}
	gc := readPid(t, pidFile)
	t.Cleanup(func() { _ = syscall.Kill(gc, syscall.SIGKILL) })
	began := time.Now()
	if _, err := s.stop("local.setsid", 300*time.Millisecond); err != nil {
		t.Fatalf("stop: %v (took %v)", err, time.Since(began))
	}
	// Documents the guarantee we want: nothing the program started survives.
	waitFor(t, "setsid grandchild gone", func() bool { return !pidAlive(gc) })
}

func TestStopGracefulWhenProgramHandlesSigterm(t *testing.T) {
	s := newTestService(t)
	s.register(helper2("local.term", "term-exit"))
	if _, err := s.start("local.term"); err != nil {
		t.Fatal(err)
	}
	waitReady(t, s, "local.term")
	res, err := s.stop("local.term", 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if res.Forced || res.Status != StatusStopped || res.ExitCode != 0 {
		t.Fatalf("graceful stop = %+v", res)
	}
}

func TestStopForcedWhenProgramIgnoresSigterm(t *testing.T) {
	s := newTestService(t)
	s.register(helper2("local.ignore", "term-ignore"))
	if _, err := s.start("local.ignore"); err != nil {
		t.Fatal(err)
	}
	waitReady(t, s, "local.ignore")
	began := time.Now()
	res, err := s.stop("local.ignore", 300*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Forced || res.Status != StatusStopped {
		t.Fatalf("forced stop = %+v", res)
	}
	if time.Since(began) < 300*time.Millisecond {
		t.Fatalf("killed before the grace budget ran out: %v", time.Since(began))
	}
	if w := mustGet(t, s, "local.ignore"); w.LastExit == nil || !w.LastExit.Forced {
		t.Fatalf("last_exit = %+v", w.LastExit)
	}
}

func TestRestartAlwaysRestartsAfterCleanExit(t *testing.T) {
	s := newTestService(t)
	in := helper2("local.always", "life", "WL2_LIFE_MS=10", "WL2_EXIT=0")
	in.Restart = RestartAlways
	s.register(in)
	if _, err := s.start("local.always"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a restart after exit 0", func() bool { return countEvents(s, "local.always", "started") >= 2 })
}

func TestOnFailureDoesNotRestartAfterCleanExit(t *testing.T) {
	s := newTestService(t)
	in := helper2("local.onfail", "life", "WL2_LIFE_MS=10", "WL2_EXIT=0")
	in.Restart = RestartOnFailure
	s.register(in)
	if _, err := s.start("local.onfail"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "stopped", func() bool { w, _ := s.get("local.onfail"); return w.Status == StatusStopped && w.LastExit != nil })
	time.Sleep(200 * time.Millisecond) // several backoff periods
	if n := countEvents(s, "local.onfail", "started"); n != 1 {
		t.Fatalf("started %d times, want 1", n)
	}
}

func runLifecycle(t *testing.T, id string, stable time.Duration) *service {
	s := newTestService(t)
	s.stable = stable
	in := helper2(id, "life", "WL2_LIFE_MS=150", "WL2_EXIT=1")
	in.Restart = RestartOnFailure
	one := 1
	in.MaxRestarts = &one
	s.register(in)
	if _, err := s.start(id); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestStableRunResetsRestartCount(t *testing.T) {
	// Every run outlives s.stable, so the budget of 1 restart never runs out.
	s := runLifecycle(t, "local.stable", 50*time.Millisecond)
	waitFor(t, "4 starts", func() bool { return countEvents(s, "local.stable", "started") >= 4 })
	if countEvents(s, "local.stable", "restart_storm") != 0 {
		t.Fatal("stable runs must not count towards a restart storm")
	}
}

func TestUnstableRunsExhaustRestartBudget(t *testing.T) {
	// Control for the test above: with a long stable window the same program
	// gives up after first run + 1 restart.
	s := runLifecycle(t, "local.unstable", time.Hour)
	waitFor(t, "storm", func() bool { w, _ := s.get("local.unstable"); return w.Status == StatusFailed })
	if n := countEvents(s, "local.unstable", "started"); n != 2 {
		t.Fatalf("started %d times, want 2", n)
	}
}
