---
title: "io.terra.nodetalk 격차 분석 — 정말 뒤처졌는가"
doc_type: "analysis"
scope: "module"
target: "io.terra.nodetalk"
status: "draft"
version: "v0.1"
last_updated: "2026-11-02"
---

# io.terra.nodetalk 격차 분석

기준: modules `origin/main` a18a8d5, 모듈 0.1.0. Terra는 `git fetch` 후 `origin/main`을 읽었다.
측정은 §3.1 표 하나뿐이고(재현 방법은 거기에 적었다), 나머지는 코드 읽기와 기존 시험 통과(§3.6)에 근거한다.

## 0. 결론

**"전반적으로 가장 뒤처졌다"는 인상은 사실과 다르다. 맞는 부분은 하나다 — 저장 계층의 알고리즘.**

| 축 | 판정 | 요지 |
| --- | --- | --- |
| 공개 SDK 사용 | 뒤처지지 않음 | 저장소의 Go 모듈 10개가 전부 `terra-sdk v0.1.0`이다. v0.2~v0.7은 라이선스·pkgformat·접속 서비스 계약·자원화(SVI)이고 nodetalk이 쓸 것이 없다 |
| 구조·계약 | 앞선 편 | operation 15개가 `contract_map_test`로 양방향 대조, CLI `kind:"session"`을 쓰는 유일한 모듈, 내구 쓰기(fsync+rename), 시험 약 5천 줄 |
| 플랫폼 관행(권한·서명·위임) | 뒤처지지 않음 | 권한이 최소(`coreOperations` 2 + `module-data`)이고 서명은 저장소 `signing.json`이 접두사로 일괄 처리한다 |
| 모듈 설정 API | 해당 없음 → 선택 | 저장소 어떤 모듈도 `configuration`을 안 쓴다. 다만 nodetalk의 조정값(§3.5)은 호스트가 환경 변수를 걷어내서 **운영자가 닿을 길이 없다** |
| **저장 알고리즘** | **뒤처짐 (높음)** | 쓰기 한 번이 대화 전체 로그를 읽고 파싱하고 정렬한다. 전역 뮤텍스 아래서. 측정 §3.1 |
| 동기화 알고리즘 | 보통 (중) | 정확성은 견고(멱등·구멍 거부·임차·승격 증명). 효율·장애 격리는 단순하다 |
| 문서 | 약간 뒤처짐 (낮음) | 모듈 README 없음, `main.go` 머리말이 M1 시절 그대로 |

**맞는 말: 알고리즘(저장)은 낡았다. 틀린 말: 구현·구조 전반이 낡았다.** 보강은 §5의 N-1(저장)에 집중하는 것이 값이 맞다.

## 1. 현황 (읽은 그대로)

- 종류 `service`, products `leaf`·`tree`, 계약 0.3.0, operation 15. 권한: `terra.node.identity.get`, `terra.node.peer.invoke`, `module-data`.
- **모델**: 대화마다 저자별 append-only JSONL (`conversations/<id>/log/<author>.jsonl`) + `meta.json`(멤버·랭크·epoch·main). 표시 순서 = (lamport, author) 전순서. 병합은 (author, seq) 합집합이라 충돌이 없다.
- **쓰기 권한**: 모든 멤버가 언제나 자기 로그에 append(D-1). 메인은 순서·보존·멤버십의 권위이지 쓰기의 권위가 아니다.
- **전달**: append 직후 활성 멤버에게 `replica.push` 팬아웃(상한 32, 최선 노력) + 10초 주기 pull 루프가 정확성을 책임진다.
- **메인**: 랭크 기반 인수인계(settle 30초·히스테리시스 2분), 임차 만료 시 자가 승격(실제 접촉 + 따라잡기 증명 필수), 삭제는 묘비(TTL 30일).
- **관측**: 항목마다 transport(rung·rtt·attempts), `behind`·`lost_own`, 고장 주입(`faults.go`), probe.
- **UI**: GUI(`ui/`), CLI `nodetalk join` 방(Terra 일반 렌더러).
- **알려진 한계(Terra 구현 계획 M4·M5·§15·§16)**: 묘비 만료 후 입양 재개, attempts는 pull 홉만 센다, 자기 줄을 잃으면 복구 불가(의도), 한 기계의 leaf+tree 두 인스턴스.

