---
title: "제어기의 쓰기 흐름 — 확인 단계 · 등록 · 모듈 설치 · 배정 진행 · 네트워크 · 터널 · 외부 신원"
aliases:
  - "확인 단계"
  - "쓰기 흐름"
  - "등록 마법사"
  - "배정 진행"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[node-shell|노드 셸 설계]]"
  - "[[terminals|제어기의 두 터미널]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
  - "[[replacement-readiness|대체 준비]]"
---

# 제어기의 쓰기 흐름

제어기(`NodeDesktopEmbed`)의 쓰기 단추는 **화면은 다 그리고, 코어가 열지 않은 마지막 단추만 잠그고 이유(why)를 그대로 보인다.**
잠금 판정은 문(`window.TerraGate` — `src/api/gates.js`)이 한다. 코어가 위임 · 권한을 열면 `master-delegated.json` · `op-scope.json` 을 다시 뽑기만 하면 저절로 열린다 — 화면에 op 이름으로 된 잠금 플래그를 두지 않는다.
사람이 정해야 열리는 것(설계 결정)은 `DECIDE` 표 한 곳에만 둔다.

- 원본: `web/src/api/desk-flows.js`(+ `desk-flows.test.mjs`) — 보드는 `@flows` 구간 사본(`tools/sync-desk-flows.mjs`, 같은지는 `tests/desk-flows.test.mjs`)
- 보드: `ask(spec)` · `cfmView` · `gateOf` · `actBtn` · `shellAsk` · `netAsk` · `assign` · `tmodPick` · `terraId`

## 1. 공용 확인 단계(`ask`)

모든 위험한 쓰기가 같은 대화상자를 쓴다(노드 셸 · 파일 설치 · 네트워크 · 터널 · 외부 신원 · 등록).

| 칸 | 내용 |
| --- | --- |
| 머리 | 제목 · 위험도 칩(`TerraRisk(op)` — 읽기 · 쓰기 · 위험) · 위험도 색 띠(파랑 · 노랑 · 빨강) · 도움말 켜면 op id |
| 단계 칩 | 1 … n · 결과. 잠긴 결과는 노란 점선 칩 |
| 잠금 상자 | 문이 닫혔으면 **첫 단계부터** "마지막 단추 잠김 — why" |
| 줄 | 무엇 · 어디에 · 기록(감사) · 되돌리기 · 그 뒤(재시작 등) |
| 경고 · 칸 · 체크 | 경고(노랑 · 빨강 줄) · 입력 칸(글 · 비밀 · 노드 고르기 · 켜끔) · 승인 체크(다 해야 다음) |
| 결과 | 됨 / 못 함 · 응답 줄 · 오류면 "할 일" · 되돌리기 안내. 시안(실제 Terra 없음)은 '됨 (시안)' |

단추를 여는 쪽 단추(`actBtn`)는 문이 닫혀도 누를 수 있다 — 자물쇠와 why 를 단 채로 확인 단계까지 보고, 마지막 단추만 잠긴다.

## 2. 항목별

| 항목 | 흐름 | op(계약 확인) | 지금 |
| --- | --- | --- | --- |
| A6 노드 셸 | 잠금 판 › 열기 확인 단계: 무엇이 되는가(이 노드 · PTY · 수명 · 감사) → 권한 경고(`process.terminal` · dangerous · 누가 보나 · 셸 확인 카드) → 두 터미널 구분(미리 보기) → 셸 열기 | 제안 `terra.daemon.terminal.sessions.post` | **잠김** — [[node-shell]] 결정 전(`NODE_SHELL.reason`) |
| A7 .tmod 설치 | 파일 고르기 → 매니페스트(브라우저가 zip 의 `module.json` 만 풂) → 권한 · 서명 경고 → 승인 체크 → 설치 | (결정 후) `commands.execute` 로 `terra module install` | **잠김** — `DECIDE.tmodInstall`: 결정 필요(process.execute 경로). 대신 'Tree 에 지정 ›' 이 id · 버전을 채운다 |
| A8 배정 진행 | 게시본 → Master 배정 → 제안 도착 → 동의 → 설치 · 기동, 막대 + 단계 칩, 5초마다 다시 읽기, 단계마다 실패 안내 | `terra.master.nodes.by-node-id.modules.assignments.post` · `terra.daemon.modules.offers.get` · `…offers.by-module-id.consent.post` · `terra.daemon.modules.get` | **열림**(위임 표에 있다). 게시본은 따로 못 읽는다(`publications.get` 위임 밖) — 배정 응답 `MODULE_NOT_FOUND` = 게시본 없음 |
| B1 네트워크 쓰기 | 탭마다 단추 → 확인(무엇 · 어디에 · 기록 · 되돌리기 · 칸) → 결과(접수) · 그 탭 다시 읽기 | `network.mesh.wireguard.{reconcile, plan, peers.revoke}.post` · `network.probes.post` · `route.policies.put` · `route.policies.by-policy-id.delete` · `route.sessions.by-session-id.close.post` · `connection-groups.by-group-id.close.post` | **잠김** — 위임 밖(문 why) |
| B2 터널 열기 | 대상 노드 · 대상 포트 · 서비스 이름 · 로컬 포트(0 = 자동) · 최대 연결 → 확인 | `terra.master.service-tunnels.open.post` | **잠김** — 위임 밖. Daemon `service-tunnels.post` 는 혼자 열지 못한다(아래) |
| B4 외부 신원 · 신뢰 발급자 | 연결: 발급자 → 외부 로그인(이 Tree 용 토큰) → 확인. 해제 확인. 신뢰 발급자 목록 · 더하기 · 빼기 | `users.by-user-id.external-identities.{post, delete}` · `admin.external-issuers.{get, post, delete}` | **잠김** — 계약이 연결을 위임 세션에 일부러 닫았다(앱이 남의 계정을 붙이면 영구 로그인 뒷문) · 발급자는 `master.admin` |
| B5 등록 | 미등록이면 마법사: 코드(`tnc_…` · `tnc_….<base64url(origin)>` 이면 주소를 풀어 보임 · `tjc_` 거절) → Master 주소(품지 않았을 때만) → 장치 이름 → 확인 → 결과(종료 코드 75 재시작 안내). 등록된 노드는 상태만(다시 등록하면 409) | `terra.daemon.enrollment.code.post {code, device_name?, master_url?}` | **잠김** — 앱 권한에 `node.enroll` 이 없다(문 why) · local 전용 |

