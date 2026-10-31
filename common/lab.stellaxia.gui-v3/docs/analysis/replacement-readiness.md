---
title: "node-gui 대체 준비도 — 현황 점검 · 기능 격차 · Terra 쪽 같이 바꿀 것"
aliases:
  - "node-gui 대체 준비도"
  - "gui-v3 replacement readiness"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-31"
language: "ko-KR"
based_on: "Terra origin/main 5c6ace6c · modules origin/main 19d713d(2026-10-31). 0.2.0 .tmod 검사(코어 세션, Terra 1f0b569b)와 0.3.0 격리 스택 실측(이 문서 §5)을 합쳤다"
related:
  - "[[main-scene|main Scene]]"
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[legacy-node-gui-overview|node-gui 개요]]"
---

# node-gui 대체 준비도

사용자의 목표는 node-gui(`lab.stellaxia.node-gui`)를 gui-v3 로 **완전히 대체**하는 것이다. 0.3.0 은 그 첫 문턱 —
**main GUI 로 실리는 것** — 만 넘긴다. 이 문서는 (1) 최근 코어·모듈 변화에 맞춘 현황, (2) 아직 남은 기능 격차,
(3) 대체하는 날 Terra 쪽에서 같이 바꿀 것을 적는다. 구현 계획이 아니라 점검표다.

## 1. 현황 점검 — 낡았던 가정

이 모듈의 문서·README 는 디자인 중심 작업에서 이어져 10/19 이후의 코어 변화가 반영돼 있지 않았다.

