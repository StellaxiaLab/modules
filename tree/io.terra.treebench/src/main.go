// Command terra-treebench is the server half of the io.terra.treebench test
// console. Its UI (ui/) is served by the Gateway as a sandboxed static app and
// calls the Master through the Gateway's Invocation Broker on its own — that
// path needs nothing from this process.
//
// What the UI cannot do is reach the machine-channel surfaces: 15 of the
// Master's 107 operations answer only to a device token or a service
// credential, and a browser session holds neither. This process takes the
// credential a tester supplies, makes that one call, and hands the response
// back untouched.
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

// defaultMasterURL matches the tree role's backend in the port table
// (products/common/host/host/config.go). A node that moved its Master sets
// TERRA_TREEBENCH_MASTER_URL.
const defaultMasterURL = "http://127.0.0.1:8080"

func masterURL() string {
	if configured := strings.TrimSpace(os.Getenv("TERRA_TREEBENCH_MASTER_URL")); configured != "" {
		return strings.TrimRight(configured, "/")
	}
	return defaultMasterURL
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(time.Now().UTC(), masterURL()),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-treebench:", err)
		os.Exit(1)
	}
}
