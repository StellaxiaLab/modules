---
title: "GUI v3 웹 — 캔버스 원본 · 빌드 도구 · 백엔드 클라이언트"
aliases:
  - "gui-v3 web"
doc_type: "readme"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-29"
language: "ko-KR"
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
  - "[[backend|v3 모듈 백엔드 설계]]"
  - "[[settings-inventory|GUI v3 설정 종합]]"
---

# GUI v3 웹

화면의 **원본은 Claude Design 캔버스 보드**(`design/*.dc.html`)다. 포장되지 않는다(`web/`은 개발 전용, `docs/layout.md`).
실제 웹 빌드(`ui/`)는 아직 없다 — 이 보드들이 그 기준이다.

```text
web/
├─ design/                       캔버스 보드 원본 (캔버스 'Terra GUI v3' 버전 247과 같다)
│  ├─ canvas.json                보드 목록 · 순서
│  ├─ Scene.dc.html              통합 화면 — 생성물 (build/mkglobal.py 가 굽는다, 손으로 고치지 않는다)
│  ├─ Field.dc.html              전역 틀 (통합 화면에 합쳐진다)
│  ├─ Login.dc.html              로그인 씬 (통합 화면 맨 위 층)
│  ├─ NodeConf · NodeStatus · StarMaker · NodeDesktopEmbed .dc.html   창 컴포넌트
│  ├─ Main · Tree · Leaf · Resource · Emerge · Warp · GlobalRef .dc.html 단독 시안 보드
│  ├─ Sheet.dc.html              컴포넌트 시트 — 모든 컴포넌트의 규격
│  ├─ archive/
│  └─ build/                     보드를 굽는 도구 (아래)
└─ src/
   └─ api/node-data.js           GUI v3 백엔드 클라이언트 (+ node-data.test.mjs)
```

## 보드 굽기

| 무엇 | 명령 | 하는 일 |
| --- | --- | --- |
| 통합 화면 | `python3 web/design/build/mkglobal.py` | `build/scene_base.html`(장면) + `Field.dc.html`(전역 틀) + `build/gf_scene_methods.js` → `Scene.dc.html`, 이어서 `mklogin.py`(로그인 층 · 우클릭)와 `atlas.py`(글자 타일) 를 적용 |
| 창 보드 셋 | `python3 web/design/build/build_parts.py [nodeconf\|nodestatus\|starmaker]` | `build/parts/<보드>/{markup.html, style.css, script.js}` → 그 보드의 해당 자리만 교체 |

규칙: `Scene.dc.html` 은 생성물이다. 장면은 `build/scene_base.html`, 전역 틀은 `Field.dc.html`, 창 보드는 `build/parts/` 를 고친 뒤 굽는다.
굽고 나면 class 스크립트를 뽑아 `node --check` 로 문법을 확인한다.

## 시안의 저장 흉내 → 실제 길

캔버스에는 Gateway 가 없어서 저장을 localStorage 로 흉내 낸다. 실제 웹 빌드에서 바뀌는 자리:

| 시안 (localStorage) | 실제 | 클라이언트 |
| --- | --- | --- |
| `terra.fs` · `terra.fs.f.<노드 id>:<경로>` (프로필 · 노드 속성) | v3 백엔드 `lab.stellaxia.gui-v3.node-props.*` · `node-files.*` | `src/api/node-data.js` — `createNodeData(request, { nodeId })` |
| `terra.skin` · `terra.star.index` · `terra.star.f.<id>` | 사용자 문서 `app:lab.stellaxia.gui-v3/{skin, star/…}` | (다음) |
| 설정 창의 노드 설정 값 (창 안에서만) | `terra.daemon.config.{get, schema.get, patch}` · `POST /restart` | (다음) — node-gui `api/` 를 이어받는다 |

프로필 속성 값은 노드 상대 꼴(`/데이터/profile/image/<파일>`)이다 — 백엔드와 시안이 같은 꼴을 쓴다.

```bash
node --test common/lab.stellaxia.gui-v3/web/src/api/node-data.test.mjs
```

## 관련 문서

- [[backend|v3 모듈 백엔드 설계]] — 계약 · 저장 규칙
- [[settings-inventory|GUI v3 설정 종합]] — 저장 위치 원칙
- [[docs/README|GUI v3 문서 MOC]]
