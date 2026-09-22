---
title: "Terra 통합 Scene 모듈"
aliases:
  - "io.terra.scene.terra"
  - "통합 base Scene"
doc_type: "module-design"
scope: "project"
target: "terra"
status: "active"
implementation_status: "shipped"
version: "0.3.0"
last_updated: "2026-09-21"
related:
  - "[[module/README|Terra 외부 Module 저장소]]"
  - "[[docs/modules/terra-gui/design/terra-unified-base-scene-design|Terra 통합 base Scene 설계]]"
  - "[[docs/modules/terra-gui/design/terra-scene-player-modular-gui-platform-detailed-design|Terra Scene·Player 모듈형 GUI 플랫폼 상세 설계]]"
  - "[[docs/guides/scene-development-guide|Scene 개발 가이드]]"
  - "[[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-session-model|통합 GUI 세션 모델]]"
---

# Terra 통합 Scene 모듈

`io.terra.scene.terra`는 Leaf와 Tree가 함께 쓰는 **하나의 GUI**이고, 이 노드에
설치된 모듈로 들어가는 **런처**다. `kind: scene` — 프로세스가 없는 데이터
패키지이며, 게이트웨이가 서빙하고 Player가 런타임에 적재한다.

설계 근거와 결정은 [[docs/modules/terra-gui/design/terra-unified-base-scene-design|통합 base Scene 설계]]가 소유한다.
이 문서는 **패키지 자체**만 설명한다.

## 규칙 하나

> `requiredOperations`에 `terra.gateway.*` 만 적는다.

Gateway Operation은 계약이 `availability.products: ["common"]`으로 선언하므로 두
제품에 똑같이 있다. 제품별 Operation(`terra.master.*` · `terra.daemon.*`)을 하나라도
부르면 그 화면은 반대쪽 제품에서 실패한다.

그래서 이 패키지 어디에도 **이 노드가 어느 역할인지 묻는 자리가 없다.** 노드의
성격은 `terra.gateway.health.get`과 카탈로그가 답하는 대로 화면에 드러난다.

## 구성

```text
module/common/io.terra.scene.terra/
├─ module.json                     kind=scene · products=[leaf,tree] · role=base
└─ scene/
   ├─ scene.json                   Route 8 · requiredOperations 10 · slotContributions 1
   ├─ stores/      (11)            session · nav · loginForm · credentials(secret)
   │                               node · modules · apps · catalog · remote
   │                               diagnostics · settings(persistent)
   ├─ functions/   (18)            관측 1 · 세션 3 · 이동 1 · 조회 6 · 모듈 제어 2
   │                               런처 1 · 카탈로그 2 · 설정 2
   ├─ fragments/   (9)             nav + 화면 8
   └─ schemas/     (1)             settings.schema.json
```

폴더 배치는 저장소가 출하하는 다른 Scene 셋과 같은 **평면 배치**다. `terra gui new`
스캐폴드의 `contract/`·`surface/` 층은 그 스캐폴드의 관례이고 플랫폼 규칙이 아니며,
`terra module pack`도 그것을 요구하지 않는다.

## 화면

| Route | 무엇 |
| --- | --- |
| `/` | **입구.** 노드 요약 + 설치된 앱 타일 = 런처 홈 |
| `/login` | 로그인 — 세션 발급처를 함께 보여 준다 |
| `/modules` | 모듈 인벤토리, 행마다 시작·정지 |
| `/apps` | 웹앱 · Scene · 스캔 진단 |
| `/catalog` | 이 노드가 할 줄 아는 일 — CLI `terra api`와 같은 목록 |
| `/nodes` | 둘러볼 수 있는 원격 노드 |
| `/diagnostics` | 수집된 Scene 진단 (두 손실 수치를 나눠서) |
| `/settings` | 시작 화면 · 자동 새로 고침 |

네비게이션은 `terra.nav` Fragment 하나를 `shell.nav` Slot으로 꽂는다 — 화면마다
복제하지 않는다. 로그인 화면은 그 Slot을 선언하지 않는다.

## 임시 GUI 의 설계 언어

화면 시각 설계를 받기 전에 **쓸 수 있는 것**을 먼저 세웠다. 규칙 다섯이고, 전부
브라우저로 실제 화면을 보고 나온 것이다 — 선언이 아니라 관측이다.

