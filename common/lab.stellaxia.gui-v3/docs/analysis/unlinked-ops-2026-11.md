---
title: "gui-v3 조작 전수 조사 — op 연결 상태와 결과 판정 (2026-11)"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "result"
last_updated: "2026-11-11"
language: "ko-KR"
---

# gui-v3 조작 전수 조사 — 결과 판정

2026-11-11 조사(S4 적용본, Terra `origin/main 278ff85e` 대조)의 표를 이 저장소로 옮기고, 같은 날 작업 브랜치 `claude/gui-v3-unlinked-ops`의 결과로 갱신했다. 조사 때 "(추측)"이던 것은 코드로 확인했다(아래 "확인" 열).

판정: **연결함**(이 작업에서 연결·교정) · **잠금**(호출하지 않고 단추를 잠그며 이유를 보임) · **Terra에 구현 없음**(op는 게시됐으나 Daemon 백엔드가 늘 501) · **신규 op 필요** · **이미 연결** · **시안 한정**(실제 빌드에 영향 없음).

## 1. 앱 토큰 호출 규칙(코드 근거)

- 앱 토큰 권한 = 사용자 권한 ∩ `module.json` `gui.apps` 선언(session.identity, node.read, node.control, node.config, file.read, file.write, process.execute, module.manage). `node.enroll`, `process.execute.delegated`, `master.admin`은 토큰이 가질 수 없다.
- `terra.daemon.*`: 계약 permissions가 선언에 들어야 하고, 다른 노드로는 scopes에 `cluster`가 있어야 한다. Daemon 위임 문은 선언 계열을 module · file 패밀리로만 열고, 다른 노드로는 전부 닫으며, 선언 적용(apply)과 은퇴 잊기(forget)는 위임 호출자에게 닫는다.
- `terra.master.*`: 계약에 `delegated-session`이 있는 38개(`src/api/master-delegated.json`)만 열린다. 쓰기는 SVI bindings · grants, jobs cancel · rerun, nodes modules assignments뿐이다.
- `terra.gateway.*`: 계약에 `app-scope-token`이 있는 것만. `modules.by-id.{enable,disable,rollback}.post`는 게시만 되어 있고 Daemon 백엔드에서 항상 501이다(점검 AUD-38).
- 모듈 op: `gates.js`가 막지 않는다. 서버 응답(`MODULE_ROUTE_NOT_FOUND` · `OPERATION_NOT_REMOTE`)을 화면이 그대로 옮긴다.

## 2. 항목별 판정

