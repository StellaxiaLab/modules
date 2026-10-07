---
title: "설치기 연동 범위 — lab.stellaxia.node-gui를 설치기가 원격에서 받아 깐다"
aliases:
  - "node-gui 설치기 연동"
  - "Installer Integration Scope"
doc_type: "scope-decision"
scope: "repository"
target: "stellaxialab/modules"
status: "draft"
version: "v0.1"
last_updated: "2026-10-07"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[모듈 저장소 레이아웃 규약](layout.md)"
  - "[node-gui 모듈 README](../common/lab.stellaxia.node-gui/README.md) — Q-1(확정)"
  - "terra-releases `docs/installer-design.md` — 설치기 재설계(원격 취득 부트스트랩)"
  - "terra-releases `docs/installer-gui-design-brief.md` — 설치기 GUI 브리프"
---

# 설치기 연동 범위 — `lab.stellaxia.node-gui`를 설치기가 원격에서 받아 깐다

> **한 줄 요약** — 설치기 재설계(`terra-releases`)가 이미 "설치 시점에 원격에서 받고, 서명된 카탈로그가 신뢰 루트"로 정해져 있다.
> 이 모듈은 그 길에 **필수 모듈 하나**로 얹으면 되고, `terra module acquire`·`terra module install`을 부르지 않는다.
> 처음 권고(D-1~D-5) 가운데 **D-3만 바뀌고 나머지는 유지**한다. 서명(Q-13)은 이 연동의 선행 조건이 아니다.

## 1. 확인한 것 (2026-10-07)

### 1.1 `terra-releases` — 설치기 재설계 (상태: 초안 v0.1, 구현 전)

| 항목 | 내용 |
| --- | --- |
| 저장소 | `StellaxiaLab/terra-releases` — 공개, 소스 없음. 설치기·코어 아카이브·서명된 카탈로그만 Releases로 나간다 |
| 결정 D-1 | 모듈(`node-gui` 포함)을 **설치 시점에 원격에서 받는다.** 번들에 동봉하지 않는다 |
| 결정 D-4 | 신뢰 루트는 **Terra 서명 키로 서명한 카탈로그**다. GitHub가 아니다. 루트 키(오프라인) → 릴리스 키 인증서 → `release-index.json` → 해시 → 코어·모듈 파일 |
| 카탈로그 v3 | `modules[]`에 `{id, version, target, origin, url, sha256, size, roles, required}`. 만료일·최소 설치기 버전으로 오래된 목록 재생을 막는다 |
| 모듈 선언 | `bundled-modules.json`(코어가 동봉할 것)과 **별개**인 원격 전달 선언(예: `installer-modules.json` — `{id, roles, required, source: modules@<tag>}`). 빌드가 이 modules 저장소 릴리스의 `modules.json`에서 해시를 풀어 카탈로그에 새긴다(Q-8 · Q-10) |
| 실패 처리 | 코어는 설치하고 모듈은 **대기** 상태로 남긴다. 이후 `terra-setup update`, Tree 레지스트리, `terra module install`로 채운다(§4.8) |
| 에어갭 | 풀 번들 변형을 계속 낸다. 카탈로그 `url`이 `file:`이거나 `--source <dir>`이어도 **같은 검증 경로**를 탄다 |
| 모듈 서명 | 1단계는 카탈로그 sha256 + `.tmod` 내부 무결성(`integrity.process.<target>`). 모듈 서명은 2단계로, 같은 루트 키 아래에 둔다(Q-9) |

### 1.2 기존 설치기 (`Terra/products/common/apps/terra-installer`, 코드 읽기)

- **모듈을 원격에서 받는 코드가 없다.** `net/http`는 Master·Gateway의 상태 확인·로그인·노드 삭제에만 쓰인다.
- 번들 모듈은 디스크에 평평하게 펴고(`<id>/module.json`, `versions/<v>/` 없음) 설치 기록을 쓴다 — `origin: "bundle"`, `SelectedVersion`은 비움(`module_install_records.go`).
- 모듈 범위는 `--all-modules` / `--required-modules-only`. 범위를 좁히면 번들이 필수로 표시하지 않은 모듈을 지우고, **설치기가 쓴 기록만** 회수한다(`reconcileModuleScope` · `removeBundleModuleRecords`).
- 의존성 그래프를 일부러 비워 둔다(`go.mod`). 런타임 패키지를 가져오지 않고 필요한 모양만 복제한 뒤 시험으로 묶는 방식이다(`TestInstallRecordMatchesRuntimeStateRecord`).
- `build-release.ps1`의 필수 모듈 가드(`EssentialModuleIds`)는 `io.terra.webapp-host` · `scene-runtime` · `player` · `scene.terra` 넷뿐이다. **node-gui는 없다.**

### 1.3 이 저장소

