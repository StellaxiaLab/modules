---
title: "구현해야 할 것 — 새 GUI를 모듈로 올린 뒤"
aliases:
  - "구현해야 할 것"
  - "구현 목록"
  - "Implementation Backlog"
doc_type: "backlog"
scope: "project"
target: "terra-gui"
status: "draft"
version: "1.1.0"
last_updated: "2026-10-04"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|개발 문서 MOC]]"
  - "[[module-profile|모듈 프로필]]"
  - "[[real-data-layer|실데이터 층]]"
  - "[[implementation-guide|구현 가이드]]"
  - "[[node-screen-ui-spec|노드 화면 UI 명세]]"
  - "[[road-editor-spec|도로 편집기]]"
---

# 구현해야 할 것 — 새 GUI를 모듈로 올린 뒤

2026-10-04, GUI 원본 저장소 [`StellaxiaLab/maingui`](https://github.com/StellaxiaLab/maingui) `f24c3bc`(service 판 = 저장소 뿌리 — 예시 데이터를 뺀 판)를
바탕으로 모듈 `lab.stellaxia.node-gui` 0.2.0을 만들고 진짜 스택(Master · Daemon · 게이트웨이 · `io.terra.file` · `io.terra.io-inventory` · leaf UI 셸) 위에서
끝까지 돌린 뒤 남은 일이다. 예시 데이터 판(maingui `examples/` · demo)은 참고로만 썼다.

> [!NOTE] 처음 받은 압축 파일 → maingui 저장소
> 처음에는 압축 파일 두 개로 받았다 — 이름과 내용이 반대였다(`terra-node-gui-demo.zip` 안이 `variant: "service"` — 예시 없음, `terra-node-gui-service.zip` 안이 `variant: "demo"`).
> 그 뒤 원본 저장소 maingui를 받아 **모듈을 그 저장소 기준으로 다시 맞췄다**. maingui에는 압축 판에 없던 기능이 더 있다 — 자원 추가 · 수정 · 삭제 폼(`HELM_CRUD`) ·
> 상태 화면 · 모듈 GUI 창 · 노드 자원 공유(공유 목록 · 내보내기) · 오버헤드 패널 접기. 이 목록의 UP-12~UP-18이 그때 찾은 것이다.

| 묶음 | 누가 | 높음 | 중간 | 낮음 |
| --- | --- | --- | --- | --- |
| **PF** Terra 플랫폼 — 모듈만으로는 못 한다 | Terra 코어 | 1 | 9 | 6 |
| **MD** 이 모듈 | modules 저장소 | 1 | 6 | 6 |
| **UP** GUI 원본(maingui) · 디자인에 올릴 것 | GUI 원본 쪽 | 5 | 9 | 4 |
| **Q** 사람이 정할 것 | 소유자 | — | — | — |

```mermaid
flowchart LR
  PF1["PF-1 Master 위임"] --> MD1["MD-1 입출력 연결의 의미<br/>(SVI bind)"]
  PF1 --> V1["SVI · 허가 · mesh · 진단 · 클러스터 화면"]
  PF2["PF-2 다른 노드 operation"] --> MD12["MD-12 원격 노드 자원"]
  PF3["PF-3 서버 저장소"] --> MD4["MD-4 키를 node_id 로"]
  PF5["PF-5 이벤트 스트림"] --> MD11["MD-11 폴링 → 이벤트"]
  UP3["UP-3 자기 칸"] --> MD5["MD-5 자기 칸에서 연결 시작"]
  DES["디자인: 입출력 세부 설정 화면"] --> MD1
  DES --> MD2["MD-2 자원 설정 창 입출력"]
  UP4["UP-4 · UP-5 service 로그인 · whoami"] --> SVC["service 판 배포"]
  UP12["UP-12 · UP-13 원본 CRUD 본문 · node_id"] --> SVC
  PF13["PF-13 선언 op 를 계약에"] --> DECL["자원 선언 추가 · 철회"]
  PF15["PF-15 셸의 앱 열기"] --> MD14["MD-14 모듈 GUI 창에서 열기"]
  PF1 --> MD13["MD-13 tree 게이트웨이 CRUD E2E"]
```

## 1. Terra 플랫폼 — 모듈만으로는 못 하는 것 (PF)

| ID | 무엇 | 왜 — 근거 (실측) | 막히는 화면 | 우선 |
| --- | --- | --- | --- | --- |
| **PF-1** | 앱 스코프 토큰으로 **Master operation**에 닿는 길 (위임) | 스코프 토큰은 Bearer를 싣지 않아 forward-auth인 Master가 401 — 설계상 경계다. 모듈 README Q-2 · 세션 중계를 Master operation 전체로 넓히는 ADR 감 | 조타륜 SVI 자원 · 허가 · 연결, 네트워크 보드의 사설망 · 진단 · 라우팅 · 조작 이력, 설정의 클러스터 · 서버 탭, 다른 노드의 작업, 관리 노드 창의 tree 계층(손자) · 노드 부모 관계, 그리고 **입출력 연결의 실제 의미(MD-1)** | 높음 |
| **PF-2** | 다른 노드의 operation을 부르는 게이트웨이 경로 | 원격은 모듈 경로(`/api/nodes/{node}/modules/…`)뿐이다. 다른 노드의 Daemon operation은 부를 길이 없다 | 다른 노드 맵에서의 조타륜 앱 · 그 노드 자원의 설치 · 모니터링(MD-12) | 중간 |
| **PF-3** | 사용자 데이터의 서버 저장소 (LayoutStore · AssetStore) | 맵 배치 · 노드 모습 · 노드 자원 · 연결 · 메모 · 창 자리는 지금 이 브라우저(`localStorage`)에만 있다. 도로 · 건물 설계도 `localStorage`(`terra.gui.roads` · `buildings`). 코어 operation에 자리가 없다 — 모듈 README Q-3 | 다른 기기 · 다른 브라우저에서 같은 맵이 안 보인다 | 중간 |
| **PF-4** | Daemon 로컬 op — 로컬 최상위 루트 목록 · 로컬 프로그램으로 열기 · 파일 관리자로 열기 | 폴더 보관함의 `폴더 탐색기`와 `열기`가 쓸 operation이 없다. 제안: `terra.daemon.local-fs.list.get` · `terra.daemon.desktop.open.post` (Linux `xdg-open` · Windows 기본 앱 · macOS `open`) | 폴더 보관함 › 폴더 탐색기 · 파일 열기 | 중간 |
| **PF-5** | 앱 토큰으로 받는 이벤트 스트림 | `terra.daemon.events.get`의 binding은 `GET /events`(WebSocket)다. 브라우저 `EventSource`로는 붙을 수 없고(헤더 · 메서드), 앱 토큰으로 WebSocket을 여는 길이 정해져 있지 않다. 지금은 작업 폴링(`pollSec`) | 알림이 최대 `pollSec` 늦다 · 장치 hotplug · 모듈 상태 변화가 바로 안 보인다(MD-11) | 중간 |
| **PF-6** | 파일 받기 · 올리기 · 이어서 | `io.terra.file.transfers.*`는 있지만 청크를 끝까지 당기거나 보낼 파일을 고르는 길이 화면에 없다 — 청크 루프와 파일 고르기(브라우저 · sandbox 다운로드) 설계 | 조타륜 공유 폴더 · 파일 전송 앱 | 중간 |
| **PF-7** | 명령 출력 · 다시 실행 | Daemon 작업 목록 · 기록(`terra.daemon.tasks.get` · `by-task-id.get`)은 명령 · 출력을 돌려주지 않는다. 실행은 maingui의 추가 폼으로 된다(`commands.execute.post` — 실측 202 · succeeded) | 조타륜 명령 · 작업 앱의 다시 · 출력 | 중간 |
| **PF-8** | 셸을 새로 고쳐도 남는 세션 | 이 Scene의 `session` · `credentials` Store가 `memory`라 새로 고칠 때마다 다시 로그인한다(실측). 시작 화면의 "자동 로그인"은 셸 세션이 있을 때만 된다 | 시작 화면 → 매번 로그인 카드 | 중간 |
| **PF-9** | 앱 자산 CSP `frame-ancestors`에 앱 자신의 origin | 같은 앱의 페이지를 `src`로 끼우면 막힌다 → 지금 **srcdoc 3겹**(시작 화면 → 노드 화면 → 보드)으로 우회한다. 모듈 README Q-4 | 우회로 돌아가지만 구조가 복잡하다 | 낮음 |
| **PF-10** | `terra.gateway.agent.whoami.get`을 invoke로 부르면 위임 호출자가 빠진다 | 스코프 토큰(`tsa_`)으로 invoke → `principal: anonymous` · 권한 0. 경로 `GET /api/v1/agent/whoami`는 맞다(Master 토큰이면 둘 다 맞다) | 우회 중 — `client.get` 경로 호출 | 낮음 |
| **PF-11** | leaf 게이트웨이의 모듈 로그 | `terra.gateway.modules.by-id.logs.get` → 500 `MODULE_MANAGEMENT_FAILED — management action is not supported by the daemon local API` | 조타륜 모듈 앱의 로그 | 낮음 |
| **PF-12** | `storage.shared_dirs` 스키마 타입 | 스키마는 `string_list`인데 실제 값은 `[{ name, path }]` | 설정 화면이 그 키를 읽기만 한다 | 낮음 |
| **PF-13** | `svi.declarations`의 POST 계열을 게이트웨이 계약에 | Daemon local API에 `POST /svi/declarations` · `…/undeclare` · `…/forget` 경로는 있지만 게이트웨이 카탈로그에는 `terra.daemon.svi.declarations.get`뿐이다(실측) | 자원 선언 앱의 `+ 선언` · `다시 선언` · `철회` · 추가 폼 — `이 노드의 게이트웨이에 없다` | 중간 |
| **PF-14** | 모듈 설치 · 설정 · 제거 op | 없다. maingui의 제안: `terra.gateway.modules.post`(패키지 · 서명) · `by-module-id.config.put` · `by-module-id.delete` | 모듈 앱의 `＋ 추가` · `✎` · `🗑` — 폼 · 확인 대기를 열지 않고 `⚠`로 말한다 | 낮음 |
| **PF-15** | 앱 안에서 **다른 모듈의 GUI**를 여는 길 | `terra.web/frame`은 자기 모듈의 앱만 감싼다(`web-frame.ts` — `다른 모듈의 앱입니다`). 앱마다 origin · 스코프 토큰이 따로라 iframe으로도 못 띄운다. 셸에 "앱 열기" 요청(예: `emit('open-app', { app })` → Scene이 그 앱 · Scene으로 간다)이 필요하다 | 모듈 GUI 창(`🖥`) — 지금은 주소와 "셸의 앱 목록에서 연다"만 | 중간 |
| **PF-16** | 노드의 공유 목록 op | maingui 제안 `terra.master.svi.shares.get`(node_id). 지금 상태 화면의 공유 목록 · 내보내기 후보는 맵 연결(LayoutStore)로 계산한다 — 다른 기기 · 다른 사람이 만든 공유는 안 보인다 | 상태 화면(노드 칸) · 네트워크 창의 공유 그래프 | 낮음 |

## 2. 이 모듈에서 할 것 (MD)

| ID | 무엇 | 왜 · 지금 상태 | 선행 | 우선 |
| --- | --- | --- | --- | --- |
| **MD-1** | 입출력 연결의 **실제 의미** — `links`를 데이터 흐름(SVI 바인딩 · 허가)으로 | 지금 연결은 화면의 선(도로)이고 저장만 된다. 무엇을 어떤 형식으로 주고받는지 데이터 모양이 없다([[node-screen-data-model\|데이터 모델]] §2.14). 연결을 만들 때 `허가 · 연결` 앱의 bind를 부르고, 상태를 도로 이벤트(동작 · 대기 · 실패)로 돌려받는 것까지 | PF-1 · 입출력 설정 화면 디자인 | 높음 |
| **MD-2** | 자원 설정 창의 입력 · 출력 세부 설정 | 디자인이 "추후"다([[node-screen-ui-spec\|UI 명세]] §2.8) | 디자인 | 중간 |
| **MD-3** | 사용자 이벤트(건물 · 도로의 `+ 이벤트`)가 켜지는 규칙 | 편집기에서 만들 수 있지만 맵에서 켜지는 조건이 없다(UI 명세 §2.11 "상태 연동은 추후") | 규칙 결정 | 중간 |
| **MD-4** | LayoutStore 안의 노드 키를 이름 → `node_id` | 저장본은 노드 · 주체로 갈리지만, 맵 **안의** 노드 칸 · `looks` · 자원의 `node`는 화면 규칙대로 이름이 키다. 노드 이름이 바뀌면 칸 · 모습이 끊긴다 | (PF-3과 같이 하면 좋다) | 중간 |
| **MD-5** | leaf 맵 자기 칸에서 연결 **시작** · 상태 창 | `fixes.js`가 자기 칸을 노드 칸으로 보게 고쳤다(지나가지 못함 · 대상이 됨 · 자원 못 놓음). 하지만 상태 창(캡슐)이 자기 칸에는 뜨지 않아 거기서 연결을 시작할 수 없다 | UP-3 | 중간 |
| **MD-6** | 진짜 스택 E2E를 CI로 | 지금은 손으로 돈다([[testing\|시험]] §6) — Master · Daemon · 셸 · 브라우저가 필요하다. modules CI는 이미 Terra를 체크아웃한다(`test:scenes`) | — | 중간 |
| **MD-8** | 로그아웃 → 시작 화면으로 돌아가는 연출 | 지금은 노드 화면이 빈 세계 + 로그인 띠로만 바뀐다(시작 화면은 뒤에 그대로 있다) | — | 낮음 |
| **MD-9** | Terra 세션 띠의 디자인 자리 | 로그인 · 로그아웃 띠는 모듈이 그린 흰 캡슐이다(`frame-session.js`) — 원본 디자인에 자리가 없다 | 디자인 | 낮음 |
| **MD-10** | 번들에 남은 예시 문자열 | 원본 미리보기의 예시 상수가 번들에 **문자열로** 남는다(화면 · 요청에는 나가지 않는다 — 시험이 지킨다). 지우려면 원본 미리보기 데이터를 따로 떼야 한다 | 원본 작업 방식 | 낮음 |
| **MD-11** | 폴링을 이벤트로 | 알림 · 설치한 자원 · 조타륜 앱을 `pollSec`마다 다시 받는다 | PF-5 | 낮음 |
| **MD-12** | 원격 노드 자원 | 다른 노드 맵에 그 노드 자원을 설치해도 모니터링 값을 받을 길이 없다("닿지 않음") | PF-2 | 낮음 |
| **MD-13** | tree 게이트웨이에서 Master 쪽 추가 · 수정 · 삭제 E2E | 허가 · 바인딩 · 터널 열기 · 선언 · 피어 회수 · 다른 노드 작업의 본문은 Master 코드로 맞췄지만(`decodeJSON` 입력 구조) 시험 스택이 leaf라 실제로 부르지 못했다(`not-in-catalog`). tree 노드에 모듈을 깔고 돌린다 | PF-1(위임) | 중간 |
| **MD-14** | 모듈 GUI 창에서 그 모듈의 GUI 열기 | 지금은 `/api/v1/gui/apps`로 GUI가 있는지 · 주소만 보인다 | PF-15 | 낮음 |

이번(maingui 기준으로 다시 맞추며)에 끝낸 것 — 예전 **MD-7**(폴더 자원의 모니터링 경로): 설치한 폴더 · 파일 자원과 상태 화면이 보는 칸의 **위 칸까지** 읽는다(`wire.js` `folderPaths` · `source.js` 경로 여럿).
그 밖에 자원 추가 · 수정 · 삭제를 실제 호출로(지어내지 않기) · 값을 적어야 하는 앱 바 동작의 폼 · 상태 화면 · 모듈 GUI 창 · `ovhHide` 저장 — [[real-data-layer|실데이터 층]] §2.4 · §2.5 · §5.2.

## 3. GUI 원본(maingui) · 디자인에 올릴 것 (UP)

모듈을 만들며 찾은 것이다. service 판은 같은 진짜 게이트웨이(`/gw` → `127.0.0.1:28787`)에 `tools/serve.mjs`로 붙여 확인했다.
UP-1~UP-11은 압축 판에서, UP-12~UP-18은 maingui `f24c3bc`에서 찾았다 — UP-1~UP-11은 maingui에도 그대로 남아 있다.

| ID | 무엇 | 근거 (실측) | 모듈은 | 우선 |
| --- | --- | --- | --- | --- |
| **UP-1** | 화면 잘림 두 가지 | (가) 시작 화면은 `full` 맞춤(무대 1447×945를 창에 맞춰 키움)인데 루트가 이미 `100vw × 100vh`라 두 번 커진다 — 창 비율이 1447:945가 아니면 판이 한쪽으로 밀리고, **그 안에 미리 읽은 노드 화면이 잘린다**(1447×1000 → 아래 55px · 1800×1050 → 오른쪽 약 350px · 아래 105px). (나) 노드 페이지의 `#stage`가 1447×945 고정이고 `fitScreen`이 `html` · `body`에 `overflow: hidden`을 걸어, 창 높이가 945를 넘으면 body가 945에서 자른다 — 아래 테이블이 잘리고 회색 띠(**demo 판에서도 재현**) | 생성기에서 고쳤다 — 시작 화면 `viewport` 맞춤 · 노드 무대 `100vw × 100vh` | 높음 |
| **UP-2** | service 시작 화면의 `v0.2 · 예시 데이터` | 판 아래 오른쪽 글이 그대로 남는다 — `SERVICE_TPL`에 `index`가 없다 | `Terra 노드 · Terra 안/밖` | 낮음 |
| **UP-3** | leaf 맵의 자기 칸(`self`) | 자기 칸은 `nodes`에 없어서 연결하기의 길 찾기가 그 칸을 빈 필드로 보고 **노드 위에 도로를 깐다**(실측: 길이 가운데 칸 `4-4`). 자원도 그 칸에 놓인다. 대상으로 고를 수 없고 상태 창도 안 뜬다 — 예시 세계는 tree 맵에서 시작해 드러나지 않았다 | `fixes.js`로 통과 · 대상 · 설치를 고쳤다(MD-5는 남음) | 중간 |
| **UP-4** | service 로그인이 진짜 게이트웨이에서 **실패한다** | `terra.gateway.auth.credentials.post`에 `{ username, password, remember }`를 보내 `401 CREDENTIAL_REJECTED`(맞는 비밀번호로도). 그 op은 `{ email, password }`를 받고 **핸들(`tch_…`)**을 돌려준다 — 핸들은 셸이 앱 토큰을 받는 데 쓰는 것이라 Bearer로 내면 `anonymous`다. 쿠키도 주지 않는다. 독립 웹은 `terra.gateway.auth.login.post`(`{ email, password }`) → `access_token`(1시간) · `refresh_token` · `user` → 모든 호출에 `Authorization: Bearer` | 해당 없음 — 모듈은 웹이 로그인하지 않는다 | 높음 |
| **UP-5** | service가 로그인 없이 노드 화면을 연다 | `whoami`가 200 + `principal: "anonymous"` · 권한 0을 주는데 `ok`로 읽는다 → `node.html`이 로그인 화면으로 가지 않는다(실측). 또 `principal`은 문자열(사용자 id)인데 `{ name }` 객체로 추정했다 — 화면 이름은 로그인 응답의 `user.display_name` · `email` | 모듈은 frame 토큰 유무로 가른다 | 높음 |
| **UP-6** | service 알림 스트림 | `new EventSource('/gw/api/v1/operations/terra.daemon.events.get/invoke')` — invoke는 POST라 GET은 **405**, 끝없이 다시 붙는다. 실제 binding은 `GET /events`(WebSocket) | 작업 폴링(PF-5 전까지) | 중간 |
| **UP-7** | service 노드 목록 | leaf 게이트웨이에는 `terra.master.nodes.get` route가 없다(`MODULE_ROUTE_NOT_FOUND`) — `GET /api/v1/agent/nodes`(`node.read`)로 | 모듈은 `agent/nodes` | 중간 |
| **UP-8** | service 연동 층(`src/api`)이 실측 전 판 | 모듈이 진짜 스택에서 고친 것: 게이트웨이 모듈 op 이름(`modules.by-module-id.*` → 실제 `modules.by-id.*`, 이 노드는 Daemon 경로) · `pathInput`(op의 `by-…` 자리만, 모르는 키를 싣지 않기) · 폴더 단계 읽기 · WireGuard가 꺼져 있으면 피어를 부르지 않기(422) · 작업 기록과 접수 구분 · 상태 낱말 정규화(표에 없는 값이면 렌더가 멈춘다) · 경로 호출 `client.get` | 모듈의 `src/api`가 앞선다 — Q-9 | 중간 |
| **UP-9** | service의 로컬 노드 권한 | 로컬 노드를 "소유자 · 모든 권한"으로 가정한다 — 실제 계정 권한과 다르다 | 모듈은 토큰이 실제로 쥔 권한 | 중간 |
| **UP-10** | 연기 시험의 창 크기 | 1447×945 창에서만 돌아 UP-1을 잡지 못했다 — 다른 창 크기(1447×1000 · 1800×1050 · 1280×720)를 더한다 | 모듈 smoke는 1700×1000으로 바꿔 본다 | 중간 |
| **UP-11** | 문서 계보 | 짝 프로젝트 문서 일부가 예전 판 기준이다 — 데이터 모델 §2.9~2.13(조타륜 앱 · 전체 화면 · 폴더 보관함 · 메모장)이 빠졌고, API 연동 가이드의 체크리스트가 되돌아갔고, 표 안의 위키 링크에 `\|` 이스케이프가 빠져 Obsidian · GFM 표가 깨진다. UI 명세 §2.9가 §2.12 뒤에 있다 | 모듈 문서는 합쳐서 고쳤다 | 낮음 |
| **UP-12** | `HELM_CRUD` 본문이 실제 서버의 입력과 다르다 | 서버 코드와 견줬다 — 모두 모르는 키를 거절한다. (가) 폴더: 추가 `{path, parents}`에 `root`가 없고 `path`가 칸 id(공유 폴더 이름 포함)라 엉뚱한 경로, 이름 바꾸기 `{from, to}` — 계약은 `{root, path, to}`, 지우기 `{path: 칸 id}` (나) 선언: `{declaration: {…}, replace, reuse_name}` — Daemon은 **평평한** 선언 `{family, name, direction, command, args, …}` (다) 터널: `{target, local_bind}` — Master는 `{source_node_id, target_node_id, target_port, local_bind_host, local_port}` (라) 피어 회수: `{node_id}` — Master는 `{source_node_id, target_node_id}` (마) 장치 이름 바꾸기를 제안(`by-device-id.patch`)으로 뒀지만 `alias.post`가 이미 있다 (바) 전송 추가 `{direction, path, size_bytes, mode}` — 청크 없이 만들면 매달린 전송이 남는다 (사) 이 노드의 작업도 Master `commands.post`로 보낸다 — Daemon `commands.execute.post`가 있다 | 모듈은 실제 입력으로 맞췄다(`HELM_CRUD` · 시험 `tests/crud.test.mjs`) | 높음 |
| **UP-13** | `LiveSource.call`이 Master op마다 `node_id`를 본문에 싣는다 | Master `decodeJSON`은 모르는 키를 거절한다 — 허가 · 터널 · 피어 회수 · 명령 같은 POST가 400이 된다 | 읽기 · 지우기(GET · DELETE)만 query로 싣는다 | 높음 |
| **UP-14** | 서버에 길이 없는 추가 · 수정 · 삭제가 화면 목록에 항목을 **지어 넣는다** | `⚠ Gateway에 아직 이 동작의 길이 없다 — 화면에만 반영했다` — 다음 폴링이 지우고, 사람은 됐다고 믿는다. 지어 넣는 항목에 가짜 값(`listening` · `0 / 16` · `running` · `완료` …)이 들어간다 | 길이 없으면 폼 · 확인 대기를 **열기 전에** 말하고 아무것도 바꾸지 않는다 | 중간 |
| **UP-15** | 시작 화면의 아래 두 알약이 내려간 뒤에도 **누름을 가로챈다** | 게이트웨이 · 꼬리말 알약이 `opacity 0`으로만 사라진다(`pointer-events` 그대로 · z-index 3 > 노드 화면 iframe 1). 노드 화면의 왼쪽 · 오른쪽 아래 누름이 먹힌다 — 앱 전체 화면 폼의 저장 단추가 눌리지 않았다(실측) | 생성기에서 `pointer-events: {{v.chromePe}}` | 중간 |
| **UP-16** | 상태 화면 노드 칸의 "로그인" 줄 | `auth`가 없으면 `로그인됨` — 로그인 전에도 그렇게 그린다 | 이 화면의 세션으로 적는다 | 낮음 |
| **UP-17** | 모듈 GUI 창 | GUI 제공 여부를 제안 필드(`gui` · `ui`)로 읽는다 — 공개 경로 `GET /api/v1/gui/apps`가 `moduleId` · `route` · `origin`을 이미 준다. 창은 "이 창 안에 뜬다 (iframe)"라고 그리지만 다른 모듈의 앱은 띄울 수 없다(PF-15) | `/api/v1/gui/apps`로 알고, 띄울 수 없다고 적는다 | 중간 |
| **UP-18** | 메모장 경로 글 `~/.terra/memos/` | 실제 메모는 LayoutStore(이 브라우저)에 있다 — 경로가 사실과 다르다 | `메모/` | 낮음 |

## 4. 사람이 정할 것 (Q)

모듈 README의 Q-1~Q-6 다음 번호다. 열려 있는 앞 결정 — **Q-2**(Master 데이터를 웹에 어떻게 · PF-1) · **Q-3**(메모 · 설계도 · 맵 배치를 어디에 · PF-3) · **Q-5**(여러 tree 전환) — 은 그대로 남는다.

| ID | 결정 | 이번 기본값 | 다른 길 |
| --- | --- | --- | --- |
| **Q-7** | 앱 entry를 시작 화면으로 둘까 | **예** — `ui/index.html`. 열 때마다 시작 화면 → (토큰이 있으면 약 1.4초 뒤) 구름 → 노드 화면 | `module.json` entry를 `ui/node.html`로 되돌리면 노드 화면이 곧장 뜬다(시작 화면은 남는다) |
| **Q-8** | Terra 안의 로그인 모양 | **Scene의 로그인 카드** — 시작 화면은 [Terra 로그인]만 보낸다(웹이 비밀번호를 받지 않는다 — 웹 프로그램 감싸기 설계 §3.3.1) | 디자인된 판(하늘 · 바다 · 조타륜)을 **Scene의 로그인 Fragment**로 옮긴다 — 비밀번호를 받는 쪽이 Scene이면 안전하다 · PF-8(세션 지속)과 함께 |
| **Q-9** | 연동 층을 하나로 | 정하지 않았다 — 모듈 `src/api`가 실측으로 고친 판이고, 짝 프로젝트는 예전 판이다 | 모듈 판을 짝 프로젝트로 되돌린다(UP-8) · 공유 패키지로 뗀다 |
| **Q-10** | `node.config`★를 앱 권한에 넣을까 | 넣지 않았다 — 설정 화면의 운영자 키는 잠겨 보인다 | `module.json`의 `permissions`에 더한다(사용자 권한과의 교집합이라 사용자에게도 있어야 한다) |
| **Q-11** | 디자인 노트 페이지(`components` · `helm` · `helm-apps`) | 모듈에서 뺐다(service 판과 같다). 원본은 `design/`에 남겼다 | demo 판에서만 본다 |
| **Q-12** | maingui를 어떻게 따라갈까 | `design/`을 **복사**하고 맞춘 커밋(`f24c3bc`)을 문서에 적는다 — [[module-profile\|모듈 프로필]] §8 | git submodule · subtree로 묶는다 · 연동 층(`src/api`)을 공유 패키지로 뗀다(Q-9와 같이) |
| **Q-13** | "삭제"의 뜻 | 작업 = **취소**(기록은 남는다) · 선언 = **철회**(퇴역 원장에 남는다) · 전송 = **포기**(부분 파일도 지운다 — `keep_partial: false`) · 끝난 전송 = 화면에서만 치우기 | 전송 삭제를 `중단`(부분 파일 남김 — 카드의 `중단`과 같다)으로 |

## 관련 문서

- [[docs/README|개발 문서 MOC]]
- [[module-profile|모듈 프로필]] — 변형 · 시작 화면 · LayoutStore · 생성 때 바꾸는 것
- [[real-data-layer|실데이터 층]] — §3 비어 있는 것 · §5 실측
- [[implementation-guide|구현 가이드]] — 실데이터로 옮기는 순서 · 결정 필요
- [[node-screen-ui-spec|노드 화면 UI 명세]] §2.6~2.12 · [[road-editor-spec|도로 편집기]]
- 모듈 README(`common/lab.stellaxia.node-gui/README.md`) — 결정 Q-1~Q-6 · 검증 기록

## 관련 모듈

- `lab.stellaxia.node-gui` — 이 목록의 주인
- Terra 게이트웨이 · Master · Daemon — PF 묶음의 주인
- GUI 원본 저장소 `StellaxiaLab/maingui`(service = 뿌리 · demo = `examples/`) — UP 묶음의 주인. 예전 이름 `terra-node-gui` · `terra-node-gui-demo`

## 관련 흐름

- PF-1 → MD-1: Master 위임이 열려야 연결이 실제 바인딩이 된다
- UP-4 · UP-5: service 판을 진짜 게이트웨이에 올리기 전 반드시
- UP-12 · UP-13: maingui의 추가 · 수정 · 삭제를 진짜 게이트웨이에 쓰기 전 반드시 — 모듈의 `HELM_CRUD` · `source.js`를 되돌려 받으면 된다
- PF-15 → MD-14: 셸이 "앱 열기"를 받아야 모듈 GUI 창이 실제로 연다
