---
title: "Terra GUI v3 (`lab.stellaxia.gui-v3`)"
aliases:
  - "Terra GUI v3"
  - "gui-v3"
  - "guiV3"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "draft"
version: "0.3.0"
last_updated: "2026-10-31"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
---

# Terra GUI v3 (`lab.stellaxia.gui-v3`)

Terra 노드 GUI의 3판이다. 화면 원본은 캔버스 보드(`web/design/`)이고, **웹 빌드(`web/` → `ui/`)가 그 보드를 그대로 띄워 실제 Terra 에 붙는다** — 모듈 앱으로 열리면 셸의 앱 토큰(A), 제품 셸의 첫 화면으로 열리면 스스로 로그인(B). 노드에 딸린 값은 노드 데이터 층(PA/EL)으로 읽고 쓰며([[docs/design/node-data|노드 데이터와 분할]]), 아직 시안 값이 남은 화면은 그 문서 §7 에 적었다. 백엔드는 노드에 붙는 GUI 데이터(프로필 사진 · 노드 속성)를 그 노드의 모듈 데이터 영역에 두고 계약의 operation으로 낸다.

방향은 하나다 — **화면(표현)은 새로 짓고, Terra 코어와 붙는 기능 층은 [`lab.stellaxia.node-gui`](../lab.stellaxia.node-gui/README.md)의 것을 이어받는다.**
노드 설정 · 사용자 문서는 화면이 코어 operation을 직접 부르고, 백엔드는 그 둘로 담을 수 없는 것만 맡는다([[docs/design/backend|백엔드 설계]]).

## 지금 있는 것

```text
common/lab.stellaxia.gui-v3/
├─ module.json        kind=service · 0.3.0 · gui.scenes(main, 얇은 껍데기) · gui.apps(웹 앱, embed=scene) · process(terra-gui-v3) + scene · module-data · configuration(maxFileMB · maxTotalMB) · readiness
├─ contracts/api/     terra-api.json — status · node-props.get/patch · node-files.list/get/put/delete, 권한 gui-v3.view · gui-v3.customize
├─ src/               백엔드 (Go, terra-sdk/modulesdk) — main.go · api.go · nodedata/ (+ 시험)
├─ scene/             main Scene — 얇은 껍데기(terra.web/frame 이 웹 앱을 감싼다 · /login 카드). 화면은 웹 앱
├─ web/               캔버스 보드 원본 · 보드 굽는 도구 · 웹 빌드(→ ui/, 포장되는 것은 ui/) — web/ 자체는 포장되지 않는다
├─ docs/              설계 문서 — 포장되지 않는다(L-8 경고는 의도한 것)
└─ README.md
```

## 빌드 · 시험

```bash
node tools/build-modules.mjs --target linux-amd64      # → bin/linux-amd64/terra-gui-v3
(cd common/lab.stellaxia.gui-v3/src && go test -race ./...)
node --test common/lab.stellaxia.gui-v3/web/src/api/node-data.test.mjs
```

백엔드만 손으로 띄워 보기 (호스트가 주는 env 를 흉내):

```bash
TERRA_MODULE_ID=lab.stellaxia.gui-v3 TERRA_INSTANCE_ID=i1 TERRA_ACTIVATION_EPOCH=1 TERRA_BOOTSTRAP_NONCE=n \
TERRA_WORKLOAD_CREDENTIAL=dev TERRA_LOOPBACK_ENDPOINT=127.0.0.1:18799 TERRA_MODULE_DATA_DIR=/tmp/gv3 \
  ./bin/linux-amd64/terra-gui-v3
curl -H 'X-Terra-Workload-Credential: dev' http://127.0.0.1:18799/api/modules/lab.stellaxia.gui-v3/v1/status
```

## 노드에 설치하고 열기

릴리스(저장소 태그 `v<날짜>`)가 모듈마다 `.tmod` 를 굽는다 — 타깃별로 따로(`lab.stellaxia.gui-v3-<버전>-linux-amd64.tmod` 꼴)이고, 화면은 `ui/`(웹 빌드)가 실린다. 노드에 까는 길은 둘이다.

**1. 파일로 — 그 노드에서**

```bash
terra module inspect lab.stellaxia.gui-v3-0.3.0-linux-amd64.tmod     # 신뢰 · 호환 · 요청 권한과 그 요약(permissions_digest)
terra module install lab.stellaxia.gui-v3-0.3.0-linux-amd64.tmod --grant-reviewed <permissions_digest> --start
terra module installed                                               # 깔린 것 · 고른 버전
```

