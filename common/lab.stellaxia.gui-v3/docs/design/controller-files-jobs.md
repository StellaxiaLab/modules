---
title: "제어기의 파일 · 작업 · 밀어 받기 — 내용 열기 · 전송 · 출력 따라가기 · 바뀐 줄"
aliases:
  - "파일 전송"
  - "작업 출력 따라가기"
  - "Master 작업"
  - "밀어 받기 표시"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-04"
language: "ko-KR"
based_on:
  - "io.terra.file 0.2.1 contracts/api/terra-api.json — entries.read · transfers.create · transfers.chunks.put/get · transfers.complete · transfers.pulls.create/complete/abort · transfers.abort"
  - "Terra docs/modules/terra-file/design/terra-file-transfer-design.md §5(청크 · 재개 · stall)"
  - "Daemon 계약 — terra.daemon.tasks.by-task-id.output.events.get(SSE · local) · output.get(cluster) · events.get(SSE)"
  - "Master 계약 — terra.master.jobs.get · jobs.by-job-id.get · .cancel.post · .rerun.post(위임 표)"
  - "Gateway — operation invoke 를 Accept: text/event-stream 으로 부르면 SSE 를 흘려 준다(server.go relayInvocation · stream.go). 스트림 티켓(WebSocket)은 SSE 제공자를 나르지 못한다"
related:
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
  - "[[terminals|제어기의 두 터미널]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
---

# 제어기의 파일 · 작업 · 밀어 받기

제어기(노드 데스크톱 `NodeDesktopEmbed`)의 파일 관리자는 목록만, 작업 관리자는 3초 폴링 출력만, 밀어 받기는 사본을 말없이 바꿨다. 셋을 실제 op 로 잇는다.

## 1. 파일 내용 · 전송 — 공유 폴더(io.terra.file)에서만

| 하는 일 | op(입력) | 권한 | 화면 |
| --- | --- | --- | --- |
| 미리보기 | `entries.read {root, path, offset, length}` 512 KiB 씩 앞에서부터 | file.read | 글: 앞 64 KiB · 고정폭 · 이진(NUL)이면 정보로 / 그림: 4 MiB 까지 objectURL / 그 밖: 정보 + 내려받기 |
| 올리기 | `transfers.create {direction: push, size_bytes, checksum_sha256, mode, resume_id?}` → `transfers.chunks.put {transfer_id, offset, data, sha256}` × n → `transfers.complete` | file.write | 올리기 단추(숨은 `input[type=file]` · 여러 개) · 목록 위로 끌어다 놓기 |
| 내려받기 | `transfers.pulls.create {root, path, resume_id?}` → `transfers.chunks.get {transfer_id, offset}` × n → `transfers.pulls.complete` | file.read | 받으면 브라우저 저장 · 전송 줄의 '저장' 으로 다시 |
| 취소 | `transfers.abort` · `transfers.pulls.abort {reason: cancelled}` | — | 전송 줄 '취소' |

- **청크 크기는 응답의 `chunk_size` 그대로** — Gateway 본문 1 MiB 는 모듈이 640 KiB 상한으로 지킨다. 재개 지점은 응답 `transfer.offset`(설계 문서의 `resume_offset`).
- 거절 `CHUNK_OUT_OF_ORDER` · `CHUNK_CHECKSUM_MISMATCH` 는 `retry_offset` 부터(Gateway 를 거쳐 빠지면 `transfers.get` 의 offset), 같은 offset 3번까지.
- 받았다면서 나아가지 않음 · 빈 청크인데 `eof` 아님 → `TRANSFER_STALLED` 로 멈추고 abort(설계 §5.6 — 무한 루프 방지).
- 실패(끊김 · 만료)는 전송을 지우지 않는다 → '다시' 가 `resume_id` 로 이어 간다. 취소는 abort(부분 파일도 지움) → '다시' 는 새 전송.
- `FILE_TARGET_EXISTS`(create 모드) → '덮어쓰기…' → 두 번째 누름('정말 덮어쓰기 — 되돌릴 수 없음')에 `mode: overwrite`.
- 브라우저가 파일 전체 SHA-256 을 한 번에 계산한다(crypto.subtle 은 흘려 계산하지 못함) — **올리기 · 내려받기 256 MiB 까지**, 넘으면 `terra file send/get` 안내.
- **잠금**: 로컬 탐색(Daemon local-fs)은 읽기 op 가 없다 → 미리보기 · 내려받기 · 올리기 잠금 + 이유. 실제 모드의 바탕화면은 화면 전용 바로가기 → 잠금. 끊긴 노드 → 읽기 전용. 다른 노드는 그 노드의 io.terra.file 로(Master 중계 — scopes local · node) — 없으면 Gateway 의 `MODULE_NOT_FOUND` · `MODULE_ROUTE_NOT_FOUND` 를 그대로.
- 시안(캔버스)은 가짜 진행으로 흉내 — '· 시안' 표시, 실제 모드에서는 시안 전송 줄을 보이지 않는다. 시안 미리보기는 내용을 지어내지 않고 무엇이 보일지만 말한다.

