package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/StellaxiaLab/modules/common/lab.stellaxia.gui-v3/nodedata"
)

// apiPrefix is where the Gateway mounts this module's operations
// (contracts/api/terra-api.json bindings). The module serves the same paths on
// its Runtime-assigned endpoint; the Gateway forwards them with the workload
// credential attached and the caller headers stamped.
const apiPrefix = "/api/modules/lab.stellaxia.gui-v3/v1"

// DataPrefix is how the GUI names this node's data folder inside node paths
// ("/<노드>/데이터/…"). Property values that point at a stored file keep this
// node-relative form, so they stay true when the node is renamed or moved.
const DataPrefix = "/데이터"

// maxBodyBytes bounds a request body: one chunk, base64-encoded, plus room for
// the JSON around it. The Gateway already cuts bodies at 1 MiB.
const maxBodyBytes = nodedata.MaxChunkBytes*4/3 + 64<<10

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

// writeStoreError keeps the store's vocabulary across HTTP — the codes are the
// contract's errors list.
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, nodedata.ErrPathDenied):
		writeAPIError(w, http.StatusBadRequest, "PATH_DENIED", err.Error())
	case errors.Is(err, nodedata.ErrNotFound):
		writeAPIError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
	case errors.Is(err, nodedata.ErrTypeDenied):
		writeAPIError(w, http.StatusUnsupportedMediaType, "TYPE_DENIED", err.Error())
	case errors.Is(err, nodedata.ErrTooLarge):
		writeAPIError(w, http.StatusRequestEntityTooLarge, "TOO_LARGE", err.Error())
	case errors.Is(err, nodedata.ErrOutOfOrder):
		writeAPIError(w, http.StatusConflict, "CHUNK_OUT_OF_ORDER", err.Error())
	case errors.Is(err, nodedata.ErrInvalidProps):
		writeAPIError(w, http.StatusBadRequest, "INVALID_PROPERTY", err.Error())
	default:
		writeAPIError(w, http.StatusInternalServerError, "INTERNAL", "node data store failed")
		log.Printf("gui-v3: store error: %v", err)
	}
}

// caller names who asked, for the audit line. The Gateway stamps the header;
// the module trusts it because only the Gateway can reach this endpoint with
// the workload credential.
func caller(r *http.Request) string {
	if p := strings.TrimSpace(r.Header.Get("X-Terra-Principal")); p != "" {
		return p
	}
	return "unknown"
}

func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, target any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, limit+1))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			writeAPIError(w, http.StatusRequestEntityTooLarge, "TOO_LARGE", "request body is too large")
		} else {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "request body is not the expected JSON: "+err.Error())
		}
		return false
	}
	return true
}

func method(w http.ResponseWriter, r *http.Request, allowed ...string) bool {
	for _, m := range allowed {
		if r.Method == m {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeAPIError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", r.Method+" is not served here")
	return false
}

type statusOutput struct {
	Status        string `json:"status"`
	MaxChunkBytes int64  `json:"maxChunkBytes"`
	Version       string `json:"version"`
	UsedBytes     int64  `json:"usedBytes"`
	MaxFileBytes  int64  `json:"maxFileBytes"`
	MaxTotalBytes int64  `json:"maxTotalBytes"`
	DataPrefix    string `json:"dataPrefix"`
}

type propsPatch struct {
	Set map[string]any `json:"set"`
}

type filePut struct {
	Path   string `json:"path"`
	Mime   string `json:"mime"`
	Data   string `json:"data"`
	Offset int64  `json:"offset"`
	Total  int64  `json:"total"`
}

type fileContent struct {
	nodedata.Entry
	Data string `json:"data"`
}

// newAPI wires the operations onto the store.
func newAPI(store *nodedata.Store, version string) http.Handler {
	mux := http.NewServeMux()
	limits := store.Limits()

	mux.HandleFunc(apiPrefix+"/status", func(w http.ResponseWriter, r *http.Request) {
		if !method(w, r, http.MethodGet) {
			return
		}
		used, err := store.Usage()
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, statusOutput{Status: "ok", Version: version, UsedBytes: used, MaxFileBytes: limits.MaxFileBytes, MaxTotalBytes: limits.MaxTotalBytes, MaxChunkBytes: nodedata.MaxChunkBytes, DataPrefix: DataPrefix})
	})

	mux.HandleFunc(apiPrefix+"/node/props", func(w http.ResponseWriter, r *http.Request) {
		if !method(w, r, http.MethodGet, http.MethodPatch) {
			return
		}
		if r.Method == http.MethodGet {
			props, err := store.Props()
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"props": props})
			return
		}
		var in propsPatch
		if !decodeBody(w, r, 64<<10, &in) {
			return
		}
		props, err := store.Patch(in.Set, DataPrefix)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		keys := make([]string, 0, len(in.Set))
		for k := range in.Set {
			keys = append(keys, k)
		}
		log.Printf("gui-v3: audit props.patch by=%s keys=%s", caller(r), strings.Join(keys, ","))
		writeJSON(w, http.StatusOK, map[string]any{"props": props})
	})

	mux.HandleFunc(apiPrefix+"/node/files", func(w http.ResponseWriter, r *http.Request) {
		if !method(w, r, http.MethodGet) {
			return
		}
		entries, err := store.List(r.URL.Query().Get("dir"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	})

	mux.HandleFunc(apiPrefix+"/node/files/content", func(w http.ResponseWriter, r *http.Request) {
		if !method(w, r, http.MethodGet, http.MethodPut, http.MethodDelete) {
			return
		}
		switch r.Method {
		case http.MethodGet:
			data, entry, err := store.Get(r.URL.Query().Get("path"))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, fileContent{Entry: entry, Data: base64.StdEncoding.EncodeToString(data)})
		case http.MethodPut:
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
			var in filePut
			if !decodeBody(w, r, maxBodyBytes, &in) {
				return
			}
			data, err := base64.StdEncoding.DecodeString(in.Data)
			if err != nil {
				writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "data is not base64")
				return
			}
			total := in.Total
			if total == 0 {
				total = in.Offset + int64(len(data))
			}
			entry, received, done, err := store.PutChunk(in.Path, in.Offset, total, data, in.Mime)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			out := map[string]any{"done": done, "received": received, "total": total}
			if done {
				out["entry"] = entry
				log.Printf("gui-v3: audit files.put by=%s path=%s size=%d", caller(r), entry.Path, entry.Size)
			}
			writeJSON(w, http.StatusOK, out)
		case http.MethodDelete:
			p := r.URL.Query().Get("path")
			if err := store.Delete(p); err != nil {
				writeStoreError(w, err)
				return
			}
			log.Printf("gui-v3: audit files.delete by=%s path=%s", caller(r), p)
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
		}
	})

	return mux
}