| # | 조작 | 부르는 op | 판정 | 결과 · 근거 |
|---|---|---|---|---|
| 1–7 | 파일 관리자(공유 뿌리 · 폴더 · 지우기 · 새 폴더 · 미리보기 · 올리기 · 내려받기) | `io.terra.file.*` → `lab.stellaxia.file.*` | **연결함**(id 교정, AUD-12) | 계약 입력은 이미 일치. 전부 치환했고 `tests/op-ids.test.mjs`가 번들 op id를 계약에 대조한다. 원격 노드는 계약 scopes에 cluster가 없어 서버 응답(`OPERATION_NOT_REMOTE`)을 그대로 보인다. AUD-73(unwrap)은 이미 수정(마커 있을 때만) |
| 8 | 지운 기록 라벨 | `lab.stellaxia.io-inventory.tombstones.list` | **연결함** | 라벨 교정. 목록은 `terra.daemon.io.tombstones.get`(node.read · local+cluster)를 desk 묶음(`RES.tombs`)에 넣어 읽는다. 못 읽으면 "못 봤음", 읽었는데 비면 "지운 기록 없음" |
| 9 | 노드 터미널 | `terra.daemon.terminal.sessions.post` | **신규 op 필요** · 잠금 | Terra 계약에 없음(설계 제안만). 확인 단계 마지막 단추가 잠겨 있다 |
| 10 | 모듈 끄기·켜기 | `terra.gateway.modules.by-id.{disable,enable}.post` | **Terra에 구현 없음**(필요: Daemon의 영구 끄기·켜기) · 잠금 | 실제 빌드에서 단추 잠금 + 이유 "Terra에 구현 없음 … 프로세스 정지는 멈춤". 실제 정지는 기존 `멈춤`(start/stop)이 맡는다. `gates.js` `NOT_IMPLEMENTED` |
| 11 | 모듈 되돌리기 | `terra.gateway.modules.by-id.rollback.post` | **Terra에 구현 없음**(필요: Daemon의 롤백) · 잠금 | 같은 이유. 이전 버전 정보도 desk 묶음에 없다 |
| 12 | 장치 `다시 찾기` | `terra.daemon.io.scan.post {}` | **연결함** | 응답 뒤 desk 묶음을 다시 읽는다. 실제 모드의 가짜 진행(`addJob` 1.6초 타이머)은 막았다(시안 분기만 남음) |
| 13 | 모듈 `다시 읽기` | `terra.daemon.modules.scan.post` | 이미 연결(시안 분기는 시안 한정) | |
| 14 | 장치 별칭 | `terra.daemon.io.devices.by-device-id.alias.post {device_id, alias}` | **연결함** | 마크업은 `onInput`→`aliasIn`, `onChange`→`aliasSet`로 이미 갈라져 있었다. `aliasIn`이 op 없이 `ndSet`을 불러 실제 모드에서 거절되던 것을 초안(draft)으로 바꿨다 |
| 15 | 선언 `적용` | `terra.daemon.svi.declarations.apply.post` | **잠금** | Daemon 위임 문이 앱 토큰에 닫음. 호출하지 않는다(`gates.js` `DAEMON_CLOSED`) |
| 16 | 선언 `잊기`(은퇴) | `…retired.by-family.by-name.forget.post` | **잠금** | 같은 이유. 이전에는 gate가 열어 두어 누르면 403이었다 |
| 17 | 공유 폴더 패널 | `terra.daemon.config.patch` | **연결함** | 실제 노드 값(`config.get`의 `storage.shared_dirs` · `memos_dir` · `local_fs.enabled`)으로 채운다. 읽지 못했거나 권한이 없으면 저장을 잠근다(빈 목록으로 덮어쓰지 않음). 성공 문구는 응답 뒤 |
| 18 | 서비스 선언(net 패밀리) | `terra.daemon.svi.declarations.post` | **잠금**(net) | 앱 토큰은 module · file만. 다른 노드로는 전부 닫힘. `gateOf(op, {family})`가 보내기 전에 막는다 |
| 19 | Master 작업 `다시 보내기` | `terra.master.jobs.by-job-id.rerun.post` | **잠금** | Master가 `process.execute.delegated`를 요구하고 앱 선언에 없다. 이유 "앱 토큰에 없는 권한". `module.json`에 추가하지 않았다 |
| 20, 23, 24 | 시안 분기(동기화 · 지정 · 동의) | — | 시안 한정 | 실제 모드는 op 연결됨 |
| 21 | 정보 탭 `다시 점검` | `terra.daemon.health.get` · `ready.get` · `live.get` | **연결함** | 세 읽기를 새로 받아 점검 칩에 채운다. ready · live는 이 노드만(원격은 "원격 불가") |
| 22 | 노드 정보(OS · 코어 · 가동) | — | 이미 정직 | "보고 없음" |
| 25 | 데스크 시계 | — | **연결함** | 하드코딩 `10:36` → 실제 시각(30초마다 갱신) |
| 26 | `stk` 폴백 | — | 시안 한정 | 실제 빌드는 principal |
| 27 | 기본 아이콘 | — | 의도 | `agent` 단축의 `mod:'agent'`는 옛 id(실제 `lab.stellaxia.agent`) — 노드에 값이 있으면 그 값이 우선, 기본값 정리는 별건 |
| 28 | WireGuard `plan` · 등록 `en` 씨앗 | — | **연결함** | `ndEmpty`가 wg · en · 공유 폴더 씨앗을 "보고 없음"/빈 값으로 비운다 |
| 29 | 시안 바탕화면 항목 | — | 시안 한정 | |
| 30 | 외부 신원 · 신뢰 발급자 | `terra.master.users…external-identities.*` · `admin.external-issuers.*` | **잠금**(위임 표 밖) | 설계(영구 로그인 뒷문 방지). gate가 "위임 없음" |
| 31 | 네트워크 쓰기 8종 | `terra.master.network.*` · `route.*` · `connection-groups.*` | **잠금**(위임 표 밖) | ADR-GW-012 |
| 32, 33 | Tree 로그인 경로 · 주소 묻기 | `terra.master.crossboundary.login-routes.*` | **잠금**(위임 표 밖) · Terra 결정 필요 | 길을 못 받으면 "주소 모름"으로 보이고, 주소 묻기는 서버 거절 코드를 그대로 보인다 |
| 34 | Tree 로그인 가짜 슬러그 | — | **연결함**(제거) | 실제 연결에서 지어낸 `https://tree-…terra.local` 주소를 없앴다(시안은 유지) |
| 35 | Tree 로그인 시안 노드 분기 | — | 시안 한정 | rid 없는 노드의 원인은 미증명 |
| 36 | 원격 노드 모듈 앱 목록 | `terra.gateway.gui.remote.by-node.apps.get` | **잠금**(앱 토큰 밖) · 신규 op 필요(Daemon 모듈 행에 앱 요약) | "못 봤음 — 원격 노드의 앱 목록은 앱 토큰으로 받지 못함"으로 표시(0개가 아니다) |
| 37 | Scene 모듈 시안 풀 | — | 시안 한정 | |
| 38 | 앱 목록 런처 | — | **연결함** | 독 단추 클릭이 데스크로 버블링해 곧바로 닫히던 것(`stopPropagation`) |
| 39 | 위험 영역 `변경 ›` | Scene `/danger` | **연결함** | `TerraDangerAsk`를 항상 정의하고 호출 시점에 `frame`을 본다(AUD-79). 쓰기 op는 앱 토큰 전면 거절(설계) |
| 40 | 노드 id `복사` | clipboard | **연결함** | 실패(iframe 정책)를 "복사 못 함 — 직접 선택"으로 보인다 |
| 41 | 제어기 배치 문서 저장 | — | 해소 | node-desk 이관 + `terra.pc.*` 브라우저 로컬 |
| — | AUD-81 whoami 없을 때 gate 열림 | — | **연결함**(닫음) | `who` 키를 준 호출은 권한을 모르면 쓰기를 닫는다 |
| — | AUD-89 앱 목록 실패=0개 | `GET /api/v1/gui/apps` | **연결함** | 실패는 `null`(못 봤음)로 두고 0개와 구분 |
| — | D6·D7 읽지 못한 빈 목록 | — | **연결함**(일부) | 지운 기록 · 장치 · 앱 목록 · 점검에서 "없음"과 "못 봤음"을 가른다. catalog · peers 등은 별건 |

