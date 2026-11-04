package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// moduleVersion is what status.get reports; module.json is what the release
// packs. They are two literals, so nothing but this test keeps a release from
// shipping one and reporting the other.
func TestModuleVersionMatchesManifest(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Version != moduleVersion {
		t.Fatalf("module.json version %q != moduleVersion %q in main.go; change both together", manifest.Version, moduleVersion)
	}
}
