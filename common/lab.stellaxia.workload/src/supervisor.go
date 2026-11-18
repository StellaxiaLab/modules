package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

// safeEnvKeys is what a program gets when it was registered WITHOUT a shell
// snapshot: the same small set the module host passes to modules, taken from
// this process (which already received only that set).
var safeEnvKeys = []string{
	"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
	"HOME", "USERPROFILE", "PROGRAMDATA", "APPDATA", "LOCALAPPDATA",
	"LANG", "LANGUAGE", "TZ", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
}

func safeEnvironment() map[string]string {
	out := map[string]string{}
	for _, kv := range os.Environ() {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		upper := strings.ToUpper(k)
		keep := strings.HasPrefix(upper, "LC_")
		for _, s := range safeEnvKeys {
			if upper == s {
				keep = true
			}
		}
		if keep {
			out[k] = v
		}
	}
	return out
}

// buildEnv assembles the launched program's environment: the registration
// shell's snapshot (or the safe set) with declared overrides on top, and nothing
// from Terra's own namespace in any case (FR-C3, FR-H6).
func (s *service) buildEnv(w *Workload) ([]string, error) {
	base := safeEnvironment()
	if w.Spec.Env.Mode == EnvShellSnapshot {
		snap, err := s.st.readSnapshot(w.WorkloadID)
		if err != nil {
			return nil, err
		}
		base = snap
	}
	merged := map[string]string{}
	for k, v := range filterSecrets(base) {
		merged[k] = v
	}
	for k, v := range filterSecrets(w.Spec.Env.Overrides) {
		merged[k] = v
	}
	out := make([]string, 0, len(merged))
	for _, k := range sortedKeys(merged) {
		out = append(out, k+"="+merged[k])
	}
	return out, nil
}

