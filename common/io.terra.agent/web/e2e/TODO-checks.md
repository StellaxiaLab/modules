# 앱 점검 이식 목록 (골격)

계획서 §5.3 "이식할 점검"(시연에서 35개를 돌려 모두 통과)을 **실제 앱**의 e2e 로 옮길 때, 어느 점검을 어느 시나리오·제어로 돌릴지의 매핑이다. 이 PR 은 가짜 서버·셸 호스트·러너와 스모크까지다. 아래는 **WP-4(앱 화면)가 병합된 뒤의 별도 작업**이고, 지금 `tests/` 에 있는 것은 점검용 앱(probe)·불러오기 점검뿐이다.

원본 점검 코드는 `web/design/checks/demo-checks.mjs`(시연 `.dc.html` 대상, 가짜 시계로 감는다). 같은 점검을 앱에서 돌리되 **시계는 `control.advance(초)`** 로 감는다(브라우저의 `setTimeout` 이 아니라 서버가 안다). 앱을 여는 법은 `openShell(t, {principal, permissions})`(`lib/harness.mjs`)이고, 점검 파일은 `tests/<묶음>.e2e.mjs` 에 `check(이름, fn, {apps:['ui']})` 로 등록한다 — `apps:['ui']` 는 `--app ui` 에서만 돈다.

`상태` 열: ✅ 이미 서 있다 · ◻ 앱 화면이 필요하다(WP-4 이후) · ◻* 앱 화면 + 요구 변경(G2 이후).

## 묶음별 매핑

