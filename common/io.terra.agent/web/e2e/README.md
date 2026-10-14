# e2e — 가짜 Gateway·모듈 서버와 셸 호스트

Terra Agent 앱(`web/`)을 **실제 브라우저에서** 시험하려고 세운 가짜 환경이다. 계획서 §5.3 의 브라우저(e2e) 층이다.

- **가짜 모듈·Gateway 서버** — 계약(`contracts/api/terra-api.json`)의 operation 19개를 소스(`src/api.go`·`session.go`·`loop.go`) 그대로 흉내 낸다. 모델은 없다: **시나리오**가 "모델의 응답"을 대본으로 쓴다.
- **셸 호스트 페이지** — 실제 셸(`WebAppDock.tsx`)처럼 앱을 sandbox iframe 에 올리고 브리지(`hello` → `ready` → `request`/`response`)를 구현해 요청을 가짜 서버로 넘긴다.
- **앱 정적 서빙** — 앱 자산 CSP(`script-src 'self'` …)를 **같은 헤더**로 건다. 앱이 CSP 를 어기면 e2e 의 콘솔 오류로 드러난다.
- **서버 자체의 단위 시험** — 가짜 서버가 계약·소스와 갈라지지 않았는지 대조한다. 가짜가 거짓말하면 앱 시험이 거짓 초록이 되므로 이 시험이 먼저다.

앱 화면(WP-4)이 아직 없던 때 만들었다. 그래서 `fixtures/probe-app/`(브리지로 `status.get`·`sessions.list` 를 부르는 20줄 앱)으로 서버·브리지·CSP·시나리오가 실제로 맞물려 도는 것을 증명한다. 실제 앱(`--app ui`)의 점검 35개는 앱에 해당 화면이 있는 것을 모두 이식했다(승인 카드 몫은 `tests/approvals.e2e.mjs`) — 현황과 남은 것은 [TODO-checks.md](TODO-checks.md) 에 있다.

## 실행

```sh
cd common/io.terra.agent/web
npm ci

npm run e2e:server        # 서버 단위 시험 (node --test, 브라우저 불필요, 의존 없음) — CI 에서도 돌 수 있다
npm run e2e               # 브라우저 e2e: 점검용 앱(probe)으로 스모크
npm run build && npm run e2e -- --app ui      # 빌드한 실제 앱(../ui)으로 — 앱 점검 51개
npm run e2e -- --grep 승인                     # 이름에 '승인' 이 든 점검만
npm run e2e -- --list                          # 점검 목록
```

`e2e`·`e2e:server` 는 `npm test`(Vitest)와 따로다. Vitest 설정(`include: tests/**`)에 `e2e/` 가 들지 않고, CI `web` 잡은 `test` 만 돈다 — 브라우저가 필요한 시험은 `test` 에 넣지 않는다(§5.3).

### 준비물

| 필요 | 방법 |
| --- | --- |
| Node 22 | `node --test` 의 글롭·`fetch`·`AbortController` 를 쓴다 |
| `playwright` | **저장소 의존이 아니다**(`package-lock.json` 을 건드리지 않는다). 개발 환경의 전역·임시 설치를 쓴다. 이 환경에서는 `/opt/node22/lib/node_modules/playwright`(1.5x). 다른 곳이면 `NODE_PATH=$(npm root -g)` 또는 `PLAYWRIGHT_MODULE=/경로/node_modules/playwright` |
| Chromium | 미리 깔린 것을 쓴다. 기본 `/opt/pw-browsers/chromium`, 바꾸려면 `CHROMIUM_PATH`. **`playwright install` 은 쓰지 않는다** |

`e2e:server` 는 브라우저도 playwright 도 필요 없다.

### 눈으로 보기 · 손으로 찌르기

```sh
node e2e/stack.mjs --app probe       # 셸 호스트 + Gateway 를 세우고 주소를 찍는다 (--app ui 도 된다)
node e2e/fake-agent-server.mjs --port 4010                # 가짜 서버만
curl -H 'X-Terra-Principal: alice' localhost:4010/api/modules/io.terra.agent/v1/sessions
curl localhost:4010/__control/scenarios                    # 시나리오 목록
node e2e/serve.mjs --root ../ui --shell-origin http://127.0.0.1:4021   # 앱 정적 서빙(CSP)만
```

