# Terra Agent 웹 앱 (`io.terra.agent/web`)

모듈 `io.terra.agent`의 화면. 순수 TypeScript + DOM(프레임워크 없음), Vite 8 · TypeScript 7 strict · Vitest 5. 빌드 결과는 `../ui`(커밋하지 않는다)이고 `module.json`의 앱 entry(`ui/index.html`)가 가리킨다. `web/`은 모듈 포장에 들어가지 않는다.

```sh
npm ci
npm run dev        # 개발 서버. VITE_TERRA_DEV_TOKEN 이 있으면 토큰 전송(개발 전용, 프로덕션 번들에서는 코드째 사라진다)
npm run typecheck && npm test && npm run build
npm run e2e:server                 # 가짜 Gateway·모듈 서버의 단위 시험(node --test, 브라우저 불필요) — 48개
npm run build && npm run e2e -- --app ui   # 빌드한 실제 앱(../ui)을 브라우저로 — 앱 e2e 119개 (인자 없이 `npm run e2e` 는 probe 앱 스모크)
```

`e2e`·`e2e:server` 는 `npm test`(Vitest)와 따로다 — 브라우저(전역 playwright·미리 깔린 Chromium)가 필요한 시험은 `test` 에 넣지 않는다. 준비물과 구성은 [e2e/README.md](e2e/README.md), 점검 현황은 [e2e/TODO-checks.md](e2e/TODO-checks.md). 2026-10-15 modules `main` `85448b2` 위에서 `typecheck`·`test`(Vitest 37파일 681개)·`build`·`e2e:server`(48/48)·`e2e -- --app ui`(119/119)를 돌려 모두 통과했다.

## 지금 있는 것 (WP-1~WP-5 · G1 · G2 · G3 읽기 전용 · e2e 하네스 · 글꼴)

| 층 | 위치 | 하는 일 |
| --- | --- | --- |
| 전송 | `src/transport/` | `AgentTransport`(브리지·토큰·가짜), 재시도 never 가드, 폴링 스케줄러 |
| API | `src/api/` | operation 래퍼(`createAgentClient`), 응답 타입, entry 파서 |
| 데이터 | `src/data/` | 저장소(`createDataStore`), 이음새, 카드 합성, 상태→화면 규칙, 준비 상태 합성, 오류 사전, 보내기 가드 |
| 앱 | `src/app/` | 부트스트랩(`boot.ts`), 본체(`app.ts` — 폴링·상태·동작), 라우터(`router.ts`), 설정 화면의 모델·동작(`settings.ts`), 순수 규칙(`input.ts`·`scroll.ts`·`turns.ts`·`session-rows.ts`·`readiness-model.ts`·`call-adapter.ts`·`format.ts`), DOM 도우미(`dom.ts`) |
| 화면 | `src/views/` | 화면 조각. 한 번 만들고 `update(model)`로 갱신한다 — 초점·한글 조합·스크롤을 잃지 않는다 |
| 스타일 | `src/styles/` | `tokens.css`(`--f-*` 등 토큰) · `base` · `layout` · `components` · `a11y`(초점·대비·폴백) |

G1 화면: 1 준비 상태(`views/readiness.ts`) · 2 세션 목록·새 세션(`sidebar.ts`·`new-session.ts`) · 3 대화(`session-pane.ts`·`entries.ts`·`session-info.ts`) · 7 입력·취소(`composer.ts`·`cancel-dialog.ts`).

- **승인 카드(WP-5, G2)**: `views/approval-card.ts`·`approval-strings.ts` — 대기 카드의 승인·거부·카운트다운, 끝난 카드는 한 줄. 호출 줄의 접힌 상세(입력·결과 요약·결과 방식, "접수 ≠ 완료")는 `entries.ts`.
- **새 세션 폼(G2)**: `views/new-session.ts` · `data/new-session-form.ts` — 자율성 `plan`(기본)·`ask`·`auto`, 시뮬레이션, 제목, provider, 외부 MCP 서버 선택, 한도 셋. `unattended` 는 G4 까지 꺼져 있다.
- **설정(G3, 읽기 전용) · 자격 거두기**: `views/settings.ts`·`revoke-dialog.ts` · `data/settings.ts` — 아래 "설정(G3, 읽기 전용) · 자격 거두기".
- 라우팅은 hash(`#/` · `#/new` · `#/s/<id>` · `#/settings`).
- 헤더에 `status.get` 의 `node_name` 이 있으면 대상 노드 이름을 보인다(GAP-13).

