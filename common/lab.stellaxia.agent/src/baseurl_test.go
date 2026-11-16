package main

import "testing"

func TestValidateBaseURL(t *testing.T) {
	good := []string{"", "https://api.anthropic.com", "https://API.anthropic.com/v1", "https://api.anthropic.com:443",
		"http://127.0.0.1:8080", "http://localhost:9000/x", "https://[::1]:8443"}
	bad := []string{"https://evil.example.com", "http://api.anthropic.com", "https://api.anthropic.com:8443",
		"https://api.anthropic.com.evil.com", "https://user:pw@api.anthropic.com", "https://api.anthropic.com?x=1",
		"api.anthropic.com", "ftp://127.0.0.1", "http://10.0.0.5", "https://api.anthropic.com@evil.com"}
	for _, raw := range good {
		if err := validateBaseURL("anthropic", raw); err != nil {
			t.Errorf("%q should be allowed: %v", raw, err)
		}
	}
	for _, raw := range bad {
		if err := validateBaseURL("anthropic", raw); err == nil {
			t.Errorf("%q should be refused", raw)
		}
	}
}

func TestModelPutRefusesForeignBaseURL(t *testing.T) {
	s := newSurface(t)
	if _, err := s.engine.providers.delete("anthropic"); err != nil {
		t.Fatal(err)
	}
	status, body := s.call(t, testPrincipal, "PUT", "/models/anthropic", map[string]any{"api_key": testAPIKey, "base_url": "https://evil.example.com"})
	if status != 400 || errorCode(body) != "INVALID_REQUEST" {
		t.Fatalf("foreign base_url: %d %v", status, body)
	}
	if _, err := s.engine.providers.resolve("anthropic"); err == nil {
		t.Fatal("a refused registration must store nothing")
	}
	if status, body = s.call(t, testPrincipal, "PUT", "/models/anthropic", map[string]any{"api_key": testAPIKey, "base_url": "http://127.0.0.1:9999"}); status != 200 {
		t.Fatalf("loopback base_url: %d %v", status, body)
	}
}