| 규칙 | 왜 |
| --- | --- |
| 화면마다 머리 하나 — 제목 + 그 아래 한 줄 | 제목만으로는 "여기가 어디"만 답하고 "무엇을 하는 곳"은 답하지 않는다 |
| 구획은 `card`, 제목은 `card.title` | 15px/600 이라 20px 머리와 위계가 저절로 갈린다 |
| **버튼은 가로 줄 안에만** | `column` 이 `align-items: stretch` 라, 세로 열에 혼자 둔 버튼은 화면 폭짜리 슬래브가 된다 |
| label/value 는 **타일로 쌓는다** | 한 줄에 두면 1280px 화면에서 둘이 600px 넘게 벌어져 눈이 건너지 못한다 |
| 오류·부가 정보는 `caption` | 본문 굵기로 두면 `No operation registered for …` 같은 개발용 문구가 화면의 주인공이 된다 |

뒤의 셋은 처음 판에서 전부 어긴 것이고, 화면을 띄워 보고서야 보였다. 그래서
**세 규칙을 시험으로 묶었다** — `terra-scene-runtime/tests/terra-scene-session.test.ts`
가 버튼의 부모, 머리의 구성, 네비게이션의 "지금 여기" 짝을 검사한다.

### 지금 있는 화면은 누를 수 없다

어휘에 버튼 `variant` 도 `aria-current` 도 없다. 그래서 라우트마다 글과 버튼을
**둘 다** 두고 `nav` Store 의 `/route` 로 하나만 보이게 한다 — "누를 수 없는 것"이
이 어휘로 표현할 수 있는 유일한 현재 표시다.

`nav` Store 를 따로 둔 이유는 런타임이 Route 를 인스턴스에만 들고 Scene 에게 주지
않기 때문이다(`mount(container, route)`). 그래서 **이동하는 쪽이 적는다**:
`terra.nav.go` 가 navigate 하기 전에 목적지를 쓰고, 로그인·로그아웃도 자기 목적지를
쓴다. 첫 마운트는 아무도 부르지 않으므로 그 한 번은 `initial` 이 답한다.

### 색은 Scene 이 정하지 않는다

이 패키지에 `theme` 블록이 없다. Player 의 Theme 정책이 기본적으로 **구조 토큰만**
허용하고 정체성(색·글꼴)은 막으므로, 색을 정하는 쪽은 언제나 호스트다. 실제 배선은
`products/common/ui/terra-runtime-core/src/styles.css` 가 `--scene-*` 를 제품 팔레트로
잇는 자리다 — 그 줄이 없던 동안 Scene 화면은 파랗고 그것을 감싼 셸은 초록이었다.

## 로그인은 관문이 아니라 단계다

입구는 `/`이고 `/login`은 그냥 Route 하나다. Gateway Operation 44개 중 **28개가
익명으로 되므로**, 목록을 보고 앱을 여는 데까지 자격이 필요 없고 무언가를 바꾸려 할
때 필요하다. 로그인을 입구에 세우면 익명으로 볼 수 있는 것까지 가로막는다.

같은 이유로 로그아웃도 `/login`이 아니라 `/`로 돌아간다.

## 세션 상태는 기억하지 않고 관측한다

제품 역할을 묻지 않는 것과 **같은 규칙**이다. `terra.context.refresh`가 모든 Route의
`lifecycle:enter`에 걸려 있고, `health.get`(공개)과 `whoami.get`(세션)에게 물어
`session` Store를 다시 적는다.

| `session.state` | 어디서 나오나 |
| --- | --- |
| `unknown` | Store 초기값 — 아직 묻지 않았다 |
| `unreachable` | `health.get` 자체가 실패 |
| `rejected` | `auth.credentialRejected` — **이 Gateway의** 자격이 죽었다 |
| `open` | `auth.mode`가 `open`(권한 전부 열림) 또는 `seeded`(열리지 않음) |
| `unavailable` | `auth.mode`가 비어 있다 — 로그인 중계가 501 |
| `anonymous` | `mode: master` + `whoami` 실패 — **정상 상태다** |
| `authenticated` | `mode: master` + `whoami` 성공 |

