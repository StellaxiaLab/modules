---
title: "제어기 바탕 구성도 그 노드가 원본 — 설계와 실행 계획"
aliases:
  - "노드 소유 바탕 구성"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-10"
language: "ko-KR"
related:
  - "[[node-owned-data|노드의 GUI 데이터는 그 노드가 원본]]"
  - "[[node-data|노드 데이터 층]]"
  - "[[backend|v3 백엔드 설계]]"
---

# 제어기 바탕 구성도 그 노드가 원본

> 근거 표기. 코드 위치는 modules `origin/main` 6e12ccd, Terra `origin/main` 5d79ad69 기준이다. 약어는 `T` = `web/design/build/parts/terranodes/script.js`, `E` = `web/design/NodeDesktopEmbed.dc.html`, `TP` = `web/src/api/transport.js`, `GW` = Terra `products/common/apps/terra-gateway-service`, `MS` = Terra `products/tree/master/src/terra_master`. 실측은 2026-11-10 서버(`maruinano@192.168.0.21`)를 읽기 전용으로 본 결과다. 구현은 하지 않았다.

## 1. 한 줄

어떤 노드의 **바탕 구성**(아이콘, 배경, 독, 모양)은 **그 노드의 Daemon 쪽 gui-v3에 저장한다**. 어디서 바꾸든 그 노드를 먼저 고치고, 노드가 돌려준 값으로 표시한다. 다른 PC는 그 노드를 주기적으로 물어 5초 안에 같은 값을 본다. 열린 창과 터미널 기록은 PC별로 남긴다.

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
| 읽기는 로그인 뒤 한 번뿐이고 기다리지도 않는다. 첫 값은 영구 캐시된다 | `TP:77-87`, `web/src/boot/main.js:201`, `T:178` |
| "화면 배치 저장됨"은 500ms 타이머로 켜진다. PUT은 그 800ms 뒤에 나가고 결과를 보지 않는다 | `E:1303-1308`, `E:2575-2577`, `TP:74` |
| 서버 Master의 `user_documents`에 gui-v3 문서는 0건이다. 전체 1건은 옛 `app:lab.stellaxia.node-gui.web`(10-22) | 실측 |
| **리프 제어기의 저장은 처음부터 성공할 수 없었다** (§11) | 키 `view/desk.P1:이름`이 Master 키 규칙에 어긋난다 |
| 배경 그림은 `terra.wall.<표시 이름>`으로 브라우저에만 있다. `prefs.wall='img'`만 다른 곳으로 가면 그림이 없어 노을로 떨어진다 | `E:1326-1335`, `E:2195` |
| 저장 키가 장면 id라 노드 추가·개명으로 밀린다 | `T<순번>`, `P<순번>:<표시 이름>` (`Scene.dc.html:829`, `Scene.dc.html:2085-2088`), 노드 정렬은 표시 이름 기준 (`web/src/api/topology.js:39-43`) |

## 4. 전수 분류

저장 위치마다 소유자를 정한다. **노드 소유**는 그 노드에 원본이 있고, **사람 소유**는 계정을 따라가며, **PC 소유**는 그 브라우저에 머문다. **사본**은 노드 값의 캐시다.

