---
title: "시험"
aliases:
  - "Testing"
  - "연기 시험"
doc_type: "guide"
scope: "project"
target: "terra-gui"
status: "draft"
version: "0.12.0"
last_updated: "2026-10-11"
language: "ko-KR"
related:
  - "[[docs/README|개발 문서 MOC]]"
  - "[[getting-started|시작하기]]"
  - "[[frontend-api|프론트엔드 API]]"
  - "[[architecture#7. Terra 안에서 — frame|Terra 안에서 — frame]]"
  - "[[real-data-layer|실데이터 층]]"
  - "[[module-profile|모듈 프로필]]"
  - "[[implementation-backlog|구현해야 할 것]]"
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
| SVI 자원 앱 | `fsEnter('hb:svi')` — 로그인 전엔 잠김(`node.read 필요`), 읽기 권한을 주면 빈 **흐름도**(maingui A-28) · `▦ 카드로` → 카드 보기 · 어느 쪽이든 흐름 칸(`state.sviStream`) · 도로(`state.sviFlow`)가 비어 있다(예시 흐름이 돌지 않는다) · 예시 표식 없음 |
| 메모장 | 폴더 보관함 → 메모장 → + 메모 → 이름 · 본문 → 저장 → 목록에 보인다 |
| 오버헤드 패널 | 오른쪽 위 손잡이로 접고 편다(`ovhHide`) |
| 상태 화면 | 이 노드 칸의 상태 화면 — 로그인 전이라 `로그인 전`(원본처럼 `로그인됨`으로 그리지 않는다) · 예시 표식 없음 |
| 도로 편집기 보드 | `fsEnter('rd')` → 보드가 `road.html`로 뜬다 · 보드 안의 `← 노드 화면`은 중첩 노드 화면이 아니라 전체 화면 끝 |
| 창 크기 | 창을 1700 × 1000으로 바꾸면 화면 크기(`scr`)가 따라간다 |
| 받기 조각 보관 | 진짜 IndexedDB(`src/store/parts.js`) — 두고 · 새 객체로 다시 열면(새 페이지처럼) 0부터 이어진 조각과 앞선 전송 id · 빈틈 뒤는 쓰지 않기 · SHA-256 이 다르면 버림 · 지움 |

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
| `tests/api.test.mjs` | 봉투 벗기기 · 위임 자격의 Master 401 · 다른 노드(노드 주소 호출 — 그 노드 카탈로그 · 연 것만 · `allowed: false` · 길이 없는 게이트웨이 · `node_id` 모름 · Master 길 오류) · 다른 노드의 공유 폴더(원격 모듈 경로 · `fillRoute`) · frame 역할 · 보드 링크 |
| `tests/data.test.mjs` | 노드 이름 · 관계도 · 알림 · 보관함 칸 |
| `tests/live.test.mjs` | 노드 화면 · 보드 · 편집기를 브라우저 없이 만들어 **상태와 렌더 값 전체에 예시 표식이 없는지**, 실제 응답 모양 → 화면 모양, 모듈 · Daemon 이 모르는 키를 싣지 않는지, WireGuard 꺼짐, 18칸을 넘는 자식, 권한(다른 노드는 노드 주소 호출로 닿을 때만 `관리자 · 중계`) |
| `tests/module.test.mjs` | (MD-36 · MD-40 추가: 노드 카드 사용량 — 값이 없으면 막대 없음 · 이름만 다른 노드가 같은 값을 내지 않는다 · 받은 값은 반올림 · 0~100 · 80% 초과 경고색 / 창 본문 — 보드가 있는 창 · 없는 창 · 모듈 · 사용자 요약)  부트 프로필(`prep` · 공통 보정 — 빈 맵 · leaf 맵 자기 칸), LayoutStore(되살리기 — `ovhHide` · 메모 모양 포함 · 묶기 · 끊기 · 바뀐 것만 저장 · `loadWorld`가 저장본을 되살리고 로그아웃이 덮지 않기 · 상태 화면 · 폼 · 모듈 GUI 창을 비우기), 사용자 문서(`DocStore` — 앱 이름공간 경로 · 없음 404와 못 씀 501 · `base_revision` · 409 한 번 알림 · 모아서 쓰기 · 끊기 · 새 쪽이 이긴다 · 편집기 자산 받기 · 내보내기 · `loadWorld`가 서버 것이 새로우면 그 배치를, 브라우저 것이 새로우면 한 번 올리기 · 저장소가 없으면 브라우저만), 시작 화면(비밀번호 없음 · 로그인 카드 · 토큰이 있으면 내려가기 · 잃으면 돌아오기 · 다 내려간 뒤 로그아웃하면 판으로 · 내려간 뒤 아래 알약이 누름을 받지 않기), 자기 칸(캡슐 · 공유 연결 · 나가는 연결 규칙), 노드 이름이 바뀐 저장본(`remapNodes`), frame 연결 빌리기, 설치한 노드 자원 · 상태 화면의 앱 다시 받기(폴더는 위 칸까지), 오프라인 노드 = 정지 이벤트 |
| `tests/events.test.mjs` | 실시간 이벤트 — SSE 프레임(주석 · 덜 온 프레임 · `\r\n`) · invoke 로 열고 마지막 id 부터 이어 받기 · 길이 없으면(404 · 501 · 이벤트 스트림이 아닌 답) 끄기 · 아픈 게이트웨이(502)는 여섯 번에서 끄기 · 신호를 0.25초 모아 그 목록만(`applySignal`) · `reset` 은 다 · 로그인 전 신호 버리기 · `_hbRefresh` 는 받아 둔 목록만 · 열려 있으면 폴링이 여섯 배 느리다 |
| `tests/node-ops.test.mjs` | 이 노드의 손 동작 — SHA-256 · base64 · 올리기(만들기 → 조각 → 409 면 서버 offset → 완료 · 다섯 번에서 멈춤) · 받기(조각마다 · 전체 검사 · 어긋나면 `pulls.abort`) · 장치 손 등록(scheme → 어댑터 · 비우면 스캔) · 출력 칸 글(게이트웨이 · Daemon 로그 · Master 작업 · 출력 없는 작업 기록) · 로컬 탐색(루트 · 항목 · 🔒 · 한 번만 · 실패하면 다시) · 바탕화면에서 열기(그 컴퓨터에서만 · `shared:<이름>` · 실행 파일 409) · Master 에 닿지 않는 노드 관리 |
| `tests/taskout.test.mjs` | 작업 출력 · 다시 실행(MD-34 · Terra PF-7) — 출력 쪽 → 출력 칸의 글 · 겹친 순번 · 칸의 글 끝만 · 출력 SSE 따라가기(읽은 `last_seq` 뒤부터 · 끊기면 이어서 · `end` 에 닫기) · 대응표 · Master 가 보낸 작업 · 화면과 함께 실행 중인 작업을 따라가기 · 다시는 두 번 누름 |
| `tests/linkio.test.mjs` | 연결의 입출력 `io`(MD-27) · 도로 이벤트 `linkEv`(MD-31 — 생성된 스크립트에 패치 한 줄이 있는지도) — 판정(바인딩 · 공유 · 화면 전용) · 쌍 풀기(자원 → 자원 · 입력 더하기 · 출력 더하기 · 노드 + 고른 자원 · 자기 자신 빼기) · 엔드포인트 하나뿐일 때만 자동 · 같은 쌍 참조 · 멱등 키 · `io` 만들기 · 다시 만들어도 설정 · 서버 id 이어받기 · 상태 합치기 · 어긋난 저장본 다듬기(`reviveLinks` · `reviveMaps`) · 화면에 끼우기(`connEnd` · `nodeSelToggle`) |
| `tests/linkapply.test.mjs` | 연결 적용(MD-28) — Master 계약 모양의 가짜 클라이언트로: 미리 검사(방향 · operation · 형식 exact · QoS) · 내 허가 판정(user 주체 · 기한 · 끝점 범위) · bind 본문(계약 일곱 키 · `node_id` 없음 · 멱등 키) · 허가 없으면 부르지 않기 · 403 `SVI_BINDING_DENIED` 이유 · 서버에 닿지 않으면 바꾸지 않기 · 엔드포인트 고르기 · 이미 있는 바인딩 다시 안 만들기 · 합류 · 공유(노드 허가 · 이미 있으면 재사용 · via) · `screen.linkApply` · `linkGrantSelf` |
| `tests/linksync.test.mjs` | 연결 상태 맞추기 · 끊기(MD-29 · MD-30) — observed_state → 상태 · 이유 지우기 · 목록에 없으면 하나씩 확인하고 404일 때만 `lost` · 서버에 닿지 않으면 바꾸지 않기 · 공유 허가 기한 · 철회 · 닫기(404는 닫힘 · 닿지 않으면 실패) · 같은 바인딩을 쓰는 연결이 남으면 닫지 않기(이 맵 · 다른 맵) · 화면: 연결이 사라지면 닫기 · 맵 이동 · 세계 교체는 건드리지 않기 · orphans 다시 닫기 · 읽는 사이 바뀐 연결 지키기 · 신호 · 걷기 · 저장 · 이유 글 · 도로 이벤트 대응 |
| `tests/resume.test.mjs` | 끊긴 뒤 이어서(MD-21) — 멈춘 전송 가리기(기한 · 기록 60초 · 이 화면이 15초 지켜봄 · 이 화면이 하는 것은 아니다 · 노드마다 따로) · 올리기(`FILE_TARGET_EXISTS` → 전송 목록 → `resume_id` · 다른 화면이 보내는 중 · 같은 이름의 다른 파일 · 그런 전송이 없다 · 방금까지 움직인 것은 잠깐 기다려 다시 보기 · 카드의 이어서는 크기 · SHA-256 이 같아야 · 기한이 지나면 다시 열기 · 중단되면 멈추기) · 받기(둔 조각부터 · 앞선 받기 닫기 · 다 받으면 지우기 · 바뀐 파일은 처음부터 · 전체가 어긋나면 버리기 · 기한이 지나면 다시 열기 · 보관할 곳이 없으면 메모리로만) · 화면과 함께 카드의 이어서(받기 · 올리기 — 파일 고르기) · 중단(부분 남김) · 치우기(부분도 버림) |
| `tests/modcfg.test.mjs` | 모듈 설정(MD-22) — `cfgForm`(칸 다섯 가지 · 저장된 값 · 기본값 · 비밀은 설정됐는지만) · `cfgPatch`(바뀐 키만 · 비우면 unset · 비밀은 적었을 때만 · 수 · JSON 모양 · `base_revision`) · `modConfig`(스키마 → 값 · 다른 노드는 노드 주소 호출 · 선언 없음) · 화면과 함께 폼 열기 → 거절한 키 · 409 겹침 · 저장 · 다시 받아도 칸 유지 · `module.manage`★ 가 없으면 볼 수만 · 선언 없는 모듈 · 끊기 · I/O 를 고칠 때 주소 칸 빼기 |
| `tests/sviflow.test.mjs` | SVI 흐름도(MD-23) · 흐름 칸(MD-24 — 상태 화면이 보는 자원의 SSE → `state.sviStream` · 끝나면 마지막 모습 · 열기/닫기 본문 · `StreamView` 글자 · hex · 다시 붙기 · 꼬리 500줄) — `ADAPT.svi` 의 `flow`(엔드포인트 · 열린 핸들 · 바인딩 · 허가 · 상대 노드 이름) · `ADAPT.grant`(Master 의 답 모양 `items` · `subject` · `source{resource_id}`) · `frameEvent` `raw` · `source.list(svi)` · 흐름 이벤트 SSE → `state.sviEv`(끝나면 목록 다시 · 끊으면 지움) · 카탈로그에 없으면 열지 않기 · 예시 흐름 이벤트 없음 · 보고 있는 앱의 목록 실패 이유를 남기기. 여덟 모두 고치기 전 코드로는 실패한다 |
| `tests/crud.test.mjs` | 추가 · 수정 · 삭제 — 앱마다 **본문이 실제 서버의 입력과 같은지**(서버 코드로 확인한 모양), Master POST에 `node_id`를 싣지 않기, 길이 없는 것은 `null` · 카탈로그에 없는 op는 부르지 않기(중단해 둔 전송의 삭제는 서버에서 포기), GUI 앱 붙이기. 실데이터 층 화면과 함께 — 폼 저장이 지어내지 않기 · 두 번 누름 · 맵 자리 걷기 · 취소는 남기기 · 이름 · 칸 id 따라가기 · 폼을 여는 동작 · 끊으면 되돌리기 · API 줄 ⚠ · 자리 표시자 · 모듈 GUI 창 · 상태 화면 로그인 줄 |
| `tests/module-gate.test.mjs` | 모듈 게이트(MD-38) — 모듈이 없으면 부르지 않고 `no-module` · 있으면 부른다 · `modules.get` 15초 캐시(첫 화면과 설정 보드가 한 번만) · 못 받으면 막지 않는다 · `LOCAL_API_UNAVAILABLE` 글 |

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
| 호출 | 주입한 `fetch`로 상대 경로를 부르고 확인 헤더를 싣지 않는다 · 다른 노드는 노드 주소 호출로(그 노드 카탈로그에 있는 것만 · 길이 없는 게이트웨이면 부르지 않는다) |
| 위임 자격 | Master 401은 `unavailable · master-delegation`이고 다음부터 부르지 않는다 · 단독 실행의 401은 그대로 `unauthenticated` |
| 데이터 소스 | `'<노드>'` 자리 표시자가 실제 노드를 덮지 않는다 · `node_id` 를 모르는 노드(tree 항목)는 부르지 않고 이유를 낸다 · 본문에 `node_id` 를 싣지 않는다(노드는 경로에) · 모듈 로그는 다른 노드면 그 Daemon 것 |
| frame | frame 안인지 가린다(다른 origin 부모 · 같은 origin 부모 · 단독) · 보드 링크의 페이지 이름. SSE 프레임은 `tests/events.test.mjs` |

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
| 로그아웃 · 저장본 | 자기 칸 캡슐 · 저장본의 `nodeIds` · 세션 띠의 [로그아웃] → 시작 화면이 판으로 돌아온다(노드 화면 투명 · 누름은 판이 받는다) → 다시 로그인 → 같은 맵 |
| 다시 열기 | 셸 새로 고침 → 다시 로그인 → 자원 · 연결 · 도로 · 메모 · 표지가 되살아난다 |
| 창 크기 · 로그아웃 | 1800 × 1050에서 꽉 찬다 · 로그아웃 → 빈 세계 · 저장본은 그대로 |
| 모든 단계 | 모든 frame의 보이는 글에서 예시 표식 0건 · 콘솔 오류는 셸의 `/api/product/session` 404뿐 |
| 모듈 설정(MD-22) | 스택을 Terra main(모듈 설정 op 셋)으로 빌드하고, `configuration.schema`를 선언한 시험 모듈(scratchpad — 저장소에 담지 않는다)을 깐다. 관리자에게 `module.manage`★를 따로 준다(기본 권한 밖 — `PATCH /api/v1/admin/users/{id} {permissions}`). 앱 전체 화면에서 그 모듈의 `✎` → 거절(키) · 저장 · 다시 열기 · 겹침(다른 쪽이 먼저 `config.patch`) · 비우기 · 설정 없는 모듈 · 권한을 빼면 볼 수만. 결과는 관리자 토큰의 `config.get` 으로 견준다 |
| SVI 흐름도(MD-23) | 같은 스택에 모듈을 다시 깔고 앱 전체 화면에서 SVI 자원 앱(흐름도 · 카드 보기)과 네트워크 화면(`네트워크 화면` 탭 → 보드)을 연다(`e2e-md23`). 화면이 부른 operation 을 모두 적는다 — `svi` 가 들어간 것 0 · Master 네트워크 읽기 0, 이유 글이 10초 뒤에도 남고, `state.sviEv` 가 비어 있다 |
| 끊긴 뒤 이어서(MD-21) | 준비에 io.terra.file 0.2.1(부분을 남기는 중단). 4 MB 올리기 · 받기를 가운데서 **페이지를 떠나** 끊고(`context.route`로 조각마다 120ms 늦춘다) 다시 로그인해 잇는다 — 같은 파일 다시 올리기 · 다시 받기(IndexedDB) · 멈춘 카드의 이어서(이름이 다른 같은 파일) · 중단 → 다시 올리기 · 치우기. 내용은 디스크 · 내려받은 파일의 SHA-256 으로, 건너뛴 것은 다시 보낸 · 받은 조각 수로 본다 |
| Terra G0~G6 연동 | 준비에 modules main의 io.terra.file · io-inventory 0.2.0(`node tools/build-modules.mjs --terra <Terra> --target linux-amd64` → pack → install)을 더한다. 실시간 이벤트(`open` · 신호 → 그 목록만) · 손 등록 폼 → Daemon `manual.rtsp` · 노드 주소 호출(그 노드 카탈로그 · 중계 · 로컬 전용은 잠금) · 모듈 로그 출력 칸 · 폴더 탐색기 · 바탕화면 열기 · `↑ 올리기` **단추를 눌러** 파일 고르기 → 서버 크기 · 폴더 앱 `받기` → 다운로드 내용이 같다 · 사용자 문서 → **새 브라우저(빈 저장소)**로 로그인해 같은 배치 → 겹쳐 쓰면 409 한 번 알림 |
| 입출력 연결(MD-32) | `tools/live-stack-up.sh <Terra> <폴더>` 로 스택을 세우고 `. <폴더>/env.sh && node tools/live-linkio.mjs` — 모듈의 연결 적용 코드를 앱 토큰으로 leaf 게이트웨이의 위임 입구에 붙인다(허가 · 공유 · 거절 · 가드 · 바인딩 `active` · 데이터 · 닫기, 27개). `active` 단계는 [Terra#188](https://github.com/StellaxiaLab/Terra/pull/188) 이 들어간 Terra 가 필요하다. 세우는 법 · 찾은 것 · 함정은 [[real-data-layer\|실데이터 층]] §5.9 |

2026-10-04 결과는 [[real-data-layer|실데이터 층]] §5.0(새 GUI) · §5.2(maingui 기준 — 추가 · 수정 · 삭제), 2026-10-05 결과는 §5.3(Terra G0~G6 연동) · §5.4(끊긴 뒤 이어서) · §5.5(모듈 설정) · §5.6(SVI 흐름도).

> [!NOTE] 파일 고르기 · 다운로드
> 파일 고르기 창은 사람의 누름(user activation)이 있어야 열린다 — `evaluate` 로 `hbAct` 를 부르면 막힌다. Playwright 로 단추를 누르고
> `page.waitForEvent('filechooser')` → `setFiles`. 받기는 `page.waitForEvent('download')`(컨텍스트 `acceptDownloads: true`) — 중첩 srcdoc 안에서 받아도 페이지 이벤트로 온다.
> 멈춘 카드의 `이어서`도 파일 고르기다 — 화면은 누름 안에서 곧바로(기다리지 않고) 고르기 창을 연다.

> [!TIP] 떠 있는 것이 누름을 가로채면
> Playwright가 `… subtree intercepts pointer events`로 멈추면 사람도 그 자리를 누를 수 없다는 뜻이다 — `evaluate`로 돌아가지 말고 무엇이 위에 있는지 본다.
> 시작 화면의 아래 알약이 노드 화면 아래 누름을 가로챈 것(구현해야 할 것 UP-15)이 이렇게 드러났다.

## 관련 문서

- [[docs/README|개발 문서 MOC]]
- [[getting-started|시작하기]]
- [[frontend-api|프론트엔드 API]]
- [[architecture#7. Terra 안에서 — frame|구조 §7 — Terra 안에서]]
- [[module-profile|모듈 프로필]]
- [[real-data-layer|실데이터 층]] — §5 실측 기록
- [[implementation-backlog|구현해야 할 것]] — MD-6(E2E를 CI로)
