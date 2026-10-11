# 시연 점검 하네스 (Playwright)

`web/design/`의 시연 화면(`AgentGUI.dc.html`·`AgentGUILive.dc.html`)이 규칙대로 움직이는지 헤드리스 Chromium에서 다시 돌려 보는 점검이다. 디자인이 바뀔 때마다 같은 점검을 되풀이하려고 올렸다(구현 인수 문서 Q-5, 2026-10-11 확정). 구현 앱의 e2e가 서면 그쪽으로 옮긴다.

- 점검 묶음의 설명은 Terra 저장소 `docs/implementation/terra-agent-gui-plan.md` §5.3 "이식할 점검"과 §2.1, 이 폴더 위의 사본 `../terra-agent-gui-plan.md`에 있다. 측정 결과의 해석은 요구 문서 §13.6(`../terra-agent-gui-requirements.md`)이다.
- **이 폴더는 모듈 포장에 들어가지 않는다.** `web/` 전체가 포장 허용 목록 밖이다(modules `tools/validate-modules.mjs`의 `DEV_ONLY`에 `web`이 있고, 빌드 산출물만 `ui/`로 간다). 디자인 원본과 이 폴더는 소스 트리에만 있다. 디자인 파일은 읽기만 하고 고치지 않는다.
- `package.json`은 두지 않는다(`web/package.json`은 앱 골격이 따로 만든다). 의존은 `playwright` 하나이고 전역·임시로 쓴다.

## 필요한 것

| 필요 | 방법 |
| --- | --- |
| Node 18 이상 | 22에서 돌렸다 |
| `playwright` 패키지 | 전역 설치를 가리킨다: `NODE_PATH=$(npm root -g)` (또는 `PLAYWRIGHT_MODULE=/경로/node_modules/playwright`). 1.56.1로 돌렸다 |
| Chromium | 미리 깔린 것을 쓴다. 기본 `executablePath`는 `/opt/pw-browsers/chromium`(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), `CHROMIUM_PATH`로 바꾼다. **`playwright install`은 쓰지 않는다.** Chromium 141로 돌렸다 |
| `dc.js` | `common/lab.stellaxia.node-gui/web/src/runtime/dc.js`(디자인 캔버스 문법을 브라우저에서 돌리는 작은 런타임). 기본 경로는 이 폴더에서 상대 경로로 잡는다. 바꾸려면 `DC_JS` 환경변수나 `build-pages.mjs`의 넷째 인자 |

## 실행

```sh
cd common/io.terra.agent/web/design/checks
export NODE_PATH=$(npm root -g)            # playwright 위치
node run-all.mjs                            # 기본: 대상 = web/design, 출력 = ./.pages
node run-all.mjs <designDir> <pagesDir>     # 다른 디자인 폴더·출력 폴더를 지정
```

대상 파일 경로는 인자다. `designDir`에는 `AgentGUI.dc.html`·`AgentGUILive.dc.html`·`assets/map-sample.jpg`가 있어야 한다. 종료 코드는 실패가 하나라도 있으면 1이다. 개별로 돌리려면 먼저 `node build-pages.mjs [designDir] [pagesDir]`로 페이지를 만든 뒤 `node <스크립트> <pagesDir>`를 쓴다.

| 파일 | 하는 일 |
| --- | --- |
| `build-pages.mjs` | `*.dc.html`을 점검용 페이지로 만든다 — node-gui `tools/gen-pages.py`와 같은 방식(헬멧 → 머리, 템플릿 → 본문, 스크립트 → `dc.js`의 `DCLogic`을 잇는 ES 모듈) |
| `demo-checks.mjs` | **점검 35개의 본체.** 아래 표 |
| `contrast-fallback.mjs` | 글자 대비(뒤 배경 검정·회색·흰색)와 선호 설정 폴백 30건 |
| `focus-stops.mjs` | Tab으로 모든 정지점을 훑어 `:focus-visible`과 고리를 확인 |
| `scroll-follow.mjs` | 올려 읽는 중 새 줄이 와도 읽던 줄이 밀리는지 측정(DC-23의 남은 것) — 통과/실패를 가르지 않고 값을 적는다 |
| `textarea-grow.mjs` | 입력칸이 줄 수에 따라 자라는지 측정(DC-22) — 값만 적는다 |
| `iframe-backdrop.mjs` | 셸 iframe 안에서 `backdrop-filter`가 뒤를 흐리는지, 틀린 `clip-path: shape()`가 버려지는지 — 값만 적는다 |
| `run-all.mjs` | 위를 차례로 돌려 요약을 낸다 |
| `lib.mjs` | Playwright 불러오기·정적 서버·Chromium 실행 공용 |

