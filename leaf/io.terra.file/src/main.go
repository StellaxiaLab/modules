// Command terra-file is the io.terra.file extension module: the node's shared
// folders, listed and transferred, owned outside the core.
//
// It is the second core-slimming extraction after io.terra.io-inventory. The
// daemon keeps only the boundaries — the Gateway routes callers here, and the
// module host grants the shared folders this process is allowed to see. The
// listing and the transfer protocol land here without touching the core.
//
// What this module can reach is decided before it starts. The host hands over
// TERRA_MODULE_SHARED_ROOTS only to a module whose manifest declares
// permissions.storage: ["shared-roots"] and whose signature grades it built-in
// or above; without that grant this process cannot see that shared folders
// exist, which is the intended answer rather than a failure to configure.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/StellaxiaLab/modules/leaf/io.terra.file/store"
	"github.com/StellaxiaLab/modules/leaf/io.terra.file/transfer"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

// defaultChunkSizeBytes is the transfer chunk this module asks callers to use.
// It matches what the daemon's storage configuration has always defaulted to,
// so the size does not change under anyone when ownership moves.
const defaultChunkSizeBytes = 262144

// maxChunkSizeBytes is the ceiling the Gateway imposes, worked backwards.
//
// The Gateway buffers a module invoke body and cuts it at 1 MiB
// (terra-gateway-service/params.go maxInvokeBodyBytes). A chunk travels base64
// encoded, which costs 4 bytes for every 3, so the largest raw chunk that still
// fits is a little over 768 KiB. 640 KiB leaves room for the JSON around it.
//
// The check runs at startup rather than mid-transfer on purpose: a chunk size
// that cannot fit fails every transfer, and finding that out at byte 700,000 of
// a 1 GB file is the worst time to learn it.
const maxChunkSizeBytes = 640 * 1024

// chunkSizeEnv lets a deployment tune the chunk without rebuilding. The module
// owns this number now — the daemon's storage.chunk_size_bytes and the Master's
// hardcoded 262144 both go away when the core drops its file surface.
const chunkSizeEnv = "TERRA_FILE_CHUNK_SIZE_BYTES"

// moduleID names this module to the SDK's data directory helper.
const moduleID = "io.terra.file"

// maxTransferEnv caps a single transfer. The daemon's storage.max_transfer_mb
// was declared and never read; the module owns the number now and actually
// checks it, at prepare, before any bytes move.
const maxTransferEnv = "TERRA_FILE_MAX_TRANSFER_MB"

const defaultMaxTransferMB = 10240

// maxTransferBytes resolves the ceiling. An unparseable or non-positive value
// falls back to the default rather than refusing to start: a transfer ceiling
// is not worth making a node unbootable over.
func maxTransferBytes() int64 {
	megabytes := defaultMaxTransferMB
	if raw := os.Getenv(maxTransferEnv); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			megabytes = parsed
		}
	}
	return int64(megabytes) << 20
}

// grantedRoots reads the shared folders the host granted this process.
//
// An absent variable is not an error here: it means the grant was refused or
// never asked for, and the module still starts and answers an empty root list.
// A module that exits would look like a broken install rather than what it is.
func grantedRoots() ([]modulert.SharedRoot, error) {
	raw := os.Getenv(modulert.SharedRootsEnv)
	if raw == "" {
		return nil, nil
	}
	var roots []modulert.SharedRoot
	if err := json.Unmarshal([]byte(raw), &roots); err != nil {
		return nil, fmt.Errorf("read %s: %w", modulert.SharedRootsEnv, err)
	}
	return modulert.NameSharedRoots(roots), nil
}

// chunkSize resolves the configured chunk and refuses one the Gateway would cut.
func chunkSize() (int, error) {
	configured := defaultChunkSizeBytes
	if raw := os.Getenv(chunkSizeEnv); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return 0, fmt.Errorf("%s must be a number of bytes: %w", chunkSizeEnv, err)
		}
		configured = parsed
	}
	if configured <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", chunkSizeEnv, configured)
	}
	if configured > maxChunkSizeBytes {
		return 0, fmt.Errorf(
			"%s is %d bytes; the Gateway cuts an invoke body at 1 MiB and base64 costs a third, so %d is the ceiling",
			chunkSizeEnv, configured, maxChunkSizeBytes)
	}
	return configured, nil
}

func run() error {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		return fmt.Errorf("read workload identity: %w", err)
	}

	chunk, err := chunkSize()
	if err != nil {
		return err
	}

	roots, err := grantedRoots()
	if err != nil {
		return err
	}
	manager, err := store.NewManager(roots)
	if err != nil {
		return fmt.Errorf("open shared folders: %w", err)
	}
	defer manager.Close()

	// The transfer state goes in the module's own data directory, never in a
	// shared folder: a checkpoint is neither the user's data nor part of the
	// installed payload. It is also what makes a resume possible across a
	// restart — the record survives while the half-written file stays put.
	stateDir, err := modulesdk.DataDir(moduleID)
	if err != nil {
		return err
	}
	transfers, err := transfer.NewManager(transfer.Options{
		StateDir: stateDir, Store: manager, ChunkSize: chunk, MaxBytes: maxTransferBytes(),
	})
	if err != nil {
		return err
	}

	server, err := modulesdk.Listen(modulesdk.Config{
		Identity: identity,
		// Readiness answers what this module is for: the shared folders are
		// open and can be listed. A module that came up without a grant is
		// ready too — it has nothing to serve, and saying otherwise would make
		// a refused permission look like a crash loop.
		Readiness:  func(context.Context) (bool, string) { return true, "" },
		Operations: newOperationsHandler(manager, transfers),
	})
	if err != nil {
		return fmt.Errorf("bind workload endpoint: %w", err)
	}
	return server.Serve(context.Background())
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "terra-file:", err)
		os.Exit(1)
	}
}