## 지키는 것

- 앱 자산 CSP가 `script-src 'self'`다 — 인라인 스크립트·이벤트 속성 없음. 동적 텍스트는 텍스트 노드로만 넣는다(`innerHTML` 계열 금지 — `tests/no-html-insertion.test.ts`가 소스를 훑는다).
- 토큰은 메모리에만. 브라우저 저장소를 쓰지 않는다.
- 셸 밖에서 열면 "이 앱은 Terra 셸 안에서 여세요." 안내만 보인다(결정 Q-1).
- 글꼴은 앱에 싣는다(결정 D-11) — 아래 "글꼴" 절. 외부 URL 없이 `font-src 'self'` 에서 로드되고, 글꼴이 없어도 스택이 시스템 글꼴로 떨어진다.

## 글꼴 (D-11)

| 글꼴 | 버전 · 출처 | 라이선스 | 싣는 것 |
| --- | --- | --- | --- |
| Pretendard Variable | 1.3.9 · npm `pretendard` 의 공식 dynamic subset | SIL OFL 1.1 | 가변(굵기 45~920) woff2 92조각 — 앱은 400·500·600·700 을 쓴다. `unicode-range` 로 화면에 나온 글자의 조각만 내려받는다 |
| Inter | 5.3.0 · npm `@fontsource-variable/inter` | SIL OFL 1.1 | 가변(100~900) woff2 latin · latin-ext 두 조각 |

- 선언은 `src/styles/fonts.css`(`font-display: swap`, `url(/fonts/…)` — 빌드가 `../fonts/…` 상대 경로로 바꾼다). 파일은 `public/fonts/` 에 있고 빌드가 `../ui/fonts/` 로 복사한다. 갱신은 npm 패키지를 새로 받아 `public/fonts/` 의 woff2 와 `fonts.css` 의 선언을 같이 바꾸고 `tests/fonts.test.ts` 로 맞춘다.
- **OFL 고지**: `public/fonts/pretendard/OFL-pretendard.txt` · `public/fonts/inter/OFL-inter.txt`(저작권 표시와 라이선스 전문). 빌드와 함께 `ui/fonts/…` 로 나가므로 모듈 패키지가 글꼴 파일 옆에 고지를 같이 싣는다(OFL 의 재배포 조건). 글꼴 이름(Pretendard·Inter)은 바꾸지 않았고 글꼴 파일을 수정하지 않았다. 앱 화면 안의 고지는 두지 않았다.
- 스택은 `tokens.css` 의 `--font`(`Pretendard Variable` → `Pretendard` → `Inter` → 시스템). Pretendard 가 라틴도 담아서 Inter 는 Pretendard 에 없는 글리프의 폴백이다.
- 점검: `tests/fonts.test.ts`(선언·파일·고지, 빌드 뒤에는 `../ui` 의 외부 URL·`url()` 대상 실재까지) · `e2e/tests/fonts.e2e.mjs`(`document.fonts` 로드 상태·로드한 조각 수·바이트).

## 승인 카드(WP-5) — 확장 지점이었던 것과 지금

WP-5 는 끝났다(`views/approval-card.ts`). 아래는 카드를 끼울 때 쓴 확장 지점의 기록이고, 지금도 그대로 맞는 구조다. `views/entries.ts` 머리의 "확장 지점(WP-5)" 주석은 코드 쪽이라 이 문서 정리에서 고치지 않았다.