## 구성

| 파일 | 하는 일 |
| --- | --- |
| `fake-agent-server.mjs` | 가짜 Gateway + 모듈 서버(순수 `node:http`). 경로·권한·오류 봉투·오류 주입·제어(`/__control/…`) |
| `lib/routes.mjs` | 경로 표(`ROUTE_TABLE`)와 19개 핸들러 — `api.go` 의 옮김. 엄격한 본문 검증 |
| `lib/engine.mjs` | 세션 상태기계·승인·턴 — `session.go`·`loop.go` 의 옮김 |
| `lib/catalog.mjs` | 모델이 부르는 가짜 operation 과 게이트 판정(`decide`) |
| `lib/validate.mjs` · `errors.mjs` · `clock.mjs` · `schema.mjs` | 본문 검증 · 오류 코드 표 · 가짜 시계 · 계약 스키마 검증기(시험용) |
| `scenarios/*.mjs` | 시나리오 25개(턴 24 + 시드 1). 형식은 `scenarios/index.mjs` 머리말 |
| `serve.mjs` | 앱 정적 서빙 + 앱 CSP 헤더 |
| `shell-host.html` · `shell-host.mjs` · `shell-bridge.mjs` | 셸 호스트 페이지. 브리지 규칙 본체는 `shell-bridge.mjs`(웹앱 브리지 소스의 옮김) |
| `stack.mjs` | 셸 서버 + Gateway 서버(앱 서빙·가짜 모듈)를 **다른 origin** 으로 세운다 |
| `run.mjs` · `lib/harness.mjs` · `lib/browser.mjs` | 러너 · 하네스(`check`/`until`/`openShell`) · Chromium·페이지 감시 |
| `lib/app.mjs` | 실제 앱 점검의 공용 도구 — `agentApi`(세션을 서버 쪽에서 심고 읽기), `openApp`(앱을 셸 안에서 열고 화면 읽기), `requestsOf`·`mark`(서버가 받은 요청 세기) |
| `tests/*.e2e.mjs` | 브라우저 점검 — `smoke`(서버·브리지·CSP)·`scenarios`(시나리오 구동)는 probe 앱, 나머지는 실제 앱(`--app ui`): `load`(불러오기·세션 셋) · `input`(입력) · `session`(취소·자율성·시간 초과·인박스·종료 세션·I20·차례 줄) · `scroll` · `a11y`(접근성·초점·대비·폴백) · `readiness`(준비 상태·관문·응답 유실) · `tools`(외부 도구·계약 "적지 않음"·승인 뒤 Gateway 거절·시뮬레이션) · `guard`(보내기 직전 가드, 함정 6) · `errors`(오류 코드 사전이 화면의 어느 자리에 어떻게 서는가) · `compat`(이전 모듈 모양·`last_error` 문장→코드) · `polling`(기록 읽기 중간 실패·느림) · `boundary`(비밀이 다시 보이지 않음·브리지만 씀) |
| `server/*.test.mjs` | 서버 단위 시험 48개 — `contract`(계약 대조) · `strict`(본문·principal·소유자) · `state`(상태기계·시나리오) · `gateway`(권한·봉투·주입·CSP·브리지 규칙) |
| `fixtures/probe-app/` | 점검용 최소 앱(실제 앱이 아니다) |
| `TODO-checks.md` | §5.3 점검 묶음 → 시나리오 매핑 |

## 호스트와 서버가 흉내 내는 것