`--grant-reviewed` 는 inspect 로 본 권한 요약을 그대로 준다 — 권한을 읽었다는 표시다. 이미 깔린 같은 버전을 다시 깔면 `--force`, 서명이 없는 개발 빌드는 `--dev`. 되돌리기는 `terra module rollback lab.stellaxia.gui-v3`.
GUI v3 안에서도 된다 — 제어기 › 모듈 › 설치(파일 경로 → 검사 → 권한 확인 · 설치). 이것은 명령 실행으로 같은 `terra module install` 을 부르므로 그 노드에서만 된다.

**2. Tree 레지스트리로 — 여러 노드에**

```bash
terra module publish lab.stellaxia.gui-v3-0.3.0-linux-amd64.tmod     # Tree(Master)에 올린다 — lab.stellaxia 접두사 소유가 필요
```

Tree 가 노드에 지정하면 노드는 '동의'한 뒤 스스로 받아 설치한다(`module_distribution`). GUI v3 의 제어기 › 모듈 › Tree 지정에서 동의 · 철회한다.

**열기**

| 길 | 어떻게 | 모드 |
| --- | --- | --- |
| main GUI (0.3.0~) | base Scene 이 gui-v3 의 main Scene 을 띄운다 — 다른 main 이 없을 때 곧장, 둘 이상이면 고르는 화면. 로그인은 Scene 의 `/login` 카드, 웹은 그 앱 토큰으로 부른다 | A — 사용자 ∩ 앱 권한 (웹은 비밀번호를 받지 않는다) |
| 셸의 앱 목록 | `embed:"scene"` 앱은 앱 목록(WebAppDock)에 나오지 않는다 — dock 은 `terra.webapp.*` 브리지만 알고 웹은 `terra.frame.*` 만 안다 | — |
| 제품 셸의 첫 화면 | 앱 주소를 그대로 연다(`…/api/v1/gui/apps/lab.stellaxia.gui-v3.web/files/ui/index.html`) — 로그인 화면이 Gateway 에 로그인 | B — 사용자 권한 전부 |
| 목업 | 같은 주소 뒤 `?demo` | Terra 없이 |

권한 — 앱이 요청하는 것은 `module.json` 의 `gui.apps[0].permissions`(node.read · node.control · node.config · file.* · process.execute · module.manage). 새 사용자 기본 권한에는 `node.config` · `module.manage` 가 없어서, 노드 설정 저장 · 모듈 설치 · 관리는 관리자가 그 권한을 줘야 된다.

> [!NOTE] 자리 표시 Scene
> `scene/` 은 entrypoint 자리를 채우는 글 한 줄이다. GUI v3 의 화면은 Scene 이 아니라 웹 앱이다.

## 문서

[[docs/README|GUI v3 문서 MOC]]부터 읽는다.

| 문서 | 내용 |
| --- | --- |
| [[docs/analysis/legacy-node-gui-overview\|기존 node-gui 전체 분석]] | 구조 · 규모 · 유지할 것 · 부채 · 외부 제약 |
| [[docs/analysis/legacy-app-layer\|기존 node-gui 기능 층 분석]] | 표현을 뺀 앱 계층 — 계층별 역할 · 재사용 판정 · 숨은 결합 · v3 경계 제안 |
| [[docs/design/menu-hierarchy\|메뉴 계층 설계]] | 기존 입구 18곳의 문제 · 범위 먼저 · 세 단계 이하 계층 · 인스펙터 · 기존 → v3 대응표 |
| [[docs/analysis/settings-inventory\|GUI v3 설정 종합]] | Terra · modules · 시안의 설정을 한 지도에 · 저장 위치 원칙 · 권고 |
| [[docs/design/backend\|백엔드 설계]] | 프로세스 · 계약 · 노드 데이터 저장 규칙 · 단계 |
| [`web/README.md`](web/README.md) | 캔버스 원본 · 보드 굽기 · 시안 저장 흉내 → 실제 길 |

## 관련 모듈

- [`lab.stellaxia.node-gui`](../lab.stellaxia.node-gui/README.md) — 기존 GUI(2판). 기능 층의 출처
- [`io.terra.agent`](../io.terra.agent/) — `.dc.html` 시연을 Vite + TypeScript 번들로 다시 쓴 선례
