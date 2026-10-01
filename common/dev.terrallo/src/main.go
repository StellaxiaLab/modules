// Command terra-terrallo is the dev.terrallo extension module.
//
// It exists to be registered, published, distributed and installed by hand, so
// it does the smallest thing that proves every one of those steps ran: it
// answers `terra hello` with `hello terra`. Nothing it returns depends on the
// machine, the clock or any input, which is the point — a wrong answer here can
// only mean the pipeline is wrong, never that the module is.
//
// The Runtime issues this process a Workload Identity at launch; the SDK binds
// the assigned loopback endpoint and serves the credential-guarded handshake
// and readiness probe. Everything below is this module's own surface.
//
// The operation paths MUST match the gateway-http bindings in
// contracts/api/terra-api.json: the Gateway publishes routes from that
// contract, so a path that drifts here answers 404 on a route that looks
// correctly published. The constants below are the only place they are
// written twice, and TestPathsMatchTheContract reads the contract and fails
// when they stop agreeing.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

const moduleVersion = "0.1.0"

// greeting is what `terra hello` prints. Fixed on purpose: this module is a
// probe, and a probe whose answer varies cannot tell you the pipeline worked.
const greeting = "hello terra"

const (
	// statusPath backs dev.terrallo.status.get — the readiness probe the
	// manifest names, so the host reaches ready through this route.
	statusPath = "/api/modules/dev.terrallo/v1/status"
	// helloPath backs dev.terrallo.hello.get, which the manifest's
	// contributions.cli spells as `terra hello`.
	helloPath = "/api/modules/dev.terrallo/v1/hello"
)

func newOperationsHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(statusPath, readOnly(func() any {
		return map[string]string{"status": "ok", "version": moduleVersion}
	}))
	mux.HandleFunc(helloPath, readOnly(func() any {
		return map[string]string{"message": greeting}
	}))
	return mux
}

// readOnly serves one GET-only JSON operation. Both operations declare
// idempotency "safe" in the contract, so refusing every other method here is
// the code agreeing with what the contract already promised.
func readOnly(body func() any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(body())
	}
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity: identity,
		// Report not-ready while a dependency is still coming up: the Runtime
		// withholds route publication until this answers true, which is what
		// keeps callers from reaching a half-started module.
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-terrallo:", err)
		os.Exit(1)
	}
}
