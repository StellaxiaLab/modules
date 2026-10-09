// Command terra-nodetalk is the io.terra.nodetalk extension module: a
// node-to-node communication test bench shaped as a chat. The design and the
// staged plan live in docs/ideas/node-comms-test-module-ideas.md and
// docs/implementation/nodetalk-implementation-plan.md; the API surface is owned
// by contracts/api/terra-api.json — change that file first, then this code.
//
// M1 scope: conversations, messages and the local SSE stream are real, backed
// by per-author append-only logs under the module data home. Replication,
// handover, deletion and fault injection still refuse honestly with 501
// naming their milestone.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

const moduleVersion = "0.1.0"

// unknownNodeID is what status.get reports when the host wires no Core
// capability plane. The module must still serve — a host without core ops is a
// legitimate assembly (the same spirit as the 8/24 identity↔publication split:
// losing an optional plane must not take the module down with it).
const unknownNodeID = "unknown"

// envNodeID / envDataDir let a bench assembly (hand-launched processes, no
// host, no core plane) pin the node identity and keep its data out of the real
// module home. A hosted run needs neither: the host injects the core plane and
// the data home follows the module-data convention.
const (
	envNodeID     = "TERRA_NODETALK_NODE_ID"
	envDataDir    = "TERRA_NODETALK_DATA_DIR"
	envHysteresis = "TERRA_NODETALK_HANDOVER_HYSTERESIS_MS"
	// envDisplayName lets a bench name a node the host would not have named.
	envDisplayName = "TERRA_NODETALK_DISPLAY_NAME"
)

// handoverHysteresis paces repeated main claims (§5.5). 0 disables — a bench
// deliberately reproducing flapping sets it so.
func handoverHysteresis() time.Duration {
	if raw := strings.TrimSpace(os.Getenv(envHysteresis)); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	return 2 * time.Minute
}

// nodeIdentityResolver resolves this node's id: the bench override first, then
// the W1 Core capability plane (terra.node.identity.get, declared in
// module.json permissions.coreOperations) — lazily and once. Lazy because
// blocking startup on a core call would delay the identity handshake the host
// is waiting for; once because the answer cannot change within a launch.
// nodeIdentityResolver returns the id resolver and, beside it, what this node
// calls itself. One core call answers both — asking twice would be asking the
// same question twice.
func nodeIdentityResolver() (func(context.Context) string, func() string) {
	if pinned := strings.TrimSpace(os.Getenv(envNodeID)); pinned != "" && talk.ValidNodeID(pinned) {
		name := strings.TrimSpace(os.Getenv(envDisplayName))
		if name == "" {
			name = pinned
		}
		return func(context.Context) string { return pinned }, func() string { return name }
	}
	var once sync.Once
	nodeID := unknownNodeID
	displayName := ""
	resolve := func(ctx context.Context) string {
		once.Do(func() {
			core, err := modulesdk.CoreFromEnv()
			if err != nil {
				return
			}
			result, err := core.Invoke(ctx, modulert.CoreInvocation{
				OperationID: "terra.node.identity.get",
				TimeoutMS:   int(2 * time.Second / time.Millisecond),
			})
			if err != nil {
				return
			}
			var identity struct {
				NodeID      string `json:"node_id"`
				DisplayName string `json:"display_name"`
			}
			if json.Unmarshal(result.Output, &identity) == nil && identity.NodeID != "" {
				nodeID = identity.NodeID
				displayName = strings.TrimSpace(identity.DisplayName)
			}
		})
		return nodeID
	}
	return resolve, func() string {
		// Resolve FIRST: the core call is what fills the name, and reading the
		// name before making it is reading a blank and then filling it.
		id := resolve(context.Background())
		if name := strings.TrimSpace(displayName); name != "" {
			return name
		}
		return id
	}
}

// dataDir resolves the module's data home: the bench override first, then
// whatever the host granted for permissions.storage: ["module-data"].
//
// The bench override stays because a hand-launched process has no host to grant
// anything. Everything else is the SDK's now — the module no longer works out
// its own path, which is what kept it from following the product's data
// directory and let two hosts share one directory per module.
func dataDir() (string, error) {
	if pinned := strings.TrimSpace(os.Getenv(envDataDir)); pinned != "" {
		return pinned, nil
	}
	return modulesdk.DataDir("io.terra.nodetalk")
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
	// One resolver instance for both consumers: the store's author id and the
	// API's reported id must be the same string, and the core lookup runs once.
	resolveNodeID, displayName := nodeIdentityResolver()
	store, err := talk.NewStore(root, func() string { return resolveNodeID(context.Background()) })
	if err != nil {
		return err
	}
	// Damage the store recovers from without failing a call — a cursor file
	// whose bytes were lost — is invisible by design once recovered. This is
	// the only place it gets said out loud.
	store.SetLogger(log.New(os.Stderr, "nodetalk-store: ", log.LstdFlags))
	faults := newFaultState()
	// One door for every consumer — the sync loop and the deletion fan-out —
	// with the fault injector in front so an injected partition cuts them all.
	var door doorFunc
	if core, coreErr := modulesdk.CoreFromEnv(); coreErr == nil {
		door = faultDoor(faults, coreDoor(core))
	} else {
		fmt.Fprintln(os.Stderr, "terra-nodetalk: peer door unavailable, sync disabled:", coreErr)
	}
	// One learner shared by the inbound surface (which fills it) and the sync
	// loop (which asks it) — see peerlearn.go for why a knock is a peer.
	learner := newPeerLearner()
	// One directory shared by the read surfaces, which label ids with it, and
	// the sync loop, which fills it from the peers it already talks to.
	names := newDirectory(root)
	// Seed it with this node. Names arrive from PEERS, and a node never asks
	// itself anything — without this every surface labels everyone but the one
	// person reading it, which is the one label they would notice missing.
	names.Learn(resolveNodeID(context.Background()), displayName())
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:  identity,
		Readiness: func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(serverDeps{
			ResolveNodeID:      resolveNodeID,
			Store:              store,
			Identity:           identity,
			HandoverHysteresis: handoverHysteresis(),
			Door:               door,
			Faults:             faults,
			Peers:              learner,
			Names:              names,
			DisplayName:        displayName(),
		}),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if door != nil {
		loop := newSyncLoop(store, door, resolveNodeID, root)
		loop.faults = faults
		loop.promotionHysteresis = handoverHysteresis()
		loop.learned = learner
		loop.names = names
		go loop.run(ctx)
	}
	return server.Serve(ctx)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-nodetalk:", err)
		os.Exit(1)
	}
}
