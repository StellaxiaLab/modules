---
title: "Terra 모듈 저장소"
doc_type: "readme"
scope: "repository"
target: "stellaxialab/modules"
status: "active"
version: "v0.3"
last_updated: "2026-10-01"
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
> **접두사는 `lab.stellaxia.*` 다** (2026-09-23 확정). 경계는 저장소도 소유자도 아니라
> **배포 경로**다(Terra `docs/architecture/ADR-MD-002-module-id-prefix-ownership.md` §2-6):
>
> | 배포 경로 | 접두사 |
> | --- | --- |
> | 제품 동봉 (`build-release` → 설치기) | `io.terra.*` |
> | **tree 레지스트리** (`pack` → `publish` → 설치) | **자기 도메인 역순** — 이 조직은 `lab.stellaxia` |
>
> 이 저장소의 모듈은 tree 로 나가는 쪽이므로 `lab.stellaxia.*` 다. `io.terra.*` 는 허용
> 목록이 아니라 **예약어**여서, 그 접두사로 tree 배포를 하려는 주체는 Terra 프로젝트
> 자신을 포함해 전부 거부된다 — `GrantPrefix` 와 publish 양쪽에서 `PREFIX_RESERVED`.
>
> 접두사를 발급받지 않고 `publish` 하면 `PREFIX_NOT_OWNED`(exit 20)로 선다.

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

