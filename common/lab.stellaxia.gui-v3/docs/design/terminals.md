---
title: "제어기의 두 터미널 — 노드 터미널 · Terra 터미널"
aliases:
  - "노드 터미널"
  - "Terra 터미널"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-02"
language: "ko-KR"
related:
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[net-props|네트워크 속성 창]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
---

# 제어기의 두 터미널 — 노드 터미널 · Terra 터미널

제어기(노드 데스크톱)의 터미널은 하나였고, 실제 모드에서도 고정 출력이었다([[design-ops-gaps|격차]] H3). 둘로 나눈다.

| | 노드 터미널 | Terra 터미널 |
| --- | --- | --- |
| 무엇 | 그 노드의 OS 셸(/bin/sh -c · cmd /C) | Terra CLI 의 `terra shell` 과 같은 낱말의 명령 해석기 |
| 프롬프트 | `계정@노드:폴더$` | `terra[현재 노드]>` |
| 실제로 부르는 것 | `terra.daemon.commands.execute.post` → `tasks.by-task-id.output.get`(끝날 때까지) · Ctrl+C = `tasks.by-task-id.cancel.post` | 같은 이름의 operation — `master.nodes` · `network.status/state` · `route.graph/candidates/sessions` · `network.probes` · `daemon.modules` · `daemon.tasks` · `daemon.status` · `gateway.agent.whoami`, 그리고 `api <operation-id>` |
| 권한 | `process.execute` | 각 operation 의 권한(대개 `node.read`) |
| 어느 노드 | **이 GUI 를 띄운 노드만** — `commands.execute` 는 계약상 scope `local`(Master 중계 밖) | 어느 노드든 — Master 읽기는 로컬 Gateway, Daemon 읽기는 Master 중계(직계 자식) |
| 셸 낱말 | `clear` · `exit` · `cd`(화면이 기억해 `working_dir`) | `help` · `clear` · `history` · `!!` · `!<n>` · `set var` · `vars` · `use <노드>` · ↑ |

- 코드: `web/src/api/shells.js`(+ `shells.test.mjs`) · 보드 `NodeDesktopEmbed.dc.html`(앱 `term` · `tterm`, 아래 바 · 앱 목록 · 바탕화면 · 우클릭) · `window.TerraShells`
- 근거: Terra `docs/reference/cli/terra-cli-command-reference.ko.md`(`terra shell` · `terra api` · 명령 이름), Daemon 계약 `terra-api.json`(`commands.execute` 의 scope · 입력 · 출력 읽기)
- 시안(캔버스): 둘 다 머리줄에 `시안` — 몇 명령만 예시 출력, 나머지는 `(시안) … 실제 연결에서`

## 코어에 남은 것 — 지금 Terra 로는 안 되는 것

| 바라는 것 | 지금 | 코어에서 바뀌어야 할 것 |
| --- | --- | --- |
| 다른 노드의 셸 | `commands.execute` 가 scope `local` — 이 GUI 를 띄운 노드에서만 | 원격 명령 실행(relay `process.execute.request`)을 Gateway operation 으로(scope `cluster`) |
| 대화형 셸(vim · top · 비밀번호 입력) | 한 줄씩 실행 · 출력만 읽음, 표준입력 없음 | PTY 세션 operation(열기 · 입력 · 크기 · 닫기)과 스트림 |
| CLI 와 완전히 같은 Terra 터미널 | GUI 가 명령 일부를 operation 으로 옮김 | `terra shell` 을 원격으로 여는 길(또는 CLI 명령 → operation 표를 계약으로) |
