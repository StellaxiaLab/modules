# Terra Agent 웹 앱 (`io.terra.agent/web`)

모듈 `io.terra.agent`의 화면. 순수 TypeScript + DOM(프레임워크 없음), Vite 8 · TypeScript 7 strict · Vitest 5. 빌드 결과는 `../ui`(커밋하지 않는다)이고 `module.json`의 앱 entry(`ui/index.html`)가 가리킨다. `web/`은 모듈 포장에 들어가지 않는다.

```sh
npm ci
npm run dev        # 개발 서버. VITE_TERRA_DEV_TOKEN 이 있으면 토큰 전송(개발 전용, 프로덕션 번들에서는 코드째 사라진다)
npm run typecheck && npm test && npm run build
npm run e2e        # 아직 없다 — 가짜 Gateway 를 세우는 별도 작업이 이 이름으로 둔다
```

## 지금 있는 것 (WP-1~WP-4)

| 층 | 위치 | 하는 일 |
| --- | --- | --- |
| 전송 | `src/transport/` | `AgentTransport`(브리지·토큰·가짜), 재시도 never 가드, 폴링 스케줄러 |
| API | `src/api/` | operation 래퍼(`createAgentClient`), 응답 타입, entry 파서 |
| 데이터 | `src/data/` | 저장소(`createDataStore`), 이음새, 카드 합성, 상태→화면 규칙, 준비 상태 합성, 오류 사전, 보내기 가드 |
| 앱 | `src/app/` | 부트스트랩(`boot.ts`), 본체(`app.ts` — 폴링·상태·동작), 순수 규칙(`input.ts`·`scroll.ts`·`turns.ts`·`session-rows.ts`·`readiness-model.ts`), DOM 도우미(`dom.ts`) |
| 화면 | `src/views/` | 화면 조각. 한 번 만들고 `update(model)`로 갱신한다 — 초점·한글 조합·스크롤을 잃지 않는다 |
| 스타일 | `src/styles/` | `tokens.css`(`--f-*` 등 토큰) · `base` · `layout` · `components` · `a11y`(초점·대비·폴백) |

G1 화면: 1 준비 상태(`views/readiness.ts`) · 2 세션 목록·새 세션(`sidebar.ts`·`new-session.ts`) · 3 대화(`session-pane.ts`·`entries.ts`·`session-info.ts`) · 7 입력·취소(`composer.ts`·`cancel-dialog.ts`). 라우팅은 hash(`#/` · `#/new` · `#/s/<id>`).

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

## WP-5(승인 카드)를 위한 확장 지점

- `views/entries.ts`의 `defaultEntryRenderers.approval` — 지금은 "승인이 필요합니다" 자리표시다. 카드로 바꿔 끼우고 `createApp({ renderers })`로 넘긴다. 카드가 시간에 따라 바뀌면(카운트다운) `signature()`가 바뀌는 값을 돌려주면 그 줄만 다시 그린다. 컨텍스트(`EntryContext.cards`)에 합성된 카드(`ApprovalCard`)가 이미 들어 있다.
- 승인·거부 동작은 `store.answerApproval(sessionId, requestId, 'approve' | 'deny')`가 있다(대기 카드에만, 두 번째 404는 정상). `app.ts`에 핸들러를 추가하고 렌더러가 부르게 한다.
- 인박스는 `app/session-rows.ts`의 `buildInbox`와 `views/sidebar.ts`의 `inbox`다. 카드가 서면 `left`(남은 시간)를 근사 마감(GAP-12)과 함께 채운다.
- 승인 대기 중 입력 잠금은 이미 `screenFor`가 한다(`pending_approvals`가 있으면 상태와 무관하게 잠근다).

## 시연 점검 하네스(`design/checks/`)를 앱에서 쓸 수 있나

이 PR은 `design/`을 건드리지 않았고 하네스를 앱 e2e로 옮기지도 않았다. 가져다 쓸 때의 메모다.

- 그대로 쓸 수 있는 것: `contrast-fallback.mjs`의 `measure(backdrops)`(페이지 안에서 도는 순수 함수 — 글자마다 겹친 배경색을 쌓아 WCAG 대비를 센다), `focus-stops.mjs`의 Tab 순회 로직, `lib.mjs`(Playwright 불러오기·정적 서버·`/opt/pw-browsers/chromium` 실행). 이 앱에서 임시 스크립트로 `measure`를 돌려 뒤 배경 검정·회색·흰색 모두 4.5:1 이상(최저 5.0), `prefers-reduced-transparency`·`prefers-contrast:more`는 단색(`rgb(19,22,27)`, 흐림 없음)임을 확인했다.
- 고쳐야 쓸 수 있는 것: 대상 루트가 `.win`으로 박혀 있다(이 앱은 `.app`) · `build-pages.mjs`가 `.dc.html`을 `dc.js` 런타임으로 굽는 방식이라 앱 빌드 산출물에는 필요 없다 · `window.__mounted`·`AgentGUILive.html` 같은 시연 전용 신호를 쓴다 · 시연의 `.inp input, .inp textarea`·`.btn.pri.sm` 선택자는 이 앱과 같지만 승인 한 판(`RESTART`)·가짜 시계(`page.clock`) 시나리오는 가짜 Gateway가 있어야 돈다.
- 앱 e2e의 전제: 앱 자산 CSP(`script-src 'self'`)를 응답 머리로 싣는 정적 서버, 셸 역할의 부모 페이지(iframe `sandbox="allow-scripts allow-forms allow-same-origin"`, `hello`→`ready`→`request/response`), 가짜 Gateway. 이 PR의 브라우저 확인(임시, 커밋하지 않음)이 그 모양이었다.
- 하네스의 `package.json`이 없고 Playwright는 전역 설치(`NODE_PATH=$(npm root -g)`)를 쓰는 규약은 e2e에서도 같게 두는 것이 낫다(CI 러너에 브라우저가 없다 — `test`와 분리).

## 알려진 한계 / 미룬 것

- 승인 카드·활동 상세·`ask`·`auto`·`unattended` 세션 열기는 G2 이후다. 새 세션 폼의 자율성은 `plan`만 켠다(D-7).
- 오래된 줄은 기록 전체를 `after_seq`로 읽은 뒤 DOM에는 마지막 200줄만 그리고 "이전 줄 N개 더 보기"로 200줄씩 붙인다. 수천 줄 기록의 가상 스크롤은 아니다.
- 헤더의 대상 노드 이름(GAP-13)은 `status.get` 의 선택 필드 `node_name`(모듈 0.3.0~)이 있을 때만 보인다. 이전 모듈이거나 호스트가 이름을 주지 않으면 자리 자체가 없다. 설정·모델·자격 화면(G3)은 자리 표시만 있다.
- 시험은 jsdom이다 — 실제 한글 IME 조합과 실제 레이아웃(스크롤 지표)은 브라우저 확인에서 일부만 봤다.
