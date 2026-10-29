---
title: "GUI v3 웹 구조 — 장면 층(WebGL2 · Worker)과 창 층(DOM · signals)"
aliases:
  - "웹 구조"
  - "gui-v3 web architecture"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-29"
language: "ko-KR"
based_on:
  - "캔버스 'Terra GUI v3' 버전 254의 Scene.dc.html(fieldRec · glyphAtlas · fieldFlush)"
  - "Terra main 2026-10-28 — Gateway gui_apps.go(appAssetCSP · capabilities), Daemon 계약 terra-api.json"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
  - "[[backend|v3 모듈 백엔드 설계]]"
  - "[[menu-hierarchy|메뉴 계층 설계]]"
  - "[[settings-inventory|GUI v3 설정 종합]]"
---

# GUI v3 웹 구조

**결정: 웹으로 간다.** 다른 엔진(Godot · Unity 따위)에서 만들어 웹으로 내보내지 않는다. 대신 웹 안에서 무거운 것(장면)을 GPU 층으로 떼고,
계산은 Worker 로, 창은 DOM 으로 둔다. 이 문서는 그 구조와 첫 단계(글자 장 렌더러)를 적는다.

## 1. 왜 웹인가

| 질문 | 답 |
| --- | --- |
| 화면이 어디서 도는가 | Gateway 가 앱마다 origin 을 나눠 내주는 **샌드박스 웹앱**(`contributions.gui.apps`)이다. 런처도 Windows 는 WebView2, 나머지는 브라우저 앱 모드다 — 결국 브라우저 |
| 다른 엔진의 웹 내보내기는 | 같은 브라우저에서 WASM + WebGL 로 돈다 — 쓸 수 있는 GPU 는 같다. 대신 런타임 수십 MB, 느린 첫 로딩, 한글 IME · 글자 · 복사 · 접근성의 약함, 모듈 GUI 앱(각자 웹앱)과 섞기 어려움을 떠안는다 |
| 창들은 | 설정 · 자원 · 모듈 창은 폼과 목록이다 — DOM 이 가장 잘한다 |
| 무거운 계산은 | Gateway 의 앱 capabilities 에 `workers` · `wasm` 이 있다. 필요할 때 웹 안에서 WASM 으로 |

부하는 엔진이 아니라 **그리는 방식**에서 나왔다 — 시안의 글자 장은 Canvas 2D 로 칸마다 CPU 가 그렸고, 창은 상태 하나에도 컴포넌트 전체를 다시 맞췄다.
그래서 고칠 곳도 그 둘이다.

## 2. 구조

```mermaid
flowchart TB
  subgraph Main["메인 스레드"]
    Boot["boot/main.js"]
    Scene["장면 코드<br/>(트리 · 리프 · 리소스 뷰 — 이식 예정)"]
    Rec["recorder()<br/>캔버스 꼴 기록기"]
    Grid["FieldGrid<br/>glyph · color · flags (형식 배열)"]
    Host["FieldHost<br/>렌더러 고르기"]
    Win["WindowLayer<br/>DOM 창 · signals"]
    Api["api/terra.js<br/>operation invoke · stream"]
  end
  subgraph Worker["Worker"]
    FW["field-worker.js"]
    GL["FieldGL (WebGL2)<br/>인스턴스 2번"]
    AT["GlyphAtlas<br/>알파 마스크 타일"]
  end
  Scene --> Rec --> Grid --> Host
  Host -- "배열 transfer" --> FW --> GL
  GL --> AT
  Host -. "Worker 를 못 쓰면" .-> GL2["FieldGL / Field2D<br/>(메인 스레드)"]
  Win --> Api
  Api --> GW["Gateway<br/>/api/v1/operations/{id}/invoke<br/>/api/v1/nodes/{node}/operations/{id}/invoke"]
```

| 층 | 자리 | 하는 일 |
| --- | --- | --- |
| 장면 층 | `src/scene/` | 장면 코드가 칸 모델에 그리고, 렌더러가 GPU 로 낸다. 되면 Worker 의 OffscreenCanvas, 안 되면 메인의 WebGL2, 그것도 안 되면 Canvas 2D |
| 창 층 | `src/ui/` | 장면 위 DOM 창. 값(signal)에 묶인 자리만 고친다. 창을 끌어도 장면을 다시 계산하지 않는다 |
| API | `src/api/` | Gateway 하나로 operation 을 부른다. 원격 잠금 표는 Terra 계약에서 뽑는다 |
| 입구 | `src/boot/` | 두 층을 세우고 크기 · 글꼴 변화를 잇는다 |

