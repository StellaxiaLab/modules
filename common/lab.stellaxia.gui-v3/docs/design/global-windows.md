---
title: "전역 틀의 창 — 알림 창 · 자원 추이 · 설정 창 나눔"
aliases:
  - "알림 창"
  - "자원 추이"
  - "설정 창 나눔"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
  - "[[node-data|노드 데이터 층]]"
  - "[[terminals|제어기의 두 터미널]]"
---

# 전역 틀의 창 — 알림 창 · 자원 추이 · 설정 창 나눔

design-ops-gaps 의 L4(알림 자리만) · H7(그래프 · 모듈 사용량 시안) · H6(설정 창 시안)을 메운 결정.

## 1. 알림 창 (보드 `Alarms` · 조각 `alarms` · 자리 24)

- **전역 하나** — 노드마다가 아니라 이 GUI 를 띄운 노드(로컬 Daemon)의 알림. 여는 곳: 전역 틀 설정 › 알림. 창 이름 = 로컬 노드 이름 · 종류 '알림'.
- 원천은 그대로 `src/api/alarms.js` — `terra.daemon.tasks.get` · `terra.daemon.modules.get` 을 10초마다(밀어 받기가 오면 바로) 읽어 **바뀐 끝 상태만**.
  알림 한 줄 = `{ at, kind, id, g, c, m, sev, st, name, key, read }`. `sev` 는 ok · warn · bad(거르기 '실패만'과 색).
- **알림 책**(`createAlarmBook`) — 같은 배열을 고쳐 쓰고(`window.TerraAlarms` 가 같은 것을 쥔다) 바뀌면 `'terra-alarms'` 신호. `window.TerraAlarmBook`.
  읽음 · 지움은 **이 브라우저 메모리에만** — Terra 에 알림 상태가 없다(새로 띄우면 처음부터).
- 화면: 시각 · 기호(g/c) · 종류(작업 · 모듈) · 내용 · 대상. 거르기 전체 · 작업 · 모듈 · 실패만 · 안 읽음(수와 함께).
  거른 것 모두 읽음 · 지우기 — 지우기는 두 번 누르기(무엇을 · 어디: 이 화면의 목록, Terra 의 작업 · 모듈은 그대로 · 되돌리기 못 함).
- 줄 누르기 = 읽음 + 대상으로: 작업 → 제어기 › 작업 관리자(그 작업을 고른 채, `launch="jobs:<id>"`), 모듈 → 모듈 상태 창.
- 안 읽은 수 — 전역 틀 전역 제어의 '설정' 폴더 · '알림' 줄 옆 `● n`.
- 시안: `diff()` 모양 그대로의 시안 알림(`window.TerraAlarmDemo` — 배지가 읽는다). 실제 모드는 시안 책을 만들지 않고, 로그인 전이면 까닭을 적는다.

## 2. 제어기 `launch` 속성

`NodeDesktopEmbed` 가 `launch="앱:세부@번호"` 를 받으면 그 앱을 한 번 띄운다(번호가 바뀔 때마다). `jobs:<작업 id>` · `set:<설정 탭>`.
전역 틀 `ctlOpenWin(node, R, 'ctl', '<앱:세부>')` 가 넘긴다. 씬 제어기 자리는 `mkglobal.py` 가 같은 속성을 단다.

## 3. 자원 추이 (`src/api/metrics.js` · `window.TerraMetrics`)

- 코어에 노드별 실시간 지표 op 가 없다. 있는 것은 Master 노드 기록의 **하트비트 자원 스냅샷**(cpu · memory · disk %, `last_heartbeat_at`)뿐.
- main.js `refreshTopology`(30초마다 · 탭이 보일 때만)가 받을 때마다 노드마다 고리 버퍼(cap 120)에 쌓는다 — **같은 하트비트는 하나로**. `'terra-metrics'` 신호.
- 전역 틀 부하(실제): CPU · MEM 막대(마지막 스냅샷) · 추이(CPU 점열, 모자란 앞자리 `·`) · NET `—` + '코어: 실시간 지표 op 없음' ·
  **갱신 주기 줄** '하트비트 스냅샷 · 30초마다 · n초 전'. 실시간인 척 움직이지 않는다(시안 그래프만 움직인다).
- Master 노드 모델에 `network_rx_bytes` · `network_tx_bytes` 칸은 있지만 Daemon 이 채우지 않는다 — 채우면 스냅샷 차로 처리량을 낼 수 있다(지금은 `—`).
- 모듈 상태 창(실제): CPU · MEM `—` + '코어: 모듈별 … op 없음', 가동 = 모듈 상태의 `started_at`(+ pid · 다시 시작 수),
  최근 로그 = `terra.daemon.modules.by-module-id.logs.get { module_id, tail: 40 }`(노드 데이터 층 · 5초 · 최근 12줄 — 제어기 › 모듈 › 로그와 같은 길).

## 4. 설정 창(NodeConf) — 나눈다, 편집은 한 곳

- 노드 설정(Daemon `config.get` · `schema` · `patch`) **편집은 제어기 › 설정 › 노드 설정 한 곳**.
- 실제 모드의 설정 창: GUI 구역(표시 · 프로필 · 스킨 · 뷰 · Tree 로그인)은 그대로. Terra 구역은 **노드 요약**(표시 이름 · 역할 · 노드 ID · 부모 ·
  상태 · 코어 버전 · Master 주소 · 등록 — Master 노드 기록 · 로컬 Daemon 등록 상태, Master 주소 · 등록은 로컬 노드만)과 '제어기 › 설정 열기'
  (`onOpen('ctl', 'set:node')`). Tree 노드는 **Tree 요약**(Master 노드인가 · 바로 아래 노드) + 'Tree 웹 콘솔' 안내. Leaf › 자원은 길 안내 그대로.
- 시안 설정 값 · '(시안)' 적용 · 다시 시작 · 사용자 · 등록 코드 · 경보는 실제 모드에 없다. 시안 모드는 그대로.
