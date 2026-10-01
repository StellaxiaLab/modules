// Command terra-sample-window is the reference window-mode GUI app (창 모드 앱
// 런처 설계 §5.1 첫 실물 입주자): 자기 웹 서버로 UI를 여는 메인 프로그램이
// 확장 모듈이 되는 형태를 보여준다.
//
// 두 개의 리스너가 핵심이다:
//   - UI 리스너: 모듈이 스스로 여는 임의 루프백 포트. 화면(/)과 헬스(/live)만
//     서빙하고, 모듈 API는 절대 여기 두지 않는다(§5.2 — UI origin은 UI 전용).
//   - SDK 리스너: Runtime이 배정한 endpoint. 핸드셰이크·readiness·status
//     오퍼레이션이 산다. Config.WindowOrigin에 UI origin을 넣으면 SDK가
//     핸드셰이크 응답에 실어 보내고, 호스트가 게시하고, 런처에 "창에서
//     열기"가 생긴다 — 모듈이 할 일은 그게 전부다.
//
// 기존 웹 서버 GUI를 가진 프로그램을 이관할 때는 UI 리스너 자리에 그
// 프로그램(또는 자식 프로세스로 기동한 그 서버)의 origin을 넣으면 된다.
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"net"
	"net/http"
	"os"

	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

const moduleVersion = "0.1.0"

//go:embed ui/index.html
var indexHTML []byte

func main() {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		os.Exit(2)
	}

	// 1. 모듈 자신의 UI 서버 — 포트는 OS가 고른다. 고정 포트 테이블은 없다.
	uiListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(3)
	}
	uiOrigin := "http://" + uiListener.Addr().String()
	go func() {
		_ = http.Serve(uiListener, uiHandler())
	}()

	// 2. SDK 서버 — WindowOrigin 한 줄이 창 앱 게시의 전부다.
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity:     identity,
		WindowOrigin: uiOrigin,
		Readiness: func(context.Context) (bool, string) {
			return true, ""
		},
		Operations: operationsHandler(uiOrigin),
	})
	if err != nil {
		os.Exit(4)
	}
	if err := server.Serve(context.Background()); err != nil {
		os.Exit(5)
	}
}

// uiHandler serves the app's own window UI: the page and its health probe.
// Nothing else — a window UI origin carries no module API (§5.2).
func uiHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(indexHTML)
	})
	return mux
}

// operationsHandler serves the module's API on the Runtime-assigned endpoint:
// the single status operation the readiness contract points at.
func operationsHandler(uiOrigin string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/modules/io.terra.sample.window/v1/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":   "ok",
			"version":  moduleVersion,
			"uiOrigin": uiOrigin,
		})
	})
	return mux
}