```
 셸 origin (shell-host.html)                    Gateway origin (= 앱 origin)
 ┌───────────────────────────┐   Authorization     ┌───────────────────────────────────────────┐
 │ iframe sandbox="allow-    │   Bearer fake.<이름>  │ /api/v1/gui/apps/io.terra.agent/files/ui/ │ ← 앱 자산 + CSP
 │ scripts allow-forms allow-│   X-Terra-Scope-     │ /api/modules/io.terra.agent/v1/…          │ ← 가짜 모듈
 │ same-origin"  ◀─postMessage─▶ 셸 ──fetch──────────▶ /__control/…                              │ ← 제어
 └───────────────────────────┘   Permissions        └───────────────────────────────────────────┘
```

- **브리지(셸 쪽)**: 메시지는 정확한 Gateway origin + 그 iframe 의 `contentWindow` 에서 온 것만 받는다. 경로는 `/api/modules/`·`/api/nodes/` 만, 메서드는 GET POST PUT PATCH DELETE, 선언 권한이 비면 `403 BRIDGE_NO_PERMISSIONS`, Gateway 에 못 닿으면 `502 BRIDGE_GATEWAY_UNREACHABLE`. 응답은 `{type:'terra.webapp.response', id, ok, status, data}` 한 번 — **스트림이 없다**. 앱에는 토큰이 없다.
- **Gateway 쪽**: 호출자는 `Authorization: Bearer fake.<이름>`(엄격 모드 — 토큰이 없으면 `401 UNAUTHORIZED`)이고 서버가 `X-Terra-Principal` 을 찍는다. 앱이 선언한 권한(`X-Terra-Scope-Permissions`) ∩ 계정 권한에 operation 의 권한이 없으면 `403 MODULE_PERMISSION_DENIED`(Gateway 봉투). `status.get` 만 권한이 필요 없다.
- **모듈 쪽**: `X-Terra-Principal` 이 없으면 `400 INVALID_REQUEST`(M-1; `status`·`models.list`·`mcp.list` 는 보지 않는다 — 소스 그대로). 본문은 모르는 필드·틀린 타입이 400.

단독으로 서버를 띄우면(`fake-agent-server.mjs`) 엄격 모드가 꺼져 있어 `X-Terra-Principal` 헤더를 직접 준다. `stack.mjs`·`run.mjs` 는 엄격 모드다.

### 계정과 프리셋

| 계정 | 의미 |
| --- | --- |
| `alice` · `bob` | 기본 계정. 권한 `agent.use`, 위임 자격·모델이 등록되어 있다(프리셋 `ready`). 둘은 서로의 세션을 못 본다 |
| `noperm` | 권한이 없다 — `status.get` 외 전부 403 `MODULE_PERMISSION_DENIED`(함정 10) |
| `ext` | `agent.use` + `agent.external` — MCP 서버 등록·삭제(`mcp.put`/`delete`)를 할 수 있다 |
| 그 밖 | `agent.use` 만. 위임 자격이 없어 세션을 열면 `409 CREDENTIAL_MISSING` |

`POST /__control/reset {"preset": …}` 은 세션·시나리오·주입·시계를 모두 처음으로 돌린다. 프리셋: `ready`(기본) · `empty`(자격·모델 없음 — 온보딩) · `no-model` · `no-credential` · `expired-credential`(alice 의 자격이 만료됨) · `unattended-credential`(alice 가 무인 자격 + `restart` 사전 승인).

`PUT /credentials` 의 값은 Gateway 확인(Whoami)을 흉내 내어 문자열로 결과가 갈린다(`tsa_` 로 시작해야 한다): `reject`·`revoked`·`expired` 포함 → `403 CREDENTIAL_REJECTED`, `person` 포함 → 같은 코드(위임 자격이 아님), `down` 포함 → `503 AGENT_UNAVAILABLE`, `unattended`(+`-empty`) → 무인 자격(사전 승인 있음/없음), `readonly`·`fleet`·`short`(90초 만료) → 권한·reach·수명.

## 제어 엔드포인트 (`/__control/…`)

`lib/control.mjs` 의 `createControl(origin)` 이 감싸 둔다(시험이 쓴다).