## 2. 유지할 점 (바꾸지 말 것)

1. **자기 저자 항목을 피어에게서 받지 않는다** (`MergeEntries`). 피어가 내 이름으로 말할 수 없다는 몇 안 되는 단단한 성질. Terra 계획 §16이 자동 복구를 일부러 안 넣은 이유다.
2. 구멍 거부 + 멱등 병합, push는 비동기 최선 노력, "append는 무엇에도 막히지 않는다".
3. 승격 증명이 비면 승격하지 않는다(`sync.go` `takeLapsedMains`), 임차 시계는 실제 접촉에서 시작.
4. fsync + 임시파일 rename(`talk/durable.go`), 꼬리 한 줄만 손상 허용·NUL은 손실로 간주.
5. 계약 대조 시험, 모듈이 Go 의존 없이 설 수 있는 계약(SDK는 얇게만 쓴다).

## 3. 뒤처진 점

### 3.1 [높음] N-1 쓰기·조회 비용이 로그 길이에 비례하고 전부 전역 뮤텍스 아래다

근거(코드, 경로는 `common/io.terra.nodetalk/src/` 기준):

- `talk/store.go:228` `AppendMessage`는 뮤텍스를 잡고 ① 자기 로그 전체 `readLog` ② `lamportClockLocked`(`:464`) → `allEntriesLocked`(`:431`)가 **모든 저자 로그를 읽고 파싱하고 정렬**한 뒤 최대 lamport만 쓴다 ③ fsync append.
- `watermarksLocked`(`:405`)는 각 저자 로그를 통째로 파싱해 **마지막 줄의 seq만** 쓴다. `Get`·`List`(→`behindLocked` `talk/replica.go:317`)가 이것을 부르고, 동기화 루프는 tick마다 `List`를 여러 번 부른다.
- `Entries`(`:286`)는 `afterLamport`로 걸러도 전부 읽고 정렬한 뒤에 거른다.

측정 — `talk/store_bench_test.go`의 `TestAppendCostGrowsWithLog`(`NODETALK_BENCH=1 go test -run TestAppendCostGrowsWithLog -v ./talk`, 기본 실행에서는 건너뛴다). 저자 1명, 한 줄 약 120바이트, Windows·Go 1.26, 평균 20회:

| 로그 줄 수 | append (ms) | Get/워터마크 (ms) | List (ms) |
| ---: | ---: | ---: | ---: |
| 100 | 13.9 | 1.8 | 1.7 |
| 1,000 | 28.9 | 6.1 | 5.1 |
| 10,000 | 102 | 44 | 36 |
| 50,000 | 376 | 208 | 212 |
| 100,000 | 781 | 372 | 323 |

100줄에서의 14ms는 대부분 fsync 고정비이고, 증가분은 전부 읽기·파싱·정렬이다(줄당 약 8µs, 선형). 모두 `s.mu` 아래라 **한 대화가 커지면 모든 대화의 조회·SSE 구독·동기화가 같이 멈춘다.** 로그는 묘비 외에는 삭제되지 않으므로 시간이 갈수록 나빠진다. 1만 줄(약 0.1초)까지는 눈에 안 띄지만 이 모듈은 "계측기"라 자동 부하(프로브·반복 게시)로 금방 닿는다.

첫 시도에서 사전 적재를 `AppendMessage`로 했더니 O(n²)라 2만 줄에서 10분 제한을 넘겼다 — 같은 원인이다.

보강 방향(§5 N-1): 저장 형식은 그대로 두고 **메모리 색인**(저자별 마지막 seq·최대 lamport)을 대화별로 두고 append/merge가 갱신, 첫 접근 때 한 번만 로그를 읽어 구축. 로그 파일·API 응답은 비트 단위로 동일해야 한다.

### 3.2 [중] N-2 동기화 루프는 순차이고 장애 피어를 격리하지 않는다

