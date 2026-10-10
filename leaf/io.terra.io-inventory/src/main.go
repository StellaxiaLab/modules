// Command terra-io-inventory is the io.terra.io-inventory extension module —
// the core-slimming pilot. It owns what the daemon's data_plane/io_gateway used
// to: the node-local I/O device inventory, its approval/enable/alias policy,
// and the policy's persistence. The daemon keeps only the boundaries: the
// Gateway routes callers here, and the SVI remote provider adapter polls
// /terra/svi/resources to place the devices in the node catalog.
//
// The default registrations are logical provider slots, not claims that
// capture backends exist. Real hardware comes from the discovery package, which
// this module sweeps at start-up and on demand through POST /scan.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/manual"
	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
	coresvi "github.com/terra-project/terra/products/common/packages/terra-svi"
)

const moduleVersion = "0.2.0"

// statePath is where user-managed device policy persists. It lives in the
// module's own data home (permissions.storage: module-data), never inside the
// installed module payload — that directory is the installer's, hash-tracked.
// TERRA_MODULE_STATE_DIR overrides for tests and custom layouts.
//
// The home directory is no longer worked out here. The host grants the data
// home now, and a module computing its own did not follow the product's data
// directory — which is how two hosts under one account came to share one
// directory per module.
func statePath() (string, error) {
	if configured := os.Getenv("TERRA_MODULE_STATE_DIR"); configured != "" {
		return filepath.Join(configured, "devices.json"), nil
	}
	root, err := modulesdk.DataDir("io.terra.io-inventory")
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "devices.json"), nil
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}

	path, err := statePath()
	if err != nil {
		return err
	}
	registry, err := inventory.NewPersistentRegistry(path)
	if err != nil {
		return fmt.Errorf("restore device policy: %w", err)
	}

	// Logical provider slots (ported verbatim from the daemon): presence of the
	// SLOT, not of hardware. Platform adapters update presence when they exist.
	for _, device := range []inventory.Device{
		{ID: "screen-default", Name: "Default screen", Kind: inventory.DeviceScreen, Capabilities: []string{"video.frame"}, PermissionRequired: true},
		{ID: "camera-default", Name: "Default camera", Kind: inventory.DeviceCamera, Capabilities: []string{"video.frame"}, PermissionRequired: true},
		{ID: "microphone-default", Name: "Default microphone", Kind: inventory.DeviceMicrophone, Capabilities: []string{"audio.frame"}, PermissionRequired: true},
	} {
		if err := registry.Register(device); err != nil {
			return fmt.Errorf("register default slot %s: %w", device.ID, err)
		}
	}

	// What a person registered by hand (B-10). It sits beside the policy file
	// in the same data home, as a file of its own (see manual.Source).
	source, err := manual.OpenSource(manualSourcePath(path))
	if err != nil {
		return fmt.Errorf("restore manual device source: %w", err)
	}
	door := &manualDoor{source: source, adapters: manual.DefaultAdapters()}

	// Hardware before the first request: policy survived the restart, the
	// devices did not (see scanAtStartup).
	scanAtStartup(registry, door)

	// And after the first request: the start-up sweep is one look, so without
	// this the list is only ever as fresh as the last time somebody asked.
	ctx, stopWatching := context.WithCancel(context.Background())
	defer stopWatching()
	hotplug := startHotplug(ctx, registry)

	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(registry, hotplug, door),
		SVIResources: func(context.Context) ([]coresvi.ResourceDescriptor, error) {
			return registry.SVIResources(), nil
		},
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-io-inventory:", err)
		os.Exit(1)
	}
}