| 호출 | 하는 일 |
| --- | --- |
| `POST /reset {preset}` | 처음으로 |
| `GET /state` · `/scenarios` · `/requests?since=&op=` · `/calls` · `/sessions` | 상태 · 시나리오 목록 · **서버가 받은 요청 기록**(비밀은 `***`) · 모델이 부른 operation 의 기록(`reached` = Gateway 에 닿음) · 모든 소유자의 세션 |
| `POST /scenario {id}` | 전역 기본 시나리오 |
| `POST /scenario {id, session_id, times?}` | 한 세션에 못 박는다 |
| `POST /scenario {id, queue:true, times}` | 다음 n 번의 턴에만 |
| `POST /clock {advance_s}` | **시계를 앞당긴다** — 승인 카드 만료·턴 한도·자격 만료가 이 시계를 따른다. 처리가 끝난 뒤 돌아온다 |
| `POST /inject {match, effect, times?, skip?}` | 오류 주입(아래) |
| `POST /config {…}` | `model_delay_ms`(기본 250) · `call_delay_ms` · `latency_ms`(모든 요청에 더한 지연) · `envelope`(`bare`\|`gateway`) · `door`(위임 관문) · `strict_gateway` · `default_permissions` · `status_override` · `features` |
| `POST /accounts {principal, permissions}` | 계정 권한 |
| `POST /credential {principal, …}` · `DELETE` | 위임 자격을 직접 심는다(`ttl_ms`·`unattended`·`pre_approved`·`permissions`·`reach`·`expires_at`) |
| `POST /seed {scenario, session_id, owner, entries}` | 이미 쌓인 세션(긴 기록) |
| `POST /restart-module` | 모듈 재시작 — 끝나지 않은 세션은 모두 `archived`(함정 4) |

**오류 주입** `match`: `{op:'io.terra.agent.messages.post'}` 또는 `{method, path:'/sessions/*'}`(`*` 한 세그먼트, `**` 전부; API 접두사 뒤 경로). `effect`(합칠 수 있다: 지연 + 하나):

| effect | 일어나는 일 |
| --- | --- |
| `{module_error:{code, message?, status?}}` | 모듈 오류 봉투 `{error:{code,message}}` — 15개 코드 어느 것이든 |
| `{gateway_error:{code, status?, retryable?, details?}}` | Gateway 봉투 `{ok:false,error:{…},meta}` — 7개 코드(`MODULE_UNAVAILABLE`·`MODULE_PERMISSION_DENIED`·`MODULE_INVOCATION_TIMEOUT`·`UNAUTHORIZED`·`QUOTA_EXCEEDED`·`REQUEST_TOO_LARGE`·`SCOPE_TOKEN_DENIED`) |
| `{status:502, body:'<html>…', content_type?}` | 봉투가 아닌 본문(UNKNOWN 으로 읽혀야 한다) |
| `{delay_ms}` | 응답을 늦춘다(시간 초과 시험) |
| `{hang:true}` | 응답하지 않는다 |
| `{drop:'before'}` | 처리 **전에** 연결을 끊는다 |
| `{drop:'after'}` | 처리는 **끝났는데** 응답만 잃는다 — `outcomeUnknown`(I17). 앱은 `messages.list` 로 확인해야 한다 |

기능 스위치(`features`)는 이전 모듈의 모양을 만든다: `contract`(M-2) · `expires`(M-3) · `reasonJudgement`(M-4) · `lastErrorCode`(M-6) · `modelFields`(M-7)를 끄면 그 필드가 응답에서 빠지고, `sessionsListUnfiltered` 를 켜면 R-2 전처럼 남의 세션이 목록에 섞인다. 기본은 소스의 현재 모양(전부 켜짐, 필터 켜짐)이다.

## 시나리오

시나리오는 "모델이 어떻게 답하는가"의 대본이다. 세션의 턴마다 하나가 골라지고(세션에 못 박은 것 → 한 번짜리 대기열 → 전역 기본 `read-only-answer`), 각 모델 호출이 한 단계(`step`)를 소비한다.

