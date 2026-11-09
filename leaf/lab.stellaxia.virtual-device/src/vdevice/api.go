package vdevice

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// APIPrefix is where this module's operations are published.
//
// Design §16.1 names /api/apps/lab.stellaxia.virtual-device/v1, proxied by the Leaf
// Product Host. That proxy does not exist; what does exist is the common Module
// Runtime, which publishes a module's routes through the Gateway from its own
// contract at /api/modules/{id}/v1 — the shape lab.stellaxia.io-inventory,
// lab.stellaxia.io-weave and lab.stellaxia.file all use. The design predates that
// mechanism, so the path here follows the mechanism and the design is corrected
// to match (decision recorded in its §2 table). The security property §16.1
// actually cares about is unchanged: this process binds only the loopback
// endpoint the Runtime issues, and every request carries the workload
// credential.
const APIPrefix = "/api/modules/lab.stellaxia.virtual-device/v1"

// requestBodyLimit bounds a slot or projection declaration. Declarations are
// small; an unbounded reader here is a way to spend this module's memory from
// the other side of a proxy.
const requestBodyLimit = 64 << 10

// NewHandler builds the control API of design §16.2. The routes mirror the
// gateway-http bindings in
// leaf/lab.stellaxia.virtual-device/contracts/api/terra-api.json, and a test
// holds the two against each other in both directions — a one-sided edit
// otherwise leaves a route that looks published and answers 404.
//
// This build serves the read surface plus Slot and Projection PUT/DELETE (frames
// arrive through the SVI sink, not through this API). Two
// routes of §16.2 are deliberately absent rather than stubbed:
// POST /adapters/{adapter_id}/driver-plan and GET /events. A declared route
// that 501s is still a route the catalog advertises, and a driver plan is the
// front door to installation — the one thing this module must not grow
// (design principle §4.3).
func NewHandler(controller *Controller) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+APIPrefix+"/status", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, controller.Status())
	})

	mux.HandleFunc("GET "+APIPrefix+"/diagnostics", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, controller.Diagnostics())
	})

	mux.HandleFunc("GET "+APIPrefix+"/adapters", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"adapters": controller.Adapters()})
	})

	mux.HandleFunc("GET "+APIPrefix+"/adapters/{adapter_id}", func(w http.ResponseWriter, r *http.Request) {
		descriptor, err := controller.Adapter(r.PathValue("adapter_id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, descriptor)
	})

	mux.HandleFunc("GET "+APIPrefix+"/slots", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"slots": controller.Slots()})
	})

	mux.HandleFunc("GET "+APIPrefix+"/slots/{slot_id}", func(w http.ResponseWriter, r *http.Request) {
		slot, err := controller.Slot(r.PathValue("slot_id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, slot)
	})

	mux.HandleFunc("PUT "+APIPrefix+"/slots/{slot_id}", func(w http.ResponseWriter, r *http.Request) {
		var request SlotRequest
		if !decodeBody(w, r, &request) {
			return
		}
		slot, err := controller.PutSlot(r.PathValue("slot_id"), request)
		if err != nil {
			writeDomainError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, slot)
	})

	mux.HandleFunc("DELETE "+APIPrefix+"/slots/{slot_id}", func(w http.ResponseWriter, r *http.Request) {
		if err := controller.DeleteSlot(r.PathValue("slot_id")); err != nil {
			writeDomainError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET "+APIPrefix+"/projections", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"projections": controller.Projections()})
	})

	mux.HandleFunc("GET "+APIPrefix+"/projections/{projection_id}", func(w http.ResponseWriter, r *http.Request) {
		view, err := controller.Projection(r.PathValue("projection_id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("PUT "+APIPrefix+"/projections/{projection_id}", func(w http.ResponseWriter, r *http.Request) {
		var request ProjectionRequest
		if !decodeBody(w, r, &request) {
			return
		}
		view, err := controller.PutProjection(r.PathValue("projection_id"), request)
		if err != nil {
			writeDomainError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, view)
	})

	mux.HandleFunc("DELETE "+APIPrefix+"/projections/{projection_id}", func(w http.ResponseWriter, r *http.Request) {
		if err := controller.DeleteProjection(r.PathValue("projection_id")); err != nil {
			writeDomainError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Anything else under this module's prefix is answered in the module's own
	// error vocabulary rather than with net/http's HTML 404 page, so a caller
	// that mistyped a path gets the same shape as every other failure.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, ErrCodeSlotNotFound, false,
			"no operation at "+r.Method+" "+r.URL.Path)
	})
	return mux
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, requestBodyLimit)).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, ErrCodeInvalidRequest, false, "request body is not valid JSON: "+err.Error())
		return false
	}
	return true
}

// httpStatusFor maps a §21 code to its HTTP status. The contract declares the
// same mapping in each error's httpStatus, and a test holds the two together:
// the contract is the declaration, this is what the process actually answers.
func httpStatusFor(code string) int {
	switch code {
	case ErrCodeInvalidRequest:
		return http.StatusBadRequest
	case ErrCodeOSPermissionDenied:
		return http.StatusForbidden
	case ErrCodeSlotNotFound:
		return http.StatusNotFound
	case ErrCodeSlotBusy, ErrCodeStaleGeneration, ErrCodeLeaseExpired,
		ErrCodeDriverInstallRequired, ErrCodeUserActionRequired,
		ErrCodeRebootRequired, ErrCodeFormatIncompatible:
		return http.StatusConflict
	case ErrCodeFrameInvalid:
		return http.StatusUnprocessableEntity
	case ErrCodeNotImplemented:
		return http.StatusNotImplemented
	case ErrCodeAdapterUnavailable, ErrCodeSourceUnavailable, ErrCodeHandleOpenFailed:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func writeDomainError(w http.ResponseWriter, err error) {
	var domain *DomainError
	if errors.As(err, &domain) {
		writeError(w, httpStatusFor(domain.Code), domain.Code, domain.Retryable, domain.Message)
		return
	}
	// A non-domain error is the store refusing to write, or something else this
	// module did not anticipate. It is reported as this module's failure, not
	// as the caller's mistake.
	writeError(w, http.StatusInternalServerError, ErrCodeNotImplemented, true, redact(err.Error()))
}

// redact keeps an unexpected error's shape without handing a caller the
// module's absolute paths (§20.4, §21: errors carry no OS paths).
func redact(message string) string {
	if index := strings.Index(message, ": "); index > 0 {
		return message[:index]
	}
	return message
}

func writeError(w http.ResponseWriter, status int, code string, retryable bool, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": message, "retryable": retryable},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
