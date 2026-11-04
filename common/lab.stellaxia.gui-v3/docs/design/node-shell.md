---
title: "노드 셸(실제 터미널) 설계 — 누가 · 어느 노드 · 무엇이 남는가 · 어떻게 잇는가"
aliases:
  - "노드 셸"
  - "실제 터미널"
  - "PTY 터미널"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[terminals|제어기의 두 터미널]]"
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
  - "[[desk-flows|제어기의 쓰기 흐름]]"
---

# 노드 셸(실제 터미널) 설계

제어기의 **노드 터미널**(그 노드의 OS 셸)은 잠겨 있다(`NODE_SHELL` — `web/src/api/shells.js`). 이 문서가 정하는 것 —
누가 열 수 있는가, 다른 노드에서 열 수 있는가, 무엇이 기록되는가, 어떤 길로 잇는가, 세션은 언제 끝나는가 — 가 결정되기 전까지는 열지 않는다.
**Terra 터미널**(`terra` 낱말 → 위임표의 읽기 operation)은 이 문서와 상관없이 열려 있다([[terminals]]).

> 이 문서는 설계 초안이다. 코어(Terra) 코드는 고치지 않았다. §7 의 결정이 나면 코어 쪽 ADR · 계약으로 옮긴다.

## 1. 왜 잠갔나 — 지금 있는 길과 그 문제

지금 Terra 에서 웹이 노드의 셸에 닿는 길은 하나다.

| | `terra.daemon.commands.execute.post` |
| --- | --- |
| 하는 일 | `command` + `args` 를 빈칸으로 이어 **시스템 기본 셸**(`/bin/sh -c` · `cmd /C`)에 한 줄로. 출력은 `tasks.by-task-id.output(.events)` |
| 권한 | `process.execute` · risk `dangerous` |
| 범위 | scope `local` — 이 GUI 를 띄운 노드만(Master 중계 밖) |
| 기록 | Daemon `audit.log` 의 `command.execute.accepted` · `finished` |
| 표준입력 · 크기 · 신호 | 없음(한 줄 실행 · 출력 읽기 · 취소만) |

modules #151 은 노드 터미널을 이 길로 돌렸다. 잠근 이유는 셋이다.

1. **권한이 너무 넓은 채로 웹에 열린다.** gui-v3 앱(`lab.stellaxia.gui-v3.web`)은 `process.execute` 를 선언한다(모듈 설치 단추가 `terra module install` 을 이 길로 돌리기 때문). 그래서 앱 토큰 하나면 **그 노드에서 무엇이든** 셸로 돈다. 모듈 설치처럼 화면이 만든 고정 명령과, 사람이 치는 임의 명령은 같은 권한으로 다루면 안 된다.
2. **실행 주체가 OS 사용자보다 높을 수 있다.** Windows managed 설치는 Daemon 이 승격(Highest) 작업으로 돈다. 그 Daemon 이 띄운 셸은 관리자 셸이다 — 같은 사용자의 비승격 웹 페이지가 관리자 실행을 얻는다(Terra 의 "승격 데몬 모듈 실행 EoP" 보고와 같은 꼴). Daemon 권한 낮추기(W1, 서비스 + named pipe)가 끝나기 전에는 셸을 웹에 열지 않는다.
3. **대화형이 아니다.** 한 줄마다 새 셸이라 `cd` 를 화면이 흉내 내야 했고, `vim` · `top` · 비밀번호 묻는 명령은 못 쓴다. "실제 터미널"이라 부르려면 PTY 가 있어야 한다.

## 2. 누가 열 수 있는가 — 권한

| 안 | 내용 | 판단 |
| --- | --- | --- |
| A. `process.execute` 그대로 | 지금 앱 선언으로 바로 열림 | **안 됨** — 1.1 의 문제 그대로. 모듈 설치용으로 받은 권한이 셸로 넓어진다 |
| B. 새 권한 `process.terminal` | PTY 세션 열기에만 쓰는 권한. 앱이 따로 선언하고, 사용자도 따로 가져야 한다 | **권장** |
| C. 관리자 역할 한정 | 노드 소유자 · Tree 관리자만 | B 와 함께 — 기본 정책으로 |

권장(B + C):

- **새 권한 `process.terminal`** — Daemon 계약의 PTY operation(§5)만 요구한다. `process.execute` 를 가진다고 생기지 않는다(반대도 같다). 권한 목록을 넓히는 일이라 코어 ADR 이 필요하다(§7 Q1).
- **실효 권한 = 앱 선언 ∩ 사용자 권한**(지금 규칙 그대로). gui-v3 는 결정 뒤에 `process.terminal` 을 선언에 더한다 — 이 PR 에서는 더하지 않는다.
- **기본 정책은 노드 소유자만** — Daemon 설정 `terminal.allowed_principals`(기본: 그 노드를 등록한 사용자). 넓히는 것은 그 노드의 설정(노드 소유자)만 한다.
- **여는 순간 셸 확인** — PTY 세션을 열 때마다 Scene 셸(웹이 아니라)이 "이 노드의 셸을 엽니다 · 누가 · 어느 노드" 카드로 한 번 묻는다. 웹은 비밀번호를 보지 않는다는 규칙과 같은 자리(셸)에서 사람이 확인한다. 웹 페이지 혼자서는 세션을 못 연다.
- **실행 주체는 로그인한 OS 사용자** — 승격된 Daemon 이 직접 셸을 띄우지 않는다. Linux 는 Daemon 사용자(이미 비승격), Windows 는 W1 이후의 사용자 세션 쪽 프로세스가 ConPTY 를 연다. W1 전에는 Windows 에서 `UNSUPPORTED` 로 거절한다.

