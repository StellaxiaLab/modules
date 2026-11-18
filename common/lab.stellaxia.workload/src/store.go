package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
)

// maxEventsBytes bounds one workload's current events.jsonl. One rotated copy
// (events.jsonl.1) is kept, the same scheme as the program log, so the history
// costs at most twice this and events() never reads more than that.
const maxEventsBytes = 1 << 20

// store keeps each registration in its own folder:
//
//	workloads/{id}/record.json   the Workload (declared overrides included, 0600)
//	workloads/{id}/env.snapshot  the shell snapshot's values, owner-only
//	workloads/{id}/events.jsonl  run history (+ events.jsonl.1 after rotation)
//	workloads/{id}/logs/         captured stdout/stderr, rotated
type store struct {
	root string
	mu   sync.Mutex
	// maxEvents is maxEventsBytes; tests lower it.
	maxEvents int64
	// stderr receives the module's own diagnostics; tests replace it.
	stderr io.Writer

	// corrupt lists the registrations the last list() could not read. They are
	// skipped so they cannot hide the others (FR-B8) but are never silent.
	corrupt []corruptRecord
}

type corruptRecord struct {
	ID  string
	Err error
}

func newStore(dataDir string) (*store, error) {
	root := filepath.Join(dataDir, "workloads")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &store{root: root, maxEvents: maxEventsBytes, stderr: os.Stderr}, nil
}

func (s *store) dir(id string) string { return filepath.Join(s.root, id) }

func (s *store) logf(format string, a ...any) {
	fmt.Fprintf(s.stderr, "terra-workload: "+format+"\n", a...)
}

func (s *store) save(w *Workload) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir(w.WorkloadID), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(w, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir(w.WorkloadID), "record.json"), data)
}

func (s *store) load(id string) (*Workload, error) {
	data, err := os.ReadFile(filepath.Join(s.dir(id), "record.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	var w Workload
	if err := json.Unmarshal(data, &w); err != nil {
		return nil, err
	}
	return &w, nil
}

func (s *store) list() ([]*Workload, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	var out []*Workload
	var bad []corruptRecord
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		w, err := s.load(e.Name())
		if err != nil {
			// A damaged record must not hide the others (FR-B8), but it is
			// remembered so the service can report it.
			bad = append(bad, corruptRecord{ID: e.Name(), Err: err})
			continue
		}
		out = append(out, w)
	}
	s.mu.Lock()
	s.corrupt = bad
	s.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].WorkloadID < out[j].WorkloadID })
	return out, nil
}

// reportCorrupt makes the records list() skipped visible: one stderr line and
// one corrupt_record event (in that folder's own events.jsonl) each. The files
// are left untouched so a person can repair or delete them.
func (s *store) reportCorrupt() {
	for _, c := range s.corruptRecords() {
		s.logf("skipping workload folder %q: record.json is unreadable: %v", c.ID, c.Err)
		s.appendEvent(c.ID, "corrupt_record", map[string]any{"error": c.Err.Error()})
	}
}

func (s *store) corruptRecords() []corruptRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]corruptRecord(nil), s.corrupt...)
}

func (s *store) remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.RemoveAll(s.dir(id))
}

// writeSnapshot stores the snapshot values in an owner-only file. They never
// leave this file except into a launched program's environment.
func (s *store) writeSnapshot(id string, env map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir(id), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.dir(id), "env.snapshot"), data)
}

func (s *store) readSnapshot(id string) (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(s.dir(id), "env.snapshot"))
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	return out, json.Unmarshal(data, &out)
}

// writeAtomic replaces path so that a crash leaves either the old or the new
// content, never a torn file: write a temp file, fsync it, rename it over the
// target, then fsync the directory so the rename itself survives power loss.
func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return syncDir(filepath.Dir(path))
}

// syncDir flushes a directory entry. Windows cannot open a directory for
// syncing and NTFS journals the rename, so it is skipped there.
func syncDir(dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// Event is one line of run history (FR-D3).
type Event struct {
	At     string         `json:"at"`
	Kind   string         `json:"kind"`
	Detail map[string]any `json:"detail,omitempty"`
}

// appendEvent adds one line of history. A history write must never fail the
// operation it describes, so errors are logged to stderr and dropped. Events
// are not fsynced (losing the last line to a crash is acceptable, losing the
// record is not). When the file would pass maxEvents it is rotated first.
func (s *store) appendEvent(id, kind string, detail map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir(id), 0o700); err != nil {
		s.logf("workload %s: cannot write event %s: %v", id, kind, err)
		return
	}
	path := filepath.Join(s.dir(id), "events.jsonl")
	line, _ := json.Marshal(Event{At: nowUTC(), Kind: kind, Detail: detail})
	line = append(line, '\n')
	if info, err := os.Stat(path); err == nil && info.Size() > 0 && info.Size()+int64(len(line)) > s.maxEvents {
		_ = os.Remove(path + ".1")
		if err := os.Rename(path, path+".1"); err != nil {
			s.logf("workload %s: cannot rotate events.jsonl: %v", id, err)
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		s.logf("workload %s: cannot write event %s: %v", id, kind, err)
		return
	}
	defer f.Close()
	if _, err := f.Write(line); err != nil {
		s.logf("workload %s: cannot write event %s: %v", id, kind, err)
	}
}

// events returns the newest `limit` events, oldest first, across the rotated
// copy and the current file.
func (s *store) events(id string, limit int) ([]Event, error) {
	path := filepath.Join(s.dir(id), "events.jsonl")
	all := []Event{}
	for _, p := range []string{path + ".1", path} {
		got, err := readEvents(p)
		if err != nil {
			return nil, err
		}
		all = append(all, got...)
	}
	if limit > 0 && len(all) > limit {
		all = all[len(all)-limit:]
	}
	return all, nil
}

func readEvents(path string) ([]Event, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Event
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var e Event
		if json.Unmarshal(sc.Bytes(), &e) == nil {
			out = append(out, e)
		}
	}
	return out, nil
}
