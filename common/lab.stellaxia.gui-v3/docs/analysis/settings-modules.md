---
title: "modules 설정 전수표 — 매니페스트 · 모듈 저장 상태 · env · 엔드포인트"
aliases:
  - "modules 설정 전수표"
  - "Modules Settings"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-28"
language: "ko-KR"
based_on: "modules HEAD 459f3af (shallow) · 정독만 — 설치 · 빌드 · 시험은 하지 않음. 코어 동작 확인이 필요한 곳만 Terra 8192add 를 읽었다(경로 앞에 terra: 를 붙였다)"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[settings-inventory|GUI v3 설정 종합]]"
  - "[[settings-terra-core|Terra 코어 설정 전수표]]"
  - "[[legacy-node-gui-overview|기존 node-gui 전체 분석]]"
  - "[[legacy-app-layer|기존 node-gui 기능 층 분석]]"
  - "[[menu-hierarchy|메뉴 계층 설계]]"
---


# modules 저장소 — 설정으로 관리해야 할 것 전수 조사

## 0. 읽는 법

- 경로는 저장소 루트 기준 `path:line`. 코어(Terra) 쪽 근거는 `terra:` 접두.
- **v3 노출** 칸: `편집` = v3가 바꿀 수 있게 한다 · `읽기` = 보이기만 · `never` = 보이지 않거나 값 없이 사실만 · `—` = GUI 대상 아님(빌드 · 개발).
- 이미 정리된 것은 되풀이하지 않고 가리킨다.
  - 연동 층 계층 · 잠금 규칙(`lockFor` · `reaches` · `module-gate`) · 앱 10개 대응표 → [[legacy-app-layer]] §2~§5
  - 외부 제약(frame 첫 import · CSP · srcdoc · 비밀번호 금지) → [[legacy-node-gui-overview]] §5
  - 메뉴 자리(이 기기 설정 · 노드 설정 · 모듈 설정 칸) → [[menu-hierarchy]] §5.3 · §5.6

### 0.1 규모

| 범주 | 개수 |
| --- | --- |
| 매니페스트 | 모듈 14개 · 스키마 최상위 필드 21 · 실제로 쓰인 최상위 필드 15 · 기여(contributions) 표면 4(gui.apps · gui.scenes · svi · cli) |
| 모듈별 저장 설정 | node-gui 브라우저 키 8 + IndexedDB 1 + 사용자 문서 키 2 + 실행 설정 4 + Scene Store 3 · 다른 모듈 데이터 파일 10종 · Daemon 설정 135키(6분류) · 모듈 설정(manifest `configuration`) **선언 0** |
| 환경 변수 · 엔드포인트 | 모듈이 읽는 env 14 · 호스트가 주는 env 약 10 · 웹 빌드 env 2 · 도구 env 10 · Gateway 경로 14 · postMessage 프로토콜 2(메시지 11종) · 포트 9 |
| 스키마 · 계약 | JSON 스키마 1(`manifest-v2`) · 모듈 계약 9개 operation 88 · `internal/`에 설정 · 노드 모양 공용 타입 없음 |
| 도구 | npm 스크립트 10 · CLI 플래그 12 |

---

## 1. 모듈 매니페스트 `module.json`

### 1.1 출처와 권위

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 스키마 | `schemas/manifest-v2.schema.json` — Terra `terra-module-runtime` 소유본의 바이트 사본(sha256 고정) | `schemas/PROVENANCE.json:3-13` |
| 런타임 권위 | Go 검증기. 스키마가 못 하는 존재 규칙(entrypoint 또는 구현 지목 기여)은 Go 쪽 | `schemas/manifest-v2.schema.json:5` · `PROVENANCE.json:8` |
| 이 저장소 검사 | `tools/validate-modules.mjs` — 스키마(L-5) · 디렉터리=id(L-2) · id 유일(L-3) · 소유권 루트=products(L-4) · 경로 실재(L-6) · kind 실행 선언(L-7) · 포장 항목(L-8) · 0개 금지(L-9) · Scene 두 층(L-10) | `tools/validate-modules.mjs:116-262` |
| 사본 대조 | `tools/check-schema-drift.mjs` (`--terra` / `TERRA_CHECKOUT` 또는 `--self-only`) | `tools/check-schema-drift.mjs:34-51` |

### 1.2 최상위 필드 (스키마 전부)

`additionalProperties: false` — 아래 밖의 키는 거절된다(`manifest-v2.schema.json:8`).

| 필드 | 타입 · 제약 | 필수 | 기본값 | 코어가 하는 일 | 이 저장소 사용 | v3 노출 |
| --- | --- | --- | --- | --- | --- | --- |
| `$comment` | string | | — | 무시 | 4개 Scene 모듈 | — |
| `schemaVersion` | const `2` (`:14-17`) | ● | — | v1은 v2로 정규화 후 검증 | 14/14 | 읽기 |
| `id` | `^[a-z0-9][a-z0-9._-]{2,127}$` (`:18-22`) | ● | — | 모듈 정체 · 데이터 디렉터리 · 앱 origin(`app-<id>.localhost`) | 14/14 | 읽기 |
| `version` | string ≥1 (`:23-27`) | ● | — | 의존 범위 매칭 · 설치 기록 | 14/14 | 읽기 |
| `kind` | `application`·`runtime`·`scene`·`service`·`adapter`·`extension` (`:28-31`) | ● | — | scene은 entrypoint 생략 가능, adapter·extension은 조건부 | service 9 · scene 5 | 읽기 |
| `name` · `description` | string (`:32-33`) | | — | 목록 표시 | 14/14 | 읽기 |
| `compatibility` | `products[]` · `hostRoles[]` · `keeper` · `os[]` · `arch[]` (`:34-45`) | | — | 설치 가능 판정. L-4가 소유권 루트와 `products` 일치 요구 | products 14 · os 14 · hostRoles 2(`io-weave` leaf-node · `fleet` tree-control) | 읽기 |
| `dependencies[]` | `{id?, capability?, versionRange?}` (`:46-50`, `$defs.dependency :161-169`) | | — | 의존 해석 | **0** | 읽기 |
| `entrypoints` | `process`·`worker`·`library`·`runtime` = target→경로 맵, `scene` = string (`:51-62`) | 조건부 | — | 실행 · Scene 로드 | process 9 · scene 5 | 읽기 |
| `integrity.process` | target → sha256 hex (`:63-74`) | | — | 릴리스 빌드가 찍고 실행 전 검증 | 0(빌드가 찍는다) | 읽기 |
| `provides.capabilities[]` | `{id, version?}` (`:75-93`) | | — | 다른 모듈의 capability 의존 대상 | 9 | 읽기 |
| `contracts` | 이름 → 패키지 상대 경로 (`:94-98`) | | — | API 계약(`api`) 로드 · Gateway 바인딩 | `api` 9 | 읽기 |
| `contributions` | 열린 object (`:99-102`) — 모양은 공통 설계 소유 | | — | §1.3 | 13 | 읽기 |
| `permissions` | `coreOperations[]`(dependency 모양) · `storage[]` · `network[]` · `secret[]` · `native[]` (`:103-114`) | | — | 코어 op 호출 허가 · `module-data`면 `TERRA_MODULE_DATA_DIR`, `shared-roots`면 `TERRA_MODULE_SHARED_ROOTS`(서명 등급 조건) | §1.4 | 읽기 |
| `readiness` | `operationId` · `versionRange` · `timeoutMs≥0` (`:115-124`) | | — | route 게시 전 준비 확인 | 9 (모두 `>=0.1.0 <1.0.0` · 15000) | 읽기 |
| `workloadIdentity` | 열린 object (`:125-128`) | | — | 모듈 주체 · 토큰 정책 | 0 | — |
| `update` | `strategy` · `drainTimeoutMs` · `rollback` (`:129-138`) | | — | 교체 · 롤백 | 9 (모두 `start-before-stop` · 30000 · true) | 읽기 |
| `configuration.schema` | JSON Schema 2020-12 부분집합, root object, ≤64 KiB, `x-terra-secret`(최상위만 · 되읽지 않음) · `x-terra-restart` (`:139-150`) | | — | 호스트가 값을 저장 · 검증하고 실효값을 `TERRA_MODULE_CONFIG_FILE`로 준다 | **0 — 어느 모듈도 선언하지 않았다** | 편집(모듈 설정 칸) |
| `signature` | 열린 object (`:151-154`) | | — | 서명 · 신뢰 등급 | 0 | 읽기 |
| `legacy` | 열린 object (`:155-158`) | | — | v1 필드 보존. 호스트는 `enabled` · `autoStart` · `args` · `environment` · `permissions` · `restart` · `capabilities`를 꺼내 쓴다 | 0 | never |

`legacy.environment`가 모듈 프로세스에 env를 넣는 **유일한 매니페스트 길**이다(`terra:products/common/packages/terra-module-host/common_adapter.go:82-86` · `manager.go:803-807`). 최대 128개, `TERRA_MODULE_` · `TERRA_DAEMON_` 접두 금지(`terra:…/terra-module-host/manifest.go:147-157`).

### 1.3 기여(contributions) 모양 — 실제 쓰인 것

| 표면 | 필드 | 값 · 의미 | 사용 예 | 코어 처리 |
| --- | --- | --- | --- | --- |
| `gui.apps[]` | `id` | 앱 id(모듈 id와 다를 수 있다) | `common/lab.stellaxia.node-gui/module.json:27` | 빈 id는 건너뜀 (`terra:…/terra-module-host/catalog_gui.go:45`) |
| | `name` | 표시 이름 | | |
| | `mode` | `static`(기본) · `proxied` · `window` | static 6 · window 1(`io.terra.sample.window/module.json:33`) | 빈 값 = static (`catalog_gui.go:48-50`) |
| | `entry` | 패키지 상대 진입 문서 | `ui/index.html` | window는 없음. 웹 모듈이면 빌드 산출물이라 L-6 실재 검사 면제 (`tools/validate-modules.mjs:181-192`) |
| | `isolation` | `sandboxed`만 v1 허용(`trusted`는 강등) | 6 | `terra:…/terra-gateway-service/gui_apps.go:106,251` |
| | `embed` | `scene`만 — 자기 Scene의 `terra.web/frame` 안에서만 연다 | node-gui `:32` · main-test `:33` | window면 무시 (`catalog_gui.go:54`) |
| | `permissions[]` | 앱이 원하는 권한 — 셸 브리지가 사용자 권한과 교집합 | §1.4 | 그대로 실어 나름 (`gui_apps.go:62-64`) |
| | `window` | `{health, singleInstance}` | sample.window `:34` | `gui_apps.go:85-99` |
| | `capabilities[]` | CSP 넓히기: `blob-images` · `workers` · `wasm` | **0** | 모르는 값은 경고 후 무시 (`gui_apps.go:113-131`) |
| | `route` · `endpoint` | Gateway가 받는 칸 | 0 | `gui_apps.go:156-177` |
| `gui.scenes[]` | `id` · `entry` · `role`(`application`/`base`) · `branch`(`main`/`dev`/빈 값) | base는 Terra 서명만 — 일반 모듈은 application으로 강등. `branch: main`이면 base Scene이 곧장 띄운다 | node-gui `:17-24` · main-test `:18-25` · login-demo · hello | `terra:…/terra-gateway-service/gui.go:38-44,595-615` · `terra:…/terra-module-runtime/manifest.go:92-104` |
| `svi` | `resources: true` · `sink: true` | 이 모듈이 SVI 자원을 낸다 · 받는다(sink) | io-inventory `:28` · io-weave `:48-53` | 데몬이 원격 제공자 어댑터 등록 (`terra:…/terra-module-runtime/contributions.go:9-32`) |
| `cli.commands[]` | `name` · `operationId` · `summary` · `kind: session` · `args[]{name,pointer,required,summary,ref,variadic}` · `flags[]{name,pointer,type(boolean·integer·string-list·string-map),summary,source:stdin,deprecated}` · `session{identity,title,history,stream,send,item,labels}` | `terra <cmd>`를 operation에 묶는다 | agent `:68-470` · nodetalk `:65-351` · terrallo `:37-45` | `terra:…/terra-module-runtime/cli_contribution.go` |