- `sync.go:218` 부근 `tick`은 피어를 **하나씩 순서대로** 돈다. 피어당 이름 조회 + list + 대화별 get + pull. 문 호출 제한 10초(`doorCallTimeoutMS`) + Core 5초이므로, 응답 없는 피어 하나가 tick을 수십 초 막고 나머지 피어의 pull이 늦는다. 분단이 일상이라는 이 모듈의 전제에 비해 약하다. push가 1차 경로라 체감은 완충되지만, 피어 다운 후 복귀 같은 구멍은 pull만 메운다.
- 백오프·지터가 코드 어디에도 없다(`grep -i backoff` 0건). 죽은 피어는 10초마다 같은 로그 한 줄을 영원히 찍는다.
- 피어 N명이면 각자 모두에게서 모든 저자를 pull — N² 트래픽. 방 수십 개 규모에서는 문제가 아니다.
- 변경 없는 대화도 tick마다 list·get을 한다(요약 교환 없음).

### 3.3 [낮음~중] N-3 SSE는 누락을 알리지 않는다

`talk/stream.go` `publishLocked`는 구독자 버퍼(32)가 차면 이벤트를 **조용히 버린다.** 설계상 "디스크가 진실, 스트림은 알림"이지만 클라이언트는 놓쳤다는 사실을 알 길이 없다(이벤트 id·gap 신호 없음). Terra CLI 방은 재연결 시 `messages.list`로 구멍을 메운다고 문서화돼 있으나, **연결을 유지한 채 느린 소비자**가 메워지는지는 Terra 쪽 코드를 읽지 않아 **미검증**이다. 알리려면 스트림 이벤트에 `lagged` 종류를 더해야 해서 계약(enum) 변경이다 → 결정 사항.

### 3.4 [낮음] N-4 문서·표기

- `main.go:1-9` 머리말이 "M1 scope … 나머지는 501"이라고 적혀 있다. M5까지 완료됐고 15개 전부 실구현이다. 사실과 다른 주석.
- `moduleVersion` 상수(`main.go:29`)가 `module.json` 버전과 따로다. 두 값을 맞추는 시험이 없어 릴리스에서 어긋날 수 있다(io-weave도 같은 패턴 — 저장소 공통).
- 모듈 README 없음(treebench는 있음). 설계는 Terra 저장소 문서에만 있는데 modules는 독립 레포다.

### 3.5 [선택] N-5 조정값이 환경 변수뿐이다

`TERRA_NODETALK_SYNC_INTERVAL_MS`·`SETTLE_MS`·`HANDOVER_HYSTERESIS_MS`·`PEERS`·`DATA_DIR`·`NODE_ID`는 손으로 띄운 벤치용이다. 호스트 런처는 허용 목록 밖 환경을 걷어내므로(`sync.go` 머리말) 호스트 아래 운영자가 동기화 주기를 바꿀 길이 없다. 플랫폼 모듈 설정 API(`configuration.schema` → `modulesdk.LoadModuleConfig`, Terra `module-configuration-design.md`)가 이 용도다. 단 매니페스트 변경 + 새 설정 키는 버전·계약 판단이라 결정 사항으로 둔다. 저장소에 사용 선례도 없다.

### 3.6 확인했으나 문제로 보지 않은 것

- SDK v0.7까지의 차이: 추가뿐이고 nodetalk이 쓰는 `modulesdk.FromEnv/Listen/CoreFromEnv/DataDir`은 그대로.
- 권한: 최소 권한이며 `network` 선언 불필요(피어 통신은 코어 문 경유).
- 서명: 저장소 `signing.json`이 접두사로 처리, 모듈 측 작업 없음(개명 후엔 `lab.stellaxia` 키로 바뀐다, §7).
- 시험: 기준선 `go build ./... && go vet ./... && go test -count=1 ./...` 통과(루트 패키지 9.8s, talk 6.6s). CI가 `-race`를 강제한다(`tools/test-modules.mjs --require-race`).

## 4. 실험하지 못한 것