| 시나리오 | 보여 주는 것 |
| --- | --- |
| `read-only-answer` | 읽기 호출(묻지 않고 돈다) 후 답 — 기본 |
| `propose-call` | `plan`: 호출 제안이 `refused · TERRA_APPROVAL_REQUIRED` 로 남고 실행 안 됨 |
| `approval-flow` | `ask`: 승인 카드 → 승인하면 **접수(accepted-job)**, 거부하면 `TERRA_APPROVAL_DENIED` |
| `approval-deny-repropose` | 거부 뒤 **같은 호출 재제안(I18)** — 둘째 카드 |
| `approval-timeout` | 카드가 만료된다 — 시계를 `max_seconds` 만큼 앞당기면 `TIME_LIMIT`(denied 줄 없음), 크게 열고 31분 앞당기면 `no answer within 30m0s` |
| `two-approvals` | 한 차례에 카드 둘(차례로) — 대기 여럿 |
| `accepted-job` | `auto`: 쓰기를 묻지 않고 돌려 **접수 ≠ 완료** |
| `unattended-refuse` | `unattended`: 사전 승인 밖은 묻지 않고 거절, 사전 승인된 것은 돈다 |
| `slow-model` · `cancel-mid-turn` | 3초/60초 느린 응답 — running 상태·취소 |
| `model-failure` · `model-failure-after-call` | 모델 실패 → `failed`(`MODEL_UNAVAILABLE` 줄) |
| `model-refusal` · `model-truncated` | `MODEL_REFUSED`·`MODEL_TRUNCATED` — `idle` |
| `step-limit` · `token-budget` | `STEP_LIMIT`·`TOKEN_BUDGET` — `idle`(`failed` 가 아니다) |
| `external-call` · `external-write-ask` | 외부 MCP: `external` 줄("감사에 없다"), 외부 쓰기 카드에는 `contract` 가 없다 |
| `gateway-403-after-approve` | 승인 뒤에도 Gateway 가 403(I5) |
| `reach-exceeded` | reach 밖 호출 → 카드 없이 `TERRA_REACH_EXCEEDED` |
| `simulate-planned` | `simulate`: `planned` 줄만, 호출 0(I13) |
| `legacy-contract` | 카드 계약 사실이 일부만 — "적지 않음"(키 없음) ≠ "없음"(`[]`)(DC-17) |
| `html-in-text` | assistant 글에 HTML·`{{…}}`·`javascript:` 링크 — 글자 그대로 나와야 한다(I7) |
| `module-restart` | 카드가 선 채로 멈춘다 — `/restart-module` 로 `archived`(함정 4) |
| `long-history` (시드) | 1200줄 세션 — 500줄 쪽 넘김(함정 8) |

### 시나리오 추가하기

`scenarios/<id>.mjs` 를 만든다(파일 이름 = `id`). 서버가 다음 기동 때 자동으로 읽고, `server/state.test.mjs` 의 "모든 시나리오가 형식을 지키고 끝까지 돈다"가 새 시나리오를 바로 돌려 본다.

```js
export default {
  id: 'my-case', title: '…', description: '…',
  session: { autonomy: 'ask' },           // 권고: 이렇게 열어라 (강제 아님)
  steps: [
    { text: '다시 시작하겠습니다.', calls: [{ operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'x' }, reason: '멈춰 있다' }] },
    { when: 'approved', text: '접수되었습니다.' },     // 직전 호출 묶음의 결과가 맞을 때만
    { when: 'denied',   text: '거부하셨네요.' },
  ],
};
```

`steps` 는 배열이거나 `(ctx) => step | null` 함수다. 한 단계에는 `text`·`calls`·`usage`·`delayMs`·`fail`·`refuse`·`truncated`·`sent_bytes`·`when` 이 올 수 있다(전체는 `scenarios/index.mjs` 머리말). 호출할 수 있는 operation 은 `lib/catalog.mjs` 의 `CATALOG` — 새 operation 이 필요하면 거기에 계약 사실(위험·확인·멱등·재시도·결과 방식·부작용·권한)과 canned 결과를 더한다. **계약이 적지 않은 필드는 쓰지 않는다**(키가 없어야 "적지 않음"이다).

## 가짜 서버가 소스와 갈라지지 않게 하는 방법

