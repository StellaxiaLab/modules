// Command terra-fleet is the io.terra.fleet extension module — the management
// face of container-node Fleets. It holds no state and makes no decisions of
// record: every operation is relayed to the Master core through the W1 Core
// capability plane (terra.fleet.* operations), where the authoritative
// ownership checks run. The split is deliberate (design §2-5): this module can
// be stopped, upgraded or broken without new members losing the ability to
// enrol, because enrolment never passes through here.
package main

import (
	"context"
	"fmt"
	"os"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	core, err := modulesdk.CoreFromEnv()
	if err != nil {
		return fmt.Errorf("reach host core plane: %w", err)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(core),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-fleet:", err)
		os.Exit(1)
	}
}
