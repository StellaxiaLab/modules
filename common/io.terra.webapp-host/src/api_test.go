package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStatusAnswersTheReadinessProbeShape(t *testing.T) {
	handler := newOperationsHandler(time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, apiPrefix+"/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var body struct {
		Status    string `json:"status"`
		Version   string `json:"version"`
		StartedAt string `json:"started_at"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Version != moduleVersion || body.StartedAt == "" {
		t.Fatalf("body = %#v", body)
	}
}