| 항목 | 지금 위치 | 근거 | 소유 | 이 작업에서 |
| --- | --- | --- | --- | --- |
| `icons`, `prefs`(dark, wall, wallFit, dock, snap, anim) | 브라우저 `terra.view.desk.*` + 계정 문서 | `E:1255-1266` | **노드** | 옮긴다 (§6) |
| 배경 그림 `terra.wall.<이름>` | 브라우저 | `E:1326` | **노드** | 옮긴다 (§6.3) |
| `wins`, `order`, `full`, `setTab`, `fmLoc`, `modView`, `modSel`, `modTab`, `resTab`, `devSel`, `cfgGrp` | 브라우저 + 계정 문서 | `E:1235` | PC | 브라우저만, 키는 `node_id` (§5) |
| `tterm`(600줄), `ttHist`(200개) | 브라우저 + 계정 문서 | `E:1792`, `E:1822` | PC (U-3) | 브라우저만, 계정 구분 키, 로그아웃 때 지움 (§5) |
| `terra.cache` | 브라우저 | `T:51`, `T:58` | 사본 | 그대로. 바탕 구성 사본도 여기 든다 |
| IndexedDB `terra.node-blobs` | 브라우저 | `T:21-29` | 사본 | 그대로. 배경 그림 사본도 여기 든다 |
| 프로필·스킨 | 노드 `properties.json` | `node-owned-data.md` | 노드 | 갱신 주기만 보강 (§8) |
| 스타메이커 보관함 `terra.star.*` | 브라우저 | `parts/starmaker/script.js:23-25` | 사람 | 범위 밖. 이미 §5 표에 있다 |
| 도움말 `terra.help` | 브라우저 | `E:1336` | 사람(경계) | 그대로 |
| `terra.auto`, `terra.sess`, `terra.login.email` | 브라우저 | `Field.dc.html:881-882`, `web/src/boot/main.js:157` | PC | 그대로. 토큰 아님 |
| `terra.handle`(sessionStorage), 앱 토큰(메모리) | 탭 | `web/src/api/session.js:9` | 탭 | 그대로 |
| 알림 읽음, 웹 브라우저 앱 기록, 제어기 슬롯 | 메모리 | `web/src/api/alarms.js:8` | 저장 안 함 | 그대로 |
| `terra.mod.st`, `terra.mock.*` | 시안 전용 | `parts/modstatus/script.js:21-23` | 없음 | 실제 빌드에 안 닿는다 |
| 설정 창의 표시·뷰 칸 | 창 안에서만 | `parts/nodeconf/script.js:213-217` | 미정 | 저장이 없어 PC 간 차이도 없다. 범위 밖 |
| 바탕화면 "새 폴더" | `icons` 항목뿐 | `E:2293-2295` | 노드 | 아이콘은 옮겨진다. 실제 폴더는 안 만드는 문제는 §15 |

**다른 활성 모듈.** nodetalk, agent, sample.window, scene.main-test, fleet에는 저장 API 사용이 없다(grep 0건, fleet은 내부 상태 전수는 못 읽음). dev.terrallo와 leaf 모듈에는 웹 GUI가 없다. `tree/lab.stellaxia.treebench`의 `treebench.ledger.v1`(`ui/treebench.js:27`)은 시험 장부라 PC 소유로 둔다. `lab.stellaxia.node-gui`는 저장소에 남아 있지만(0.4.6, main을 선언하지 않음) Terra `installer-modules.json`에 핀이 없어 기본 설치에서 빠지므로 제외한다.

## 5. PC 소유 상태

키는 장면 id 대신 Terra `node_id`(`meta.rid`)를 쓴다. `rid`가 없는 자리(계정, 리소스, 시안 노드)는 저장하지 않는다.

| 키 | 값 | 지우는 때 |
| --- | --- | --- |
| `terra.pc.desk.<node_id>` | 창·순서·전체화면·탭·위치 | 지우지 않음 |
| `terra.pc.term.<principal>.<node_id>` | `tterm`, `ttHist` | 사용자가 로그아웃할 때 그 계정 것을 지운다 |

터미널 기록을 PC에 두는 근거는 입력이 그대로 남고(`ttHist`), 출력에 권한 목록·노드 정보가 있으며(`web/src/api/shells.js:154-205`), 노드에 두면 `node.read`만 가진 사람도 읽게 되기 때문이다. 계정 구분 키는 같은 브라우저의 다음 사람이 앞 사람 기록을 읽지 못하게 한다.

## 6. 저장 위치와 operation

### 6.1 새 operation 둘

| operation | 바인딩 | 입력 | 출력 | 권한 | scopes |
| --- | --- | --- | --- | --- | --- |
| `node-desk.get` | GET `/node/desk` | `since_revision?` | `{revision, doc}`, 변화 없으면 `{revision, unchanged: true}`, 아직 없으면 `{revision: 0, doc: null}` | `node.read` | local, node, cluster |
| `node-desk.patch` | PATCH `/node/desk` | `{base_revision, set: {경로: 값 \| null}}` | `{revision, doc}`, 충돌이면 409 `REVISION_CONFLICT` | `node.control` | local, node, cluster |