`whoami`가 실패하는 것이 익명의 정상 상태이므로 `error`에 적지 않는다. 적으면 화면이
오류를 말한다.

권한 셋(`module.manage` · `node.read` · `agent.grant`)은 `branch`의 `in` 연산자로
파생해 `session.can.*`에 불린값으로 둔다. `visible`의 JSON Schema 술어에는 배열 포함
검사가 없어 `permissions` 배열을 화면에서 직접 볼 수 없기 때문이다. **새 어휘는 0이다.**

권한이 없어도 동작을 감추지 않는다 — `visible`은 권한 게이트가 아니고 실제 차단은
Gateway가 호출에서 다시 한다. 감추면 "왜 없지"를 알 수 없으므로 모듈 목록은 버튼을
그대로 두고 옆에 이유를 적는다(`manageLocked`). 어휘에 `disabled`가 없어 "보이되
잠근다"를 그대로 쓸 수 없는 것이 [[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-vocabulary-gaps|어휘 공백]] ④다.

## 설치하면 제품 Scene이 강등된다

`io.terra.scene.leaf`·`io.terra.scene.tree`가 함께 설치돼 있으면 게이트웨이가 둘을
`application`으로 내리고 `GUI_SCENE_BASE_SUPERSEDED` 진단을 남긴다.

**회수가 아니다.** 둘은 `/apps/<module-id>`에서 계속 열린다 — 이관 중에 옛 셸로
돌아갈 길이 남아 있어야 하기 때문이다.

## 런처는 열지 않는다 — 열어 달라고 말한다

Scene은 iframe도 창도 열 수 없다(§13.3). `terra.app.launch` Function이 하는 일은
Operation 호출이 아니라 신호 하나다.

```json
{ "id": "ask", "type": "emit", "signal": "terra.app:launch",
  "payload": { "appId": "$input.value" } }
```

호스트 셸이 그 신호를 받아 설치된 선언의 `mode`를 보고 sandbox iframe에 올릴지 창을
띄울지 정한다. **무엇을 여는지는 Scene이, 어떻게 여는지는 호스트가 정한다.**

## 고칠 때

```bash
# 1. 화면을 고친다 (JSON만 — 코드 0행)
$EDITOR module/common/io.terra.scene.terra/scene/fragments/home.fragment.json

# 2. 실 로더에 먹인다
npm test -w products/common/packages/terra-scene-schema      # 적재
npm test -w products/common/packages/terra-scene-runtime     # 계약·DOM·dry run

# 3. 배포 형태로 굽는다
terra module pack module/common/io.terra.scene.terra --out /tmp/scene-terra.tmod

# 4. 역할 배정이 그대로인지
cd products/common/apps/terra-gateway-service && go test -count=1 -run TestShippedModuleRoots .
```

2번이 재는 것이 넷이다 — 적재 · 선언한 Operation이 실 Contract에 있는가 ·
모든 Route가 실 DOM에 마운트되는가 · Function이 도는가. 화면을 고치고 여기가
초록이면 제품에서도 뜬다.

## 관련 문서

- [[docs/modules/terra-gui/design/terra-unified-base-scene-design|Terra 통합 base Scene 설계]]
- [[docs/modules/terra-gui/design/unified-gui-ux/README|통합 GUI UX 설계 MOC]]
- [[docs/modules/terra-gui/design/unified-gui-ux/terra-gui-session-model|통합 GUI 세션 모델]]
- [[docs/modules/terra-gui/terra-gui-implementation-state|Terra GUI 구현 현황]]
- [[docs/guides/scene-development-guide|Scene 개발 가이드]]
- [[docs/manual/06-usage/scene-player|Terra Scene Player 사용]]

## 관련 모듈

- [[module/README|Terra 외부 Module 저장소]]
- `module/leaf/io.terra.scene.leaf` · `module/tree/io.terra.scene.tree` — 강등되어 남는 제품 Scene
- `module/common/io.terra.webapp-host` — 런처가 여는 웹앱의 첫 입주자

## 관련 흐름

- [[docs/architecture/flows/master-daemon-relay-flow|Master Daemon Relay Flow]]
- [[docs/architecture/operations/leaf-tree-desktop-web-application-lifecycle-design|Leaf·Tree Desktop Web Application 수명주기]]
