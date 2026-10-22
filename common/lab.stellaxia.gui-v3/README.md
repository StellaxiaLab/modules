---
title: "Terra GUI v3 (`lab.stellaxia.gui-v3`)"
aliases:
  - "Terra GUI v3"
  - "gui-v3"
  - "guiV3"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "draft"
version: "0.0.1"
last_updated: "2026-10-22"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
---

# Terra GUI v3 (`lab.stellaxia.gui-v3`)

Terra 노드 GUI의 3판이다. **지금은 설계 단계**라 화면이 없고, 문서와 자리 표시 Scene 하나뿐이다.

방향은 하나다 — **화면(표현)은 새로 짓고, Terra 코어와 붙는 기능 층은 [`lab.stellaxia.node-gui`](../lab.stellaxia.node-gui/README.md)의 것을 이어받는다.**
기존 화면이 직관적이지 않다는 판단에서 시작했고, 연동 코드는 실측과 시험이 붙어 있어 버릴 이유가 없다.

## 지금 있는 것

```text
common/lab.stellaxia.gui-v3/
├─ module.json        kind=scene · 0.0.1 · entrypoints.scene 만 — contributions.gui 없음
├─ scene/             자리 표시 Scene (글 한 줄) — L-7 이 entrypoint 를 요구해서 둔다
│  ├─ scene.json
│  └─ surface/fragments/main.fragment.json
├─ docs/              설계 문서 — 포장되지 않는다(L-8 경고는 의도한 것)
└─ README.md
```

> [!NOTE] 노드에 깔려도 보이지 않는다
> `contributions.gui`가 없으므로 base Scene(`io.terra.scene.terra`)은 이 모듈을 main · dev 후보로 고르지 않는다.
> 저장소의 릴리스 포장(`tools/pack-modules.mjs`)은 모든 모듈을 담으므로 다음 릴리스에 빈 `.tmod`로 실린다 — 화면이 생기기 전에 릴리스를 낸다면 그 점을 알고 낸다.

## 문서

[[docs/README|GUI v3 문서 MOC]]부터 읽는다.

| 문서 | 내용 |
| --- | --- |
| [[docs/analysis/legacy-node-gui-overview\|기존 node-gui 전체 분석]] | 구조 · 규모 · 유지할 것 · 부채 · 외부 제약 |
| [[docs/analysis/legacy-app-layer\|기존 node-gui 기능 층 분석]] | 표현을 뺀 앱 계층 — 계층별 역할 · 재사용 판정 · 숨은 결합 · v3 경계 제안 |

## 관련 모듈

- [`lab.stellaxia.node-gui`](../lab.stellaxia.node-gui/README.md) — 기존 GUI(2판). 기능 층의 출처
- [`io.terra.agent`](../io.terra.agent/) — `.dc.html` 시연을 Vite + TypeScript 번들로 다시 쓴 선례
