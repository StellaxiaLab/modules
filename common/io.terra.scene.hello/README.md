---
title: "Hello Terra — GUI 시험 Scene 모듈"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "active"
version: "v0.1"
last_updated: "2026-09-22"
---

# Hello Terra

화면 한가운데에 `Hello Terra` 한 줄만 띄우는 Scene 모듈. **코드가 한 줄도 없다** —
JSON 셋이 전부이고, Player가 그것을 읽어 화면을 세운다.

## 왜 이렇게까지 작은가

이 모듈의 쓸모는 화면이 아니라 **배선**이다. Store도 Function도 Operation도 없으므로,
화면이 뜨지 않았을 때 의심할 자리가 Scene 내용에는 없다. 남는 것은 셋뿐이다 —
모듈이 **로드**됐는가, `contributions.gui.scenes`가 **읽혔는가**, 포장이 **열렸는가**.
무엇 하나를 고치고 다시 볼 때 변수가 하나로 유지되는 것이 이 모듈이 작은 이유다.

`terra hello`에 `hello terra`로 답하는 Terra의 수동 시험 모듈(`dev.terrallo`)이 CLI 쪽에서
같은 일을 한다. 이쪽은 그 GUI 대응물이다.

## 구성

```text
common/io.terra.scene.hello/
├─ module.json                              kind=scene, gui.scenes 기여
└─ scene/
   ├─ scene.json                            두 층을 묶는 자리
   └─ surface/
      └─ fragments/
         └─ main.fragment.json              화면 전부
```

[`docs/layout.md`](../../docs/layout.md)의 **L-10**이 적은 계층 배치를 따른다.
`contract/`가 아예 없는 것은 빠뜨린 것이 아니다 — 붙일 상태가 없어서 그 층이 서지 않았고,
그래서 `scene.json`의 `functions`와 `stores`도 빈 배열이다.

## 가운데로 모으는 법

정렬은 root `column`의 두 줄이 전부다.

```json
{ "type": "column", "id": "root", "align": "center", "justify": "center" }
```

렌더러는 이 둘을 `data-align` · `data-justify`로 내보내고, 규칙은 `scene.css`가 갖는다
(`align-items` · `justify-content`). 값을 렌더러가 갖지 않으므로 셸이 이 규칙을 덮을 수 있다.

> [!NOTE]
> **가로는 항상 가운데이고, 세로는 셸이 정한다.** `justify`는 세로축을 가운데로 모으지만,
> flex 컨테이너가 내용보다 높을 때만 눈에 보이는 차이가 된다. Scene 루트의 높이는
> Scene이 아니라 그것을 얹는 셸이 준다 — `ThemeTokenName`이 닫힌 집합이라 Scene 쪽에서
> 높이를 선언할 자리 자체가 없다. 오늘 `runtime-core`의 무대(`scene-player-stage`)는
> 높이를 주지 않으므로 세로 정렬은 그 셸에서 무효이고, 높이를 주는 셸에서는 그대로 듣는다.
> 선언을 남겨 두는 것은 의도를 적어 두기 위해서이고, 듣지 않는 셸에서 해가 없기 때문이다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `npm run validate` | 오류 0 · 경고 0 |
| `terra module pack common/io.terra.scene.hello` | 통과 (`verified`, 파일 3개) |

`pack`은 Scene 무결성까지 본다 — route가 가리키는 fragment가 있는지, fragment가 부르는
store·function이 선언돼 있는지. 이 모듈은 부르는 것이 없어서 그 검사가 조용히 통과한다.

## 관련 문서

- [저장소 README](../../README.md) — 모듈을 만들고 검증하는 절차
- [`docs/layout.md`](../../docs/layout.md) — 배치 규약, 특히 **L-4**(products)와 **L-10**(Scene 두 층)
- Terra `docs/contracts/module-host-http-contract.md` — 모듈이 되기 위해 구현할 것의 전부