가짜 서버는 거짓말하기 쉽다. 그래서 **계약과 소스에 기계로 대조**한다(`server/contract.test.mjs`, `npm run e2e:server`):

1. 계약의 operation 19개가 모두 구현되어 있고, 경로·메서드·필요 권한이 계약과 한 줄씩 같다.
2. `src/api.go` 의 `operationRoutes` 표를 정규식으로 읽어 같은 19줄인지 본다 — 계약과 소스가 서로 어긋나면 여기서 먼저 보인다.
3. 모든 operation 의 성공 응답을 계약의 `output.schema` 로 검증한다(`lib/schema.mjs`). 소스가 계약과 다른 곳은 `KNOWN_DIVERGENCES` 에 이유와 함께 적고, **그 갈라짐이 사라지면 시험이 "목록에서 빼라"고 실패한다.**
4. 계약의 입력 예시를 그대로 보내 모르는 필드 400 이 없음을 본다.
5. 오류 코드 15개의 `httpStatus`·`retryable` 이 계약과 같고, **15개 모두 실제로 발생시킬 수 있다**(14개는 요청만으로, `MODEL_UNAVAILABLE` 은 주입으로 — 소스가 HTTP 로 내지 않는다).

소스나 계약이 바뀌면 이 시험이 실패한다 — 그때 `lib/` 를 고치고 `scenarios` 를 맞춘다. 앱 e2e 가 거짓 초록이 되는 길을 막는 장치이므로 시험을 끄거나 느슨하게 하지 않는다.

### 알려진 갈라짐 (소스를 정본으로 따랐다)

계약과 소스가 다른 곳 — 가짜는 **소스**를 따른다:

| 곳 | 계약 | 소스(= 가짜) |
| --- | --- | --- |
| `runs.post` 응답 | `answer`·`last_error` 는 string | 비면 키가 없어 `null` (`api.go` `view["answer"]`). `last_error_code` 도 없다 |
| `messages.list` `limit` | 1~5000 | 0 이상 아무 수. **0 은 "제한 없음"**. 기본 500 |
| `max_steps`·`max_seconds`·`token_budget` | 최소 1 | 0 은 "기본값"(`token_budget` 0 = 무제한) |
| `messages.post.text`·`runs.post.prompt` | 최대 20000자 | 길이를 막지 않는다 — 20001자 차단은 **앱의 몫** |
| `sessions.post.topic`·`mcp_servers[]` 길이 | 200자·64자 | 막지 않는다 |
| 입력 구조체 | 모든 입력 `additionalProperties:false` | `sessions.post` 가 `prompt` 를, `runs.post` 가 `session_id`·`topic` 을 받는다(구조체를 공유) |
| `models.put` | 본문 `provider` 필수 | 경로의 provider 만 본다. 본문 `provider` 는 받되 무시 |
| `credentials.put.credential` | 최소 8자 | `tsa_` 접두사 + 그 뒤 한 글자 이상 |
| `usage` | `model_calls` 가 있다(선택) | 싣지 않는다 |

아래는 **가짜가 소스를 단순화한 곳**이다(실 모듈과 다를 수 있다):

- **모델이 없다.** 문구(`judgement`·`note`·승인 카드의 영어 `text`)는 소스의 형식을 따라 쓴 것이고 실제 문구와 다를 수 있다. 앱은 문구를 파싱하지 않아야 한다(요구 §6.4).
- **게이트 판정**(`lib/catalog.mjs decide`)은 요구 문서·시연의 규칙(`plan` 제안만 · `ask` 쓰기·위험 묻기 · `auto` 위험만 묻기 · `unattended` 사전 승인만)을 옮긴 근사다. 실제 `agentcore.Decide` 가 아니다.
- **Gateway 호출 결과**는 `CATALOG` 의 canned 값이다. `trace_id` 형식(`tr_000001`)과 외부 도구의 한정 이름(`mcp__<서버>__<도구>`)은 지어낸 것이다.
- **MCP 등록**(`probe`)은 명령 이름으로 갈린다: `fail`·`missing`·`nonexistent` 포함 → `502 MCP_SERVER_FAILED`, `small` 포함 → 도구 하나, 그 밖 → 도구 넷(이름이 투영되지 않는 `bad name!` 은 `dropped`).
- **디스크 기록은 없다.** 재시작은 `/restart-module` 이 상태만 바꾼다(자격·모델·MCP 등록은 남고, 대기 승인은 사라지고, 끝나지 않은 세션은 `archived`).
- Go 의 `encoding/json` 이 필드 이름 대소문자를 가리지 않고 값 뒤 쓰레기를 무시하는 것은 옮기지 않았다(필드 이름은 정확히, 본문은 JSON 한 덩어리).