- **실제 두 프로세스 릴레이**: 불가능했다. 피어 문은 Core 평면(`terra.node.peer.invoke`)이 필요하고, 호스트 없이 띄우면 `peer door unavailable, sync disabled`로 동기화가 꺼진다(`main.go`). 대신 저장소의 두 노드 시험(`sync_test`·`peer_access_test`·`lease_promotion_test`·`cli_session_test`)이 문을 핸들러로 직결해 복제·인수인계·승격·분단을 돌린다(통과 확인). 실 Master 릴레이의 90초 절단류는 Terra의 e2e(`remote-invocation-integration/nodetalk_e2e_test.go`) 몫이다. 이 PC의 실행 중 모듈·데몬은 지시대로 건드리지 않았다.
- N-3의 CLI 쪽 동작, N-2의 실제 지연 곡선(피어 장애 주입)은 측정하지 않았다. 코드 읽기 결론이다.

## 5. 보강 계획

| ID | 작업 | 판정 | 순서 | 위험 | 시험 |
| --- | --- | --- | ---: | --- | --- |
| N-1 | 저장 색인(저자별 마지막 seq·최대 lamport) — 파일 형식·API 불변 | 안전 | 1 | 색인과 디스크 불일치(외부 편집·복구). 첫 접근 때 구축, 쓰기 실패 시 폐기 | 기존 `talk` 시험 전부 + 색인↔디스크 동치 시험 + 위 벤치 전후 표 |
| N-1b | `Entries`가 afterLamport·limit을 읽기 단계에서 적용 | 안전 | 2 | 정렬 안정성 | 기존 + 동치 시험 |
| N-4 | `main.go` 머리말 정정, `moduleVersion`↔`module.json` 일치 시험 | 안전 | 3 | 개명 브랜치와 줄 충돌(§7) — 주석·시험만 | `go test` |
| N-2b | 피어 병렬화·백오프·실패 로그 억제 | 결정 | — | 루프 상태(`failCounts` 등)와 동시성 충돌 | 분단·지연 주입 |
| N-3 | SSE `lagged` 이벤트 | 결정 | — | 계약 enum 확장 | 계약 대조 |
| N-5 | `configuration.schema` 도입 | 결정 | — | 매니페스트·버전 | 호스트 통합 |

README(N-4의 일부)는 개명이 `docs`·경로를 크게 건드리므로 개명 병합 뒤로 미룬다.

## 6. 사용자 결정이 필요한 선택지

1. **N-2b 피어 병렬화·백오프.** 권고: 한다. 단 N-1 뒤 별도 PR로. 동기화는 이 모듈에서 가장 위험한 코드라 저장 변경과 섞지 않는다.
2. **N-3 `lagged` 신호.** 권고: 먼저 Terra CLI 방이 느린 소비자에서 구멍을 메우는지 확인. 메우면 불필요.
3. **N-5 설정 스키마.** 권고: 보류. 사용 선례가 없고 운영 불편 보고도 없다. 필요해지면 `sync_interval_ms` 하나부터.
4. **알고리즘 교체**(로그 압축·스냅샷, 피어 요약 교환 gossip)는 이 분석의 범위 밖. 권고: 사용 규모(방 수십 개·로그 수만 줄 이하)에서는 N-1/N-2로 충분. 규모 요구가 바뀌면 그때 새 분석.
5. **모듈 버전 상승**(0.1.0 → 0.1.1): N-1은 동작 불변이지만 릴리스 후보다. 릴리스·태그는 사용자 몫이라 올리지 않는다.

## 7. 개명과의 충돌

Terra ADR-MD-002 v1.2와 개명 계획은 `io.terra.nodetalk` → `lab.stellaxia.nodetalk`을 정했다. modules `origin/main`은 아직 `io.terra.*`이고 개명 브랜치(`claude/prefix-rename-lab-stellaxia`)는 미병합이다. 개명은 `module.json`·계약·`dataDir()`의 `modulesdk.DataDir("io.terra.nodetalk")` 등 id 문자열을 다수 바꾼다. 이 보강은 id 문자열 파일을 피하고 `talk/` 내부 변경 위주로 한다.

또한 데이터 이주: `module-data/<id>/`가 개명으로 빈 디렉터리가 되면 Terra 계획 §16의 결함 경로가 그대로 열린다. nodetalk은 **자기 줄을 피어에게서 복구할 수 없으므로**(§2-1) 이주가 빠지면 영구 손실이다. 개명 계획은 디렉터리를 옮기기로 했으나, 개명 릴리스 전에 nodetalk 대화 디렉터리 이주를 실측으로 확인할 것을 권한다.
