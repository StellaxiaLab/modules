---
title: "제어기 바탕 구성도 그 노드가 원본 — 설계와 실행 계획"
aliases:
  - "노드 소유 바탕 구성"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
last_updated: "2026-11-10"
language: "ko-KR"
related:
  - "[[node-owned-data|노드의 GUI 데이터는 그 노드가 원본]]"
  - "[[node-data|노드 데이터 층]]"
  - "[[backend|v3 백엔드 설계]]"
---

# 제어기 바탕 구성도 그 노드가 원본

> 근거 표기. 코드 위치는 modules `origin/main` 50efbd4, Terra `origin/main` 5d79ad69 기준이다. 약어는 `T` = `web/design/build/parts/terranodes/script.js`, `E` = `web/design/NodeDesktopEmbed.dc.html`, `TP` = `web/src/api/transport.js`, `GW` = Terra `products/common/apps/terra-gateway-service`, `MS` = Terra `products/tree/master/src/terra_master`, `LD` = Terra `products/leaf/daemon/src/terra_daemon`. 실측은 2026-11-10 서버(`maruinano@192.168.0.21`)를 읽기 전용으로 본 결과다. 설계 단계이므로 구현은 하지 않았다.

## 1. 한 줄

어떤 노드의 **바탕 구성**(아이콘, 배경, 독, 모양)은 **그 노드의 Daemon 쪽 gui-v3에 저장한다**. 어디서 바꾸든 그 노드를 먼저 고치고, 노드가 돌려준 값으로 표시한다. 연결돼 있고 화면이 보이면 다른 PC는 5초 안에 같은 값을 본다. 열린 창과 터미널 기록은 PC별로 남긴다.

## 2. 사용자 결정 (2026-11-10)

| # | 질문 | 결정 |
| --- | --- | --- |
| U-1 | 어디까지 노드 소유인가 | 바탕 구성만 노드: `icons`, `prefs` 전체, 배경 그림. 열린 창·창 순서·전체화면·선택 탭·파일 관리자 위치는 PC별 |
| U-2 | 계정별로 나누는가 | 노드당 하나. `node.control` 권한자가 바꾸면 모두에게 같게 보인다 |
| U-3 | 터미널 기록(`tterm`, `ttHist`) | PC별, 이 브라우저만. 계정 문서로도 올리지 않는다 |
| U-4 | 지금 PC마다 다른 값 | 옮기지 않고 버린 뒤 기본값부터 시작한다 |

## 3. 지금 무엇이 잘못돼 있나

| 사실 | 근거 |
| --- | --- |
| 바탕 구성은 "보기 상태"로 분류돼 노드 데이터에서 빠졌다 | `E:1235`, `E:1284-1287` |
| 저장은 브라우저 사본과 계정 문서이고, PUT은 `force: true`이며 실패를 버린다 | `TP:71-75` |
| 읽기는 로그인 뒤 한 번뿐이고 기다리지도 않는다. 첫 값은 영구 캐시된다 | `TP:77-87`, `web/src/boot/main.js:206`, `T:178` |
| "화면 배치 저장됨"은 500ms 타이머로 켜진다. PUT은 그 800ms 뒤에 나가고 결과를 보지 않는다 | `E:1303-1308`, `E:2575-2577`, `TP:74` |
| 서버 Master의 `user_documents`에 gui-v3 문서는 0건이다. 전체 1건은 옛 `app:lab.stellaxia.node-gui.web`(10-22) | 실측 |
| **리프 제어기의 저장은 처음부터 성공할 수 없었다** (§11) | 키 `view/desk.P1:이름`이 Master 키 규칙에 어긋난다 |
| 배경 그림은 `terra.wall.<표시 이름>`으로 브라우저에만 있다. `prefs.wall='img'`만 다른 곳으로 가면 그림이 없어 노을로 떨어진다 | `E:1326-1335`, `E:2195` |
| 저장 키와 사본 키가 장면 id라 노드 추가·개명으로 밀린다 | `T<순번>`, `P<순번>:<표시 이름>` (`Scene.dc.html:2089`, `:2092`), 노드 정렬은 표시 이름 기준 (`web/src/api/topology.js:39-44`) |

## 4. 전수 분류

**노드 소유**는 그 노드에 원본이 있고, **사람 소유**는 계정을 따라가며, **PC 소유**는 그 브라우저에 머문다. **사본**은 노드 값의 캐시다.

