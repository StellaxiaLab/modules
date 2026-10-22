---
title: "Terra GUI v3 문서 MOC"
aliases:
  - "GUI v3 문서 MOC"
  - "gui-v3 docs"
doc_type: "moc"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-22"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[legacy-node-gui-overview|기존 node-gui 전체 분석]]"
  - "[[legacy-app-layer|기존 node-gui 기능 층 분석]]"
---

# Terra GUI v3 문서 MOC

GUI v3는 **화면은 새로 짓고, Terra 코어와 붙는 기능 층은 기존 [`lab.stellaxia.node-gui`](../../lab.stellaxia.node-gui/README.md)에서 이어받는다.**
지금 문서는 그 출발점인 기존 GUI 분석 둘이다.

## 읽는 순서

```mermaid
flowchart LR
  A["기존 node-gui 전체 분석"] --> B["기존 node-gui 기능 층 분석"]
  B --> C["v3 core · app 인터페이스 (다음)"]
```

| 하려는 일 | 문서 |
| --- | --- |
| 기존 GUI가 어떻게 생겼고 무엇이 부채인지 | [[legacy-node-gui-overview\|기존 node-gui 전체 분석]] |
| 기존 GUI에서 Terra와 붙는 코드 중 무엇을 그대로 가져가는지 | [[legacy-app-layer\|기존 node-gui 기능 층 분석]] |

## 폴더

| 폴더 | 문서 |
| --- | --- |
| `docs/` | 이 MOC |
| `docs/analysis/` | [[legacy-node-gui-overview\|전체 분석]] · [[legacy-app-layer\|기능 층 분석]] |

## 기준

두 분석은 modules `main` `9d37f62`(2026-10-22) 시점의 `common/lab.stellaxia.node-gui`(모듈 0.4.5)를 읽은 것이다. 앱을 실행하거나 시험을 돌리지는 않았다.

## 관련 문서

- 모듈 README — `../README.md`
- 기존 GUI의 개발 문서 MOC — `../../lab.stellaxia.node-gui/web/docs/README.md`
