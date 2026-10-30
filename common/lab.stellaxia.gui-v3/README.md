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
version: "0.1.0"
last_updated: "2026-10-29"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
---

# Terra GUI v3 (`lab.stellaxia.gui-v3`)

Terra 노드 GUI의 3판이다. **화면은 설계 단계**(캔버스 원본 `web/design/`)이고, **백엔드 1차가 들어왔다** — 노드에 붙는 GUI 데이터(프로필 사진 · 노드 속성)를 그 노드의 모듈 데이터 영역에 두고 계약의 operation으로 낸다.

방향은 하나다 — **화면(표현)은 새로 짓고, Terra 코어와 붙는 기능 층은 [`lab.stellaxia.node-gui`](../lab.stellaxia.node-gui/README.md)의 것을 이어받는다.**
노드 설정 · 사용자 문서는 화면이 코어 operation을 직접 부르고, 백엔드는 그 둘로 담을 수 없는 것만 맡는다([[docs/design/backend|백엔드 설계]]).

## 지금 있는 것

```text
common/lab.stellaxia.gui-v3/
├─ module.json        kind=service · 0.1.0 · process(terra-gui-v3) + scene · module-data · configuration(maxFileMB · maxTotalMB) · readiness
├─ contracts/api/     terra-api.json — status · node-props.get/patch · node-files.list/get/put/delete, 권한 gui-v3.view · gui-v3.customize
├─ src/               백엔드 (Go, terra-sdk/modulesdk) — main.go · api.go · nodedata/ (+ 시험)
├─ scene/             자리 표시 Scene (글 한 줄)
├─ web/               캔버스 보드 원본 · 보드 굽는 도구 · 백엔드 클라이언트 — 포장되지 않는다
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

> [!NOTE] 노드에 깔려도 화면은 보이지 않는다
> `contributions.gui`가 없으므로 base Scene(`io.terra.scene.terra`)은 이 모듈을 main · dev 후보로 고르지 않는다. 백엔드 프로세스는 돌고 operation은 게시된다.

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
