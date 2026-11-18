package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultMaxRestarts = 3
	defaultBackoffMs   = 1000
	maxBackoff         = 30 * time.Second
	// absoluteRestartCap is the second half of FR-H4: even `always` with an
	// unlimited max cannot restart forever after exits that were never stable.
	absoluteRestartCap = 20
	// stableAfter is how long a run must last before it counts as healthy and
	// the consecutive-failure count resets.
	stableAfter = 60 * time.Second
	stopTimeout = 10 * time.Second
)

// service owns every registration and the program each one is running.
type service struct {
	st *store

	mu      sync.Mutex
	entries map[string]*entry

	// timing knobs, replaced by tests
	stable  time.Duration
	backoff time.Duration // overrides backoff_ms when > 0 (tests)
}

type entry struct {
	w   *Workload
	run *runState
}

type runState struct {
	cmd         *exec.Cmd
	cont        *containment
	stopReq     bool
	forced      bool
	loopDone    chan struct{} // closed when the supervise loop ends
	cancelSleep chan struct{} // closed to interrupt a restart backoff
	wakeOnce    sync.Once
}

func newService(st *store) (*service, error) {
	s := &service{st: st, entries: map[string]*entry{}, stable: stableAfter}
	list, err := st.list()
	if err != nil {
		return nil, err
	}
	st.reportCorrupt()
	for _, w := range list {
		// A program cannot have survived this module's death (FR-H5), so
		// whatever the record said, nothing is running now.
		w.Instance = nil
		if w.Status == StatusRunning || w.Status == StatusStarting || w.Status == StatusStopping {
			w.Status = StatusStopped
		}
		s.entries[w.WorkloadID] = &entry{w: w}
		s.refreshAvailability(w)
	}
	return s, nil
}

// restore starts every registration that declared auto_start (FR-B8). A refused
// or broken one is recorded and does not stop the rest.
func (s *service) restore() {
	s.mu.Lock()
	var ids []string
	for id, e := range s.entries {
		if e.w.Spec.AutoStart {
			ids = append(ids, id)
		}
	}
	s.mu.Unlock()
	sort.Strings(ids)
	for _, id := range ids {
		if _, err := s.start(id); err != nil {
			var ae *apiError
			code := "ERROR"
			if errors.As(err, &ae) {
				code = ae.Code
			}
			s.st.appendEvent(id, "auto_start_skipped", map[string]any{"code": code, "reason": err.Error()})
		}
	}
}

func (s *service) guardElevated() error {
	elevated, err := elevationCheck()
	if err != nil || elevated {
		msg := elevatedMessage
		if err != nil {
			msg = "could not determine whether the daemon is elevated, so it is treated as elevated: " + err.Error()
		}
		return errf(403, "WORKLOAD_DAEMON_ELEVATED", "%s", msg)
	}
	return nil
}

// refreshAvailability marks a registration whose program has vanished as
// unavailable, and only that one (FR-B8). Caller holds s.mu or owns w.
func (s *service) refreshAvailability(w *Workload) {
	if w.Status == StatusRunning || w.Status == StatusStarting || w.Status == StatusStopping {
		return
	}
	if _, err := os.Stat(w.Source.ExecPath); err != nil {
		w.Status = StatusUnavailable
	} else if w.Status == StatusUnavailable {
		w.Status = StatusStopped
	}
}

type registerInput struct {
	WorkloadID  string            `json:"workload_id"`
	DisplayName string            `json:"display_name"`
	ExecPath    string            `json:"exec_path"`
	Args        []string          `json:"args"`
	WorkingDir  string            `json:"working_dir"`
	Snapshot    map[string]string `json:"env_snapshot"`
	NoSnapshot  bool              `json:"no_env_snapshot"`
	EnvOverride []string          `json:"env"`
	Restart     string            `json:"restart"`
	MaxRestarts *int              `json:"max_restarts"`
	BackoffMs   *int              `json:"backoff_ms"`
	AutoStart   bool              `json:"auto_start"`
	Force       bool              `json:"force"`
}

func parseEnvPairs(pairs []string) (map[string]string, error) {
	out := map[string]string{}
	for _, p := range pairs {
		k, v, ok := strings.Cut(p, "=")
		if !ok || k == "" {
			return nil, errf(400, "WORKLOAD_INPUT_INVALID", "env entry %q must be KEY=VALUE", p)
		}
		out[k] = v
	}
	return out, nil
}