## 알아 둘 것

- **Chromium 은 끊긴 연결의 POST 를 조용히 다시 보낸다.** 재사용 중인 연결이 응답 없이 끊기면(`drop` 주입이 그렇다) 요청이 한 번 더 간다 — 실제 브라우저에서도 일어나는 중복 전송이다(I17 의 이유). 가짜 서버는 매 응답에서 `Connection: close` 를 보내 연결을 재사용하지 않게 해서, `drop: 'after'` 가 앱에 **한 번의 유실**로 보이게 한다. 재전송 동작 자체를 시험하려면 이 헤더를 빼야 한다.
- **스트림(`messages.stream`)**: 서버는 SSE 를 낸다(직접 호출). 브리지는 응답 한 번뿐이라, 브리지로 부르면 Gateway 가 스트림을 닫을 때까지 응답이 오지 않는다(셸의 `fetch` → `response.json()` 이 기다린다). 앱은 폴링한다(함정 3).
- 앱 CSP 의 `connect-src 'self'` 는 앱 origin(= Gateway origin)을 가리키므로 앱이 직접 `fetch` 해도 CSP 는 막지 않는다. 대신 엄격 모드 Gateway 가 토큰 없는 호출을 `401` 로 막는다 — 앱의 API 호출은 브리지를 거쳐야 한다. 다른 origin(셸 등)으로의 연결은 CSP 가 막는다.
- **같은 주소의 요청은 앞의 것 뒤에 선다.** `inject {hang:true}` 로 한 주소를 붙잡아 두면 Chromium 이 같은 주소의 다음 요청(HTTP 캐시 잠금)을 서버에 보내지 않고 기다린다. 앱의 폴링을 붙잡으면서 보내기 직전의 `sessions.get` 은 통과시켜야 하는 점검(`guard.e2e.mjs`)은 기록 읽기(`messages.list`)를 붙잡는다 — 서로 다른 주소다. 지연(`delay_ms`)도 같은 주소의 뒤 요청을 그만큼 늦춘다.
- **`hang` 은 앱의 요청 시간 제한(20초)이 풀어 준다.** 서버는 응답하지 않고, 앱이 끊고 다음 폴링으로 넘어간다. 점검은 그 안에 끝내야 한다.
- 실패한 e2e 점검은 `e2e/.artifacts/` 에 스크린샷을 남긴다(`.gitignore` 됨).
- `--app ui` 에 해당하는 점검이 하나도 없으면 러너가 **실패**한다(조용히 0개를 돌고 초록이라 말하지 않는다).

## 하지 않은 것

- 무인 + 외부 MCP·DC-25 는 새 세션 화면에 그 조작이 서야 한다("화면 없음").
- 전송 어댑터(`src/transport/errors.ts`)가 이 서버의 봉투를 읽는지 — 어댑터 시험은 Vitest 의 몫이다. 앱 e2e 는 오류 코드 사전 전체(모듈 15 + Gateway 7)가 화면에 서는 모양을 `tests/errors.e2e.mjs` 로 돌린다. `BRIDGE_NO_PERMISSIONS` 의 화면 모양은 앱이 어긋나 점검을 뺐다([TODO-checks.md](TODO-checks.md) "앱 버그로 뺀 점검").
- 실 모듈·실 Gateway 스모크(§5.3 넷째 층) — 별도 잡.
