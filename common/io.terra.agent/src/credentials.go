package main

// Registered delegated credentials — one per person, in a 0600 file.
//
// A person mints a credential with `terra agent grant` and hands it to this
// module with `terra agent credential set --token-stdin`. From then on the
// module acts at the Gateway AS that credential for that person's sessions. The
// value never leaves this file: no operation returns it, no prompt carries it,
// and the room shows only the facts the Gateway established about it.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

const credentialsFileName = "credentials.json"

// errCredentialMissing is answered when a person has registered nothing.
var errCredentialMissing = errors.New("no delegated credential is registered for this person; run `terra agent grant` and `terra agent credential set --token-stdin`")

// credentialRecord is one person's registered credential and the facts the
// Gateway established about it at registration.
type credentialRecord struct {
	Principal    string   `json:"principal"`
	Credential   string   `json:"credential"`
	Delegate     string   `json:"delegate,omitempty"`
	Permissions  []string `json:"permissions,omitempty"`
	Reach        string   `json:"reach,omitempty"`
	ExpiresAt    string   `json:"expires_at,omitempty"`
	RegisteredMS int64    `json:"registered_ms"`
	// Unattended and PreApproved are what the Gateway said about this
	// credential when it was registered (A7). They are kept so a session can be
	// refused at the door — "this credential has nobody's advance consent" is a
	// better answer than a session that opens and then refuses every write.
	Unattended  bool     `json:"unattended,omitempty"`
	PreApproved []string `json:"pre_approved,omitempty"`
}

// facts is what the record looks like to a caller: everything but the value.
func (r credentialRecord) facts(now time.Time) map[string]any {
	facts := map[string]any{
		"registered":  true,
		"principal":   r.Principal,
		"delegate":    r.Delegate,
		"permissions": append([]string{}, r.Permissions...),
		"reach":       r.Reach,
		"expires_at":  r.ExpiresAt,
		"expired":     r.expired(now),
		"unattended":  r.Unattended,
	}
	if r.PreApproved != nil {
		facts["pre_approved"] = append([]string{}, r.PreApproved...)
	}
	if facts["permissions"] == nil {
		facts["permissions"] = []string{}
	}
	return facts
}

// expired reports whether the Gateway's own expiry has passed. A record with
// no expiry is not judged here — the Gateway will refuse it when it must.
func (r credentialRecord) expired(now time.Time) bool {
	if r.ExpiresAt == "" {
		return false
	}
	expiry, err := time.Parse(time.RFC3339, r.ExpiresAt)
	if err != nil {
		return false
	}
	return !now.Before(expiry)
}

// credentialStore keeps the registrations, in memory and on disk.
type credentialStore struct {
	mu      sync.Mutex
	path    string
	entries map[string]credentialRecord
}

func newCredentialStore(root string) (*credentialStore, error) {
	store := &credentialStore{path: filepath.Join(root, credentialsFileName), entries: map[string]credentialRecord{}}
	raw, err := os.ReadFile(store.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return store, nil
	case err != nil:
		return nil, fmt.Errorf("read %s: %w", store.path, err)
	}
	if err := json.Unmarshal(raw, &store.entries); err != nil {
		return nil, fmt.Errorf("decode %s: %w", store.path, err)
	}
	return store, nil
}

// validCredentialShape is the one check the module makes before asking the
// Gateway: a value that is not a delegated credential cannot pass the door,
// so there is no point sending it there — and a user session token pasted by
// mistake should be refused with a reason, not stored.
func validCredentialShape(value string) bool {
	return strings.HasPrefix(value, modulert.DelegatedCredentialPrefix) && len(value) > len(modulert.DelegatedCredentialPrefix)
}

func (s *credentialStore) get(principal string) (credentialRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.entries[principal]
	return record, ok
}

// source binds a principal to a credentialSource for the door transport.
func (s *credentialStore) source(principal string, now func() time.Time) credentialSource {
	return func() (string, error) {
		record, ok := s.get(principal)
		if !ok {
			return "", errCredentialMissing
		}
		if record.expired(now()) {
			return "", fmt.Errorf("the registered credential for %s expired at %s; issue a new one with `terra agent grant` and register it again", principal, record.ExpiresAt)
		}
		return record.Credential, nil
	}
}

func (s *credentialStore) put(record credentialRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[record.Principal] = record
	return s.saveLocked()
}

func (s *credentialStore) delete(principal string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.entries[principal]; !ok {
		return false, nil
	}
	delete(s.entries, principal)
	return true, s.saveLocked()
}

func (s *credentialStore) principals() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.entries))
	for name := range s.entries {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (s *credentialStore) saveLocked() error {
	return writeSecretFile(s.path, s.entries)
}

// writeSecretFile writes value as JSON with mode 0600, atomically: the file is
// either the old content or the new, never a torn half. Both stores here hold
// secrets, so the mode is not optional.
func writeSecretFile(path string, value any) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, encoded, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(temp, 0o600); err != nil {
		_ = os.Remove(temp)
		return err
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}