## 3. 필요한 신규 op와 소유 모듈

| 필요 | 소유 |
|---|---|
| 영구 끄기·켜기, 롤백(`modules.by-id.{disable,enable,rollback}.post` 백엔드) | Terra Daemon |
| `terra.daemon.terminal.sessions.post` + 입출력 스트림 | Terra Daemon |
| Daemon 모듈 행에 앱 요약(`apps` · `perms` · `ops` · `svi`) | Terra Daemon |
| `crossboundary.login-routes.*`를 `delegated-session`에 추가 | Terra Master + Gateway(결정) |
| 이미 있음: `terra.daemon.io.tombstones.get`, `config.get`(공유 폴더) | — |

## 4. 진단: 인라인 이벤트 핸들러 CSP 오류

실제 빌드에서 `Executing inline event handler violates … script-src 'self'`가 보드를 마운트할 때마다 났다. 원인은 `src/ui/dc/runtime.js`가 보드 마크업을 `template.innerHTML`로 파싱하는 순간, 마크업의 `onClick="{{…}}"` 같은 속성을 브라우저가 인라인 핸들러 속성으로 보고 CSP 위반으로 보고하는 것이다(컴파일러는 그 속성을 이벤트 바인딩으로 읽고 버리므로 DOM에는 남지 않는다). 파싱 전에 `on*` 속성을 `data-dcon-*`로 바꿔(`holdHandlers`) 위반이 나지 않게 고쳤다. 죽어 있던 버튼은 없다 — 핸들러는 `addEventListener`로 붙어 CSP와 무관했다(오류 로그만 났다).

## 격리 실측 (2026-11-11)

Terra `origin/main` 278ff85e로 빌드한 격리 Master + Daemon A/B + Gateway + 실제 셸·gui-v3, 로컬 노드 B에서 버튼을 눌러 요청과 결과를 봤다. 시험 계정에 격리 Master에서 `module.manage`, `node.config`를 줬다.

| 조작 | 결과 |
| --- | --- |
| 다시 찾기 | `terra.daemon.io.scan.post` 200 (단추가 독에 가려 DOM click으로 눌렀다) |
| 별칭 | 칸을 떠나면 `alias.post` 200 |
| 지운 기록 | `terra.daemon.io.tombstones.get` 200 |
| 공유 폴더 | 노드 실제 값 표시, 추가 후 저장 시 `config.patch` 200, `config.get`에 실제 반영. 권한 없으면 저장 잠금 |
| 다시 점검 | `health`, `ready`, `live` 200 |
| 앱 목록 런처 | 열리고 닫힌다 (AUD-75) |
| 끄기·켜기 | 잠금과 이유. `disable.post` 직접 호출은 501 `MODULE_MANAGEMENT_UNAVAILABLE` |
| 파일 관리자 | `lab.stellaxia.file.roots.list` 200, 옛 id 호출 0 |
| CSP 인라인 핸들러 오류 | 0 |

**확인 못 한 것:** 격리 스택의 file 모듈은 서명되지 않아 공유 뿌리가 0개다. 파일 올리기, 내려받기, 새 폴더, 지우기는 op id와 입력을 계약으로 대조했을 뿐 실제로 돌리지 못했다. 원격 노드의 파일 op, Tree 지정, 서비스 터널 닫기, 설치도 이번에 누르지 않았다. 나머지 보드(NodeSvi, NodeShare, ResStatus, NodeNet, NodeStatus, TreeLogin, StarMaker, WebBrowser, NodeConf, Scene, Login)의 조사는 op 문자열 대조 수준이다.
