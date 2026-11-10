package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func deskIcon(name string) map[string]any {
	return map[string]any{"c": 0, "r": 0, "name": name, "k": "dir"}
}

func deskFirst() map[string]any {
	return map[string]any{
		"icons.a": deskIcon("A"), "prefs.dark": true, "prefs.wall": "dusk", "prefs.wallFit": "cover",
		"prefs.dock": "bottom", "prefs.snap": true, "prefs.anim": true,
	}
}

func TestDeskAPIFlow(t *testing.T) {
	h := newTestAPI(t)
	code, out := call(t, h, http.MethodGet, "/node/desk", nil)
	if code != 200 || out["revision"] != float64(0) {
		t.Fatalf("empty get = %d %v", code, out)
	}
	if v, present := out["doc"]; !present || v != nil {
		t.Fatalf("empty get must carry doc:null, got %v", out)
	}
	if _, has := out["unchanged"]; has {
		t.Fatal("unchanged must be absent")
	}
	code, out = call(t, h, http.MethodGet, "/node/desk?since_revision=0", nil)
	if code != 200 || out["unchanged"] != true || out["revision"] != float64(0) {
		t.Fatalf("since 0 = %d %v", code, out)
	}
	if _, has := out["doc"]; has {
		t.Fatalf("unchanged answer must not carry doc: %v", out)
	}
	code, out = call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 0, "set": deskFirst()})
	if code != 200 || out["revision"] != float64(1) || out["doc"] == nil {
		t.Fatalf("first patch = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodGet, "/node/desk?since_revision=1", nil)
	if code != 200 || out["unchanged"] != true {
		t.Fatalf("unchanged = %d %v", code, out)
	}
	for _, q := range []string{"since_revision=0", "since_revision=9", ""} {
		code, out = call(t, h, http.MethodGet, "/node/desk?"+q, nil)
		doc, _ := out["doc"].(map[string]any)
		if code != 200 || out["unchanged"] != nil || doc == nil || doc["wall"] != nil {
			t.Fatalf("get %q = %d %v", q, code, out)
		}
	}
}

func TestDeskAPIErrors(t *testing.T) {
	h := newTestAPI(t)
	call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 0, "set": deskFirst()})
	dark := map[string]any{"prefs.dark": false}
	cases := []struct {
		name, method, path string
		body               any
		status             int
		code               string
	}{
		{"since not a number", http.MethodGet, "/node/desk?since_revision=abc", nil, 400, "INVALID_REQUEST"},
		{"since fraction", http.MethodGet, "/node/desk?since_revision=1.5", nil, 400, "INVALID_REQUEST"},
		{"no base", http.MethodPatch, "/node/desk", map[string]any{"set": dark}, 400, "INVALID_PROPERTY"},
		{"null base", http.MethodPatch, "/node/desk", map[string]any{"base_revision": nil, "set": dark}, 400, "INVALID_PROPERTY"},
		{"negative base", http.MethodPatch, "/node/desk", map[string]any{"base_revision": -1, "set": dark}, 400, "INVALID_PROPERTY"},
		{"fraction base", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1.5, "set": dark}, 400, "INVALID_REQUEST"},
		{"empty set", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{}}, 400, "INVALID_PROPERTY"},
		{"unknown field", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": dark, "x": 1}, 400, "INVALID_REQUEST"},
		{"bad key", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"icons": 1}}, 400, "INVALID_PROPERTY"},
		{"prefs null", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"prefs.dark": nil}}, 400, "INVALID_PROPERTY"},
		{"wall no file", http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"wall": map[string]any{"file": "desk/wall/none.gif", "name": "a", "type": "image/gif", "at": 1}}}, 400, "INVALID_PROPERTY"},
		{"post", http.MethodPost, "/node/desk", nil, 405, "METHOD_NOT_ALLOWED"},
		{"delete", http.MethodDelete, "/node/desk", nil, 405, "METHOD_NOT_ALLOWED"},
		{"desk.json get", http.MethodGet, "/node/files/content?path=desk.json", nil, 400, "PATH_DENIED"},
		{"Desk.JSON. get", http.MethodGet, "/node/files/content?path=Desk.JSON.", nil, 400, "PATH_DENIED"},
		{"desk.json delete", http.MethodDelete, "/node/files/content?path=desk.json", nil, 400, "PATH_DENIED"},
		{"desk.json put", http.MethodPut, "/node/files/content", map[string]any{"path": "DESK.json", "data": gif1x1}, 400, "PATH_DENIED"},
	}
	for _, c := range cases {
		code, out := call(t, h, c.method, c.path, c.body)
		if code != c.status || errCode(out) != c.code {
			t.Errorf("%s = %d %s %v, want %d %s", c.name, code, errCode(out), out, c.status, c.code)
		}
	}
}

