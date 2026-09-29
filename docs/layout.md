---
title: "모듈 저장소 레이아웃 규약"
doc_type: "contract"
scope: "repository"
target: "stellaxialab/modules"
status: "active"
version: "v1.0"
last_updated: "2026-09-21"
---

# 모듈 저장소 레이아웃 규약

이 문서는 규약 자체이고, [`tools/validate-modules.mjs`](../tools/validate-modules.mjs)가 그 집행자다.
규칙마다 붙은 번호(`L-1` …)는 검증기가 내는 진단에 그대로 찍힌다 — 빨간 줄에서 이 문서의
어느 절을 읽어야 하는지가 바로 나오게 하기 위해서다.

> [!IMPORTANT]
> 레이아웃의 원본은 이 저장소가 아니라 Terra의 `module/README.md`다.
> 여기는 그 계층을 **미러**한다 — 모듈이 두 저장소 사이를 오가도 경로 모양이 바뀌지 않게.
> 규약이 Terra 쪽에서 바뀌면 이 문서가 따라간다.

## 1. 계층

```text
<repo>/
├─ common/
│  └─ <module-id>/
├─ leaf/
│  └─ <module-id>/
│     ├─ module.json
│     ├─ bin/
│     │  ├─ linux-amd64/
│     │  └─ windows-amd64/
│     ├─ config/
│     ├─ contracts/
│     │  └─ api/
│     │     └─ terra-api.json
│     ├─ scene/            # GUI 기여(Scene)
│     ├─ ui/               # Scene Extension 번들, 창 모드 앱의 정적 자산
│     ├─ src/              # 소스 (포장에서 제외된다)
│     ├─ licenses/
│     └─ signature/
└─ tree/
   └─ <module-id>/
```

`common` · `leaf` · `tree`를 **소유권 루트**라고 부른다. Terra의 `module/` 아래와 같은 이름,
같은 깊이다. 다른 점은 `module/`이라는 한 겹이 없다는 것뿐이다 — 저장소 자체가 그 역할이다.

## 2. 규칙

| ID | 규칙 | 등급 |
| --- | --- | --- |
| **L-1** | 모듈은 소유권 루트 바로 아래 한 단계에만 있다. 루트 바로 아래에는 모듈 디렉터리와 `README.md`만 둔다 | 오류 |
| **L-2** | 디렉터리 이름과 `module.json`의 `id`는 같다 | 오류 |
| **L-3** | `id`는 저장소 안에서 유일하다 | 오류 |
| **L-4** | `compatibility.products`는 소유권 루트가 정한다 | 오류 |
| **L-5** | `module.json`은 Manifest v2 스키마를 통과한다 | 오류 |
| **L-6** | 매니페스트가 가리키는 경로는 패키지를 벗어나지 않고, 소스인 것은 실재한다 | 오류 |
| **L-7** | `kind`가 요구하는 실행 선언이 있다 | 오류 |
| **L-8** | 최상위 항목은 포장 대상이거나 개발 전용이다 | 경고 |
| **L-9** | 모듈이 하나도 없으면 실패한다 | 오류 |
| **L-10** | `scene/` 안은 계약과 표면 두 층으로 가른다 | 경고 |

### L-4 — 소유권 루트가 products를 정한다

| 루트 | `compatibility.products` |
| --- | --- |
| `common/` | `["leaf", "tree"]` |
| `leaf/` | `["leaf"]` |
| `tree/` | `["tree"]` |

추론이 아니라 **실측이다.** Terra에 출하된 21개 모듈이 예외 없이 이 표와 같다.
배치와 선언이 어긋나면 둘 중 하나가 거짓말이므로, 검증기가 어느 쪽인지 묻지 않고 거절한다.

### L-6 — 실재를 요구하는 경로와 모양만 보는 경로

| 자리 | 검사 |
| --- | --- |
| `contracts.*` | 모양 + **실재** |
| `entrypoints.scene` | 모양 + **실재** |
| `contributions.…​.entry` (기여가 지목하는 번들) | 모양 + **실재** |
| `entrypoints.process` · `worker` · `library` · `runtime` | 모양만 |

컴파일 산출물(`bin/<target>/…`, `dist/…`)은 릴리스 빌드가 낳는다. 소스 트리에 없는 것이 정상이고,
그것까지 요구하면 출하 모듈 21개 중 18개가 빨개진다 — 그건 발견이 아니라 소음이다.
반대로 계약 JSON·Scene·기여 번들은 사람이 써서 커밋하는 것이므로 없으면 그건 빠진 것이다.

> 이 경계를 Terra의 출하 모듈 전체에 돌렸을 때 걸린 것은 `io.terra.scene-studio` 하나
> (`ui/index.html`이 Studio 빌드의 스테이징 산출물)였고, 적합성 판정서
> (`docs/reports/module-framework-conformance-audit-2026-09-21.md` §5.2)가
> 그 모듈을 독립적으로 "UI 스테이징 동반 필요"로 분류해 두고 있었다.

### L-7 — kind가 요구하는 실행 선언

`scene`은 Player가 읽는 데이터 패키지라 entrypoint가 없어도 되고, `adapter`는 감싸는 외부
서비스를 `contributions.service`가 지목하면 되고, `extension`은 `contributions.gui.extensions`가
번들을 지목하면 된다. **그 밖의 kind는 entrypoint를 최소 하나 선언한다.**

권위는 Go 검증기다. 스키마는 구조를 고정할 뿐 "무엇이든 구현을 지목해야 한다"는 존재 규칙을
표현하지 못한다. 여기 검증기는 그 규칙의 축소판을 들고 있고, 최종 판정은 `terra module pack`이 한다.

### L-8 — 무엇이 포장되는가

