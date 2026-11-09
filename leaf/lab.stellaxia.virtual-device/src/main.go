// Command terra-virtual-device is the lab.stellaxia.virtual-device Leaf module: it
// projects SVI endpoints onto operating-system virtual devices so an SVI-unaware
// program (Zoom, OBS, a browser) can pick "Terra Virtual Camera" out of its
// ordinary device list.
//
// It is a hosted module: the common Module Runtime launches it, hands it a
// workload identity in the environment, and supervises the process — the shape
// lab.stellaxia.io-inventory and lab.stellaxia.io-weave already use. It binds the
// assigned loopback endpoint, serves the control API of design §16.2 and
// contributes one SVI sink resource per declared Slot (Phase 1). The Terra
// repository's P6 "direct projection" mode (--master … --device …) is not carried
// over: it depended on the daemon-side client SDK, which the public terra-sdk does
// not have, and the sink seam does the same job without it.
//
// --config names the module configuration file (design §18). It exists because
// module.json once told the module host to launch this binary with
// `--config config/virtual-device.json` while the binary had no such flag: the
// manifest pointed at an interface that did not exist, so the first start after
// enabling the module would have died on "flag provided but not defined:
// -config". Hosted, the path comes from $TERRA_MODULE_DIR instead — Manifest v2
// has no args field, so a supervised module receives no argv at all.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/StellaxiaLab/modules/leaf/lab.stellaxia.virtual-device/vdevice"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

func main() {
	configPath := flag.String("config", "", "module configuration file (default: $TERRA_MODULE_DIR/config/"+vdevice.ConfigFileName+")")
	flag.Parse()

	config, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "terra-virtual-device:", err)
		os.Exit(1)
	}

	if err := runHostedModule(config); err != nil {
		fmt.Fprintln(os.Stderr, "terra-virtual-device:", err)
		os.Exit(1)
	}
}

// loadConfig reads the module configuration, reporting an absent file as the
// non-event it is: the defaults ARE the shipped example, so a module with no
// file behaves exactly like one whose operator copied the example unchanged. A
// file that exists and cannot be used is a different matter and stops start-up,
// because the operator wrote something and it is not in effect.
func loadConfig(flagValue string) (vdevice.Config, error) {
	path := vdevice.ResolveConfigPath(flagValue, os.Getenv)
	config, err := vdevice.LoadConfig(path)
	if errors.Is(err, vdevice.ErrConfigNotFound) {
		fmt.Fprintf(os.Stderr, "no configuration at %s; using defaults\n", path)
		return config, nil
	}
	if err != nil {
		return config, err
	}
	fmt.Fprintf(os.Stderr, "configuration loaded from %s\n", path)
	return config, nil
}

// statePath is where declared Slot and Projection state lives: the module's own
// data home, granted by the host because module.json declares
// permissions.storage: ["module-data"]. Never inside the installed payload —
// that directory belongs to the installer and is hash-tracked, so writing there
// makes the module fail its own integrity check.
//
// TERRA_MODULE_STATE_DIR overrides it, but only for a binary run by hand: the
// module host merges a fixed allowlist of inherited variables with the identity
// it issues, so nothing else set in the launching shell reaches a hosted module.
func statePath() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("TERRA_MODULE_STATE_DIR")); configured != "" {
		return filepath.Join(configured, vdevice.StateFileName), nil
	}
	root, err := modulesdk.DataDir(vdevice.ModuleID)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, vdevice.StateFileName), nil
}

// runHostedModule binds the Runtime-assigned endpoint and serves the control
// API until the process is stopped.
func runHostedModule(config vdevice.Config) error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity (this binary runs only under the Terra module host): %w", err)
	}
	path, err := statePath()
	if err != nil {
		return err
	}
	controller, err := vdevice.NewController(config, vdevice.NewAdapterRegistryWithDevices(config.Linux.Devices), vdevice.NewStore(path))
	if err != nil {
		return fmt.Errorf("restore declared virtual device state: %w", err)
	}

	server, err := modulesdk.Listen(modulesdk.Config{
		Identity: identity,
		// Ready as soon as bound. There is no Daemon connection to wait for in
		// this phase, and reporting not-ready because of that would withhold
		// the very routes that explain why it is not there — GET /status
		// answers degraded and says so, which is §26's requirement.
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: vdevice.NewHandler(controller),
		// The SVI sink seam: one sink resource per declared Slot, rebuilt on
		// every poll, and the opener the Daemon calls when a binding targets
		// one. Frames reach the Slot's adapter through the sink; the module
		// holds no Daemon connection of its own.
		SVIResources: controller.Resources,
		SVISink:      controller.OpenSink,
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	fmt.Fprintf(os.Stderr, "serving %s on %s (state in %s)\n", vdevice.APIPrefix, server.Addr(), path)
	return server.Serve(ctx)
}
