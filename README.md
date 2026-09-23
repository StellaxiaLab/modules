---
title: "Terra 모듈 저장소"
doc_type: "readme"
scope: "repository"
target: "stellaxialab/modules"
status: "active"
version: "v0.1"
last_updated: "2026-09-21"
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

> [!NOTE]
> 플랫폼이 소유하는 **kind 둘**(`application` · `runtime`)은 여기 오지 않는다. 오늘 그
> kind 로 출하된 것이 `io.terra.player` · `io.terra.scene-runtime` ·
> `io.terra.virtual-device` 셋이고, `terra module new --kind application|runtime` 이
> 이유를 말하며 거절한다.
>
> 거절하는 것은 **kind 이지 이름이 아니다** — `terra module new io.terra.player` 는
> 그냥 통과한다. 경계는 도구가 아니라 사람이 지킨다.

## 접두사 — 어떤 id를 쓰나

**배포 경로가 정한다.** 누가 만들었는지가 아니다
(Terra `docs/architecture/ADR-MD-002-module-id-prefix-ownership.md` §2-6).

| 어떻게 나가나 | 접두사 |
| --- | --- |
| **제품 동봉** — 릴리스 빌드가 번들에 싣고 설치기가 깐다 | `io.terra.*` |
| **tree 레지스트리** — `pack` → `publish` → 노드가 설치 | **자기 도메인 역순** |

`io.terra.*`는 허용 목록이 아니라 **예약어**다. 외부 조직이 막혀 있는 것이 아니라, 그 접두사로
tree 배포를 하려는 **모든 주체**가 막힌다 — Terra 프로젝트 자신을 포함해서.

```text
terra module prefix grant io.terra.acme   →  PREFIX_RESERVED   (발급 자체를 거부)
terra module publish io.terra.foo.tmod    →  PREFIX_RESERVED   (게시 경로에서 한 번 더)
terra module publish com.acme.foo.tmod    →  PREFIX_NOT_OWNED  (접두사를 아직 등록하지 않았다)
```

### 다른 조직이 모듈을 내는 길

도메인을 뒤집어 접두사로 쓴다 — `acme.com` → `com.acme`, `terrallo.dev` → `dev.terrallo`.
Java 패키지·안드로이드 앱 ID와 같은 규칙이고, **도메인을 가진 쪽이 그 접두사를 가진다.**

```bash
terra module prefix grant com.acme            # tree 운영자가 한 번 등록한다
terra module new com.acme.hello --owner leaf --root . --kind service
terra module pack leaf/com.acme.hello --out /tmp/hello.tmod
terra module publish /tmp/hello.tmod --policy recommended
```

등록된 접두사는 그 cluster 안에서 유일하고, 게시자의 신원으로 감사에 남는다. 승격(promote)은
id를 바꾸지 않는다 — 바꾸면 digest와 서명이 깨지기 때문이다.

### 이 저장소의 접두사는 `lab.stellaxia`다

StellaxiaLab이 **tree로 배포할** 새 모듈은 `lab.stellaxia.*`를 쓴다. 우리가 만든 것이어도
`io.terra.*`를 쓸 수 없다 — 예약은 만든 사람이 아니라 배포 경로를 보기 때문이다.

> [!IMPORTANT] 지금 여기 있는 둘은 예외이고, 그 대가가 있다
> `io.terra.scene.terra`와 `io.terra.scene.hello`는 예약 접두사를 달고 있다. 플랫폼 모듈의
> 정본을 옮겨 온 것과, 플랫폼이 만든 GUI 시험대다. 그래서 **이 둘은 `publish`로 나갈 수 없다** —
> 노드에 닿는 길은 사이드로드(`terra module install <tmod> --root`)나 제품 번들뿐이다.
> 어느 쪽으로 정리할지는 Terra의 분리 검토 문서 §7.1이 갈래 둘로 적어 두었다.

### 셸만은 제3자가 가져갈 수 없다

**base 역할**(노드의 기본 화면)을 가질 수 있는 Scene id는 `io.terra.scene.<product>`와
`io.terra.scene.terra`뿐이다. 게이트웨이의 `baseConvention`이 그것을 본다 — *"어디서나 돈다"*가
*"어디서나 셸을 갈아치운다"*가 되지 않게 하는 자리다.

임시 조치다. 서명과 Product Policy가 들어오면 이름 규약 대신 그것이 판정하고, 그때 제3자도
셸을 낼 수 있게 된다. 지금은 서명된 모듈이 0개라 이름이 대역을 서고 있다.

## 모듈 하나 만들기

뼈대는 손으로 쓰지 않는다. Terra 체크아웃에서 CLI를 굽고, 그것이 굽게 한다.

```bash
# 1. CLI 준비 (Terra 체크아웃에서 한 번)
#    main 은 모듈 루트가 아니라 cmd/terra 에 있다.
cd <terra>/products/common/apps/terra-cli && go build -o ~/bin/terra ./cmd/terra

# 2. 뼈대 — 저장소 루트에서, 소유권 루트를 이름으로 지정해서
#    --owner 가 leaf/·common/·tree/ 중 어디에 놓일지 정하고,
#    --root . 이 이 저장소에 없는 module/ 한 겹을 빼 준다.
#    id 는 위 "접두사" 절을 따른다 — io.terra.* 는 예약이다.
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