## `demo-checks.mjs`가 보는 것

대상은 동작하는 화면(`AgentGUILive`)과 정적 보드(`AgentGUI`)다. 시간은 Playwright 가짜 시계로 감아 5~270초의 기다림을 건너뛴다(실시간 스모크 하나는 가짜 시계 없이 돈다).

| 묶음 | 본 것 |
| --- | --- |
| 불러오기 | 콘솔 오류·페이지 오류·실패한 요청·4xx가 없다. `corner-shape: squircle` 지원과 실제로 그려진 글꼴(환경 기록) |
| 승인 한 판 | `ask` 세션에 글 → `running` → `waiting-approval`(카드·인박스·머리 칩·입력 잠김) → 카운트다운 → 승인 → `accepted-job` → `idle`. 두 번 불러도, 실제 더블클릭도 한 번 |
| 거부·시간 초과·취소 | `TERRA_APPROVAL_DENIED` 줄 · `TIME_LIMIT`(카드 "시간 초과", 입력 복귀) · 확인창과 취소 뒤 줄이 늘지 않음, 대기 카드 "취소됨" |
| 무인 | 무인 + 외부 MCP 충돌 배너와 "세션 열기" 꺼짐 · 무인 자격일 때만 `unattended`가 켜진다(DC-25) |
| 입력 | 공백만은 못 보냄 · HTML과 `{{…}}`가 글자로 나옴 · 연타해도 한 번 · 조합 중 Enter 무시 · Shift+Enter 줄바꿈 · 20001자 차단(DC-22) |
| 인박스·종료·규칙 | 다른 세션의 대기 승인이 인박스에 뜨고 열린다 · `failed` 읽기 전용 · I18 표식 · I20 마지막 오류 · 차례 줄(호출은 차례 몫, 토큰은 누적, DC-26) |
| 스크롤·접근성 | 긴 기록이 스크롤되고 새 줄이 맨 아래에서 따라간다(DC-23) · 이름 있는 입력 · `role=log`·`role=dialog` · 탭(DC-27) |
| 보드 | 정적 보드 8장이 `dc.js`로 오류 없이 그려지고 글자가 창 밖으로 잘리지 않는다 |

## 실행 결과 (2026-10-11, Chromium 141.0.7390.37, Playwright 1.56.1, Linux 헤드리스)

점검 35개는 modules 브랜치 `design/agent-gui-dc22-29`의 `c378a12`(`AgentGUI` 815줄·`AgentGUILive` 833줄) 기준으로 맞춘 것이다. **`main`의 `web/design/`은 아직 그보다 앞선 판(`73db596`, 804줄·780줄)이라** 두 판 모두에서 돌려 봤다.

| 대상 | `demo-checks` | `contrast-fallback` | `focus-stops` |
| --- | :---: | :---: | :---: |
| `c378a12` (`design/agent-gui-dc22-29`) | **35/35 통과** | 30/30 통과 | 11곳 모두 통과 |
| `73db596` (현재 `main`) | 5/35 통과 (낡은 판은 입력칸이 `<input>`이고 탭·`role`이 없는 등 c378a12에서 고친 DC-22~27에 걸린다) | 12/30 통과 (낡은 판에는 단색 폴백이 없다 — DC-29) | 11곳 통과로 나오나 `:focus-visible` 여부만 본다(고리 잘림은 재지 않는다) |

`scroll-follow`·`textarea-grow`는 `.inp textarea`를 찾으므로 `73db596`에서는 실패(시간 초과)한다. `c378a12`의 측정 전용 세 스크립트는 값을 적는다 — 올려 읽는 중 새 차례가 오면 읽던 줄이 331px 밀린다(DC-23의 남은 것, 맨 아래에서는 6px로 따라간다) · 입력칸은 5줄을 쳐도 높이 32px 그대로고 `scrollHeight` 112px다(자동 높이 없음) · iframe 안에서도 `backdrop-filter`가 켜져 뒤 줄무늬의 표준편차가 43.5에서 14.3으로 줄어든다.

점검 값은 헤드리스·소프트웨어 렌더링 Chromium 한 곳의 것이다. Firefox·Safari·Windows·macOS와 실제 한글 IME 조합(여기서는 `keydown`의 `isComposing`으로 흉내)은 보지 못했다.
