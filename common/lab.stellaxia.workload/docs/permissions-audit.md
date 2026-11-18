---
title: "Workload 권한 · 감사 연동 확인 — 호출자 identity 기록"
aliases:
  - "workload permissions audit"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.workload"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-18"
language: "ko-KR"
based_on: "modules 레포 읽기 + terra-sdk v0.8.0 (모듈 캐시) 문서·소스 읽기. Gateway 자체 소스(Terra 레포)는 이 환경에 없어 읽지 못함. 실제 Gateway에 붙인 시험은 하지 않음"
related:
  - "[[../README|workload 모듈 README]]"
  - "[[../contracts/api/terra-api.json|terra-api 계약]]"
  - "[[common/lab.stellaxia.gui-v3/docs/design/backend|GUI v3 백엔드 설계]]"
  - "[[settings-modules|modules 전수표]]"
---

# Workload 권한 · 감사 연동 확인

표기: **확인함** = 이 레포나 SDK 문서/소스에서 직접 읽은 것. **추정** = 읽은 근거에서 이끌어냈지만 Gateway 소스·실측으로 닫지 못한 것. **확인 못 함** = 근거를 찾지 못한 것.

## 1. 모듈 쪽 현황 (확인함)

- `contracts/api/terra-api.json`의 쓰기 operation 6개(register · update · delete · start · stop · restart)는 `security.permissions: ["workload.manage"]`, `security.audit.required: true`를 선언한다. 읽기 operation은 `workload.read` 선언이다.
- 모듈 코드(`src/`)에는 권한 검사가 없다. `WORKLOAD_PERMISSION_DENIED`는 계약 errors에만 있고 코드가 내는 곳은 없다.
- 감사로 남던 것은 `workloads/{id}/events.jsonl`(registered · updated · started · stopped 등)뿐이고 호출자 정보가 없었다.

## 2. Gateway가 모듈에 넘기는 호출자 정보

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Gateway는 모듈 operation 경로로 forward할 때 `X-Terra-Principal`(감사용 주체. 앱·에이전트 자격이면 `"<user> via <delegate>"`) · `X-Terra-Subject`(위임을 뺀 주체) · `X-Terra-Delegate` · `X-Terra-Grants` · `X-Terra-Trace-Id` · `X-Terra-Workload-Credential`을 붙인다 | **확인함** | terra-sdk v0.8.0 `docs/contracts/module-host-http-contract.md` §7 |
| 클라이언트가 보낸 `X-Terra-*`는 Gateway 입구에서 지워지므로 이 값은 Gateway의 단언이다. 사용자 토큰은 모듈에 오지 않는다 | **확인함** (같은 문서 §7). 같은 내용을 gui-v3 문서가 `caller_headers.go`를 근거로 인용 | gui-v3 `docs/analysis/settings-modules.md:449` |
| 모듈은 `X-Terra-Workload-Credential`로 "호스트(Gateway)에서 온 호출"임을 검증하게 되어 있고, 업무 경로에도 같은 헤더가 붙는다(안 A) | **확인함** | 같은 문서 §3 · `modulert/handshake.go` `CredentialHeader` |
| `X-Terra-Principal`이 비는 경우 | **확인 못 함** — 문서는 "주체가 있을 때"라고만 적는다. 이 모듈은 비면 actor를 `unknown`으로 기록한다 | 같은 문서 §7 |
| `X-Terra-Grants`의 값 형식(권한 이름이 `workload.manage` 그대로인지 접두가 붙는지), 헤더가 없을 때의 뜻 | **확인 못 함** — "공백 구분, 무제한이면 `*`"만 있다 | 같은 문서 §7 |

## 3. 다른 모듈의 처리 (확인함)

- `common/lab.stellaxia.gui-v3/src/api.go`: `X-Terra-Principal`을 읽어 쓰기 핸들러(props.patch · desk.patch · files.put · files.delete)에서 `log.Printf("... audit ... by=%s")`로 남긴다. 권한 재검사는 없다. 주석: "only the Gateway can reach this endpoint with the workload credential".
- `leaf/lab.stellaxia.file/src/api.go`: 호출자 identity를 읽지 않고 권한도 재검사하지 않는다. 주석이 "a contract declares one permission per operation"이라며 operation 단위 권한을 계약(=Gateway)에 맡기는 전제로 적혀 있다.
- `common/lab.stellaxia.nodetalk/src/api.go`: 주석에 "A request with no peer principal is this node's own operator arriving through the Gateway — already authorized there, against permissions this module does not own". `X-Terra-Principal`은 피어 판별에만 쓰고 권한은 Gateway에 맡긴다.
- `tree/lab.stellaxia.fleet/src/api.go`: `X-Terra-Principal`을 core-op 입력으로 relay만 하고 인가는 Master가 다시 한다.
- 결론: 이 레포의 모듈 중 `X-Terra-Grants`를 읽어 권한을 재검사하는 것은 없다.

