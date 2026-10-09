package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/discovery"
	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/inventory"
	"github.com/StellaxiaLab/modules/leaf/io.terra.io-inventory/manual"
)

// maxManualDeviceBody bounds a registration. It is the Daemon's limit for the
// same body (terra.daemon.io.devices.post), so nothing the Daemon accepts is
// refused here for size.
const maxManualDeviceBody = 16 << 10

// apiPrefix is where the Gateway mounts this module's operations
// (contracts/api/terra-api.json bindings). The module serves the same paths on
// its loopback endpoint; the Gateway forwards them verbatim with the workload
// credential attached.
const apiPrefix = "/api/modules/io.terra.io-inventory/v1"

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

func writeRegistryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, inventory.ErrDeviceNotFound):
		writeAPIError(w, http.StatusNotFound, "IO_DEVICE_NOT_FOUND", err.Error())
	case errors.Is(err, inventory.ErrDeviceNotApproved):
		writeAPIError(w, http.StatusConflict, "IO_DEVICE_NOT_APPROVED", err.Error())
	case errors.Is(err, inventory.ErrDeviceNotProbeable):
		writeAPIError(w, http.StatusConflict, "IO_DEVICE_NOT_PROBEABLE", err.Error())
	case errors.Is(err, inventory.ErrStatePersistence):
		writeAPIError(w, http.StatusInternalServerError, "IO_STATE_PERSISTENCE", err.Error())
	default:
		writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", err.Error())
	}
}

// writeManualError answers for a registration. A kind no adapter can open is
// its own code, IO_ADAPTER_UNAVAILABLE, which the Daemon relays as is: "this
// can never become available" is a different answer from "you asked wrong".
func writeManualError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, manual.ErrInvalid):
		writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", err.Error())
	case errors.Is(err, manual.ErrAdapterUnavailable):
		writeAPIError(w, http.StatusBadRequest, "IO_ADAPTER_UNAVAILABLE", err.Error())
	case errors.Is(err, manual.ErrExists):
		writeAPIError(w, http.StatusConflict, "IO_DEVICE_EXISTS", err.Error())
	default:
		writeRegistryError(w, err)
	}
}

// writeEnumerationError answers for the two routes that ask the platform
// adapter to look — scan and probe — so they cannot come to disagree about
// what a failure means.
func writeEnumerationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, discovery.ErrUnsupported):
		// Still honest on platforms whose adapter is not written yet.
		writeAPIError(w, http.StatusNotImplemented, "IO_SCAN_UNAVAILABLE", err.Error())
	case errors.Is(err, inventory.ErrDeviceNotFound),
		errors.Is(err, inventory.ErrDeviceNotProbeable),
		errors.Is(err, inventory.ErrStatePersistence):
		// A refusal about the device asked for, decided before anything was
		// enumerated — not a failure to look.
		writeRegistryError(w, err)
	default:
		// An enumeration that failed is not a node without devices. Saying so
		// keeps the operator from reading "no devices" off a screen that means
		// "could not look".
		writeAPIError(w, http.StatusInternalServerError, "IO_SCAN_FAILED", err.Error())
	}
}

