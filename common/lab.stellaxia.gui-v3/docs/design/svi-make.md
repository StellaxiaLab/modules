---
title: "자원화 창 — 유형 스키마로 자원 만들기 · 허가 · 끌어다 연결"
aliases:
  - "자원화 창"
  - "SVI 자원화"
  - "NodeSvi"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
  - "[[net-props|네트워크 속성 창]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
---

# 자원화 창 — 유형 스키마로 자원 만들기 · 허가 · 끌어다 연결

## 0. 틀의 모양 (2026-11-02 제안)

1. **자원화 유형을 모듈이 내놓는다** — SDK 어댑터에 그 어댑터가 받는 설정값의 스키마를 붙인다(카메라: RTSP 주소 · 파일: 경로와 읽기/쓰기 · 프로그램 창: 실행 파일과 창 이름).
2. **제어기가 그 스키마로 입력 양식을 자동으로 그린다** — "자원 만들기"에서 유형을 고르고 값을 넣으면 Daemon 선언 API 로 자원이 생긴다. 파일 관리자에서 우클릭 "자원으로 만들기"도.
3. **허가와 연결도 화면에서** — 자원을 다른 노드에 허가하고, 원천을 대상에 끌어다 놓아 잇는다. 연결 상태는 "유휴"와 "끊김 · 사유"를 가른다.
4. **새 모듈의 몫은 어댑터 하나와 스키마뿐** — 양식 · 수명 · 허가 · 연결 화면은 틀이 공통으로.

## 1. 만든 것

| 자리 | 파일 |
| --- | --- |
| 틀(유형 · 양식 · 검사 · 선언 입력 · 울타리 · 이을 수 있나 · 연결 상태 · 부르기) | `web/src/api/svi-make.js` + `svi-make.test.mjs` |
| 창 | 보드 `NodeSvi.dc.html`(조각 `build/parts/nodesvi`) + `tests/nodesvi.test.mjs` — 시안 사본이 `svi-make.js` 와 같은지 시험 |
| 여는 곳 | 우클릭 › **자원화**(트리 · 리프) · 전역 제어 › 기능 › 자원화 · 제어기 › 자원 관리 › 자원 선언 › **자원 만들기 ›** · 제어기 › 파일 관리자 › 파일 우클릭(또는 **자원으로 만들기** 단추) — 파일 유형 · 경로 · 이름을 채워 연다 |
| 창 자리 | 23, 900 × 640, 노드마다 하나(다시 열면 미리 채울 값만 바꾼다) |

창은 세 쪽이다.

- **만들기** — 왼쪽은 유형(내장 · 모듈이 내놓은 것), 오른쪽은 그 유형의 스키마로 그린 양식(글 · 경로 · 고르기 · 켬/끔 · 목록 · 수). 이름 규칙(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)과 스키마(필수 · 패턴 · 고르기)를 그 자리에서 검사, **울타리**(노드가 열어 둔 파일 뿌리 · 프로그램 · 주소) 밖이면 만들기 전에 알린다. 같은 이름이면 "바꾼다 — 그 위의 연결은 끝난다"를 켜야 한다.
- **자원 · 허가** — 이 노드가 선언한 자원(적용됨 · 가려짐 · 울타리가 거절 + 사유), 해제. 자원마다 클러스터의 다른 노드 칩 — 누르면 허가(읽기 · 연결 원천, 기한 1 · 7 · 30 · 90일), 다시 누르면 회수.
- **연결** — 원천(내보내는 끝) · 대상(받는 끝) 두 열. 원천을 끌면 이을 수 있는 대상은 점선으로, 못 잇는 대상은 흐리게 + 까닭(방향 · 상호작용 · 형식 · 판). 놓으면 연결(키보드 · 터치는 원천을 누르고 대상을 누른다). 아래 연결 상태: **연결됨 · 연결 중 · 끊김 · 실패 · 닫힘 + 사유**(한국어), 끊기.

## 2. Terra 의 무엇을 부르나 (Terra origin/main 25a5e2c3)

| 일 | operation | 비고 |
| --- | --- | --- |
| 울타리 · 선언 목록 | `terra.daemon.svi.declarations.get` | scope local · cluster — 다른 노드도(Master 중계) |
| 만들기 | `terra.daemon.svi.declarations.post` `{ family, name, direction, path · command/args · address/mode/framing, replace? }` | `node.config`. family 는 `file · process · net` 셋 |
| 해제 | `…declarations.by-family.by-name.undeclare.post` | 그 위의 handle · binding 은 `resource_withdrawn` 으로 끝 |
| 자원(끝) | `terra.master.svi.resources.get` | 끝의 direction · interaction · input/output_schema 로 이을 수 있나를 미리 |
| 허가 | `terra.master.svi.grants.post/get/by-grant-id.delete` | 앱 자격: 노드에게 read · subscribe · bind.source, 기한 90일 이하 |
| 연결 | `terra.master.svi.bindings.post` (+ 없으면 본인 허가 bind.source · bind.target 7일) · `bindings.get` · `by-binding-id.delete` | 만든 사람이 두 끝의 본인 허가를 가져야 한다(소유자도) |

연결 상태 대응: `active` 연결됨 · `requested/validating/planning/preparing` 연결 중 · `degraded` **끊김**(자동 복구 — participant_disconnected 등) · `failed` 실패 · `closing/closed` 닫힘, 사유는 `reason`.