> [!NOTE] 예약 접두사를 단 모듈은 이제 여기 없다 (2026-09-23)
> 둘이 있었고 둘 다 정리됐다. 길이 서로 달랐던 것이 §2-6을 그대로 보여 준다.
>
> | 모듈 | 어떻게 정리됐나 |
> | --- | --- |
> | `io.terra.scene.terra` | **코어로 돌아갔다.** 제품 동봉으로 나가므로 `io.terra.*`가 맞는 칸이다 — 예외를 둔 것이 아니라 배포 경로가 바뀌어 접두사가 다시 맞게 됐다 ([modules#9](https://github.com/StellaxiaLab/modules/pull/9) · [Terra#80](https://github.com/StellaxiaLab/Terra/pull/80)) |
> | `io.terra.scene.hello` | **개명했다** → `lab.stellaxia.scene.hello`. tree 레지스트리로 나가므로 자기 도메인 역순이 맞다. 게시 전이라 비용이 0이었다 |
>
> 그래서 지금 이 저장소에 있는 모듈은 **`publish`로 나갈 수 있다.**

> [!IMPORTANT] 그리고 2026-09-30에 `io.terra.*`가 **돌아왔다** — 규칙이 바뀐 것이 아니다
> 이주(분리 검토 Phase E)가 코어의 `module/`에서 **11개**를 가져왔고 전부 `io.terra.*`(와
> `dev.terrallo`)다. 위 표와 어긋나 보이지만 어긋나지 않는다 — **저장소가 경계가 아니기
> 때문이다.** §2-6이 정하는 것은 *배포 경로*이고, 이 11개는 여전히 **제품 동봉**으로 나간다:
> 코어가 `bundled-modules.json`으로 선언하고 릴리스 자산에서 받아 번들에 싣는다.
>
> 그래서 이 저장소는 이제 **두 경로의 소스를 함께 들고 있다.**
>
> | 여기 있는 모듈 | 어떻게 나가나 | 접두사 |
> | --- | --- | --- |
> | 이주해 온 11개 | **제품 동봉** — 코어가 선언하고 릴리스에서 받아 번들에 싣는다 | `io.terra.*` · `dev.terrallo` |
> | `lab.stellaxia.scene.hello` · `lab.stellaxia.node-gui` | **tree 레지스트리** — `pack` → `publish` → 노드가 설치 | `lab.stellaxia.*` |
>
> `publish`는 여전히 `io.terra.*`를 `PREFIX_RESERVED`로 거절하고, **그것이 맞다** — 동봉
> 모듈은 publish로 나가지 않는다. 새로 만드는 모듈이 어느 접두사를 쓸지는 위 표가 그대로
> 정한다: tree로 배포할 것이면 `lab.stellaxia.*`다.

### 셸만은 제3자가 가져갈 수 없다

**base 역할**(노드의 기본 화면)을 가질 수 있는 Scene id는 `io.terra.scene.<product>`와
`io.terra.scene.terra`뿐이다. 게이트웨이의 `baseConvention`이 그것을 본다 — *"어디서나 돈다"*가
*"어디서나 셸을 갈아치운다"*가 되지 않게 하는 자리다.

그 규칙은 그대로이고, 대상만 옮겼다. `io.terra.scene.terra`는 Terra 코어의
`module/common/`에 살고, `io.terra.scene.<product>` 쪽은 **오늘 출하되는 것이 하나도 없다** —
`io.terra.scene.leaf`·`io.terra.scene.tree`가 삭제되고 통합 셸 하나가 그 자리를 대신했다
([Terra#80](https://github.com/StellaxiaLab/Terra/pull/80)).

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

## 독립 빌드 (초안)

> [!NOTE]
> 전환 중인 절차다. 설계 문서 `module-independent-repos`(작업 M-1~M-8)가 정한다.
> Go 모듈 빌드·시험까지는 클론만으로 된다. 포장·Scene 마운트·스키마 원본 대조는 아직 Terra 체크아웃이 필요하고
> Terra 쪽 CI 몫이다 — 아래 표가 그 경계다.

### Go 모듈 경로

모듈의 Go 경로는 디렉터리 구조 그대로다: `github.com/StellaxiaLab/modules/<common|leaf|tree>/<module-id>`
(예: `github.com/StellaxiaLab/modules/leaf/io.terra.file`). `go.mod`는 각 모듈의 `src/`에 있다.
이 경로는 모듈끼리 서로의 패키지를 부를 때와 `go.mod`의 `module` 줄에만 쓰이고, 어디에서도 내려받지 않는다.

### 클론 한 번으로 (M-2 ~ M-6 이후)

Go 모듈 10개는 공개 `terra-sdk` · `terra-agent`의 `v0.1.0` 태그를 **버전으로** require하고 Terra를 가리키는 `replace`는
없다. 빈 머신에서 이 저장소를 클론하는 것만으로 14개 모듈의 검증·빌드·시험이 돈다.

```bash
git clone https://github.com/StellaxiaLab/modules && cd modules
npm ci
npm run validate && npm run check:schema    # 매니페스트·배치, 스키마 사본의 자기 해시
npm run build && npm run test               # Go 모듈 10개: go build / go test (Go 1.25 필요)
npm run build:web && npm run test:web       # 웹 화면을 가진 모듈
```

| 하는 일 | 필요한 것 |
| --- | --- |
| 매니페스트·배치 검증, 스키마 사본 해시 | 이 저장소만 (Node 24) |
| 웹 모듈 빌드·시험 | 이 저장소만 |
| Go 모듈 빌드·시험 | 이 저장소 + Go 모듈 프록시(`terra-sdk`, `terra-agent` 태그) — **Terra 불필요** |
| 포장(`terra module pack`) · Scene 마운트 · 스키마 원본 대조 · Master 계약 대조(treebench 2건) | **Terra 체크아웃** — Terra 쪽 CI 몫 (아래 "검증" 절의 박스). `terra` CLI는 Terra 소스에서 굽는다 |
| 릴리스(`.tmod` 구워 올리기) | Terra 체크아웃과 `TERRA_CHECKOUT_SSH_KEY` — 태그를 찍을 때만 |

## 검증

| 명령 | 보는 것 |
| --- | --- |
| `npm run validate` | 매니페스트 형식(Manifest v2), 배치 규약 L-1~L-10, 참조 경로의 실재 |
| `npm run check:schema` | 벤더링한 스키마 사본이 기록된 해시 그대로인가 (`--self-only` — 원본 대조는 하지 않는다고 **명시**한 것) |
| `npm run check:schema -- --terra <path>` | 그 사본이 Terra의 원본과 바이트까지 같은가 (Terra 체크아웃 필요) |
| `npm run build` | Go 소스를 가진 모듈이 선언한 타깃으로 굽히는가 — **Terra 불필요** |
| `npm run test` | Go 소스를 가진 모듈의 **시험이 도는가** — `go test` 와 goroutine 을 가진 패키지의 `-race`. **Terra 불필요**; `--terra <path>`를 주면 Terra의 Master 계약을 읽는 시험(treebench 2건)도 돈다 |
| `npm run build:web` | 웹 화면을 가진 모듈의 `web/`을 `ui/`로 굽고, 앱 entry가 생겼는지 · 자리 표시자가 아닌지 |
| `npm run test:web` | 그 모듈의 웹 시험(`web/package.json`의 `scripts.test`)이 도는가 |
| `npm run test:scenes -- --terra <path>` | 출하 Scene 이 Terra 의 **실 런타임에서 마운트되는가** — `pack` 이 보는 정적 무결성 너머 (분리 검토 G-23) |
| `terra module pack <dir>` | Scene 무결성과 포장이 실제로 열리는지 (**권위**) |
| `npm run pack -- --cli <terra> --terra <path> --tag <tag>` | 저장소 전체를 타깃별로 포장하고 릴리스 목록을 낸다 |

`validate` · `check:schema` · `build` · `test` · `build:web` · `test:web`은 이 저장소만으로 돌고,
`test:scenes` · `pack` · `check:schema -- --terra`는 Terra 체크아웃이 필요하다. CI는 앞의 것만 본다 —
`validate` · `web` · `go` 세 잡이 항상 돌고 **시크릿이 하나도 필요 없다**(`TERRA_CHECKOUT_SSH_KEY` 제거, M-5·M-6).

> [!IMPORTANT]
> **이 저장소의 CI가 더 이상 보지 않는 것** — 예전의 `pack` 잡이 보던 세 가지는 Terra의 코드가 있어야 서는
> 검사(`terra` CLI는 Terra 소스에서 굽고, Scene 마운트 시험은 Terra의 npm 의존과 `shipped-scenes.test.ts`를 쓴다)라서
> 뺐다. **권위는 Terra 쪽 CI로 간다:**
>
> | 검사 | 부르는 법 (Terra 쪽 CI가 이 저장소를 체크아웃한 뒤) |
> | --- | --- |
> | `terra module pack` — Scene 무결성, 포장이 열리는지 | `npm run build && npm run pack -- --cli <terra> --terra <terra> --tag <tag>` |
> | 출하 Scene의 실 런타임 마운트 (G-23) | `npm run test:scenes -- --terra <terra>` |
> | 스키마 사본 ↔ Terra 원본 바이트 대조 | `npm run check:schema -- --terra <terra>` |
> | Terra Master 계약 ↔ treebench 생성물 대조 | `npm run test -- --terra <terra>` |
> | Terra 계약 ↔ node-gui의 Master 위임 표(`master-delegated.js`) 대조 | `node common/lab.stellaxia.node-gui/web/tools/gen-master-delegated.mjs --terra <terra> --check` |
>
> 이 PR 이후 modules의 PR은 위 다섯 가지를 **이 저장소 안에서는 확인받지 못한다.** Terra 쪽 CI가 이 저장소의
> main(또는 PR 브랜치)을 받아 돌려야 이 공백이 닫힌다. 릴리스(`release.yml`)는 태그를 찍을 때 `terra` CLI로
> `.tmod`를 굽기 때문에 **아직 Terra 체크아웃(`TERRA_CHECKOUT_SSH_KEY`)이 필요하다** — Terra가 `terra` CLI를 공개
> 릴리스 자산으로 내면 그 의존도 사라진다.

`npm run test`가 있는 이유는 **이주가 그것을 떨어뜨렸기 때문**이다(분리 검토 G-14). 모듈이
Terra 안에 있을 때는 Terra의 CI가 `git ls-files '*go.mod'`로 저장소의 모든 Go 모듈을 훑어
시험을 돌리고 있었고, 모듈이 여기로 오면 그 훑기에서 **말없이 빠진다** — 없어진 경로를 세지
않으므로 코어 CI는 그대로 초록이다. `npm run build`로는 대신할 수 없다: 컴파일이 되는지만
본다. 첫 실행이 바로 하나를 잡았다 — `io.terra.treebench`가 Master의 계약을 Terra 트리
기준 상대경로로 읽고 있었다(G-15). 그래서 시험 환경에는 `--terra`를 주면 `TERRA_CHECKOUT`이 함께 간다.

> 옛 처분(참고): `pack` 잡은 시크릿이 없을 때 PR·수동 실행에서는 warning으로 건너뛰고 `main` 푸시에서는 실패했다.
> 지금은 그 잡이 이 저장소에 없다(위 박스). 대신 `check-schema-drift`는 **방식을 고르지 않으면 실패한다** — `--terra`로
> 원본과 대조하거나 `--self-only`로 "대조를 안 한다"를 명시해야 하고, 인자 없이 조용히 건너뛰지 않는다.
> Terra 없이 도는 `npm run test`가 빼는 시험은 treebench의 Master 계약 대조 2건뿐이고, 빼는 사실과 이름이 로그에 찍힌다.

`npm run test:scenes`가 있는 이유는 **이 저장소의 머지가 저쪽을 깨뜨렸기 때문**이다(분리 검토
G-23). `terra module pack`은 Scene의 **정적** 무결성을 본다 — fragment가 모르는 store를 부르는지,
id가 기여 id와 같은지. 그것이 통과해도 실 DOM에서 서는 Scene이 있다: `custom` 요소의 실체를
등록하는 것은 제품 앱(호스트 계층)이고 이 저장소는 그것을 모른다. 2026-10-01에 실제로 당했다 —
[modules#17](https://github.com/StellaxiaLab/modules/pull/17)이 `lab.stellaxia.node-gui`를 머지한
것만으로 Terra의 모든 PR과 main이 빨개졌다. 그 Scene의 루트가 `terra.web/frame`이고, 그 component는
`terra-runtime-core`에 산다. Terra의 `shipped-scenes.test.ts`는 `TERRA_MODULES_ROOT`로 **이 저장소의
main을 라이브로** 걷기 때문에, 여기서 머지하는 순간이 저쪽의 빌드 시점이다 — 그리고 그때까지
**양쪽 어디에도 막을 문이 없었다.**

G-14의 거울상이다. G-14는 *이 저장소가 가져온 시험을 아무도 돌리지 않게 되는 것*이었고, 이것은
*이 저장소의 내용이 저쪽 시험을 깨뜨리는 것*이다. 처방은 같다 — **그 시험을 여기서 돈다.** 시험을
사본으로 들고 오지 않는 이유는 그 시험의 권위가 Terra라는 것이다: 사본은 말없이 늙고, 저쪽이
호스트 component를 하나 더 등록하면 사본은 그것을 모른다. 대가 하나는 적어 둔다 — 그 시험은 뿌리를
**둘** 걷는다(저쪽의 `module/`에 남는 base Scene `io.terra.scene.terra`와 이 저장소). 그래서 저쪽
Scene이 깨지면 이 저장소의 PR도 빨개진다. 뿌리를 좁히는 것은 처방이 아니다 — 좁히면 base Scene이
목록에서 **조용히 빠진다.**

> **지금은 릴리스(`release.yml`)만 이 시크릿을 쓴다.** CI(`ci.yml`)는 쓰지 않는다.

그 시크릿은 **`StellaxiaLab/Terra`의 읽기 전용 deploy key의 개인키**다. PAT가 아닌 이유는
셋이다 — 조직이 fine-grained PAT를 허용해야 하고, 허용해도 만료 갱신이 따라오며, 발행한
사람에게 묶인다. deploy key는 저장소 하나·읽기 전용이고 만료가 없다. 세우는 순서:

```bash
ssh-keygen -t ed25519 -N '' -C 'modules-ci@StellaxiaLab' -f terra-ci
```

| 산출물 | 어디에 |
| --- | --- |
| `terra-ci.pub` (공개키) | `StellaxiaLab/Terra` → Settings → Deploy keys → Add deploy key. **Allow write access는 끈 채로** |
| `terra-ci` (개인키) | `StellaxiaLab/modules` → Settings → Secrets and variables → Actions → `TERRA_CHECKOUT_SSH_KEY` |

넣은 뒤 로컬 사본(`terra-ci`)은 지운다 — 개인키가 두 곳에 있을 이유가 없다.

### Go 소스를 가진 모듈은 굽고 나서 포장한다

`terra module pack`은 **바이너리 반쪽까지 본다.** `entrypoints.process`에 타깃을 적고
`bin/`이 빈 모듈은 `MODULE_ENTRYPOINT_MISSING`으로 거절된다. 소스 트리의 `bin/`은 원래
비어 있으므로(빌드 산출물이다) 순서가 정해져 있다:

```bash
npm run build                              # src/ → bin/<target>/ (Terra 불필요)
terra module pack leaf/com.acme.hello      # 그다음에 포장
```

실측으로 양쪽을 확인했다 — `bin` 없이 포장하면 `MODULE_ENTRYPOINT_MISSING`, 굽고 나면
통과한다.

> 이 절의 `--terra`는 이제 선택이다. 예전에는 모듈의 `src/go.mod`가 `terra-module-sdk` 등을 Terra 안의
> 상대경로로 `replace`했고 그 SDK가 공개 레지스트리에 없어서 Terra 체크아웃이 빌드에 필요했다. 지금은 모듈이
> 공개 `terra-sdk` · `terra-agent`를 버전으로 require하므로(M-2·M-3) `GOWORK=off`로 모듈 하나하나가 자기
> `go.mod`/`go.sum`만으로 선다. `--terra`를 주면 예전처럼 임시 `go.work`로 묶는다.

Go 소스가 없는 모듈(Scene·extension)은 빌드할 것이 없고, 스크립트가 그 사실을 적고 통과한다.

### 웹 화면을 가진 모듈도 굽고 나서 포장한다

`terra module new --web`이 굽는 모양 — 화면 소스는 `web/`, 빌드 결과는 `ui/`(Vite
`outDir: '../ui'`) — 을 따르는 모듈이 있다. `web/`은 포장 허용 목록 밖이라 출하되지 않으므로
**포장되는 것은 `ui/`뿐이고**, `ui/`는 `bin/`처럼 빌드 산출물이라 커밋하지 않는다.

```bash
npm run build:web                                   # web/ → ui/ (npm ci 후 npm run build)
npm run test:web                                    # web/ 의 scripts.test
terra module pack common/lab.stellaxia.node-gui     # 그다음에 포장
```

여기에는 Go 쪽과 다른 함정이 하나 있다. **`terra module pack`은 `gui.apps`의 entry를 보지
않는다** — `ui/`가 아예 없어도, 스캐폴드가 첫 빌드 전에 두는 자리 표시자(*"웹 빌드가 아직
없습니다"*)만 있어도 `VERIFIED true`로 포장되고, 설치하면 빈 화면이 뜬다(실측). Go 모듈처럼
`MODULE_ENTRYPOINT_MISSING`으로 서 주지 않으므로 이 저장소가 두 자리에서 대신 본다:
`build-web`이 구운 직후에, `pack-modules`가 포장 직전에. 그래서 굽기를 빠뜨린 릴리스는
조용히 나가지 않고 선다.

검증기(`npm run validate`)는 그 entry의 **모양만** 본다 — 굽기 전에는 없는 것이 정상이다
([`docs/layout.md`](docs/layout.md) L-6). 웹 빌드에는 Terra 체크아웃이 필요 없어서 CI의 `web`
잡은 시크릿 없이 돌고, 포크에서 온 PR에서도 화면 소스가 깨졌는지는 보인다. 의존은 모듈마다
`web/package-lock.json`으로 잠그고 `npm ci`로만 받는다 — 잠금 없이 굽는 릴리스는 같은 소스로
다른 결과를 낸다.

## 릴리스

모듈은 **GitHub 릴리스 자산**으로 나간다(분리 검토 D-21). 코어는 그것을 받아 전개할 뿐
**컴파일하지 않는다** — `pack`이 이미 `integrity.process.<target>`을 찍어 두기 때문이다.
그래서 코어 릴리스 빌드가 모듈 소스도, Go 툴체인도, 이 저장소의 체크아웃도 필요로 하지 않는다.

찍는 것은 사람이다:

```bash
git tag v2026.09.29
git push origin v2026.09.29        # 같은 날 다시 찍어야 하면 v2026.09.29-2
```

태그가 날짜형인 이유 — 모듈별 버전은 매니페스트가 이미 들고 있다. 저장소 태그가 말해야
하는 것은 "언제 찍은 묶음인가" 하나뿐이고, 모듈 여럿의 semver를 하나로 합치면 그 숫자는
거짓말이 된다.

`.github/workflows/release.yml`이 받아서 validate → 스키마 대조 → CLI 빌드 → `bin/` 굽기
→ Go 시험 → `ui/` 굽기 → 웹 시험 → 타깃별 포장 → 개수 대조 → 발행을 순서대로 돈다.

### 타깃마다 따로 굽는다

`terra module pack`은 기본으로 `bin/` 전체를 싣는다. 타깃 셋을 선언한 모듈을 안 좁히고
포장하면 **자산 하나가 2.9배**가 되고(실측: 4.9 MB → 14.3 MB), 리눅스 노드가 윈도우·arm
바이너리까지 받는다. 그래서 `--target`으로 좁혀 타깃마다 하나씩 낸다.

| 모듈 | 자산 |
| --- | --- |
| 타깃을 선언한 모듈 | `<id>-<version>-<target>.tmod` — 타깃 수만큼 |
| Scene·extension (타깃 없음) | `<id>-<version>.tmod` — 하나 |

### 코어는 `modules.json`을 읽는다

자산 이름은 **사람이 읽는 용도**다. 코어가 이름을 규약으로 조립하면 그 이름이 두 저장소
사이의 계약이 되고, 여기서 한 글자만 바꿔도 코어가 깨지는데 그 깨짐은 다음 릴리스 때까지
안 보인다. 그래서 릴리스에 목록을 같이 싣는다:

```json
{
  "schemaVersion": 1,
  "tag": "v2026.09.29",
  "terraCommit": "7ef21843…",
  "moduleCount": 1,
  "assetCount": 3,
  "modules": [
    { "id": "…", "version": "…", "kind": "…", "tier": "leaf",
      "products": ["leaf"],
      "assets": [{ "target": "linux-amd64", "name": "….tmod", "sha256": "…" }] }
  ]
}
```

`terraCommit`이 **버전 스큐의 대조 자리**다(G-2) — 코어가 빌드할 때 자기 커밋과 맞춰 볼 수
있다. `products`는 매니페스트가 적어 둔 것을 그대로 싣는다. 다만 **무엇을 동봉할지의 권위는
코어의 선언**이다(D-22): `products`는 "어디서 돌 수 있나"이지 "어느 번들에 들어가야 하나"가
아니다.

### 반쪽 릴리스를 만들지 않는다

세 겹으로 막는다. 모듈 하나가 자산을 못 내면 목록을 **쓰지 않고** 멈추고, 워크플로가
디스크의 모듈 수와 목록의 수를 **따로 세어** 대조하며, 발행은 draft로 만들어 전부 올린
**뒤에** 한다. 업로드가 중간에 실패해도 공개된 반쪽 릴리스가 남지 않는다.

코어에서 이것이 왜 필요한지는 실측이 있다 — 번들 모듈이 15개에서 5개로 줄었는데 빌드가
`exit 0`이었다(분리 검토 G-10).

### 아직 서명하지 않는다

`terra module pack`에 `--sign-key`가 있지만 쓰지 않는다. 서명은 **검증하는 쪽이 신뢰 앵커를
갖고 있어야** 의미가 있는데 코어 설치기에 그 앵커가 아직 없다. 서명만 붙이고 검증하지 않으면
보안이 아니라 장식이고, "서명돼 있으니 안전하다"는 오해를 만든다. 지금은 `modules.json`의
sha256으로 덮는다.

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
