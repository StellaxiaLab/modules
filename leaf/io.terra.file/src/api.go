package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/StellaxiaLab/modules/leaf/io.terra.file/store"
	"github.com/StellaxiaLab/modules/leaf/io.terra.file/transfer"
)

// apiPrefix is where the Gateway mounts this module's operations
// (contracts/api/terra-api.json bindings). The module serves the same paths on
// its loopback endpoint; the Gateway forwards them verbatim with the workload
// credential attached.
const apiPrefix = "/api/modules/io.terra.file/v1"

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

// writeStoreError keeps the store's vocabulary intact across HTTP. The three
// cases are deliberately distinct: a path that left its shared folder is not
// the same answer as one that is simply not there, and a shared folder nobody
// granted is neither.
func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, transfer.ErrNotFound):
		writeAPIError(w, http.StatusNotFound, "TRANSFER_NOT_FOUND", err.Error())
	case errors.Is(err, transfer.ErrExpired):
		writeAPIError(w, http.StatusConflict, "TRANSFER_EXPIRED", err.Error())
	case errors.Is(err, transfer.ErrChunkMismatch):
		writeAPIError(w, http.StatusConflict, "CHUNK_CHECKSUM_MISMATCH", err.Error())
	case errors.Is(err, transfer.ErrOutOfOrder):
		writeAPIError(w, http.StatusConflict, "CHUNK_OUT_OF_ORDER", err.Error())
	case errors.Is(err, transfer.ErrChecksumMismatch):
		writeAPIError(w, http.StatusConflict, "CHECKSUM_MISMATCH", err.Error())
	case errors.Is(err, transfer.ErrTooLarge):
		writeAPIError(w, http.StatusRequestEntityTooLarge, "TRANSFER_TOO_LARGE", err.Error())
	case errors.Is(err, transfer.ErrTargetExists):
		writeAPIError(w, http.StatusConflict, "FILE_TARGET_EXISTS", err.Error())
	case errors.Is(err, transfer.ErrWrongState):
		writeAPIError(w, http.StatusConflict, "TRANSFER_WRONG_STATE", err.Error())
	case errors.Is(err, store.ErrPathDenied):
		writeAPIError(w, http.StatusForbidden, "PATH_DENIED", err.Error())
	case errors.Is(err, store.ErrRootMissing):
		writeAPIError(w, http.StatusNotFound, "ROOT_NOT_FOUND", err.Error())
	case errors.Is(err, store.ErrNotFound):
		writeAPIError(w, http.StatusNotFound, "FILE_NOT_FOUND", err.Error())
	case errors.Is(err, store.ErrRecursiveRequired):
		writeAPIError(w, http.StatusBadRequest, "FILE_RECURSIVE_REQUIRED", err.Error())
	case errors.Is(err, store.ErrTargetExists):
		writeAPIError(w, http.StatusConflict, "FILE_TARGET_EXISTS", err.Error())
	case errors.Is(err, store.ErrChecksumMismatch):
		// Not CHUNK_CHECKSUM_MISMATCH: that one belongs to a transfer and comes
		// with an offset to resume from. This has no transfer behind it, and the
		// caller's next move is simply to send the same request again.
		writeAPIError(w, http.StatusConflict, "FILE_CHECKSUM_MISMATCH", err.Error())
	default:
		writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", err.Error())
	}
}

// requestedRoot reads the shared folder name. Omitting it means the first one,
// which is the same default the daemon's storage handler has always applied and
// is what a caller who has only one shared folder expects.
const defaultRootName = "share-0"

func requestedRoot(r *http.Request) string {
	if name := strings.TrimSpace(r.URL.Query().Get("root")); name != "" {
		return name
	}
	return defaultRootName
}

// boolQuery reads an optional boolean query parameter. Absent and empty both
// mean false, so a caller that omits the flag never has to spell it out.
func boolQuery(r *http.Request, name string) (bool, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return false, nil
	}
	return strconv.ParseBool(raw)
}