func TestDeskAPIConflictDetails(t *testing.T) {
	h := newTestAPI(t)
	call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 0, "set": deskFirst()})
	code, _ := call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"icons.a": map[string]any{"c": 4, "r": 4, "name": "A", "k": "dir"}}})
	if code != 200 {
		t.Fatalf("move = %d", code)
	}
	code, out := call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"icons.a": deskIcon("A"), "prefs.dock": "left"}})
	e, _ := out["error"].(map[string]any)
	d, _ := e["details"].(map[string]any)
	keys, _ := d["keys"].([]any)
	if code != 409 || errCode(out) != "REVISION_CONFLICT" || len(keys) != 1 || keys[0] != "icons.a" {
		t.Fatalf("conflict = %d %v", code, out)
	}
	// Base ahead: 409 with an empty (not missing) keys array.
	code, out = call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 50, "set": map[string]any{"prefs.dock": "left"}})
	e, _ = out["error"].(map[string]any)
	d, _ = e["details"].(map[string]any)
	keys, present := d["keys"].([]any)
	if code != 409 || errCode(out) != "REVISION_CONFLICT" || !present || len(keys) != 0 {
		t.Fatalf("base ahead = %d %v", code, out)
	}
	// Other errors carry no details field.
	_, out = call(t, h, http.MethodGet, "/node/desk?since_revision=x", nil)
	if e, _ := out["error"].(map[string]any); e["details"] != nil {
		t.Fatalf("details leaked: %v", out)
	}
}

func TestDeskAPIWallFlow(t *testing.T) {
	h := newTestAPI(t)
	call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 0, "set": deskFirst()})
	code, out := call(t, h, http.MethodPut, "/node/files/content", map[string]any{"path": "desk/wall/1.gif", "mime": "image/gif", "data": gif1x1})
	if code != 200 || out["done"] != true {
		t.Fatalf("put wall = %d %v", code, out)
	}
	code, out = call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{
		"wall": map[string]any{"file": "desk/wall/1.gif", "name": "a.gif", "type": "image/gif", "at": 1730000000000}, "prefs.wall": "img"}})
	doc, _ := out["doc"].(map[string]any)
	wall, _ := doc["wall"].(map[string]any)
	if code != 200 || wall["file"] != "desk/wall/1.gif" {
		t.Fatalf("wall patch = %d %v", code, out)
	}
	// A file outside desk/wall/ is refused.
	call(t, h, http.MethodPut, "/node/files/content", map[string]any{"path": "profile/image/me.gif", "data": gif1x1})
	code, out = call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 2, "set": map[string]any{
		"wall": map[string]any{"file": "profile/image/me.gif", "name": "a.gif", "type": "image/gif", "at": 1}}})
	if code != 400 || errCode(out) != "INVALID_PROPERTY" {
		t.Fatalf("outside = %d %v", code, out)
	}
}

func TestDeskAPIConcurrent(t *testing.T) {
	h := newTestAPI(t)
	call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 0, "set": deskFirst()})
	const n = 16
	var wg sync.WaitGroup
	var mu sync.Mutex
	codes := map[int]int{}
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			code, _ := call(t, h, http.MethodPatch, "/node/desk", map[string]any{"base_revision": 1, "set": map[string]any{"icons.a": map[string]any{"c": i, "r": 0, "name": "A", "k": "dir"}}})
			mu.Lock()
			codes[code]++
			mu.Unlock()
		}(i)
	}
	close(start)
	wg.Wait()
	if codes[200] != 1 || codes[409] != n-1 {
		t.Fatalf("codes = %v", codes)
	}
}

// Every operation the contract lists must be routed by newAPI at its binding.
func TestContractOperationsAreRouted(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "contracts", "api", "terra-api.json"))
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Operations map[string]struct {
			Bindings []struct {
				Method string `json:"method"`
				Path   string `json:"path"`
			} `json:"bindings"`
		} `json:"operations"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"node-desk.get", "node-desk.patch", "node-props.get", "node-props.patch", "node-files.list", "node-files.get", "node-files.put", "node-files.delete", "status.get"} {
		if _, ok := contract.Operations["lab.stellaxia.gui-v3."+id]; !ok {
			t.Errorf("contract lacks %s", id)
		}
	}
	h := newTestAPI(t)
	for id, op := range contract.Operations {
		if len(op.Bindings) == 0 {
			t.Errorf("%s has no binding", id)
		}
		for _, b := range op.Bindings {
			if !strings.HasPrefix(b.Path, apiPrefix) {
				t.Errorf("%s binds %s outside %s", id, b.Path, apiPrefix)
				continue
			}
			req := httptest.NewRequest(b.Method, b.Path, strings.NewReader("{}"))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			// An unrouted path is the mux's plain-text 404; a routed one answers in JSON
			// (the handler may still say 400 or 404 NOT_FOUND for the empty request).
			if rec.Code == http.StatusMethodNotAllowed || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
				t.Errorf("%s: %s %s is not routed (%d %q)", id, b.Method, b.Path, rec.Code, rec.Header().Get("Content-Type"))
			}
		}
	}
}

func TestModuleVersionMatchesManifest(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "module.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.Version != moduleVersion {
		t.Fatalf("module.json version %q != moduleVersion %q", m.Version, moduleVersion)
	}
}