v3 관점: `gui.apps`(id · name · mode · permissions · embed)는 **노드 창 › 모듈 › 모듈 앱**의 목록 데이터다. 런처는 `/api/v1/gui/apps`(공개)로 받는다(`common/lab.stellaxia.node-gui/web/src/api/operations.js:205`, `source.js:212-216`).

### 1.4 권한 어휘 — 매니페스트 · 계약 · GUI에 나오는 것

| 권한 | 선언된 곳 | 쓰는 곳 | 비고 |
| --- | --- | --- | --- |
| `session.identity` | node-gui 앱 `module.json:34` | web/src에서 참조 없음 | 셸 쪽 의미 — 확인 필요 |
| `node.read` · `node.control` | node-gui · nodetalk · fleet · treebench · sample.window(read) | nodetalk · fleet 계약, node-gui 잠금 | |
| `node.config` ★ | **어느 매니페스트에도 없다** | node-gui 설정 저장 · SVI 선언 쓰기(`settings-live.js:93`, `operations.js:56-59`) | 의도적으로 뺐다 — Q-10 (`web/docs/api/real-data-layer.md:686`). 그래서 기존 GUI의 노드 설정 135키는 **늘 잠김** |
| `file.read` · `file.write` | node-gui | io.terra.file 계약 19 op | |
| `process.execute` · `process.execute.delegated` | node-gui | 명령 실행 · 터미널 | `.delegated`는 web/src 참조 없음 |
| `process.cancel` ★ · `module.manage` ★ · `master.admin` ★ | node-gui(module.manage) · treebench(master.admin) | STAR 목록 `web/src/model/permissions.js:6` | |
| `agent.use` | agent 앱 `module.json:62-64` | agent 계약 18 op | |
| `agent.external` | 어느 앱도 선언하지 않음 | agent `mcp.put`·`mcp.delete` | GUI에서 MCP 등록 불가(CLI 전용) — 의도로 보인다 |
| `agent.grant` · `relay.use` · `module.publish` | 없음 | settings 데모 글만 (`screens/settings.js:9,363`) | |

`permissions.storage` 값: `module-data`(agent · nodetalk · file · io-inventory · io-weave) · `shared-roots`(file). `permissions.network`: `api.anthropic.com`(agent `:49-51`). `coreOperations`: agent(`terra.gateway.delegate` `>=1.0.0 <2.0.0` · `terra.node.identity.get`), nodetalk(`terra.node.identity.get` · `terra.node.peer.invoke`), fleet(`terra.fleet.*` 10개).

### 1.5 모듈별 요약