## 4. 권한 강제는 누가 하는가

- 계약이 선언한 operation 권한을 Gateway가 막는다는 정황은 **추정**(강함): node-gui 문서(`web/docs/api/real-data-layer.md`)가 권한 없는 호출이 403 `MODULE_PERMISSION_DENIED`로 돌아오는 실측을 적고, agent 문서가 Terra의 `auth/service.go`를 근거로 같은 동작을 적는다. 다만 이 모듈의 `workload.read/manage`에 대한 실측, 그리고 Gateway 소스는 이 환경에 없다.
- Gateway가 내는 코드는 `MODULE_PERMISSION_DENIED`다. 계약에 적힌 모듈 쪽 `WORKLOAD_PERMISSION_DENIED`와 이름이 다르며, 모듈이 낼 일이 지금은 없다. 계약 errors에서 이 코드를 둘지는 코어 확인 사항이다.
- 계약 `audit.required: true`를 Gateway가 어떻게 이행하는지(Gateway 쪽 감사 행이 남는지, 모듈이 별도로 남겨야 하는지)는 **확인 못 함**. 참고로 node-gui 문서에 `master.delegated.refused` 감사 행이 있다는 서술은 있으나 이는 위임 입구 거절에 한정된다.

## 5. 이번에 적용한 것

호출자 identity 전달은 확인됐으므로(§2) 최소로 기록만 붙였다.

- `src/audit.go`(새 파일): `X-Terra-Principal`(없으면 `unknown`)과, 다르면 `X-Terra-Subject`를 읽는다. 제어 문자를 지우고 200바이트로 자른다. 토큰·Authorization 등 다른 헤더는 읽지 않는다.
- `src/api.go`: 쓰기 핸들러 6개가 **성공한 뒤** `recordAudit`를 부른다. register · update · start · stop · restart는 `events.jsonl`에 `kind: "audit"`, `detail: {op, actor, subject?}` 한 줄과 프로세스 로그 한 줄을 남긴다. delete는 디렉터리가 사라지므로 프로세스 로그 한 줄만 남긴다(`appendEvent`는 디렉터리를 다시 만들기 때문에 호출하지 않는다).
- 실패한 요청은 기록하지 않는다. 없는 id에 대한 요청이 stray 디렉터리를 만들지 않게 하기 위함이다. 거절 감사는 Gateway 몫으로 본다(**추정**).
- 기존 이벤트(registered · started 등)의 detail에는 actor를 넣지 않았다. 그 이벤트는 `service.go`·`supervisor.go`(작업 1·2 영역)에서 나가기 때문이다. 합치려면 service 메서드에 actor를 넘기는 변경이 필요하다.
- 시험: `src/audit_test.go`.

## 6. 하지 않은 것 — 모듈 단 권한 재검증

`X-Terra-Grants`로 `workload.manage`를 방어적으로 다시 검사하지 않았다. 근거가 모자라다: 값의 정확한 형식과 헤더 부재의 뜻이 **확인 못 함**이고(§2), 형식을 추측해 fail-closed로 하면 정당한 호출을 막고 fail-open이면 검사가 아니다. 이 레포의 다른 모듈도 하지 않는다(§3). 이것은 코드를 추측으로 만들지 않기 위한 결정이다.

## 7. 코어에 확인할 것

1. Gateway가 계약의 `security.permissions`를 operation별로 강제하는가 (로컬 경로·원격 relay 경로 모두). 강제 소스 위치.
2. `X-Terra-Grants`의 권한 이름 형식과 헤더 부재의 의미. 이것이 확정되면 모듈 단 재검증을 최소로 붙일 수 있다.
3. `audit.required: true`를 Gateway가 이행하는가, 아니면 모듈이 남겨야 하는가. 후자면 실패·거절 기록과 delete 기록의 보관 위치를 정해야 한다.
4. `X-Terra-Principal`이 비는 호출이 있는가(예: 로컬 운영자 CLI).
5. 계약 errors의 `WORKLOAD_PERMISSION_DENIED`를 Gateway의 `MODULE_PERMISSION_DENIED`와 정렬할지.