- `views/entries.ts`의 `defaultEntryRenderers.approval` — 대기 카드는 `renderPendingCard`(`approval-card.ts`)가 그린다. 카드가 시간에 따라 바뀌면(카운트다운) `signature()`가 바뀌는 값을 돌려주면 그 줄만 다시 그린다. 컨텍스트(`EntryContext.cards`)에 합성된 카드(`ApprovalCard`)가 들어 있다.
- 승인·거부 동작은 `store.answerApproval(sessionId, requestId, 'approve' | 'deny')`가 있다(대기 카드에만, 두 번째 404는 정상). `app.ts`에 핸들러를 추가하고 렌더러가 부르게 한다.
- 인박스는 `app/session-rows.ts`의 `buildInbox`와 `views/sidebar.ts`의 `inbox`다. 카드가 서면 `left`(남은 시간)를 근사 마감(GAP-12)과 함께 채운다.
- 승인 대기 중 입력 잠금은 이미 `screenFor`가 한다(`pending_approvals`가 있으면 상태와 무관하게 잠근다).

## 시연 점검 하네스(`design/checks/`)를 앱에서 쓸 수 있나

아래는 하네스를 앱으로 옮기기 전에 적은 메모다. 그 뒤 앱 e2e 하네스(`e2e/`)가 섰고, 접근성·초점·대비·폴백 점검(`contrast-fallback`·`focus-stops`·`scroll-follow`·`textarea-grow` 몫)은 `e2e/tests/a11y.e2e.mjs`·`scroll.e2e.mjs`·`input.e2e.mjs` 로 옮겨졌다 — 이식 현황은 [e2e/TODO-checks.md](e2e/TODO-checks.md). `design/checks/` 자체는 그대로 시연용이다.

- 그대로 쓸 수 있는 것: `contrast-fallback.mjs`의 `measure(backdrops)`(페이지 안에서 도는 순수 함수 — 글자마다 겹친 배경색을 쌓아 WCAG 대비를 센다), `focus-stops.mjs`의 Tab 순회 로직, `lib.mjs`(Playwright 불러오기·정적 서버·`/opt/pw-browsers/chromium` 실행). 이 앱에서 임시 스크립트로 `measure`를 돌려 뒤 배경 검정·회색·흰색 모두 4.5:1 이상(최저 5.0), `prefers-reduced-transparency`·`prefers-contrast:more`는 단색(`rgb(19,22,27)`, 흐림 없음)임을 확인했다.
- 고쳐야 쓸 수 있는 것: 대상 루트가 `.win`으로 박혀 있다(이 앱은 `.app`) · `build-pages.mjs`가 `.dc.html`을 `dc.js` 런타임으로 굽는 방식이라 앱 빌드 산출물에는 필요 없다 · `window.__mounted`·`AgentGUILive.html` 같은 시연 전용 신호를 쓴다 · 시연의 `.inp input, .inp textarea`·`.btn.pri.sm` 선택자는 이 앱과 같지만 승인 한 판(`RESTART`)·가짜 시계(`page.clock`) 시나리오는 가짜 Gateway가 있어야 돈다.
- (옮기기 전의 전제 메모) 앱 e2e의 전제: 앱 자산 CSP(`script-src 'self'`)를 응답 머리로 싣는 정적 서버, 셸 역할의 부모 페이지(iframe `sandbox="allow-scripts allow-forms allow-same-origin"`, `hello`→`ready`→`request/response`), 가짜 Gateway. 이 PR의 브라우저 확인(임시, 커밋하지 않음)이 그 모양이었다.
- 하네스의 `package.json`이 없고 Playwright는 전역 설치(`NODE_PATH=$(npm root -g)`)를 쓰는 규약은 e2e에서도 그대로 이어졌다(저장소 의존이 아니다 — CI `web` 잡은 빌드와 `npm test` 만 돌고 `e2e`·`e2e:server` 는 돌리지 않는다).

## 설정(G3, 읽기 전용) · 자격 거두기

사이드바 아래의 "설정 · 모델 · 자격" 링크(`#/settings`)가 화면 6이다(보드 ④·⑧).