| 묶음(§5.3) | 본 것 | 시나리오 / 제어 | 사전 상태 | 상태 |
| --- | --- | --- | --- | :---: |
| **불러오기** | 콘솔 오류·페이지 오류·실패한 요청·4xx 가 없다. 세션 셋 | 세션을 셋 심는다: `read-only-answer`(idle) · `model-failure`(failed) · `cancel-mid-turn` 후 취소(cancelled) | `ready`, 세션 id 를 정해 `pin` | ✅ `tests/load.e2e.mjs`(빈 화면). 세션 셋은 ◻ |
| **승인 한 판** | `ask` 글 → `running`(입력 잠김) → `waiting-approval`(카드·인박스·머리 칩·입력 잠김) → 카운트다운 → 승인 → `accepted-job` "접수 ≠ 완료" → `idle` | `approval-flow` (`ask`). 카운트다운은 카드의 `expires_ms` 와 `control.advance`. "접수 ≠ 완료"는 카드의 `contract.output_mode` 와 `accepted-job` | `model_delay_ms` 를 300 이상으로 두어 `running` 을 본다 | ◻* (카드 G2) |
| 〃 두 번 불러도 한 번, 실제 더블클릭도 한 번 | `approvals.post` 가 서버에 정확히 한 번 | `control.requests('?op=io.terra.agent.approvals.post')` 길이 1. 응답 지연 `control.inject({op:'io.terra.agent.approvals.post'}, {delay_ms:300})` 로 더블클릭 창을 넓힌다. 두 번째가 오면 서버는 `404 APPROVAL_NOT_FOUND`(정상) | | ◻* |
| **거부** | `TERRA_APPROVAL_DENIED` 줄, 재시작 없음, 안내 글, `idle` | `approval-flow` + 거부. 호출이 안 갔음은 `control.calls()` 에 `reached:true` 가 없는 것으로 | | ◻* |
| **시간 초과** | 무응답 → 카드 "시간 초과", `idle`, `TIME_LIMIT` 한 줄, `denied` 줄 없음, 입력 복귀 | `approval-timeout`, `max_seconds: 300` 으로 열고 `control.advance(301)`. 30분 무응답 변형: `max_seconds: 7200` + `advance(1801)` → `denied`(`no answer within 30m0s`) | | ◻* |
| **취소** | 실행 중·승인 대기 중 취소, 확인창, "그대로 두기", 취소 뒤 20초 동안 줄이 늘지 않음, 대기 카드가 "취소됨" | 실행 중: `cancel-mid-turn`. 대기 중: `approval-flow`. 20초는 `control.advance(20)` + `messages.list` 줄 수 비교(서버는 취소 뒤 줄을 더하지 않는다) | | ◻ |
| **자율성** | `plan` 은 제안만("실행 안 됨"), `ask`·`auto` 는 위험한 restart 를 묻고, `unattended` 는 묻지 않고 `TERRA_APPROVAL_REQUIRED` 로 거절 | `propose-call`(plan) · `approval-flow`(ask, auto) · `unattended-refuse`(unattended). `accepted-job`(auto 의 쓰기는 묻지 않음) | `unattended` 는 프리셋 `unattended-credential` | ◻* |
| **무인 + MCP** | 충돌 배너 `MCP_UNATTENDED_CONFLICT`, "세션 열기" 꺼짐(눌러도 세션이 늘지 않음), 서버를 빼면 켜짐 | 서버에서 자연 발생: `sessions.post {autonomy:'unattended', mcp_servers:[…]}` → `409 MCP_UNATTENDED_CONFLICT`. 앱은 호출 전에 막아야 하니 `control.requests` 로 **호출이 가지 않았음**을 본다 | `unattended-credential` 프리셋 + `ext` 로 MCP 서버 등록(`PUT /mcp/servers/fake-mcp`) | ◻* |
| **무인 게이트 (DC-25)** | 무인 자격이 아니면 `unattended` 선택이 꺼진다 | 프리셋 `ready`(alice 는 무인 자격 아님) vs `unattended-credential`. `control.credential('alice', {unattended:true, pre_approved:[]})` 는 "사전 승인 없음"으로 서버가 `403 CREDENTIAL_NOT_UNATTENDED` | | ◻* |
| **입력** | 공백만은 못 보냄 · HTML 과 `{{…}}` 가 글자로 나옴 · 연타해도 한 번 · 조합 중 Enter 무시 · Shift+Enter 줄바꿈 · 20001자 차단 | 글자 출력은 `html-in-text`(assistant 쪽) + 사용자 입력 에코. 연타는 `control.requests('?op=io.terra.agent.messages.post')` 길이 1. **20001자는 서버가 막지 않는다**(소스 그대로) — 앱이 막았음을 `messages.post` 가 가지 않은 것으로 본다 | `model_delay_ms` 300 이상(첫 글의 `running` 동안 연타) | ◻ |
| **인박스** | 다른 세션의 대기 승인이 인박스에 뜨고 열린다 | 세션 둘을 `pin('approval-flow', id)` 로 대기시킨다. 남의 것이 섞이는 R-2 전 모양은 `features({sessionsListUnfiltered:true})` — 앱이 `owner` 로 거르는지 | 세션 둘 + `bob` 의 세션 | ◻* |
| **종료 세션** | `failed` 세션은 읽기 전용(입력 잠김·취소 숨김·"새 세션" 안내). `archived`·`done` 도 종료 | `model-failure`(failed) · `module-restart` + `control.restartModule()`(archived, idle 이던 것도) · `POST /runs`(done) | | ◻ |
| **규칙 I18·I20** | 거부한 같은 호출에 "이전에 거부함" 표식(I18), 한도 멈춤 옆 마지막 오류 코드(I20) | I18: `approval-deny-repropose`. I20: `step-limit`(`max_steps:3`) · `token-budget`(`token_budget:10000`) · `approval-timeout` · `model-refusal` · `model-truncated` — 상태는 모두 `idle`(failed 아님). 코드는 **기록의 `error` 줄**에서 읽는다(`last_error` 는 영어 문장) | `features({lastErrorCode:false})` 로 이전 모듈 모양도 | ◻* |
| **차례 줄** | 호출은 차례 몫, 토큰은 세션 누적 | `read-only-answer` 를 두 번 보낸다. `model` 줄의 `sent_bytes` 가 는다. `usage` 는 누적 | | ◻ |
| **스크롤** | 긴 기록이 스크롤되고 새 줄이 맨 아래에서 따라간다(GAP-4까지) | `long-history`(1200줄) + `messages.list` 500줄 쪽 넘김 · 새 줄은 `slow-model` | `control.seed({scenario:'long-history', session_id:'long', owner:'alice'})` | ◻ |
| **접근성** | 이름 있는 입력 · `role=log` · `role=dialog` · 탭 | 서버 의존 없음. 카드가 있는 화면은 `approval-flow` | | ◻ |
| **초점·대비·폴백** | 정지점이 모두 `:focus-visible` · 글자 대비 4.5:1 · `prefers-reduced-transparency`·`prefers-contrast:more`·`forced-colors` 폴백 | 서버 의존 없음. CDP `Emulation.setEmulatedMedia`(`prefers-reduced-transparency` 는 CDP 로만). 뒤 배경 검정·회색·흰색은 페이지에서 바꾼다 | | ◻ |