// newOperationsHandler serves the module's Gateway-published operations. The
// registry owns every policy decision; this layer only translates HTTP.
func newOperationsHandler(registry *inventory.Registry, hotplug *Hotplug, door *manualDoor) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+apiPrefix+"/devices", func(w http.ResponseWriter, _ *http.Request) {
		devices := registry.List()
		writeJSON(w, http.StatusOK, map[string]any{"devices": devices, "count": len(devices)})
	})
	// The manual source's door (B-10). The Daemon's POST /io/devices relays
	// here, and a module without this route is what the Daemon reports as 501
	// IO_MANUAL_SOURCE_UNAVAILABLE. 201 because a device now exists that did
	// not: the registration is written down and already in the list, pending.
	mux.HandleFunc("POST "+apiPrefix+"/devices", func(w http.ResponseWriter, r *http.Request) {
		var request manual.Request
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxManualDeviceBody))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", "device registration must be a JSON object {kind, name, adapter_id, address, capabilities?, alias?}: "+err.Error())
			return
		}
		if decoder.More() {
			writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", "trailing data after the JSON object")
			return
		}
		added, err := addManual(r.Context(), registry, door, request)
		if err != nil {
			writeManualError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, added)
	})

	// A sibling of /devices, not a child of it. A tombstone is not a device
	// (IO-20) — it has no presence, no capabilities, no runtime state — and a
	// path that nests it under /devices/ says the opposite of the decision that
	// put it on its own route. /usage and /scan sit here for the same reason.
	mux.HandleFunc("GET "+apiPrefix+"/tombstones", func(w http.ResponseWriter, _ *http.Request) {
		tombstones := registry.Tombstones()
		writeJSON(w, http.StatusOK, map[string]any{"tombstones": tombstones, "count": len(tombstones)})
	})

	mux.HandleFunc("GET "+apiPrefix+"/devices/{device_id}", func(w http.ResponseWriter, r *http.Request) {
		device, err := registry.Get(r.PathValue("device_id"))
		if err != nil {
			writeRegistryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, device)
	})
	mux.HandleFunc("GET "+apiPrefix+"/devices/{device_id}/usage", func(w http.ResponseWriter, r *http.Request) {
		usage, err := registry.UsageFor(r.PathValue("device_id"))
		if err != nil {
			writeRegistryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, usage)
	})
	mux.HandleFunc("GET "+apiPrefix+"/usage", func(w http.ResponseWriter, _ *http.Request) {
		usage := registry.Usage()
		writeJSON(w, http.StatusOK, map[string]any{"usage": usage, "count": len(usage)})
	})

	approve := func(state inventory.ApprovalState) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			device, err := registry.SetApproval(r.PathValue("device_id"), state)
			if err != nil {
				writeRegistryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, device)
		}
	}
	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/approve", approve(inventory.ApprovalApproved))
	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/deny", approve(inventory.ApprovalDenied))

	enable := func(enabled bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			device, err := registry.SetEnabled(r.PathValue("device_id"), enabled)
			if err != nil {
				writeRegistryError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, device)
		}
	}
	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/enable", enable(true))
	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/disable", enable(false))

	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/alias", func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Alias string `json:"alias"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", "alias body must be a JSON object with an alias string")
			return
		}
		device, err := registry.SetAlias(r.PathValue("device_id"), payload.Alias)
		if err != nil {
			writeRegistryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, device)
	})

	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/probe", func(w http.ResponseWriter, r *http.Request) {
		result, err := probeDevice(r.Context(), registry, door, r.PathValue("device_id"))
		if err != nil {
			writeEnumerationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("POST "+apiPrefix+"/devices/{device_id}/forget", func(w http.ResponseWriter, r *http.Request) {
		tombstone, err := forgetDevice(registry, door, r.PathValue("device_id"))
		if err != nil {
			writeRegistryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"forgotten": true, "tombstone": tombstone})
	})

	mux.HandleFunc("POST "+apiPrefix+"/scan", func(w http.ResponseWriter, r *http.Request) {
		result, err := scanAll(r.Context(), registry, door)
		if err != nil {
			writeEnumerationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	// The watch surface. Two routes rather than one: an operator asking "is
	// this node following its hardware?" and a client tailing what changed are
	// different questions, and the second is a loop. Folding the mode into
	// every page of the tail would make the common call carry the rare answer.
	mux.HandleFunc("GET "+apiPrefix+"/watch", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, hotplug.State())
	})

	mux.HandleFunc("GET "+apiPrefix+"/watch/events", func(w http.ResponseWriter, r *http.Request) {
		var since uint64
		if raw := strings.TrimSpace(r.URL.Query().Get("since")); raw != "" {
			parsed, err := strconv.ParseUint(raw, 10, 64)
			if err != nil {
				writeAPIError(w, http.StatusBadRequest, "IO_INVALID_REQUEST", "since must be a sequence number")
				return
			}
			since = parsed
		}
		events, latest, missed := hotplug.Since(since)
		writeJSON(w, http.StatusOK, map[string]any{
			"events": events,
			"latest": latest,
			// missed says the window moved past what this reader asked for.
			// Silence here would let a client believe it saw every change when
			// the unplug it was waiting for had already aged out.
			"missed": missed,
			"watch":  hotplug.State().Watch,
		})
	})

	// Everything else under the prefix is an unknown operation.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, apiPrefix) {
			http.NotFound(w, r)
			return
		}
		writeAPIError(w, http.StatusNotFound, "IO_UNKNOWN_OPERATION", "unknown io-inventory operation")
	})
	return mux
}
