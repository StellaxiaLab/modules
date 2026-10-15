# 앱 점검 이식 현황 (§5.3 의 35개)

계획서 §5.3 "이식할 점검"(시연에서 35개를 돌려 모두 통과)을 **실제 앱**(`npm run build` → `../ui`)의 e2e 로 옮긴 현황이다. 원본은 `web/design/checks/demo-checks.mjs` 의 `t()` 32건(반복 4건을 펼치면 35)이고, 같은 폴더의 `contrast-fallback`·`focus-stops`·`scroll-follow`·`textarea-grow` 가 접근성·측정 몫이다.

앱 점검은 `tests/*.e2e.mjs` 에 `check(이름, fn, {apps:['ui']})` 로 등록한다 — `npm run build && npm run e2e -- --app ui`. 시계는 `control.advance(초)`, 기다림은 `until()`, 문구가 아니라 `data-role`·`data-kind`·`data-status`·`role` 로 단언한다. 공용 도구는 `lib/app.mjs`(`agentApi`: 세션을 서버 쪽에서 심기, `openApp`: 앱을 셸 안에서 열고 화면을 읽기).

## 집계

| 구분 | 개수 | 
| --- | :---: |
| 이식함 (앱 e2e 통과) | 28 |
| 일부만 이식함 (화면에서 여는 몫이 없다) | 1 |
| 앱에 해당 화면이 없어 막힘 (무인 + 외부 MCP, G4) | 2 |
| 바뀐 앱에 맞지 않아 대체됨 | 1 |
| 디자인 시연 전용이라 앱에 해당 없음 | 3 |
| 합계 | 35 |
| 실패 | 0 |

`npm run e2e -- --app ui` 는 85개를 돈다(이 작업 이전 2개 + 앱 점검 37개 + 승인 카드 12개 + 시연 밖 점검 34개). 앱 점검 37개에는 35개 목록 몫 외에 "시연에 없던 점검" 7개(`readiness.e2e.mjs` 6개, `auto` 의 쓰기를 묻지 않는 점검 1개)가 들어 있고, 시연 밖 점검 34개는 `tools` 5 · `guard` 3 · `errors` 13 · `compat` 8 · `polling` 2 · `boundary` 2 · `readiness` 1(관문 없음)이다 — 아래 "시연에 없던 점검" 표. probe 앱은 14개.

## 35개 대응표

`✅` 이식함 · `◐` 일부만 · `⛔ 화면 없음` 앱에 그 화면이 없다 · `—` 해당 없음.

