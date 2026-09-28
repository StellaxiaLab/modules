---
title: "MAIN Test — base 분기 main 시험 Scene 모듈"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "active"
version: "v0.1"
last_updated: "2026-09-28"
---

# MAIN Test

흰 바탕 한가운데에 `MAIN Test`를 크게 띄우는 Scene 모듈. **코드가 한 줄도 없다** —
JSON 셋이 전부이고, 그중 이 모듈을 이 모듈로 만드는 것은 `module.json`의 한 줄이다.

```json
{ "id": "lab.stellaxia.scene.main-test", "entry": "scene/scene.json", "role": "application", "branch": "main" }
```

## 왜 있나

Terra 0.5.8부터 base Scene(`io.terra.scene.terra`)은 자기 화면이 없는 **진입점**이다
(Terra#92, 설계 `docs/modules/terra-gui/design/terra-base-scene-branch-design.md`).
사람이 쓰는 화면은 모듈이 `contributions.gui.scenes[]`에 `"branch": "main"`으로 스스로
선언하고, base는 설치된 GUI를 세어 무엇을 띄울지 정한다.

| 설치된 GUI | base가 하는 일 |
| --- | --- |
| main 1개, dev 없음 | 곧장 main. BASE는 한 프레임도 그려지지 않는다 |
| main 없음 | `MAIN_NOT_FOUND` 오류 화면 |
| main 2개 이상, 또는 dev가 있음 | `/choose` 목록 |

0.5.8 번들에는 main을 선언한 모듈이 **하나도 없다**. 그래서 0.5.8 노드는 GUI를 열면
`MAIN_NOT_FOUND`부터 본다. 이 모듈은 그 자리를 채우는 가장 작은 main이다 — 깔면 노드가
`MAIN Test`로 열리고, 빼면 다시 `MAIN_NOT_FOUND`로 돌아간다.

[`lab.stellaxia.scene.hello`](../lab.stellaxia.scene.hello/README.md)와 같은 이유로 작다.
Store도 Function도 Operation도 없으므로, 화면이 뜨지 않으면 의심할 자리가 Scene 내용에는
없다. 남는 것은 base의 main 판정, 로드, 포장 셋뿐이다.

## 구성

```text
common/lab.stellaxia.scene.main-test/
├─ module.json                              kind=scene, gui.scenes 기여 + branch: main
└─ scene/
   ├─ scene.json                            두 층을 묶는 자리
   └─ surface/
      └─ fragments/
         └─ main.fragment.json              화면 전부
```

`terra gui new`로 뼈대를 굽고 예제 Store·Function(입력창과 버튼)을 걷어냈다.
붙일 상태가 없으므로 `contract/` 층이 서지 않고, [`docs/layout.md`](../../docs/layout.md)의
**L-10**이 적은 계층 배치의 surface 한 층만 남는다.

## 화면

- **가운데** — root `column`의 `align: center`(가로)와 `justify: center`(세로) 두 줄.
- **크게** — `text`의 `display` 변형. 화면 하나에 하나뿐인 큰 제목이라는 뜻이고,
  크기는 Scene이 아니라 `scene.css`가 갖는다(`clamp(40px, 9vw, 88px)`, 굵기 800).
- **흰 바탕** — Scene은 바탕을 칠하지 않는다. 엘리먼트에 색 필드가 없는 것이 계약이고
  (정체성은 셸이 정한다), 제품 셸의 밝은 테마가 그 바탕이다. 실측한 색은 **`#eef1ec`**
  (셸 페이지 배경, 순백에 가까운 밝은 회녹색)이다. 제품 셸은 OS 다크 설정을 따르지 않으므로
  어느 기계에서나 같다. 순백 `#ffffff`가 꼭 필요하면 Scene이 아니라 `terra.web/frame`으로
  웹을 감싸는 모듈이어야 한다.

## 시험

### 정적 — 이 저장소와 Terra의 권위

| 명령 | 결과 (2026-09-28) |
| --- | --- |
| `npm run validate` | 모듈 2개 · 오류 0 · 경고 0 |
| `npm run check:schema -- --terra <terra>` | 스키마 대조 통과 (Terra v0.5.8) |
| `terra module pack common/lab.stellaxia.scene.main-test` | `verified: true` (terra 0.5.8, `eafdaa6`) |

### 실물 — 제품 셸에서 base가 이것을 main으로 여는가

Terra 0.5.8 릴리스 번들의 바이너리와 셸을 그대로 썼다. 게이트웨이에 `--scene-root`를 둘
주고(번들의 `modules/` — base가 거기 있다 — 와 이 모듈을 둔 폴더), 그 앞에 Product Host를
세워 빌드된 제품 셸(`ui/leaf`·`ui/tree`)을 서빙했다. 헤드리스 Chromium으로 열었다.

```bash
terra-gateway --addr 127.0.0.1:18787 \
  --scene-root <bundle>/modules --scene-root <폴더>/  \
  --module-state-root <state>
terra-host --config host.json   # gateway_base_url=http://127.0.0.1:18787, ui_root=<bundle>/ui/leaf
```

| 경우 | 본 것 |
| --- | --- |
| 게이트웨이 GUI 목록 | `lab.stellaxia.scene.main-test` — `role: application`, `branch: main`, 진단 없음 |
| leaf 셸, 1280×800 | base가 `terra.gateway.gui.scenes.get` → `/open` → 이 Scene 적재. `MAIN Test` 88px·800, 중심 (640, 396). 콘솔 오류 0 |
| leaf 셸, 375×667 | 40px, 중심 (188, 330) |
| tree 셸 | 같은 화면 |
| OS 다크 설정 흉내 (`prefers-color-scheme: dark`) | 바탕 `#eef1ec`·글자 `#17201d` 그대로 — 셸이 OS 다크를 따르지 않는다 |
| 이 모듈을 빼고 `POST /api/v1/gui/scenes/scan` | `MAIN_NOT_FOUND` — 셸이 "`branch: main`을 적으면 이 화면 대신 그 GUI가 뜬다"고 안내 |
| 다시 넣고 scan | 곧장 `MAIN Test` |

> [!NOTE] 브라우저로 열 때는 제품 세션부터
> 빌드된 셸은 첫 요청 전에 Product Host의 로컬 세션(`POST /api/product/session`)을
> 가져야 한다. 세션 없이 연 탭은 첫 게이트웨이 요청이 401이 되어 레거시 콘솔로 내려가고,
> 이 Scene은 그 콘솔의 미리보기 칸 안에 작게 뜬다. 데스크톱 셸은 실행 토큰으로 세션을 먼저
> 쥐므로 이 일이 없다(Terra 알려진 문제, #82). 시험에서는 세션을 만든 뒤 다시 열었다.

## 노드에 깔기

```bash
terra module pack common/lab.stellaxia.scene.main-test --out /tmp/main-test.tmod
terra module publish /tmp/main-test.tmod --policy available   # tree 운영자 — 접두사 lab.stellaxia 발급 후
```

main은 하나일 때만 곧장 뜬다. 다른 main이나 dev가 함께 깔린 노드에서는 base가 `/choose`
목록을 보이고, 거기서 `MAIN Test`를 고를 수 있다.
