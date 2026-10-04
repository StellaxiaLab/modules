---
title: "시험"
aliases:
  - "Testing"
  - "연기 시험"
doc_type: "guide"
scope: "project"
target: "terra-gui"
status: "draft"
version: "0.6.0"
last_updated: "2026-10-04"
language: "ko-KR"
related:
  - "[[docs/README|개발 문서 MOC]]"
  - "[[getting-started|시작하기]]"
  - "[[frontend-api|프론트엔드 API]]"
  - "[[architecture#7. Terra 안에서 — frame|Terra 안에서 — frame]]"
  - "[[real-data-layer|실데이터 층]]"
  - "[[module-profile|모듈 프로필]]"
---

# 시험

## 1. 연기 시험 (`tests/smoke.mjs`)

```bash
npm install
npx playwright install chromium      # 처음 한 번
npm run test:smoke                   # 자체 정적 서버(4173)를 띄운다 — dev 서버 없어도 된다
# 브라우저를 따로 줄 때: PW_CHROMIUM=/경로/chrome npm run test:smoke
```

Terra 밖(단독)에서 돈다 — 닿을 게이트웨이가 없으니 세계는 비어 있어야 하고, 예시 표식이 하나라도 보이면 실패다.

| 확인 | 내용 |
| --- | --- |
| 모든 페이지 | 오류 없이 뜨고 글자가 있다 · 보이는 글에 예시 표식이 없다 |
| 시작 화면 | 비밀번호 · 아이디 칸이 **없다** · "Terra 밖에서 열었다" · [둘러보기] → 구름 → 미리 읽은 노드 화면이 드러난다 |
| 노드 화면 | 빈 세계(장식 · 노드 자원 · 연결 · 메모 · 알림 · tree 없음) · 상태 · 글에 예시 표식 없음 |
| 조타륜 앱 바 | 테이블 네임 박스 → 가운데 로고 → 바가 열린다 |
| 앱 전체 화면 | ⛶ → 전체 화면 → 파인 곳 → 맵 |
| 메모장 | 폴더 보관함 → 메모장 → + 메모 → 이름 · 본문 → 저장 → 목록에 보인다 |
| 오버헤드 패널 | 오른쪽 위 손잡이로 접고 편다(`ovhHide`) |
| 상태 화면 | 이 노드 칸의 상태 화면 — 로그인 전이라 `로그인 전`(원본처럼 `로그인됨`으로 그리지 않는다) · 예시 표식 없음 |
| 도로 편집기 보드 | `fsEnter('rd')` → 보드가 `road.html`로 뜬다 · 보드 안의 `← 노드 화면`은 중첩 노드 화면이 아니라 전체 화면 끝 |
| 창 크기 | 창을 1700 × 1000으로 바꾸면 화면 크기(`scr`)가 따라간다 |

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
| `tests/module.test.mjs` | 부트 프로필(`prep` · 공통 보정 — 빈 맵 · leaf 맵 자기 칸), LayoutStore(되살리기 — `ovhHide` 포함 · 묶기 · 끊기 · `loadWorld`가 저장본을 되살리고 로그아웃이 덮지 않기 · 상태 화면 · 폼 · 모듈 GUI 창을 비우기), 시작 화면(비밀번호 없음 · 로그인 카드 · 토큰이 있으면 내려가기 · 잃으면 돌아오기 · 내려간 뒤 아래 알약이 누름을 받지 않기), frame 연결 빌리기, 설치한 노드 자원 · 상태 화면의 앱 다시 받기(폴더는 위 칸까지), 오프라인 노드 = 정지 이벤트 |
| `tests/crud.test.mjs` | 추가 · 수정 · 삭제 — 앱마다 **본문이 실제 서버의 입력과 같은지**(서버 코드로 확인한 모양), Master POST에 `node_id`를 싣지 않기, 길이 없는 것은 `null` · 카탈로그에 없는 op는 부르지 않기, GUI 앱 붙이기. 실데이터 층 화면과 함께 — 폼 저장이 지어내지 않기 · 두 번 누름 · 맵 자리 걷기 · 취소는 남기기 · 이름 · 칸 id 따라가기 · 폼을 여는 동작 · 끊으면 되돌리기 · API 줄 ⚠ · 자리 표시자 · 모듈 GUI 창 · 상태 화면 로그인 줄 |

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

