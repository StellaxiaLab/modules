package main

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/terra-project/terra/module/leaf/io.terra.io-weave/weave"
)

// Operation paths, mirroring the gateway-http bindings in
// contracts/api/terra-api.json.
const (
	statusPath            = "/api/modules/io.terra.io-weave/v1/status"
	pointerPath           = "/api/modules/io.terra.io-weave/v1/pointer"
	settingsOperationPath = "/api/modules/io.terra.io-weave/v1/settings"
)

func newOperationsHandler(projection *weave.Projection) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(statusPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		state := projection.State()
		// "ok" vs "degraded" answers one question only: is this module doing
		// what it claims to do. It projects, so it is ok. Injection being
		// unavailable is not a degradation of the projection — it is a
		// separate fact reported separately, because folding it in would make
		// every headless node in the fleet permanently degraded and teach
		// people that degraded means nothing.
		body := map[string]any{
			"status":    "ok",
			"version":   moduleVersion,
			"mode":      string(state.Mode),
			"profile":   state.Profile,
			"bound":     state.Bound,
			"injection": state.Injection,
		}
		// The escape reason rides on status as well as on the pointer state.
		// Status is the first thing anyone reads when a node stops responding
		// to a remote pointer, and sending them to a second operation to find
		// out WHY it stopped is how a reason nobody reads gets written.
		if state.Escape != nil {
			body["escape"] = state.Escape
		}
		writeJSON(w, http.StatusOK, body)
	})
	mux.HandleFunc(pointerPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		writeJSON(w, http.StatusOK, projection.State())
	})
	mux.HandleFunc(settingsOperationPath, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, projection.Settings())
		case http.MethodPut:
			var requested weave.Settings
			if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&requested); err != nil {
				writeError(w, http.StatusBadRequest, "IO_WEAVE_INVALID_SETTINGS", "settings body is not valid JSON")
				return
			}
			if err := projection.Configure(requested); err != nil {
				// The profile a caller asked for and could not have is named
				// back to them. Falling back to the default would leave a node
				// answering gestures in a way nobody chose.
				writeError(w, http.StatusBadRequest, "IO_WEAVE_INVALID_SETTINGS", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, projection.Settings())
		default:
			methodNotAllowed(w)
		}
	})
	return mux
}

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "IO_WEAVE_UNAVAILABLE", "method not allowed")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
