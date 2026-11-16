package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// store keeps each registration in its own folder:
//
//	workloads/{id}/record.json   the Workload (no env values)
//	workloads/{id}/env.snapshot  the shell snapshot's values, owner-only
//	workloads/{id}/events.jsonl  run history
//	workloads/{id}/logs/         captured stdout/stderr, rotated
type store struct {
	root string
	mu   sync.Mutex
}

func newStore(dataDir string) (*store, error) {
	root := filepath.Join(dataDir, "workloads")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &store{root: root}, nil
}

func (s *store) dir(id string) string { return filepath.Join(s.root, id) }

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
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		w, err := s.load(e.Name())
		if err != nil {
			continue // a damaged record must not hide the others (FR-B8)
		}
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WorkloadID < out[j].WorkloadID })
	return out, nil
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

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Event is one line of run history (FR-D3).
type Event struct {
	At     string         `json:"at"`
	Kind   string         `json:"kind"`
	Detail map[string]any `json:"detail,omitempty"`
}

func (s *store) appendEvent(id, kind string, detail map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir(id), 0o700); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(s.dir(id), "events.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	line, _ := json.Marshal(Event{At: nowUTC(), Kind: kind, Detail: detail})
	f.Write(append(line, '\n'))
}

// events returns the newest `limit` events, oldest first.
func (s *store) events(id string, limit int) ([]Event, error) {
	f, err := os.Open(filepath.Join(s.dir(id), "events.jsonl"))
	if errors.Is(err, os.ErrNotExist) {
		return []Event{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var all []Event
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var e Event
		if json.Unmarshal(sc.Bytes(), &e) == nil {
			all = append(all, e)
		}
	}
	if limit > 0 && len(all) > limit {
		all = all[len(all)-limit:]
	}
	if all == nil {
		all = []Event{}
	}
	return all, nil
}