- **읽기만 한다**: 모델 목록(`models.list`: provider·model·base_url·기본·등록 — 키는 어떤 응답에도 없다) · 자격 사실(`credentials.get`: 만료·권한·도달 범위·무인·대리인 — "만료 시각 전 — 폐기 여부는 확인하지 못함", R-10) · MCP 서버(`mcp.list`: 명령·도구 수·env **이름**) · 한도 기본값(새 세션 폼이 채우는 24 · 900 · 무제한). 응답은 `data/settings.ts` 가 허용 목록으로만 옮긴다 — 계약을 어기고 키·자격 문자열·env 값이 실려 와도 화면 모델에 들어오지 않는다(`tests/settings-data.test.ts`). `base_url` 의 사용자 정보·쿼리는 가려서 보인다.
- **하지 않는 것**: 모델 등록·교체(`models.put`, R-9·R-11 모듈 선행이 없다) · 모델 삭제(기본 provider 승계 확인이 필요하다) · MCP 등록·삭제(D-4) · G4. 입력칸·쓰기 단추가 없고 터미널 명령으로 안내한다.
- **자격 거두기**(`credentials.delete`, DC-20): 대화창이 세 단계를 한 버튼에 묶지 않는다. ① 열린 세션 취소(앱, `store.cancel`) → ② Gateway 폐기(사람 세션만 — 앱은 `terra agent revoke <id>` 를 보이고 복사하게 하고, 사람이 "폐기를 마쳤습니다"를 확인해야 한다) → ③ 자격 삭제(앱). 삭제는 열린 세션이 0 이고 폐기를 확인해야 풀리고(`aria-disabled` + 이유), 한 번만 나간다. 확인 단계는 "폐기 여부는 확인하지 못함"과, 턴 도중 거두면 HTTP 오류 없이 `call` 줄에 `GATEWAY_UNREACHABLE` 만 쌓일 수 있음을 말한다. 응답을 잃으면(`outcomeUnknown`) 다시 보내지 않고 자격을 읽어 확인한다. 삭제한 뒤에도 결과 화면에 "Gateway 폐기는 아직입니다"와 명령이 남는다. 대리인 id 가 명령에 안전한 글자가 아니면 명령을 만들지 않는다(셸에 붙이는 글).
- 점검: `tests/settings-data.test.ts` · `tests/app-settings.test.ts`(Vitest) · `e2e/tests/settings.e2e.mjs`.

## 알려진 한계 / 미룬 것

- 새 세션 폼은 `plan`·`ask`·`auto` 를 연다. `unattended` 세션 열기(무인 자격·사전 승인 화면)는 G4 까지 꺼져 있다. 아무것도 안 건드리고 열면 본문에 `plan` 만 싣는다(D-7).
- 코어 `terra-agent` 의 `v0.2.0` 태그가 생겼다(커밋 `87060ae`, M-5 `Record` 칸). `src/go.mod` 를 `terra-agent v0.2.0` 으로 올리는 일은 이 README 가 실린 PR(modules #110, 초안)이 하며, 그 PR 이 병합되기 전의 `main` 은 아직 `terra-agent v0.1.0` 을 가리킨다. 모듈·계약·앱은 입력 요약·결과 요약·결과 방식(M-5) 칸을 이미 다룬다. 코어 `v0.1.0` 으로 도는 동안에는 실제 호출에서 그 칸이 비고, 앱은 빈 칸을 라벨째 숨기고 접수라고 단정하지 않는다(계획서 R-5·`tests` 의 이전 모듈 모양 점검). 승급 브랜치에서 `GOWORK=off go test -run TestARealCallFillsTheDetailsWhenTheCoreSupportsThem -v` 가 건너뛰지 않고 통과하는 것을 확인했고(건너뜀 0, `go test ./...` 통과), 앱을 실제 코어와 Gateway 위에서 돌려 보지는 않았다.
- 오래된 줄은 기록 전체를 `after_seq`로 읽은 뒤 DOM에는 마지막 200줄만 그리고 "이전 줄 N개 더 보기"로 200줄씩 붙인다. 수천 줄 기록의 가상 스크롤은 아니다.
- 헤더의 대상 노드 이름(GAP-13)은 `status.get` 의 선택 필드 `node_name`(모듈 0.3.0~)이 있을 때만 보인다. 이전 모듈이거나 호스트가 이름을 주지 않으면 자리 자체가 없다. 설정 화면(G3)은 읽기 전용만 있다 — 아래 "설정(G3, 읽기 전용)".
- 시험은 jsdom이다 — 실제 한글 IME 조합과 실제 레이아웃(스크롤 지표)은 브라우저 확인에서 일부만 봤다.
