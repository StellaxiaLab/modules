// Command terra-gui-v3 is the backend of Terra GUI v3 (lab.stellaxia.gui-v3).
//
// GUI v3의 화면은 코어 operation(노드 설정 · 사용자 문서)을 직접 부른다. 이 프로세스가
// 맡는 일은 하나 — **노드에 붙는 GUI 데이터**(프로필 사진 · 노드 속성)를 그 노드의 모듈
// 데이터 영역에 두고 계약(contracts/api/terra-api.json)의 operation으로 내는 것이다.
// 노드 설정을 대신 쓰지 않는다: 그러면 v3 operation 권한만으로 노드 설정이 바뀐다.
// 설계는 docs/design/backend.md.
package main

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"

	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"

	"github.com/StellaxiaLab/modules/common/lab.stellaxia.gui-v3/nodedata"
)

const (
	moduleID      = "lab.stellaxia.gui-v3"
	moduleVersion = "0.1.0"
)

// config is the manifest's configuration.schema — sizes in MiB.
type config struct {
	MaxFileMB  int64 `json:"maxFileMB"`
	MaxTotalMB int64 `json:"maxTotalMB"`
}

func loadLimits() nodedata.Limits {
	var cfg config
	err := modulesdk.LoadModuleConfig(&cfg)
	switch {
	case errors.Is(err, modulesdk.ErrConfigNotProvided):
		return nodedata.DefaultLimits
	case err != nil:
		log.Printf("gui-v3: module configuration unreadable, using defaults: %v", err)
		return nodedata.DefaultLimits
	}
	limits := nodedata.DefaultLimits
	if cfg.MaxFileMB > 0 {
		limits.MaxFileBytes = cfg.MaxFileMB << 20
	}
	if cfg.MaxTotalMB > 0 {
		limits.MaxTotalBytes = cfg.MaxTotalMB << 20
	}
	return limits
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	identity, err := modulesdk.FromEnv()
	if err != nil {
		log.Printf("gui-v3: no workload identity: %v", err)
		os.Exit(2)
	}
	dataDir, err := modulesdk.DataDir(moduleID)
	if err != nil {
		log.Printf("gui-v3: data directory: %v", err)
		os.Exit(3)
	}
	store, err := nodedata.Open(filepath.Join(dataDir, "node-data"), loadLimits())
	if err != nil {
		log.Printf("gui-v3: node data store: %v", err)
		os.Exit(3)
	}
	server, err := modulesdk.Listen(modulesdk.Config{
		Identity: identity,
		Readiness: func(context.Context) (bool, string) {
			if _, err := store.Usage(); err != nil {
				return false, "node data store unreadable"
			}
			return true, ""
		},
		Operations: newAPI(store, moduleVersion),
	})
	if err != nil {
		log.Printf("gui-v3: listen: %v", err)
		os.Exit(4)
	}
	if err := server.Serve(context.Background()); err != nil {
		log.Printf("gui-v3: serve: %v", err)
		os.Exit(5)
	}
}
