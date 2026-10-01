---
title: "Terra 노드 GUI 개발 문서 MOC"
aliases:
  - "개발 문서 MOC"
  - "노드 화면 개발 문서"
  - "Terra Node GUI Docs"
doc_type: "moc"
scope: "project"
target: "terra-gui"
status: "draft"
version: "0.3.0"
last_updated: "2026-10-01"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[getting-started|시작하기]]"
  - "[[architecture|구조]]"
  - "[[frontend-api|프론트엔드 API]]"
  - "[[helm-apps-integration|조타륜 앱 · 폴더 보관함 연동]]"
  - "[[implementation-guide|구현 가이드]]"
---

# Terra 노드 GUI 개발 문서 MOC

이 프로젝트(`terra-node-gui`)는 디자인 캔버스의 **노드 화면 프로토타입**과 편집기 보드를 그대로 돌리는 웹 프로젝트에,
실데이터로 옮기기 위한 **연동 층**(`src/api` · `src/model`)과 이 문서들을 더한 것이다. 단독으로 돌리면 데이터는 전부 예시값이다.

출하는 Terra 모듈 `lab.stellaxia.node-gui`의 웹 앱으로 한다. 노드에서 셸 Scene의 `terra.web/frame` 안에 뜨면 이 노드의
Daemon operation을 부르는 조타륜 앱이 실데이터로 바뀐다 — [[architecture#7. Terra 안에서 — frame|구조 §7]].

## 읽는 순서

```mermaid
flowchart LR
  A["시작하기"] --> B["구조"] --> C["UI 명세"]
  B --> D["프론트엔드 API"] --> E["조타륜 앱 · 폴더 보관함 연동"]
  D --> F["API 연동 가이드"]
  E --> G["구현 가이드"]
  F --> G
  G --> H["시험"]
```

| 하려는 일 | 문서 |
| --- | --- |
| 띄워 보기 · 폴더 구조 · 다시 생성 | [[getting-started\|시작하기]] |
| 화면이 어떻게 돌아가는지 (런타임 · 구역 · 층 · 렌더 밖 루프) | [[architecture\|구조]] |
| Terra 안에서 — frame · 로그인 · 무엇이 실데이터인가 | [[architecture#7. Terra 안에서 — frame\|구조 §7]] · [[frontend-api\|프론트엔드 API]] §6.5 |
| 화면 모양 · 동작 · 시간 | [[node-screen-ui-spec\|노드 화면 UI 명세]] |
| 화면 객체의 메서드 · 상태 · seam · 연동 층 API | [[frontend-api\|프론트엔드 API]] |
| 조타륜 앱 10개 · 폴더 보관함 · 메모장의 operation · 권한 · 응답 | [[helm-apps-integration\|조타륜 앱 · 폴더 보관함 연동]] |
| 세션 · 호출 규칙 · 맵 · 관리 노드 창 · 갱신 | [[node-screen-api-integration\|노드 화면 API 연동 가이드]] |
| 상태 필드의 출처 · 저장 위치 | [[node-screen-data-model\|노드 화면 데이터 모델]] |
| 실데이터로 옮기는 순서 · 기능 더하기 · 결정 필요 | [[implementation-guide\|구현 가이드]] |
| 이식 방식 · 성능 함정 | [[node-screen-code-structure\|코드 구조와 이식 가이드]] |
| 연기 시험 · 연동 시험 | [[testing\|시험]] |

## 폴더

| 폴더 | 문서 |
| --- | --- |
| `docs/` | 이 MOC · [[architecture\|구조]] |
| `docs/screens/` | [[node-screen-ui-spec\|UI 명세]] |
| `docs/api/` | [[frontend-api\|프론트엔드 API]] · [[helm-apps-integration\|조타륜 앱 연동]] · [[node-screen-api-integration\|API 연동 가이드]] |
| `docs/data/` | [[node-screen-data-model\|데이터 모델]] |
| `docs/guides/` | [[getting-started\|시작하기]] · [[implementation-guide\|구현 가이드]] · [[node-screen-code-structure\|이식 가이드]] · [[testing\|시험]] |

## 화면과 원본

| 페이지 | 원본 (`design/`) | 화면 로직 |
| --- | --- | --- |
| `node.html` | `Artboard-qcfu.dc.html` | `src/screens/node.js` |
| `building.html` · `material.html` · `field.html` · `ground.html` | `BuildingEditor` · `MaterialEditor` · `FieldEditor` · `GroundEditor` | `src/screens/*.js` |
| `network.html` · `settings.html` | `Network` · `Settings` | 〃 |
| `components.html` · `helm.html` · `helm-apps.html` | 디자인 노트 | 〃 |

## 바깥 문서 (Terra 저장소)

- [[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-api-priority|GUI API 우선순위]] — operation 목록 · 등급의 원본
- [[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-resource-inventory|GUI 자원 목록]] — 조타륜 앱의 자원 · 상태 · 권한 원본
- [[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-session-model|세션 모델]]
- [[docs/reports/terra-node-gui-main-module-feasibility-2026-10-01|노드 GUI main 모듈 가능성 판정]] — 이 화면을 모듈로 내는 근거 · 플랫폼 공백 · 남은 결정
- [[docs/modules/terra-gui/design/terra-base-scene-branch-design|base Scene 분기 설계]] — base가 main을 고르는 규칙

## 바깥 문서 (modules 저장소)

- 모듈 README(`common/lab.stellaxia.node-gui/README.md`) — 모듈 모양 · 빌드 · 포장 · 검증 기록 · 결정 기본값
