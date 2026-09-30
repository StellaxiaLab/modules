// Command terra-io-weave is the io.terra.io-weave extension module — the
// consumer half of the virtual I/O track.
//
// The split with io.terra.io-inventory is fixed by design decision D-26 and
// this module holds the near side of it. io-inventory knows the devices
// attached to this node and publishes them; io-weave subscribes to ANOTHER
// node's and reproduces it here. So this module publishes no device: the one
// resource it contributes is the destination it offers — its projected
// pointer — which belongs to this node and is nobody's copy.
//
// It is an optional module. A node without it behaves exactly as if this axis
// did not exist: the device list, the approvals and the catalog are all
// io-inventory's and none of them depend on this being installed.
//
// The operation paths MUST match the gateway-http bindings in
// contracts/api/terra-api.json: the Gateway publishes routes from that
// contract, so a path that drifts here answers 404 on a route that looks
// correctly published.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/terra-project/terra/module/leaf/io.terra.io-weave/weave"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
	coresvi "github.com/terra-project/terra/products/common/packages/terra-svi"
)

const moduleVersion = "0.1.0"

// settingsPath is where the node's own projection settings live: which
// translation profile answers a gesture, and the layout to assume. It is the
// module's data home (permissions.storage: module-data), granted by the host,
// never inside the installed payload — that directory is the installer's and
// hash-tracked.
//
// TERRA_MODULE_STATE_DIR overrides it, but only for a binary run by hand: the
// module host merges a fixed allowlist of inherited variables (PATH, TEMP,
// LANG, …) with the identity it issues, so nothing else set in the launching
// shell reaches a hosted module. That is also why the profile is an operation
// and not an environment variable — a setting that can only be changed by
// running the binary yourself is not a setting.
func settingsPath() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("TERRA_MODULE_STATE_DIR")); configured != "" {
		return filepath.Join(configured, "settings.json"), nil
	}
	root, err := modulesdk.DataDir("io.terra.io-weave")
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "settings.json"), nil
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}

	path, err := settingsPath()
	if err != nil {
		return err
	}
	// The injection probe runs once at start. Its answer can go stale — a udev
	// rule installed while this is running does not reach an already-open
	// process — which is exactly why the detail says what to do rather than
	// only that something is wrong.
	projection, err := weave.NewProjection(weave.NewSettingsStore(path), weave.ProbeInjection())
	if err != nil {
		return fmt.Errorf("build pointer projection: %w", err)
	}

	server, err := modulesdk.Listen(modulesdk.Config{
		Identity: identity,
		// Ready as soon as bound: the projection needs nothing to come up, and
		// reporting not-ready because injection is unavailable would withhold
		// the very routes that explain why it is unavailable.
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(projection),
		SVIResources: func(context.Context) ([]coresvi.ResourceDescriptor, error) {
			return projection.Resources(), nil
		},
		SVISink: projection.OpenSink,
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-io-weave:", err)
		os.Exit(1)
	}
}