| 항목 | 지금 위치 | 근거 | 소유 | 이 작업에서 |
| --- | --- | --- | --- | --- |
| `icons`, `prefs`(dark, wall, wallFit, dock, snap, anim) | 브라우저 `terra.view.desk.*` + 계정 문서 | `E:1255-1266` | **노드** | 옮긴다 (§6) |
| 배경 그림 `terra.wall.<이름>` | 브라우저 | `E:1326` | **노드** | 옮긴다 (§6.3) |
| `wins`, `order`, `full`, `setTab`, `fmLoc`, `modView`, `modSel`, `modTab`, `resTab`, `devSel`, `cfgGrp` | 브라우저 + 계정 문서 | `E:1235` | PC | 브라우저만, 키는 `node_id` (§5) |
| `tterm`(600줄), `ttHist`(200개) | 브라우저 + 계정 문서 | `E:1792`, `E:1822` | PC (U-3) | 브라우저만, 계정 구분 키, 로그아웃 때 지움 (§5) |
| `terra.cache` | 브라우저 | `T:51`, `T:58` | 사본 | 구조는 유지. `nodedesk` 항목은 `node_id`로 묶는다 (§9.2) |
| IndexedDB `terra.node-blobs` | 브라우저 | `T:21-28` | 사본 | 그대로. 배경 그림 사본도 여기 든다 |
| 프로필·스킨 | 노드 `properties.json` | `node-owned-data.md` | 노드 | 갱신 주기만 보강 (§8) |
| 스타메이커 보관함 `terra.star.*` | 브라우저 | `parts/starmaker/script.js:23-25` | 사람 | 범위 밖. `node-owned-data.md` §5에 있다 |
| 도움말 `terra.help` | 브라우저 | `E:1336`, `parts/nodeconf/script.js:29` | 사람(경계) | 그대로 |
| GUI 전체 테마 `terra.theme` (#189) | 브라우저 | `web/src/ui/theme.js:4`, `web/src/boot/main.js:37` | PC | 그대로. 제어기의 `prefs.dark`와 다른 값이다 |
| `terra.auto`, `terra.sess`, `terra.login.email` | 브라우저 | `Scene.dc.html:3125-3126`, `web/src/boot/main.js:160` | PC | 그대로. 토큰 아님 |
| `terra.handle`(sessionStorage), 앱 토큰(메모리) | 탭 | `web/src/api/session.js:9` | 탭 | 그대로 |
| 알림 읽음, 웹 브라우저 앱 기록, 제어기 슬롯 | 메모리 | `web/src/api/alarms.js:8` | 저장 안 함 | 그대로 |
| `terra.mod.st`, `terra.mock.*` | 시안 전용 | `parts/modstatus/script.js:21-23` | 없음 | 실제 빌드에 안 닿는다 |
| 설정 창의 표시·뷰 칸 | 창 안에서만 | `parts/nodeconf/script.js:213-217` | 미정 | 저장이 없어 PC 간 차이도 없다. 범위 밖 |
| 바탕화면 "새 폴더" | `icons` 항목뿐 | `E:2293-2295` | 노드 | 아이콘은 옮겨진다. 실제 폴더를 안 만드는 문제는 §15 |

**다른 활성 모듈.** nodetalk, agent, sample.window, scene.main-test, fleet의 소스에는 브라우저 저장 사용이 없다. agent는 저장 금지 시험이 있고(`web/tests/no-html-insertion.test.ts:25`), fleet은 내부 상태 전수는 읽지 못했다. dev.terrallo와 leaf 모듈에는 웹 GUI가 없다. `tree/lab.stellaxia.treebench`의 `treebench.ledger.v1`(`ui/treebench.js:27`)은 시험 장부라 PC 소유로 둔다. `lab.stellaxia.node-gui`는 저장소에 남아 있지만(0.4.6, main을 선언하지 않음) Terra `installer-modules.json`에 핀이 없어 기본 설치에서 빠지므로 제외한다.

## 5. PC 소유 상태

키는 장면 id 대신 Terra `node_id`를 쓴다. `node_id`가 없는 자리(계정, 리소스, 시안 노드)는 저장하지 않는다.

| 키 | 값 | 지우는 때 |
| --- | --- | --- |
| `terra.pc.desk.<node_id>` | 창·순서·전체화면·탭·위치 | 지우지 않음 |
| `terra.pc.term.<principal>.<node_id>` | `tterm`, `ttHist` | 로그아웃 때 그 계정 것을 지운다 |

터미널 기록을 PC에 두는 이유는 입력이 그대로 남고(`ttHist`), 출력에 권한 목록·노드 정보가 있으며(`web/src/api/shells.js:154-205`), 노드에 두면 `node.read`만 가진 사람도 읽게 되기 때문이다.

삭제 경로는 `sceneLogout`, `appLogout`, `onToken(null)` 셋이다(`web/src/boot/main.js:214`, `:221`, `:243`). 셋 모두에서 저장 타이머를 먼저 취소하고 지운다. `principal`은 `TerraWho`로 늦게 오고 실패할 수 있으므로(`:207`), 모르면 쓰지 않는다.

## 6. 저장 위치와 operation

### 6.1 새 operation 둘

| operation | 바인딩 | 입력 | 출력 | 권한 | scopes |
| --- | --- | --- | --- | --- | --- |
| `node-desk.get` | GET `/node/desk` | `since_revision?` | `{revision, doc}`, `since_revision == revision`이면 `{revision, unchanged: true}`, 없으면 `{revision: 0, doc: null}` | `node.read` | local, node, cluster |
| `node-desk.patch` | PATCH `/node/desk` | `{base_revision, set: {경로: 값 \| null}}` | `{revision, doc}`, 충돌이면 409 `REVISION_CONFLICT`(`details.keys`) | `node.control` | local, node, cluster |

`since_revision`은 Gateway와 Daemon이 같은 입력 매핑으로 쿼리에 싣는다(`GW/server.go`의 `buildUpstreamTarget`, 원격은 `LD/remoteop`의 `BuildOperationTarget`). 409는 `CHUNK_OUT_OF_ORDER`와 같은 길로 코드가 보존되어 `TerraError`까지 온다. 분할 판정은 코드 기준이라 분할로 오해되지 않는다.

`node-props`를 넓히지 않는 이유는 셋이다. 첫째, `properties.json`은 64 KiB를 프로필·스킨과 나누고 revision이 없다(`src/nodedata/store.go:73`, `:531-576`). 둘째, 새 operation은 있는지 없는지가 곧 버전 신호다(§13). `status.get`의 version은 0.1.0으로 고정이고 `cluster` scope도 없어 쓸 수 없다(`src/main.go:24`). 셋째, 잘못 넣으면 지금 있는 프로필·스킨까지 영향을 받는다.

권한은 프로필·스킨과 같은 이유로 `node.read`, `node.control`이다(`node-owned-data.md` §2). 앱 토큰으로 호출할 수 있고, ADR-GW-012 차단 대상이 아니다.

### 6.2 저장 모양

`node-data/desk.json` 한 파일에, `writeAtomic`(임시 파일 후 rename, `store.go:621-644`)과 같은 Store 잠금으로 쓴다.

```text
{ "revision": 12,
  "doc": { "icons": { "<id>": {c, r, name, k, loc?, app?, mod?, src?} },
           "prefs": { dark, wall, wallFit, dock, snap, anim },
           "wall":  { file, name, type, at } | null },
  "revs": { "icons.home": 12, "prefs.dock": 7, "wall": 3 },
  "revs_floor": 0 }
```

허용 경로는 `icons.<id>`, `prefs.<필드>`, `wall` 뿐이다. `<id>`는 `^[a-z0-9][a-z0-9_-]{0,63}$`, 아이콘은 256개까지, 문서 전체는 64 KiB까지다. 응답이 768 KiB 상한(`terra-protocol/node_operation.go:25`)에 닿지 않는다. prefs 필드와 아이콘 값의 타입은 화이트리스트로 검사한다.

`desk.json`은 `properties.json`처럼 예약한다. 지금 예약된 이름은 `properties.json`뿐이라(`store.go:160`), 그대로 두면 `node-files`로 지우거나 덮을 수 있다. `clean`과 `List`에서 막고 get·put·delete 거절을 시험한다.

### 6.3 배경 그림

JSON에 넣지 않고 기존 `node-files`로 `desk/wall/<시각>.<확장자>`에 둔다. 파일 이름에 원래 이름을 쓰지 않는 이유는 세그먼트 128바이트 제한(`store.go:75-76`)과 경로 절단(`T:18`) 때문이다. 원래 이름은 `wall.name`에만 둔다. 2.5 MiB는 640 KiB 청크 4번으로 올라가고 480 KiB씩 약 6번으로 읽힌다(`store.go:54`, `src/api.go:35`). 2.5 MiB 상한은 유지한다.

| 단계 | 할 일 |
| --- | --- |
| 고를 때 | png, jpeg, gif, webp만 받는다. 지금 `wallPick`은 `image/*`를 다 받아(`E:1330`) 서버가 415로 거절하게 된다 |
| 올리기 | `putNodeFile`과 `blob`을 재사용한다. `setNodeFile`은 `node-props`에 묶여 있어 재사용하지 않는다(`T:154-169`). 받기용 전용 함수를 새로 만든다 |
| 패치 | `{wall, prefs.wall: 'img'}`를 한 패치로 보낸다 |
| 정리 | 패치 성공 뒤 `desk/wall/`에서 `wall.file`을 뺀 나머지를 지운다. 실패한 시도의 잔재도 이때 사라진다 |
| 검사 | 패치에서 `wall.file`이 `desk/wall/` 아래 실제 파일인지 본다. `checkFileRef`는 필드가 하나인 값만 받으므로(`store.go:587-591`) 새로 쓴다 |
| 표시 | 그림을 받는 동안 "배경 불러오는 중"으로 두고 노을로 떨어뜨리지 않는다. 경로에 시각이 있어 IndexedDB 사본이 낡지 않는다 |

### 6.4 처음 쓰는 노드

`doc: null`이면 보드의 기본값을 보여 주되 "이 노드에 아직 저장 안 됨"으로 표시한다. 첫 변경은 `base_revision: 0`으로 기본값 전체와 변경을 함께 보낸다. 삭제한 기본 아이콘이 되살아나지 않게 하기 위해서다. 시안 아이콘 `backup.tar`는 기본값에서 뺀다(`E:1261`).

## 7. 동시 수정

전체 덮어쓰기를 없앤다. 서버가 키마다 마지막으로 바뀐 revision을 든다.

| 규칙 | 내용 |
| --- | --- |
| 판정 | 패치의 각 키에 대해 `(revs[키] ?? revs_floor) > base_revision`이면 전체를 409로 거절하고 `details.keys`에 충돌 키를 싣는다 |
| 필수값 | `base_revision`은 필수다. 없으면 400. 현재 revision보다 크면(파일 복원, 재설치) 409 |
| 삭제 | `null`도 `revs`에 기록한다. 삭제 기록은 512개까지 두고, 넘치면 오래된 것부터 버리며 `revs_floor`를 그 값으로 올린다 |
| 첫 쓰기 | revision 0의 패치는 `prefs` 필드 전부와 `icons`를 포함해야 한다 |
| 읽기 | `since_revision`이 현재와 다르면(작든 크든) 전체를 돌려준다 |

| 경우 | 결과 |
| --- | --- |
| 다른 키 (A는 아이콘, B는 독) | 둘 다 성공하고 합쳐진다 |
| 같은 키 (둘 다 같은 아이콘 이동) | 먼저 도착한 쪽이 이긴다. 나중 쪽은 409를 받고 곧바로 다시 읽어 노드 값으로 돌아가며 "다른 곳에서 먼저 바뀌었습니다"를 띄운다 |
| 합본에 충돌 키와 다른 키가 섞임 | 충돌 키만 잃었다고 표시한다. 나머지는 새 revision으로 한 번 자동 재전송한다 |
| 같은 칸에 다른 아이콘 둘 | 저장은 둘 다 성공한다. 표시할 때 다음 빈 칸으로 밀어 그린다. 저장값은 바꾸지 않는다 |

잠금은 Store 뮤텍스(`store.go:106`)로 충분하다. §9의 경로 규칙으로 쓰는 프로세스가 하나이기 때문이다.

## 8. 갱신: 연결 중에 안 보이는 시간을 없앤다

**TTL만으로는 안 된다.** `read`는 화면을 다시 그릴 때만 갱신을 시작하는데, 제어기에는 주기적 재렌더가 없다(`T:64-69`). **다른 노드의 밀어 받기는 없다.** 노드 주소 호출은 스트림을 막고(`LD/remoteop/handler.go:302-304`), Master 이벤트는 앱 토큰으로 못 읽으며(`web/src/api/master-delegated.json`에 없음), `terra.node.signal`은 고정 5종이다(`MS/nodesignal/ingest.go:43-49`).

그래서 `TerraNodes`에 타이머를 둔다.

| 시점 | 동작 |
| --- | --- |
| 제어기를 열 때, 노드를 바꿀 때 | 바로 읽는다 |
| 열린 제어기가 있고 탭이 보일 때 | 5초마다 `since_revision`으로 묻는다. 같은 노드를 두 창에서 열어도 합쳐서 한 번이다 |
| 탭이 다시 보일 때, 창에 포커스가 올 때 | 바로 읽는다 |
| 탭이 숨겨져 있을 때 | 묻지 않는다. 보이면 위 규칙으로 즉시 읽는다 |
| 내가 쓴 뒤 | 응답의 `doc`으로 바꾼다 |

**구현 조건.**

- `nodedesk`는 `read`의 일반 경로를 쓰지 않는다. 입력을 캐시 키에 넣으면 revision마다 항목이 새로 생기고(`T:55`), `refresh`는 응답을 그대로 저장해 `unchanged` 응답이 문서를 덮기 때문이다(`T:74`). 전용 fetch가 캐시 키에 입력을 넣지 않고, `unchanged`면 `data`를 두고 `at`만 갱신한다.
- 슬롯 보드는 닫아도 마운트돼 있어(`Scene.dc.html:3041`, `E:1290`) "열린 제어기"를 Embed가 알 수 없다. Scene이 열고 닫을 때 `TerraNodes.watch(node_id)`와 `unwatch`를 부른다. 최소화한 창은 열린 것으로 친다.
- 타이머는 `retryAt`과 `errAt`에 걸리지 않도록 `read`가 아니라 fetch를 직접 부른다(`T:66-67`, `T:79`). 재시도 간격은 코드별로 정한다. 끊김은 5초, 옛 버전(§13)은 60초다.
- 끊기기 전에 나간 호출이 최대 20초 걸려 있을 수 있으므로(`GW/broker.go:141`, `:145`) 폴링에 8초 abort를 둔다. `terra.invoke`에 signal 인자가 필요하다.
- 늦게 온 응답은 **요청 순번**으로 거른다. 마지막으로 반영한 요청보다 먼저 출발한 응답은 버린다. revision 비교를 쓰지 않는 까닭은 파일 복원처럼 revision이 줄어드는 경우에 영구히 낡기 때문이다. 콜백은 `node_id`가 같을 때만 화면에 반영한다.
- `TerraNodes.clear()`는 합본 대기열과 진행 중 표시를 비우고 세대(`gen`)를 올린다. 세대가 다른 응답은 버린다. 지금은 로그아웃 뒤 도착한 응답이 다음 사람의 캐시에 들어갈 수 있다(`T:74`, `T:176`, `web/src/boot/main.js:240-245`). `watch` 목록은 토큰 갱신 때 유지하고, 로그아웃은 Scene이 슬롯을 닫으며 정리한다.

연결돼 있고 화면이 보이는 동안 낡을 수 있는 시간의 상한은 **5초 + 왕복**이고, 재연결 직후의 상한은 **5초 + 폴링 제한 8초 = 13초**다. 프로필·스킨(`props`, TTL 60초)도 같은 타이머에 30초 주기로 올린다.

## 9. 원본 인스턴스

### 9.1 어느 쪽이 원본인가

서버에는 gui-v3가 둘 돌고 데이터가 나뉘어 있다(실측).

| 부모 | 데이터 디렉터리 |
| --- | --- |
| `terra-daemon` | `~/.terra/terra/module-data/lab.stellaxia.gui-v3` |
| `terra-master` | `~/.terra-master/terra/module-data/lab.stellaxia.gui-v3` |

**규칙: 그 노드의 원본은 Daemon 쪽 인스턴스다.** 다른 노드에서 오는 호출은 이미 그쪽으로만 간다. `tree-host` 카탈로그에는 계약 operation이 없어 `LocalOperation`이 거짓이고(`terra-module-host/manager.go:1225`, `MS/modulecatalog/node_operation.go:221-226`), #354도 Daemon 보고만 고쳤다. 나중에 `tree-host` 카탈로그가 넓어지면 이 경로가 바뀌므로 회귀 시험을 둔다.

로컬 경로는 페이지를 낸 Gateway의 인스턴스로 간다(`GW/server.go:513`).

| 페이지 | 대상 노드 | 길 |
| --- | --- | --- |
| Leaf Gateway | 그 노드 (`TerraTopology.localId === node_id`) | 로컬 경로. Daemon 인스턴스로 간다. 지도를 이미 받은 페이지는 Master가 끊겨도 자기 노드를 고칠 수 있다. 처음 열 때 Master가 끊겨 있으면 지도가 없어 제어기도 없다(`topology.js:120`) |
| Tree Gateway | 서버 노드 | Tree Gateway의 정적 provider는 `terra.master`뿐이라(`MS/gatewayservice/service.go:284-313`) `terra.daemon.status.get`이 실패하고, `localId`가 비어(`topology.js:117`, `:123`) 노드 경로로 Daemon 인스턴스에 간다. 지금 `realId` 그대로 성립한다 |
| 그 외 | `node_id`가 있는 노드 | `/api/v1/nodes/{node_id}/operations/…` |
| 어디서든 | `node_id`가 없는 자리 | 부르지 않는다. 기본값, 읽기 전용. 계정 루트가 `sceneLocal`이 되는 경우(`Scene.dc.html:3109`)도 막는다 |

같은 규칙을 `node-props`·`node-files`에도 적용한다. Daemon 없는 Tree 노드는 원격에서 `OPERATION_NOT_REMOTE`이므로 §13과 같이 읽기 전용이다. 지금 그런 노드는 없다.

### 9.2 노드 식별

장면 id를 없앤다. 슬롯의 `ctlKey`는 창을 열 때 한 번만 정해지는데(`Scene.dc.html:2946`), 노드가 추가돼 순번이 밀리면 `meta['T3'].rid`만 다른 노드로 바뀌어 제목은 옛 노드인 채로 다른 노드를 읽고 쓸 수 있다(`TP:40`, `E:1361`). 창을 열 때 `node_id`를 `node-rid` prop으로 고정해 넘기고, Embed의 묶음 키, `nodedesk` 사본 키, 전송 대상을 모두 `node_id`로 한다.

## 10. 쓰기 순서와 체감

**표시되는 값은 언제나 그 노드가 준 값이다.** 진행 중인 변경은 사본이 아니라 그 위에 얹는 표시층에만 있다. 표시층은 `TerraNodes.pendingDesk` Map에 두고 저장하지 않는다. 캐시 항목에 넣으면 `persist`가 통째로 `localStorage`에 써서(`T:51`, `T:58`) 다음 실행에서 되살아난다.

| 단계 | 화면 |
| --- | --- |
| 드래그 중 | 드래그 층만 움직인다(`ov`, `E:1768`). 노드 저장 경로를 타지 않는다 |
| 드롭, 토글 | 아이콘을 새 자리에 반투명으로 그리고 "그 노드에 저장 중…"을 띄운다 (`dropIcon`, `E:1770-1776`) |
| 성공 응답 | 응답의 `doc`으로 바꾸고 반투명을 없앤다. "그 노드에 저장됨 · 시각" |
| 실패, 충돌 | 반투명을 없애 노드 값으로 돌아가고 이유를 그대로 보인다 |

드래그 중 다른 곳에서 지워진 아이콘을 드롭하면 `{c, r}`만 든 항목이 생기지 않게 막는다.

**묶어 보내기.** 사람의 조작 한 번이 패치 하나다. 노드마다 전송 중인 패치는 하나만 두고, 그동안 생긴 변경은 키별 최신값으로 합쳐 다음 패치로 보낸다. 디바운스 타이머는 쓰지 않는다. 응답 전에 페이지를 닫으면 보내지 못한 합본은 사라지며, 사본과 저장소 어디에도 그 값이 없으므로 거짓 표시는 없다.

**`TerraNodes.write`의 낙관 반영은 사본에서 전부 없앤다.** 지금은 `apply` 결과를 사본에 넣고 성공하면 `e.at=now`로 신선하게 표시한다(`T:104-106`). 이어지는 refresh가 실패하면 낙관 값이 `src:'노드'`로 남고, 실패 롤백은 `prev`로 되돌려 그 사이의 새 값을 덮을 수 있다(`T:107`). 다음처럼 바꾼다.

- `apply`는 저장되지 않는 표시층에만 적용하고 `e.data`는 건드리지 않는다. `read`는 `data`(노드 값)와 `view`(표시층 적용), `pending`을 함께 돌려준다.
- 화면은 진행 중인 행에 "적용 중"을 표시한다. `pending` 필드는 이미 있지만 읽는 곳이 없다.
- 성공해도 `at`을 바꾸지 않는다. 노드에서 다시 읽은 값만 사본이 된다.
- `ndSet`이 실패를 `undefined`로 삼켜 호출자가 성공 문구를 먼저 띄우는 일(`E:1540-1541`, `E:1601`, `E:2486`)을 고친다.
- 입력 초안 `draft`는 노드로 보내지 않는 값이라 그대로 둔다.

`ndSet` 호출이 있는 줄이 33개라(정의 포함) S4로 따로 묶는다.

## 11. 저장 정직성과 계정 문서

| 표시 | 언제 |
| --- | --- |
| 그 노드에 저장 중… | 패치가 나가 있거나 대기 중 |
| 그 노드에 저장됨 · 시각 | 성공 응답을 받은 뒤에만 |
| 저장 못 함 — 코드 · 다시 시도 | 실패. 사라지지 않고 남는다 |
| 끊김 · 읽기 전용 · 언제 사본 | 분할 |
| 이 노드에 아직 저장 안 됨 | `revision: 0` |

PC 소유 항목에는 저장 표시를 달지 않는다. 설정 창의 "다른 기기에서도 같은 바탕화면"(`E:2323`)은 노드 항목에만 붙인다.

**계정 문서 경로는 제어기에서 없앤다.** U-1, U-3 뒤로 제어기가 계정 문서에 둘 것이 없고, 호출자는 `E`의 `desk.*`뿐이다. `TP`의 `saveView`·`ready`, `web/src/boot/main.js:206`, 시험의 해당 단정을 지운다. 스타메이커 같은 사람 소유 데이터를 옮길 때는 그때 실패를 드러내는 저장을 새로 만든다.

**왜 실패했는지.** 리프의 키는 `P<n>:<표시 이름>`이고(`Scene.dc.html:2092`), `ctlKey`가 그대로 키가 된다(`Scene.dc.html:2946`). `:`는 Master 키 규칙 `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`에 없어(`MS/api/routes_documents.go:62`, `:120`) 400 `INVALID_REQUEST`로 거절된다. 지휘 세션이 Gateway 감사 로그에서 키 `view/desk.P1:MARUI-NANO-DESK`의 400을 27건 확인했다. 같은 패턴을 코드와 똑같이 재현하면 `view/desk.P1:marui-desktop`은 거짓, `view/desk.T1`은 참이다. 가짜 Gateway가 항상 성공을 돌려줘 시험에서 드러나지 않았다(`web/tests/smoke.mjs:27`).

Tree 키(`T<n>`)는 규칙을 통과하지만 그 PUT이 실제로 있었는지와 결과는 확인하지 못했다. 경로를 없애므로 이 작업의 선행은 아니다. 다만 Master 세션 조건은 새 경로에도 있다(`GW/node_operations.go:171-176`). 새 경로는 실패 코드를 화면에 드러내므로 같은 원인이면 바로 보인다.

## 12. 분할

| 상황 | 동작 |
| --- | --- |
| 끊김 판정 | 기존 `NODE_OFFLINE`, `RELAY_NOT_CONNECTED`, `NETWORK`, `TIMEOUT`, `GATEWAY_UNREACHABLE`(`T:45`)에 **`UPSTREAM_UNREACHABLE`, `MODULE_INVOCATION_TIMEOUT`, `RELAY_SEND_FAILED`를 추가한다**. 망이 끊긴 PC에서 실제로 오는 코드인데 지금 목록에 없어(`GW/errors.go:19`, `:47`, `MS/api/routes_node_operations.go`) 링크가 online으로 남는다 |
| 표시 | 마지막으로 받은 사본을 "끊김 · 언제 사본 · 읽기 전용"으로. 사본이 없으면 기본값을 "끊김 · 사본 없음"으로. 노드 값처럼 보이게 하지 않는다 |
| 쓰기 | 드래그 시작과 설정 칸을 잠근다. 잠금을 지나 호출돼도 `PARTITIONED`로 즉시 거절한다(`T:103`). 대기열이 없다 |
| PC 항목 | 창 이동 등은 그대로 된다. 노드 값이 아니다 |
| 전송 중 끊김 | 실패로 처리한다. 합본 대기분은 버리고 "저장 못 함"을 띄운다. 재연결 때 몰래 보내지 않는다 |
| 재연결 | 타이머가 성공하면 13초 안에 노드 값으로 바뀐다. 분할 중 다른 곳에서 바뀐 값도 함께 온다 |

## 13. 섞인 버전

새 GUI는 옛 gui-v3가 도는 노드를 부를 수 있다. 페이지는 로컬 모듈이 내므로 로컬 경로는 항상 같은 버전이다. **코드로 판정하고 HTTP 상태는 보지 않는다.** #354 이후 `OPERATION_NOT_REMOTE`는 404와 403 둘 다로 온다.

| 코드 | 뜻 | 동작 |
| --- | --- | --- |
| `OPERATION_NOT_REMOTE` | 옛 모듈, 또는 #354 이전 Daemon | 기본값, 읽기 전용, "이 노드의 gui-v3가 옛 버전이라 바탕 구성을 읽고 쓸 수 없습니다". 60초마다 다시 시도 |
| `MODULE_ROUTE_NOT_FOUND` | 로컬인데 경로 없음 | 위와 같음 |
| `MODULE_UNAVAILABLE` | 그 노드의 모듈이 멈춤 | 마지막 사본, 읽기 전용, "그 노드의 gui-v3가 꺼져 있음". 5초마다 다시 시도 |
| `MODULE_PERMISSION_DENIED` | 권한 없음 | 읽기 전용, 이유 표시. 쓰기 권한만 없으면 읽기는 된다 |
| `DELEGATION_REQUIRED`, `NODE_NOT_FOUND` | 기존 처리 | `T:82-83` 그대로 |

계정 문서나 브라우저 저장으로 되돌아가지 않는다. 옛 GUI는 새 operation을 부르지 않으므로 지금처럼 자기 브라우저에만 저장하고, 새 노드의 원본을 건드리지 않는다.

`module.json`의 버전을 반드시 올린다. Daemon의 계약 색인 캐시 키에 모듈 버전이 들어 있어 안 올리면 새 operation이 안 읽힐 수 있다(`LD/remoteop/modules.go`의 `contract()`).

## 14. 이행 (U-4)

새 GUI가 처음 돌 때 한 번, `terra.view.desk.*`와 `terra.wall.*`를 지운다(`terra.pc.migrated=1`로 표시). 이 두 접두사는 다른 키와 겹치지 않는다. 창 배치와 터미널 기록은 옛 키가 장면 id라 믿을 수 없고, 나눠 옮길 값어치보다 코드가 많아 함께 버린다. 옛 키로 쓰인 계정 문서는 서버에 없으므로(실측 0건) 서버 쪽 정리는 필요 없다. 릴리스 노트에 "제어기 아이콘·배경이 기본값으로 돌아갑니다"를 적는다.

## 15. 남은 위험

| 위험 | 수준 | 대응 |
| --- | --- | --- |
| 폴링이 Master 감사 기록을 늘린다 | 중간 | 중계 호출마다 `audit_logs` 한 행이다(`MS/api/routes_node_operations.go:245-275`). 보이는 제어기 하나당 시간 720행, 하루 종일이면 17,280행이다. 실측 지금 하루 36,966행, 누적 약 158만 행이고 정리 코드는 찾지 못했다. V9에서 잰다. 변화 없는 읽기를 감사에서 빼는 것은 Terra 변경이라 후속 판단이다 |
| 폴링이 Master 릴레이에 얹힌다 | 낮음 | 보이는 열린 제어기당 한 호출, 변화 없으면 응답 몇 바이트. V9에서 잰다 |
| Tree 인스턴스의 로컬 경로를 GUI 아닌 도구가 부르면 다른 데이터를 본다 | 낮음 | GUI는 부르지 않는다. 막으려면 Terra가 호스트 종류를 모듈에 알려야 한다 |
| 원격 호출은 Master 세션이 필요하다 | 중간 | 없으면 자기 노드만 쓸 수 있다. 실패 코드가 화면에 뜬다 |
| 드롭 후 반투명 시간이 길다 | 중간 | 왕복을 V1에서 잰다. 아직 실측값이 없다 |
| 응답 없는 노드에서 저장이 오래 걸린다 | 낮음 | 원격 호출은 최대 20초(Gateway 기본, `GW/node_operations.go:141-147`). 지난 뒤 실패 표시. 설치본의 `--invoke-timeout` 값은 확인하지 못했다 |
| `modSel`·`devSel`이 목록 인덱스다 | 낮음 | PC 소유로 남는 기존 결함. 범위 밖 |
| "새 폴더"가 실제 폴더를 만들지 않는다 | 낮음 | 아이콘은 노드로 간다. 실제 생성은 별건 |

## 16. 실행 계획

| 단계 | 내용 | 바뀌는 파일 | 선행 | 완료 기준 | 세션 |
| --- | --- | --- | --- | --- | --- |
| S1 | 백엔드 `node-desk.*`, revs 충돌, 경로·타입 검사, `desk.json` 예약, wall 검사 | `src/nodedata/desk.go`(새), `src/nodedata/store.go`, `src/api.go`(`writeStoreError`에 `REVISION_CONFLICT`), `src/*_test.go`, `contracts/api/terra-api.json`(operation·errors), `module.json`, `src/main.go`(0.1.0 고정 정리) | 이 문서 승인 | Go 시험: 다른 키 병합, 같은 키 409, 삭제 뒤 이동 409, `revs_floor`, 필수 `base_revision`, 첫 쓰기 형태, 동시 goroutine, 64 KiB, 허용 경로, `since_revision` 세 경우, `desk.json` 접근 거절. 계약과 라우터 대조 시험 추가 | 가 |
| S2 | `TerraNodes`: 전용 `nodedesk` fetch, `patchDesk`(전송 하나+합본), 표시층, `watch`/`unwatch`, 코드별 재시도, 분할 코드 추가, 요청 순번, `gen`, `node_id` 키. `transport`의 경로 규칙과 signal | `parts/terranodes/script.js`, 구운 `TerraNodes.dc.html`, `web/src/api/terra.js`, `web/src/api/transport.js`, `web/tests/node-owned-desk.test.mjs`(새), `web/tests/node-data.test.mjs`, `web/tests/node-switch.test.mjs` | S1 계약 | 시험: 응답 전 사본 불변, 합본, 충돌 복귀, 타이머·가시성, 코드별 판정, 늦은 응답 버림, `clear` 뒤 응답 버림, 분할 시 대기 없음. `tree-host` 경로 회귀 | 나 |
| S3 | 제어기 분리: 노드 키/PC 키, 표시층, 저장 표시, 배경 그림, 분할 잠금, `node-rid` 전달, `watch` 호출, 계정 문서 제거, 이행 삭제 | `E`, `Scene.dc.html`, `Field.dc.html`, `build/mkglobal.py`, `build/gf_scene_methods.js`, `parts/terranodes/script.js`(`view`·`setView`), `web/src/api/transport.js`, `web/src/api/transport.test.mjs`, `web/src/boot/main.js`, `web/tests/smoke.mjs`, `web/README.md`, `Sheet.dc.html` | S2 | 가짜 Gateway를 상태 있게 바꾼 Playwright 두 컨텍스트 시험이 통과하고 저장 실패가 화면에 남는다. `npm test`는 smoke를 돌리지 않으므로 빌드 후 직접 돌려 결과를 PR에 적는다 | 나 |
| S4 | `TerraNodes.write` 낙관 제거, `ndSet` 실패 전달, 행 "적용 중" | `parts/terranodes/script.js`, `E`, `parts/modstatus/script.js`, 구운 `TerraNodes.dc.html`·`ModStatus.dc.html`, 관련 시험 | S2, S3 병합 | 실패 시 성공 문구 없음, 응답 전 사본 불변, `no-fake-success` 시험 갱신 | 다 |
| S5 | 문서: 이 문서 accepted, `node-owned-data.md`, `backend.md`, `README.md`, 릴리스 노트 | 문서 | S3 | 구현과 표가 일치 | 나 |
| S6 | 릴리스, 설치, 실기 | modules 태그, Terra 핀 | **Terra #354 설치본 포함**, S1~S5, **사용자 승인** | §17 전부 통과 | 지휘 |

보드를 구울 때는 `python3 build_parts.py terranodes modstatus`처럼 대상을 지정한다. 인자 없이 돌리면 12판 전체를 다시 굽는다. 세션 "가"와 "나"는 파일이 겹치지 않아 동시에 진행할 수 있다. "다"는 `script.js`와 `E`가 겹치므로 "나" 뒤에 한다. 단위 시험 초록은 S6의 입장권일 뿐 완료가 아니다.

## 17. 실기 검증

대상은 서버 노드, A는 데스크탑, B는 노트북이다. 설치본을 바꾼 뒤에만 의미가 있다.

| # | 절차 | 합격 증거 | 누가 |
| --- | --- | --- | --- |
| V0 | 서버 업데이트 전 A에서 서버 제어기를 연다 | 기본값, 읽기 전용, 옛 버전 안내. 서버에 파일 없음 | 에이전트 준비, A 조작은 사용자 |
| V1 **(노드 먼저)** | A에서 PATCH 응답을 지연시키고 아이콘을 옮긴다 | 응답 전 `terra.cache`의 `nodedesk`가 그대로이고 화면은 반투명. 서버 `desk.json`의 revision이 먼저 오른 뒤 확정 표시. 왕복 시간 기록 | A 조작 사용자, 서버 확인 에이전트(SSH 읽기) |
| V2 **(B 갱신)** | B를 켠 채로 둔다. 숨긴 탭도 따로 | 보이는 탭은 5초 안에 같은 자리. 숨긴 탭은 보일 때 즉시 | 사용자(노트북은 에이전트가 닿지 못함) |
| V3 **(저장 실패)** | A에서 패치 요청을 막고 옮긴다. 다음엔 `node.control` 없는 계정으로 시도한다 | "저장 못 함 — 코드"가 남고 아이콘이 원래 자리, 서버 revision 불변. 권한 없는 계정은 읽기는 되고 403 코드가 보인다 | 사용자 |
| V4 **(분할)** | 노트북 네트워크를 끊는다 | B에 "끊김 · 읽기 전용 · 언제 사본", 드래그 잠김, 창 이동은 됨, 요청이 쌓이지 않음. 받은 오류 코드를 기록 | 사용자 |
| V5 **(재연결)** | V4 동안 A에서 바꾼 뒤 노트북을 다시 연결한다 | B가 13초 안에 A의 값으로 바뀜. B가 끊긴 동안 한 조작이 나가지 않음 | 사용자, 서버 확인 에이전트 |
| V6 | B에서 `node-desk.get`을 막아 둔 채 A, B 순으로 같은 아이콘을 바꾸고, 다음엔 다른 항목을 바꾼다 | 같은 키는 B에 충돌 문구, 다른 키는 합쳐짐 | 사용자 |
| V7 | A에서 2.5 MiB GIF를 배경으로, B에서 확인, A에서 지움 | B에 같은 그림·움직임. 서버 `desk/wall/`에 파일 하나, 지운 뒤 0개 | 사용자, 서버 확인 에이전트 |
| V8 | 서버 Tree Gateway 페이지에서 서버 노드 제어기를 연다 | 원격과 같은 값. `~/.terra-master/.../node-data`에 `desk.json` 없음 | 에이전트(터널·로그인은 사용자) |
| V9 | 제어기 열어 두고 10분 | 호출 약 120회, `audit_logs` 증가량 기록, Master CPU 변화 없음 | 에이전트(읽기 전용) |
| V10 | 새 설치 첫 실행, 로그아웃 | 옛 `terra.view.desk.*`·`terra.wall.*` 사라짐, 로그아웃 후 터미널 기록 없음 | 사용자, A 브라우저는 에이전트도 가능 |
| V11 | 지도를 받은 A에서 Master와의 연결만 끊고 자기 노드를 바꾼다 | 로컬 경로로 저장 성공, 다른 노드는 읽기 전용 | 사용자 |

**에이전트가 직접 할 수 있는 것:** 서버 파일·프로세스·감사 수의 읽기 전용 확인, 이 PC 브라우저 동작 확인(로그인은 사용자), V8 준비, V9 측정. **사용자만 할 수 있는 것:** 노트북 조작과 네트워크 분리, 비밀번호 입력, 권한 없는 시험 계정 준비, 설치본 업데이트 승인. 에이전트가 할 수 있는 항목은 사용자에게 넘기기 전에 먼저 돌린다. 서버 프로세스를 멈추는 분할 시험은 쓰지 않는다.

## 18. 입력 정정과 작성 방법

| 받은 내용 | 확인 결과 |
| --- | --- |
| 저장 실패 원인을 못 찾았다 | 리프 키는 원인 확정(§11). Tree 키는 미확인 |
| 키는 노드 이름별 | 계정 문서 키는 장면 id, 배경은 표시 이름. 둘이 다르다 |
| `lab.stellaxia.node-gui`는 폐기 | 저장소에는 남아 있고 설치 핀에서만 빠졌다. 제외 판단은 같다 |
| 끊기면 기존 분할 코드로 잡힌다 | 망이 끊긴 PC의 실제 코드 셋이 빠져 있다(§12) |

Ruflo MCP 도구는 이 프로젝트에 연결돼 있지 않아 설치하거나 실행하지 않았다. 대신 Agent 서브에이전트로 역할을 나눴다(조사 셋, 리뷰 하나). 앞선 리뷰가 앱 종료로 끊겨 처음부터 다시 돌렸다. 리뷰 지적은 이 판에 반영했다.