`node-props`를 넓히지 않는 이유는 셋이다. 첫째, `properties.json`은 64 KiB를 프로필·스킨과 나누고 revision이 없다(`src/nodedata/store.go:73`, `:531-576`). 둘째, 새 operation은 있는지 없는지가 곧 버전 신호다(§13). `status.get`의 version은 0.1.0으로 고정이고 `cluster` scope도 없어 신호로 못 쓴다(`src/main.go:24`). 셋째, 잘못 넣으면 지금 있는 프로필·스킨까지 영향을 받는다.

권한은 프로필·스킨과 같은 이유로 `node.read`, `node.control`이다(`node-owned-data.md` §2). 앱 토큰으로 호출할 수 있고, ADR-GW-012 차단 대상이 아니다.

### 6.2 저장 모양

`node-data/desk.json` 한 파일에, `writeAtomic`(임시 파일 후 rename, `store.go:621-644`)과 같은 Store 잠금으로 쓴다.

```text
{ "revision": 12,
  "doc": { "icons": { "<id>": {c, r, name, k, loc?, app?, mod?, src?} },
           "prefs": { dark, wall, wallFit, dock, snap, anim },
           "wall":  { file, name, type, at } | null },
  "revs": { "icons.home": 12, "prefs.dock": 7, "wall": 3 } }
```

허용 경로는 `icons.<id>`, `prefs.<필드>`, `wall` 뿐이다. `<id>`는 `^[a-z0-9][a-z0-9_-]{0,63}$`, 아이콘은 256개까지, 문서 전체는 64 KiB까지다. 응답이 768 KiB 상한(`terra-protocol/node_operation.go:25`)에 닿지 않는다.

### 6.3 배경 그림

JSON에 넣지 않고 기존 `node-files`로 `desk/wall/<시각>-<파일>`에 둔다. 2.5 MiB는 640 KiB 청크 4번으로 올라가고 480 KiB씩 약 6번으로 읽힌다(`store.go:54`, `src/api.go:35`). 2.5 MiB 상한은 유지한다. 허용 형식은 이미 png, jpeg, gif, webp이다(`store.go:81`).

순서는 프로필과 같다(`T:154-169`). 파일을 올리고, `wall` 경로를 패치하고, 성공한 뒤 지난 파일을 지운다. 패치에서 `wall.file`이 `desk/wall/` 아래 실제 파일을 가리키는지 백엔드가 검사한다(`profile`·`skin` 검사와 같은 자리, `store.go:553-562`). 패치까지 못 가서 남은 파일은 다음 배경 저장 때 `desk/wall/`을 비우며 지운다. 파일 경로에 시각이 들어 내용이 바뀌지 않으므로 IndexedDB 사본을 그대로 쓴다. 지금처럼 그릴 때마다 3 MB를 `JSON.parse`하는 일(`E:1327`, `E:2194`)도 사라진다.

### 6.4 처음 쓰는 노드

`doc: null`이면 보드의 기본값을 보여 주되 "이 노드에 아직 저장 안 됨"으로 표시한다. 첫 변경은 `base_revision: 0`으로 기본값 전체와 변경을 함께 보낸다. 삭제한 기본 아이콘이 되살아나지 않게 하기 위해서다. 동시에 두 곳이 초기화하면 §7 규칙으로 나중 쪽이 충돌을 받는다. 시안 아이콘 `backup.tar`는 기본값에서 뺀다(`E:1261`).

## 7. 동시 수정

전체 덮어쓰기를 없앤다. 서버가 키마다 마지막으로 바뀐 revision(`revs`)을 들고, 패치의 **각 키**에 대해 `revs[키] > base_revision`이면 전체를 거절한다.

| 경우 | 결과 |
| --- | --- |
| 다른 키 (A는 아이콘, B는 독) | 둘 다 성공하고 합쳐진다 |
| 같은 키 (둘 다 같은 아이콘 이동) | 먼저 도착한 쪽이 이긴다. 나중 쪽은 409를 받고 노드 값으로 돌아가며 "다른 곳에서 먼저 바뀌었습니다"를 띄운다. 자동 재시도하지 않는다 |
| 같은 칸에 다른 아이콘 둘 | 저장은 둘 다 성공한다. 표시할 때 다음 빈 칸으로 밀어 그린다. 저장값은 바꾸지 않는다 |

