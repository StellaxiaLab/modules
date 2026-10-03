---
title: "시험"
aliases:
  - "Testing"
  - "연기 시험"
doc_type: "guide"
scope: "project"
target: "terra-gui"
status: "draft"
version: "0.4.0"
last_updated: "2026-10-03"
language: "ko-KR"
related:
  - "[[docs/README|개발 문서 MOC]]"
  - "[[getting-started|시작하기]]"
  - "[[frontend-api|프론트엔드 API]]"
  - "[[architecture#7. Terra 안에서 — frame|Terra 안에서 — frame]]"
  - "[[real-data-layer|실데이터 층]]"
---

# 시험

## 1. 연기 시험 (`tests/smoke.mjs`)

```bash
npm install
npx playwright install chromium      # 처음 한 번
npm run test:smoke                   # 자체 정적 서버(4173)를 띄운다 — dev 서버 없어도 된다
# 브라우저를 따로 줄 때: PW_CHROMIUM=/경로/chrome npm run test:smoke
```

| 확인 | 내용 |
| --- | --- |
| 모든 페이지 | 오류 없이 뜨고 글자가 있다 |
| 조타륜 앱 바 | 테이블 네임 박스 → 가운데 로고 → 바가 열린다 |
| 앱 전체 화면 | ⛶ → 전체 화면 → 파인 곳 → 맵 → 전체 창 리스트에 1개 |
| 메모장 | 폴더 보관함 → 메모장 → + 메모 → 이름 · 본문 → 저장 → 목록에 보인다 |

스크린숏은 `tests/shots/`.

## 2. 화면 객체로 시험하기

노드 화면은 `window.__screen`에 화면 객체를 둔다 — 시험에서 상태를 바로 읽고 메서드를 부른다([[frontend-api|프론트엔드 API]]).

```js
await page.evaluate(() => window.__screen.fsEnter('alarm'));
const fs = await page.evaluate(() => window.__screen.state.fs);   // 'alarm'
```

## 3. 연동 · 실데이터 층 시험 (`npm test`)

```bash
# Linux — web/ 에서. Windows(PowerShell) · macOS 도 같은 명령이다
npm test        # node --test tests/*.test.mjs — 브라우저 없이 돈다
```

| 파일 | 지키는 것 |
| --- | --- |
| `tests/api.test.mjs` | 봉투 벗기기 · 위임 자격의 Master 401 · 다른 노드 · frame 역할 · 보드 링크 |
| `tests/data.test.mjs` | 노드 이름 · 관계도 · 알림 · 보관함 칸 |
| `tests/live.test.mjs` | 노드 화면 · 보드 · 편집기를 브라우저 없이 만들어 **상태와 렌더 값 전체에 예시 표식이 없는지**, 실제 응답 모양 → 화면 모양, 모듈 · Daemon 이 모르는 키를 싣지 않는지, WireGuard 꺼짐, 18칸을 넘는 자식, 권한 |

실제 응답 모양은 진짜 스택(Master · Daemon · 게이트웨이 · `io.terra.file` · `io.terra.io-inventory`)에서 받은 것을 줄였다.
진짜 스택 위에서 끝까지 돌린 결과는 [[real-data-layer|실데이터 층]] §5.

## 4. 알아 둘 것

- 화면은 애니메이션이 많다 — 누른 뒤 0.3 ~ 1.5초 기다린다(조타륜이 올라오는 데 약 1.2초, 맵 전환 약 1.4초).
- 떠 있는 창이 다른 부품을 가리면 Playwright 클릭이 막힌다 → `element.click()`을 `evaluate`로.
- 글꼴은 시스템 글꼴이다 — Terra 게이트웨이의 CSP가 외부 글꼴을 막아 Google Fonts를 뺐다. 설치된 글꼴에 따라 그림이 조금 다르다(시험에는 영향 없음).

## 5. 연동 층 시험 (`tests/api.test.mjs`)

```bash
npm test                             # node:test — 브라우저도 서버도 없이 돈다
```

modules 저장소의 CI(`web` 잡)와 릴리스가 `npm run test:web`으로 이것을 돈다. 그래서 **브라우저가 필요한 시험은
`npm test`에 넣지 않는다** — CI 러너에는 브라우저가 없다(연기 시험은 `test:smoke`로 따로).

| 묶음 | 확인 |
| --- | --- |
| 응답 봉투 | Daemon `{ status, data }` · Master `{ ok, data }`를 벗긴다 · 오류 봉투의 `code`가 이유가 된다 · 접수(202)는 작업 번호를 꺼낸다 |
| 호출 | 주입한 `fetch`로 상대 경로를 부르고 확인 헤더를 싣지 않는다 · 다른 노드는 부르지 않는다 |
| 위임 자격 | Master 401은 `unavailable · master-delegation`이고 다음부터 부르지 않는다 · 단독 실행의 401은 그대로 `unauthenticated` |
| 데이터 소스 | `'<노드>'` 자리 표시자가 실제 노드를 덮지 않는다 · 로컬이 아닌 노드의 Daemon 목록은 부르지 않고 이유를 낸다 |
| frame | SSE 조각에서 끝난 이벤트만 꺼낸다 · frame 안인지 가린다(다른 origin 부모 · 같은 origin 부모 · 단독) · 보드 링크의 페이지 이름 |

Terra 셸과 진짜 게이트웨이 위에서 끝까지 돌린 기록은 모듈 README(`common/lab.stellaxia.node-gui/README.md`)의 "검증" 절에 있다.

## 관련 문서

- [[docs/README|개발 문서 MOC]]
- [[getting-started|시작하기]]
- [[frontend-api|프론트엔드 API]]
- [[architecture#7. Terra 안에서 — frame|구조 §7 — Terra 안에서]]
