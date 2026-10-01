package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStatusReportsVersionAndMasterURL(t *testing.T) {
	handler := newOperationsHandler(time.Unix(0, 0).UTC(), "http://127.0.0.1:8080")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, apiPrefix+"/status", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if payload["version"] != moduleVersion {
		t.Errorf("version: got %v, want %s", payload["version"], moduleVersion)
	}
	// The UI shows this so a tester knows which Master the relay would reach
	// before handing it a credential.
	if payload["master_url"] != "http://127.0.0.1:8080" {
		t.Errorf("master_url: got %v", payload["master_url"])
	}
}

func TestRelayRejectsBadRequests(t *testing.T) {
	valid := machineRequest{
		Method:     http.MethodGet,
		Path:       "/api/v1/daemon/nodes/leaf-a1",
		Channel:    "device",
		Credential: "token",
	}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	for name, mutate := range map[string]func(*machineRequest){
		"unknown method":    func(r *machineRequest) { r.Method = "TRACE" },
		"unknown channel":   func(r *machineRequest) { r.Channel = "session" },
		"empty credential":  func(r *machineRequest) { r.Credential = "  " },
		"non-master path":   func(r *machineRequest) { r.Path = "/health" },
		"absolute url path": func(r *machineRequest) { r.Path = "http://evil.example/api/v1/x" },
		"path escape":       func(r *machineRequest) { r.Path = "/api/v1/../../secrets" },
		"empty path":        func(r *machineRequest) { r.Path = "" },
	} {
		t.Run(name, func(t *testing.T) {
			request := valid
			mutate(&request)
			if err := request.validate(); err == nil {
				t.Fatalf("expected rejection for %s", name)
			}
		})
	}
}

// The session channel must not be relayable. The UI can already make session
// calls itself, and accepting them here would let a caller launder a session
// token through a surface that exists for the other two channels.
func TestRelayRefusesSessionChannel(t *testing.T) {
	if _, _, ok := channelHeader("session"); ok {
		t.Fatal("session must not be a relay channel")
	}
	if _, _, ok := channelHeader("device"); !ok {
		t.Fatal("device must be a relay channel")
	}
	if _, _, ok := channelHeader("service"); !ok {
		t.Fatal("service must be a relay channel")
	}
}

func TestRelayForwardsCredentialOnChannelHeader(t *testing.T) {
	for _, testCase := range []struct {
		channel    string
		wantHeader string
		wantValue  string
	}{
		{channel: "device", wantHeader: "Authorization", wantValue: "Bearer dev-token"},
		{channel: "service", wantHeader: "X-Terra-Service-Credential", wantValue: "svc-cred"},
	} {
		t.Run(testCase.channel, func(t *testing.T) {
			var gotHeader, gotBody, gotMethod, gotPath string
			master := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotHeader = r.Header.Get(testCase.wantHeader)
				gotMethod, gotPath = r.Method, r.URL.Path
				payload, _ := io.ReadAll(r.Body)
				gotBody = string(payload)
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer master.Close()

			credential := "dev-token"
			if testCase.channel == "service" {
				credential = "svc-cred"
			}
			input, _ := json.Marshal(machineRequest{
				Method:     http.MethodPost,
				Path:       "/api/v1/delegations",
				Channel:    testCase.channel,
				Credential: credential,
				Body:       json.RawMessage(`{"intent":"node.restart"}`),
			})

			recorder := httptest.NewRecorder()
			newOperationsHandler(time.Now(), master.URL).ServeHTTP(
				recorder,
				httptest.NewRequest(http.MethodPost, apiPrefix+"/machine/invoke", strings.NewReader(string(input))),
			)

			if recorder.Code != http.StatusOK {
				t.Fatalf("relay status: got %d, want 200 (body %s)", recorder.Code, recorder.Body)
			}
			if gotHeader != testCase.wantValue {
				t.Errorf("%s: got %q, want %q", testCase.wantHeader, gotHeader, testCase.wantValue)
			}
			if gotMethod != http.MethodPost || gotPath != "/api/v1/delegations" {
				t.Errorf("upstream call: got %s %s", gotMethod, gotPath)
			}
			if gotBody != `{"intent":"node.restart"}` {
				t.Errorf("upstream body: got %s", gotBody)
			}

			// The Master's status and body come back verbatim: a test console
			// that normalized them would hide the thing under test.
			var payload map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode relay response: %v", err)
			}
			if payload["status"] != float64(http.StatusAccepted) {
				t.Errorf("relayed status: got %v, want 202", payload["status"])
			}
			if payload["body"] != `{"ok":true}` {
				t.Errorf("relayed body: got %v", payload["body"])
			}
		})
	}
}

func TestRelayReportsUnreachableMaster(t *testing.T) {
	input, _ := json.Marshal(machineRequest{
		Method:     http.MethodGet,
		Path:       "/api/v1/daemon/nodes/leaf-a1",
		Channel:    "device",
		Credential: "token",
	})
	recorder := httptest.NewRecorder()
	// Port 1 on loopback refuses connections.
	newOperationsHandler(time.Now(), "http://127.0.0.1:1").ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodPost, apiPrefix+"/machine/invoke", strings.NewReader(string(input))),
	)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unreachable master: got %d, want 503", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "SERVICE_UNAVAILABLE") {
		t.Errorf("expected SERVICE_UNAVAILABLE, got %s", recorder.Body)
	}
}

func TestMasterURLFromEnvironment(t *testing.T) {
	t.Setenv("TERRA_TREEBENCH_MASTER_URL", "http://10.0.0.5:9090/")
	if got := masterURL(); got != "http://10.0.0.5:9090" {
		t.Errorf("masterURL: got %q, want trailing slash trimmed", got)
	}
	t.Setenv("TERRA_TREEBENCH_MASTER_URL", "   ")
	if got := masterURL(); got != defaultMasterURL {
		t.Errorf("masterURL fallback: got %q, want %q", got, defaultMasterURL)
	}
}
