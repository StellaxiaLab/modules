---
title: "Terra 노드 GUI"
aliases:
  - "terra-node-gui"
doc_type: "readme"
scope: "project"
target: "terra-gui"
status: "draft"
version: "1.3.0"
last_updated: "2026-10-05"
language: "ko-KR"
---

# Terra 노드 GUI

게임 GUI 형태의 Terra 노드 화면과 편집기들을 브라우저에서 바로 돌리는 웹 프로젝트다.
디자인 캔버스에서 만든 화면(`design/*.dc.html`)을 그대로 옮겼고, 외부 UI 라이브러리 없이 순수 JavaScript(ES 모듈)로 동작한다.
GUI 원본 저장소 [`StellaxiaLab/maingui`](https://github.com/StellaxiaLab/maingui) `2ced429`(service 판 — 예시 데이터를 뺀 판)와 같은 원본 · 같은 생성 규칙으로 만든 **module 변형**이다 —
시작 화면 · 노드 자원 설치 · 연결하기(도로) · 이벤트 · 자원 추가 · 수정 · 삭제 · 상태 화면 · 도로 편집기 · 창 크기를 따르는 화면이 들어 있다([[module-profile|모듈 프로필]]).
Terra G0~G6이 연 길도 쓴다 — 실시간 이벤트(SSE) · 다른 노드(노드 주소 호출) · 사용자 문서(서버 저장) · 로컬 탐색 · 바탕화면에서 열기 · 파일 올리기 · 받기 · 장치 손 등록([[real-data-layer|실데이터 층]] §2.6~§2.9).

디자인 원본의 예시 데이터는 화면에 나오지 않는다 — 부트 프로필(`src/boot/module.js`)이 실데이터 층(`src/data`)의 클래스로 바꿔 끼워
첫 렌더 전에 지우고, Terra 안에서는 이 노드의 값으로 채운다([[real-data-layer|실데이터 층]]). Gateway에 붙이는 연동 층(`src/api` · `src/model`)과
개발 문서(`docs/`)가 함께 들어 있다.

이 디렉터리는 Terra 모듈 `lab.stellaxia.node-gui`의 **`web/`**이다. 빌드 결과는 모듈의 `ui/`로 가고, 노드에서는 셸 Scene의
`terra.web/frame`이 앱 entry(`ui/index.html` — 시작 화면)를 감싼다 — 그때 무엇이 실데이터가 되는지는 [[architecture#7. Terra 안에서 — frame|구조 §7]],
모듈의 모양 · 포장 · 검증은 모듈 README(`../README.md`), **남은 일**은 [[implementation-backlog|구현해야 할 것]].

## 실행

Node.js 18 이상이 필요하다. OS 순서는 Linux · Windows · macOS — 세 곳 모두 같은 명령이다.

```bash
npm ci
npm run dev          # http://localhost:5173 — 시작 화면(index.html) · 화면 목록은 screens.html
npm run build        # ../ui/ 에 정적 파일 — 모듈이 싣는 것 (상대 경로라 어느 경로에 올려도 동작)
npm run gen          # design/*.dc.html 을 고친 뒤 화면 페이지를 다시 만든다 (python3 필요 · public/config.json 의 variant = module)
npm test             # 연동 층 · 실데이터 층 · 모듈 프로필 · 추가 · 수정 · 삭제 · 이벤트 · 손 동작 시험 (node:test — 브라우저 없이)
npm run test:smoke   # 연기 시험 (playwright 브라우저 필요: npx playwright install chromium)
```

번들러 없이 아무 정적 서버로도 뜬다(ES 모듈이라 `file://`로는 안 된다). `config.json` · `pages.json`은 `public/` 아래에 있다.

```bash
python3 -m http.server 8000      # http://localhost:8000
```

단독으로 띄운 화면은 Terra 밖이라 데이터가 없다 — 시작 화면은 `둘러보기 (데이터 없음)`, 노드 화면은 빈 세계다. 실데이터는 노드에
모듈로 포장해 설치해서 본다 — 앱은 게이트웨이가 정한 앱 origin에서 서빙되고 frame이 스코프 토큰을 건넨다([[getting-started|시작하기]] §4.2).
원본 service 판의 독립 배포(`/gw` 프록시 · nginx · Docker · 서비스 등록)와 자기 로그인 화면, demo 판의 예시 데이터(`examples/`)는 이 모듈에 없다 — 로그인 · 게이트웨이는 Terra 셸이 맡는다.

## 화면

| 화면 | 페이지 | 내용 |
| --- | --- | --- |
| 시작 화면 (앱 entry) | `index.html` | 하늘 · 바다 · 조타륜 판. 비밀번호를 받지 않는다 — [Terra 로그인]은 셸의 로그인 카드로, 세션이 있으면 구름을 지나 미리 읽은 노드 화면으로 내려간다 |
| 노드 화면 | `node.html` | 육각 필드 맵 · 관리 노드 창 · 조타륜(앱 10개 — 앱 전체 화면의 자원 추가 · 수정 · 삭제) · 노드 자원 설치 · 연결하기(도로) · 상태 창 · 상태 화면(자원 · 노드 · 도로) · 모듈 GUI 창 · 이벤트 · 오버헤드 패널(선택 상태 · 전체 창 리스트 · 폴더 보관함 · 접기) · 유틸 서랍 · 서브 창 · 전체 화면 |
| 건물 편집기 | `building.html` | 블록 설계 · 이벤트(동작 · 대기 · 정지 · 실패 · 사용자) · 노드 화면으로 내보내기 |
| 도로 편집기 | `road.html` | 팔(1/6 정삼각형) · 합류 · 화소 48 · 상태 · 방향 이벤트 — [[road-editor-spec\|도로 편집기]] |
| 자재 편집기 | `material.html` | 6면 8×8 픽셀 자재 · 8×8×8 커스텀 복셀 자재 · 애니메이션 |
| 필드 편집기 | `field.html` | 타일 스킨 |
| 그라운드 편집기 | `ground.html` | 높이 0 바닥 무늬 |
| 네트워크 · 설정 | `network.html` · `settings.html` | 각 기능 화면 |

디자인 노트(`Components` · `Helm` · `HelmApps`)와 maingui의 다른 디자인 판(`Home` · `Main` · `Modules` · `Ocean` · `States` …)은 원본만 `design/`에 두고 페이지로 만들지 않는다(원본 저장소에서 본다).

## 구조

```text
web/                         # 모듈 lab.stellaxia.node-gui 의 웹 소스 (포장되지 않는다)
├── index.html · node.html · building.html · road.html …   # 화면 페이지 (tools/gen-pages.py가 만든다)
├── screens.html             # 화면 목록 (개발용 — 빌드에 들어가지 않는다)
├── public/config.json       # 실행 설정 — variant(module) · layoutStore(server · local · none) · pollSec
├── src/
│   ├── runtime/dc.js        # 작은 템플릿 런타임 ({{값}} · sc-for · sc-if · onClick …)
│   ├── screens/*.js         # 화면 로직 (design/*.dc.html 에서 생성 — 손대지 않는다)
│   ├── boot/                # 부트 프로필 module.js(prep · boot) · 공통 보정 fixes.js
│   ├── api/                 # 연동 층: TerraClient(노드 주소 호출) · operation 대응표 · 응답 변환 · 데이터 소스(올리기 · 받기) · 화면 연결 · 실시간 이벤트 · SHA-256 · 설정
│   │                        #   frame-boot · frame-session · frame-boards · terra-frame-client — Terra frame 안에서
│   ├── data/                # 실데이터 층: 화면 클래스를 이어받아 예시를 지운다 (*-live.js · intro-live.js) · 순수 변환
│   ├── store/layout.js      # LayoutStore — 맵 배치 · 노드 자원 · 연결 · 메모 (이 브라우저 · 노드 · 주체마다)
│   ├── store/docs.js        # 사용자 문서(Terra C-1) — LayoutStore · 편집기 자산을 서버에도 (새 쪽이 이긴다 · 409)
│   ├── store/parts.js       # 받기 조각 보관(IndexedDB) — 끊긴 받기를 다시 받으면 거기서부터 (MD-21)
│   └── model/               # 데이터 모양(JSDoc) · 권한 · 배지 규칙
├── design/                  # 디자인 캔버스 원본 (.dc.html · canvas.json · 로고)
├── docs/                    # 개발 문서 (Obsidian 호환 — docs/README.md 부터)
├── tools/                   # gen-pages.py(module 변형 — 템플릿 패치 · frame-boot 첫 import) · pages.json
├── tests/*.test.mjs         # 연동 층 · 실데이터 층 · 모듈 프로필 · 추가 · 수정 · 삭제 · 이벤트 · 손 동작 시험 (npm test)
└── tests/smoke.mjs          # 연기 시험 (npm run test:smoke — 브라우저 필요)
```

## 문서

[[docs/README|개발 문서 MOC]]부터 읽는다. 변형 · 시작 화면 · 저장은 [[module-profile|모듈 프로필]], 남은 일은 [[implementation-backlog|구현해야 할 것]],
화면을 실제로 연동하려면 [[frontend-api|프론트엔드 API]] → [[implementation-guide|구현 가이드]] 순서.