잠금은 Store 뮤텍스(`store.go:106`)로 충분하다. §9의 경로 규칙으로 쓰는 프로세스가 하나이기 때문이다.

## 8. 갱신: 연결 중에 안 보이는 시간을 없앤다

**TTL만으로는 안 된다.** `read`는 화면을 다시 그릴 때만 갱신을 시작하는데, 제어기에는 주기적 재렌더가 없다(`T:64-69`, `setInterval`은 `E`의 `asgPoll`뿐이다). **다른 노드의 밀어 받기는 없다.** 노드 주소 호출은 스트림을 막고(`LD/remoteop/handler.go:300-303`), Master 이벤트는 앱 토큰으로 못 읽으며(`web/src/api/master-delegated.json`에 없음), `terra.node.signal`은 고정 5종이다(`MS/nodesignal/ingest.go:35-62`).

그래서 `TerraNodes`에 타이머를 둔다.

| 시점 | 동작 |
| --- | --- |
| 제어기를 열 때, 노드를 바꿀 때 | 바로 읽는다 |
| 열린 제어기가 있고 탭이 보일 때 | 5초마다 `since_revision`으로 묻는다. 변화가 없으면 응답은 몇 바이트다 |
| 탭이 다시 보일 때, 창에 포커스가 올 때 | 바로 읽는다 |
| 탭이 숨겨져 있을 때 | 묻지 않는다. 보이면 위 규칙으로 즉시 읽는다 |
| 내가 쓴 뒤 | 응답의 `doc`으로 바꾼다 |

연결돼 있고 화면이 보이는 동안 낡을 수 있는 시간의 상한은 **5초 + 왕복**이다. 노드당이 아니라 **열린 제어기당** 호출이고 타이머는 하나로 묶는다. 프로필·스킨(`props`, TTL 60초)도 같은 타이머에 30초 주기로 올린다. revision이 없어 전체를 읽지만 작다.

## 9. 원본 인스턴스

서버에는 gui-v3가 둘 돌고 데이터가 나뉘어 있다(실측).

| 부모 | 데이터 디렉터리 |
| --- | --- |
| `terra-daemon` | `~/.terra/terra/module-data/lab.stellaxia.gui-v3` |
| `terra-master` | `~/.terra-master/terra/module-data/lab.stellaxia.gui-v3` |

**규칙: 그 노드의 원본은 Daemon 쪽 인스턴스다.** 다른 노드에서 오는 호출은 이미 그쪽으로만 간다. `tree-host` 카탈로그에는 계약 operation이 없어 `LocalOperation`이 거짓이고(`terra-module-host/manager.go:1225`, `MS/modulecatalog/node_operation.go:221-226`), #354도 Daemon 보고만 고쳤다.

로컬 경로는 페이지를 낸 Gateway의 인스턴스로 간다(`GW/server.go:513`). 그러므로 전송 규칙을 이렇게 둔다.

| 페이지 | 대상 노드 | 길 |
| --- | --- | --- |
| Leaf Gateway | 그 노드 (`TerraTopology.localId === rid`) | 로컬 경로. Daemon 인스턴스로 간다. Master가 끊겨도 자기 노드는 고칠 수 있다 |
| 그 외 전부 | `rid`가 있는 노드 | `/api/v1/nodes/{rid}/operations/…`. Tree Gateway 페이지에서도 서버 Daemon 인스턴스로 간다 |
| 어디서든 | `rid`가 없는 자리 | 부르지 않는다. 기본값, 읽기 전용 |

Tree Gateway 페이지의 `localId`가 무엇이 되는지는 코드로 확정하지 못했다. `localId`는 그 페이지의 Daemon status에서 오는데(`topology.js:11`), Tree Gateway에 Daemon operation이 없으면 비어서 위 표대로 노드 경로로 간다. S2에서 확인하고, 있으면 `localId`만으로 판단하지 않게 Gateway 종류를 함께 본다. 실기 V8이 이를 증거로 닫는다. 같은 규칙을 `node-props`·`node-files`에도 적용한다(프로필·스킨에도 같은 갈라짐이 있다). Daemon 없는 Tree 노드는 원격에서 `OPERATION_NOT_REMOTE`이므로 §13과 같이 읽기 전용이다. 지금 그런 노드는 없다.