## 3. 어느 노드에서 — 원격 허용

| 단계 | 범위 | 근거 |
| --- | --- | --- |
| 1단계 | **이 GUI 를 띄운 노드만**(scope `local`) | `commands.execute` 와 같은 경계. 스트림 티켓에는 노드 칸이 없다 — Gateway 는 로컬 provider 로만 잇는다(`streams.go`) |
| 2단계(따로 결정) | **직계 자식만**, 자식이 허락할 때 | Master 중계는 이미 직계 자식까지만 닿고, 자식은 `DelegationRequest`(intent + scope)를 자기 정책으로 다시 판정한다(`terra-protocol/delegation.go` — "the child's policy is final") |

2단계의 조건:

- 대상 노드 설정 `terminal.remote_allowed`(기본 **false**) — 그 노드 소유자만 켠다.
- 대상 Daemon 이 자기 계약의 scopes 로 다시 판정한다(지금 원격 operation 규칙 그대로). 부모는 "셸을 열어라"를 명령하지 못하고 intent 만 보낸다.
- 손자 이하는 열지 않는다(그 노드의 제어기를 그 Tree 에서 연다).
- 스트림이 노드를 넘으려면 Gateway 티켓에 대상 노드를 싣고 Master 중계 위에 양방향 프레임 길이 있어야 한다 — 지금 없다(§5.3).

## 4. 무엇이 남는가 — 감사

| 언제 | 어디에 | 무엇을 |
| --- | --- | --- |
| 열기 요청 · 허락 · 거절 | 대상 Daemon `audit.log`(`terminal.session.requested` · `opened` · `denied`) | 주체(principal) · 앱 id · 노드 · 세션 id · 셸 · 크기 · 원격이면 경유한 부모 노드 · 거절 이유 |
| 닫힘 | 같은 곳(`terminal.session.closed`) | 세션 id · 걸린 시간 · 닫힌 까닭(사용자 · 유휴 · 상한 · 로그아웃 · 토큰 폐기 · 프로세스 끝) · 종료 코드 · 주고받은 바이트 수 |
| 원격 세션 | 부모 Master 의 노드 이벤트에도 한 줄 | 누가 어느 자식에 셸을 열었는지(내용 없이) |
| 입력 · 출력 내용 | **기본 남기지 않음** | 비밀번호 · 비밀이 섞인다. `terminal.record`(기본 off)를 노드 소유자가 켜면 그 노드의 로그 폴더에 세션별 기록 — 사용자에게 "기록 중"을 늘 보인다 |

`audit.log` 는 지금 `command.execute.*` 를 남기는 바로 그 파일이다 — 새 저장소를 만들지 않는다.

## 5. 어떻게 잇는가 — 전송

### 5.1 operation(코어에 새로)

| operation | 권한 | 하는 일 |
| --- | --- | --- |
| `terra.daemon.terminal.sessions.post` | `process.terminal` | 세션 열기 요청 `{ shell?, cols, rows, working_dir? }` → `{ session_id }`(셸 확인 카드 뒤에만 성공) |
| `terra.daemon.terminal.sessions.get` | `process.terminal` | 내 세션 목록(다른 사람 것은 안 보임) |
| `terra.daemon.terminal.sessions.by-session-id.attach.get` | `process.terminal` | `output.mode: stream` — WebSocket 으로 붙는다 |
| `terra.daemon.terminal.sessions.by-session-id.delete` | `process.terminal` | 닫기(SIGHUP · ConPTY 닫기) |

### 5.2 길 — 이미 있는 스트림 티켓

`POST /api/v1/streams/tickets {operationId: …attach.get, input: {session_id}}` → `GET /api/v1/streams/{ticket}`(WebSocket).
Gateway 의 스트림 중계는 **이미 양방향**이다(`relayWebSocket` 이 두 쪽으로 펌프 · 티켓 30초 1회용 · 메시지 1 MiB · 유휴 60초 · ping 25초).
웹(`terra.js stream`)은 지금 받기만 하므로 보내는 쪽을 더한다. 프레임:

```
웹 → 노드   {"t":"in","d":"<base64>"} · {"t":"resize","cols":120,"rows":32} · {"t":"signal","sig":"INT"}
노드 → 웹   {"t":"out","d":"<base64>"} · {"t":"exit","code":0} · {"t":"closed","reason":"idle"}
```

- PTY: Linux · macOS 는 `openpty`(Go `creack/pty`), Windows 는 ConPTY(`CreatePseudoConsole`, Windows 10 1809 이상).
- 화면: 웹은 터미널 그리기(xterm.js 같은 것)를 들여온다 — 결정 뒤 gui-v3 쪽 일.