| 모듈 | 루트 | ver | kind | 실행 | GUI 기여 | 권한 · 저장 | readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dev.terrallo` | common | 0.1.0 | service | process ×3 | cli 1 | — | `dev.terrallo.status.get` |
| `io.terra.agent` | common | 0.3.0 | service | process ×3 | app(static, agent.use) · cli 16 | core 2 · module-data · network | `…agent.status.get` |
| `io.terra.nodetalk` | common | 0.1.0 | service | process ×3 | app(node.read·control) · cli 11 | core 2 · module-data | `…nodetalk.status.get` |
| `io.terra.sample.window` | common | 0.1.0 | service | process ×3 | app(window, node.read) | — | `…window.status.get` |
| `io.terra.scene.login-demo` | common | 0.1.0 | scene | scene | scene | — | — |
| `lab.stellaxia.gui-v3` | common | 0.0.1 | scene | scene | **없음**(base에 안 나타남) | — | — |
| `lab.stellaxia.node-gui` | common | 0.4.5 | scene | scene | scene(main) + app(embed) 8권한 | — | — |
| `lab.stellaxia.scene.hello` | common | 0.1.0 | scene | scene | scene | — | — |
| `lab.stellaxia.scene.main-test` | common | 0.1.0 | scene | scene | scene(main) + app(embed) | — | — |
| `io.terra.file` | leaf | 0.2.1 | service | process ×3 | — | module-data · shared-roots | `…file.roots.list` |
| `io.terra.io-inventory` | leaf | 0.2.0 | service | process ×3 | svi.resources | module-data | `…devices.list` |
| `io.terra.io-weave` | leaf | 0.1.0 | service | process ×3 | svi.resources+sink | module-data | `…io-weave.status.get` |
| `io.terra.fleet` | tree | 0.1.0 | service | process ×3 | app(node.read·control) | core 10 | `…fleet.fleets.list` |
| `io.terra.treebench` | tree | 0.1.0 | service | process ×3 | app(+master.admin) | **없음** | `…treebench.status.get` |

process 타깃은 모두 `linux-amd64` · `linux-arm64` · `windows-amd64`. `compatibility.os`는 모두 `linux` · `windows`(macOS 없음).

---

## 2. 모듈별 설정 · 저장 상태

### 2.1 `lab.stellaxia.node-gui` (0.4.5) — 웹 앱

#### 2.1.1 실행 설정 `ui/config.json` (원본 `web/public/config.json`)

패키지에 실려 나간다. 다시 빌드하지 않고 파일만 바꿀 수 있지만 **사용자가 런타임에 바꾸는 길은 없다**(포장 파일이다).

| 키 | 타입 | 기본값 | 검증 | 읽는 곳 | v3 노출 |
| --- | --- | --- | --- | --- | --- |
| `variant` | string | `module` | — | `web/tools/gen-pages.py:15-16` (빌드 때만) | — |
| `appTitle` | string | `Terra` | — | **읽는 곳 없음** | — (버린다) |
| `layoutStore` | `server`·`local`·`none` | `server` | 모르는 값 → 기본 (`web/src/api/config.js:18`) | `data/node-live.js:480,484` | 읽기 — §2.1.3과 함께 "저장 위치" 표시. 사용자 선택으로 바꿀지는 열린 질문 |
| `pollSec` | int(초) | `10` | 최소 5 (`config.js:19`) | 조타륜 앱 폴링 `api/wire.js:490`, 알림 `:493`, 네트워크 ×3 `:494`, SSE 열리면 ×6 `wire.js:38` | 편집 후보(이 기기) |

정의: `web/src/api/config.js:9-21` · `web/public/config.json:1-6`.

#### 2.1.2 브라우저 `localStorage` (앱 origin `app-<앱 id>.localhost` — 게이트웨이마다 갈린다)

| 키 | 값 모양 | 기본 | 쓰는 곳 | 읽는 곳 | 서버 사본 | v3 노출 |
| --- | --- | --- | --- | --- | --- | --- |
| `terra.gui.layout\|<node_id 또는 이름>\|<주체>` | JSON `{looks, maps, map, roadsOn, markStyle, roadPick, memos, wins, utilItems, ovhHide, linkOrphans, nodeIds, _savedAt}` | 없음 → 기본 맵 | `store/layout.js:89-92` (0.8초 모아서 `:126`, `pagehide`) | `store/layout.js:12-14` · `data/node-live.js:480-481` | 사용자 문서 `layout/<node_id>` | 내부 상태(형식은 v3가 새로 정한다 — [[legacy-app-layer]] §5-5) |
| `terra.gui.buildings` | JSON 배열 `{id,name,N,blocks,frames,period,events,customEvents}` | `[]` | 건물 편집기 내보내기 `screens/building.js:1105` · `store/docs.js:112` | `screens/node.js:843` | 사용자 문서 `assets` | 내부 상태(꾸미기 자산) |
| `terra.gui.roads` | JSON 배열(도로 설계) | `[]` | `screens/road.js:1154` · `docs.js:112` | `screens/road.js:728` · `node.js:856` | `assets` | 내부 상태 |
| `terra.gui.assetsAt` | ms 문자열 | 0 | `store/docs.js:114,122` | `docs.js:106` | — | never |
| `terra.gui.innerHelp` | `'1'`/`'0'` | 끔 | `screens/settings.js:173` | `settings.js:58` · `network.js:81` · `node.js:1943` | — | 편집(이 기기 › 도움말) |
| `terra.gui.winOpacity` | int 문자열 30~100 | `64` | `screens/settings.js:172` | `settings.js:171` · `node.js:1944` | — | 편집(이 기기 › 창 투명도) |
| `terra.gui.firstRunDone` | `'1'` / 없음 | 없음 | `screens/settings.js:60` | `settings.js:59` | — | 편집(온보딩 다시 보기) |
| `terra.gui.autoLogin` | JSON `{username}` | — | `screens/index.js:30` | `index.js:29` | — | **never — 모듈 판에서는 no-op로 덮였다** (`data/intro-live.js:31-32`). 비밀번호를 웹이 받지 않는 규칙과 맞물린다 |

다른 보드는 `storage` 이벤트로 따라온다(`settings.js:57`, `docs.js:119-124`). 토큰은 저장하지 않는다(`api/terra-frame-client.js:10`).

#### 2.1.3 사용자 문서 (서버) — Terra C-1 `/api/v1/me/documents/{namespace}/{key}`

| 항목 | 값 | 근거 |
| --- | --- | --- |
| op | `terra.gateway.me.documents.by-namespace.by-key.put` (있는지로 사용 가능 판정) | `store/docs.js:12,25` |
| 이름공간 | `app:<앱 id>` — 앱 토큰이면 Gateway가 고정, 다른 이름공간 403 | `docs.js:4,21` |
| 키 | `layout/<node_id>`(노드마다) · `assets`(사람마다) | `docs.js:5-6` · `node-live.js:483` |
| 값 | `{version: 1, savedAt, data}` | `docs.js:7,50` |
| 동시성 | `base_revision`, 409면 한 번 알리고 덮는다(마지막 쓰기 승) | `docs.js:51-57` |
| 지연 | `DocStore.WAIT = 3000`ms, 자산은 2000ms, 닫힐 때 `keepalive` | `docs.js:18,63-73,121` |
| 실패 | 404 아닌 실패 → `state='off'`, 이 세션은 브라우저에만 | `docs.js:31-34` |
| 경로로 부르는 이유 | invoke로 부르면 앱 토큰 호출자가 빠진다(PF-10 · Terra#118) | `docs.js:10` |

v3 메모: 앱 id가 `lab.stellaxia.node-gui.web` → v3에서 바뀌면 이름공간이 달라져 옛 문서를 못 읽는다([[legacy-app-layer]] §5-5와 같은 결론).

#### 2.1.4 IndexedDB `terra.gui.parts` (v1)

| store | keyPath | 값 | 정책 | 근거 |
| --- | --- | --- | --- | --- |
| `meta` | `key` | `{key, sha, size, tid, at}` | 7일(`KEEP_MS`) 넘으면 열 때 치움 | `store/parts.js:3-13,41,49-56` |
| `chunks` | `[key, offset]` | `{key, offset, bytes}` | SHA-256 · 크기가 같을 때만 이어받기 | `parts.js:5-9,42` |
| key 형식 | `'<node_id>\|<공유 폴더>/<경로>'` | | | `parts.js:6` |

v3 노출: 읽기(“이 브라우저에 받아 둔 조각 n개 · 비우기” 정도) — 열린 질문.

#### 2.1.5 메모리 상태로만 있는 "설정"

| 항목 | 기본 | 근거 | 메모 |
| --- | --- | --- | --- |
| `prefs.start` (시작 화면) | `노드 화면` | `screens/settings.js:42,345` | **저장 안 됨** — 화면에는 "Scene persistent Store"라 적혀 있으나 실제 저장 코드 없음 |
| `prefs.refresh` (자동 새로 고침) | `10초` | `settings.js:42,346` | 저장 안 됨 · `pollSec`과 연결 안 됨 |
| 언어 · 라이트/다크 · 연결 대상 | 셸 · OS · 셸 지정 | `settings.js:347-350` | 바꿀 수 없음(표시만) |

#### 2.1.6 Scene Store (얇은 셸 Scene)

| Store | kind(수명) | 초기값 | 쓰는 Function | 웹으로 가나 | 근거 |
| --- | --- | --- | --- | --- | --- |
| `credentials` | `secret` | `{}` — `/session`에 Credential Handle | signin.submit `:55-60` · signout `:23-28` | 아니오(호스트가 handle을 따라 frame에 토큰) | `scene/contract/stores/credentials.store.json:2-6` |
| `session` | `memory` | `{state:'signedOut', principal:''}` | signin.submit · signout | **예** — `bind`로 `terra.frame.value` | `session.store.json:5-9` · `scene/surface/fragments/main.fragment.json:23-26` |
| `signin` | `view` | `{email, password, state, message}` | signin.field · submit · login.close · signout | 아니오(일부러 분리) | `signin.store.json:5-11` |

Scene 이벤트: 웹 → `login`(→ `/login` Route) · `logout`(→ `credential.revoke`) · `launch`(→ `terra.app:launch` 신호, 셸이 다른 앱을 연다) — `main.fragment.json:27-37`, `app.launch.function.json:11-17`.

#### 2.1.7 코드에 박힌 동작 값 (사용자 설정 아님, 그러나 v3가 지켜야 할 값)

| 값 | 기본 | 근거 |
| --- | --- | --- |
| frame `init` 대기 | 15000ms (참조 클라이언트 기본 5000) | `api/frame-boot.js:48` · `terra-frame-client.js:21` |
| SSE 재연결 | 1s → ×2 → 최대 30s, `last_event_id`. 401·403·404·406·501이면 끔 | `api/events.js:3-4,22,66,101` |
| 노드 카탈로그 캐시 | 60s | `api/client.js:31` |
| 409 NODE_OFFLINE 읽기 재시도 | 500·1000·1500·2000ms (쓰기는 안 함) | `client.js:56,198` |
| 모듈 설치 여부 캐시 | 15s | `api/module-gate.js:8` |
| 레이아웃 저장 모음 | 800ms | `store/layout.js:126` |
| Daemon 재시작 감시 | 1.5s 간격 · 90s 한도 · `/api/v1/health` | `data/settings-live.js:108-118` |
| 폴링 바닥 | `max(5000, pollMs)` · SSE 열리면 ×6 | `api/wire.js:37-38` |

잠금 규칙(`lockFor`)은 [[legacy-app-layer]] §3 L1~L4에 있다 — 판정 근거 `api/source.js:240-272`.

#### 2.1.8 계획만 있는 것 — 노드 데스크톱 · 터미널 감사

| 항목 | 결정 | 저장 위치(제안) | 근거 |
| --- | --- | --- | --- |
| 데스크톱 상태(배경 · 모양 · 창 배치 · 아이콘) | 노드 계정 문서 하나 + 편집 락(임대 · 하트비트 · 넘겨받기) | `.terra/desktop/<노드>.json` (기존 파일 op로 시작) — 미확정 | `web/docs/guides/node-desktop-concept.md:147,158-164,172` |
| 터미널 감사 기록 | 시각 · 계정 · 노드 · 명령 · 결과 코드, 덧붙이기만, 80% 경고 · 한도에서 오래된 것부터 밀어냄 | "수정할 수 없는 Terra 폴더" — 경로 · 한도 값 없음 | `node-desktop-concept.md:148,166-169,174` |
| 노드 창 열기 칸 | 모듈에서는 꺼 둠 | `nodeWinOn() → false` | `web/src/boot/fixes.js:48` |

### 2.2 노드 Daemon 설정 135키 (node-gui가 대신 편집하는 코어 설정)

- 키 표는 Daemon 스키마를 **옮긴 사본**이다(`web/src/screens/settings.js:12`). 실제 권위는 `terra.daemon.config.schema.get`(`fields[k].owner` · `restart_required`) — 읽으면 소유 · 반영을 다시 맞춘다(`data/settings-live.js:146-151`).
- 값: `terra.daemon.config.get` → 중첩을 점 키로(`flatten` `:26-36`), 기준선 차이 `deviations[]`(`:161`), `config_path`(`:159`).
- 저장: `terra.daemon.config.patch {set:{k:v}, save:true}` 키 하나씩, `*.enabled`는 마지막(`settings.js:218`, `settings-live.js:185-193`). 응답 `restart_required` → 재시작 대기 목록.
- 쓰기 권한 `node.config`★ — 앱 매니페스트에 없어 **기존 GUI에서는 늘 잠김**(§1.4).
- 객체 목록 키(예: 공유 폴더 `{name,path}`)는 읽기 전용(`settings-live.js:171-176`).
- 위험 키(접속 경로를 끊는다) — 두 번 확인: `gateway_service.enabled=false` · `local_api.enabled=false` · `gateway_service.dev_open=true` · `gateway_service.addr`(바꾸면) · `local_api.port`(바꾸면) (`settings.js:32-38`).
- tree 게이트웨이에는 `terra.daemon.config.*`가 없다 — leaf에서만 선다(`settings-live.js:286`). Master 설정은 HTTP API가 없다(`terra master config` CLI) (`:281-283`).

| 분류 | 키 수 | 소유: 운영자 / 설치기 / 파생 / 비밀 |
| --- | ---: | --- |
| 노드 (daemon · storage · logging) | 17 | 전체 합계 96 / 25 / 12 / 2 |
| Master 연결 (master · heartbeat · enrollment) | 15 | |
| 네트워크 (wireguard · mesh_vpn · direct_tcp · grpc · webrtc · 터널) | 47 | |
| 보안·API (security · local_api · gateway_service) | 17 | |
| 모듈·업데이트 (modules · 배포 · core · fleet) | 29 | |
| 런타임 (task_queue · feature) | 10 | |

**v3 노출 규칙**: 운영자 = 편집(node.config 있을 때), 설치기 · 파생 = 읽기, 비밀(`daemon.co_located_master.service_credential` · `gateway_service.master_service_credential`) = never(“API로 못 바꾼다”, 값은 숨김). 전체 키 표는 부록 A.

기능 플래그는 여기 `feature.*` 6개뿐이다(`enable_docker` 끔 · `enable_experimental` 끔 · `enable_io_gateway` 켬 · `enable_screen_share` 끔 · `enable_svi` 켬 · `enable_svi_test_stream` 켬). 모듈 쪽 기능 플래그는 `TERRA_NODETALK_FAULTS`(§3.1) 하나.

### 2.3 모듈 설정(manifest `configuration`) — 범용 길

| 단계 | 내용 | 근거 |
| --- | --- | --- |
| 선언 | `configuration.schema` (§1.2) | `schemas/manifest-v2.schema.json:139-150` |
| 저장 | 호스트 상태 루트 `module-config/<id>.json` `{module_id, schema_sha256, revision, values, updated_at, updated_by}` 0600 · 실효값 `<id>.effective.json` | `terra:…/terra-module-runtime/config_store.go:20-60` |
| 모듈이 읽음 | `TERRA_MODULE_CONFIG_FILE` | 같은 곳 `:58` |
| GUI op | `terra.daemon.modules.by-module-id.config.schema.get` · `.config.get` (node.read) · `.config.patch {values, unset, base_revision}` | `web/src/api/source.js:194-204` · `operations.js:341-349,367,409-420` |
| 비밀 칸 | 빈 값이면 보내지 않음(바꾸지 않음) | `operations.js:415` |
| 미선언 | `MODULE_CONFIG_UNDECLARED` | `source.js:196` |

**이 저장소의 모듈 중 `configuration`을 선언한 것은 0개**다. 그래서 v3의 `노드 창 › 모듈 › 설치된 모듈 › 설정` 칸은 지금 어떤 모듈에도 열리지 않는다. 대신 각 모듈은 아래 §2.4~§2.9처럼 env 또는 자체 op로 설정을 받는다.

### 2.4 `io.terra.agent` (0.3.0)

데이터 루트: `TERRA_AGENT_DATA_DIR`(벤치 전용) 또는 SDK `DataDir("io.terra.agent")` (`src/main.go:30-41`).

| 저장 | 모양 | 비밀 | 쓰는 op · CLI | v3 노출 |
| --- | --- | --- | --- | --- |
| `credentials.json` 0600 | `{principal, credential, delegate, permissions[], reach, expires_at, registered_ms, unattended, pre_approved[]}` (`src/credentials.go:25,33-45,173-180`) | `credential` | `credentials.put/get/delete` · `terra agent credential set --token-stdin` | 읽기(사실만 — 값 never) · 지우기 |
| `providers.json` 0600 | `{default, providers:{<name>:{provider, api_key, model, base_url}}}` (`src/providers.go:23,31-34,70-71`) | `api_key` | `models.put/list/delete` · `terra agent model add --api-key-stdin` | 읽기(모델 · 기본 · 가린 base_url) · 키 never |
| `mcp-servers.json` | `{servers:{<name>:{command, args, env, tools, registered_ms}}}` (`src/mcpregistry.go:32,77`) | `env` 값 | `mcp.put`(**agent.external**) · `mcp.list` · `mcp.delete` | 읽기(env 이름만, `mcpregistry.go:41-52`) |
| `sessions/` | 세션 메타 `{session_id, topic, state, autonomy, simulate, provider, model, owner, steps, max_steps, max_seconds, token_budget, mcp_servers…}` + 기록 (`src/session.go:71,137-165`) | — | `sessions.*` · `messages.*` · `runs.post` | 앱 자체 |

세션 단위 설정(열 때 고정):

| 키 | 타입 | 기본 | 범위 | 근거 |
| --- | --- | --- | --- | --- |
| `autonomy` | `plan`·`ask`·`auto`·`unattended` | `plan` | unattended는 mcp와 함께 못 씀 | `src/api.go:421-427` · `loop.go:90-114` |
| `max_steps` | int | 24 | 1~100 | `src/session.go:75-76` · `web/src/api/client.ts:59,62` |
| `max_seconds` (한 차례) | int | 900 | 1~7200 | `session.go:81-82` · `client.ts:60,63` |
| `token_budget` | int64 | 무제한 | — | `module.json:117-121` |
| `provider` · `model` | string | 기본 provider · `claude-opus-5` | — | `src/providers.go:58-61` |
| `simulate` | bool | false | — | `module.json:89-93` |
| `mcp_servers` | string[] | [] | 등록된 이름만 | `module.json:118-122` |

웹(`web/`): 셸 브리지 `terra.webapp.{hello,ready,request,response}` (`web/src/transport/bridge.ts:16-19`), 브리지 허용 경로 `/api/modules/` · `/api/nodes/`만(`transport/pipeline.ts:18`), 폴링 running 1s · 승인 대기 5s · idle 5s · 숨김 15s · 백오프 2s×2 최대 30s(`transport/poll.ts:21,29`). 설정 화면은 **읽기 전용**(`web/src/data/settings.ts:1`). 브라우저 저장 없음(`transport/token.ts:4`).

### 2.5 `io.terra.nodetalk` (0.1.0)

| 설정 | 출처 | 타입 · 기본 | 비고 | v3 노출 |
| --- | --- | --- | --- | --- |
| 노드 id | `TERRA_NODETALK_NODE_ID` → 없으면 `terra.node.identity.get` → `unknown` | string | 벤치 전용 env | 읽기 |
| 표시 이름 | `TERRA_NODETALK_DISPLAY_NAME` → identity `display_name` → id | string | | 읽기 |
| 데이터 디렉터리 | `TERRA_NODETALK_DATA_DIR` → SDK DataDir | path | | 읽기 |
| main 넘김 히스테리시스 | `TERRA_NODETALK_HANDOVER_HYSTERESIS_MS` | 2분 · 0=끔 | | 읽기 |
| 동기화 주기 | `TERRA_NODETALK_SYNC_INTERVAL_MS` | 10s · 최소 250ms | | 읽기 |
| 정착 시간 | `TERRA_NODETALK_SETTLE_MS` | 30s | | 읽기 |
| 고정 피어 | `TERRA_NODETALK_PEERS`(쉼표) **또는** `<data>/peers.json`(node id 배열) | [] | 실제 호스트 아래에서 통하는 것은 `peers.json`뿐 | **편집 후보** — 그러나 쓰는 op가 없다 |
| 결함 주입 표면 | `TERRA_NODETALK_FAULTS=1` | 꺼짐 → `faults.set`가 404 `FAULTS_NOT_AVAILABLE` | 개발 조립 전용 · 메모리만 | never |
| 문 호출 제한 | 상수 10000ms | | | — |

근거: `common/io.terra.nodetalk/src/main.go:40-58,68-127` · `src/sync.go:28-48,146-163` · `src/faults.go:22-60`.
UI(`ui/nodetalk.js:10,52,68,136`)는 브라우저 저장 없음, 원격 노드는 `/api/nodes/<node>/modules/io.terra.nodetalk/v1`.

### 2.6 `io.terra.file` (0.2.1, leaf)

| 설정 | 출처 | 기본 | 검증 | 근거 | v3 노출 |
| --- | --- | --- | --- | --- | --- |
| 조각 크기 | `TERRA_FILE_CHUNK_SIZE_BYTES` | 262144 | 1 ~ 655360(Gateway 1 MiB · base64), 넘으면 시작 실패 | `leaf/io.terra.file/src/main.go:32-49,92-110` | 읽기 |
| 전송 한도 | `TERRA_FILE_MAX_TRANSFER_MB` | 10240 | 잘못된 값은 기본 | `main.go:54-72` | 읽기 |
| 공유 루트 | 호스트가 주는 `TERRA_MODULE_SHARED_ROOTS`(JSON 배열) — 실제 원천은 Daemon `storage.shared_dirs` | 없으면 빈 목록 | 서명 등급 조건 | `main.go:9-13,74-89` | 편집은 노드 설정(`storage.shared_dirs`)에서 |
| 전송 기한 | 상수 TTL | 1시간 | | `src/transfer/transfer.go:111-146` | 읽기 |
| 전송 상태 | `<data>/transfers/<id>.json` | | | `transfer.go:148,164` | — |

### 2.7 `io.terra.io-inventory` (0.2.0, leaf)

| 저장 | 모양 | 쓰는 op | 근거 | v3 노출 |
| --- | --- | --- | --- | --- |
| `<data>/devices.json` | 장치 정책 `{device_id, alias, approval, enabled}` | approve · deny · enable · disable · alias.set · forget | `src/main.go:27-45` · `src/inventory/state_store.go:29-32` | 편집(노드 창 › 자원 › I/O 장치) |
| `<data>/manual-devices.json` | 손 등록 장치 | devices.add | `src/manual.go:246-248` | 편집 |
| 기본 슬롯 | `screen-default` · `camera-default` · `microphone-default` (권한 필요) | 코드 | `main.go:63-71` | 읽기 |
| 경로 재정의 | `TERRA_MODULE_STATE_DIR` | 손 실행 전용 | `main.go:30-39` | — |

장치 모양: `src/inventory/registry.go:77-91`. GUI는 모듈 op가 아니라 Daemon 대리 op `terra.daemon.io.devices.*`를 부른다(`data/settings-live.js:240-244`).

### 2.8 `io.terra.io-weave` (0.1.0, leaf) — 자체 설정 op를 가진 유일한 모듈

`<data>/settings.json` `{schema_version: 1, settings: {...}}` 0600, 원자적 교체(`src/weave/settings.go:105-193`).

| 키 | 타입 | 기본 | 값 | 근거 | v3 노출 |
| --- | --- | --- | --- | --- | --- |
| `profile` | enum | `shell` | `shell` · `tmux` (필수) | `settings.go:46-47,72-74` · 계약 `settings.set` 입력 | 편집 |
| `source_layout` | string ≥1 | `us` | | `settings.go:50,73` | 편집 |
| `injection` | enum | `off` | `off` · `auto` — 다른 기계가 이 기계 커서를 움직여도 되는가 | `settings.go:28-39,57,73` | 편집(위험 확인) |

op: `io.terra.io-weave.settings.get` · `settings.set`(PUT `/api/modules/io.terra.io-weave/v1/settings`). OS 측 설정: `config/install/linux/70-terra-uinput.rules`(그룹 `terra-input`, 0660) · `install-uinput-access.sh` · `uninstall-uinput-access.sh` — sudo로 손 실행, GUI 밖.

### 2.9 tree 모듈

| 모듈 | 설정 · 저장 | 근거 | v3 노출 |
| --- | --- | --- | --- |
| `io.terra.fleet` | 자체 저장 없음 — Master 코어 op(`terra.fleet.*`)를 대리. 주체는 `X-Terra-Principal` 머리글, API 접두 `/api/modules/io.terra.fleet/v1` | `tree/io.terra.fleet/src/api.go:17,23` · `ui/fleet.js:13` | 클러스터 관리(Fleet은 [[menu-hierarchy]] §5.4에서 설계 전) |
| `io.terra.treebench` | Master 주소 `TERRA_TREEBENCH_MASTER_URL`, 기본 `http://127.0.0.1:8080` | `src/main.go:25-35` | 읽기 |
| | 브라우저 `localStorage['treebench.ledger.v1']` — op별 실행 기록 | `ui/treebench.js:27,146-150` | — |
| | UI가 `/api/v1/auth/login`에 **email · password를 직접 보낸다**, 토큰 · device token · service credential을 메모리에 쥔다 | `ui/treebench.js:92-97,264-279,682-735,784` | never |