## 10. 쓰기 순서와 체감

**표시되는 값은 언제나 그 노드가 준 값이다.** 진행 중인 변경은 사본이 아니라 그 위에 얹는 표시층에만 있다.

| 단계 | 화면 |
| --- | --- |
| 드래그 중 | 드래그 층만 움직인다. 지금도 아이콘은 `ov`, 창은 `wins`로 처리한다(`E:1716`, `E:1765`). 저장 경로를 타지 않는다 |
| 드롭, 토글 | 아이콘을 새 자리에 반투명으로 그리고 "그 노드에 저장 중…"을 띄운다 |
| 성공 응답 | 응답의 `doc`으로 바꾸고 반투명을 없앤다. "그 노드에 저장됨 · 시각" |
| 실패, 충돌 | 반투명을 없애 노드 값으로 돌아가고 이유를 그대로 보인다 |

**묶어 보내기.** 사람의 조작 한 번이 패치 하나다. 노드마다 전송 중인 패치는 하나만 두고, 그동안 생긴 변경은 키별 최신값으로 합쳐 다음 패치로 보낸다. 디바운스 타이머는 쓰지 않는다. 응답 전에 페이지를 닫으면 보내지 못한 합본은 사라지며, 이때 사본도 바뀌어 있지 않으므로 거짓 표시는 없다.

**`TerraNodes.write`의 낙관 반영은 사본에서 전부 없앤다.** 지금은 `apply` 결과를 사본에 넣고 성공하면 `e.at=now`로 신선하게 표시한다(`T:104-106`). 이어지는 refresh가 실패하면 낙관 값이 `src:'노드'`로 남고, 실패 롤백은 잡아 둔 `prev`로 되돌려 그 사이의 새 값을 덮을 수 있다(`T:107`). 다음처럼 바꾼다.

- `apply`는 `e.overlay`에만 적용하고 `e.data`는 건드리지 않는다. `read`는 `data`(노드 값)와 `view`(overlay 적용), `pending`을 함께 돌려준다.
- 화면은 진행 중인 행에 "적용 중"을 표시한다. `pending` 필드는 이미 있지만 읽는 곳이 없다.
- 성공해도 `at`을 바꾸지 않는다. 노드에서 다시 읽은 값만 사본이 된다.
- `ndSet`이 실패를 `undefined`로 삼켜 호출자가 성공 문구를 먼저 띄우는 일(`E:1540-1541`, `E:1601`, `E:2486`)을 고친다.
- 입력 초안 `draft`는 노드로 보내지 않는 값이라 그대로 둔다.

호출자가 많아(`E` 약 12곳, `parts/modstatus/script.js:34`) S4로 따로 묶는다.

## 11. 저장 정직성과 계정 문서

표시 기준을 바꾼다.

| 표시 | 언제 |
| --- | --- |
| 그 노드에 저장 중… | 패치가 나가 있거나 대기 중 |
| 그 노드에 저장됨 · 시각 | 성공 응답을 받은 뒤에만 |
| 저장 못 함 — 코드 · 다시 시도 | 실패. 사라지지 않고 남는다 |
| 끊김 · 읽기 전용 · 언제 사본 | 분할 |
| 이 노드에 아직 저장 안 됨 | `revision: 0` |

PC 소유 항목에는 저장 표시를 달지 않는다. 설정 창의 "다른 기기에서도 같은 바탕화면"(`E:2323`)은 노드 항목에만 붙인다.

**계정 문서 경로는 제어기에서 없앤다.** U-1, U-3 뒤로 제어기가 계정 문서에 둘 것이 없고, 호출자는 `E`의 `desk.*`뿐이다. `TP`의 `saveView`·`ready`, `main.js:201`, smoke의 해당 단정을 지운다. 스타메이커 같은 사람 소유 데이터를 옮길 때는 그때 실패를 드러내는 저장을 새로 만든다.