| 낡은 가정 (문서·0.2.0) | 지금 (origin/main) | 어떻게 맞췄나 |
| --- | --- | --- |
| 앱은 "셸의 앱 목록"에서 열면 A 모드로 돈다 | 런처는 10/19 에 없어졌고 진입은 base → main(Terra #246 의 `terra-gui.exe`). 앱 목록은 runtime-core 의 WebAppDock 이고 **앱을 화면 안 창으로 연다**(#244 설계 · #247 구현). dock 은 `terra.webapp.hello/ready/request` 브리지만 알고, gui-v3 웹은 `terra.frame.*`(terra.web/frame 규약)만 알아 **dock 에서 열면 토큰을 영영 못 받는다**(격리 스택 실측) | main Scene 선언 + 앱 `embed:"scene"`(embed 앱은 dock 에 나오지 않는다). README 의 '열기' 표 고침 |
| main 은 사용자가 정한다 | **모듈 선언**만 정한다 — `contributions.gui.scenes[].branch:"main"`. main 1개면 곧장, 2개 이상·dev 있으면 고르는 화면, 0개면 MAIN_NOT_FOUND | 0.3.0 module.json. 격리 스택으로 세 경우 확인(§5) |
| 모듈 설치·제거는 API 가 없다(`terra module install` 명령뿐) | 제거는 daemon op `POST /modules/{id}/uninstall`(Terra #237). 설치는 Master `POST/DELETE /api/v1/nodes/{node_id}/modules/assignments` 가 **앱 토큰 위임에 열렸다**(#236 · ADR-GW-008 B1 · 계약 1.7.0 · `module.manage`) | terra-reach 두 줄 갱신. **화면 연결은 아직 없다**(§3) |
| 모듈 설정·start/stop/restart/logs 는 계약만 | Terra #230 + modules #117 로 설정 schema/get/patch · 수명 op 가 실제로 선다 | gui-v3 의 설정 patch·수명 버튼은 이미 부른다. 스키마 폼은 없음(§3) |
| 릴리스 `.tmod` 는 설치할 수 있다 | **서명이 없다.** `terra module inspect` 가 `PACKAGE_QUARANTINED / signature-missing` — node-gui 0.4.5 도 같다. modules 릴리스 파이프라인이 서명하지 않는 것이 원인(gui-v3 만의 문제가 아니다). `--dev` 로만 깔린다 | 이 PR 의 범위 밖 — 사실로만 적는다(modules 서명 트랙 ADR-MD-005 가 소유) |
| `terra module inspect` 가 요구 권한을 다 보인다 | PERMISSIONS 는 최상위 `permissions` 만 보인다. GUI 앱의 권한 8개는 안 나온다 | Terra 쪽 결함 — 고치지 않았다 |
| 웹 시험은 어디서나 통과한다 | Windows 에서 10건 실패(`new URL().pathname` 의 `C:\C:\…` · 공백 경로) | `fileURLToPath` · `pathToFileURL` 로 고침(§2) |
| B 모드 로그인은 시험으로 보호된다 | `session.js` 가 handle 을 객체째 저장해 헤더가 `Handle [object Object]` — 이후 호출 전부 403. 가짜 Gateway 시험이 handle 을 문자열로 돌려줘 못 잡았다 | id 만 저장 · 옛 저장본도 읽기 · 시험의 가짜 응답을 실제 모양 `{id, issuer, expiresAt}` 으로(§2) |
| 로그인·신원 흐름은 그대로다 | 접속 서비스 트랙(Terra #252~#268: Terra ID · 위임 · 이름 · terra-access)이 10/28~30 에 들어왔다. **이 점검은 깊이 읽지 않았다** — 비밀번호 로그인 길(Gateway `/api/v1/auth/credentials` → Master `/api/v1/auth/login`)은 origin/main 5c6ace6c 의 격리 Master 로 그대로 통과한다. Terra ID · 외부 신원 연결은 gui-v3 에 없다(node-gui 의 `P6-gui` 카드, modules #121 에 해당) | 격차표에 올림(§3) |

## 2. 0.3.0 이 바꾼 것

- `module.json` 0.2.0 → 0.3.0: `gui.scenes[lab.stellaxia.gui-v3.ui]`(role application · branch main · scene.json 의 id 와 같다 — 다르면 Gateway `CodeGuiIDMismatch`) · 웹 앱 `embed:"scene"`.
- `scene/`: 자리 표시를 node-gui 의 얇은 껍데기 구조로 교체(`/` = `terra.web/frame` · `/login` = 로그인 카드). 설계는 [[main-scene]].
- 웹 A 모드: 토큰 없이 init 이 오면 로그인 문 → `emit('login')`, 토큰이 오면 지도·밀어 받기, 로그아웃은 `emit('logout')`. 웹은 비밀번호를 받지 않는다(web-frame 설계 §3.3.1). B 모드(웹이 직접 로그인)는 앱 주소를 직접 열 때만 — 개발·시험용.
- `web/src/api/session.js`: handle 객체 → id. 시험 `session.test.mjs` 추가, `tests/smoke.mjs` 의 가짜 Gateway 가 객체를 돌려준다.
- 웹 시험의 Windows 경로: `tests/boards` · `node-data` · `smoke` · `tools/bench-field` 의 `URL.pathname` → `fileURLToPath`, node-data 시험의 `import(path)` → `pathToFileURL` + 같은 폴더 상대 지정자. 공백 있는 경로·없는 경로 모두 통과.

## 3. 기능 격차 (node-gui 대비, 이번 범위 밖)

코어 세션의 검사 표를 최신 코어에 맞춰 갱신했다. '코어 변경'은 Terra origin/main 기준이다.

| 영역 | gui-v3 상태 | 난이도 | 코어 변경 |
| --- | --- | --- | --- |
| 로그인/로그아웃(껍데기) | **0.3.0 에서 됨** — 이 문서 §5 | — | — |
| Terra ID 신뢰 카드 · external identities | 없음 | 中 | 없음(node-gui 와 같은 op) |
| 시작 화면 · 지도(topology) | 됨 | — | — |
| 노드 데스크톱/제어기 | 부분 — 시계·계정·터미널·파일 목록 시안 | 中 | 없음 |
| 노드 자원(CPU 등) | 시안 값 | 小~中 | 없음 |
| 모듈 목록·상태·시작/정지/재시작·제거 | 됨 (제거 op 는 #237 로 daemon 에 선다) | — | — |
| 모듈 로그 | 시안 | 小 | 없음 |
| 모듈 설정 편집 | 부분 — patch 만, 스키마 폼 없음 | 中 | 없음(config.schema.get 있음) |
| 노드 설정 | 부분 — 하드코딩 25키(node-gui 135키 스키마) | 中 | 없음 |
| 제안 수락(offers consent/withdraw) | 됨(gui-v3 만) | — | — |
| 모듈 배정(master assignments) | 없음 | 小 | **없음 — #236 으로 앱 토큰에 열렸다** |
| 모듈 설치 | 시안(가짜 작업) | 中 | 없음 — assignments(#236)가 길. **설치본·릴리스에 들어가야** 쓸 수 있다 |
| 설정 창(NodeConf) | 시안(TerraNodes 안 부름) | 中 | 없음 |
| 파일(io.terra.file · local-fs · desktop.open) | 없음/시안 | 中 | 없음 |
| 작업·출력 스트림 · master jobs | 부분(tasks.get · cancel) | 中 | 없음 |
| WireGuard apply/down/managed-key | 읽기만 | 中 | 없음 |
| mesh · routes · probes · 네트워크 로그 · connection groups | 없음 | 大 | 없음(단 A 모드 Master 위임 37개 한계) |
| 서비스 터널 | 부분(close 만) | 小 | 없음 |
| SVI 자원·grants·bindings·handles · 링크 흐름 | 시안 | 大 | 없음(일부 Master 쓰기는 위임 밖 — 코어) |
| 다른 모듈 앱 열기(`emit('launch')`) | 없음 | 小 | 없음(`terra.app:launch` 배선 있음, dock 은 이제 화면 안 창으로 연다 #247) |
| 알림(alarms) | 없음 | 小 | 없음 |
| 편집기(건물·재료·도로·지면·필드) | 부분(Field·StarMaker) | 大 | 없음 |
| 등록 상태(enrollment) | 시안 | 小 | 없음 |
| 밀어 받기(events) | 됨(거칠게) | — | — |
| 보기 상태 문서 | 이름공간이 다르다(node-gui `lab.stellaxia.node-gui` / gui-v3 `app:<앱 id>`) — 사용자 배치는 안 넘어간다 | 小 | 없음 |
| 권한 | gui-v3 앱은 node.config 필요(config.patch·restart). process.execute 는 선언만 | — | — |

## 4. 대체하는 날 Terra 쪽에서 같이 바꿀 것 (Terra 는 고치지 않았다)

1. `installer-modules.json` — node-gui(10행 부근)를 `required` 로 선언한다. gui-v3 로 바꾸거나(둘을 다 두려면 main 은 하나만), `release.tag`(v2026.10.19)를 gui-v3 main 판이 든 modules 릴리스 태그로 올린다. 카탈로그 빌드가 그 태그의 `modules.json` 과 대조하므로 태그에 gui-v3 가 있어야 한다.
2. `bundled-modules.json` — node-gui 는 이 파일에 **없다**(설치기 쪽 `installer-modules.json` 에만). 번들에 싣는다면 같은 id 를 두 파일에 두지 말 것(번들 쪽이 소유). 핀 `release.tag` 는 같은 태그로.
3. Terra CI `.github/workflows/ci.yml` 의 "Check node-gui's Master delegation table against Terra" 스텝(529~532행)이 `common/lab.stellaxia.node-gui/web/tools/gen-master-delegated.mjs` 를 부른다. node-gui 가 modules 에서 빠지면 깨진다 → gui-v3 의 대응 도구(`web/tools/gen-op-scope.mjs`, 단 Daemon 표이고 Master 위임 표는 아님)로 바꾸거나 제거. Master 위임 표 대응이 gui-v3 에 없으니 **먼저 만들지 정해야 한다.**
3b. `tests/shipped-scenes.test.ts`(`TERRA_MODULES_ROOT` 로 modules 의 출하 Scene 을 걷는다) — 0.3.0 으로 `shipped-scenes` · `login-demo-scene` 54개 통과를 확인했다(gui-v3 포함). node-gui 를 빼도 통과할 것.
4. 시험 픽스처의 node-gui id — `terra-installer` 의 `catalog_test` · `catalogbuild/{build,declarations}_test` · `installer/{setup_remote_*,ui_api,ui_preview}_test` · `remote_test` · `sigverify/verify_test`, `terra-gateway-service` 의 `master_delegation_test` · `documents_test`, Master `delegated_*`·`job_*` 시험, `svi-handle-integration`. 동작과 무관한 예시 id(위임은 앱 id 로 막지 않는다 — 시험 fixture 일 뿐). 이름을 정리할 때 함께.
5. 설치본 교체 — 설치기가 node-gui 를 받아 깐다. 전례: 0.6.6 때 `terra-setup update --force` 가 손으로 교체한 node-gui 폴더를 되돌렸다. gui-v3 로 바꾼 노드는 업데이트가 node-gui 를 다시 깔지 않는지(선언이 바뀐 뒤)를 확인해야 한다.
6. 서명 — 릴리스 `.tmod` 가 무서명이라 엄격 설치·더블클릭 확인 화면(#249)이 거절한다. 설치기·번들 경로가 `--dev` 로 까는지와 별개로 서명 파이프라인 결정이 필요하다(ADR-MD-005 트랙).
7. (선택) 셸 dock 규약 — dock 은 `terra.webapp.*` 만 안다. embed 앱은 dock 에 안 나오므로 main 화 이후 필수는 아니다. gui-v3 를 dock 에서도 쓰려면 브리지 규약을 구현해야 한다.

**순서**: (a) 이 PR 병합 → 그때부터 node-gui 와 같이 깔린 노드는 **CHOOSE**(릴리스 전엔 영향 없음). (b) 기능 격차를 메운다. (c) modules 릴리스를 낼 때 **같은 태그에서 node-gui 의 main 을 내리거나(dev 로) node-gui 를 릴리스에서 뺀다** — 빠뜨리면 기존 노드 모두에 CHOOSE 가 뜬다. (d) Terra `installer-modules.json` 등을 그 태그로, CI 의 node-gui 스텝 교체. (e) 설치본 교체. (c)~(e) 는 사용자의 결정이다.

## 5. 격리 스택 실측 (2026-10-31)

임시 data_dir · 가짜 홈 · 별도 포트(daemon 27331 · gateway 28797 · host 27521 · Master 28080)에 Terra origin/main 5c6ace6c 소스의 daemon·gateway·host·Master 와 base `io.terra.scene.terra` 0.2.1 · scene-runtime · player 를 띄우고 gui-v3 0.3.0 `.tmod`(`terra module pack --target windows-amd64`)를 `--dev`·격리 root 에 깔았다. 이 PC 의 실행 중 Terra · `%LOCALAPPDATA%\Terra` · `~/.terra` 는 건드리지 않았다.

| 확인 | 결과 |
| --- | --- |
| gui-v3 단독 | base 가 **곧장 gui-v3** 로 진입(0.2.0 은 MAIN_NOT_FOUND) |
| gui-v3 + node-gui 0.4.5 | **CHOOSE** (main 2개 · dev 0개) — 두 항목 '열기' |
| 로그인 문(웹) 클릭 | **동작한다** → Scene `/login` 카드로 이동. (코어 세션이 로컬 커밋에서 본 '클릭이 안 먹음'은 이 스택에선 재현되지 않았다) |
| 로그인 카드 → 로그인 | `POST /api/v1/auth/credentials` 200 → `POST …/gui/apps/lab.stellaxia.gui-v3.web/token` 200 → frame 이 새로 떠 시작 화면(방사형 지도). 로그인 문은 사라졌다 |
| 로그인 뒤 데이터 | Gateway 감사 로그에 `via lab.stellaxia.gui-v3.web delegate=lab.stellaxia.gui-v3.web` 로 `terra.daemon.status.get` · `terra.daemon.events.get`(스트림) · `terra.master.nodes.get` 가 사용자 principal 로 찍혔다 — **A 모드 위임으로 실데이터 호출이 돈다** |
| **못 본 것** | 앱은 sandboxed iframe(별도 origin)이라 화면 안쪽을 읽을 수 없었고, 시작 화면의 노드 점을 눌러도 화면이 바뀌지 않았다. 이 격리 Master 에는 등록된 노드가 없어 '노드 화면'(제어기)의 실데이터를 눈으로 확인하지 못했다. 로그아웃(`emit('logout')`)과 Scene 의 `signout` 도 화면에서는 확인하지 않았다(시험은 있다) |