### 2.10 Scene 전용 모듈

| 모듈 | Store | 근거 |
| --- | --- | --- |
| `io.terra.scene.login-demo` | `credential`(secret `{}`) · `form`(view `{email,password}`) · `result`(view `{state:'idle',headline,detail}`) — `requiredOperations: []` | `common/io.terra.scene.login-demo/scene/contract/stores/*.json` |
| `lab.stellaxia.scene.hello` | 없음 | `common/lab.stellaxia.scene.hello/module.json:8` |
| `lab.stellaxia.scene.main-test` | 없음 — 웹은 호출하지 않아 권한도 없음 | `module.json:8` |
| `lab.stellaxia.gui-v3` | 없음 — `recoveryFragment: gui-v3.main` | `common/lab.stellaxia.gui-v3/scene/scene.json:10-13` |
| `dev.terrallo` · `io.terra.sample.window` | 설정 없음. sample.window는 UI 포트를 OS가 고른다(`127.0.0.1:0`), `window.health=/live`, `singleInstance` | `common/io.terra.sample.window/src/main.go:39-46` · `module.json:34` |

---

## 3. 환경 변수 · 플래그 · 포트 · 엔드포인트

### 3.1 모듈 프로세스가 읽는 환경 변수

**중요**: 모듈 호스트는 상속 환경을 허용 목록(PATH · TEMP · TMP · TMPDIR · HOME · USERPROFILE · PROGRAMDATA · APPDATA · LOCALAPPDATA · LANG · LANGUAGE · TZ · LC_* · SYSTEMROOT · WINDIR · COMSPEC · PATHEXT · NUMBER_OF_PROCESSORS · PROCESSOR_ARCHITECTURE)만 넘긴다(`terra:…/terra-module-host/process.go:98-110`). 아래 모듈 env는 **호스트 아래에서는 `legacy.environment`로만 들어간다**(§1.2) — 모듈 스스로도 "벤치 · 손 실행 전용"이라 적었다(`leaf/io.terra.io-weave/src/weave/settings.go:19-24`, `common/io.terra.nodetalk/src/sync.go:33-35`).

