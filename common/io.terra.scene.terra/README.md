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
version: "0.1.0"
last_updated: "2026-09-21"
related:
  - "[[module/README|Terra 외부 Module 저장소]]"
  - "[[docs/modules/terra-gui/design/terra-unified-base-scene-design|Terra 통합 base Scene 설계]]"
  - "[[docs/modules/terra-gui/design/terra-scene-player-modular-gui-platform-detailed-design|Terra Scene·Player 모듈형 GUI 플랫폼 상세 설계]]"
  - "[[docs/guides/scene-development-guide|Scene 개발 가이드]]"
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
   ├─ scene.json                   Route 8 · requiredOperations 9 · slotContributions 1
   ├─ stores/      (10)            session · loginForm · credentials(secret)
   │                               node · modules · apps · catalog · remote
   │                               diagnostics · settings(persistent)
   ├─ functions/   (17)            세션 3 · 이동 1 · 조회 6 · 모듈 제어 2
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
| `/login` | 로그인 — 세션 발급처를 함께 보여 준다 |
| `/` | 노드 요약 + 설치된 앱 타일 = **런처 홈** |
| `/modules` | 모듈 인벤토리, 행마다 시작·정지 |
| `/apps` | 웹앱 · Scene · 스캔 진단 |
| `/catalog` | 이 노드가 할 줄 아는 일 — CLI `terra api`와 같은 목록 |
| `/nodes` | 둘러볼 수 있는 원격 노드 |
| `/diagnostics` | 수집된 Scene 진단 (두 손실 수치를 나눠서) |
| `/settings` | 시작 화면 · 자동 새로 고침 |

네비게이션은 `terra.nav` Fragment 하나를 `shell.nav` Slot으로 꽂는다 — 화면마다
복제하지 않는다. 로그인 화면은 그 Slot을 선언하지 않는다.

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
