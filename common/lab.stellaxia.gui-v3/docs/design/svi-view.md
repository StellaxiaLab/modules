---
title: "자원 상태 창의 값 보기 — 형식별 뷰어 · 구독"
aliases:
  - "SVI 값 보기"
  - "자원 값 뷰어"
  - "ResStatus 값"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[svi-make|SVI 창]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
---

# 자원 상태 창의 값 보기 — 형식별 뷰어 · 구독

자원 상태 창(ResStatus)의 **값** 칸. 내보내는 끝점마다 탭, 끝점의 형식(`output_schema`)으로 뷰어를 고른다. 틀은 `web/src/api/svi-view.js`(+ 시험), 보드 조각 `build/parts/resstatus`(시안 사본은 `tests/resstatus.test.mjs` 가 src 와 같은지 본다).

## 1. 형식 → 뷰어 (`viewerOf`)

| 뷰어 | 형식(Terra 가 쓰는 이름) | 보이는 것 |
| --- | --- | --- |
| 영상 | `terra.video.*`(`frame@1` · `rgb24@1` · `h264@1`) | 마지막 프레임 · fps · 프레임 크기. jpeg · png · webp · gif · svg 인코딩만 그린다 — h264 · nv12 · rgb24 는 "브라우저에서 바로 풀 수 없는 인코딩" |
| 그림 | `terra.image.*`, 또는 그림 인코딩 | 마지막 그림 |
| 수치 | `terra.<무엇>.sample · level · metric · number · gauge · scalar@N` (**제안 — Terra 에 수치 형식이 아직 없다**) | 큰 현재값 · 최근 60개 막대 · 최소 · 평균 · 최대. 프레임은 글 수 또는 `{"value": n}` |
| 글 · 로그 | `terra.text*`, `*.line · *.log`, `text/*` 인코딩 | 줄 꼬리(최근 200줄 중 14줄) · **꼬리 멈춤**(받기는 계속, 화면만 멈춤) |
| 사건 | `terra.input.*` · `terra.button@1` · `terra.process.status@1` · `terra.camera.status@1` · `terra.detection.objects@1` · `terra.inference.*` …, `application/json` 인코딩 | 시각 · 종류(type · kind · event · state) · `키=값` 요약 목록 |
| 바이트 | `terra.bytes@1`(file · process · net 어댑터 모두) · `terra.file.content@1` · `terra.audio.*` · 모르는 형식 | 마지막 조각 헥스 + 글자(16 바이트 × 8줄) |

머리 줄: 형식 · 인코딩 · 뷰어 · 프레임 수 · 마지막 순번 · fps · 받은 양 · **빠짐 n**(순번이 건너뛴 수 — realtime 품질의 버림을 숨기지 않는다).

## 2. 구독 — 핸들 열기 → events

`createSviWatch(terra)`(= `window.TerraSviWatch`):

1. `terra.master.svi.handles.post { resource_id, endpoint_id, operation: subscribe, qos_profile: realtime_latest, idempotency_key, ttl_seconds: 3600 }` → `handle_id`
2. `terra.stream('terra.master.svi.handles.by-handle-id.events.get', { handle_id })` — `event: status | frame`, data = `StreamMessage{ kind, handle_id, state, reason, sequence, schema_ref, encoding, data(base64) }`
3. 끊기면 같은 핸들에 다시 붙는다(1 · 2 · 4 … 30초), 핸들이 사라졌으면(404 — Master 재시작에 사라지는 soft state) 새로 연다, 4xx 는 멈추고 이유
4. 멈춤 → 스트림 닫고 `handles.by-handle-id.delete`

구독 표시: **멈춤 · 여는 중 · 받는 중 · 끊김 · 다시 붙는 중(n번째) · 끊김 · 원천 쪽 복구 중(degraded) · 닫힘/거절/실패/만료 + 사유**. 실제 모드는 열자마자 열지 않고 **구독 시작**을 눌러야 연다(핸들 열기는 감사되는 쓰기).

## 3. 지금 — 위임 밖이라 잠금

세 op(`svi-view.js` `WATCH_OPS`)는 Master 계약에 있으나 `delegated-session` 이 아니다. 실제 모드는 `window.TerraGateAll(WATCH_OPS)` 의 why 를 뷰어 자리에 그대로 보이고, 대신 **쓰는 곳**(`svi.handles.get` 10초 조회 — 누가 어느 끝점을 어떤 품질로 열어 쓰는지)을 아래에 둔다. 코어가 세 op 를 위임에 열면 `npm run gen:master-delegated` 로 표만 다시 뽑으면 뷰어가 붙는다(`tests/master-delegated.test.mjs` 의 `GATED` 에서 빼라고 빨개진다).

시안은 끝점마다 같은 `StreamMessage` 모양의 가짜 흐름을 같은 `reduceView` 에 넣는다 — 40초마다 3초 끊겼다가 다시 붙는다. 실제 모드로는 새지 않는다(`tests/resstatus.test.mjs`).