## 시연에 없던 점검 (가짜 환경이 이미 받쳐 준다)

시연에 없었지만 요구 문서·계획서가 요구하는 것들 — 앱 화면이 서면 같은 방식으로 더한다.

| 점검 | 시나리오 / 제어 | 근거 |
| --- | --- | --- |
| 권한 없음: `agent.use` 가 없는 계정은 준비 상태가 "권한 없음"이고 `status.get` 만 된다 | `openShell(t, {principal:'noperm'})` | 함정 10, GAP-2 |
| 준비 상태 합성(자격·모델·관문) | 프리셋 `empty` · `no-model` · `no-credential` · `expired-credential` · `control.config({door:false})`(`delegate_door:false`) | 요구 §6.2 |
| 폴링에서 줄이 빠지거나 겹치지 않는다 | `slow-model` 중 폴링, `inject {delay_ms}`, `messages.list` 중간 실패 `inject {module_error}` | WP-4 완료 조건 |
| 응답 유실(`outcomeUnknown`)이면 재전송하지 않고 `messages.list` 로 확인 | `control.inject({op:'io.terra.agent.messages.post'}, {drop:'after'})` — 서버에는 글이 쌓였고 앱은 502 를 받는다 | I17, 함정 12 |
| 오류 코드 사전: 15개 + Gateway 7개 + 브리지가 앱에 어떻게 보이는가 | `inject` 의 `module_error`·`gateway_error`, 프리셋, `permissions=` 빈 선언(`BRIDGE_NO_PERMISSIONS`), `login=0`(`UNAUTHORIZED`) | WP-3 완료 조건 |
| `last_error` 영어 문장 → 코드 사전 | `model-failure` · `step-limit` | 함정 5, GAP-7 |
| 함정 6: 폴링 지연 사이에 "y" 를 보내면 승인이 된다 | `two-approvals` + 대기 중 글 "y" — 앱은 보내기 직전 `sessions.get` 으로 `pending_approvals` 를 본다 | 함정 6 |
| 승인 뒤에도 Gateway 가 거절 | `gateway-403-after-approve` | I5 |
| 외부 도구 줄("감사에 없다")·외부 카드(계약 사실 없음) | `external-call` · `external-write-ask` | I12 |
| 시뮬레이션 `planned` 줄("실행되지 않았다") | `simulate-planned` | I13 |
| 계약 사실 "적지 않음" 표현 | `legacy-contract` | DC-17 |
| M-2~M-7 이전 모듈에 붙었을 때의 화면 | `features({contract:false, expires:false, reasonJudgement:false, lastErrorCode:false, modelFields:false})` | 계획서 §4 |
| 비밀이 어디에도 다시 보이지 않는다(키·자격·env 값) | `models.put`/`credentials.put` 뒤 DOM·`localStorage`·URL 검색, 서버 기록은 `***` | I1, I19 |
| 앱이 직접 `fetch` 하지 않고 브리지만 쓴다 | `control.requests()` 의 호출자가 모두 브리지(`Authorization` 있음) — 직접 호출은 엄격 Gateway 가 401 | §5.1 |

## 이식할 때의 규칙

- 점검마다 `check()` 로 등록하고 시나리오를 못 박은 **세션 id 를 점검이 소유**한다(`pin(시나리오, id)`). 전역 기본 시나리오에 기대지 않는다.
- 시계 대기 대신 `control.advance`, 기다림 대신 `until()`(`lib/harness.mjs`)로 상태를 기다린다. `waitForTimeout` 은 쓰지 않는다.
- 문구가 아니라 **상태·역할·데이터 속성**으로 단언한다(영어 서버 문구는 앱이 사전으로 바꾼다).
- 각 점검이 끝나면 `openShell(...).problems.all()` 이 비어 있어야 한다(콘솔 오류·페이지 오류·실패한 요청·4xx·CSP 위반). 일부러 4xx 를 만든 점검은 `problems.clear()` 후 그 뒤만 본다.
- 가짜 서버가 모자라면 앱 시험을 고치지 말고 **서버 쪽에** 더하고, `server/*.test.mjs` 에 그것을 지키는 시험을 같이 넣는다.