## 3. 장면 층 — 글자 장

### 3.1 칸 모델

시안은 칸마다 문자열 셋(색 css · 글자 · 굵기)을 배열로 들었다. 웹 빌드는 같은 내용을 형식 배열로 든다 —
Worker 로 복사 없이 넘기고(transfer), GPU 버퍼에 그대로 올린다.

| 배열 | 꼴 | 뜻 |
| --- | --- | --- |
| `glyph` | Uint32 | 코드 포인트, 0 = 바탕만 |
| `color` | Uint32 | `0xRRGGBBAA` |
| `flags` | Uint8 | 비트 0–1 굵기(보통 · 볼드 · 틀 미디움 · 틀 볼드), 비트 2 구멍, 비트 3 넓은 글자 |

장면 코드는 바꾸지 않는다 — `recorder()` 가 캔버스와 같은 꼴(`fillStyle` · `font` · `fillText` · `clearRect`)을 내므로, 시안의 장면 코드를 옮겨 와 그대로 그린다.
DOM 을 쓰지 않아 Worker 에서도 돈다.

### 3.2 렌더러

| | 시안(Canvas 2D, `Field2D`) | 웹 빌드(WebGL2, `FieldGL`) |
| --- | --- | --- |
| 매 프레임 | 칸 1.3만 개를 지난 프레임과 견주고, 바뀐 칸만 바탕 사각형 + 글자 타일 붙이기 | 칸 데이터를 버퍼에 한 번(칸당 8바이트) 올리고 인스턴스 두 번(바탕 · 글자)으로 **통째로** |
| 타일 열쇠 | 글자 × **색** × 굵기 — 색이 흐르면 타일이 끝없이 늘어 색을 묶어야 했다(qcss) | 글자 × 굵기 — 색은 셰이더가 입힌다. 타일 수가 글자 종류 수에서 멈춘다 |
| 찌꺼기 | 비교가 놓친 칸에 남을 수 있어 매 프레임 가로줄 하나를 다시 그렸다(보험) | 통째로 그리므로 생기지 않는다 |
| 칸 경계 | 기기 픽셀로 반올림 | 같은 규칙(셰이더의 `floor(c · cw · dpr + 0.5)`) — 배율 1.25 · 1.5 화면에서도 칸이 픽셀에 맞는다 |
| 글자 샘플 | `drawImage` 1:1 | `texelFetch` 1:1 — 필터링으로 번지지 않는다 |

같은 프레임을 두 렌더러로 그려 픽셀을 견줬다(1440×900 일부, 'labels' 부하): 평균 차이 0.6 / 1020(배율 1) · 0.38(배율 2),
크게 다른 픽셀 0개(배율 1) · 27개/92만(배율 2, 한글 가장자리 안티에일리어싱). 눈으로 같은 화면이다.

### 3.3 Worker

`FieldHost` 가 캔버스를 `transferControlToOffscreen()` 으로 Worker 에 넘긴다. 메인 스레드에 남는 일은 칸 배열 복사(13만 바이트 남짓)와 `postMessage` 뿐이다.
버퍼는 두 벌을 돌려 쓰고(ping-pong), 두 벌이 다 나가 있으면 그 프레임은 건너뛴다(`dropped`).

Worker 는 앱 origin 의 파일로 띄운다 — Gateway 앱 CSP(`script-src 'self'`)가 이미 허락하므로 `capabilities: ["workers"]`(blob: Worker 용)가 **필요 없다**.
Vite 가 `new Worker(new URL('./field-worker.js', import.meta.url), { type: 'module' })` 꼴을 보고 따로 굽는다(`ui/assets/field-worker-*.js`).