// secretEnvKey is the daemon-secret filter: anything in Terra's own namespace
// is the platform's, never the program's (FR-H6). It applies to the snapshot at
// registration, again at launch, and to declared overrides.
func secretEnvKey(k string) bool {
	return strings.HasPrefix(strings.ToUpper(k), "TERRA_")
}

func filterSecrets(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		if !secretEnvKey(k) {
			out[k] = v
		}
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func validateRestart(r Restart) error {
	switch r.Policy {
	case RestartNever, RestartOnFailure, RestartAlways:
	default:
		return errf(400, "WORKLOAD_INPUT_INVALID", "restart policy %q must be never, on-failure or always", r.Policy)
	}
	if r.MaxRestarts < 0 || r.BackoffMs < 0 {
		return errf(400, "WORKLOAD_INPUT_INVALID", "max_restarts and backoff_ms cannot be negative")
	}
	return nil
}

func (s *service) register(in registerInput) (*Workload, error) {
	if err := s.guardElevated(); err != nil {
		return nil, err
	}
	if err := validateID(in.WorkloadID); err != nil {
		return nil, err
	}
	if err := checkExecutable(in.ExecPath); err != nil {
		return nil, err
	}
	overrides, err := parseEnvPairs(in.EnvOverride)
	if err != nil {
		return nil, err
	}
	overrides = filterSecrets(overrides)

	r := Restart{Policy: RestartNever, MaxRestarts: defaultMaxRestarts, BackoffMs: defaultBackoffMs}
	if in.Restart != "" {
		r.Policy = in.Restart
	}
	if in.MaxRestarts != nil {
		r.MaxRestarts = *in.MaxRestarts
	}
	if in.BackoffMs != nil {
		r.BackoffMs = *in.BackoffMs
	}
	if err := validateRestart(r); err != nil {
		return nil, err
	}

	snapshot := filterSecrets(in.Snapshot)
	mode := EnvDeclared
	if len(snapshot) > 0 && !in.NoSnapshot {
		mode = EnvShellSnapshot
	} else {
		snapshot = nil
	}

	digest, err := fileDigest(in.ExecPath)
	if err != nil {
		return nil, errf(400, "WORKLOAD_EXEC_NOT_FOUND", "cannot read %q: %v", in.ExecPath, err)
	}
	workDir := in.WorkingDir
	if workDir == "" {
		workDir = filepath.Dir(in.ExecPath)
	}
	name := in.DisplayName
	if name == "" {
		name = strings.TrimPrefix(in.WorkloadID, localPrefix)
	}
	now := nowUTC()
	w := &Workload{
		WorkloadID: in.WorkloadID, DisplayName: name, Scope: "node-local", Driver: "exec",
		Source: Source{Mode: "link", ExecPath: in.ExecPath, DigestAtRegister: digest, DigestNow: digest},
		Spec: Spec{
			Args: nonNil(in.Args), WorkingDir: workDir, Restart: r, AutoStart: in.AutoStart,
			Env: EnvSpec{Mode: mode, Keys: sortedKeys(snapshot), Overrides: overrides},
		},
		Status: StatusStopped, CreatedAt: now, UpdatedAt: now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.entries[w.WorkloadID]; ok {
		if !in.Force {
			return nil, errf(409, "WORKLOAD_ALREADY_EXISTS", "%s is already registered (use force to replace it)", w.WorkloadID)
		}
		if old.run != nil {
			return nil, errf(409, "WORKLOAD_RUNNING", "%s is running; stop it before replacing it", w.WorkloadID)
		}
		w.CreatedAt = old.w.CreatedAt
	}
	if err := s.st.save(w); err != nil {
		return nil, err
	}
	if mode == EnvShellSnapshot {
		if err := s.st.writeSnapshot(w.WorkloadID, snapshot); err != nil {
			return nil, err
		}
	} else {
		_ = os.Remove(filepath.Join(s.st.dir(w.WorkloadID), "env.snapshot"))
	}
	s.entries[w.WorkloadID] = &entry{w: w}
	s.st.appendEvent(w.WorkloadID, "registered", map[string]any{"exec_path": w.Source.ExecPath})
	return publicView(clone(w)), nil
}

func nonNil(a []string) []string {
	if a == nil {
		return []string{}
	}
	return a
}

func clone(w *Workload) *Workload {
	c := *w
	c.Spec.Args = append([]string{}, w.Spec.Args...)
	c.Spec.Env.Keys = append([]string{}, w.Spec.Env.Keys...)
	if w.Spec.Env.Overrides != nil {
		c.Spec.Env.Overrides = map[string]string{}
		for k, v := range w.Spec.Env.Overrides {
			c.Spec.Env.Overrides[k] = v
		}
	}
	if w.Instance != nil {
		i := *w.Instance
		c.Instance = &i
	}
	if w.LastExit != nil {
		l := *w.LastExit
		c.LastExit = &l
	}
	return &c
}

func (s *service) list() []*Workload {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Workload, 0, len(s.entries))
	for _, e := range s.entries {
		s.refreshAvailability(e.w)
		out = append(out, publicView(clone(e.w)))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkloadID < out[j].WorkloadID })
	return out
}