// intQuery reads an optional integer query parameter, falling back to fallback
// when it is absent.
func intQuery(r *http.Request, name string, fallback int64) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	return strconv.ParseInt(raw, 10, 64)
}

// maxReadLength bounds one entries.read. It is not a protocol limit — the bytes
// travel in the response, which the relay decodes without the 1 MiB request-body
// cap that shapes the transfer chunk size. It is an allocation guard: the
// confined read allocates exactly what the caller asked for, so without a bound
// one request could ask a node for its memory. FUSE and WinFsp issue single
// reads well under this, so real mounts never meet it.
const maxReadLength = 1 << 20

// maxWriteLength bounds one entries.write, and it is smaller than maxReadLength
// for a reason that is not symmetry.
//
// Read bytes travel in the RESPONSE, which the relay decodes without a cap.
// Written bytes travel in the REQUEST body, which the Gateway cuts at 1 MiB
// (terra-gateway-service/params.go maxInvokeBodyBytes), and base64 spends four
// bytes for every three. So the raw ceiling has to sit under three quarters of
// that with room for the JSON around it — the same arithmetic that produced
// maxChunkSizeBytes, and the same number, so the two write paths do not disagree
// about how much a node will accept.
const maxWriteLength = maxChunkSizeBytes

func newOperationsHandler(manager *store.Manager, transfers *transfer.Manager) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+apiPrefix+"/roots", func(w http.ResponseWriter, _ *http.Request) {
		roots := manager.Roots()
		// The path travels with the name because an operator asking which
		// folders are shared is asking about directories on their own machine.
		writeJSON(w, http.StatusOK, map[string]any{"roots": roots, "count": len(roots)})
	})

	mux.HandleFunc("GET "+apiPrefix+"/entries", func(w http.ResponseWriter, r *http.Request) {
		entries, err := manager.List(requestedRoot(r), r.URL.Query().Get("path"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		// count is carried so a caller can tell an empty directory from a
		// truncated answer without counting the array itself.
		writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "count": len(entries)})
	})

	mux.HandleFunc("GET "+apiPrefix+"/entries/stat", func(w http.ResponseWriter, r *http.Request) {
		root, requested := requestedRoot(r), r.URL.Query().Get("path")
		entry, err := manager.Stat(root, requested)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		// The digest is opt-in because it costs a full read of the file. A
		// caller that only wants size and mtime — which is most of them —
		// should not pay for it, and a directory has nothing to digest.
		if wanted, err := boolQuery(r, "checksum"); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "checksum must be true or false")
			return
		} else if wanted && !entry.IsDir {
			digest, err := manager.ChecksumFile(root, requested)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			entry.SHA256 = digest
		}
		writeJSON(w, http.StatusOK, map[string]any{"entry": entry})
	})

	// entries/read is the mount's read path, and it is deliberately not a
	// transfer. transfers.chunks.get can serve an arbitrary offset too, but it
	// writes a checkpoint on every call so that an interrupted transfer can
	// resume — which turns a filesystem's small reads into a disk write each.
	// A mount also has no use for the expiry and resume state a transfer record
	// carries. So the two axes stay separate: transfers move a whole file and
	// own that promise, this reads a range and owns nothing.
	mux.HandleFunc("GET "+apiPrefix+"/entries/read", func(w http.ResponseWriter, r *http.Request) {
		offset, err := intQuery(r, "offset", 0)
		if err != nil || offset < 0 {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "offset must be a number of zero or more")
			return
		}
		length, err := intQuery(r, "length", int64(transfers.ChunkSize()))
		if err != nil || length < 1 {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "length must be a positive number")
			return
		}
		if length > maxReadLength {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST",
				"length may not exceed "+strconv.Itoa(maxReadLength)+" bytes")
			return
		}
		chunk, err := manager.ReadChunk(requestedRoot(r), r.URL.Query().Get("path"), offset, int(length))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"offset": chunk.Offset,
			"length": len(chunk.Data),
			"data":   base64.StdEncoding.EncodeToString(chunk.Data),
			"sha256": chunk.SHA256,
			"eof":    chunk.EOF,
			"size":   chunk.Size,
		})
	})

	// entries/write is entries/read's pair, and the same argument places it
	// outside transfers: it makes no record, writes no checkpoint, and serves a
	// caller writing scattered ranges of a file it has open.
	//
	// The digest rides WITH the write rather than being checked by a second call
	// afterwards. A verify pass would double the round trips, and round trips are
	// what this design spends its effort on; checking before the open costs
	// nothing extra and is strictly stronger, because a body that arrived damaged
	// never reaches the file at all. It is the same bargain transfers already
	// make in AcceptChunk.
	mux.HandleFunc("PUT "+apiPrefix+"/entries/write", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Root      string `json:"root"`
			Path      string `json:"path"`
			Offset    int64  `json:"offset"`
			Data      string `json:"data"`
			SHA256    string `json:"sha256"`
			Exclusive bool   `json:"exclusive"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a write object")
			return
		}
		data, err := base64.StdEncoding.DecodeString(body.Data)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "data must be base64")
			return
		}
		if len(data) > maxWriteLength {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST",
				"data may not exceed "+strconv.Itoa(maxWriteLength)+" bytes")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		entry, err := manager.WriteAt(root, body.Path, body.Offset, data, strings.TrimSpace(body.SHA256), body.Exclusive)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"root": root, "path": entry.Path,
			"offset": body.Offset, "length": len(data),
			// size and modified_at come from the fstat the write already held the
			// handle for, so the caller never has to ask what it just did.
			"size": entry.Size, "modified_at": entry.ModTime,
			// The digest is returned even when the caller sent none, so a sender
			// that skipped the check on the way in can still make it on the way out.
			"sha256": store.Checksum(data),
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/entries/truncate", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Root string `json:"root"`
			Path string `json:"path"`
			Size *int64 `json:"size"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a truncate object")
			return
		}
		// size is a pointer because zero is the commonest value a caller means
		// and also what an absent field decodes to. Defaulting a missing size to
		// zero would empty a file nobody asked to empty.
		if body.Size == nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "size is required")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		entry, err := manager.Truncate(root, body.Path, *body.Size)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"root": root, "path": entry.Path, "size": entry.Size, "modified_at": entry.ModTime,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/entries/mkdir", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Root    string `json:"root"`
			Path    string `json:"path"`
			Parents bool   `json:"parents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a mkdir object")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		created, err := manager.Mkdir(root, body.Path, body.Parents)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"root": root, "path": body.Path, "created": created, "parents": body.Parents,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/entries/rename", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Root string `json:"root"`
			Path string `json:"path"`
			To   string `json:"to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a rename object")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		if err := manager.Rename(root, body.Path, body.To); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"root": root, "from": body.Path, "to": body.To})
	})

	mux.HandleFunc("DELETE "+apiPrefix+"/entries", func(w http.ResponseWriter, r *http.Request) {
		recursive, err := boolQuery(r, "recursive")
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "recursive must be true or false")
			return
		}
		root, requested := requestedRoot(r), r.URL.Query().Get("path")
		if err := manager.Remove(root, requested, recursive); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"removed": requested, "root": root, "recursive": recursive})
	})

	mux.HandleFunc("GET "+apiPrefix+"/transfers", func(w http.ResponseWriter, _ *http.Request) {
		records, err := transfers.List()
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"transfers": records, "count": len(records)})
	})

	mux.HandleFunc("GET "+apiPrefix+"/transfers/{transfer_id}", func(w http.ResponseWriter, r *http.Request) {
		record, err := transfers.Get(r.PathValue("transfer_id"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"transfer": record})
	})

	mux.HandleFunc("POST "+apiPrefix+"/transfers", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Direction string `json:"direction"`
			Root      string `json:"root"`
			Path      string `json:"path"`
			SizeBytes int64  `json:"size_bytes"`
			Checksum  string `json:"checksum_sha256"`
			Mode      string `json:"mode"`
			ResumeID  string `json:"resume_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a transfer request object")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		record, err := transfers.Prepare(transfer.PrepareRequest{
			Direction: transfer.Direction(strings.TrimSpace(body.Direction)),
			Root:      root,
			Path:      body.Path,
			SizeBytes: body.SizeBytes,
			Checksum:  body.Checksum,
			Mode:      transfer.Mode(strings.TrimSpace(body.Mode)),
			ResumeID:  strings.TrimSpace(body.ResumeID),
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"transfer": record})
	})

	mux.HandleFunc("PUT "+apiPrefix+"/transfers/{transfer_id}/chunks", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Offset int64  `json:"offset"`
			Data   string `json:"data"`
			SHA256 string `json:"sha256"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a chunk object")
			return
		}
		data, err := base64.StdEncoding.DecodeString(body.Data)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "chunk data must be base64")
			return
		}
		record, err := transfers.AcceptChunk(r.PathValue("transfer_id"), body.Offset, data, body.SHA256)
		if err != nil {
			// A refusal carries the offset to resume from, which is what lets a
			// sender recover without starting the transfer again.
			if errors.Is(err, transfer.ErrOutOfOrder) || errors.Is(err, transfer.ErrChunkMismatch) {
				writeJSON(w, http.StatusConflict, map[string]any{
					"error":        apiError{Code: chunkRefusalCode(err), Message: err.Error()},
					"retry_offset": record.Offset,
				})
				return
			}
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"next_offset": record.Offset, "size_bytes": record.SizeBytes})
	})

	mux.HandleFunc("GET "+apiPrefix+"/transfers/{transfer_id}/chunks", func(w http.ResponseWriter, r *http.Request) {
		offset, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("offset")), 10, 64)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "offset must be a number")
			return
		}
		_, chunk, err := transfers.ServeChunk(r.PathValue("transfer_id"), offset)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"offset": chunk.Offset,
			"data":   base64.StdEncoding.EncodeToString(chunk.Data),
			"sha256": chunk.SHA256,
			"eof":    chunk.EOF,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/transfers/{transfer_id}/complete", func(w http.ResponseWriter, r *http.Request) {
		record, err := transfers.Complete(r.PathValue("transfer_id"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"transfer_id": record.ID, "bytes": record.Offset,
			"checksum_sha256": record.Checksum, "verified": true,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/transfers/{transfer_id}/abort", func(w http.ResponseWriter, r *http.Request) {
		// keep_partial is the caller's decision: giving up on a bad file should
		// not leave it behind, while pausing to resume must keep what is there.
		keep, reason, err := abortRequest(r)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be an abort request object")
			return
		}
		record, err := transfers.Abort(r.PathValue("transfer_id"), reason, !keep)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"transfer_id": record.ID, "state": record.State, "kept_partial": keep})
	})

	// The pull-only door. transfers.create opens either direction, so it needs
	// file.write — a contract declares one permission per operation, not one per
	// input value. These three let a caller who may only read take a file out:
	// they open, close and abandon pull transfers and nothing else, which is why
	// file.read is enough for them.
	mux.HandleFunc("POST "+apiPrefix+"/transfers/pulls", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Root     string `json:"root"`
			Path     string `json:"path"`
			ResumeID string `json:"resume_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be a pull request object")
			return
		}
		root := strings.TrimSpace(body.Root)
		if root == "" {
			root = defaultRootName
		}
		record, err := transfers.Prepare(transfer.PrepareRequest{
			Direction: transfer.Pull,
			Root:      root,
			Path:      body.Path,
			ResumeID:  strings.TrimSpace(body.ResumeID),
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"transfer": record})
	})

	mux.HandleFunc("POST "+apiPrefix+"/transfers/pulls/{transfer_id}/complete", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("transfer_id")
		if err := requirePull(transfers, id); err != nil {
			writeStoreError(w, err)
			return
		}
		record, err := transfers.Complete(id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"transfer_id": record.ID, "bytes": record.Offset,
			"checksum_sha256": record.Checksum, "verified": true,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/transfers/pulls/{transfer_id}/abort", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("transfer_id")
		keep, reason, err := abortRequest(r)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "FILE_INVALID_REQUEST", "the request body must be an abort request object")
			return
		}
		if err := requirePull(transfers, id); err != nil {
			writeStoreError(w, err)
			return
		}
		record, err := transfers.Abort(id, reason, !keep)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"transfer_id": record.ID, "state": record.State, "kept_partial": keep})
	})

	// Anything else under the prefix is this module's to answer for. Falling
	// through to a bare 404 would read as "the module is not there", which is a
	// different problem with a different fix.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, apiPrefix) {
			writeAPIError(w, http.StatusNotFound, "FILE_OPERATION_NOT_FOUND", "no operation answers "+r.Method+" "+r.URL.Path)
			return
		}
		writeAPIError(w, http.StatusNotFound, "FILE_OPERATION_NOT_FOUND", "not this module's path: "+r.URL.Path)
	})

	return mux
}

// requirePull refuses a push behind a pull-only operation. Without it the
// file.read door would close — or, with keep_partial false, delete — an upload
// that only file.write may touch. Direction is fixed at prepare, so reading it
// before acting is not a race.
func requirePull(transfers *transfer.Manager, id string) error {
	// Get refuses a transfer whose window closed, which is right for reading a
	// chunk but not here: complete and abort close a transfer, and a pull left
	// behind by a page that shut mid-download is exactly the one a reader needs
	// to close. Only the direction is this check's business.
	record, err := transfers.Get(id)
	if err != nil && !errors.Is(err, transfer.ErrExpired) {
		return err
	}
	if record.Direction != transfer.Pull {
		return fmt.Errorf("%w: %s is a %s transfer, and this operation only handles pulls", transfer.ErrWrongState, id, record.Direction)
	}
	return nil
}

// abortRequest reads what a caller says when it ends a transfer: keep the
// partial file and checkpoint or not, and why.
//
// An invoke through the Gateway brings it as the JSON body — for a POST binding
// everything that is not a path parameter goes there (terra-module-runtime
// BuildOperationTarget). A call written by hand may bring it as the query. Both
// are read, the body winning where it speaks. Reading the query alone turned
// every pause sent through the Gateway into giving up: the partial file deleted
// and the checkpoint forgotten, with nothing left to resume.
func abortRequest(r *http.Request) (keep bool, reason string, err error) {
	query := r.URL.Query()
	keep = strings.EqualFold(strings.TrimSpace(query.Get("keep_partial")), "true")
	reason = query.Get("reason")
	var body struct {
		KeepPartial *bool   `json:"keep_partial"`
		Reason      *string `json:"reason"`
	}
	switch err := json.NewDecoder(r.Body).Decode(&body); {
	case errors.Is(err, io.EOF):
		// No body: the query, or the defaults, say it all.
		return keep, reason, nil
	case err != nil:
		return false, "", err
	}
	if body.KeepPartial != nil {
		keep = *body.KeepPartial
	}
	if body.Reason != nil {
		reason = *body.Reason
	}
	return keep, reason, nil
}

// chunkRefusalCode names why a chunk was refused so a sender can tell "resend
// this one" from "you are at the wrong place".
func chunkRefusalCode(err error) string {
	if errors.Is(err, transfer.ErrChunkMismatch) {
		return "CHUNK_CHECKSUM_MISMATCH"
	}
	return "CHUNK_OUT_OF_ORDER"
}