// start launches the program and hands it to a supervise loop. It is
// idempotent: a program that is already running answers with its current state.
func (s *service) start(id string) (*Workload, error) {
	if err := s.guardElevated(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	e, ok := s.entries[id]
	if !ok {
		s.mu.Unlock()
		return nil, notFound(id)
	}
	if e.run != nil {
		c := clone(e.w)
		s.mu.Unlock()
		return c, nil
	}
	if _, err := os.Stat(e.w.Source.ExecPath); err != nil {
		e.w.Status = StatusUnavailable
		s.mu.Unlock()
		return nil, errf(409, "WORKLOAD_EXEC_MISSING", "%s was registered from %q, which no longer exists", id, e.w.Source.ExecPath)
	}
	rs := &runState{loopDone: make(chan struct{}), cancelSleep: make(chan struct{})}
	e.run = rs
	e.w.Status = StatusStarting
	s.mu.Unlock()

	// The first launch runs inline so a program that cannot start at all is
	// reported to the caller instead of vanishing into the loop.
	first, err := s.launch(id, rs, 0)
	if err != nil {
		s.mu.Lock()
		e.run = nil
		e.w.Status = StatusFailed
		s.persistLocked(e)
		s.mu.Unlock()
		s.st.appendEvent(id, "start_failed", map[string]any{"error": err.Error()})
		return nil, errf(409, "WORKLOAD_EXEC_NOT_EXECUTABLE", "%s could not be started: %v", id, err)
	}
	go s.supervise(id, rs, first)
	s.mu.Lock()
	defer s.mu.Unlock()
	return clone(e.w), nil
}

// persistLocked writes the record after a state change the supervisor made on
// its own (start, exit, restart). Failure policy: the in-memory state stays
// authoritative and the transition is NOT rolled back, because the program has
// already started or exited and pretending otherwise would be worse than a
// stale file. The failure is logged to stderr and recorded as a persist_failed
// event so it is visible; after a module restart the older on-disk state wins
// and is normalised by newService. Caller holds s.mu.
func (s *service) persistLocked(e *entry) {
	e.w.UpdatedAt = nowUTC()
	if err := s.st.save(e.w); err != nil {
		s.st.logf("workload %s: cannot save record.json: %v", e.w.WorkloadID, err)
		s.st.appendEvent(e.w.WorkloadID, "persist_failed", map[string]any{"error": err.Error(), "status": e.w.Status})
	}
}

// exitResult is what one run of the program ended with.
type exitResult struct {
	code     int
	duration time.Duration
}

// launched is a started program plus the channel its exit arrives on.
type launched struct {
	cmd     *exec.Cmd
	started time.Time
	waitErr chan error
	log     *rotatingLog
}

func (s *service) launch(id string, rs *runState, restarts int) (*launched, error) {
	s.mu.Lock()
	w := clone(s.entries[id].w)
	s.mu.Unlock()
	env, err := s.buildEnv(w)
	if err != nil {
		return nil, err
	}
	logw, err := newRotatingLog(s.logDir(id), maxLogBytes)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(w.Source.ExecPath, w.Spec.Args...)
	cmd.Dir = w.Spec.WorkingDir
	cmd.Env = env
	cmd.Stdin = nil
	cmd.Stdout, cmd.Stderr = logw, logw
	prepareCmd(cmd)
	if err := cmd.Start(); err != nil {
		logw.Close()
		return nil, err
	}
	cont, cerr := contain(cmd)
	if cerr != nil {
		// Without containment FR-H5 cannot hold; do not run uncontained.
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		logw.Close()
		return nil, cerr
	}
	l := &launched{cmd: cmd, started: time.Now(), waitErr: make(chan error, 1), log: logw}
	s.mu.Lock()
	rs.cmd, rs.cont = cmd, cont
	e := s.entries[id]
	e.w.Status = StatusRunning
	e.w.Instance = &Instance{PID: cmd.Process.Pid, StartedAt: nowUTC(), RestartCount: restarts}
	s.persistLocked(e)
	s.mu.Unlock()
	s.st.appendEvent(id, "started", map[string]any{"pid": cmd.Process.Pid, "restart_count": restarts})
	go func() { l.waitErr <- cmd.Wait() }()
	return l, nil
}

func exitCode(err error, cmd *exec.Cmd) int {
	if cmd.ProcessState != nil {
		return cmd.ProcessState.ExitCode()
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// supervise waits for the program, records how it ended, and applies the
// restart policy until the program stops for good.
func (s *service) supervise(id string, rs *runState, cur *launched) {
	defer close(rs.loopDone)
	consecutive := 0
	restarts := 0
	for {
		err := <-cur.waitErr
		dur := time.Since(cur.started)
		code := exitCode(err, cur.cmd)
		cur.log.Close()
		if rs.cont != nil {
			rs.cont.close()
		}

		s.mu.Lock()
		e := s.entries[id]
		policy := e.w.Spec.Restart
		stopped := rs.stopReq
		forced := rs.forced
		e.w.LastExit = &LastExit{Code: code, Forced: forced, At: nowUTC()}
		e.w.Instance = nil
		s.mu.Unlock()
		s.st.appendEvent(id, "exited", map[string]any{"code": code, "forced": forced, "duration_ms": dur.Milliseconds()})

		again := !stopped && (policy.Policy == RestartAlways || (policy.Policy == RestartOnFailure && code != 0))
		if !again {
			s.finish(id, rs, code, stopped)
			return
		}
		if dur >= s.stable {
			consecutive = 0
		}
		consecutive++
		if consecutive > absoluteRestartCap || (policy.MaxRestarts > 0 && consecutive > policy.MaxRestarts) {
			s.st.appendEvent(id, "restart_storm", map[string]any{
				"code": "WORKLOAD_RESTART_STORM", "consecutive": consecutive - 1, "last_exit_code": code})
			s.finishFailed(id, rs)
			return
		}
		wait := s.backoffFor(policy.BackoffMs, consecutive)
		s.mu.Lock()
		e.w.Status = StatusStarting
		s.persistLocked(e)
		s.mu.Unlock()
		select {
		case <-time.After(wait):
		case <-rs.cancelSleep:
			s.finish(id, rs, code, true)
			return
		}
		restarts++
		next, lerr := s.launch(id, rs, restarts)
		if lerr != nil {
			s.st.appendEvent(id, "restart_failed", map[string]any{"error": lerr.Error()})
			s.finishFailed(id, rs)
			return
		}
		cur = next
	}
}

func (s *service) backoffFor(backoffMs, consecutive int) time.Duration {
	if s.backoff > 0 {
		return s.backoff
	}
	d := time.Duration(backoffMs) * time.Millisecond
	for i := 1; i < consecutive && d < maxBackoff; i++ {
		d *= 2
	}
	if d > maxBackoff {
		d = maxBackoff
	}
	return d
}

func (s *service) finish(id string, rs *runState, code int, stopRequested bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return
	}
	e.run = nil
	if stopRequested || code == 0 {
		e.w.Status = StatusStopped
	} else {
		e.w.Status = StatusFailed
	}
	s.persistLocked(e)
}

func (s *service) finishFailed(id string, rs *runState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.entries[id]; e != nil {
		e.run = nil
		e.w.Status = StatusFailed
		s.persistLocked(e)
	}
}

// StopResult is the stop response; forced is mandatory because an operator must
// be able to tell a graceful exit from a kill (F-3).
type StopResult struct {
	WorkloadID string `json:"workload_id"`
	Status     string `json:"status"`
	ExitCode   int    `json:"exit_code"`
	Forced     bool   `json:"forced"`
	DurationMs int64  `json:"duration_ms"`
}

// stop asks the program to end, and kills it when the budget runs out. Stopping
// a program that is not running is a success that says so.
func (s *service) stop(id string, timeout time.Duration) (*StopResult, error) {
	began := time.Now()
	s.mu.Lock()
	e, ok := s.entries[id]
	if !ok {
		s.mu.Unlock()
		return nil, notFound(id)
	}
	rs := e.run
	if rs == nil {
		res := &StopResult{WorkloadID: id, Status: e.w.Status}
		if e.w.LastExit != nil {
			res.ExitCode, res.Forced = e.w.LastExit.Code, e.w.LastExit.Forced
		}
		s.mu.Unlock()
		return res, nil
	}
	rs.stopReq = true
	e.w.Status = StatusStopping
	cmd, cont := rs.cmd, rs.cont
	s.mu.Unlock()
	rs.wake()

	graceful := cmd != nil && cont != nil && cont.interrupt(cmd)
	if graceful {
		select {
		case <-rs.loopDone:
		case <-time.After(timeout):
			graceful = false
		}
	}
	if !graceful {
		s.mu.Lock()
		rs.forced = true
		s.mu.Unlock()
		if cmd != nil && cont != nil {
			cont.terminate(cmd)
		}
		select {
		case <-rs.loopDone:
		case <-time.After(5 * time.Second):
			return nil, errf(503, "WORKLOAD_UNAVAILABLE", "%s did not exit after a forced kill", id)
		}
	}
	s.st.appendEvent(id, "stopped", map[string]any{"forced": rs.forced})
	s.mu.Lock()
	defer s.mu.Unlock()
	res := &StopResult{WorkloadID: id, Status: e.w.Status, Forced: rs.forced, DurationMs: time.Since(began).Milliseconds()}
	if e.w.LastExit != nil {
		res.ExitCode = e.w.LastExit.Code
	}
	return res, nil
}

// wake interrupts a restart backoff sleep; safe to call more than once.
func (rs *runState) wake() { rs.wakeOnce.Do(func() { close(rs.cancelSleep) }) }

func (s *service) restart(id string, timeout time.Duration) (*Workload, error) {
	if err := s.guardElevated(); err != nil {
		return nil, err
	}
	if _, err := s.stop(id, timeout); err != nil {
		return nil, err
	}
	return s.start(id)
}