구현: `web/src/api/file-transfer.js`(순수 함수 + 실행기 · 시험 `file-transfer.test.mjs`), 보드는 `window.TerraFileTransfer`.

## 2. 작업 출력 따라가기 · Master 작업

작업 관리자를 **이 노드 작업 / Master 작업** 탭으로 나눈다.

**이 노드 작업** — 줄을 고르면 아래에 로그 창.

| 노드 | 길 |
| --- | --- |
| 이 노드 | `terra.daemon.tasks.by-task-id.output.events.get` SSE — `output {stream, at, text}`(id = seq) · `gap` · `state` · `end` · `overflow`. 닫히면 `last_event_id` 로 다시 붙는다(다섯 번 넘게 끊기면 폴링). 429 `TOO_MANY_STREAMS`(task 4 · 노드 32) → 폴링 |
| 다른 노드 | `output.get` 3초마다 `after_seq`(같은 seq 공간) — relay 는 스트림을 나르지 못한다(local 전용) |

- 로그 줄: 시각(HH:MM:SS) · stdout 은 기본 글색, stderr 는 붉게 · gap/overflow 는 노란 안내 줄 · 끝나면 `■ 끝 · 성공/실패/취소됨/시간 초과 · exit N`.
- **따라가기 · 멈춤**: 따라가기 = 끝에 붙어 있음(`column-reverse`). 위로 올리면 저절로 멈춤 — 보이는 줄을 그대로 두고(밀리지 않게) 새 줄 수만 배지(`새 줄 N ↓`). 배지 · '따라가기' 로 다시 끝으로. 화면에 둘 줄 2000(넘으면 앞을 버리고 센다).
- 창을 닫거나 다른 작업 · 노드로 가면 구독을 끊는다.

**Master 작업** — `jobs.get`(이 노드로 간 것 `node_id` / 전부) · 줄을 고르면 `jobs.by-job-id.get` 상세(종류 · 대상 · 시각 · 명령 · 결과 · 출력). 취소(대기 · 보냄 · 진행 중) · 다시 보내기(끝난 process.execute 만)는 **확인 단계** — 무엇을 · 어디에 · 되돌리기 + 위험도(`TerraRisk`, 표에 없으면 취소 '쓰기' · 다시 '위험'). 다시 보내기는 `{confirmed: true}` 를 싣고, 정책이 확인을 요구하면(`confirmation_required`) 확인 id 만 알린다(이 화면에서 확인하지 않음). 문(`TerraGate`)이 닫으면 단추 · 목록을 잠그고 이유.

구현: `web/src/api/task-follow.js`(로그 값 · 따라가기), `web/src/api/sse.js` · `terra.sse()`, 보드는 `window.TerraTaskFollow(노드 키, task id, onUpdate)`.

## 3. 밀어 받기 반영 — 바뀐 곳 표시

- **이벤트 길을 고쳤다**: Daemon `/events` 는 SSE 와 WebSocket 을 내지만 Gateway 는 SSE 만 나른다(계약 설명). `push.js` 는 `terra.sse` 로 읽고 다시 붙을 때 `last_event_id` 를 싣는다. `reset`(보관 범위 밖)이면 그 노드의 사본을 전부 다시 받는다. 이전의 `terra.stream`(스트림 티켓 · WebSocket)은 SSE 제공자에 닿지 않았다.
- **데이터 층은 그대로**: 사본이 바뀌면 `TerraNodes.subscribe` 로 이미 다시 그린다. 보드가 그릴 때 목록마다 지난 서명(id → 상태)과 견준다(`changes.js` `diffSigns` — 보드에 같은 사본 `CHG`, 시험이 같은 답을 본다).
- 달라진 줄: **1.2초 깜박임**(`@keyframes nxFl` — 옅은 파랑 + 왼쪽 선) + 2.4초 **'새로' · '바뀜'** 배지. 처음 보는 목록 · 받는 중인 목록은 깜박이지 않는다. 움직임 줄이기 설정이면 깜박임 대신 선만.
- 적용 목록: 작업(상태) · Master 작업(상태) · 파일(크기 · 수정 시각, 폴더마다) · 모듈(상태 · 버전 — 마크업을 건드리지 않고 `.nx-li::after` 배지).
