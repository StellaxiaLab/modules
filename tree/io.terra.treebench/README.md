# io.terra.treebench

Tree 제어 평면의 테스트 콘솔. Master 계약이 선언한 **107개 operation 전부**에
부를 자리를 주고, 무엇이 돌아왔는지를 봉투째 보여주고, 무엇을 아직 한 번도
부르지 않았는지를 원장으로 센다.

모듈은 절반씩이다.

| 절반 | 무엇 | 어디 |
| --- | --- | --- |
| UI | Gateway가 서빙하는 sandboxed 정적 앱 | `ui/` |
| 프로세스 | 머신 채널 중계 + 상태 | `src/` |

## UI가 무엇을 근거로 화면을 그리는가

하드코딩한 operation 목록이 없다. 두 출처를 조인한다.

- **Gateway 카탈로그**(`GET /api/v1/catalog`) — 이 Gateway가 실제로 중개할 수
  있는 operation과 그 HTTP binding·권한.
- **`ui/contract-map.js`** — 카탈로그가 나르지 않는 두 가지: 각 operation의
  **인증 채널**과 **입력 필드 이름**. Master 계약에서 생성한다.

조인 결과가 이 콘솔의 존재 이유다. 계약에는 있는데 카탈로그에 없는
operation은 빈칸이 아니라 **`미게시` 배지가 붙은 행**으로 남는다 — 그것이
Gateway 조립에 대한 발견이기 때문이다.

호출은 전부 Invocation Broker의 단일 진입점
`POST /api/v1/operations/{id}/invoke`로 나간다. Gateway가 평면 JSON에서
`{name}` 경로 파라미터를 이름으로 채우고 나머지를 body(또는 query)로 만들기
때문에, 107개가 요청 모양 하나로 덮인다. 그래서 손으로 쓴 폼이 없다.

### contract-map.js 다시 만들기

Master 계약을 고쳤다면 함께 돌린다. 안 돌리면 `src/contract_map_test.go`가
실패한다 — 조용히 낡는 것을 막는 것이 그 테스트의 일이다.

```bash
# 이 저장소 뿌리에서. Terra 체크아웃이 있어야 Master 계약을 읽는다.
TERRA_CHECKOUT=../Terra node tree/io.terra.treebench/tools/generate-contract-map.mjs
```

`tools/` 는 **포장되지 않는다.** 검증기가 L-8 경고로 알리는데, 이 모듈에서는 그게
맞는 답이다 — 생성기는 개발 중에 `ui/contract-map.js` 를 굽는 도구이고, 노드에
실려야 하는 것은 그 **산출물**(`ui/` 안에 있어 포장된다)이지 도구가 아니다.
배포에 필요해지면 `contracts · ui · bin · config · scene` 중 하나로 옮긴다.

## 이 콘솔이 부를 수 없는 것, 그리고 그 이유

앱은 Gateway의 앱 CSP(`connect-src 'self'`) 아래 있고 사용자 세션만 쥔다.
그래서 두 부류는 UI가 직접 부르지 못하고, 각각 화면에 사유가 적힌다.

| 부류 | 개수 | 처리 |
| --- | --- | --- |
| device-token · service-credential | 15 | **머신 채널 화면**에서 이 프로세스의 중계로 부른다 |
| WebSocket (`/ws/daemon`, `/ws/events`) | 2 | 부를 수 없음. Gateway는 HTTP를 중개하고 소켓 업그레이드를 프록시하지 않는다 |

중계(`io.terra.treebench.machine.invoke.post`)는 테스터가 입력한 자격을
채널에 맞는 헤더(`Authorization: Bearer` 또는
`X-Terra-Service-Credential`)로 실어 Master에 한 번 보내고, 상태 코드와 본문을
가공 없이 돌려준다. 자격은 저장하지도 기록하지도 않고, 요청은 Master의
`/api/v1/` 경로로만 나간다(`src/api.go`의 `validate`).

세션 채널은 **중계 대상이 아니다**. UI가 이미 스스로 부를 수 있고, 받아 주면
세션 토큰을 다른 채널용 표면으로 세탁하는 길이 열린다.

## 원장이 결과를 넷으로 나누는 이유

⚙️ 조건부 가용이 Tree의 정상 상태다. 위임·교차 경계는 `TreeNodeID` 미설정
조립에서, 네트워크 일부는 `NetworkState`·`WireGuardReconciler` 미주입에서
501을 답한다. 501과 500을 같이 세면 커버리지 숫자가 스스로 무의미해진다.

| 결과 | 뜻 |
| --- | --- |
| ✓ 성공 | 2xx |
| ⚙️ 미조립 | 501 — 이 Master 조립에 그 의존성이 없다 |
| ✓ 기대된 거부 | 실패였는데 테스터가 "이게 정상"이라고 표시했다 (`DELEGATION_REQUIRED` 등) |
| ✗ 실패 | 나머지 |

원장은 브라우저 `localStorage`(`treebench.ledger.v1`)에 있다.

## 띄우기

### 제품 배치

모듈이 설치되면 Gateway가 `contributions.gui.apps`를 스캔해
`/apps/io.terra.treebench`에 올리고, 런처(`io.terra.webapp-host`) 목록에
나타난다. 모듈 호스트가 프로세스를 기동하면서 워크로드 자격을 발급하고
라우트를 게시하므로 머신 채널 중계도 함께 산다.

### 개발 중 손으로 띄우기

Master가 이미 `127.0.0.1:8080`에 떠 있다고 할 때:

```bash
go build -o /tmp/terra-gateway ./products/common/apps/terra-gateway-service/cmd/terra-gateway
```

```bash
/tmp/terra-gateway --addr 127.0.0.1:8799 --dev-open --ipc '\\.\pipe\terra-gw-tb' --provider terra.master=http://127.0.0.1:8080 --provider-forward-auth terra.master --scene-root module/tree --scene-root module/common products/tree/master
```

`products/tree/master`를 provider root로 물리는 것이 핵심이다 — 거기
`contracts/api/terra-api.json`이 있어서 107개가 카탈로그에 올라온다.

UI는 앱 origin으로 연다(앱별 origin 격리 때문에 `127.0.0.1`로는 404다):

```
http://app-io--terra--treebench.localhost:8799/api/v1/gui/apps/io.terra.treebench/files/index.html
```

머신 채널까지 쓰려면 프로세스를 띄우고 IPC로 게시해야 한다. 정적
`--provider id=url` 매핑은 **워크로드 자격을 나르지 않아** 모듈 SDK의 가드에
`forbidden`으로 막힌다 — 자격은 IPC 등록(`Contribution.Credential`)으로만
붙는다. 제품 배치에서는 모듈 호스트가 이 등록을 대신 한다.

## 주의

- `--dev-open`은 Gateway가 모든 권한을 준다는 뜻일 뿐, 업스트림 Master는 여전히
  자기 인증을 요구한다. 세션이 필요한 호출은 로그인·세션 화면에서 토큰을 얻거나
  붙여 넣은 뒤에 성공한다(`--provider-forward-auth terra.master`가 그 토큰을
  Master로 넘긴다).
- 머신 채널 화면은 자격을 다룬다. `--dev-open` 같은 개발 조립이 아닌 곳에
  이 모듈을 두는 것은 그 자체로 결정이다.
