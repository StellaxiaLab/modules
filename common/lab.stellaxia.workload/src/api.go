package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"
)

const apiBase = "/api/modules/lab.stellaxia.workload/v1"

type apiErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeAPIError(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeJSON(w, ae.Status, map[string]apiErrorBody{"error": {Code: ae.Code, Message: ae.Message}})
		return
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]apiErrorBody{
		"error": {Code: "WORKLOAD_UNAVAILABLE", Message: err.Error()}})
}

// decodeBody reads an optional JSON body into v. An empty body is fine: every
// field has a default or is checked by the caller.
func decodeBody(r *http.Request, v any) error {
	data, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err != nil {
		return errf(400, "WORKLOAD_INPUT_INVALID", "unreadable request body: %v", err)
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, v); err != nil {
		return errf(400, "WORKLOAD_INPUT_INVALID", "request body is not valid JSON: %v", err)
	}
	return nil
}

func queryInt(r *http.Request, key string, def int) int {
	if raw := r.URL.Query().Get(key); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

func newOperationsHandler(s *service, version string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+apiBase+"/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok", "version": version})
	})

	mux.HandleFunc("GET "+apiBase+"/workloads", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"items": s.list(), "scope": "node-local"})
	})

	mux.HandleFunc("POST "+apiBase+"/workloads", func(w http.ResponseWriter, r *http.Request) {
		var in registerInput
		if err := decodeBody(r, &in); err != nil {
			writeAPIError(w, err)
			return
		}
		rec, err := s.register(in)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, rec.WorkloadID, "register", true)
		writeJSON(w, 201, rec)
	})

	mux.HandleFunc("GET "+apiBase+"/workloads/{workload_id}", func(w http.ResponseWriter, r *http.Request) {
		rec, err := s.get(r.PathValue("workload_id"))
		if err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, 200, rec)
	})

	mux.HandleFunc("PATCH "+apiBase+"/workloads/{workload_id}", func(w http.ResponseWriter, r *http.Request) {
		var in updateInput
		if err := decodeBody(r, &in); err != nil {
			writeAPIError(w, err)
			return
		}
		in.WorkloadID = r.PathValue("workload_id")
		rec, err := s.update(in)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, rec.WorkloadID, "update", true)
		writeJSON(w, 200, rec)
	})

	mux.HandleFunc("DELETE "+apiBase+"/workloads/{workload_id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("workload_id")
		force := r.URL.Query().Get("force") == "true"
		if err := s.remove(id, force); err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, id, "delete", false)
		writeJSON(w, 200, map[string]any{"workload_id": id, "removed": true})
	})

	mux.HandleFunc("GET "+apiBase+"/workloads/{workload_id}/status", func(w http.ResponseWriter, r *http.Request) {
		rec, err := s.get(r.PathValue("workload_id"))
		if err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{
			"workload_id": rec.WorkloadID, "status": rec.Status, "instance": rec.Instance,
			"last_exit": rec.LastExit, "drift": rec.Source.Drift,
		})
	})

	mux.HandleFunc("POST "+apiBase+"/workloads/{workload_id}/start", func(w http.ResponseWriter, r *http.Request) {
		rec, err := s.start(r.PathValue("workload_id"))
		if err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, rec.WorkloadID, "start", true)
		writeJSON(w, 200, map[string]any{"workload_id": rec.WorkloadID, "status": rec.Status, "instance": rec.Instance})
	})

	mux.HandleFunc("POST "+apiBase+"/workloads/{workload_id}/stop", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			TimeoutSeconds int `json:"timeout_seconds"`
		}
		if err := decodeBody(r, &in); err != nil {
			writeAPIError(w, err)
			return
		}
		timeout := stopTimeout
		if in.TimeoutSeconds > 0 {
			timeout = time.Duration(in.TimeoutSeconds) * time.Second
		}
		res, err := s.stop(r.PathValue("workload_id"), timeout)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, r.PathValue("workload_id"), "stop", true)
		writeJSON(w, 200, res)
	})

	mux.HandleFunc("POST "+apiBase+"/workloads/{workload_id}/restart", func(w http.ResponseWriter, r *http.Request) {
		rec, err := s.restart(r.PathValue("workload_id"), stopTimeout)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		s.recordAudit(r, rec.WorkloadID, "restart", true)
		writeJSON(w, 200, map[string]any{"workload_id": rec.WorkloadID, "status": rec.Status, "instance": rec.Instance})
	})

	mux.HandleFunc("GET "+apiBase+"/workloads/{workload_id}/logs", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("workload_id")
		if err := s.exists(id); err != nil {
			writeAPIError(w, err)
			return
		}
		tail := queryInt(r, "tail", 0)
		after := int64(queryInt(r, "after", 0))
		if tail == 0 && r.URL.Query().Get("after") == "" {
			tail = 200
		}
		text, cursor, rotated, err := readLog(s.logDir(id), tail, after)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"workload_id": id, "text": text, "cursor": cursor, "rotated": rotated})
	})

	mux.HandleFunc("GET "+apiBase+"/workloads/{workload_id}/events", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("workload_id")
		if err := s.exists(id); err != nil {
			writeAPIError(w, err)
			return
		}
		items, err := s.st.events(id, queryInt(r, "limit", 100))
		if err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"workload_id": id, "items": items})
	})
	return mux
}
