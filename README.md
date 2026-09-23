---
title: "Terra 모듈 저장소"
doc_type: "readme"
scope: "repository"
target: "stellaxialab/modules"
status: "active"
version: "v0.2"
last_updated: "2026-09-23"
---

# modules

모듈 모음 — Terra 모듈의 소스 저장소다.

모듈을 하나 고치자고 Terra 저장소를 통째로 건드리지 않기 위해 갈라져 나왔다. 여기 있는 것은
**소스**뿐이고, 배포되는 것은 `terra module pack`이 구운 `.tmod` 패키지다.

## 무엇이 여기 있나

```text
common/   leaf·tree 양쪽에서 도는 모듈
leaf/     leaf 제품 전용
tree/     tree 제품 전용
```

Terra의 `module/` 계층을 그대로 미러한다 — 모듈이 두 저장소 사이를 오가도 경로 모양이
바뀌지 않게. 규약 전문과 규칙 번호는 [`docs/layout.md`](docs/layout.md)에 있다.

> [!IMPORTANT]
> **접두사는 `lab.stellaxia.*` 다** (2026-09-23 확정). 경계는 **저장소**다 — 여기서
> 태어나는 모듈은 `lab.stellaxia.*`, Terra 코어가 소유하는 것은 `io.terra.*`.
> 확정 경위는 Terra 의 `docs/ideas/module-repository-split-ideas.md` §7.1.
>
> 접두사 없이 `publish` 하면 `PREFIX_NOT_OWNED`(exit 20)로 선다 — 취향이 아니라 관문이다.

> [!NOTE]
> 플랫폼이 소유하는 **kind 둘**(`application` · `runtime`)은 여기 오지 않는다. 오늘 그
> kind 로 출하된 것이 `io.terra.player` · `io.terra.scene-runtime` ·
> `io.terra.virtual-device` 셋이고, `terra module new --kind application|runtime` 이
> 이유를 말하며 거절한다.
>
> 거절하는 것은 **kind 이지 이름이 아니다** — `terra module new io.terra.player` 는
> 그냥 통과한다. 경계는 도구가 아니라 사람이 지킨다.
>
> **kind 로 표현되지 않는 예외가 하나 있다** — `io.terra.scene.terra`(통합 base Scene).
> `kind=scene` 이지만 게이트웨이가 base 역할을 **그 id 에만** 준다
> (`gui.go` `UnifiedBaseSceneID` · `baseConvention`). 개명하면 `role=application` 으로
> 강등되고 매니페스트가 `role: "base"` 를 직접 선언해도 `GUI_SCENE_BASE_DENIED` 다.
> 그래서 이 모듈은 여기 잠시 살았다가(2026-09-22) **코어로 돌아갔다**(2026-09-23).
> id 가 곧 권한이면 저장소를 고를 자유가 없다.

## 모듈 하나 만들기

뼈대는 손으로 쓰지 않는다. Terra 체크아웃에서 CLI를 굽고, 그것이 굽게 한다.

```bash
# 1. CLI 준비 (Terra 체크아웃에서 한 번)
#    main 은 모듈 루트가 아니라 cmd/terra 에 있다.
cd <terra>/products/common/apps/terra-cli && go build -o ~/bin/terra ./cmd/terra

# 2. 뼈대 — 저장소 루트에서, 소유권 루트를 이름으로 지정해서
#    --owner 가 leaf/·common/·tree/ 중 어디에 놓일지 정하고,
#    --root . 이 이 저장소에 없는 module/ 한 겹을 빼 준다.
cd <modules>
terra module new com.acme.hello --owner leaf --root . --kind service
#  → leaf/com.acme.hello/

# 3. 검증 — 이 저장소의 규약
npm ci && npm run validate

# 4. 포장 — Scene 무결성과 "설치가 되는가"까지 여기서 판정된다
terra module pack leaf/com.acme.hello --out /tmp/hello.tmod
```

> [!IMPORTANT]
> `--owner` 와 `--root .` 를 빼면 `leaf/module/common/com.acme.hello` 가 만들어진다 —
> 기본값이 `--owner common --root module` 이기 때문이고, 그 `module/` 한 겹은
> [`docs/layout.md`](docs/layout.md)가 "여기에는 없다"고 적은 바로 그 겹이다.
> 그렇게 만들면 `npm run validate` 가 **L-1 · L-9** 로 거절한다.

`pack`은 자기 출력을 설치기와 같은 검사로 되연다. 그래서 `pack`이 통과한 패키지는
설치 시점에 수수께끼를 내지 않는다.

절차의 전문은 Terra의 `docs/manual/06-usage/modules-develop.md`와
`docs/guides/first-module-tutorial.md`가 소유한다. 모듈이 되기 위해 구현해야 하는 것의
전부는 `docs/contracts/module-host-http-contract.md`에 있다 — **환경변수 6 · 헤더 1 · 경로 2**이고,
Go 의존은 0으로도 된다.

## 검증

| 명령 | 보는 것 |
| --- | --- |
| `npm run validate` | 매니페스트 형식(Manifest v2), 배치 규약 L-1~L-10, 참조 경로의 실재 |
| `npm run check:schema` | 벤더링한 스키마 사본이 기록된 해시 그대로인가 |
| `npm run check:schema -- --terra <path>` | 그 사본이 Terra의 원본과 바이트까지 같은가 |
| `terra module pack <dir>` | Scene 무결성과 포장이 실제로 열리는지 (**권위**) |

앞의 셋은 이 저장소만으로 돌고, 마지막 하나는 Terra 체크아웃이 필요하다. CI도 같은 선으로
갈라져 있다 — `validate` 잡은 항상 돌고, `pack` 잡은 `TERRA_CHECKOUT_TOKEN`이 있을 때만
돈다. 없으면 건너뛰되 **건너뛴 사실을 남긴다.**

## Terra와의 관계

| | 어디 |
| --- | --- |
| 레이아웃 규약의 원본 | Terra `module/README.md` |
| Manifest v2 스키마의 소유자 | Terra `terra-module-runtime` (여기 사본은 [`schemas/`](schemas/)) |
| 런타임 권위 | Terra의 Go 검증기 — 스키마가 표현 못 하는 존재 규칙은 그쪽이 안다 |
| 배포 | tree가 레지스트리다 — `pack` → `publish` → subtree가 스스로 설치한다 |

이 방향은 한쪽으로만 흐른다. **modules가 Terra를 참조하고, Terra는 여기를 참조하지 않는다.**
Terra 쪽이 `module/`을 빌드·테스트 입력으로 읽는 자리(역의존)를 끊는 것이 저장소 분리의
유일하게 남은 선행 조건이고, 그 목록은 Terra의
`docs/reports/module-framework-conformance-audit-2026-09-21.md` §8이 소유한다.
