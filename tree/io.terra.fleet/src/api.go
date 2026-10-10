package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

// apiPrefix is where the Gateway/Master mounts this module's operations
// (contracts/api/terra-api.json bindings); the module serves the same paths on
// its loopback endpoint and requests are forwarded verbatim.
const apiPrefix = "/api/modules/io.terra.fleet/v1"

// principalHeader carries the Master-verified acting user (§14.2 dispatch).
// Relaying it into the core-op input is this module's entire authorization
// role: the Master re-runs its own ownership checks against it, so a missing
// or wrong principal yields a denial there, never data here.
const principalHeader = "X-Terra-Principal"

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

// newOperationsHandler serves the module's published operations. Every handler
// has the same shape: take the verified principal, build the core-op input,
// relay, and stream the Master's answer back unchanged — the Master's output
// IS the contract output.
func newOperationsHandler(core *modulesdk.CoreClient) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+apiPrefix+"/fleets", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.fleets.list", map[string]any{}, http.StatusOK)
	})
	mux.HandleFunc("GET "+apiPrefix+"/fleets/{fleet_id}", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.fleets.get", map[string]any{
			"fleet_id": r.PathValue("fleet_id"),
		}, http.StatusOK)
	})
	mux.HandleFunc("POST "+apiPrefix+"/fleets", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Slug        string          `json:"slug"`
			DisplayName string          `json:"display_name"`
			Profile     string          `json:"profile"`
			ImageRef    string          `json:"image_ref"`
			MaxNodes    int             `json:"max_nodes"`
			Roles       []string        `json:"roles"`
			Tags        []string        `json:"tags"`
			Cell        json.RawMessage `json:"cell"`
		}
		if !decodeOptionalBody(w, r, &body) {
			return
		}
		input := map[string]any{
			"slug":         body.Slug,
			"display_name": body.DisplayName,
			"profile":      body.Profile,
			"image_ref":    body.ImageRef,
			"max_nodes":    body.MaxNodes,
			"roles":        body.Roles,
			"tags":         body.Tags,
		}
		// The cell block is only meaningful on a tree-profile fleet, and an
		// empty one must not travel: sending it would declare a Cell with no
		// Leaves for a plain node fleet.
		if len(body.Cell) > 0 {
			input["cell"] = body.Cell
		}
		relay(w, r, core, "terra.fleet.fleets.create", input, http.StatusCreated)
	})
	mux.HandleFunc("POST "+apiPrefix+"/fleets/{fleet_id}/slots", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			HostNodeID string `json:"host_node_id"`
			Count      int    `json:"count"`
		}
		if !decodeOptionalBody(w, r, &body) {
			return
		}
		relay(w, r, core, "terra.fleet.slots.add", map[string]any{
			"fleet_id":     r.PathValue("fleet_id"),
			"host_node_id": body.HostNodeID,
			"count":        body.Count,
		}, http.StatusCreated)
	})
	mux.HandleFunc("POST "+apiPrefix+"/fleets/{fleet_id}/slots/{slot_id}/start", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			HostNodeID string `json:"host_node_id"`
		}
		if !decodeOptionalBody(w, r, &body) {
			return
		}
		relay(w, r, core, "terra.fleet.slots.start", map[string]any{
			"fleet_id":     r.PathValue("fleet_id"),
			"slot_id":      r.PathValue("slot_id"),
			"host_node_id": body.HostNodeID,
		}, http.StatusOK)
	})
	mux.HandleFunc("POST "+apiPrefix+"/fleets/{fleet_id}/slots/{slot_id}/stop", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.slots.stop", map[string]any{
			"fleet_id": r.PathValue("fleet_id"),
			"slot_id":  r.PathValue("slot_id"),
		}, http.StatusOK)
	})
	mux.HandleFunc("GET "+apiPrefix+"/fleets/{fleet_id}/codes", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.codes.list", map[string]any{
			"fleet_id": r.PathValue("fleet_id"),
		}, http.StatusOK)
	})
	mux.HandleFunc("POST "+apiPrefix+"/fleets/{fleet_id}/codes", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SlotID       string `json:"slot_id"`
			ExpiresInSec int    `json:"expires_in_sec"`
			MaxUses      int    `json:"max_uses"`
		}
		if !decodeOptionalBody(w, r, &body) {
			return
		}
		relay(w, r, core, "terra.fleet.codes.issue", map[string]any{
			"fleet_id":       r.PathValue("fleet_id"),
			"slot_id":        body.SlotID,
			"expires_in_sec": body.ExpiresInSec,
			"max_uses":       body.MaxUses,
		}, http.StatusCreated)
	})
	mux.HandleFunc("DELETE "+apiPrefix+"/fleets/{fleet_id}/codes/{code_id}", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.codes.revoke", map[string]any{
			"fleet_id": r.PathValue("fleet_id"),
			"code_id":  r.PathValue("code_id"),
		}, http.StatusOK)
	})
	mux.HandleFunc("DELETE "+apiPrefix+"/fleets/{fleet_id}/slots/{slot_id}", func(w http.ResponseWriter, r *http.Request) {
		relay(w, r, core, "terra.fleet.slots.delete", map[string]any{
			"fleet_id": r.PathValue("fleet_id"),
			"slot_id":  r.PathValue("slot_id"),
			"trace_id": r.Header.Get("X-Terra-Trace-Id"),
		}, http.StatusOK)
	})

	return mux
}

// relay performs one principal-stamped core invocation and writes the result.
func relay(w http.ResponseWriter, r *http.Request, core *modulesdk.CoreClient, operationID string, input map[string]any, successStatus int) {
	principal := strings.TrimSpace(r.Header.Get(principalHeader))
	if principal == "" {
		writeAPIError(w, http.StatusUnauthorized, "FLEET_PRINCIPAL_REQUIRED",
			"the dispatch did not carry a verified principal")
		return
	}
	input["owner_user_id"] = principal
	encoded, err := json.Marshal(input)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "FLEET_INVALID_INPUT", err.Error())
		return
	}
	result, err := core.Invoke(r.Context(), modulert.CoreInvocation{OperationID: operationID, Input: encoded})
	if err != nil {
		writeCoreError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(successStatus)
	_, _ = w.Write(result.Output)
}

// writeCoreError maps a core-plane refusal onto the module's HTTP surface. The
// core plane flattens the Master's domain errors to text, so beyond the two
// sentinels the message is surfaced as a 400 for the caller to read.
func writeCoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, modulert.ErrCoreOperationDenied):
		writeAPIError(w, http.StatusForbidden, "FLEET_CORE_DENIED", err.Error())
	case errors.Is(err, modulesdk.ErrCoreUnavailable):
		writeAPIError(w, http.StatusServiceUnavailable, "FLEET_CORE_UNAVAILABLE", err.Error())
	case strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "record not found"):
		writeAPIError(w, http.StatusNotFound, "FLEET_NOT_FOUND", err.Error())
	default:
		writeAPIError(w, http.StatusBadRequest, "FLEET_OPERATION_REJECTED", err.Error())
	}
}

// decodeOptionalBody parses an optional JSON body; an empty body is fine.
func decodeOptionalBody(w http.ResponseWriter, r *http.Request, target any) bool {
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "FLEET_INVALID_INPUT", err.Error())
		return false
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return true
	}
	if err := json.Unmarshal(data, target); err != nil {
		writeAPIError(w, http.StatusBadRequest, "FLEET_INVALID_INPUT", err.Error())
		return false
	}
	return true
}