**왜 실패했는지.** 원인 하나는 확정이다. 리프의 키는 `P<n>:<표시 이름>`이고(`Scene.dc.html:2088`), `ctlKey`가 그대로 키가 된다(`Scene.dc.html:2926`). `:`는 Master 키 규칙 `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`에 없어(`MS/api/routes_documents.go:62`, `:120`) 400 `INVALID_REQUEST`로 거절된다. 실제 패턴으로 검사해 `view/desk.P1:marui-desktop`은 거짓, `view/desk.T1`은 참을 확인했다. 가짜 Gateway가 항상 성공을 돌려줘 시험에서 드러나지 않았다(`web/tests/smoke.mjs:27`).

Tree 키(`T<n>`)는 규칙을 통과하는데도 0건인 이유는 **미확정**이다. 후보는 앱 토큰 만료 뒤 `T.http`에 401 재시도가 없는 것(`web/src/api/terra.js`의 `http`에는 `invoke`와 달리 refresh가 없다), Master 세션 없는 호출(`GW/documents.go:228-233`), 그 제어기를 연 적이 없는 것이다. 경로를 없애므로 이 조사는 이 작업의 선행이 아니다. 단 Master 세션 조건은 새 경로에도 그대로 있다(`GW/node_operations.go:175`). 새 경로는 실패 코드를 화면에 드러내므로 같은 원인이면 바로 보인다.

## 12. 분할

| 상황 | 동작 |
| --- | --- |
| 끊김 판정 | 기존 코드 그대로: `NODE_OFFLINE`, `RELAY_NOT_CONNECTED`, `NETWORK`, `TIMEOUT`, `GATEWAY_UNREACHABLE` (`T:45`, `T:79`) |
| 표시 | 마지막으로 받은 사본을 "끊김 · 언제 사본 · 읽기 전용"으로. 사본이 없으면 기본값을 "끊김 · 사본 없음"으로. 노드 값처럼 보이게 하지 않는다 |
| 쓰기 | 드래그 시작과 설정 칸을 잠근다. 잠금을 지나 호출돼도 `PARTITIONED`로 즉시 거절한다(`T:103`). 대기열이 없다 |
| PC 항목 | 창 이동 등은 그대로 된다. 노드 값이 아니다 |
| 전송 중 끊김 | 실패로 처리한다. 합본 대기분은 버리고 "저장 못 함"을 띄운다. 재연결 때 몰래 보내지 않는다 |
| 재연결 | 5초 타이머가 성공하면 노드 값으로 바뀐다. 분할 중 다른 곳에서 바뀐 값도 함께 온다 |

## 13. 섞인 버전

새 GUI는 옛 gui-v3가 도는 노드를 부를 수 있다. 페이지는 로컬 모듈이 내므로 로컬 경로는 항상 같은 버전이다.

| 응답 | 뜻 | 동작 |
| --- | --- | --- |
| `OPERATION_NOT_REMOTE` (404) | 옛 모듈, 또는 #354 이전 Daemon | 기본값, 읽기 전용, "이 노드의 gui-v3가 옛 버전이라 바탕 구성을 읽고 쓸 수 없습니다". 60초마다 다시 시도 |
| `MODULE_ROUTE_NOT_FOUND` (404) | 로컬인데 경로 없음 | 위와 같음 |
| `MODULE_PERMISSION_DENIED` (403) | 권한 없음 | 읽기 전용, 이유 표시. 쓰기 권한만 없으면 읽기는 된다 |

계정 문서나 브라우저 저장으로 되돌아가지 않는다. 옛 GUI는 새 operation을 부르지 않으므로 지금처럼 자기 브라우저에만 저장하고, 새 노드의 원본을 건드리지 않는다.

`module.json`의 버전을 반드시 올린다. Daemon의 계약 색인 캐시 키에 모듈 버전이 들어 있어 안 올리면 새 operation이 안 읽힐 수 있다(`LD/remoteop/modules.go`의 `contract()`).

## 14. 이행 (U-4)

새 GUI가 처음 돌 때 한 번, `terra.view.desk.*`와 `terra.wall.*`를 지운다(`terra.pc.migrated=1`로 표시). 창 배치와 터미널 기록은 옛 키가 장면 id라 믿을 수 없고, 나눠 옮길 값어치보다 코드가 많아 함께 버린다. 옛 키로 쓰인 계정 문서는 서버에 없다(실측 0건)이므로 서버 쪽 정리는 필요 없다. 릴리스 노트에 "제어기 아이콘·배경이 기본값으로 돌아갑니다"를 적는다.