func notFound(id string) error {
	return errf(404, "WORKLOAD_NOT_FOUND",
		"no workload %q is registered on this node (a reference registration exists only on the node where it was made)", id)
}

func (s *service) get(id string) (*Workload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok {
		return nil, notFound(id)
	}
	s.refreshAvailability(e.w)
	c := publicView(clone(e.w))
	// drift is a report, not an error (D-16)
	if now, err := fileDigest(c.Source.ExecPath); err == nil {
		c.Source.DigestNow = now
		c.Source.Drift = now != c.Source.DigestAtRegister
	} else {
		c.Source.DigestNow = ""
	}
	return c, nil
}

type updateInput struct {
	WorkloadID  string            `json:"workload_id"`
	DisplayName *string           `json:"display_name"`
	Args        *[]string         `json:"args"`
	WorkingDir  *string           `json:"working_dir"`
	EnvOverride *[]string         `json:"env"`
	Snapshot    map[string]string `json:"env_snapshot"`
	Restart     *string           `json:"restart"`
	MaxRestarts *int              `json:"max_restarts"`
	BackoffMs   *int              `json:"backoff_ms"`
	AutoStart   *bool             `json:"auto_start"`
}

// update edits a registration. It applies from the next start (FR-A5), so it
// is allowed while the program runs. It changes what a program will be run
// with, so the elevation guard covers it like register.
func (s *service) update(in updateInput) (*Workload, error) {
	if err := s.guardElevated(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[in.WorkloadID]
	if !ok {
		return nil, notFound(in.WorkloadID)
	}
	w := clone(e.w)
	if in.DisplayName != nil {
		w.DisplayName = *in.DisplayName
	}
	if in.Args != nil {
		w.Spec.Args = nonNil(*in.Args)
	}
	if in.WorkingDir != nil {
		w.Spec.WorkingDir = *in.WorkingDir
	}
	if in.EnvOverride != nil {
		o, err := parseEnvPairs(*in.EnvOverride)
		if err != nil {
			return nil, err
		}
		w.Spec.Env.Overrides = filterSecrets(o)
	}
	if in.Restart != nil {
		w.Spec.Restart.Policy = *in.Restart
	}
	if in.MaxRestarts != nil {
		w.Spec.Restart.MaxRestarts = *in.MaxRestarts
	}
	if in.BackoffMs != nil {
		w.Spec.Restart.BackoffMs = *in.BackoffMs
	}
	if in.AutoStart != nil {
		w.Spec.AutoStart = *in.AutoStart
	}
	if err := validateRestart(w.Spec.Restart); err != nil {
		return nil, err
	}
	if len(in.Snapshot) > 0 {
		snap := filterSecrets(in.Snapshot)
		if err := s.st.writeSnapshot(w.WorkloadID, snap); err != nil {
			return nil, err
		}
		w.Spec.Env.Mode, w.Spec.Env.Keys = EnvShellSnapshot, sortedKeys(snap)
	}
	w.UpdatedAt = nowUTC()
	if err := s.st.save(w); err != nil {
		return nil, err
	}
	e.w.DisplayName, e.w.Spec, e.w.UpdatedAt = w.DisplayName, w.Spec, w.UpdatedAt
	s.st.appendEvent(w.WorkloadID, "updated", nil)
	return publicView(clone(e.w)), nil
}

func (s *service) remove(id string, force bool) error {
	s.mu.Lock()
	e, ok := s.entries[id]
	if !ok {
		s.mu.Unlock()
		return notFound(id)
	}
	running := e.run != nil
	s.mu.Unlock()
	if running {
		if !force {
			return errf(409, "WORKLOAD_RUNNING", "%s is running; stop it first or remove with force", id)
		}
		if _, err := s.stop(id, stopTimeout); err != nil {
			return err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, id)
	return s.st.remove(id)
}

func (s *service) logDir(id string) string { return filepath.Join(s.st.dir(id), "logs") }

func (s *service) exists(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.entries[id]; !ok {
		return notFound(id)
	}
	return nil
}
