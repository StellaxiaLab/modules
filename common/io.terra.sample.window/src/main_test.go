package main

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

// The UI origin serves exactly two things — the page and its health — and no
// module API (창 모드 설계 §5.2: UI origin은 UI 전용).
func TestUIHandlerServesThePageAndHealthOnly(t *testing.T) {
	server := httptest.NewServer(uiHandler())
	defer server.Close()

	live, err := server.Client().Get(server.URL + "/live")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(live.Body)
	_ = live.Body.Close()
	if live.StatusCode != 200 || !strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("live = %d %s", live.StatusCode, body)
	}

	page, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	pageBody, _ := io.ReadAll(page.Body)
	_ = page.Body.Close()
	if page.StatusCode != 200 || !strings.Contains(string(pageBody), "Sample Window App") {
		t.Fatalf("page = %d", page.StatusCode)
	}

	api, err := server.Client().Get(server.URL + "/api/modules/io.terra.sample.window/v1/status")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, api.Body)
	_ = api.Body.Close()
	if api.StatusCode != 404 {
		t.Fatalf("module API leaked onto the UI origin: %d", api.StatusCode)
	}
}

// The status operation answers the readiness contract and names the UI origin.
func TestStatusOperationReportsTheUIOrigin(t *testing.T) {
	server := httptest.NewServer(operationsHandler("http://127.0.0.1:4242"))
	defer server.Close()

	response, err := server.Client().Get(server.URL + "/api/modules/io.terra.sample.window/v1/status")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var status struct {
		Status   string `json:"status"`
		Version  string `json:"version"`
		UIOrigin string `json:"uiOrigin"`
	}
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if status.Status != "ok" || status.Version != moduleVersion || status.UIOrigin != "http://127.0.0.1:4242" {
		t.Fatalf("status = %#v", status)
	}
}