**다음 단계** — 장면 계산(트리 배치 · 융기 · 워프 · 노이즈)도 Worker 로. 장면 코드는 기록기에 그리므로 그대로 옮겨진다. 그러면 메인은 입력(카메라 · 포인터 · 데이터)만 보낸다.
JS 로 모자란 곳이 측정으로 드러나면 그 부분만 Rust/C++ → WASM(`capabilities: ["wasm"]`).

## 4. 측정

`npm run bench`(= `node tools/bench-field.mjs`) — 같은 부하(`src/scene/workload.js`)를 렌더러마다 같은 프레임 수만큼 그리고 시간을 잰다.

| 부하 | 뜻 |
| --- | --- |
| `idle` | 바탕 노이즈만 천천히(칸 2% 남짓이 바뀜) — 로그인 대기 · 가만히 있는 뷰 |
| `mask` | 색이 연속으로 흐름(칸 대부분이 매 프레임 바뀜) — 융기 · 워프 · 진입 · 하이라이트 |
| `labels` | `mask` + 한글 이름표 · 창 자리 구멍 |

이 저장소의 실행 환경(GPU 없는 헤드리스 Chromium, GL = SwiftShader 소프트웨어)에서 1440×900 · 배율 1 · 칸 13,000개 · 60프레임의 중앙값(p95):

| 부하 | 렌더러 · 자리 | 기록(장면 코드) ms | **그리기 — 메인 스레드 ms** | Worker 안 ms |
| --- | --- | --- | --- | --- |
| idle | Canvas 2D · 메인 | 4.6 | 0.6 (1.5) | — |
| idle | WebGL2 · Worker | 5.2 | **0.2** (4.1) | 1.5 |
| mask | Canvas 2D · 메인 | 10.4 | 7.1 (13.2) | — |
| mask | WebGL2 · Worker | 10.6 | **0.2** (1.2) | 4.0 |
| labels | Canvas 2D · 메인 | 9.5 | 5.2 (12.6) | — |
| labels | WebGL2 · Worker | 9.7 | **0.2** (3.6) | 2.7 |

읽는 법:

- **메인 스레드의 그리기 비용**은 색이 흐르는 장면(mask · labels)에서 5–7ms → 0.2ms 로 준다. 창 · 입력이 쓰는 스레드가 그만큼 빈다. Worker 안의 GL 호출은 1.5–4ms(소프트웨어 GL 포함)다.
- **프레임 간격**은 이 환경에서 믿을 수 없어 표에서 뺐다 — 소프트웨어 GL 의 합성이 프레임마다 수백 ms 씩 튄다(실 GPU 에서는 생기지 않는 비용). 실제 화면의 프레임 시간은 GPU 가 있는 기기에서 `npm run bench -- --gpu --dpr 1,2` 로 잰다.
- **남은 큰 비용은 장면 코드 자체(기록 5–10ms)** 다 — 칸마다 색 문자열을 만들고 푸는 일이 대부분이다. 두 갈래로 줄인다: ① 장면 계산을 Worker 로 옮겨 메인에서 뺀다(§3.3 다음 단계), ② 뜨거운 줄은 `fillStyle` 에 숫자(0xRRGGBBAA)를 넣어 문자열을 건너뛴다(기록기가 받는다).
- 배율 2 는 이 환경에서 소프트웨어 GL 이 너무 느려 표에 넣지 않았다 — 실 GPU 측정과 함께 채운다.


## 5. 창 층

| 파일 | 하는 일 |
| --- | --- |
| `ui/signals.js` | `signal` · `computed` · `effect` · `batch` · `scope` · `untrack`. 바깥 라이브러리 없이 — 더 커지면 같은 이름의 Solid · Preact signals 로 바꾼다 |
| `ui/dom.js` | `h()` — 함수인 속성 · 자식은 그 자리만 고친다. `keyed()` — 열쇠가 같은 줄은 다시 만들지 않는다. 빠진 줄의 효과는 `scope` 로 끈다 |
| `ui/window-layer.js` | 창 종류마다 자리 수(ctl 6 · star 1 · conf 1 · stat 3 · share 1 · res 3), 같은 대상은 창 하나, 다 차면 가장 뒤 창 최소화, 계단식 배치 — 시안의 `ctlOpenWin` 규칙 그대로. 위치는 `transform` 으로만(배치 다시 계산 없음), 창마다 `contain: layout paint` |