| # | 원본 점검(demo-checks) | 상태 | 앱 e2e 점검 / 비고 |
| :-: | --- | :-: | --- |
| 1 | env: `corner-shape: squircle`·실제 글꼴 | — | 시연 환경 기록이다. 앱에 해당 없음 |
| 2 | 마운트 시 콘솔 오류·페이지 오류·실패한 요청·4xx 없음 | ✅ | `tests/load.e2e.mjs` 3건(셸 안 · 셸 밖 · 세션 셋 대기/실패/취소와 탭) |
| 3 | `ask` 한 판: running → waiting-approval(카드·인박스·머리 칩·잠김) → 승인 → 접수 → idle | ✅ | `approvals.e2e.mjs` 승인 한 판 — 진행 중(잠김)·승인 대기(카드·머리 칩·잠김)·승인·접수·대기. `approvals.post` 정확히 1, Gateway 도달 1 |
| 4 | 실제 더블클릭에도 승인은 한 번 | ✅ | `approvals.e2e.mjs` 더블클릭 — `approvals.post` 지연 주입(300ms) + 실제 `dblclick`, 서버가 받은 `approvals.post` 정확히 1 |
| 5 | 거부: `TERRA_APPROVAL_DENIED` 줄·재시작 없음·idle | ✅ | `approvals.e2e.mjs` 거부 — `TERRA_APPROVAL_DENIED` refused 줄·카드 "거부함"·`control.calls()` 에 `reached` 없음·새 질문 없음·안내 글·idle |
| 6 | 시간 초과: 카드 "시간 초과"·idle·`TIME_LIMIT` 한 줄·denied 줄 없음·입력 복귀 | ✅ | `session.e2e.mjs`(카드 밖의 몫) + `approvals.e2e.mjs` 2건 — 카드가 "시간 초과"(`data-card-state="timed-out"`)·컨트롤 사라짐. 30분 무응답은 "무응답 거부" |
| 7 | 실행 중 취소: 확인창·cancelled·취소 뒤 줄 증가 없음 | ✅ | `session.e2e.mjs` 취소 2건(그대로 두기·Esc·Tab 가둠·`advance(20)` 뒤 서버/화면 줄 불변) |
| 8 | 승인 대기 중 취소: 카드가 "취소됨" | ✅ | `approvals.e2e.mjs` 승인 대기 중 취소 — 확인창을 거쳐 카드가 "취소됨"·컨트롤 사라짐·`approvals.post`/Gateway 호출 없음·머리 칩 정리 |
| 9 | 무인 + 외부 MCP: 충돌 배너·"세션 열기" 꺼짐·서버를 빼면 켜짐 | ⛔ 화면 없음 | 새 세션 화면에 MCP 선택·충돌 배너가 없다(`unattended` 라디오는 "G4에서 열립니다"로 꺼져 있다). 서버 쪽은 `sessions.post {mcp_servers}` → `409 MCP_UNATTENDED_CONFLICT` 로 준비돼 있다 |
| 10 | DC-25: 무인 자격이 아니면 `unattended` 선택이 꺼짐 | ⛔ 화면 없음 | 지금은 자격과 무관하게 항상 꺼져 있다 — 구분할 수 없다. 프리셋 `ready` vs `unattended-credential` 로 준비돼 있다 |
| 11 | 새 `plan` 세션: 제안만("실행 안 됨") | ✅ | `session.e2e.mjs` 자율성(plan): 화면에서 열기·ask/auto/unattended 라디오가 꺼져 있음·`refused` 줄·Gateway 에 닿지 않음 |
| 12 | 새 `ask` 세션: 위험한 restart 를 묻는다 | ✅ | `approvals.e2e.mjs` ask — 서버에서 심은 `ask` 세션(새 세션 화면은 아직 못 연다, G2). restart 와 쓰기(files.write) 모두 하나씩 묻는다 |
| 13 | 새 `auto` 세션: 위험한 restart 도 묻는다 | ✅ | `approvals.e2e.mjs` auto — 위험한 restart 는 카드가 서고, 판정 근거를 서버가 준 그대로 싣는다. 쓰기를 묻지 않음은 `session.e2e.mjs` 자율성(auto) |
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
| 24 | 실시간(가짜 시계 없이) 5초쯤 뒤 승인 카드가 선다 | ✅ | `approvals.e2e.mjs` 실시간 카드 — 서버 시계를 감지 않고 카드가 서며, 마감 시계 글자가 같은 노드에서 흐른다(실제 시간을 조건으로 기다림) |
| 25 | a11y 한눈: 이름 없는 입력·단추, 새 줄의 live region | ✅ | `a11y.e2e.mjs` 접근성 |
| 26 | I18: 거부한 같은 호출에 "이전에 거부함" 표식 | ✅ | `approvals.e2e.mjs` I18 3건 — 같은 입력 재제안: "이전에 거부한 같은 호출 1회"(첫 카드엔 없음) · 이전 모듈 모양(`reasonJudgement:false`) · 앱을 거부 뒤에 열면 "비교하지 못했다" 표식 |
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

## 승인 카드(WP-5) 몫 — 이식함

`tests/approvals.e2e.mjs` 12건. 아래 묶음 가운데 앱에서 아직 못 본 것은 "남은 것" 이다.