`terra module pack`은 화이트리스트로 담는다: `module.json` · `contracts/` · `ui/` · `bin/` ·
`config/` · `scene/`. 소스 트리에 있어도 되지만 포장되지 않는 것: `src/` · `README.md` ·
`licenses/` · `signature/` · 점으로 시작하는 것.

그 밖의 최상위 항목은 **경고**로 알린다. 빌드 보조물이라 포장되지 않는 것이 맞을 수도 있고,
배포에 필요한데 빠질 자리일 수도 있어서 — 판단은 사람이 한다.

### L-9 — 빈 집합은 조용히 통과하지 않는다

모듈이 0개면 검증기가 실패한다. `--allow-empty`로만 통과한다.

Terra의 릴리스 빌드에는 `module/`이 비면 **오류도 경고도 없이 모듈 0개 번들이 나가는** 자리가
있다(`Get-WorkspaceModuleSource`가 조용히 빈 목록을 돌려주고 `Copy-ExternalModules`가
없는 디렉터리를 넘긴다 — 검토 문서의 G-7). 같은 모양의 사고를 이 저장소에서는 여기서 막는다.

### L-10 — Scene 안쪽의 두 층

```text
scene/
├─ scene.json              두 층을 묶는 자리
├─ contract/               화면을 모른다
│  ├─ functions/
│  └─ stores/
└─ surface/                Operation 도 Gateway 도 모른다
   └─ fragments/
```

**이 모양이 정본이다.** 고른 이유는 취향이 아니라 **누가 그것을 지키느냐**다 —
`terra gui new` 와 `terra module new` 가 이 모양으로 굽고, 굽고 나서 자기 출력을 되읽어
층이 섞이면 그 자리에서 실패한다(`verifyScenePackage`). 문서에만 적힌 규칙은 사본처럼
늙지만, 도구가 든 규칙은 어긋나는 순간 빨개진다.

다른 모양이 **깨지는 것은 아니다.** 로더는 `scene.json` 이 적은 경로를 그대로 읽으므로
평면 배치도 로드되고 `terra module pack` 도 통과한다. 그래서 이것은 "틀렸다"가 아니라
"둘이 섞이면 판정할 근거가 없다"의 문제이고, 근거를 여기 적어 둔다.

> **왜 아직 오류가 아닌가 — 그리고 승격 조건은 이미 충족됐다**
>
> 이 절을 쓸 때의 사정은 *"들어오는 첫 모듈(`io.terra.scene.terra`)이 평면 배치라
> 규칙을 세우자고 이미 도는 모듈을 막을 수 없다"* 였다. 그 사정은 둘 다 끝났다 —
> 그 모듈은 **계층형으로 다듬어져 들어왔고**, 이후 Terra 코어로 돌아갔다
> (게이트웨이가 base 역할을 `io.terra.scene.terra` 라는 id 로만 주기 때문이고,
> 그래서 저장소가 아니라 코어가 그 셸을 소유한다).
>
> 남은 모듈은 계층형 하나뿐이라 `npm run validate` 의 L-10 경고가 **0**이다.
> 이 절이 적어 둔 승격 조건이 그것이었으므로, 오류로 올리는 것을 막는 것은
> 이제 사정이 아니라 **아직 아무도 올리지 않았다는 사실**뿐이다.

## 3. 이 저장소가 볼 수 없는 것

검증기는 **매니페스트와 배치**를 본다. 다음은 보지 않는다.

| 보지 않는 것 | 권위 |
| --- | --- |
| Scene 무결성 — fragment가 모르는 store·function을 부르는지, `scene.json`의 id가 기여 id와 같은지 | `terra module pack` |
| Scene 안쪽의 **층 규칙** — `pack` 도 이것은 보지 않는다(스캐폴더의 자기 검증이다). 그래서 L-10 이 여기 있다 | 이 저장소 |
| 포장이 실제로 열리는지 — 설치기와 같은 검사로 자기 출력을 되여는 것 | `terra module pack` |
| 계약 JSON의 내용이 Terra API Contract 표준을 지키는지 | Terra 쪽 계약 검증 |

여기서 다시 구현하면 사본이 하나 더 생기고, 사본은 말없이 늙는다. 그래서 CI의 `pack` 잡이
Terra를 체크아웃해 진짜 `terra module pack`을 부른다 — Terra의 읽기 전용 deploy key
(`TERRA_CHECKOUT_SSH_KEY`)가 있을 때다. 없으면 PR에서는 건너뛰되 **warning**으로 남기고,
`main` 푸시에서는 **실패한다**: main은 이 저장소가 "검증됐다"고 말하는 자리다.

## 4. 벤더링한 스키마

`schemas/manifest-v2.schema.json`은 이 저장소가 쓴 것이 아니다. Terra의
`terra-module-runtime`이 소유하고, 출처·커밋·해시는 [`schemas/PROVENANCE.json`](../schemas/PROVENANCE.json)에 적혀 있다.

사본을 손으로 고치지 않는다. 원본이 바뀌면 다시 복사하고 `PROVENANCE.json`을 갱신한다.
[`tools/check-schema-drift.mjs`](../tools/check-schema-drift.mjs)가 둘을 대조한다 —
Terra 체크아웃이 있으면 원본과 바이트로, 없으면 적어도 기록된 해시와.

## 관련 문서

- [README](../README.md) — 저장소 소개와 명령, 그리고 **접두사**(어떤 id를 쓰나)
- Terra `module/README.md` — 레이아웃의 원본
- Terra `docs/manual/06-usage/modules-develop.md` — 모듈 개발 절차
- Terra `docs/contracts/module-host-http-contract.md` — 모듈이 되기 위해 구현할 것의 전부
- Terra `docs/guides/first-module-tutorial.md` — 첫 모듈 튜토리얼