1초마다 흐르는 값(자원 상태 창의 그래프 · 상태 창)은 그 값에 묶인 DOM 자리만 고친다. 긴 목록(장치 · 모듈 · 로그)은 보이는 줄만 그린다(가상 목록 — 다음).

## 6. API

| 파일 | 하는 일 |
| --- | --- |
| `api/terra.js` | `invoke(id, input, { node })` — 이 노드는 `/api/v1/operations/{id}/invoke`, 다른 노드는 `/api/v1/nodes/{node}/operations/{id}/invoke`(Master 중계). `stream()` — 티켓(30초) → WebSocket |
| `api/op-scope.json` | Daemon operation 78개의 원격 개방(`availability.scopes`) · 권한 · 위험도. **그 노드에서만인 것 26개** — 원격 제어기의 잠금 표시가 읽는다. `tools/gen-op-scope.mjs --terra <체크아웃>` 이 Terra 계약에서 뽑고, `--check` 로 어긋남을 본다 |
| `api/node-data.js` | v3 백엔드 — 프로필 · 노드 속성([[backend\|백엔드 설계]]) |

`canRemote(id)` 가 false 인 operation 을 다른 노드로 부르면 나가기 전에 `LOCAL_ONLY` 로 멈춘다.

명령 실행(`terra.daemon.commands.execute`)은 `command` 와 `args` 를 **빈칸으로 이어 붙여 시스템 셸에 한 줄로** 넘긴다(계약 설명).
그래서 제어기의 "파일에서 설치"(`terra module install <파일> --grant-reviewed …`)는 경로를 셸에 맞게 감싼다 — `shellArg()` · `moduleInstallCommand()`.

## 7. 앱 · 포장

| 항목 | 값 |
| --- | --- |
| 앱 | `contributions.gui.apps[0]` — `lab.stellaxia.gui-v3.web`, `static`, `ui/index.html`, `sandboxed`, capabilities 없음 |
| 빌드 | `web/` → `../ui`(Vite, `base: './'` — Gateway 가 `/api/v1/gui/apps/<앱 id>/files/` 아래에서 낸다). `ui/` 는 산출물이라 커밋하지 않는다 |
| 글꼴 | 앱 CSP 가 `font-src 'self' data:` 라 Google Fonts 를 못 쓴다. 시안의 GmarketSans · Geist Mono · Noto Sans KR 은 라이선스를 확인해 `web/public/fonts` 에 두고 `@font-face` 로(다음) |
| 런처 | 지금 있는 것 — Windows WebView2 런처, 그 밖은 terra-shell(브라우저 앱 모드). 별도 엔진 · Electron · Tauri 없음 |

## 8. 시험

| 명령 | 보는 것 |
| --- | --- |
| `npm test` | 칸 모델 · 색 · 기록기 · 타일 배치 · 부하 · signals · 창 자리 규칙 · operation 호출 · 원격 잠금 · 셸 인자 · 백엔드 클라이언트 (브라우저 없이) |
| `node tests/smoke.mjs` | 구운 `ui/` 를 Gateway 와 같은 CSP 로 내고 Chromium 으로 연다 — Worker+WebGL2 · 메인 WebGL2 · Canvas 2D 세 길이 서는지, 창 층이 도는지, 오류가 없는지 |
| `npm run bench` | 렌더러 비교(§4) |

## 9. 다음

1. 장면 이식 — 시안의 트리 · 리프 · 리소스 뷰 · 융기 · 워프를 기록기 위로 옮기고, 그 계산을 Worker 로
2. 별 · 궤도 · 행성(지금 시안의 3D 층)을 같은 GL 층으로
3. 창 이식 — 설정 · 상태 · 자원 · 자원 상태 · 제어기 앱을 signals 창으로, 시안의 값을 api 호출로
4. 글꼴 번들 · 가상 목록 · 실 GPU 에서 `npm run bench -- --gpu`

## 관련 문서

- [[docs/README|GUI v3 문서 MOC]]
- [[backend|v3 모듈 백엔드 설계]] — 계약 · 저장 규칙
- [[menu-hierarchy|메뉴 계층 설계]] — 창 갈래
- [[settings-inventory|GUI v3 설정 종합]] — 저장 위치 원칙