| 항목 | 값 |
| --- | --- |
| 최신 릴리스 | `v2026.10.06` — `lab.stellaxia.node-gui` **0.4.0**(maingui `a884226`), 타깃 `—`(scene이라 단일 자산) |
| `main`의 모듈 | **0.4.1**(maingui `4ec0685`) — 릴리스보다 한 단계 앞이다 |
| 서명 | 릴리스 `.tmod`는 **서명하지 않는다**(Q-13, `release.yml`). 런타임의 내장 신뢰 키링도 지금 비어 있다(Terra `terra-module-runtime/builtin_keys.json`의 `"keys": []` — 2026-10-07 확인) |
| 호환 | `module.json` — `products: leaf, tree` · `os: linux, windows` (macOS 없음) |
| 저장소 공개 | `StellaxiaLab/modules`는 공개다. `acquire` 코드 주석의 "private라 익명 404"는 더는 맞지 않는다 |

> [!NOTE] `terra-releases` 문서의 Q-1은 낡았다
> 그 문서는 "릴리스 `v2026.10.05`의 node-gui는 0.2.0이라 두 단계 낡았다"고 적었지만, 그 뒤 `v2026.10.06`이 나가서 지금은 **한 단계**(0.4.0 ↔ 0.4.1)다.
> 그 문서의 카탈로그 예시도 `"version": "0.4.0"`이다. 핀을 올릴 때 함께 고친다.

## 2. 결정 — 처음 권고를 어떻게 했나

| ID | 질문 | 처음 권고 | 확인 결과 | **결정** |
| --- | --- | --- | --- | --- |
| D-1 | 서명(Q-13)을 이 연동과 묶을까 | 설치기를 먼저 내고 서명은 나중에 | 신뢰 루트가 **카탈로그 서명**이고, 모듈은 1단계 sha256, 2단계 모듈 서명(Q-9)이다. 설치기는 `terra module install`(서명 요구)을 쓰지 않는다 | **유지.** 묶지 않는다. 1단계는 카탈로그 해시 + `.tmod` 내부 무결성으로 낸다 |
| D-2 | 태그를 고정할까 | 설치기 릴리스마다 고정 | 선언이 `source: modules@<tag>`이고 빌드가 해시를 푼다(Q-10) | **유지.** 설치기(카탈로그) 릴리스마다 고정한다 |
| D-3 | 받기·검증을 어디에 두나 | 설치기 안에 복제(`acquire` 호출 안 함) | 재설계가 설치기에 `internal/fetch`를 두고, **빌드가 해시를 카탈로그에 새긴다.** 설치기는 `modules.json`을 읽지 않는다 | **변경.** 복제할 것은 "모듈 받기"가 아니라 "카탈로그 v3 읽기·검증"뿐이다. `modules.json`을 읽는 쪽은 `build-release`다 |
| D-4 | 못 받으면 | 경고하고 계속 | §4.8이 같은 결론 — 코어 설치, 모듈 대기 | **유지.** 완료 화면에서 "첫 화면이 비어 있다"를 알린다(Q-10). 재시도 길은 `terra-setup update` |
| D-5 | 오프라인 매체에 `.tmod`를 넣을까 | 넣되 번들 모듈로 선언하지 않는다 | 에어갭 풀 번들이 카탈로그 `file:` · `--source` 경로로 같은 검증을 탄다 | **유지, 방식 보정.** node-gui를 번들-평평 경로(`origin: bundle`)로 넣지 않고 카탈로그 경로로 받는다 |

## 3. 범위

### 3.1 범위 안

| 쪽 | 일 |
| --- | --- |
| **이 저장소** | ① 설치기가 핀할 **릴리스 태그를 찍는다**(0.4.1을 담는 새 태그). ② `modules.json`(schemaVersion 1)을 두 저장소 사이의 계약으로 유지한다 — 필드를 바꾸면 `build-release`가 깨진다. ③ 2단계에서 `release.yml`에 `--sign-key`를 켠다(Q-13, 루트 키·내장 키링이 생긴 뒤) |
| **Terra 빌드** | ① `installer-modules.json`(원격 전달 선언)에 node-gui를 `required: true`, `roles: [leaf, tree]`로 선언. ② `build-release`가 modules 릴리스의 `modules.json`에서 해시를 풀어 카탈로그 v3 `modules[]`에 새긴다 |
| **설치기 엔진** | ① 카탈로그 취득·서명·만료 검증 후 `modules[]` 받기(스테이징 → sha256 → `.tmod` 내부 무결성 → 버전 단조 증가 → 원자적 배치). ② 필수 모듈 실패 시 코어만 설치하고 대기 상태 표시. ③ `update`에서 받은 모듈의 기록 정리 규칙(U-1과 함께). ④ 에어갭 `file:` · `--source` |
| **설치기 화면** | S3 "모듈"의 출처 라벨을 `modules 릴리스 · lab.stellaxia.*`로(DR-2), 완료 화면의 "첫 화면이 비어 있다" 경고, 크기·상태 표시를 카탈로그 값으로 |
| **시험** | 새 Linux(leaf · tree 역할) · Windows 설치, 오프라인, 변조된 `.tmod` 거부, 낡은 카탈로그(만료·롤백) 거부, `update`로 0.4.x → 다음 버전, 제거 |