| 변수 | 모듈 | 타입 · 기본 | 근거 | 호스트 아래 효과 | v3 노출 |
| --- | --- | --- | --- | --- | --- |
| `TERRA_FILE_CHUNK_SIZE_BYTES` | file | int · 262144 | `leaf/io.terra.file/src/main.go:49` | 없음(legacy.environment 없으면) | 읽기 |
| `TERRA_FILE_MAX_TRANSFER_MB` | file | int · 10240 | `:57` | 없음 | 읽기 |
| `TERRA_MODULE_STATE_DIR` | io-inventory · io-weave | path | `leaf/io.terra.io-inventory/src/main.go:37` · `leaf/io.terra.io-weave/src/main.go:48` | 없음(호스트는 `TERRA_MODULE_DATA_DIR`을 준다) | — |
| `TERRA_AGENT_DATA_DIR` | agent | path | `common/io.terra.agent/src/main.go:30` | 없음 | — |
| `TERRA_NODETALK_NODE_ID` · `_DISPLAY_NAME` · `_DATA_DIR` · `_HANDOVER_HYSTERESIS_MS` | nodetalk | §2.5 | `common/io.terra.nodetalk/src/main.go:41-46` | 없음 | 읽기 |
| `TERRA_NODETALK_SYNC_INTERVAL_MS` · `_PEERS` · `_SETTLE_MS` | nodetalk | §2.5 | `src/sync.go:39-41` | 없음 | 읽기 |
| `TERRA_NODETALK_FAULTS` | nodetalk | `"1"`이면 켬 | `src/faults.go:30` | 없음 | never |
| `TERRA_TREEBENCH_MASTER_URL` | treebench | URL · `http://127.0.0.1:8080` | `tree/io.terra.treebench/src/main.go:31` | 없음 | 읽기 |
| `TERRA_TEST_WAIT_SCALE` | 시험(testkit · agent) | float, 잘못되면 panic | `internal/testkit/testwait/testwait.go:56,71` | — | — |
| `PATH` · `HOME` | agent MCP 자식 프로세스에 그대로 | | `common/io.terra.agent/src/mcpclient.go:155-170` | | — |

### 3.2 호스트가 모듈에 주는 환경 변수 (코어 소유)

| 변수 | 조건 | 근거 |
| --- | --- | --- |
| `TERRA_MODULE_ID` · `_VERSION` · `_DIR` · `_TARGET` | 늘 | `terra:…/terra-module-host/manager.go:808-811` |
| `TERRA_MODULE_DATA_DIR` | `permissions.storage: module-data` | `manager.go:795-800,812-814` |
| `TERRA_MODULE_SHARED_ROOTS` | `shared-roots` + 서명 등급 | `manager.go:815-827` |
| `TERRA_MODULE_CONFIG_FILE` | `configuration` 선언 | `terra:…/terra-module-runtime/config_store.go:58` |
| 신원 · 활성화: `TERRA_WORKLOAD_CREDENTIAL` · `TERRA_MODULE_HOST_ENDPOINT` · `TERRA_LOOPBACK_ENDPOINT` · `TERRA_INSTANCE_ID` · `TERRA_BOOTSTRAP_NONCE` · `TERRA_ACTIVATION_EPOCH` | 늘 — `modulesdk.FromEnv()` · `CoreFromEnv()`가 읽는다(terra-sdk) | 코어 소스 문자열에서 확인, 정확한 위치는 SDK — 미정독 |

값은 비밀(자격 · nonce)이다. v3: never.

### 3.3 웹 빌드 · 개발 환경 변수

| 변수 | 쓰는 곳 | 의미 | 근거 |
| --- | --- | --- | --- |
| `VITE_TERRA_DEV_TOKEN` | agent web | 개발 서버에서만 Bearer 토큰(프로덕션 번들에서 사라짐) | `common/io.terra.agent/web/src/transport/token.ts:71-80` |
| `VITE_TERRA_GATEWAY_URL` | agent web | 개발용 Gateway 주소 | `token.ts:75` |
| `PLAYWRIGHT_MODULE` · `CHROMIUM_PATH` · `NODE_PATH` · `DC_JS` · `PW_CHROMIUM` | e2e · 디자인 검사 · 스모크 | 브라우저 경로 | `io.terra.agent/web/e2e/lib/browser.mjs:12-34` · `web/design/checks/lib.mjs:15-24` · `lab.stellaxia.node-gui/web/tests/smoke.mjs:28` |
| Vite dev 포트 | 두 웹 모두 5173, `base: './'`(앱 자산은 `/api/v1/gui/apps/<앱 id>/files/` 아래) | | `lab.stellaxia.node-gui/web/vite.config.js:13-17` · `io.terra.agent/web/vite.config.ts:5-10` |

### 3.4 포트 · 주소

| 포트 · 주소 | 무엇 | 근거 | v3 노출 |
| --- | --- | --- | --- |
| `127.0.0.1:8787` | leaf Gateway (`gateway_service.addr` 기본) | `screens/settings.js:12`(키 표) · `:350` · `api/client.js:35` | 읽기(위험 키) |
| `127.0.0.1:8788` | tree Gateway | `screens/settings.js:350` · `client.js:35` | 읽기 |
| `127.0.0.1:8080` | tree Master 백엔드 | `tree/io.terra.treebench/src/main.go:25-28` | 읽기 |
| `17321` | Daemon 로컬 API (`local_api.port`) | 키 표 | 읽기(위험 키) |
| `17322` · `17323` · `17325` · `51820` | direct_tcp · mesh_vpn · grpc_transport · WireGuard | 키 표 | 편집(노드 설정) |
| `app-<id>.localhost:<Gateway 포트>` | 앱별 origin(저장소 · 프레임 격리) | `terra:…/terra-gateway-service/gui_apps.go:66-70` | — |
| `127.0.0.1:0` | window 앱 UI(OS가 고름) | `common/io.terra.sample.window/src/main.go:39-41` | — |
| 28080 · 28787 · 38787 | node-gui 실측 스크립트 전용 | `web/tools/live-*.mjs` | — |

### 3.5 Gateway 경로 (모듈 · GUI가 부르는 것)

| 경로 | 쓰임 | 인증 | 근거 |
| --- | --- | --- | --- |
| `GET /api/v1/catalog` | 호출자 권한으로 좁힌 operation 목록 | Bearer | `node-gui/web/src/api/client.js:62-68` · `treebench.js:218` |
| `POST /api/v1/operations/{id}/invoke` | 단일 호출 입구(평평한 입력) · SSE도 이 길 | Bearer | `api/events.js:74` · `nodetalk.js:68` · `treebench.js:316` |
| `GET /api/v1/nodes/{node_id}/catalog` · `POST /api/v1/nodes/{node_id}/operations/{id}/invoke` | 노드 주소 호출(Master 중계) | Bearer | `client.js:24-30,110` |
| `/api/modules/<모듈>/v1/…` | 모듈 자기 API (frame `apiBase`) | Bearer | `terra-frame-client.js:8,171` · 각 계약 bindings |
| `/api/nodes/<node>/modules/<모듈>/v1/…` | 원격 모듈 | Bearer | `client.js:208-220` · `nodetalk.js:52` |
| `/api/upstream/v1/…` | 상위 Master 패스스루(위임 28 op) | Bearer | `client.js:22` · `api/master-delegated.js:7-43` |
| `GET /api/v1/agent/whoami` | 주체 · 권한 · 위임 앱 · 만료 · reach | Bearer(경로로 — invoke면 호출자 빠짐) | `data/settings-live.js:129` |
| `GET /api/v1/health` | 공개 생존 확인 | 없음 | `settings-live.js:115` · `treebench.js:250` |
| `GET /api/v1/gui/apps` | 설치된 GUI 앱 목록 `{id, moduleId, route, origin, embed…}` | 공개 | `operations.js:205` |
| `/api/v1/gui/apps/<앱 id>/files/` | 앱 정적 자산 | — | `vite.config.js:13` |
| `GET/PUT /api/v1/me/documents/{ns}/{key}` | 사용자 문서 | Bearer | `store/docs.js:26` |
| `POST /api/v1/auth/login` | 비밀번호 로그인(treebench만) | — | `treebench.js:264` |

머리글: `Authorization: Bearer <앱 스코프 토큰>`(상대 경로 요청에만, `terra-frame-client.js:191-198`) · 모듈이 받는 `X-Terra-Principal` · `X-Terra-Subject` · `X-Terra-Delegate` · `X-Terra-Grants`(Gateway가 들어오는 `X-Terra-*`를 모두 벗기고 다시 찍는다, `terra:…/terra-module-runtime/caller_headers.go:12-31`) · agent 브리지의 `X-Terra-Scope-Permissions`(`io.terra.agent/web/src/transport/token.ts:9`).

### 3.6 창 간 메시지 (postMessage)

| 프로토콜 | 메시지 | 쓰는 앱 | 근거 |
| --- | --- | --- | --- |
| `terra.web/frame` v1 | `terra.frame.hello`(웹→, `*`로) · `.init{appId,moduleId,sceneId,apiBase,token,permissions,value,reason}` · `.token` · `.signedOut` · `.refresh` · `.value` · `.emit{event,value}` | node-gui · main-test | `node-gui/web/src/api/terra-frame-client.js:13-20,113-161` |
| 셸 WebApp 브리지 | `terra.webapp.hello` · `.ready` · `.request` · `.response` | agent | `io.terra.agent/web/src/transport/bridge.ts:16-19` |
| Scene 신호 | `terra.app:launch{appId}` | node-gui | `scene/contract/functions/app.launch.function.json:14` |
| 같은 origin 공유 | `window.__terraFrameReady` (시작 화면 → 노드 화면 → 보드) | node-gui | `api/frame-boot.js:31-58` |

### 3.7 Daemon 이벤트 신호 (SSE `terra.daemon.events.get`)

`terra.tasks.changed` · `terra.jobs.changed` · `terra.io.devices.changed` · `terra.modules.changed` · `terra.svi.{declarations,resources,handles,grants,bindings}.changed` · `terra.service-tunnels.changed` · `terra.wireguard.changed` · `terra.network.changed` · `terra.config.changed` — 신호 → 다시 읽을 앱 표 `api/events.js:11-19`. `terra.config.changed`는 지금 아무 앱도 다시 읽지 않는다(빈 배열) — v3 노드 설정 화면이 받아야 할 신호.

---

## 4. 스키마 · 계약 · 공용 타입