## 6. 진짜 스택 위에서 (E2E)

브라우저 · 셸 · Master · Daemon이 모두 있어야 해서 CI에는 없다 — 바꾼 판을 낼 때 손으로 돈다.

| 단계 | 보는 것 |
| --- | --- |
| 준비 | Master · Daemon(등록) · 게이트웨이 · `io.terra.file` · `io.terra.io-inventory` · leaf UI 셸(Vite) — 모듈을 `terra module pack` → `terra module install --dev --force`, 게이트웨이가 새 판을 읽게 Daemon을 다시 띄운다 |
| 시작 화면 | 로그인 전 판 · 비밀번호 칸 없음 → [Terra 로그인] → 셸의 로그인 카드 → 들어가는 중 → 노드 화면(srcdoc) |
| 노드 화면 | 이 노드 · 부모 tree · 권한 · 조타륜 앱(I/O 장치 · 폴더 · 모듈 · 작업 · WireGuard) |
| 새 기능 | 노드 자원 설치 2개 → 조타륜을 닫아도 모니터링 값이 이어진다 · 연결하기(길 찾기 · 도로) · 메모 · 표지 바꾸기 → LayoutStore 저장본 · 도로 편집기 내보내기 → 노드 화면이 받는다 |
| 보드 | 네트워크 · 설정 · 건물 편집기 — 실데이터 · CSP 거절 없음 |
| 추가 · 수정 · 삭제 | 화면을 사람처럼 누른다 — 공유 폴더(폴더 · 빈 파일 · 이름 바꾸기 · 두 번 눌러 지우기) · I/O 장치(이름 · 승인 · 종류는 못 바꿈 · 스캔) · `+ 실행` → 폼 → Daemon 작업 · 터널(Master — leaf에는 없다는 이유) · 모듈(설치 폼을 열지 않음 · GUI 창). 결과는 관리자 토큰으로 서버에 직접 물어 견준다 |
| 상태 화면 · 패널 | 자원 · 노드 칸의 진짜 값 · 오버헤드 패널 접힘이 새로 고침 뒤에도 남는다 |
| 다시 열기 | 셸 새로 고침 → 다시 로그인 → 자원 · 연결 · 도로 · 메모 · 표지가 되살아난다 |
| 창 크기 · 로그아웃 | 1800 × 1050에서 꽉 찬다 · 로그아웃 → 빈 세계 · 저장본은 그대로 |
| 모든 단계 | 모든 frame의 보이는 글에서 예시 표식 0건 · 콘솔 오류는 셸의 `/api/product/session` 404뿐 |

2026-10-04 결과는 [[real-data-layer|실데이터 층]] §5.0(새 GUI) · §5.2(maingui 기준 — 추가 · 수정 · 삭제).

> [!TIP] 떠 있는 것이 누름을 가로채면
> Playwright가 `… subtree intercepts pointer events`로 멈추면 사람도 그 자리를 누를 수 없다는 뜻이다 — `evaluate`로 돌아가지 말고 무엇이 위에 있는지 본다.
> 시작 화면의 아래 알약이 노드 화면 아래 누름을 가로챈 것(구현해야 할 것 UP-15)이 이렇게 드러났다.

## 관련 문서

- [[docs/README|개발 문서 MOC]]
- [[getting-started|시작하기]]
- [[frontend-api|프론트엔드 API]]
- [[architecture#7. Terra 안에서 — frame|구조 §7 — Terra 안에서]]
- [[module-profile|모듈 프로필]]
