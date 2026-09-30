package main

// Registered model providers — API keys in a 0600 file, never anywhere else.
//
// The key is the module's own secret, not a Terra credential, which is why it
// may live here at all (§8, §11.2): it is not sent to the Master, not given to
// any other module, and not returned by any operation. It arrives on standard
// input (`terra agent model add … --api-key-stdin`) so that neither shell
// history nor the process list ever holds it.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const providersFileName = "providers.json"

// errModelNotConfigured is answered when no provider (or not the named one) is
// registered.
var errModelNotConfigured = errors.New("no model provider is registered; run `terra agent model add anthropic --api-key-stdin`")

// providerConfig is one provider's registration.
type providerConfig struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
	Model    string `json:"model,omitempty"`
	BaseURL  string `json:"base_url,omitempty"`
}

// facts is the registration as a caller may see it: everything but the key.
func (c providerConfig) facts(isDefault bool) map[string]any {
	return map[string]any{
		"provider":   c.Provider,
		"model":      c.Model,
		"base_url":   c.BaseURL,
		"registered": c.APIKey != "",
		"default":    isDefault,
	}
}

// providerFactory builds a Provider from its registration. httpClient may be
// nil for the vendor default.
type providerFactory func(config providerConfig, httpClient *http.Client) (Provider, error)

// providerFactories is the vendor table. One entry today; a second vendor is
// a second file and a second row, nothing else.
var providerFactories = map[string]providerFactory{
	"anthropic": newAnthropicProvider,
}

// defaultModels is what a registration without a model id gets.
var defaultModels = map[string]string{
	"anthropic": "claude-opus-5",
}

// knownProvider reports whether name has a factory.
func knownProvider(name string) bool {
	_, ok := providerFactories[name]
	return ok
}

type providersFile struct {
	Default   string                    `json:"default,omitempty"`
	Providers map[string]providerConfig `json:"providers"`
}

// providerStore keeps registrations, in memory and on disk.
type providerStore struct {
	mu   sync.Mutex
	path string
	file providersFile
}

func newProviderStore(root string) (*providerStore, error) {
	store := &providerStore{path: filepath.Join(root, providersFileName), file: providersFile{Providers: map[string]providerConfig{}}}
	raw, err := os.ReadFile(store.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return store, nil
	case err != nil:
		return nil, fmt.Errorf("read %s: %w", store.path, err)
	}
	if err := json.Unmarshal(raw, &store.file); err != nil {
		return nil, fmt.Errorf("decode %s: %w", store.path, err)
	}
	if store.file.Providers == nil {
		store.file.Providers = map[string]providerConfig{}
	}
	return store, nil
}

// put registers or replaces a provider. The first registration becomes the
// default; makeDefault moves the default explicitly.
func (s *providerStore) put(config providerConfig, makeDefault bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(config.Model) == "" {
		config.Model = defaultModels[config.Provider]
	}
	s.file.Providers[config.Provider] = config
	if makeDefault || s.file.Default == "" {
		s.file.Default = config.Provider
	}
	return s.file.Default == config.Provider, s.saveLocked()
}

func (s *providerStore) delete(name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.file.Providers[name]; !ok {
		return false, nil
	}
	delete(s.file.Providers, name)
	if s.file.Default == name {
		s.file.Default = ""
		for _, remaining := range s.sortedNamesLocked() {
			s.file.Default = remaining
			break
		}
	}
	return true, s.saveLocked()
}

// resolve returns the registration to use: the named provider, or the default
// when name is empty.
func (s *providerStore) resolve(name string) (providerConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(name) == "" {
		name = s.file.Default
	}
	if name == "" {
		return providerConfig{}, errModelNotConfigured
	}
	config, ok := s.file.Providers[name]
	if !ok || config.APIKey == "" {
		return providerConfig{}, fmt.Errorf("model provider %q is not registered; run `terra agent model add %s --api-key-stdin`", name, name)
	}
	return config, nil
}

// list answers the registrations without their keys.
func (s *providerStore) list() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows := make([]map[string]any, 0, len(s.file.Providers))
	for _, name := range s.sortedNamesLocked() {
		rows = append(rows, s.file.Providers[name].facts(name == s.file.Default))
	}
	return map[string]any{"default": s.file.Default, "providers": rows}
}

func (s *providerStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.file.Providers)
}

func (s *providerStore) sortedNamesLocked() []string {
	names := make([]string, 0, len(s.file.Providers))
	for name := range s.file.Providers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (s *providerStore) saveLocked() error {
	return writeSecretFile(s.path, s.file)
}

// open builds the Provider for a registration.
func (s *providerStore) open(name string, httpClient *http.Client) (Provider, error) {
	config, err := s.resolve(name)
	if err != nil {
		return nil, err
	}
	factory, ok := providerFactories[config.Provider]
	if !ok {
		return nil, fmt.Errorf("model provider %q is registered but this build has no adapter for it", config.Provider)
	}
	return factory(config, httpClient)
}