| 무엇 | 위치 | 설정 · 데이터 모양 | v3 쓰임 |
| --- | --- | --- | --- |
| Manifest v2 스키마 | `schemas/manifest-v2.schema.json` | §1 | 모듈 정보 화면 |
| 모듈 API 계약 9개 | `<module>/contracts/api/terra-api.json` | op마다 `bindings` · `availability.scopes` · `execution{risk, confirmation, idempotency, retry, timeoutMs}` · `security.permissions` · `input.schema` · `output` · `authoring` | 폼 생성 · 위험 확인 · 잠금 |
| Daemon 설정 스키마 | 코어 `terra.daemon.config.schema.get` (사본: `screens/settings.js:12`) | 135키 | 노드 설정 |
| 모듈 설정 스키마 | 코어 `…modules.by-module-id.config.schema.get` | 모듈별 — 지금 0 | 모듈 설정 |
| `internal/` | `testkit/{testwait, climanifest, svicheck}` | **설정 · 노드 · 트리 · 자원 모양의 공용 타입 없음** | — |
| node-gui 도메인 타입 | `web/src/model/types.js` (Permission 등 JSDoc) | 권한 · 노드 권한 | 재사용 후보 |

계약별 operation · 권한 요약:

| 계약 | contractVersion | op | 권한 | 설정 관련 op |
| --- | --- | ---: | --- | --- |
| dev.terrallo | 0.1.0 | 2 | 없음 | — |
| io.terra.agent | 0.1.0 | 19 | agent.use · mcp.put/delete = agent.external · status 공개 | credentials.* · models.* · mcp.* |
| io.terra.nodetalk | 0.3.0 | 15 | node.read / node.control | faults.set(dangerous) |
| io.terra.sample.window | 0.1.0 | 1 | 없음 | — |
| io.terra.file | 0.2.0 | 19 | file.read / file.write | — |
| io.terra.io-inventory | 0.2.0 | 16 | **전부 빈 권한** | approve · deny · enable · disable · alias · forget(dangerous) |
| io.terra.io-weave | 0.1.0 | 4 | **전부 빈 권한** | settings.get · **settings.set** |
| io.terra.fleet | 0.1.0 | 10 | node.read / node.control (scope cluster) | codes.issue · revoke |
| io.terra.treebench | 0.1.0 | 2 | 없음(scope local) | machine.invoke.post |

---

## 5. 도구 설정 (간단히)

| 항목 | 값 | 근거 |
| --- | --- | --- |
| npm 스크립트 | `validate` · `check:schema`(`--self-only`) · `build` · `test` · `test:tools` · `build:web` · `test:web` · `test:scenes` · `pack` · `release` | `package.json:6-17` |
| env | `TERRA_CHECKOUT`(build · test · test-scenes · pack · schema drift) · `TERRA_CLI` · `TERRA_REQUIRE_RACE=1` · `TERRA_MODULES_ROOT`(test-scenes가 넘김) · `GITHUB_ACTIONS` · `GITHUB_REF_NAME` · `GITHUB_REPOSITORY` · `GITHUB_TOKEN` · `GITHUB_API_URL` · `GITHUB_UPLOADS_URL` | `tools/*.mjs` (§3 grep 표) |
| 플래그 | `--terra` · `--target` · `--module` · `--require-race` · `--self-only` · `--allow-empty` · `--root` · `--cli` · `--out` · `--tag` · `--dist` · `--repo` · `--dry-run` | 같은 곳 |
| 포장 항목 | `module.json` · `contracts` · `ui` · `bin` · `config` · `scene` (개발 전용: `src` · `web` · `README.md` · `licenses` · `signature`) | `tools/validate-modules.mjs:33-36` |
| node-gui 웹 | `npm run gen`(`.dc.html` → 화면 생성) · `build` → `../ui` | `common/lab.stellaxia.node-gui/web/package.json` |

---

## 6. 어긋남 · 놀라운 점

| # | 내용 | 근거 | v3에 주는 뜻 |
| --- | --- | --- | --- |
| S-1 | **`configuration` 선언 모듈 0개** — 범용 모듈 설정 길(코어 저장 · 검증 · `TERRA_MODULE_CONFIG_FILE`)이 준비돼 있고 node-gui도 폼을 갖췄는데 쓰는 모듈이 없다 | §2.3 | "모듈 설정" 칸은 지금 늘 빈 상태. file · nodetalk의 env 설정을 `configuration`으로 옮기자고 제안할 만하다 |
| S-2 | **env로 받는 모듈 설정이 호스트 아래에서 닿지 않는다** — file 2 · nodetalk 7 · treebench 1 · agent 1. 호스트는 허용 목록만 넘긴다 | `terra:…/process.go:98-110` · `io-weave/src/weave/settings.go:19-24` | v3가 이것들을 "편집"으로 보이면 거짓말이 된다 — 읽기(기본값)만, 또는 숨김 |
| S-3 | **`node.config`가 앱 매니페스트에 없다**(Q-10 의도) → 기존 GUI의 노드 설정 135키 · SVI 선언 쓰기가 늘 잠김 | `node-gui/module.json:33-42` · `real-data-layer.md:686` | v3도 같은 결정이면 노드 설정은 사실상 읽기 화면. 메뉴 설계(§5.3 "저장 막대 · 재시작 대기")와 충돌 |
| S-4 | io-weave `settings.set`(원격 포인터가 이 기계 커서를 움직이는 `injection`)과 io-inventory 장치 승인 op의 계약 권한이 **빈 배열** | §4 표 | v3는 자체 확인(위험 · 두 번 누르기)을 두고, 권한 공백을 Terra에 묻는다 |
| S-5 | 버전 어긋남 — file 모듈 0.2.1 · capability 0.1.0 · 계약 0.2.0 / nodetalk 모듈 0.1.0 · 계약 0.3.0 / agent 모듈 0.3.0 · 계약 0.1.0 | 각 `module.json` · 계약 | "버전" 하나로 보이지 말고 모듈 · 계약을 따로 |
| S-6 | `TERRA_MODULE_STATE_DIR`(io-inventory · io-weave)는 호스트가 주지 않는 이름 — 호스트는 `TERRA_MODULE_DATA_DIR` | §3.1 | 문서 정리 대상 |
| S-7 | `appTitle`은 읽는 곳이 없다 · `prefs.start/refresh`는 저장되지 않고 화면 글은 "Scene persistent Store"라 적는다 · `terra.gui.autoLogin`은 모듈 판에서 no-op | §2.1.1 · §2.1.5 · `intro-live.js:31` | v3 "이 기기 설정"에서 버리거나 실제로 저장 |
| S-8 | 공유 폴더 설정 키 이름이 한 카드 안에서 둘 — `storage.shared_dirs`(sub) · `modules.shared_roots`(빈 줄 문구) | `data/settings-live.js:226-227` | 정본은 키 표의 `storage.shared_dirs` |
| S-9 | 프로토콜이 둘 — node-gui는 `terra.frame.*`(Scene embed), agent는 `terra.webapp.*`(셸 브리지) | §3.6 | v3는 embed=scene이면 frame 프로토콜 |
| S-10 | treebench UI는 비밀번호 · device token · service credential을 웹에서 받는다(시험 콘솔) — node-gui의 "웹은 비밀번호를 받지 않는다"와 반대 | `treebench.js:264-279,784` | v3는 따라 하지 않는다 |
| S-11 | treebench는 Master에 직접 HTTP로 닿는데 `permissions.network`도 `permissions` 자체도 없다 | `tree/io.terra.treebench/module.json` · `src/main.go:25-35` | — |
| S-12 | `terra.config.changed` 신호를 받아도 다시 읽는 앱이 없다 | `api/events.js:18` | v3 노드 설정은 이 신호로 다시 읽는다 |
| S-13 | 검증기 주석은 "출하 모듈 21개"라 하나 이 저장소는 14개 | `tools/validate-modules.mjs:157` | 무해 |
| S-14 | frame 대기 15s(웹) · 셸 handshake 10s(개요 문서) · 참조 클라이언트 기본 5s — 세 숫자 | `frame-boot.js:48` · [[legacy-node-gui-overview]] §5 | v3는 hello를 첫 import에서 보내고 15s 대기 유지 |

---

## 7. 열린 질문

| ID | 질문 | 판단 재료 |
| --- | --- | --- |
| Q-C1 | v3 앱 매니페스트에 `node.config`를 넣을까(Q-10 재검토)? 넣지 않으면 노드 설정 화면은 읽기 전용 + "CLI에서 바꾼다" 안내로 줄인다 | S-3 |
| Q-C2 | file · nodetalk의 env 설정을 `configuration.schema`로 옮기자고 각 모듈에 제안할까? 그 전까지 v3는 그 값을 어디서 읽나(지금은 읽는 op도 없다 — status에 싣는지 확인 필요) | S-1 · S-2 |
| Q-C3 | `layoutStore`(server · local · none)를 사용자가 고르는 "이 기기 설정"으로 내릴까, 포장 설정으로 둘까? 메뉴 설계 §5.6은 사용자 선택으로 그렸다 | §2.1.1 |
| Q-C4 | v3 앱 id가 바뀌면 사용자 문서 이름공간(`app:<앱 id>`)이 바뀐다 — 옛 `layout/<node_id>` · `assets`를 옮길까, 버릴까? 앱 토큰은 다른 이름공간을 403으로 막는다 | §2.1.3 |
| Q-C5 | "이 기기 설정"의 저장소 — 앱 origin `localStorage`(기존)인가, 사용자 문서(기기 무관)인가? 도움말 · 투명도 · 새로 고침 · 움직임 줄이기 각각 | §2.1.2 · [[menu-hierarchy]] §5.6 |
| Q-C6 | IndexedDB 받기 조각(`terra.gui.parts`)을 사용자에게 보일까(용량 · 비우기)? 7일 보관을 설정으로 둘까 | §2.1.4 |
| Q-C7 | 노드 데스크톱 상태 · 편집 락 · 터미널 감사 기록의 저장소 — 전용 operation이 생기는지, 파일(`.terra/desktop/<노드>.json`)로 시작하는지, 감사 한도 값은 무엇인지 | §2.1.8 |
| Q-C8 | io-weave `injection` · io-inventory 승인처럼 계약 권한이 빈 위험 설정을 v3에서 어떤 권한으로 잠글까(node.control? node.config?) | S-4 |
| Q-C9 | nodetalk `peers.json` — GUI에서 고칠 길(op)이 없다. 노드 설정 화면에 둘 필요가 있나 | §2.5 |
| Q-C10 | agent 설정(모델 · MCP · 위임 자격)을 v3 노드 창 › 모듈 › agent 앱에 맡길지, v3가 직접 읽기 화면을 둘지. `agent.external` 없이 MCP 등록은 불가 | §2.4 · §1.4 |
| Q-C11 | `session.identity` · `process.execute.delegated` 권한은 셸 쪽 의미 — v3도 선언해야 하나 | §1.4 |
| Q-C12 | 위험 키 5개(`gateway_service.*` · `local_api.*`)를 v3에서 편집 가능하게 둘까, 읽기로 내릴까 | §2.2 |

---

## 부록 A. Daemon 설정 135키 (사본 — 권위는 `terra.daemon.config.schema.get`)