## 3. 코어(Terra)에 필요한 것 — 틀은 자리만 두었다

| 제안 | 지금 Terra | 필요한 것 | 창에서는 |
| --- | --- | --- | --- |
| 1. 모듈이 유형 + 설정 스키마를 내놓음 | `contributions.svi` 는 `resources` · `sink` 불리언 둘. 어댑터 인터페이스(`Adapter{ID, Discover, Close}`)에 스키마 없음 | `contributions.svi.types[{ id, title, description, schema }]`(스키마는 manifest `configuration.schema` 와 같은 JSON Schema 부분집합) · 유형 목록 operation | 모듈 목록(`daemon.modules.get`)의 매니페스트에 그 자리가 있으면 유형으로 보이고 양식을 그린다. 시안은 카메라(RTSP) · 프로그램 창 예시 |
| 2. 그 유형으로 자원 만들기 | 선언 API 는 `family` 셋 고정 · `additionalProperties:false` — 모듈로 넘어가지 않음. 모듈이 원천(source)이 되는 데이터 길도 없음(sink 만) | 선언을 모듈 어댑터로 넘기는 길(예: 선언 `family: module` + `module_id` · `type` · `config` → 모듈 `POST /terra/svi/declare`), 모듈 원천 데이터 길 | 모듈 유형은 **만들기 — 코어 대기**로 잠금 |
| 창 우클릭 "자원으로 만들기" | window kind 어댑터가 없다 | 프로그램 창 어댑터(모듈) + 위 길 | 시안의 "프로그램 창" 유형 |
| 3. "유휴" 구분 | binding 에 마지막 프레임 시각 · 수가 없다 | binding 관측에 `last_frame_at` · 프레임 수(또는 idle 상태) | 연결됨 줄의 '흐름'은 **보고 없음** |
| 울타리를 GUI 에서 넓히기 | 같은 노드에서만 — 폴더 허용 · GUI 에서 넣은 폴더 해제 (ADR-GW-011 E3, `terra.daemon.svi.envelope.file-roots.*`, node.control). 다른 노드는 그 노드에서만 | 창 왼쪽 울타리 목록(출처: 설정 파일 / GUI) + 폴더 허용 버튼 · 확인 창 |
| 경로 칸의 "찾아보기" (파일 고르기) | **그 노드의 파일 탐색기와 같은 곳에서.** 노드 데스크톱 › 파일과 같은 두 길 — 로컬 탐색 `terra.daemon.local-fs.roots.get` · `entries.get`(읽기 전용, scope local — **이 노드만**)과 공유 폴더 `io.terra.file.roots.list` · `entries.list`(다른 노드는 Master 중계). 폴더 · 파일을 보고 절대 경로 문자열만 채운다 — 아무것도 허용하지 않고, 파일 내용도 읽지 않는다. 다른 노드는 공유 폴더만 보이고(로컬 탐색 : 이 노드만), io.terra.file 이 없거나 절대 경로를 알려 주지 않는 뿌리는 이유를 적고 직접 입력. 고른 경로가 울타리 밖이면 만들기가 막히고 "폴더 허용…" 이 위 폴더를 채워 열린다 — 확인 창(ADR-GW-011 §2.7)을 거쳐야만 넓어진다 | 폼 안 경로 칸 · 파일 고르기 창 |
| 울타리가 막은 채 만들기 | 파일: 허용 폴더가 없거나 경로가 밖이면 만들기 버튼을 잠그고 이유 + "폴더 허용…". 프로그램 · 네트워크: 닫힘은 설정 파일(`svi.runtime.process` · `net`)에서만 열리고 재시작이 필요하다(ADR-GW-011 §3) — 버튼 없이 그 안내만. 서버 오류 코드(`SVI_DECLARATION_OUTSIDE_ENVELOPE`)는 한국어 문장 뒤에 붙여 보인다 | 만들기 양식 경고 줄 |

## 4. 허가 주체 — 노드 · 사람 (2026-11-04)

Master 위임 가드(Terra `api/delegated_grant_guard.go`, ADR-GW-004 2b · D-3 · D-4 · Q14)를 `web/src/api/svi-grant.js`(+ 시험 — Terra 원본이 있으면 표를 대조)로 옮겼다. 자원 창(NodeShare) · 자원화 창(NodeSvi)이 같은 규칙을 쓴다(보드 사본은 `tests/svi-grant-boards.test.mjs`).

| 주체 | 고를 수 있는 것 | 작업(칩) | 기한 |
| --- | --- | --- | --- |
| 노드 | 같은 클러스터의 노드(NodeShare: 전체 · Tree · Leaf) | read · subscribe · bind.source | 1시간 · 1일 · 7일 · 30일 · 90일(필수 · 90일 이하) |
| 사람 | **나**(whoami principal → 사용자 id) — 다른 사람은 잠근 칩 + 가드 why. 사람 목록(`terra.master.admin.users.get`)은 위임 밖이라 문이 잠근다 | inspect · read · subscribe · bind.source · bind.target | 같음 |

write · invoke(그리고 노드에게 inspect · bind.target)는 칩으로 그리되 잠그고 이유를 단다. 보내기 전에 `checkGrant` 가 가드와 같은 거절을 화면에서 낸다 — 부르지 않은 것을 '됨'이라 하지 않는다. 허가 목록의 사람 주체는 `사람` 꼬리표, 이 계정이면 `나 · id`.

