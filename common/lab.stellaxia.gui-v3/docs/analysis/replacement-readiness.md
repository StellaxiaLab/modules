---
title: "node-gui 대체 준비도 — 현황 점검 · 기능 격차 · Terra 쪽 같이 바꿀 것"
aliases:
  - "node-gui 대체 준비도"
  - "gui-v3 replacement readiness"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
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
| 릴리스 `.tmod` 는 설치할 수 있다 | v2026.10.31 까지는 **서명이 없어** `PACKAGE_QUARANTINED / signature-missing`(node-gui 0.4.5 도). **해결됨** — modules #136(ADR-MD-005)로 첫 서명 릴리스 v2026.10.31-2(34개 전부 서명), Terra 0.6.8(keyring) · 0.6.9(핀 v2026.10.31-2). `tools/pack-modules.mjs` 는 이제 `--signing`/`--unsigned` 를 명시해야 한다 | 사실만 갱신 |
| `terra module inspect` 가 요구 권한을 다 보인다 | 0.6.7 까지는 최상위 `permissions` 만 보였다(GUI 앱 권한 8개 빠짐). **해결됨** — Terra #269 로 inspect · `.tmod` 확인 화면이 GUI 앱 권한을 보인다(0.6.8 부터) | 사실만 갱신 |
| 웹 시험은 어디서나 통과한다 | Windows 에서 10건 실패(`new URL().pathname` 의 `C:\C:\…` · 공백 경로) | `fileURLToPath` · `pathToFileURL` 로 고침(§2) |
| B 모드 로그인은 시험으로 보호된다 | `session.js` 가 handle 을 객체째 저장해 헤더가 `Handle [object Object]` — 이후 호출 전부 403. 가짜 Gateway 시험이 handle 을 문자열로 돌려줘 못 잡았다 | id 만 저장 · 옛 저장본도 읽기 · 시험의 가짜 응답을 실제 모양 `{id, issuer, expiresAt}` 으로(§2) |
| 로그인·신원 흐름은 그대로다 | 접속 서비스 트랙(Terra #252~#268: Terra ID · 위임 · 이름 · terra-access)이 10/28~30 에 들어왔다. **이 점검은 깊이 읽지 않았다** — 비밀번호 로그인 길(Gateway `/api/v1/auth/credentials` → Master `/api/v1/auth/login`)은 origin/main 5c6ace6c 의 격리 Master 로 그대로 통과한다. Terra ID · 외부 신원 연결은 gui-v3 에 없다(node-gui 의 `P6-gui` 카드, modules #121 에 해당) | 격차표에 올림(§3) |

## 2. 0.3.0 이 바꾼 것

- `module.json` 0.2.0 → 0.3.0: `gui.scenes[lab.stellaxia.gui-v3.ui]`(role application · branch main · scene.json 의 id 와 같다 — 다르면 Gateway `CodeGuiIDMismatch`) · 웹 앱 `embed:"scene"`.
- `scene/`: 자리 표시를 node-gui 의 얇은 껍데기 구조로 교체(`/` = `terra.web/frame` · `/login` = 로그인 카드). 설계는 [[main-scene]].
- 웹 A 모드: 토큰 없이 init 이 오면 로그인 문 → `emit('login')`, 토큰이 오면 지도·밀어 받기, 로그아웃은 `emit('logout')`. 웹은 비밀번호를 받지 않는다(web-frame 설계 §3.3.1). B 모드(웹이 직접 로그인)는 앱 주소를 직접 열 때만 — 개발·시험용.
- `web/src/api/session.js`: handle 객체 → id. 시험 `session.test.mjs` 추가, `tests/smoke.mjs` 의 가짜 Gateway 가 객체를 돌려준다.
- 웹 시험의 Windows 경로: `tests/boards` · `node-data` · `smoke` · `tools/bench-field` 의 `URL.pathname` → `fileURLToPath`, node-data 시험의 `import(path)` → `pathToFileURL` + 같은 폴더 상대 지정자. 공백 있는 경로·없는 경로 모두 통과.

## 3. 기능 격차 (node-gui 대비)

2026-10-31 격차 작업(이 문서를 작업 목록으로) 뒤의 표다. **근거** 칸: `실측` = 격리 스택(Terra origin/main b34ed4aa 소스 · 등록된 리프 · 격리 Master)에서 실제 응답을 봤다, `시험` = `npm test` 만, `—` = 손대지 않음.
실측의 한계: 브라우저 도구가 **다른 origin iframe(main Scene 의 frame) 안을 누르거나 키를 보내지 못해** A 모드 화면은 눈으로 몰지 못했다. 같은 보드 코드를 B 모드(앱 주소 직접 · 최상위 문서)로 몰았고, A 모드 자격은 **실제 앱 토큰(`tsa_`)으로 같은 op 를 불러** 위임을 확인했다.

| 영역 | gui-v3 상태 | 근거 | 난이도 | 코어 변경 |
| --- | --- | --- | --- | --- |
| 로그인/로그아웃(껍데기) | 0.3.0 에서 됨 | §5 | — | — |
| 시작 화면 · 지도(topology) | 됨. **단, 부모 Tree 가 목록에 없는 리프(단독 리프)는 지도가 비어** 시안 지도로 떨어지고 로컬 노드가 묶이지 않는다(격리 스택에서 발견) | 실측 | 小 | 없음 |
| 노드 자원(CPU 등) | **부분** — 전역 틀 대상 표의 상태 · 하트비트 · CPU · MEM · 디스크를 Master 하트비트 자원 스냅샷(`resource`)으로. 자원 수 · NET 그래프 · 모듈 상태 창의 CPU/MEM 은 아직 시안(노드별 실시간 지표 op 가 없다) | 시험 | 小 | 없음(실시간 지표는 코어) |
| 모듈 목록·상태·시작/정지/재시작·제거 | 됨 | 실측(목록) | — | — |
| 모듈 로그 | **됨** — 모듈 › 로그 = `modules.by-module-id.logs.get`(탭을 볼 때만) | 실측(200 · 줄 0) | — | — |
| 모듈 설정 편집 | **됨** — 스키마 폼(`config.schema.get` + `config.get`, enum · boolean · 수 · JSON · 비밀 제외 · 재시작 표시), 저장은 형 변환 + `base_revision` | 실측(maxFileMB 8→9→8, revision 0→1) | — | — |
| 노드 설정 | 부분 — 하드코딩 25키(node-gui 는 `config.schema.get` 135키) | — | 中 | 없음 |
| 제안 수락(offers consent/withdraw) | **됨** — 실제 노드의 제안을 매핑하지 않아 'Tree 지정' 탭이 늘 비어 있던 결함을 고침(offered · accepted · stale · managed · pinned → 세 칸) | 시험(격리 노드에 제안 0건) | — | — |
| 모듈 배정(master assignments) | **됨** — 설치 › 'Tree 에 지정'(module id · 버전) = `assignments.post`, 제안 › '지정 해제' = delete. 전송이 Master id 를 스스로 찾는다 | 실측 — 앱 토큰으로 위임 통과, Master 가 `MODULE_NOT_FOUND`(이 격리 Tree 에 게시본 없음). **끝까지(게시 → 제안 → 동의 → 설치)는 못 봤다** | — | 없음 |
| 모듈 설치(파일) | 실제 노드에서 **잠그고 이유를 적는다** — `.tmod` 파일 설치는 `commands.execute`(process.execute · 이 노드만)로 `terra module install` 을 돌려야 하는데 위험이 커 하지 않았다. 대신 Tree 지정 | 시험 | 中 | 없음(결정 필요) |
| 설정 창(NodeConf) | 시안 | — | 中 | 없음 |
| 파일(io.terra.file · local-fs · desktop.open) | 없음/시안 | — | 中 | 없음 |
| 작업 · 출력 | **부분→됨(읽기)** — 작업 관리자 줄을 누르면 `tasks.by-task-id.output.get`(도는 동안 3초 폴링). SSE 따라가기 · master jobs 는 없음 | 시험(격리 노드에 작업 0건) | 小 | 없음 |
| WireGuard | **됨** — 올리기/다시 적용 = `apply.post`, 내리기 = `down.post`, 동기화 = `sync.post`. managed-key/config 는 아직 | 실측(sync 202, 앱 토큰). apply/down 은 실행하지 않음 | 小 | 없음 |
| mesh · routes · probes · 네트워크 로그 · connection groups | 없음 | — | 大 | §3-1 |
| 서비스 터널 | **목록 · 닫기 됨**, 열기는 잠금 — 여는 것은 Master `service-tunnels.open.post` 인데 앱 위임 밖 | 실측(목록 200 · 0건) | — | 열기는 코어(위임) |
| SVI 자원·grants·bindings·handles · 링크 흐름 | 시안 | — | 大 | §3-1 |
| 다른 모듈 앱 열기 | **됨** — 모듈 › 앱 = Gateway 앱 목록(embed 앱 제외), '열기' = `emit('launch')` → Scene `gui-v3.app.launch` → `terra.app:launch` | 실측(목록 · B 모드에서 '셸 안에서만' 경로). **A 모드에서 창이 뜨는 것은 못 봤다**(iframe 안을 누를 수 없음) | — | — |
| 알림(alarms) | **부분** — 작업 · 모듈 상태 변화를 알림 한 줄로(상태 줄 · `window.TerraAlarms`), 밀어 받기 이벤트에 바로 다시 읽음. **목록 화면은 없다**(전역 틀 '알림' 메뉴 자리만) | 시험 | 小 | 없음 |
| 편집기(건물·재료·도로·지면·필드) | 부분(Field · StarMaker) | — | 大 | §3-1 |
| 등록 상태(enrollment) | **됨(읽기)** — 등록 여부 · Master 주소 · 노드 id · 등록일 · 자격. 등록 코드는 잠금(`node.enroll` 이 앱 권한에 없다) | 실측 | — | — |
| Terra ID 신뢰 카드 · external identities | 없음. **A 모드로는 읽기만 닿는다** — 위임 표에 `users.by-user-id.external-identities.get` 하나, 발급자 관리(admin.external-issuers.*)와 연결/해제는 위임 밖. 그릴 자리(설정 창)도 시안 | — | 中 | 쓰기는 코어(위임) 또는 B 모드 |
| 밀어 받기(events) | 됨(거칠게) | — | — | — |
| 보기 상태 문서(node-gui 배치 넘겨받기) | **막힘** — Gateway 가 앱 토큰을 `app:<자기 앱 id>` 로 고정하고(`documents.go` 18~21행, 시험 `TestDocumentAppTokenCannotReachAnotherNamespace` 가 node-gui 이름공간을 예로 거절), 사람 세션은 `app:` 이름공간을 못 쓴다. 게다가 node-gui 가 둔 것(`layout/<node_id>` 육각 맵 배치 · 노드 모습 · 연결 · 메모 · 창 자리, `assets` 건물 · 도로)은 gui-v3 에 대응 모델이 거의 없다(창 자리 · 메모 정도) | 코드 확인 | — | **있음** — 결정 필요 |
| Master 위임 표(Terra CI 스텝 대응) | **됨** — `web/tools/gen-master-delegated.mjs --terra … --check`(§4-3) | 시험 · 생성 확인(38 op) | — | ci.yml 경로 교체만 |
| 권한 | gui-v3 앱은 node.config(설정 patch · 재시작) · module.manage(배정) · node.control(WireGuard · 터널 닫기) · process.execute(작업 출력)를 쓴다. 격리 Master 의 부트스트랩 관리자는 `DefaultPermissions()` 라 **module.manage · node.config 가 없어** 쓰기가 403 이었다 — 실제 Tree 의 역할 구성도 확인해야 한다 | 실측 | — | — |

### 3-1. 大 항목 — 범위와 순서 (착수 전 결정)

| 묶음 | node-gui 가 하는 것 | 닿는 길(A 모드) | 제안 순서 |
| --- | --- | --- | --- |
| 네트워크 보기 | mesh peers · networks · state/status · probes · routes(graph · candidates · policies · sessions) · 로그 | Master 위임 표에 **읽기는 다 있다**(peers.get · networks · state · status · probes · route.* · logs) | 1. 읽기 전용 '네트워크' 창(노드 · 피어 · 경로 표) — 中 |
| 네트워크 쓰기 | mesh plan/reconcile/revoke · connection-groups close · route session close | **위임 밖**(mesh plan · reconcile · revoke · connection-groups close · route sessions close 모두 표에 없다) | 2. 코어 위임 결정 뒤 — 그 전엔 B 모드만 |
| SVI | 자원 · 엔드포인트 · grants(만들기 · 고치기 · 지우기) · bindings · handles · 링크 흐름(SSE) | 위임 표에 resources · grants(post/patch/delete) · bindings(get/post/delete) · handles 가 **있다**. handle 이벤트 SSE 는 표에 없다 | 3. 자원 상태 창(ResStatus) · 자원 창(NodeShare)을 실데이터로 — 大(링크 흐름 포함) |
| 편집기 | 건물 · 재료 · 도로 · 지면 · 필드 화면(맵 자산) | 코어 op 없음 — GUI 자산(보기 상태 문서) | 4. gui-v3 의 디자인 방향(우주 지도)과 맞는지부터 — 다시 만들지 결정 필요 |

## 4. 대체하는 날 Terra 쪽에서 같이 바꿀 것 (Terra 는 고치지 않았다)

1. `installer-modules.json` — node-gui(10행 부근)를 `required` 로 선언한다. gui-v3 로 바꾸거나(둘을 다 두려면 main 은 하나만), `release.tag`(v2026.10.19)를 gui-v3 main 판이 든 modules 릴리스 태그로 올린다. 카탈로그 빌드가 그 태그의 `modules.json` 과 대조하므로 태그에 gui-v3 가 있어야 한다.
2. `bundled-modules.json` — node-gui 는 이 파일에 **없다**(설치기 쪽 `installer-modules.json` 에만). 번들에 싣는다면 같은 id 를 두 파일에 두지 말 것(번들 쪽이 소유). 핀 `release.tag` 는 같은 태그로.
3. Terra CI `.github/workflows/ci.yml` 의 "Check node-gui's Master delegation table against Terra" 스텝(529~532행)이 `common/lab.stellaxia.node-gui/web/tools/gen-master-delegated.mjs` 를 부른다. node-gui 가 modules 에서 빠지면 깨진다 → **gui-v3 대응 도구가 생겼다**: `common/lab.stellaxia.gui-v3/web/tools/gen-master-delegated.mjs --terra "$GITHUB_WORKSPACE" --check`(인자 같음, 출력은 `src/api/master-delegated.json` — gui-v3 는 Master op 를 id 로 부르므로 op id → method · path · permissions). 값으로 비교해 Windows 줄 끝에 흔들리지 않는다. 대체 때 ci.yml 529~532행의 경로만 바꾸면 된다. 시험 `tests/master-delegated.test.mjs` 가 gui-v3 가 부르는 Master op 가 모두 위임 표에 있거나 B 모드 전용으로 적혀 있는지 본다.
3b. `tests/shipped-scenes.test.ts`(`TERRA_MODULES_ROOT` 로 modules 의 출하 Scene 을 걷는다) — 0.3.0 으로 `shipped-scenes` · `login-demo-scene` 54개 통과를 확인했다(gui-v3 포함). node-gui 를 빼도 통과할 것.
4. 시험 픽스처의 node-gui id — `terra-installer` 의 `catalog_test` · `catalogbuild/{build,declarations}_test` · `installer/{setup_remote_*,ui_api,ui_preview}_test` · `remote_test` · `sigverify/verify_test`, `terra-gateway-service` 의 `master_delegation_test` · `documents_test`, Master `delegated_*`·`job_*` 시험, `svi-handle-integration`. 동작과 무관한 예시 id(위임은 앱 id 로 막지 않는다 — 시험 fixture 일 뿐). 이름을 정리할 때 함께.
5. 설치본 교체 — 설치기가 node-gui 를 받아 깐다. 전례: 0.6.6 때 `terra-setup update --force` 가 손으로 교체한 node-gui 폴더를 되돌렸다. gui-v3 로 바꾼 노드는 업데이트가 node-gui 를 다시 깔지 않는지(선언이 바뀐 뒤)를 확인해야 한다.
6. 서명 — **해결됨**(modules #136 · v2026.10.31-2 부터 서명, Terra 0.6.8 keyring · 0.6.9 핀). 대체 릴리스도 같은 파이프라인(`pack-modules.mjs --signing`)으로 나가야 한다.
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

## 6. 격차 작업 실측 (2026-10-31 저녁)

- 스택: Terra origin/main **b34ed4aa**(서명 keyring 포함) 소스의 daemon · gateway · host · Master · CLI, 임시 data_dir · 가짜 홈 · 별도 포트, 모듈 배포(module_distribution) 켬. 이 PC 의 실행 중 Terra 와 `~/.terra` 는 건드리지 않았고 정리는 격리 폴더의 실행 파일만.
- 서명: 릴리스 v2026.10.31-2 의 `io.terra.sample.window` 는 새 CLI 로 `installable true · tier built-in · issuer Terra` — `--dev` 없이 깔린다. 옛 CLI(1f0b569b)는 같은 패키지를 `signature-unknown-key` 로 격리했다(keyring 이전).
- 등록: 격리 Master `POST /api/v1/nodes/enroll-codes` → Daemon `POST /enrollment/code` → 재시작. Master 노드 목록에 리프 하나(부모 Tree 없음) — 그래서 지도가 비었다(§3 첫 줄).
- 권한: 부트스트랩 관리자에게 격리 Master 에서만 `module.manage` · `node.config` 를 더했다(`PATCH /api/v1/admin/users/{id}`). 그 전에는 설정 patch · 배정이 403.
- B 모드(앱 주소 직접): 로그인 → 노드 데스크톱 묶음 8부분(config · modules · offers · tasks · svi · wg · tunnels · enroll) · 등록 실값 · 모듈 로그 200 · 설정 스키마 칸(maxFileMB · maxTotalMB, integer · 재시작) · 설정 patch 8→9→8 · 배정 → Master `MODULE_NOT_FOUND`. 장면 노드를 로컬에 묶는 것은 지도가 비어 **JS 로 했다**(`TerraNodes.t.bindScene`) — 화면을 눌러 연 것이 아니다.
- A 모드 자격: `POST /api/v1/gui/apps/lab.stellaxia.gui-v3.web/token` 으로 받은 `tsa_` 토큰으로 `assignments.post`(위임 통과 → Master 답) · `logs.get` · `service-tunnels.get` · `enrollment.status.get` · `wireguard.sync.post`(202) 확인, `crossboundary.login-routes.get` 은 예상대로 닿지 않음.
- 못 본 것: main Scene 안(A 모드) 화면 조작 — 브라우저 도구의 클릭 · 키가 다른 origin iframe 안으로 가지 않았다(로그인 문 클릭도 같은 이유로 보임). 알림 · 작업 출력 · 제안 행은 격리 노드에 작업 · 제안이 없어 시험만.
