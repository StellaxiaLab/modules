package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// apiPrefix is where the Gateway mounts this module's operations
// (contracts/api/terra-api.json bindings).
const apiPrefix = "/api/modules/io.terra.treebench/v1"

// maxRelayBodyBytes caps what the relay will read back from the Master. A test
// console shows responses; it does not stream them.
const maxRelayBodyBytes = 4 << 20

// relayTimeout is the contract's default timeoutMs for machine.invoke.
const relayTimeout = 15 * time.Second

// machineRequest is the input to io.terra.treebench.machine.invoke.post.
// Credential is the tester's device token or service credential; it is used
// for exactly one outbound request and is never logged or stored.
type machineRequest struct {
	Method     string          `json:"method"`
	Path       string          `json:"path"`
	Channel    string          `json:"channel"`
	Credential string          `json:"credential"`
	Body       json.RawMessage `json:"body,omitempty"`
}

// channelHeader maps a channel onto the header the Master authenticates it by.
// These are the two non-session channels in the Master contract; a session
// bearer is deliberately absent, because the UI can already make those calls
// itself and routing them through here would hide which channel was exercised.
func channelHeader(channel string) (string, string, bool) {
	switch channel {
	case "device":
		return "Authorization", "Bearer ", true
	case "service":
		return "X-Terra-Service-Credential", "", true
	default:
		return "", "", false
	}
}

// validate rejects the request shapes the relay refuses to forward. The path
// check is the important one: this process holds no credential of its own, but
// it will happily attach the tester's to whatever it is pointed at, so it only
// ever points at the Master's own API.
func (request machineRequest) validate() error {
	switch request.Method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return fmt.Errorf("method는 GET·POST·PUT·PATCH·DELETE 중 하나여야 합니다: %q", request.Method)
	}
	if _, _, ok := channelHeader(request.Channel); !ok {
		return fmt.Errorf("channel은 device 또는 service여야 합니다: %q", request.Channel)
	}
	if strings.TrimSpace(request.Credential) == "" {
		return fmt.Errorf("credential이 필요합니다")
	}
	if !strings.HasPrefix(request.Path, "/api/v1/") {
		return fmt.Errorf("path는 /api/v1/ 로 시작하는 Master 경로여야 합니다: %q", request.Path)
	}
	// A path that climbs out of /api/v1 would let the credential reach some
	// other surface on the Master origin.
	if strings.Contains(request.Path, "..") {
		return fmt.Errorf("path에 ..를 쓸 수 없습니다")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeRelayError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, map[string]any{
		"ok": false,
		"error": map[string]any{
			"code":      code,
			"message":   message,
			"retryable": false,
		},
	})
}

// newOperationsHandler serves the module's two operations.
func newOperationsHandler(startedAt time.Time, masterURL string) http.Handler {
	client := &http.Client{Timeout: relayTimeout}
	mux := http.NewServeMux()

	mux.HandleFunc("GET "+apiPrefix+"/status", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]any{
			"status":     "ok",
			"version":    moduleVersion,
			"started_at": startedAt.Format(time.RFC3339),
			"master_url": masterURL,
		})
	})

	mux.HandleFunc("POST "+apiPrefix+"/machine/invoke", func(writer http.ResponseWriter, reader *http.Request) {
		var request machineRequest
		if err := json.NewDecoder(io.LimitReader(reader.Body, maxRelayBodyBytes)).Decode(&request); err != nil {
			writeRelayError(writer, http.StatusBadRequest, "INVALID_REQUEST", "요청 본문을 읽을 수 없습니다")
			return
		}
		if err := request.validate(); err != nil {
			writeRelayError(writer, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
			return
		}

		var upstreamBody io.Reader
		if len(request.Body) > 0 {
			upstreamBody = bytes.NewReader(request.Body)
		}
		upstream, err := http.NewRequestWithContext(reader.Context(), request.Method, masterURL+request.Path, upstreamBody)
		if err != nil {
			writeRelayError(writer, http.StatusBadRequest, "INVALID_REQUEST", "요청을 구성할 수 없습니다: "+err.Error())
			return
		}
		header, prefix, _ := channelHeader(request.Channel)
		upstream.Header.Set(header, prefix+request.Credential)
		upstream.Header.Set("Accept", "application/json")
		if upstreamBody != nil {
			upstream.Header.Set("Content-Type", "application/json")
		}

		startedRequest := time.Now()
		response, err := client.Do(upstream)
		if err != nil {
			// The error text can carry the URL but never the credential, which
			// lives only in a header we set above.
			writeRelayError(writer, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Master에 도달할 수 없습니다: "+err.Error())
			return
		}
		defer response.Body.Close()

		payload, err := io.ReadAll(io.LimitReader(response.Body, maxRelayBodyBytes))
		if err != nil {
			writeRelayError(writer, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Master 응답을 읽을 수 없습니다")
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{
			"status":      response.StatusCode,
			"body":        string(payload),
			"duration_ms": time.Since(startedRequest).Milliseconds(),
		})
	})

	return mux
}
