// Command terra-workload is the lab.stellaxia.workload module: it lets Terra
// take over a program Terra does not know — register it by path, start, stop,
// read its log — without copying it or wrapping it in a package (Workload M1:
// reference registration on one node, exec driver).
//
// The module supervises the programs itself. It is launched by the Daemon and
// inherits the Daemon's token, which is also how it knows the Daemon is
// elevated (see elevation.go): then it refuses to register or run anything.
package main

import (
	"context"
	"fmt"
	"os"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

const moduleVersion = "0.1.0"

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	dataDir, err := modulesdk.DataDir("lab.stellaxia.workload")
	if err != nil {
		return err
	}
	st, err := newStore(dataDir)
	if err != nil {
		return fmt.Errorf("open workload store: %w", err)
	}
	svc, err := newService(st)
	if err != nil {
		return fmt.Errorf("load registrations: %w", err)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:   identity,
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(svc, moduleVersion),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	go svc.restore()
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-workload:", err)
		os.Exit(1)
	}
}