| 묶음(§5.3) | 점검 |
| --- | --- |
| 승인 한 판 (#3) | 승인 한 판(ask) |
| 더블클릭 (#4) | 승인 더블클릭 |
| 거부 (#5) | 거부 |
| 시간 초과의 카드 몫 (#6) | 시간 초과(카드 몫) · 시간 초과(30분 무응답) |
| 취소의 카드 몫 (#8) | 승인 대기 중 취소 |
| 자율성의 카드 몫 (#12·#13) | 자율성(ask) · 자율성(auto) |
| 실시간 스모크 (#24) | 실시간 카드 |
| 규칙 I18 (#26) | 거부 기억 · 이전 모듈 모양 · 입력을 못 본 거부 |

시계는 둘이다. 서버(가짜 Gateway)는 `control.advance` 로 감고, 브라우저의 앱은 실제 시계를 쓴다(밖에서 주입할 수 없다). 그래서 "마감이 지났다"는 서버가 질문을 닫는 것으로 보고, 앱의 카운트다운은 실제로 흐르는 글자를 `until()` 로 기다려 본다. 머리 칩("승인 대기 N")은 세션 목록(5초 폴링)에서 세므로 카드보다 늦게 따라온다 — 조건으로 기다린다.

**승인 카드 몫에서 이식한 시연 밖 점검**은 아래 "시연에 없던 점검" 표에 있다(`tests/tools.e2e.mjs` · `tests/guard.e2e.mjs`).

**남은 것**(화면에서는 볼 수 없는 몫):

| 묶음 | 이유 |
| --- | --- |
| 앱 시계로 마감이 지남 | 앱의 `now` 를 밖에서 주입할 수 없어 "마감 칩·컨트롤 꺼짐·서버에 새로 묻기"는 단위 시험(`tests/app-approvals.test.ts`)이 본다 |

## 화면 없음 — 구현하지 않은 점검

| 점검 | 막힌 이유 | 준비된 것 |
| --- | --- | --- |
| #9 무인 + 외부 MCP 충돌 배너·"세션 열기" 꺼짐 | 새 세션 화면에 MCP 서버 선택이 없다. `unattended` 라디오도 G4 까지 꺼져 있다 | 서버: `unattended-credential` 프리셋 + `ext` 로 MCP 등록(`PUT /mcp/servers/fake-mcp`), `sessions.post {autonomy:'unattended', mcp_servers:[…]}` → `409 MCP_UNATTENDED_CONFLICT`. 앱은 호출 전에 막아야 하니 `control.requests` 로 호출이 가지 않았음을 본다 |
| #10 DC-25 무인 자격이 아니면 `unattended` 선택이 꺼짐 | 라디오가 자격과 무관하게 항상 꺼져 있어 "자격이 있으면 켜진다"를 시험할 수 없다 | 프리셋 `ready`(alice 는 무인 자격 아님) vs `unattended-credential`. `control.credential('alice', {unattended:true, pre_approved:[]})` 는 "사전 승인 없음"으로 서버가 `403 CREDENTIAL_NOT_UNATTENDED` |

## 시연에 없던 점검 (가짜 환경이 이미 받쳐 준다)

시연에 없었지만 요구 문서·계획서가 요구하는 것들. `✅` 는 이식했다. (`⛔ 앱 버그` 로 빼 둔 점검은 없다 — 아래 "앱 버그로 뺀 점검".)

| 점검 | 시나리오 / 제어 | 근거 | 상태 | 파일 |
| --- | --- | --- | :-: | --- |
| 권한 없음: `agent.use` 가 없는 계정은 준비 상태가 "권한 없음"이고 `status.get` 만 된다 | `openShell(t, {principal:'noperm'})` | 함정 10, GAP-2 | ✅ | `readiness` |
| 준비 상태 합성(자격·모델·관문) | 프리셋 `empty` · `no-model` · `no-credential` · `expired-credential` · `control.config({door:false})`(`delegate_door:false`) — 관문 단계만 막히고 나머지는 통과, 새 세션 꺼짐, 목록은 읽힘 | 요구 §6.2 | ✅ | `readiness` |
| 폴링에서 줄이 빠지거나 겹치지 않는다 | 1200줄 쪽 넘김(`scroll`) · `messages.list` 중간 실패 `inject {module_error}` ×3(백오프 2초·4초의 아래쪽 경계, 같은 `after_seq` 에서 재개, 마지막에 화면 = 서버 기록) · 느린 읽기 `inject {delay_ms}`(겹쳐 부르지 않음) | WP-4 완료 조건 | ✅ | `scroll` · `polling` |
| 응답 유실(`outcomeUnknown`)이면 재전송하지 않고 `messages.list` 로 확인 | `control.inject({op:'io.terra.agent.messages.post'}, {drop:'after'})` — 서버에는 글이 쌓였고 앱은 502 를 받는다 | I17, 함정 12 | ✅ | `readiness` |
| 오류 코드 사전: 15개 + Gateway 7개가 화면에 어떻게 보이는가 | 보내기 실패 주입 `module_error`·`gateway_error` 22개를 한 입력칸에서 돌린다(한국어 문구·입력 보존·재전송 없음, 표가 `lib/errors.mjs` 와 어긋나면 깨짐) · 모르는 코드·HTML 502 · 서는 자리: 세션 읽기(`SESSION_NOT_FOUND`·`SESSION_NOT_OWNED`) · 목록 읽기 · 승인 답(`APPROVAL_NOT_FOUND` 는 조용히, 그 밖은 카드 안 안내) · 준비 상태(`MODULE_UNAVAILABLE`·`UNAUTHORIZED`·`AGENT_UNAVAILABLE`·연결 끊김, 복구 뒤 "다시 확인") · `login=0`(`UNAUTHORIZED`) · 세션 도중 `UNAUTHORIZED` | WP-3 완료 조건 | ✅ | `errors` |
| 오류 코드 사전: `BRIDGE_NO_PERMISSIONS`(`permissions=` 빈 선언)가 화면에서 셸의 거절로 읽힌다 | `openApp(t, {permissions:''})` — 머리글·첫 단계가 "셸이 요청을 막았습니다", 요청은 Gateway 에 닿지 않음 | WP-3 완료 조건 | ✅ | `errors` |
| `last_error` 영어 문장 → 코드 사전 | `model-failure`(`lastErrorCode` 켬·끔: 상태 옆 코드, 영어 원문은 접힌 상세에만) · 이전 모듈의 목록 행은 기록을 읽기 전엔 코드를 모른다고 둠 · `step-limit`(`session`) | 함정 5, GAP-7 | ✅ | `compat` · `session` |
| 함정 6: 폴링 지연 사이에 "y" 를 보내면 승인이 된다 | `two-approvals` + 기록 읽기를 붙잡아 앱의 판독을 idle 로 굳힌 채 서버에 대기 승인을 세우고 "y"·"Deny please" 를 보냄 — 보내기 직전 `sessions.get` 이 막아 `messages.post` 가 가지 않고 승인도 안 됨. 대기 승인이 없으면 "y" 도 일반 글로 감 | 함정 6 | ✅ | `guard` |
| 승인 뒤에도 Gateway 가 거절 | `gateway-403-after-approve` — 카드가 미리 "물어봤다"고 말함, error 줄 + `MODULE_PERMISSION_DENIED` 코드, ok 로 칠하지 않음 | I5 | ✅ | `tools` |
| 외부 도구 줄("감사에 없다")·외부 카드(계약 사실 없음) | `external-call` · `external-write-ask` (`PUT /mcp/servers/fake-mcp` 를 `ext` 계정으로 먼저) | I12 | ✅ | `tools` |
| 시뮬레이션 `planned` 줄("실행되지 않았다") | `simulate-planned` | I13 | ✅ | `tools` |
| 계약 사실 "적지 않음" 표현 | `legacy-contract` — 한 카드에서 "적지 않음"(키 없음)과 "없음"(`[]`)이 갈림 | DC-17 | ✅ | `tools` |
| M-2~M-7 이전 모듈에 붙었을 때의 화면 | `features({...:false})` 전부 + 하나씩(`contract`·`expires`·`reasonJudgement`·`modelFields`; `lastErrorCode` 는 위 행). 판정 근거는 `pending_approvals` 에 없어도 기록의 `approval` 줄 `note` 에서 읽는다 | 계획서 §4 | ✅ | `compat` |
| 비밀이 어디에도 다시 보이지 않는다(키·자격·env 값) | 서버 쪽에서 `models.put`·`credentials.put`·`mcp.put` 뒤 앱을 한 바퀴 — 앱·셸의 DOM·속성·저장소·쿠키·주소·콘솔·브리지 기록·요청 주소에 없음, 응답에도 없고 서버 요청 기록은 `***` (앱에는 비밀을 맡기는 화면이 아직 없다) | I1, I19 | ✅ | `boundary` |
| 앱이 직접 `fetch` 하지 않고 브리지만 쓴다 | 엄격 Gateway 에서 보내기·승인까지 돌림 — 서버가 받은 앱 호출 모두에 `Authorization`·선언 권한 머리말, 앱 프레임은 자산 밖으로 요청을 낸 적 없음, 머리말 없는 직접 호출은 401(대조) | §5.1 | ✅ | `boundary` |

## 앱 버그로 뺀 점검

해소했다. 지금 빼 둔 점검은 없다.

### `BRIDGE_NO_PERMISSIONS` 가 준비 화면에서 "모듈이 처리할 수 없다"로 읽히던 것 — 해소

- **원인**: `src/data/readiness.ts` `moduleBlock` 이 `status.get` 의 `403` + 코드를 모두 `module-error` 로 묶었고, `src/app/readiness-model.ts` 가 그것을 `AGENT_UNAVAILABLE`("지금 처리할 수 없습니다") 문구로 옮겼다.
- **고침**: `moduleBlock` 이 `BRIDGE_NO_PERMISSIONS` → `bridge-no-permissions`, `MODULE_PERMISSION_DENIED` → `module-permission-denied` 로 가르고, 문구는 오류 사전에서 가져온다. 그 밖의 코드는 그대로 `module-error`.
- **점검**: `tests/errors.e2e.mjs` — `permissions=` 빈 선언(요청이 Gateway 에 닿지 않음) · `status.get` 이 `MODULE_PERMISSION_DENIED` 일 때(복구 뒤 "다시 확인"). 단위: `tests/readiness.test.ts` · `tests/readiness-view.test.ts`.
- 같은 일을 `smoke.e2e.mjs`(probe 앱)는 브리지 층에서 본다.

### 확인했지만 점검으로 묶지 않은 것

- `door:false` 에서 이미 있는 idle 세션의 입력칸이 열려 있다(준비 상태의 관문 단계는 "읽기만 할 수 있고 새 세션은 열 수 없습니다"라고 쓴다). `Readiness.readOnly` 는 계산되지만 화면 어디에서도 쓰이지 않는다(`grep readOnly src`). 관문이 없는 노드에 세션이 이미 있을 수 있는지(재시작하면 archived 가 된다)가 불분명해 요구 위반으로 단정하지 않는다 — 요구 쪽의 판단을 기다린다.

## 이식할 때의 규칙

- 점검마다 `check()` 로 등록하고 시나리오를 못 박은 **세션 id 를 점검이 소유**한다(`agentApi(t).open({id, scenario})` 가 `pin` 까지 한다). 전역 기본 시나리오에 기대지 않는다.
- 시계 대기 대신 `control.advance`, 기다림 대신 `until()`(`lib/harness.mjs`)로 상태를 기다린다. `waitForTimeout` 은 쓰지 않는다.
- 문구가 아니라 **상태·역할·데이터 속성**으로 단언한다(영어 서버 문구는 앱이 사전으로 바꾼다).
- 각 점검이 끝나면 `openShell(...).problems.all()` 이 비어 있어야 한다(콘솔 오류·페이지 오류·실패한 요청·4xx·CSP 위반). 일부러 4xx 를 만든 점검은 `problems.clear()` 후 그 뒤만 본다.
- 가짜 서버가 모자라면 앱 시험을 고치지 말고 **서버 쪽에** 더하고, `server/*.test.mjs` 에 그것을 지키는 시험을 같이 넣는다.