### 3.2 범위 밖

- 다른 모듈(`io.terra.*`)은 지금처럼 번들로 간다. `bundled-modules.json`은 바꾸지 않는다.
- 모듈 센터 GUI와 레지스트리 서버 로직(maingui `module-distribution-gui-spec`).
- 설치 뒤의 자동 업그레이드 정책(Tree의 몫), Android, macOS(이 모듈은 `os: linux, windows`).

## 4. 이 연동이 부르는 영향 (먼저 알아 둘 것)

1. **등록 경로.** node-gui 모듈은 등록 화면(maingui O-5 · O-7)을 싣지 않는다 — 시작 화면의 로그인 박스를 통째로 바꾸고 Terra 셸이 로그인을 받기 때문이다([modules#33](https://github.com/StellaxiaLab/modules/pull/33)). 그래서 **설치기의 등록 방식이 사실상 유일한 GUI 등록 길**이다. `terra-releases` Q-7(설치기가 등록 코드 `tnc_…`를 받을지)은 이 때문에 우선순위가 오른다. 등록 방식 `none`으로 깐 노드는 CLI로 등록해야 한다.
2. **업그레이드 길.** 모듈 서명(2단계)과 내장 신뢰 키링이 갖춰지기 전에는 `terra module install`이 `--dev` 없이 서명 없는 `.tmod`를 받지 않는다. 그동안 설치기로 깐 node-gui의 갱신은 **설치기 `update`(카탈로그)** 로 한다. "직접 파일을 받아 설치하거나 Tree를 통한다"는 길은 2단계가 끝난 뒤에 완전해진다.
3. **설치 기록.** 번들 방식(평평 · `origin: bundle`)과 관리 설치(`versions/<v>/` · `SelectedVersion`)가 다르다. Tree 배포 루프(`moduledistrib`)는 **`Origin=distribution`으로 자기가 쓴 기록만** 되감으므로(주석과 `module.go`의 검사), 설치기가 쓴 node-gui가 Tree에 의해 지워질 위험은 코드로는 보이지 않는다.

## 5. 아직 확인하지 못한 것

- 원격으로 받은 모듈을 설치기가 **번들-평평 경로로 둘지, 관리 설치 모양(`versions/<v>/` + 버전 기록)으로 둘지.** 권고는 관리 모양이다 — 이후 `terra module rollback` · `uninstall`과 Tree 갱신이 같은 모양을 전제하기 때문이다. 이 선택은 설치기 구현(O-1)이 정한다.
- `update`와 `reconcileModuleScope`가 **번들에 없는** 모듈의 기록을 어떻게 다루는지(`U-1`). 받은 node-gui를 `update`가 지우면 안 된다.
- Tree의 `desired`가 `origin: bundle`이거나 설치기가 정한 새 origin의 모듈을 더 높은 버전으로 올릴 수 있는지(`module.go`의 "이미 있다" 분기는 읽었으나 버전 비교는 읽지 않았다).
- 이 문서는 **소스와 문서 읽기**로 썼다. 설치기·카탈로그는 구현 전이라 실행해 본 것이 없다. `terra-releases` 문서는 초안(v0.1)이라 바뀔 수 있다.

## 6. 진행 순서

| 단계 | 내용 | 누가 | 선행 |
| --- | --- | --- | --- |
| 1 | 0.4.1 이상을 담는 새 릴리스 태그를 찍는다 | 이 저장소 | 없음 — 태그를 찍으면 `release.yml`이 `.tmod`와 `modules.json`을 공개한다 |
| 2 | `installer-modules.json`과 카탈로그 v3의 `modules[]` 해석 | Terra 빌드 | 1 |
| 3 | 설치기 `internal/fetch`의 모듈 받기·검증, 실패 시 대기 | 설치기 엔진 | 2 |
| 4 | S3 라벨·완료 화면 경고 | 설치기 화면 | 3 |
| 5 | 등록 방식 보강(Q-7) | 설치기 엔진 · 화면 | 3 |
| 6 | 모듈 서명과 내장 키링(Q-9 · Q-13) | 이 저장소 · Terra | 루트 키 발급 |

## 7. 결정이 필요한 것

| ID | 질문 | 권고 |
| --- | --- | --- |
| O-1 | 받은 모듈의 설치 모양 — 평평(번들식)인가, 관리 모양인가 | 관리 모양. 단 U-1 · `reconcileModuleScope`를 확인한 뒤 |
| O-2 | 새 릴리스 태그를 언제 찍나 | 설치기가 핀할 시점. 태그는 `release.yml`이 곧바로 공개하므로 사람이 정한다 |
| O-3 | 설치기의 등록 코드(Q-7)를 이번 범위에 넣나 | 넣는다 — 위 §4-1 때문에 |
