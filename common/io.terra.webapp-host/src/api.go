package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// apiPrefix is where the Gateway mounts this module's operations
// (contracts/api/terra-api.json bindings).
const apiPrefix = "/api/modules/io.terra.webapp-host/v1"

// newOperationsHandler serves the launcher's (for now, single) operation.
func newOperationsHandler(startedAt time.Time) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+apiPrefix+"/status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "ok",
			"version":    moduleVersion,
			"started_at": startedAt.Format(time.RFC3339),
		})
	})
	return mux
}
