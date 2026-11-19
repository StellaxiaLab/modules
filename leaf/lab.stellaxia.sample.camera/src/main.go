// Command terra-sample-camera is the reference resourcizer module (Terra
// resourcizer framework R4): the first consumer of the source seam.
//
// All it writes is one type — camera.rtsp: a form (address, user, password),
// a probe, and an Open for its one source endpoint. Everything else — the type
// list, the instance set the node hands over, the descriptors, the source
// seam, closing streams when an instance goes away, the 404/503/200 judgement
// — is the terra-sdk resourcize framework.
//
// remote-view (a program window as a resource) is meant to take this place as
// the source seam's real consumer; it will be another type of this shape.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
	"github.com/StellaxiaLab/terra-sdk/modulesdk/resourcize"
)

const (
	moduleID      = "lab.stellaxia.sample.camera"
	moduleVersion = "0.1.0"
)

// cameraConfig is the camera.rtsp form.
type cameraConfig struct {
	URL      string `json:"url"`
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
}

var cameraSchema = map[string]any{
	"type":     "object",
	"required": []any{"url"},
	"properties": map[string]any{
		"url": map[string]any{
			"type": "string", "title": "RTSP 주소", "format": "uri", "pattern": "^rtsp://",
			"description": "예: rtsp://10.0.0.5:554/stream1. 계정은 아래 칸에 넣는다",
			"examples":    []any{"rtsp://10.0.0.5:554/stream1"},
		},
		"user":     map[string]any{"type": "string", "title": "사용자"},
		"password": map[string]any{"type": "string", "title": "비밀번호", "x-terra-secret": true},
	},
	"x-terra-order": []any{"url", "user", "password"},
}

// newFramework is the whole module: one type.
func newFramework() (*resourcize.Framework, error) {
	framework := resourcize.New(moduleID)
	err := resourcize.Register(framework, resourcize.Declared[cameraConfig]{
		ID:          "camera.rtsp",
		Title:       "RTSP 카메라",
		Description: "RTSP 주소의 영상을 원천 자원으로 게시한다(RTP 패킷 그대로, 해독 없음)",
		Kind:        "io.camera",
		Schema:      cameraSchema,
		Endpoints: []resourcize.Endpoint{{
			ID: "rtp", Direction: resourcize.Source, Schema: "terra.bytes@1",
			Encodings: []string{"application/rtp"}, Sensitivity: "sensitive",
		}},
		Validate: func(_ context.Context, instance resourcize.Instance[cameraConfig]) error {
			parsed, err := url.Parse(instance.Config.URL)
			if err != nil || parsed.Host == "" {
				return resourcize.Field("/url", "RTSP 주소가 아니다")
			}
			if parsed.User != nil {
				return resourcize.Field("/url", "계정은 주소에 넣지 말고 사용자·비밀번호 칸에 넣는다")
			}
			return nil
		},
		Realize: func(ctx context.Context, instance resourcize.Instance[cameraConfig]) error {
			return asReason(probe(ctx, instance.Config.URL, instance.Config.User, instance.Config.Password))
		},
		OpenSource: func(ctx context.Context, instance resourcize.Instance[cameraConfig], _ string) (resourcize.StreamSource, error) {
			stream, err := openStream(ctx, instance.Config.URL, instance.Config.User, instance.Config.Password)
			if err != nil {
				return nil, asReason(err)
			}
			return stream, nil
		},
	})
	return framework, err
}

// asReason turns an RTSP failure into the short code the controller shows.
func asReason(err error) error {
	var rtsp rtspError
	if errors.As(err, &rtsp) {
		return resourcize.Unavailable(rtsp.reason)
	}
	return err
}

func main() {
	identity, err := modulesdk.FromEnv()
	if err != nil {
		os.Exit(2)
	}
	framework, err := newFramework()
	if err != nil {
		os.Exit(3)
	}
	cfg := modulesdk.Config{
		Identity:   identity,
		Operations: operationsHandler(framework),
	}
	if err := framework.Install(&cfg); err != nil {
		os.Exit(4)
	}
	server, err := modulesdk.Listen(cfg)
	if err != nil {
		os.Exit(5)
	}
	if err := server.Serve(context.Background()); err != nil {
		os.Exit(6)
	}
}

// operationsHandler serves the readiness status operation.
func operationsHandler(framework *resourcize.Framework) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/modules/"+moduleID+"/v1/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "version": moduleVersion, "instances": len(framework.Instances())})
	})
	return mux
}
