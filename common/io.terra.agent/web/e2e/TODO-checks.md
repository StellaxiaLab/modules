# 앱 점검 이식 현황 (§5.3 의 35개)

계획서 §5.3 "이식할 점검"(시연에서 35개를 돌려 모두 통과)을 **실제 앱**(`npm run build` → `../ui`)의 e2e 로 옮긴 현황이다. 원본은 `web/design/checks/demo-checks.mjs` 의 `t()` 32건(반복 4건을 펼치면 35)이고, 같은 폴더의 `contrast-fallback`·`focus-stops`·`scroll-follow`·`textarea-grow` 가 접근성·측정 몫이다.

앱 점검은 `tests/*.e2e.mjs` 에 `check(이름, fn, {apps:['ui']})` 로 등록한다 — `npm run build && npm run e2e -- --app ui`. 시계는 `control.advance(초)`, 기다림은 `until()`, 문구가 아니라 `data-role`·`data-kind`·`data-status`·`role` 로 단언한다. 공용 도구는 `lib/app.mjs`(`agentApi`: 세션을 서버 쪽에서 심기, `openApp`: 앱을 셸 안에서 열고 화면을 읽기).

## 집계

| 구분 | 개수 | 
| --- | :---: |
| 이식함 (앱 e2e 통과) | 19 |
| 일부만 이식함 (카드와 무관한 몫만) | 2 |
| **WP-5(승인 카드, 화면 4·5) 대기** — 구현하지 않았다 | 8 |
| 앱에 해당 화면이 없어 막힘 (무인 + 외부 MCP, G4) | 2 |
| 바뀐 앱에 맞지 않아 대체됨 | 1 |
| 디자인 시연 전용이라 앱에 해당 없음 | 3 |
| 합계 | 35 |
| 실패 | 0 |

`npm run e2e -- --app ui` 는 39개를 돈다(이 작업 이전 2개 + 이번 37개). 이번 37개에는 35개 목록 몫 외에 "시연에 없던 점검" 7개(`readiness.e2e.mjs` 6개, `auto` 의 쓰기를 묻지 않는 점검 1개)가 들어 있다.

## 35개 대응표

`✅` 이식함 · `◐` 일부만 · `⛔ WP-5` 승인 카드가 있어야 한다 · `⛔ 화면 없음` 앱에 그 화면이 없다 · `—` 해당 없음.