## 15. 남은 위험

| 위험 | 수준 | 대응 |
| --- | --- | --- |
| 5초 폴링이 Master 릴레이에 얹힌다 | 낮음 | 보이는 열린 제어기당 한 호출, 응답 몇 바이트. V9에서 잰다 |
| Tree 인스턴스의 로컬 경로를 GUI 아닌 도구가 부르면 다른 데이터를 본다 | 낮음 | GUI는 부르지 않는다. 막으려면 Terra가 호스트 종류를 모듈에 알려야 한다. 후속 |
| 원격 호출은 Master 세션이 필요하다 | 중간 | 없으면 자기 노드만 쓸 수 있다. 실패 코드가 화면에 뜬다 |
| 드롭 후 반투명 시간이 길다 | 중간 | 왕복을 V1에서 잰다. 지금 값은 없다 |
| 응답 없는 노드에서 전송이 오래 걸린다 | 낮음 | 호출당 15초(계약 기본), 지난 뒤 실패 표시 |
| `modSel`·`devSel`이 목록 인덱스다 | 낮음 | PC 소유로 남는 기존 결함. 범위 밖 |
| "새 폴더"가 실제 폴더를 만들지 않는다 | 낮음 | 아이콘은 노드로 간다. 실제 생성은 별건 |

## 16. 실행 계획

| 단계 | 내용 | 바뀌는 파일 | 선행 | 완료 기준 | 세션 |
| --- | --- | --- | --- | --- | --- |
| S1 | 백엔드 `node-desk.*`, revs 충돌, 경로 검사, wall 검사 | `src/nodedata/desk.go`(새), `src/nodedata/store.go`, `src/api.go`, `src/*_test.go`, `contracts/api/terra-api.json`, `module.json`, `src/main.go`(0.1.0 고정 정리) | 이 문서 승인 | Go 시험: 다른 키 병합, 같은 키 409, 동시 goroutine, 64 KiB, 허용 경로, `since_revision`. 계약과 라우터 대조 시험 추가 | 가 |
| S2 | `TerraNodes`: 자원 `nodedesk`, `patchDesk`(전송 하나+합본), overlay, 타이머, 경로 규칙, `props` 주기 | `parts/terranodes/script.js`, 구운 `TerraNodes.dc.html`, `web/src/api/transport.js`, `web/tests/node-owned-desk.test.mjs`(새), `web/tests/node-data.test.mjs` | S1 계약 | 시험: 노드 응답 전 사본 불변, 합본, 충돌 복귀, 5초 타이머·가시성, 경로 규칙, 분할 시 대기 없음. Tree Gateway `localId` 확인 | 나 |
| S3 | 제어기 분리: 노드 키/PC 키, 표시층, 저장 표시, 배경 그림, 분할 잠금, 계정 문서 제거, 이행 삭제 | `web/design/NodeDesktopEmbed.dc.html`, `web/src/api/transport.js`, `web/src/boot/main.js`, `web/tests/smoke.mjs`, `web/README.md`, `Sheet.dc.html` | S2 | 가짜 Gateway를 상태 있게 바꾼 Playwright 두 컨텍스트 시험이 통과. 저장 실패가 화면에 남음 | 나 |
| S4 | `TerraNodes.write` 낙관 제거, `ndSet` 실패 전달, 행 "적용 중" | `parts/terranodes/script.js`, `E`, `parts/modstatus/script.js`, 관련 시험 | S2, S3 병합 | 실패 시 성공 문구 없음, 응답 전 사본 불변, `no-fake-success` 시험 갱신 | 다 |
| S5 | 문서: 이 문서 accepted, `node-owned-data.md`, `backend.md`, `README.md`, 릴리스 노트 | 문서 | S3 | 구현과 표가 일치 | 나 |
| S6 | 릴리스, 설치, 실기 | modules 태그, Terra 핀 | **Terra #354 설치본 포함**, S1~S5, **사용자 승인** | §17 전부 통과 | 지휘 |

세션 "가"와 "나"는 파일이 겹치지 않아 동시에 진행할 수 있다. "다"는 `script.js`와 `E`가 겹치므로 "나" 뒤에 한다. 단위 시험 초록은 S6의 입장권일 뿐 완료가 아니다.