출처: `common/lab.stellaxia.node-gui/web/src/screens/settings.js:12` 의 `GROUPS`. 값(기본값 열)은 스키마 문서의 기본값이며, 비밀 키 값은 싣지 않는다.


#### 노드 (daemon · storage · logging) — 17키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `daemon.capabilities` | 목록 | 운영자 | 즉시 | — | — | 로컬 노드가 광고하는 capability 목록 |
| `daemon.data_dir` | 문자열 | 설치기 | 재시작 | `~/.terra` | 필수 | 데이터 디렉터리 |
| `daemon.device_name` | 문자열 | 운영자 | 즉시 | `""` | — | 노드 표시 이름 |
| `daemon.environment` | 문자열 | 운영자 | 재시작 | `prod` | `dev`·`test`·`prod` | 실행 환경. prod면 보안 규칙이 강해진다 |
| `daemon.node_id` | 문자열 | 파생 | 재시작 | `""` | — | Master가 등록 때 발급한 노드 id |
| `daemon.roles` | 목록 | 파생 | 즉시 | — | — | 설치된 구성요소가 정하는 역할 목록 |
| `daemon.runtime_mode` | 문자열 | 운영자 | 재시작 | `service` | `foreground`·`service`·`dev` | 실행 방식 |
| `storage.cache_dir` | 문자열 | 설치기 | 재시작 | `~/.terra/cache` | — | 캐시 디렉터리 |
| `storage.data_dir` | 문자열 | 설치기 | 재시작 | `~/.terra` | 필수 | 저장소 데이터 디렉터리 |
| `storage.shared_dirs` | 목록 | 운영자 | 재시작 | `~/TerraShare` | — | 공유 폴더 목록 — `io.terra.file`이 여는 루트 |
| `storage.temp_dir` | 문자열 | 설치기 | 재시작 | `~/.terra/tmp` | — | 임시 디렉터리 |
| `logging.file_enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 파일로 남기기 |
| `logging.format` | 문자열 | 운영자 | 재시작 | `json` | `json`·`text` | 로그 형식 |
| `logging.level` | 문자열 | 운영자 | 즉시 | `info` | `debug`·`info`·`warn`·`warning`·`error` | 로그 수준 |
| `logging.log_dir` | 문자열 | 설치기 | 재시작 | `~/.terra/logs` | — | 로그 디렉터리 |
| `logging.max_backups` | 정수 | 운영자 | 재시작 | `5` | ≥ 0 | 보관할 이전 파일 수 |
| `logging.max_size_mb` | 정수 | 운영자 | 재시작 | `10` | ≥ 1 | 파일 하나의 최대 크기(MB) |

#### Master 연결 (master · heartbeat · enrollment) — 15키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `master.reconnect` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 끊기면 다시 연결 |
| `master.reconnect_initial_delay_ms` | 정수 | 운영자 | 재시작 | `1000` | ≥ 0 | 재연결 첫 대기(ms) |
| `master.reconnect_max_delay_ms` | 정수 | 운영자 | 재시작 | `30000` | ≥ 첫 대기 | 재연결 최대 대기(ms) |
| `master.request_timeout_sec` | 정수 | 운영자 | 재시작 | `10` | ≥ 1 | Master 요청 제한 시간(초) |
| `master.url` | 문자열 | 운영자 | 재시작 | `""` | 절대 URL, `ws`·`wss`·`http`·`https`. prod + `security.require_tls` + runtime≠dev면 `wss`·`https`만. 필수 | 상위 Master 주소 |
| `heartbeat.interval_sec` | 정수 | 운영자 | 재시작 | `10` | ≥ 1 | heartbeat 주기(초) |
| `heartbeat.timeout_sec` | 정수 | 운영자 | 재시작 | `5` | 1 ~ 주기 | heartbeat 응답 제한(초) |
| `enrollment.enabled` | 켜기/끄기 | 설치기 | 재시작 | 켬 | 켜면 `enrollment.state_path` 필수 | 등록 기능을 이 설치가 가졌는가 |
| `enrollment.image_digest` | 문자열 | 파생 | 재시작 | — | `TERRA_IMAGE_DIGEST`가 우선 | 이 멤버가 부팅한 이미지 digest |
| `enrollment.instance_key` | 문자열 | 운영자 | 재시작 | — | `TERRA_INSTANCE_KEY`가 우선 | Fleet 안의 고정 신원 — 재시작 때 같은 자리를 다시 쓰는가를 정한다 |
| `enrollment.join_code_path` | 문자열 | 운영자 | 재시작 | — | `TERRA_JOIN_CODE`가 우선 | Fleet 가입 코드 파일 경로 — 코드는 파일에만 둔다 |
| `enrollment.state_path` | 문자열 | 설치기 | 재시작 | `~/.terra/registration.json` | — | 등록 상태 파일 |
| `daemon.co_located_master.base_url` | 문자열 | 설치기 | 재시작 | — | 루프백 | 같은 기계의 Master 주소 — tree 역할도 가진 노드만 |
| `daemon.co_located_master.request_timeout_sec` | 정수 | 운영자 | 재시작 | — | — | 그 Master 호출 제한 시간(초) |
| `daemon.co_located_master.service_credential` | 문자열 | 비밀 | 재시작 | (숨김) | API로 못 바꾼다 | 그 Master에 대한 Core-peer 자격 |

#### 네트워크 (wireguard · mesh_vpn · direct_tcp · grpc · webrtc · 터널) — 47키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `wireguard.address_cidr` | 문자열 | 파생 | 재시작 | `""` | managed면 CIDR. 등록·동기화가 켜져 있으면 비워도 된다 | 로컬 노드의 mesh 주소 — Master 네트워크 계획이 준다 |
| `wireguard.advertise_endpoint` | 문자열 | 운영자 | 재시작 | — | — | 다른 노드에 알릴 endpoint |
| `wireguard.auto_install` | 켜기/끄기 | 설치기 | 재시작 | 끔 | — | WireGuard 자동 설치 |
| `wireguard.auto_up` | 켜기/끄기 | 설치기 | 재시작 | 끔 | managed에서 주소가 없고 동기화도 없으면 켤 수 없다 | 인터페이스 자동 올림 |
| `wireguard.desired_sync_interval_sec` | 정수 | 운영자 | 재시작 | `60` | ≥ 0 | Master desired 설정 동기화 주기(초) |
| `wireguard.enabled` | 켜기/끄기 | 운영자 | 재시작 | 끔 | 켜면 `interface_name`·`private_key_path` 필수 | WireGuard 통합 켜기 |
| `wireguard.endpoint_refresh_interval_sec` | 정수 | 운영자 | 재시작 | `60` | ≥ 0 | endpoint 갱신 주기(초) |
| `wireguard.install_policy` | 문자열 | 설치기 | 재시작 | `optional` | `optional`·`required` | WireGuard 설치가 필수인가 |
| `wireguard.interface_name` | 문자열 | 운영자 | 재시작 | `terra0` | — | 인터페이스 이름 |
| `wireguard.listen_port` | 정수 | 운영자 | 재시작 | `51820` | 0 ~ 65535 | 수신 포트 |
| `wireguard.mode` | 문자열 | 설치기 | 재시작 | `external` | `external`·`managed` | WireGuard 운영 방식 — managed는 권한 헬퍼가 필요해 재설치로만 바꾼다 |
| `wireguard.mtu` | 정수 | 운영자 | 재시작 | `1420` | 0 또는 ≥ 576 | MTU |
| `wireguard.nat_gateway` | 문자열 | 운영자 | 재시작 | — | IP 주소. 비면 자동 | 매핑을 요청할 게이트웨이 |
| `wireguard.nat_mapping_lifetime_sec` | 정수 | 운영자 | 재시작 | `3600` | auto면 ≥ 60 | 매핑 수명(초) |
| `wireguard.nat_mapping_mode` | 문자열 | 운영자 | 재시작 | `auto` | `auto`·`disabled` | 공유기 포트 매핑 시도 |
| `wireguard.nat_mapping_protocols` | 목록 | 운영자 | 재시작 | `nat-pmp, pcp, upnp` | `nat-pmp`·`pcp`·`upnp`, auto면 1개 이상, 중복 불가 | 포트 매핑 프로토콜 |
| `wireguard.nat_probe_timeout_ms` | 정수 | 운영자 | 재시작 | `2000` | auto면 ≥ 1 | 매핑 탐침 제한(ms) |
| `wireguard.persistent_keepalive_sec` | 정수 | 운영자 | 재시작 | `25` | ≥ 0 | keepalive(초) |
| `wireguard.private_key_path` | 문자열 | 설치기 | 재시작 | `""` | — | WireGuard 개인키 파일 |
| `wireguard.privileged_helper_path` | 문자열 | 설치기 | 재시작 | — | — | 권한 헬퍼 경로 |
| `wireguard.privileged_helper_timeout_sec` | 정수 | 운영자 | 재시작 | `30` | 헬퍼가 있으면 ≥ 1 | 권한 헬퍼 제한(초) |
| `wireguard.stun_servers` | 목록 | 운영자 | 재시작 | — | — | 공인 주소를 찾을 STUN 서버 |
| `wireguard.stun_timeout_ms` | 정수 | 운영자 | 재시작 | `2000` | STUN 서버가 있으면 ≥ 1 | STUN 제한(ms) |
| `mesh_vpn.adapter` | 문자열 | 파생 | 재시작 | `wireguard` | `wireguard`·`tailscale` 등. tcp·websocket·webrtc 불가 | mesh 어댑터 |
| `mesh_vpn.advertise_host` | 문자열 | 파생 | 재시작 | `""` | `0.0.0.0`·`::` 불가 | mesh로 알릴 주소 |
| `mesh_vpn.connect_timeout_ms` | 정수 | 운영자 | 재시작 | `5000` | 켜져 있으면 ≥ 1 | mesh 연결 제한(ms) |
| `mesh_vpn.enabled` | 켜기/끄기 | 파생 | 재시작 | 끔 | 켜면 adapter·listen·advertise·network_id·timeout 필수 | mesh 도달 endpoint를 광고한다 |
| `mesh_vpn.listen_host` | 문자열 | 운영자 | 재시작 | `0.0.0.0` | — | mesh 리스너 주소 |
| `mesh_vpn.mode` | 문자열 | 파생 | 재시작 | `external` | `external`·`managed`(managed는 wireguard만, `wireguard.enabled` 필요) | mesh 운영 방식 |
| `mesh_vpn.network_id` | 문자열 | 파생 | 재시작 | `""` | — | mesh 네트워크 id |
| `mesh_vpn.peer_id` | 문자열 | 파생 | 재시작 | `""` | — | mesh 안의 로컬 노드 id |
| `mesh_vpn.port` | 정수 | 운영자 | 재시작 | `17323` | 0 ~ 65535 | mesh 리스너 포트 |
| `direct_tcp.advertise_host` | 문자열 | 운영자 | 재시작 | `""` | `0.0.0.0`·`::` 불가 | 다른 노드가 붙을 주소 |
| `direct_tcp.connect_timeout_ms` | 정수 | 운영자 | 재시작 | `5000` | ≥ 1 | 연결 제한(ms) |
| `direct_tcp.enabled` | 켜기/끄기 | 운영자 | 재시작 | 끔 | 켜면 listen·advertise·port·timeout 필수 | LAN 직접 연결 리스너(TLS·route ticket) — 포트가 열린다 |
| `direct_tcp.listen_host` | 문자열 | 운영자 | 재시작 | `0.0.0.0` | — | 리스너 주소 |
| `direct_tcp.port` | 정수 | 운영자 | 재시작 | `17322` | 1 ~ 65535 | 리스너 포트 |
| `grpc_transport.advertise_host` | 문자열 | 운영자 | 재시작 | `""` | — | 다른 노드가 붙을 주소 |
| `grpc_transport.connect_timeout_ms` | 정수 | 운영자 | 재시작 | `5000` | — | 연결 제한(ms) |
| `grpc_transport.enabled` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | 같은 세션을 gRPC로 나르는 리스너 — 포트가 열린다 |
| `grpc_transport.listen_host` | 문자열 | 운영자 | 재시작 | `0.0.0.0` | — | 리스너 주소 |
| `grpc_transport.port` | 정수 | 운영자 | 재시작 | `17325` | — | 리스너 포트 |
| `webrtc.connect_timeout_ms` | 정수 | 운영자 | 재시작 | `15000` | 켜져 있으면 ≥ 1 | 연결 제한(ms) |
| `webrtc.enabled` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | 서비스 터널의 WebRTC P2P 경로 |
| `webrtc.stun_servers` | 목록 | 운영자 | 재시작 | — | — | STUN 서버 |
| `service_tunnels.enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | Master에 선언된 터널을 로컬 노드가 연다 — 무엇을 열지는 Master가 정한다 |
| `service_tunnels.reconcile_interval_sec` | 정수 | 운영자 | 재시작 | — | 0 = 기본값 | 선언 조회 주기(초) |

