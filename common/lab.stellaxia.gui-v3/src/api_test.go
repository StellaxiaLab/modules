package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StellaxiaLab/modules/common/lab.stellaxia.gui-v3/nodedata"
)

const gif1x1 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

func newTestAPI(t *testing.T) http.Handler {
	t.Helper()
	store, err := nodedata.Open(filepath.Join(t.TempDir(), "node-data"), nodedata.Limits{})
	if err != nil {
		t.Fatal(err)
	}
	return newAPI(store, "test")
}

func call(t *testing.T, h http.Handler, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, apiPrefix+path, reader)
	req.Header.Set("X-Terra-Principal", "user:test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func errCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

// The profile flow the GUI runs: put the image, point the sheet at it, read both back.
func TestProfileFlow(t *testing.T) {
	h := newTestAPI(t)
	code, out := call(t, h, http.MethodPut, "/node/files/content", map[string]any{"path": "profile/image/me.gif", "mime": "image/gif", "data": gif1x1})
	if code != 200 || out["done"] != true || out["entry"] == nil {
		t.Fatalf("put = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodPatch, "/node/props", map[string]any{"set": map[string]any{"profile": map[string]any{"image": DataPrefix + "/profile/image/me.gif"}}})
	if code != 200 {
		t.Fatalf("patch = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodGet, "/node/props", nil)
	if code != 200 || !strings.Contains(mustJSON(out), "/데이터/profile/image/me.gif") {
		t.Fatalf("props = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodGet, "/node/files/content?path=profile/image/me.gif", nil)
	if code != 200 || out["data"] != gif1x1 || out["mime"] != "image/gif" {
		t.Fatalf("get = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodGet, "/node/files?dir=profile", nil)
	if entries, _ := out["entries"].([]any); code != 200 || len(entries) != 1 {
		t.Fatalf("list = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodGet, "/status", nil)
	if code != 200 || out["status"] != "ok" || out["usedBytes"].(float64) <= 0 {
		t.Fatalf("status = %d %v", code, out)
	}
}

func TestErrorsUseContractCodes(t *testing.T) {
	h := newTestAPI(t)
	cases := []struct {
		method, path string
		body         any
		status       int
		code         string
	}{
		{http.MethodPut, "/node/files/content", map[string]any{"path": "../x.gif", "data": gif1x1}, 400, "PATH_DENIED"},
		{http.MethodPut, "/node/files/content", map[string]any{"path": "x.gif", "data": base64.StdEncoding.EncodeToString([]byte("<html>"))}, 415, "TYPE_DENIED"},
		{http.MethodPut, "/node/files/content", map[string]any{"path": "x.gif", "data": "%%%"}, 400, "INVALID_REQUEST"},
		{http.MethodPut, "/node/files/content", map[string]any{"path": "x.gif", "data": gif1x1, "extra": 1}, 400, "INVALID_REQUEST"},
		{http.MethodGet, "/node/files/content?path=nope.gif", nil, 404, "NOT_FOUND"},
		{http.MethodPut, "/node/files/content", map[string]any{"path": "x.gif", "data": gif1x1, "offset": 7, "total": 200}, 409, "CHUNK_OUT_OF_ORDER"},
		{http.MethodDelete, "/node/files/content?path=nope.gif", nil, 404, "NOT_FOUND"},
		{http.MethodPatch, "/node/props", map[string]any{"set": map[string]any{"profile": map[string]any{"image": "/데이터/none.gif"}}}, 400, "INVALID_PROPERTY"},
		{http.MethodPost, "/node/props", nil, 405, "METHOD_NOT_ALLOWED"},
	}
	for _, c := range cases {
		code, out := call(t, h, c.method, c.path, c.body)
		if code != c.status || errCode(out) != c.code {
			t.Errorf("%s %s = %d %s, want %d %s", c.method, c.path, code, errCode(out), c.status, c.code)
		}
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