## 17. 실기 검증

대상은 서버 노드, A는 데스크탑, B는 노트북이다. 설치본을 바꾼 뒤에만 의미가 있다.

| # | 절차 | 합격 증거 | 누가 |
| --- | --- | --- | --- |
| V0 | 서버 업데이트 전 A에서 서버 제어기를 연다 | 기본값, 읽기 전용, 옛 버전 안내. 서버에 파일 없음 | 에이전트 준비, A 조작은 사용자 |
| V1 | A에서 아이콘을 옮긴다 | 네트워크 순서 PATCH 응답 → 확정 표시. 그 사이 서버 `desk.json`의 revision 증가. 왕복 시간 기록 | A 조작 사용자, 서버 확인 에이전트(SSH 읽기) |
| V2 | B를 켠 채로 둔다. 숨긴 탭도 따로 | 보이는 탭은 5초 안에 같은 자리. 숨긴 탭은 보일 때 즉시 | 사용자(노트북은 에이전트가 닿지 못함) |
| V3 | A 개발자 도구에서 `node-desk.patch` 요청을 막고 옮긴다 | "저장 못 함 — 코드"가 남고 아이콘이 원래 자리, 서버 revision 불변 | 사용자 |
| V4 | 노트북 네트워크를 끊는다 | B에 "끊김 · 읽기 전용 · 언제 사본", 드래그 잠김, 창 이동은 됨, 요청이 쌓이지 않음 | 사용자 |
| V5 | V4 동안 A에서 바꾼 뒤 노트북을 다시 연결한다 | B가 5초 안에 A의 값으로 바뀜. B가 끊긴 동안 한 조작이 나가지 않음 | 사용자, 서버 확인 에이전트 |
| V6 | A·B에서 같은 아이콘을 거의 동시에, 다음엔 다른 항목을 | 같은 키는 한쪽에 충돌 문구, 다른 키는 합쳐짐 | 사용자 |
| V7 | A에서 2.5 MiB GIF를 배경으로, B에서 확인, A에서 지움 | B에 같은 그림·움직임. 서버 `desk/wall/`에 파일 하나, 지운 뒤 0개 | 사용자, 서버 확인 에이전트 |
| V8 | 서버 Tree Gateway 페이지에서 서버 노드 제어기를 연다 | 원격과 같은 값. `~/.terra-master/.../node-data`에 `desk.json` 없음 | 에이전트(서버 터널·로그인은 사용자) |
| V9 | 제어기 열어 두고 10분 | 호출 수 약 120회, Master CPU 눈에 띄는 변화 없음 | 에이전트(읽기 전용) |
| V10 | 새 설치 첫 실행, 로그아웃 | 옛 `terra.view.desk.*`·`terra.wall.*` 사라짐, 로그아웃 후 터미널 기록 없음 | 사용자, A 브라우저는 에이전트도 가능 |

**에이전트가 직접 할 수 있는 것:** 서버 파일·프로세스의 읽기 전용 확인, 이 PC 브라우저 동작 확인(로그인은 사용자), V8 준비, V9 측정. **사용자만 할 수 있는 것:** 노트북 조작과 네트워크 분리, 비밀번호 입력, 설치본 업데이트 승인. 에이전트가 할 수 있는 항목은 사용자에게 넘기기 전에 먼저 돌린다. 서버 프로세스를 멈추는 분할 시험은 쓰지 않는다. 노트북 네트워크 분리로 충분하고 서버를 건드리지 않는다.

## 18. 입력 정정 기록

설계 시작 때 받은 점검 내용과 코드가 다른 부분이다.

| 받은 내용 | 확인 결과 |
| --- | --- |
| 저장 실패 원인을 못 찾았다 | 리프 키는 확정 원인을 찾았다(§11). Tree 키는 미확정 |
| 키는 노드 이름별 | 계정 문서 키는 장면 id, 배경은 표시 이름. 둘이 다르다 |
| `lab.stellaxia.node-gui`는 폐기 | 저장소에는 현역으로 남아 있고 설치 핀에서만 빠졌다. 제외 판단은 같다 |
