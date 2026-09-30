---
title: "Terrallo — 배포 파이프라인 수동 테스트 모듈"
doc_type: "module-design"
scope: "project"
target: "terra"
status: "draft"
version: "v0.1"
last_updated: "2026-09-13"
related:
  - "[[module/README|Terra 외부 Module 저장소]]"
  - "[[docs/manual/06-usage/modules-develop|모듈 개발]]"
  - "[[docs/manual/06-usage/modules-install-and-manage|모듈 설치와 관리]]"
---

# Terrallo

`dev.terrallo`는 **등록 → 게시 → 배포 → 설치**를 손으로 밟아 보기 위한 모듈이다.
하는 일은 하나뿐이다:

```bash
terra hello
```

```text
MESSAGE
-----------
hello terra
```

정확히 그 한 줄만 원하면 `terra --quiet hello`가 `hello terra`를 그대로 찍는다.

## 왜 이렇게 아무것도 안 하는가

파이프라인을 검사하는 물건이라서다. 돌려주는 값이 기계·시각·입력 무엇에도 의존하지
않으므로, **답이 틀리면 그건 언제나 파이프라인 문제이지 모듈 문제가 아니다.** 모듈이
변수로 남아 있으면 배포 축을 검사할 수 없다.

| 이 모듈이 증명하는 것 | 어디서 드러나나 |
| --- | --- |
| 패키지가 만들어지고 자기 검증을 통과한다 | `terra module pack`의 `verified: true` |
| tree가 이름을 받아들이고 게시한다 | `terra module catalog` |
| 노드가 desired를 받고 바이트를 내려받는다 | `terra module offers` / `terra module explain` |
| 설치가 끝나고 호스트가 프로세스를 띄운다 | `terra daemon module get dev.terrallo` → `ready` |
| 계약이 route로 투영된다 | `terra module ops --search dev.terrallo` |
| CLI contribution이 등록된다 | **`terra hello`가 존재한다** |

마지막 줄이 핵심이다. `terra hello`는 이 CLI에 없는 명령이다 — 모듈이 manifest의
`contributions.cli`로 선언해야만 생긴다. 그러니 **그 명령이 응답한다는 사실 자체가
전 구간이 끝까지 갔다는 증거**다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `module.json` | Manifest v2. `contributions.cli`가 `terra hello` → `dev.terrallo.hello.get`을 잇는다 |
| `contracts/api/terra-api.json` | operation 2개 — `status.get`(readiness probe)·`hello.get` |
| `src/main.go` | 두 route를 서빙하는 SDK 프로세스 |
| `src/main_test.go` | 선언 세 곳(계약·manifest·핸들러)이 서로 어긋나면 실패하는 드리프트 테스트 |

`bin/`은 커밋하지 않는다 — 릴리스 빌드가 컴파일해 digest를 스탬프한다.

## 손으로 밟기

### 0. 빌드

```bash
cd module/common/dev.terrallo/src
go test ./... -count=1
GOOS=linux   GOARCH=amd64 go build -o ../bin/linux-amd64/terra-terrallo       .
GOOS=linux   GOARCH=arm64 go build -o ../bin/linux-arm64/terra-terrallo       .
GOOS=windows GOARCH=amd64 go build -o ../bin/windows-amd64/terra-terrallo.exe .
```

### 1. 포장

```bash
terra contract validate module/common/dev.terrallo
terra module pack module/common/dev.terrallo --out dev.terrallo-0.1.0.tmod
```

`verified: true`가 나와야 한다. 서명까지 해 보려면
`--sign-key <base64 64바이트 ed25519 파일> --issuer "<이름>"`을 붙인다.

### 2. 등록(게시)

```bash
terra auth login --username <계정> --password <암호>
terra module prefix grant dev.terrallo     # 최초 1회, master admin
terra module publish dev.terrallo-0.1.0.tmod --policy required
terra module catalog --module dev.terrallo
```

> 접두사는 `dev.terrallo`다. `io.terra.*`는 Terra 예약이라 게시가 거부되므로
> 이 모듈은 일부러 그 바깥 이름을 쓴다.

`--policy`로 배포 성격이 갈린다:

| policy | 노드에서 |
| --- | --- |
| `required` | subtree 전 노드가 스스로 설치 |
| `recommended` · `available` | `terra module offers`에 뜨고, `terra module consent dev.terrallo` 해야 설치 |

**두 경로를 다 밟아 보려면** `available`로 한 번, 다음 버전을 `required`로 한 번 게시한다.

### 3. 배포

```bash
terra module rollout <publication-id> --stage 1 --canary-node <node_ref>
terra module explain dev.terrallo --node <node_ref>
terra module rollout <publication-id> --stage 100
```

노드 쪽 reconciler가 꺼져 있으면 아무 일도 안 일어난다:

```bash
terra daemon config get module_distribution.enabled
terra daemon config set module_distribution.enabled true
terra daemon restart
```

미서명 패키지로 자동 설치까지 보려면 `module_distribution.allow_dev_install`도 켜야 한다
(기본 off). 서명하거나 tree가 게시한 것이면 필요 없다.

### 4. 설치 확인

```bash
terra module offers                       # 제안 목록 (정책이 required면 managed)
terra daemon module list                  # ISSUES 표도 함께 본다
terra daemon module get dev.terrallo      # ready 확인
terra module ops --search dev.terrallo    # route 게시 확인
terra hello                               # ← 여기까지 오면 전 구간 통과
```

수동 설치만 따로 보려면 tree 없이도 된다:

```bash
terra module install dev.terrallo-0.1.0.tmod --root <data_dir>/modules --dev
terra daemon module scan && terra daemon module start dev.terrallo
```

### 5. 되돌리기

```bash
terra module withdraw dev.terrallo                       # 동의로 깐 경우 — payload까지 제거
terra module revoke <publication-id> --reason "테스트 종료"  # 게시 철회 → 노드는 중지·보류
terra module uninstall dev.terrallo --root <data_dir>/modules
```

## 버전을 올려 업데이트를 보고 싶다면

`module.json`의 `version`과 `provides.capabilities[0].version`, 계약의
`contractVersion`·`provider.version`, `src/main.go`의 `moduleVersion`을 함께 올리고
다시 포장·게시한다. `readiness.versionRange`(`>=0.1.0 <1.0.0`)를 벗어나면 그것도 고친다.

`greeting` 상수를 바꿔 두면 노드에 실제로 새 바이트가 도달했는지를 `terra hello`의
출력으로 바로 확인할 수 있다 — 버전 숫자만 보는 것보다 확실하다.

## 알려진 제한

- `terra hello`는 **Gateway를 거친다.** Gateway가 안 떠 있거나 모듈이 `ready`가 아니면
  "unknown command"가 아니라 Gateway 오류가 난다 — 그 구분이 이 모듈의 쓸모다.
- CLI 내장 명령이 언제나 이긴다. 내장에 `hello`가 생기면 이 contribution은 가려진다.
- 이 모듈은 배포 실험용이다. 제품 릴리스에 싣지 않는다.