| # | 원본 점검(demo-checks) | 상태 | 앱 e2e 점검 / 비고 |
| :-: | --- | :-: | --- |
| 1 | env: `corner-shape: squircle`·실제 글꼴 | — | 시연 환경 기록이다. 앱에 해당 없음 |
| 2 | 마운트 시 콘솔 오류·페이지 오류·실패한 요청·4xx 없음 | ✅ | `tests/load.e2e.mjs` 3건(셸 안 · 셸 밖 · 세션 셋 대기/실패/취소와 탭) |
| 3 | `ask` 한 판: running → waiting-approval(카드·인박스·머리 칩·잠김) → 승인 → 접수 → idle | ⛔ WP-5 | 카드가 있어야 한다. 인박스·머리 칩·입력 잠김은 WP-4 에 있고 아래 #21 이 본다 |
| 4 | 실제 더블클릭에도 승인은 한 번 | ⛔ WP-5 | `control.requests('?op=io.terra.agent.approvals.post')` 길이 1, `inject {delay_ms:300}` 로 창을 넓힌다 |
| 5 | 거부: `TERRA_APPROVAL_DENIED` 줄·재시작 없음·idle | ⛔ WP-5 | 호출이 안 갔음은 `control.calls()` 에 `reached:true` 가 없는 것 |
| 6 | 시간 초과: 카드 "시간 초과"·idle·`TIME_LIMIT` 한 줄·denied 줄 없음·입력 복귀 | ◐ | `tests/session.e2e.mjs` "시간 초과(카드 밖의 몫)" — idle·`TIME_LIMIT`·denied 없음·입력 복귀. **카드 "시간 초과" 표시는 WP-5 대기** |
| 7 | 실행 중 취소: 확인창·cancelled·취소 뒤 줄 증가 없음 | ✅ | `session.e2e.mjs` 취소 2건(그대로 두기·Esc·Tab 가둠·`advance(20)` 뒤 서버/화면 줄 불변) |
| 8 | 승인 대기 중 취소: 카드가 "취소됨" | ⛔ WP-5 | 대기 승인은 `approval-flow` + `ask`. 확인창·취소 호출은 #7 이 본다 |
| 9 | 무인 + 외부 MCP: 충돌 배너·"세션 열기" 꺼짐·서버를 빼면 켜짐 | ⛔ 화면 없음 | 새 세션 화면에 MCP 선택·충돌 배너가 없다(`unattended` 라디오는 "G4에서 열립니다"로 꺼져 있다). 서버 쪽은 `sessions.post {mcp_servers}` → `409 MCP_UNATTENDED_CONFLICT` 로 준비돼 있다 |
| 10 | DC-25: 무인 자격이 아니면 `unattended` 선택이 꺼짐 | ⛔ 화면 없음 | 지금은 자격과 무관하게 항상 꺼져 있다 — 구분할 수 없다. 프리셋 `ready` vs `unattended-credential` 로 준비돼 있다 |
| 11 | 새 `plan` 세션: 제안만("실행 안 됨") | ✅ | `session.e2e.mjs` 자율성(plan): 화면에서 열기·ask/auto/unattended 라디오가 꺼져 있음·`refused` 줄·Gateway 에 닿지 않음 |
| 12 | 새 `ask` 세션: 위험한 restart 를 묻는다 | ⛔ WP-5 | 새 세션 화면이 `ask` 를 아직 열지 못한다(G2) · 카드 필요 |
| 13 | 새 `auto` 세션: 위험한 restart 도 묻는다 | ⛔ WP-5 | 카드 필요. 같은 자율성의 "쓰기는 묻지 않음"은 별도 점검으로 이식(`session.e2e.mjs` 자율성(auto), 시연에 없던 몫) |
| 14 | 새 `unattended` 세션: 묻지 않고 `TERRA_APPROVAL_REQUIRED` 로 거절 | ◐ | 새 세션 화면이 아니라 **서버에서 심은** unattended 세션을 앱에서 본다(`session.e2e.mjs` 자율성(unattended)). 화면에서 여는 몫은 화면 없음(#9) |
| 15 | 한글 조합 중 Enter 는 보내지 않음 | ✅ | `input.e2e.mjs`. `isComposing`/`keyCode 229` 를 흉내 낸다 — 실제 IME 조합은 아니다 |
| 16 | 공백만은 못 보냄 | ✅ | `input.e2e.mjs` |
| 17 | 20000자 넘으면 차단 | ✅ | `input.e2e.mjs` (#31 과 한 점검) |
| 18 | 입력은 한 줄 `<input>` | — | 앱은 `<textarea>`(Shift+Enter 줄바꿈)로 바뀌었다. 같은 약속의 새 모양이 #30 이다 |
| 19 | HTML 이 글자로 나옴 | ✅ | `input.e2e.mjs` — 내가 쓴 글과 `html-in-text` 모델 글 모두. 말풍선에 요소 0개·`window.__xss` 없음 |
| 20 | 연타해도 한 번 | ✅ | `input.e2e.mjs` — `messages.post` 지연 주입, 더블클릭+Enter 연타, 서버가 받은 `messages.post` 정확히 1 |
| 21 | 다른 세션의 대기 승인이 인박스에 뜨고 열린다 | ✅ | `session.e2e.mjs` 인박스 — 남의 세션(bob)이 섞이지 않음·머리 칩·열면 인박스에서 빠짐. 카드 없이 상태만 본다 |
| 22 | 세 차례 뒤에도 최신 줄이 보이고 오래된 줄에 닿는다 | ✅ | `scroll.e2e.mjs` 따라가기 |
| 23 | 탭 "종료됨"·설정 푸터가 무엇인가에 이어진다 | ✅ | `a11y.e2e.mjs` 탭 + 설정 자리가 `aria-disabled`·"아직 없음" |
| 24 | 실시간(가짜 시계 없이) 5초쯤 뒤 승인 카드가 선다 | ⛔ WP-5 | 카드 필요. (앱 e2e 는 처음부터 실시간 폴링이라 이 점검의 "시계 없이" 성격은 모든 점검이 갖는다) |
| 25 | a11y 한눈: 이름 없는 입력·단추, 새 줄의 live region | ✅ | `a11y.e2e.mjs` 접근성 |
| 26 | I18: 거부한 같은 호출에 "이전에 거부함" 표식 | ⛔ WP-5 | `approval-deny-repropose`. 표식은 카드의 몫 |
| 27 | I20: 한도 멈춤 옆 마지막 오류 코드 | ✅ | `session.e2e.mjs` — `STEP_LIMIT`·`TOKEN_BUDGET`·`MODEL_REFUSED`·`MODEL_TRUNCATED` + `last_error_code` 가 없는 이전 모듈 모양 |
| 28 | `failed` 세션은 읽기 전용 | ✅ | `session.e2e.mjs` — 입력 잠김·취소 숨김·"새 세션" 안내·종료됨 탭. `archived`·`done` 도 종료됨 |
| 29 | 차례 줄: 호출은 차례 몫, 토큰은 세션 누적 | ✅ | `session.e2e.mjs` 차례 줄 |
| 30 | DC-22: Enter 는 보내고 Shift+Enter 는 줄바꿈, 조합 중 Enter 는 아무것도 안 함 | ✅ | `input.e2e.mjs` Shift+Enter(+ 입력칸 자동 높이 120px 상한, `textarea-grow`) · #15 |
| 31 | DC-22: 20001자 — 숫자가 오류 색·보내기 꺼짐·Enter 무시 | ✅ | `input.e2e.mjs` — `messages.post` 가 가지 않았음으로 본다(서버는 막지 않는다) · 이모지는 코드 포인트로 센다 |
| 32 | DC-23: 긴 기록이 스크롤되고 새 줄이 맨 아래에서 따라간다 | ✅ | `scroll.e2e.mjs` 2건(1200줄 쪽 넘김·읽던 자리 유지·`scroll-follow`) |
| 33 | DC-27: 탭·`role=log`·`role=dialog`·`aria-label`·아직 없는 조작은 없다고 말함 | ✅ | `a11y.e2e.mjs` + `session.e2e.mjs` 취소(확인창 modal·Tab 가둠·초점 복귀) |
| 34 | AgentGUI: 보드 8장이 오류 없이 그려짐 | — | 디자인 보드 전용(`dc.js`). 앱에 해당 없음 |
| 35 | AgentGUI: 글자가 창 밖으로 잘리지 않음 | — | 디자인 보드 전용 |

**접근성·초점·대비·폴백 묶음**(`contrast-fallback`·`focus-stops`)도 이식했다: `a11y.e2e.mjs` 초점 1건(모든 Tab 정지점이 `:focus-visible`·안쪽 2px 고리·입력칸은 상자 고리)과 대비·폴백 4건(기본 · `prefers-reduced-transparency`(CDP) · `prefers-contrast:more` · `forced-colors`; 홈·쌓인 대화·확인창에서 모든 글자 4.5:1 / 큰 글자 3:1, 폴백 3종은 창이 불투명 단색·흐림 없음·배경 그림 없음). `iframe-backdrop` 은 시연 캔버스의 환경 기록이라 옮기지 않았다.

## WP-5 대기 — 구현하지 않은 점검 (승인 카드 · 화면 4·5)

아래는 카드(`ApprovalCard` 렌더, 계약 사실·카운트다운·승인/거부)가 앱에 서야 의미가 있다. 지금 앱은 `approval` 줄을 자리표시("이 화면은 아직 승인에 답하지 못합니다")로만 그리므로 **없는 화면에 맞춰 쓰지 않았다**. 카드가 병합되면 `tests/approvals.e2e.mjs` 로 아래 표대로 옮긴다.

| 묶음(§5.3) | 본 것 | 시나리오 / 제어 | 사전 상태 |
| --- | --- | --- | --- |
| **승인 한 판** (#3) | `ask` 글 → `running`(입력 잠김) → `waiting-approval`(카드·인박스·머리 칩·입력 잠김) → 카운트다운 → 승인 → `accepted-job` "접수 ≠ 완료" → `idle` | `approval-flow` (`ask`). 카운트다운은 카드의 `expires_ms` 와 `control.advance`. "접수 ≠ 완료"는 카드의 `contract.output_mode` 와 `accepted-job` | `ask` 세션은 `agentApi(t).open({autonomy:'ask', scenario:'approval-flow'})` 로 심는다. `model_delay_ms` 300 이상이면 `running` 이 보인다 |
| 〃 두 번 불러도 한 번, 실제 더블클릭도 한 번 (#4) | `approvals.post` 가 서버에 정확히 한 번 | `requestsOf(t, OP.approvalsPost)` 길이 1. `control.inject({op:OP.approvalsPost},{delay_ms:300})` 로 창을 넓힌다. 두 번째가 오면 서버는 `404 APPROVAL_NOT_FOUND`(정상) | |
| **거부** (#5) | `TERRA_APPROVAL_DENIED` 줄, 재시작 없음, 안내 글, `idle` | `approval-flow` + 거부. 호출이 안 갔음은 `control.calls()` 에 `reached:true` 가 없는 것으로 | |
| **시간 초과**의 카드 몫 (#6) | 카드 "시간 초과". (idle·`TIME_LIMIT`·denied 없음·입력 복귀는 이미 이식) | `approval-timeout`, `max_seconds: 300` + `advance(301)`. 30분 무응답 변형: `max_seconds: 7200` + `advance(1801)` → `denied`(`no answer within 30m0s`) | |
| **취소**의 카드 몫 (#8) | 대기 카드가 "취소됨" | `approval-flow` 대기 중 취소 | |
| **자율성**의 카드 몫 (#12·#13) | `ask`·`auto` 는 위험한 restart 를 묻는다 | `approval-flow` (ask, auto). 새 세션 화면이 `ask` 를 열 수 있게 되면(G2) 화면에서 연다 | |
| **실시간 스모크** (#24) | 가짜 시계 없이 카드가 선다 | `approval-flow` | |
| **규칙 I18** (#26) | 거부한 같은 호출에 "이전에 거부함" 표식 | `approval-deny-repropose` | `features({reasonJudgement:false})` 이전 모듈 모양도 |
| 외부 도구·카드 (시연에 없던 몫) | 외부 카드(계약 사실 없음) · "감사에 없다" 줄 · `legacy-contract` "적지 않음" · `gateway-403-after-approve` | `external-write-ask` · `external-call` · `legacy-contract` · `gateway-403-after-approve` | |
| 함정 6 | 폴링 지연 사이에 "y" 를 보내면 승인이 된다 — 앱은 보내기 직전 `sessions.get` 으로 `pending_approvals` 를 본다 | `two-approvals` + 대기 중 글 "y" | 입력이 잠기므로 보내기 가드(`send-guard`)의 e2e 는 카드와 함께 |

## 화면 없음 — 구현하지 않은 점검 (WP-5 가 아니다)

| 점검 | 막힌 이유 | 준비된 것 |
| --- | --- | --- |
| #9 무인 + 외부 MCP 충돌 배너·"세션 열기" 꺼짐 | 새 세션 화면에 MCP 서버 선택이 없다. `unattended` 라디오도 G4 까지 꺼져 있다 | 서버: `unattended-credential` 프리셋 + `ext` 로 MCP 등록(`PUT /mcp/servers/fake-mcp`), `sessions.post {autonomy:'unattended', mcp_servers:[…]}` → `409 MCP_UNATTENDED_CONFLICT`. 앱은 호출 전에 막아야 하니 `control.requests` 로 호출이 가지 않았음을 본다 |
| #10 DC-25 무인 자격이 아니면 `unattended` 선택이 꺼짐 | 라디오가 자격과 무관하게 항상 꺼져 있어 "자격이 있으면 켜진다"를 시험할 수 없다 | 프리셋 `ready`(alice 는 무인 자격 아님) vs `unattended-credential`. `control.credential('alice', {unattended:true, pre_approved:[]})` 는 "사전 승인 없음"으로 서버가 `403 CREDENTIAL_NOT_UNATTENDED` |

## 시연에 없던 점검 (가짜 환경이 이미 받쳐 준다)

시연에 없었지만 요구 문서·계획서가 요구하는 것들. `✅` 는 이식했다(`tests/readiness.e2e.mjs`·`session.e2e.mjs`), 나머지는 아직이다.

| 점검 | 시나리오 / 제어 | 근거 | 상태 |
| --- | --- | --- | :-: |
| 권한 없음: `agent.use` 가 없는 계정은 준비 상태가 "권한 없음"이고 `status.get` 만 된다 | `openShell(t, {principal:'noperm'})` | 함정 10, GAP-2 | ✅ 준비 상태(`noperm`) |
| 준비 상태 합성(자격·모델·관문) | 프리셋 `empty` · `no-model` · `no-credential` · `expired-credential` · `control.config({door:false})`(`delegate_door:false`) | 요구 §6.2 | ◐ 프리셋 4종만(`door:false` 는 아직) |
| 폴링에서 줄이 빠지거나 겹치지 않는다 | `slow-model` 중 폴링, `inject {delay_ms}`, `messages.list` 중간 실패 `inject {module_error}` | WP-4 완료 조건 | ◐ 1200줄 쪽 넘김만(중간 실패 주입은 아직) |
| 응답 유실(`outcomeUnknown`)이면 재전송하지 않고 `messages.list` 로 확인 | `control.inject({op:'io.terra.agent.messages.post'}, {drop:'after'})` — 서버에는 글이 쌓였고 앱은 502 를 받는다 | I17, 함정 12 | ✅ 응답 유실(I17) |
| 오류 코드 사전: 15개 + Gateway 7개 + 브리지가 앱에 어떻게 보이는가 | `inject` 의 `module_error`·`gateway_error`, 프리셋, `permissions=` 빈 선언(`BRIDGE_NO_PERMISSIONS`), `login=0`(`UNAUTHORIZED`) | WP-3 완료 조건 | ◻ |
| `last_error` 영어 문장 → 코드 사전 | `model-failure` · `step-limit` | 함정 5, GAP-7 | ◐ `lastErrorCode:false` 의 `STEP_LIMIT` 만 |
| 함정 6: 폴링 지연 사이에 "y" 를 보내면 승인이 된다 | `two-approvals` + 대기 중 글 "y" — 앱은 보내기 직전 `sessions.get` 으로 `pending_approvals` 를 본다 | 함정 6 | ◻ |
| 승인 뒤에도 Gateway 가 거절 | `gateway-403-after-approve` | I5 | ◻ |
| 외부 도구 줄("감사에 없다")·외부 카드(계약 사실 없음) | `external-call` · `external-write-ask` | I12 | ◻ |
| 시뮬레이션 `planned` 줄("실행되지 않았다") | `simulate-planned` | I13 | ◻ |
| 계약 사실 "적지 않음" 표현 | `legacy-contract` | DC-17 | ◻ |
| M-2~M-7 이전 모듈에 붙었을 때의 화면 | `features({contract:false, expires:false, reasonJudgement:false, lastErrorCode:false, modelFields:false})` | 계획서 §4 | ◻ |
| 비밀이 어디에도 다시 보이지 않는다(키·자격·env 값) | `models.put`/`credentials.put` 뒤 DOM·`localStorage`·URL 검색, 서버 기록은 `***` | I1, I19 | ◻ |
| 앱이 직접 `fetch` 하지 않고 브리지만 쓴다 | `control.requests()` 의 호출자가 모두 브리지(`Authorization` 있음) — 직접 호출은 엄격 Gateway 가 401 | §5.1 | ◻ |

## 이식할 때의 규칙

- 점검마다 `check()` 로 등록하고 시나리오를 못 박은 **세션 id 를 점검이 소유**한다(`agentApi(t).open({id, scenario})` 가 `pin` 까지 한다). 전역 기본 시나리오에 기대지 않는다.
- 시계 대기 대신 `control.advance`, 기다림 대신 `until()`(`lib/harness.mjs`)로 상태를 기다린다. `waitForTimeout` 은 쓰지 않는다.
- 문구가 아니라 **상태·역할·데이터 속성**으로 단언한다(영어 서버 문구는 앱이 사전으로 바꾼다).
- 각 점검이 끝나면 `openShell(...).problems.all()` 이 비어 있어야 한다(콘솔 오류·페이지 오류·실패한 요청·4xx·CSP 위반). 일부러 4xx 를 만든 점검은 `problems.clear()` 후 그 뒤만 본다.
- 가짜 서버가 모자라면 앱 시험을 고치지 말고 **서버 쪽에** 더하고, `server/*.test.mjs` 에 그것을 지키는 시험을 같이 넣는다.