### 5.3 원격(2단계)에 모자란 것

스트림 티켓에 대상 노드가 없고, Master 중계는 요청 · 응답 봉투만 나른다. 원격 셸에는 "Master 중계 위의 양방향 스트림"이 새로 필요하다 — 1단계와 따로 설계한다.

## 6. 세션 수명

| 무엇 | 값(안) | 까닭 |
| --- | --- | --- |
| 유휴 | 15분 입력 없으면 닫음 | 열어 둔 셸을 잊는 일을 막는다 |
| 상한 | 8시간 | 토큰 수명보다 길게 붙잡지 않는다 |
| 끊김 | WebSocket 이 닫히면 PTY 도 닫음(1단계는 다시 붙기 없음) | 주인 없는 셸이 남지 않게. 다시 붙기(detach · attach)는 따로 결정 |
| 로그아웃 · 토큰 폐기 · 앱 토큰 새로 받기 실패 | 즉시 닫음 | 스트림의 "자격이 아직 살아 있는가" 검사(`streamCredentialAlive`)를 세션 동안 주기적으로 |
| 동시 세션 | 주체 · 노드마다 3개 | 자원 · 실수 상한 |
| Daemon 재시작 · 업데이트 | 모든 세션 닫음(`closed` 이유 `daemon_restart`) | 셸 프로세스를 넘겨받지 않는다 |

## 7. 결정할 것

| # | 질문 | 권장 |
| --- | --- | --- |
| Q1 | 권한 — 새 `process.terminal` 인가, `process.execute` 로 충분한가 | 새 권한(§2). 코어 ADR 필요 |
| Q2 | 1단계에 원격(직계 자식)을 넣는가 | 넣지 않음 — 로컬만 먼저(§3) |
| Q3 | 입력 · 출력 기록 기본값 | off, 노드 소유자가 켬(§4) |
| Q4 | 여는 사람 기본값 | 노드 소유자만(§2) |
| Q5 | Windows 를 W1(Daemon 권한 낮추기) 전에 여는가 | 열지 않음(§2) |
| Q6 | 그동안 `commands.execute` 한 줄 실행을 "노드 명령"으로 따로 열까 | 열지 않음 — 1.1 · 1.2 가 그대로 걸린다. 필요하면 Q1 과 같은 새 권한 아래로 |

## 8. 결정 뒤 할 일

- 코어(Terra): ADR(권한 · 감사 · 수명) → Daemon 계약에 §5.1 operation → PTY 구현(Linux 먼저) → `audit.log` 사건 → Gateway 는 바꿀 것 없음(1단계).
- gui-v3: `module.json` 앱 권한에 `process.terminal` · `terra.js stream` 에 보내기 · 터미널 그리기 · `NODE_SHELL.locked = false` 와 잠금 시험 바꾸기.

## 9. 화면 흐름(0.2.0 — 그려 둠, 마지막 단추만 잠김)

결정 전에도 화면은 다 그려 둔다. 잠금 판의 **열기 확인 단계 ›** 로 걸어 보고, 마지막 **셸 열기**만 이 문서의 결정(§7)까지 잠긴다(why = `NODE_SHELL.reason` — 이 문서). 확인 단계는 제어기의 공용 대화상자([[desk-flows]] §1)다.

| 단계 | 보이는 것 | 체크 |
| --- | --- | --- |
| 1 무엇이 되는가 | 노드(이 노드에서만 — 원격 제어기면 1단계는 안 된다는 줄) · 셸(로그인한 OS 사용자의 PTY · Windows W1 전 거절) · 수명(유휴 15분 · 상한 8시간 · 다시 붙기 없음, §6) · 감사(`audit.log` `terminal.session.*`, §4) · 내용(기본 남기지 않음 · 켜면 "기록 중") | 이 노드에서만 열리고 그 노드에 남는다 |
| 2 권한 경고 | 권한 `process.terminal`(제안 — `process.execute` 로는 열지 않는다) · 위험도 dangerous(빨간 띠) · 누가 보나(나 · 노드 소유자 · 원격이면 부모 Master 이벤트 한 줄) · 여는 사람 기본값 · 셸(main Scene) 확인 카드 | 친 명령은 되돌릴 수 없다 |
| 3 두 터미널 구분 | 미리 보기 둘 — 노드 셸: 노란 줄무늬 띠 · 머리 표지 `OS 셸 · 이 노드` · 프롬프트 `사용자@노드:~$`(노랑) / Terra 터미널: 파란 띠 · `Terra API` · `terra[노드]>`(파랑) | — |
| 셸 열기 | 잠금 상자 — why · 결정되면 `terra.daemon.terminal.sessions.post` 의 문(gate)이 연다 | — |

창 자체도 같은 표지를 단다 — 제어기의 노드 터미널 창 머리에 노란 줄무늬 띠와 `OS 셸 · 이 노드`, Terra 터미널 창에 파란 띠와 `Terra API`.
결정 뒤 바꿀 곳: `NODE_SHELL.locked`(shells.js · 보드 사본) · 셸 열기의 실행(스트림 · 터미널 그리기, §8).