### B2 — 왜 Daemon 의 `service-tunnels.post` 로 열지 않나

Daemon 계약은 입력이 열려 있지만(`additionalProperties`), Provider DTO `servicetunnel.OpenRequest` 는 **Master 가 낸 경로 결정(`decision`)과 경로 표(`ticket` — id · 어댑터 · `control` · `service_tunnel` 채널 허용)** 를 요구한다(`validateOpenRequest` → `validateServiceTunnelAttempt`). 표가 없으면 `route ticket is required`. 표는 Master `service-tunnels.open.post`(또는 `plan.post`)가 만들고, open 은 그 결과를 출발 노드 Daemon 에 `service.tunnel.open.request` 로 보낸다. 그래서 이 노드에서도 여는 길은 Master open 하나이고, 문도 그 op 로 본다.
기한 칸은 계약에 없다 — 닫기 전까지 열려 있고, 표의 쓰임 · 만료는 Master 가 정한다(화면은 최대 연결로 묶는다). 대상 · 듣는 주소는 loopback 만(`127.0.0.1`).

### A7 — 브라우저가 읽는 것

`.tmod` = zip, `module.json` 이 첫 엔트리(`terra module pack`). 화면은 끝의 목록(EOCD → central directory)에서 `module.json` 만 찾아 `DecompressionStream('deflate-raw')` 로 푼다(상한 1 MiB · zip64 안 읽음 · 꾸러미 64 MB 까지).
서명은 매니페스트 안 `signature{algorithm, keyId, issuer, signedAt, value}` — 화면은 **검증하지 않는다**(키 이름만 보인다). 검증은 노드의 keyring 이 설치 때 한다(모르는 키 · 미서명은 개발 모드에서만 · 그 밖엔 격리).
요구 권한 = Manifest v2 `permissions{coreOperations, storage, network, secret, native}`(native 빨강 · network · secret · 실행 · 제어 계열 노랑).

열려면(결정 뒤): ① 파일을 노드로 올리는 길(브라우저의 파일은 노드 디스크에 없다 — `io.terra.file`) ② `commands.execute` 로 `terra module install <경로> --grant-reviewed <요약>` ③ `DECIDE.tmodInstall.locked = false` 와 실행 코드.

### A8 — 단계와 안내

| 단계 | 끝남 | 실패 · 막힘 → 안내 |
| --- | --- | --- |
| 게시본 | 배정이 받아들여짐 | `MODULE_NOT_FOUND` — 이 Tree 에 그 모듈(버전)의 게시본이 없다 → Tree 에서 `terra module publish` · id · 버전 확인 |
| Master 배정 | 202 | 403 — `module.manage` 없음 · `PARTITIONED` · 그 밖 코드 그대로 |
| 제안 도착 | `offers.get` 에 그 id | 60초 넘게 안 옴 — 하트비트 · `module_distribution.enabled` 확인 / `stale` — 지정 해제 뒤 다시 |
| 동의 | 제안이 accepted · managed · pinned | 동의 대기 — 그 행의 동의 |
| 설치 · 기동 | `modules.get` 의 상태 running | failed — `last_error` · 로그 · 설치 용량 / 설치됨 · 멈춤 — 모듈 창에서 시작 |

## 3. 시안(캔버스)

- 문이 없으니 열린 것으로 그리고 결과는 '(시안)'. 설계 결정으로 닫은 것(노드 셸 · 파일 설치)은 시안에서도 닫힘.
- 등록 마법사는 이름이 `new` 로 시작하는 노드에서 보인다(그 밖은 등록됨).
- 배정: `missing` 이 들어간 id 는 게시본 없음, 나머지는 2.5초 뒤 제안 → 동의하면 2.5초 뒤 설치됨.
