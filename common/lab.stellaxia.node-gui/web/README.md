---
title: "Terra 노드 GUI"
aliases:
  - "terra-node-gui"
doc_type: "readme"
scope: "project"
target: "terra-gui"
status: "draft"
version: "0.3.0"
last_updated: "2026-10-01"
language: "ko-KR"
---

# Terra 노드 GUI

게임 GUI 형태의 Terra 노드 화면과 편집기들을 브라우저에서 바로 돌리는 웹 프로젝트다.
디자인 캔버스에서 만든 화면(`design/*.dc.html`)을 그대로 옮겼고, 외부 UI 라이브러리 없이 순수 JavaScript(ES 모듈)로 동작한다.
데이터는 지금 **예시값**이고, Gateway에 붙이는 연동 층(`src/api` · `src/model`)과 개발 문서(`docs/`)가 함께 들어 있다.

이 디렉터리는 Terra 모듈 `lab.stellaxia.node-gui`의 **`web/`**이다. 빌드 결과는 모듈의 `ui/`로 가고, 노드에서는 셸 Scene의
`terra.web/frame`이 이 화면을 감싼다 — 그때 무엇이 실데이터가 되는지는 [[architecture#7. Terra 안에서 — frame|구조 §7]],
모듈의 모양 · 포장 · 검증은 모듈 README(`../README.md`).

## 실행

Node.js 18 이상이 필요하다. OS 순서는 Linux · Windows · macOS — 세 곳 모두 같은 명령이다.

```bash
npm ci
npm run dev          # http://localhost:5173 — 첫 화면에서 각 화면으로
npm run build        # ../ui/ 에 정적 파일 — 모듈이 싣는 것 (상대 경로라 어느 경로에 올려도 동작)
npm run gen          # design/*.dc.html 을 고친 뒤 화면 페이지를 다시 만든다 (python3 필요)
npm test             # 연동 층 시험 (node:test — 브라우저 없이)
npm run test:smoke   # 연기 시험 (playwright 브라우저 필요: npx playwright install chromium)
```

번들러 없이 아무 정적 서버로도 뜬다(ES 모듈이라 `file://`로는 안 된다).

```bash
python3 -m http.server 8000      # http://localhost:8000
```

Gateway에 붙이기 (조타륜 앱이 실데이터를 받는다):

```bash
node tools/mock-gateway.mjs 8790                     # 가짜 Gateway (연습용)
# 브라우저: http://localhost:5173/node.html?live=1&gw=http://127.0.0.1:8790
```

진짜 노드에는 모듈로 포장해 설치한다 — 앱은 게이트웨이가 정한 앱 origin에서 서빙되고 frame이 스코프 토큰을 건넨다
([[getting-started|시작하기]] §4.2).

## 화면

| 화면 | 페이지 | 내용 |
| --- | --- | --- |
| 노드 화면 | `node.html` | 육각 필드 맵 · 관리 노드 창 · 조타륜(앱 10개) · 오버헤드 패널(선택 상태 · 전체 창 리스트 · 폴더 보관함) · 유틸 서랍 · 서브 창 · 전체 화면 |
| 건물 편집기 | `building.html` | 16³ 블록 설계 · 설계도 트리 · 2D 벡터 4방향 내보내기 |
| 자재 편집기 | `material.html` | 6면 8×8 픽셀 자재 · 8×8×8 커스텀 복셀 자재 · 애니메이션 |
| 필드 편집기 | `field.html` | 타일 스킨 |
| 그라운드 편집기 | `ground.html` | 높이 0 바닥 무늬 |
| 네트워크 · 설정 | `network.html` · `settings.html` | 각 기능 화면 |
| 디자인 노트 | `components.html` · `helm.html` · `helm-apps.html` | 공통 부품 · 조타륜 시안 · 조타륜 앱 노트 |

## 구조

```text
web/                         # 모듈 lab.stellaxia.node-gui 의 웹 소스 (포장되지 않는다)
├── index.html · node.html · building.html …   # 화면 페이지 (tools/gen-pages.py가 만든다)
├── src/
│   ├── runtime/dc.js        # 작은 템플릿 런타임 ({{값}} · sc-for · sc-if · onClick …)
│   ├── screens/*.js         # 화면 로직 (design/*.dc.html 에서 생성)
│   ├── api/                 # 연동 층: TerraClient · operation 대응표 · 응답 변환 · 데이터 소스 · 화면 연결
│   │                        #   frame-boot · frame-session · frame-boards · terra-frame-client — Terra frame 안에서
│   └── model/               # 데이터 모양(JSDoc) · 권한 · 배지 규칙
├── design/                  # 디자인 캔버스 원본 (.dc.html · canvas.json · 로고)
├── docs/                    # 개발 문서 (Obsidian 호환 — docs/README.md 부터)
├── tools/                   # gen-pages.py · mock-gateway.mjs · pages.json
├── tests/api.test.mjs       # 연동 층 시험 (npm test)
├── tests/smoke.mjs          # 연기 시험 (npm run test:smoke — 브라우저 필요)
└── public/pages.json        # 첫 화면 목록
```

## 문서

[[docs/README|개발 문서 MOC]]부터 읽는다. 화면을 실제로 연동하려면 [[frontend-api|프론트엔드 API]] → [[implementation-guide|구현 가이드]] 순서.
