---
title: "GUI v3 웹 — 웹 빌드 · 캔버스 원본 · 빌드 도구"
aliases:
  - "gui-v3 web"
doc_type: "readme"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
last_updated: "2026-10-29"
language: "ko-KR"
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
  - "[[backend|v3 모듈 백엔드 설계]]"
  - "[[settings-inventory|GUI v3 설정 종합]]"
  - "[[web-architecture|GUI v3 웹 구조]]"
---

# GUI v3 웹

두 갈래가 함께 있다.

- **웹 빌드**(`index.html` · `src/` → `../ui`) — 모듈의 실제 앱(`lab.stellaxia.gui-v3.web`). 장면 층(WebGL2 글자 장, Worker)과 창 층(DOM · signals). 구조와 이유는 [[web-architecture|GUI v3 웹 구조]].
- **캔버스 원본**(`design/*.dc.html`) — Claude Design 캔버스 보드. 화면 설계의 기준이고 포장되지 않는다(`web/` 은 개발 전용, `docs/layout.md`).

```text
web/
├─ index.html · vite.config.js · package.json   웹 빌드 (npm run build → ../ui)
├─ src/
│  ├─ boot/main.js               입구 — 두 층을 세운다
│  ├─ scene/                     장면 층
│  │  ├─ field-grid.js           칸 모델(형식 배열) · 색 · 캔버스 꼴 기록기
│  │  ├─ glyph-atlas.js          글자 타일(알파 마스크) — GPU 렌더러용
│  │  ├─ field-gl.js             WebGL2 렌더러 (인스턴스 두 번)
│  │  ├─ field-2d.js             Canvas 2D 렌더러 — 돌아가는 길 · 시안 알고리즘 비교 기준
│  │  ├─ field-worker.js         Worker(OffscreenCanvas)
│  │  ├─ field-host.js           렌더러 고르기(Worker → 메인 WebGL2 → 2D)
│  │  └─ workload.js             비교용 부하(idle · mask · labels)
│  ├─ ui/                        창 층 — signals.js · dom.js · window-layer.js · base.css
│  └─ api/                       terra.js(operation invoke · stream · 원격 잠금) · op-scope.json · node-data.js(v3 백엔드)
├─ tests/                        npm test(브라우저 없이) · smoke.mjs(Chromium)
├─ bench/                        렌더러 비교 페이지 (빌드에 넣지 않는다)
├─ tools/                        bench-field.mjs · gen-op-scope.mjs
└─ design/                       캔버스 보드 원본 (캔버스 'Terra GUI v3' 버전 260과 같다)
   ├─ canvas.json · Scene.dc.html(생성물) · Field · Login · 창 컴포넌트 · 단독 시안 보드 · Sheet
   └─ build/                     보드를 굽는 도구 (아래)
```

## 웹 빌드

```bash
cd common/lab.stellaxia.gui-v3/web
npm install
npm run dev            # http://localhost:5174 — ?render=main(메인 스레드) · ?gl=2d(Canvas 2D)
npm run build          # → ../ui
npm test               # 브라우저 없이
node tests/smoke.mjs   # 구운 ui/ 를 Gateway 와 같은 CSP 로 Chromium 에서
npm run bench          # 글자 장 렌더러 비교 (--gpu · --dpr 1,2 · --frames 240)
npm run gen:op-scope -- --terra <Terra 체크아웃> [--check]   # 원격 잠금 표
```

저장소 단위로는 `npm run build:web && npm run test:web` 이 이 모듈도 굽고 시험한다.

## 보드 굽기

| 무엇 | 명령 | 하는 일 |
| --- | --- | --- |
| 통합 화면 | `python3 web/design/build/mkglobal.py` | `build/scene_base.html`(장면) + `Field.dc.html`(전역 틀) + `build/gf_scene_methods.js` → `Scene.dc.html`, 이어서 `mklogin.py`(로그인 층 · 우클릭)와 `atlas.py`(글자 타일) 를 적용 |
| 창 보드 셋 | `python3 web/design/build/build_parts.py [nodeconf\|nodestatus\|starmaker\|nodeshare\|resstatus\|treelogin]` | `build/parts/<보드>/{markup.html, style.css, script.js}` → 그 보드의 해당 자리만 교체 |

규칙: `Scene.dc.html` 은 생성물이다. 장면은 `build/scene_base.html`, 전역 틀은 `Field.dc.html`, 창 보드는 `build/parts/` 를 고친 뒤 굽는다.
굽고 나면 class 스크립트를 뽑아 `node --check` 로 문법을 확인한다.

## 시안의 저장 흉내 → 실제 길

캔버스에는 Gateway 가 없어서 저장을 localStorage 로 흉내 낸다. 실제 웹 빌드에서 바뀌는 자리:

| 시안 (localStorage) | 실제 | 클라이언트 |
| --- | --- | --- |
| `terra.fs` · `terra.fs.f.<노드 id>:<경로>` (프로필 · 노드 속성) | v3 백엔드 `lab.stellaxia.gui-v3.node-props.*` · `node-files.*` | `src/api/node-data.js` — `createNodeData(request, { nodeId })` |
| `terra.skin` · `terra.star.index` · `terra.star.f.<id>` | 사용자 문서 `app:lab.stellaxia.gui-v3/{skin, star/…}` | (다음) |
| 설정 창의 노드 설정 값 (창 안에서만) | `terra.daemon.config.{get, schema.get, patch}` · `POST /restart` | `src/api/terra.js` — `createTerra().invoke(id, input, { node })` |
| 제어기 · 자원 창의 버튼 (시안 데이터) | Daemon · Master operation, 원격이면 `nodes/{node}/operations` | 같은 클라이언트 — 원격 잠금은 `canRemote(id)`(`op-scope.json`) |

프로필 속성 값은 노드 상대 꼴(`/데이터/profile/image/<파일>`)이다 — 백엔드와 시안이 같은 꼴을 쓴다.

```bash
cd common/lab.stellaxia.gui-v3/web && npm test
```

## 관련 문서

- [[web-architecture|GUI v3 웹 구조]] — 장면 층 · 창 층 · API · 측정
- [[backend|v3 모듈 백엔드 설계]] — 계약 · 저장 규칙
- [[settings-inventory|GUI v3 설정 종합]] — 저장 위치 원칙
- [[docs/README|GUI v3 문서 MOC]]