#### 보안·API (security · local_api · gateway_service) — 17키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `security.device_token_path` | 문자열 | 설치기 | 재시작 | `~/.terra/token.json` | — | 장치 토큰 파일 |
| `security.private_key_path` | 문자열 | 설치기 | 재시작 | `~/.terra/keys/device_private.key` | — | 장치 개인키 파일 |
| `security.public_key_path` | 문자열 | 설치기 | 재시작 | `~/.terra/keys/device_public.key` | — | 장치 공개키 파일 |
| `security.require_tls` | 켜기/끄기 | 운영자 | 재시작 | 켬 | prod·비개발 모드면 `master.url`이 `wss`·`https`여야 한다 | Master 연결에 TLS를 요구 |
| `local_api.auth_token_path` | 문자열 | 설치기 | 재시작 | `~/.terra/local_api_token` | — | 로컬 API 토큰 파일 |
| `local_api.bind_host` | 문자열 | 운영자 | 재시작 | `127.0.0.1` | prod에서 `0.0.0.0` 금지 | 로컬 API 바인드 주소 |
| `local_api.enable_debug` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | `/debug/*` 경로 켜기 |
| `local_api.enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 로컬 API 켜기 — Gateway·CLI가 이것으로 데몬에 닿는다 |
| `local_api.port` | 정수 | 운영자 | 재시작 | `17321` | 1 ~ 65535. 생성 엔드포인트 표와 묶여 있다(§9-8) | 로컬 API 포트 |
| `local_api.require_auth` | 켜기/끄기 | 운영자 | 재시작 | 켬 | prod에서 끌 수 없다 | 로컬 API에 토큰 요구 |
| `local_api.shutdown_timeout_sec` | 정수 | 운영자 | 재시작 | `5` | ≥ 1 | 종료 대기(초) |
| `gateway_service.addr` | 문자열 | 운영자 | 재시작 | `127.0.0.1:8787` | 생성 엔드포인트 표와 묶여 있다(§9-8) | Gateway 주소 |
| `gateway_service.binary_path` | 문자열 | 설치기 | 재시작 | — | 비면 데몬 옆 | Gateway 실행 파일 경로 |
| `gateway_service.dev_open` | 켜기/끄기 | 운영자 | 재시작 | — | 운영에서 켜지 않는다 | 모든 호출자에게 모든 권한 — **개발 전용** |
| `gateway_service.enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 로컬 노드의 Gateway를 띄운다 |
| `gateway_service.ipc` | 문자열 | 파생 | 재시작 | — | 비면 데이터 디렉터리에서 파생 | 모듈 게시 IPC 주소 |
| `gateway_service.master_service_credential` | 문자열 | 비밀 | 재시작 | (숨김) | API로 못 바꾼다 | Gateway의 Core-peer 자격 |

#### 모듈·업데이트 (modules · 배포 · core · fleet) — 29키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `modules.allow_tree_override` | 켜기/끄기 | 설치기 | 재시작 | — | — | 이미지에 구운 모듈과 Tree 배포본이 겹치면 Tree 쪽을 살린다 — 이미지 빌드 결정 |
| `modules.auto_start` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 발견한 모듈을 자동 기동 |
| `modules.directories` | 목록 | 설치기 | 재시작 | — | — | 모듈을 찾는 디렉터리 |
| `modules.enabled` | 켜기/끄기 | 설치기 | 재시작 | 켬 | 켜면 `modules.directories` 필수 | 모듈 호스트를 이 설치가 가졌는가 |
| `modules.gateway_ipc` | 문자열 | 파생 | 재시작 | — | 비면 데이터 디렉터리에서 파생 | Gateway에 route를 게시하는 IPC 주소 |
| `modules.managed_directories` | 목록 | 설치기 | 재시작 | — | — | Tree 배포가 설치하는 디렉터리 |
| `modules.max_restarts` | 정수 | 운영자 | 재시작 | `3` | ≥ 0 | 모듈 최대 재시작 횟수 |
| `modules.require_executable_hash` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 모듈 실행 파일 해시 검사 |
| `modules.rescan_interval_sec` | 정수 | 운영자 | 재시작 | — | 0 = 시작 때 한 번 | 모듈 디렉터리 재스캔 주기(초) |
| `modules.restart_backoff_ms` | 정수 | 운영자 | 재시작 | `1000` | ≥ 0 | 모듈 재시작 간격(ms) |
| `modules.state_dir` | 문자열 | 설치기 | 재시작 | — | — | 설치 기록 디렉터리 |
| `modules.stop_timeout_sec` | 정수 | 운영자 | 재시작 | `10` | ≥ 1 (모듈 호스트가 켜져 있을 때) | 모듈 정지 대기(초) |
| `modules.strict_module_signing` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | 서명 없는 모듈도 격리 — Terra 서명 모듈만 돈다 |
| `module_distribution.allow_dev_install` | 켜기/끄기 | 운영자 | 재시작 | — | — | 서명 없는(개발 신뢰) 패키지 자동 설치 허용 — 시험대 전용 |
| `module_distribution.disk_quota_mb` | 정수 | 운영자 | 재시작 | — | 0 = 무제한 | 관리 모듈 디스크 상한(MB) |
| `module_distribution.enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | Tree의 모듈 배포를 받는다 |
| `module_distribution.poll_interval_sec` | 정수 | 운영자 | 재시작 | — | 0 = Tree가 보낸 lease 주기(최소 60초) | 배포 조회 주기(초) |
| `core_distribution.allow_apply` | 켜기/끄기 | 운영자 | 재시작 | — | — | 코어 교체 허용 — 끄면 바이트만 받고 교체는 손으로 |
| `core_distribution.disk_quota_mb` | 정수 | 운영자 | 재시작 | `4096` | 0 = 무제한 | 스테이징 디스크 상한(MB) |
| `core_distribution.enabled` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | 코어 릴리스를 받아 스테이징한다 |
| `core_distribution.hold` | 켜기/끄기 | 운영자 | 재시작 | — | — | 스테이징을 거부한다 — 거부 사실은 Tree에 보고된다 |
| `core_distribution.hold_reason` | 문자열 | 운영자 | 재시작 | — | 비면 기본 문구 | 거부 사유 |
| `core_distribution.maintenance_window` | 문자열 | 운영자 | 재시작 | — | `HH:MM-HH:MM` 로컬 시각, 자정 넘김 가능. 비면 언제든 | 릴리스 적용을 허용하는 시간대 |
| `core_distribution.poll_interval_sec` | 정수 | 운영자 | 재시작 | — | 0 = 기본값 | 조회 주기(초) |
| `core_distribution.role` | 문자열 | 운영자 | 재시작 | — | 비면 `terra`(통합 번들) | 받을 릴리스 번들 |
| `fleet_host.docker_binary` | 문자열 | 운영자 | 재시작 | — | 비면 PATH | docker CLI 경로 |
| `fleet_host.enabled` | 켜기/끄기 | 설치기 | 재시작 | 끔 | — | Fleet 컨테이너 호스트 역할 |
| `fleet_host.poll_interval_sec` | 정수 | 운영자 | 재시작 | — | 0 = 30초 | 조회 주기(초) |
| `fleet_host.stop_timeout_sec` | 정수 | 운영자 | 재시작 | — | — | `docker stop` 대기(초) |

#### 런타임 (task_queue · feature) — 10키
| 키 | 타입 | 소유 | 반영 | 기본값 | 제약 | 뜻 |
| --- | --- | --- | --- | --- | --- | --- |
| `task_queue.default_timeout_sec` | 정수 | 운영자 | 재시작 | `300` | ≥ 1 | 작업 기본 제한 시간(초) |
| `task_queue.max_queue_size` | 정수 | 운영자 | 재시작 | `1024` | ≥ 1 | 대기열 최대 길이 |
| `task_queue.max_retry_count` | 정수 | 운영자 | 재시작 | `3` | ≥ 0 | 재시도 횟수 |
| `task_queue.worker_count` | 정수 | 운영자 | 재시작 | `4` | ≥ 1 | 동시에 도는 작업 수 |
| `feature.enable_docker` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | Docker 기능 |
| `feature.enable_experimental` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | 실험 기능 |
| `feature.enable_io_gateway` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | I/O 게이트웨이 기능 |
| `feature.enable_screen_share` | 켜기/끄기 | 운영자 | 재시작 | 끔 | — | 화면 공유 기능 |
| `feature.enable_svi` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | SVI 기능 |
| `feature.enable_svi_test_stream` | 켜기/끄기 | 운영자 | 재시작 | 켬 | — | SVI 시험 스트림 자원 — 발견만 되고 여는 데는 Grant가 필요하다 |

## 관련 문서

- [[settings-inventory|GUI v3 설정 종합]]
- [[settings-terra-core|Terra 코어 설정 전수표]]
