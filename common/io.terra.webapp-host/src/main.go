// Command terra-webapp-host is the io.terra.webapp-host launcher module — the
// first real tenant of the contributions.gui.apps surface. Its UI (ui/) is
// served by the Gateway as a sandboxed static app; this process is the server
// half, deliberately thin for now: a status operation the readiness gate
// probes. The health watching for proxied apps (W-M4) and the remote app
// package cache (W-M5) land here without moving the UI.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

const moduleVersion = "0.1.0"

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(time.Now().UTC()),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-webapp-host:", err)
		os.Exit(1)
	}
}
