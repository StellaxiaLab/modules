// Command terra-agent is the io.terra.agent extension module: mode A of the
// Terra Agent (설계 docs/modules/terra-agent/design/terra-agent-design.md) —
// the planning loop, the sessions and the model provider, hosted as a module
// so that it has no standing power of its own (§11.4). It reaches the Gateway
// only through the host's delegate door, as a credential a person registered,
// and links the same terra-agent-core the MCP surface links, so the approval
// rules exist once.
//
// The API surface is owned by contracts/api/terra-api.json — change that file
// first, then api.go.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

const moduleVersion = "0.1.0"

// envDataDir lets a bench assembly (a hand-launched process, no host) keep its
// data out of the real module home. A hosted run needs it not: the data home
// follows the module-data grant.
const envDataDir = "TERRA_AGENT_DATA_DIR"

func dataDir() (string, error) {
	if pinned := strings.TrimSpace(os.Getenv(envDataDir)); pinned != "" {
		if err := os.MkdirAll(pinned, 0o700); err != nil {
			return "", err
		}
		return pinned, nil
	}
	return modulesdk.DataDir("io.terra.agent")
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	root, err := dataDir()
	if err != nil {
		return err
	}
	credentials, err := newCredentialStore(root)
	if err != nil {
		return err
	}
	providers, err := newProviderStore(root)
	if err != nil {
		return err
	}
	mcp, err := newMCPRegistry(root)
	if err != nil {
		return err
	}
	sessions, err := newSessionStore(root, time.Now)
	if err != nil {
		return err
	}
	// The door is the module's only way to the Gateway. A host that wires no
	// core plane is a legitimate assembly; the module still serves and says so
	// in status (delegate_door=false) rather than failing to start.
	core, coreErr := modulesdk.CoreFromEnv()
	if coreErr != nil {
		fmt.Fprintln(os.Stderr, "terra-agent: delegate door unavailable, sessions cannot reach the Gateway:", coreErr)
		core = nil
	}
	e := newEngine(sessions, credentials, providers, mcp, core, time.Now)
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(e),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-agent:", err)
		os.Exit(1)
	}
}
