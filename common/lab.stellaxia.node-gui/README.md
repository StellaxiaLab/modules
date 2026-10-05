---
title: "Terra 노드 — 게임 GUI main 모듈"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "draft"
version: "v0.6"
last_updated: "2026-10-05"
---

# Terra 노드 (`lab.stellaxia.node-gui`)

게임 GUI 형태의 Terra 노드 화면 — 시작 화면 · 육각 필드 맵 · 조타륜 · 노드 자원 · 연결(도로) · 오버헤드 패널 · 편집기 — 을
노드의 **main GUI**로 내는 모듈이다. base Scene(`io.terra.scene.terra`)은 main이 하나면 그것을 곧장 띄운다.

화면은 GUI 원본 저장소 [`StellaxiaLab/maingui`](https://github.com/StellaxiaLab/maingui) `2ced429`(2026-10-05 — service 판 = 예시 데이터를 뺀 판 · Terra G0~G6 연동)를
바탕으로 한 **module 변형**이다(처음에는 `f24c3bc`에 맞췄다) — 같은 디자인 원본(`web/design/`) · 같은 생성 규칙이고, 갈림은 부트 프로필(`web/src/boot/module.js`)이다.
처음에는 압축 파일로 받은 `terra-node-gui` 1.0으로 만들었고, 그 뒤 maingui 저장소(자원 추가 · 수정 · 삭제 · 상태 화면 · 모듈 GUI 창이 더 있다)로 다시 맞췄다.
모듈이 더한 것은 다섯이다.

1. **얇은 셸 Scene** — `terra.web/frame` 하나와 로그인 Route 하나.
2. **frame 배선** — 웹이 Terra 셸 안에서 스코프 토큰으로 이 노드의 게이트웨이를 부른다. 시작 화면은 비밀번호를 받지 않고 셸의 로그인 카드를 부른다.
3. **실데이터 층** — 디자인 원본의 예시 데이터를 하나도 보이지 않게 지우고, 이 노드의 값으로만 채운다(`web/src/data/`).
4. **LayoutStore** — API에 자리가 없는 맵 배치 · 노드 모습 · 노드 자원 · 연결 · 메모를 이 브라우저에 노드 · 주체마다 두고, Terra 사용자 문서 저장소(C-1)에도 뒤따라 둔다(`web/src/store/layout.js` · `docs.js`) — 다른 기기 · 브라우저에서 같은 맵.
5. **웹 빌드 단계** — 이 저장소가 `web/`을 `ui/`로 굽는다([저장소 README](../../README.md)의 "웹 화면을 가진 모듈" 절).

남은 일 — 플랫폼 · 이 모듈 · GUI 원본(maingui) · 결정 — 은 [`web/docs/guides/implementation-backlog.md`](web/docs/guides/implementation-backlog.md).

가능성 판정과 그 근거(실측 · 플랫폼 공백 · 남은 결정)는 Terra의
`docs/reports/terra-node-gui-main-module-feasibility-2026-10-01.md`([Terra#106](https://github.com/StellaxiaLab/Terra/pull/106))에 있다.
이 모듈은 그 판정서 §6의 순서 중 **1~3과 P-4**를 구현한 것이다.

## 구성

```text
common/lab.stellaxia.node-gui/
├─ module.json                 kind=scene · gui.scenes(branch: main) · gui.apps(embed: scene)
├─ scene/                      셸 Scene — frame 하나와 로그인 Route
│  ├─ scene.json
│  ├─ contract/
│  │  ├─ functions/            signin.field · signin.submit · signout · login.open · login.close
│  │  └─ stores/               credentials(secret) · signin(view) · session(memory)
│  └─ surface/
│     └─ fragments/            main(terra.web/frame) · login
├─ web/                        화면 소스 — 포장되지 않는다 (README · docs/ 는 이 웹의 개발 문서)
│  ├─ src/                     화면(screens) · 런타임(runtime) · 부트 프로필(boot) · 연동 층(api) · 실데이터 층(data) · 저장(store) · 모델(model)
│  ├─ design/                  디자인 캔버스 원본 (*.dc.html) — 미리보기용 예시 데이터를 품고 있다
│  ├─ public/config.json       variant(module) · layoutStore · pollSec
│  ├─ tools/gen-pages.py       design → 화면 페이지 (module 변형 — 부트 프로필로 마운트 · 템플릿의 예시 글자 패치)
│  └─ tests/*.test.mjs         연동 층 · 실데이터 층 · 모듈 프로필 시험 (node:test — 브라우저 없이 돈다)
└─ ui/                         web/ 의 빌드 결과 — 커밋하지 않는다 (.gitignore)
```

[`docs/layout.md`](../../docs/layout.md)의 L-10(Scene 두 층)을 따르고, `web/` · `ui/`는 L-6 · L-8의
**웹 모듈** 절을 따른다 — `ui/`는 `bin/`처럼 빌드 산출물이다.

## 어떻게 맞물리나

```mermaid
flowchart LR
  BASE["base Scene<br/>io.terra.scene.terra"] -->|"main 하나 → 곧장 연다"| SH["셸 Scene<br/>lab.stellaxia.node-gui.ui"]
  SH -->|"/ — terra.web/frame"| APP["웹 앱<br/>lab.stellaxia.node-gui.web<br/>ui/index.html — 시작 화면"]
  APP -->|"구름 뒤에 미리 읽기 (srcdoc)"| NODE["노드 화면 node.html"]
  SH -->|"/login"| LG["로그인 Route<br/>signin.submit → Handle"]
  APP -- "emit login · logout" --> SH
  SH -- "init · token · value(session)" --> APP
  APP -->|"Bearer tsa_… (스코프 토큰)"| GW["이 노드의 Gateway"]
  GW --> DM["Daemon operation — 닿는다"]
  GW -. "401 — 위임 자격은 넘기지 않는다" .-> MS["Master operation"]
```

| 자리 | 하는 일 |
| --- | --- |
| `contributions.gui.scenes[0]` | `branch: "main"`, `role: "application"`. base Scene은 main 1 · dev 0이면 이것을 곧장 연다 |
| `contributions.gui.apps[0]` | `mode: static` · `embed: "scene"` · `entry: ui/index.html`(시작 화면 — 세션이 있으면 노드 화면으로 내려간다). 게이트웨이가 앱별 origin(`app-….localhost`)에서 서빙한다. 권한 7개(`session.identity` · `node.read` · `node.control` · `file.read` · `file.write` · `process.execute` · `module.manage`) — 토큰에 실리는 것은 **사용자 권한 ∩ 이 목록**이다 |
| `node-gui.main` (`/`) | 루트가 `terra.web/frame` 하나다(Fragment 루트라 셸의 1120px 틀을 벗는다). `bind: session` → `terra.frame.value`, `on: login → node-gui.login.open · logout → node-gui.signout` |
| `node-gui.login` (`/login`) | 자격 로그인. **웹은 비밀번호를 보지 않는다.** 성공하면 `session`(memory)을 `signedIn`으로 쓰고 `/`로 돌아간다 — frame은 새 토큰과 값을 받는다 |
| `session` 스토어 | frame에 건네는 값(`state` · `principal`). 비밀번호를 든 `signin`(view)과 따로 둔 것은 그 값이 frame으로 나가지 않게 하려는 것이다 |

웹 쪽 배선(`frame-boot.js`가 첫 import로 `hello`를 보내는 이유, 노드 화면 · 보드를 `srcdoc`으로 여는 이유, 시작 화면이 비밀번호를 받지 않는 이유 등)은
[`web/docs/architecture.md`](web/docs/architecture.md) §7 · §8, [`web/docs/guides/module-profile.md`](web/docs/guides/module-profile.md), [`web/docs/api/frontend-api.md`](web/docs/api/frontend-api.md) §6.5.

## 무엇이 실데이터이고 무엇이 비어 있나

**예시 데이터는 화면 어디에도 나오지 않는다.** 디자인 원본(`web/design/*.dc.html`)은 미리보기를 위해 예시 세계를 품고 있지만,
페이지는 부트 프로필이 돌려준 화면 클래스(실데이터 층이 이어받은 것)를 마운트하고 그 클래스가 첫 렌더 전에 예시를 지운다. 자세한 것은
[`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md).

| 영역 | Terra 안에서 |
| --- | --- |
| 시작 화면 | frame 세션 — 로그인 전이면 [Terra 로그인](셸의 로그인 카드), 토큰이 있으면 주체 이름(whoami)을 보이고 곧장 노드 화면으로 |
| 맵 | 처음 맵은 **이 노드**(`terra.daemon.node.get`)의 맵. 부모 tree 는 등록 정보의 Master 주소(`tree · 호스트:포트`), 그 아래 노드는 `GET /api/v1/agent/nodes`(오프라인 노드는 건물에 정지 이벤트) |
| 맵 배치 · 노드 모습 · 노드 자원 · 연결(도로) · 표시 설정 · 메모 | LayoutStore — 이 브라우저(앱 origin)에 노드 · 주체마다 + 사용자 문서 `app:lab.stellaxia.node-gui.web/layout/<node_id>`(새 쪽이 이긴다 · 겹쳐 쓰면 한 번 알린다). 처음엔 비어 있다. 설치한 자원의 상태 · 모니터링 값은 원본 앱 목록에서(닫혀 있어도) |
| 세션 띠 · 유틸 카드 · 창 요약 · 속성 창 | 로그인한 사람(frame 값) · 토큰 권한 · 모듈 · 터널 · WireGuard · 설정 키 수 · 장치 · 공유 폴더 개수 — 진짜 값, 없으면 `—` |
| 알림 | 이 노드의 Daemon 작업(`terra.daemon.tasks.get`) — 실시간 이벤트(`terra.daemon.events.get` SSE)의 신호마다, 이벤트가 없으면 `pollSec`(기본 10초)마다. 새로 생기거나 상태가 바뀐 것 |
| 조타륜 앱 — I/O 장치 · 공유 폴더 · 파일 전송 · 서비스 터널 · WireGuard · 자원 선언 · 작업 · 모듈 | **실데이터와 실제 동작.** 작업은 Daemon 작업, 모듈 수명은 Daemon 경로(`node.control`). 장치 손 등록(카메라 주소) · 파일 올리기(↑ 올리기 → 조각 · SHA-256) · 받기(브라우저 저장) · 끊긴 뒤 이어서(같은 파일을 다시 올리면 서버가 받은 곳부터 · 다시 받으면 이 브라우저에 둔 조각부터 · 멈춘 전송의 카드) · 모듈 로그(상태 화면 출력 칸) |
| 자원 추가 · 수정 · 삭제(앱 전체 화면 · 상태 화면) | 실제 서버가 받는 본문으로 부른다 — 폴더(만들기 · 빈 파일 · 이름 바꾸기 · 지우기) · 장치(별명 · 승인 · 켜기 · 잊기 · 스캔) · 작업(실행 · 취소) · 전송(포기 · 중단해 둔 것의 치우기). 서버에 길이 없으면 **항목을 지어 넣지 않고** 그렇다고 말한다 |
| 상태 화면 · 모듈 GUI 창 | 원본 앱 목록의 그 항목 · 이 노드의 권한 / 설치된 GUI 앱(`/api/v1/gui/apps`). 다른 모듈의 앱은 이 창에 띄울 수 없다고 적는다(frame은 자기 모듈의 앱만) |
| 조타륜 앱 — SVI 자원 · 허가 | Master operation — `쓸 수 없다 · 이 노드의 게이트웨이에 없다` |
| 폴더 보관함 | Terra 저장소 = 이 노드의 공유 폴더(`io.terra.file`). 폴더 탐색기 = 이 노드의 로컬 최상위 루트(`local-fs` — 닫힌 폴더는 🔒), 파일 · 폴더는 그 노드의 바탕화면에 연다(`desktop.open` — 그 컴퓨터에서 볼 때만). 메모는 LayoutStore(브라우저 + 사용자 문서) |
| 네트워크 보드 | 로컬 WireGuard · 로컬 서비스 터널은 실데이터. 사설망 · 라우팅 · 조작 이력은 Master — "닿지 않음" |
| 설정 보드 | 로컬 노드 135키(값 · 소유 · 반영 · 설치값 차이)와 저장, 계정(whoami), 로컬 자원. 클러스터 · 서버 탭은 Master — "닿지 않음" |
| 다른 노드 | 노드 주소 호출(Terra B-1)로 그 노드의 Daemon — I/O 장치 · 모듈(로그 포함) · 작업 · 선언 · 터널 · WireGuard. 그 노드 카탈로그로 누르기 전에 잠근다(로컬 전용은 잠김). 공유 폴더 · 전송 · 올리기 · 받기는 원격 모듈 경로(`/api/nodes/{node_id}/modules/io.terra.file/…`) |
| 다른 tree | 비어 있다 — 연결 목록을 둘 곳 · 가는 길이 없다 |
| 편집기에서 내보낸 도로 · 건물 | 이 브라우저(`localStorage`) — 노드 화면이 바로 받아 다시 굽는다 · 사용자 문서 `assets`로 뒤따라 |
| 로그인 전 · 토큰을 잃었을 때 | **빈 세계**(`이 노드` 한 칸 · `로그인 전`). 띠가 *"Terra에 로그인하지 않았습니다 — 로그인하면 이 노드의 데이터가 보입니다"* 와 [로그인]을 보인다 |

Master가 닿지 않는 것은 **결함이 아니라 설계상 경계**다 — 앱 스코프 토큰은 Bearer를 싣지 않으므로 forward-auth인
Master는 401을 낸다. 그 401을 "로그인 필요"로 읽으면 사용자를 헛되이 로그인 화면으로 보내므로, 위임 자격으로 받은
Master 401은 "쓸 수 없다"로 바꾸고 그 뒤로 Master를 부르지 않는다. 어떻게 열지는 아래 Q-2다.

## 남은 결정 — 이번 구현이 고른 기본값

판정서 §7의 결정은 아직 사람이 내리지 않았다. 이 모듈은 **되돌리기 쉬운 쪽**을 골라 두었다.

| | 질문 | 이번 기본값 | 바꾸려면 |
| --- | --- | --- | --- |
| **Q-1** | 어떻게 나가나 (접두사) | **tree 레지스트리** — `lab.stellaxia.*`, `pack` → `publish`. 이 저장소의 규칙 그대로다 | 제품 동봉으로 가면 `io.terra.*`로 개명하고 코어 `bundled-modules.json`에 선언한다. **게시 전이라 개명 비용이 0이다** |
| **Q-2** | Master 데이터를 웹에 어떻게 건네나 | **(다) 이 화면은 Master 데이터를 갖지 않는다** — "쓸 수 없다"로 보인다 | (가) Scene 중계 — 셸 Scene의 Function이 사용자 자격으로 `call`하고 `bind`로 넘긴다 · (나) Core peer 중계를 넓힌다(ADR 감) |
| **Q-3** | 메모 · 설계도 · 맵 배치를 어디에 두나 | **이 브라우저 + Terra 사용자 문서 저장소**(C-1 — Terra G0~G6이 열었다). 브라우저(LayoutStore · `localStorage`, 노드 · 주체마다)에 바로, 사용자 문서(`app:<앱 id>` 이름공간 — 앱 토큰이면 고정)에 뒤따라. `kind`는 `scene` 그대로 — 모듈 백엔드가 필요 없다 | `config.json` `layoutStore: local`(브라우저에만) · `none`(저장 안 함) — 백로그 Q-14 |
| **Q-4** | 보드를 어떻게 여나 | **`srcdoc`** — 판정서의 (가) · (나) · (다) 어느 것도 아닌 넷째 길. 프로토타입의 iframe 구조를 그대로 두고, 같은 앱의 페이지를 받아 `srcdoc`으로 넣는다. `srcdoc` 문서는 부모의 origin · CSP를 이어받아 `frame-ancestors` 검사를 타지 않는다 | (가) 한 문서 안에 마운트 · (다) 플랫폼 `frame-ancestors`에 `'self'`(P-3) |
| **Q-5** | 여러 tree 전환 | **(가) 뺀다** — tree 목록은 비어 있고, 다른 tree로 가려 하면 *"다른 tree로는 이 화면이 닿지 않는다"* | (나) 셸 수준의 기능으로 따로 설계한다 |
| **Q-6** | 폰트 | **(나) 시스템 글꼴** — Google Fonts를 뺐다(CSP `font-src 'self' data:`). 글꼴 스택의 `Noto Sans KR` → `system-ui` … 로 떨어진다 | (가) 서브셋을 `web/public/`에 넣어 번들 |

새 GUI를 올리며 생긴 결정 **Q-7~Q-13**(시작 화면을 entry로 · Terra 안 로그인 모양 · 연동 층 일원화 · `node.config`★ · 디자인 노트 페이지 ·
maingui를 따라가는 방법 · "삭제"의 뜻)은 [`web/docs/guides/implementation-backlog.md`](web/docs/guides/implementation-backlog.md) §4.

> [!NOTE] `branch`는 처음부터 `main`이다 — 판정서 §6과 다른 점
> 판정서 §6은 `branch: "dev"`로 시작해 마지막 단계에서 `main`으로 올리자고 적었다. 예시 데이터뿐인 화면이 설치만으로
> 노드의 main 자리를 차지하지 않게 하려는 순서였다. 이 모듈은 처음부터 `main`으로 간다.
>
> - 그 순서가 기다리던 것 중 1~3단계(frame · 로컬 실데이터)와 P-4(웹 빌드 단계)가 이 모듈과 함께 들어왔다. 남은 것은
>   Q-1이고, 기본값(tree 레지스트리)에서는 **설치 자체가 운영자의 선택**이다.
> - base는 main을 조용히 갈아치우지 않는다 — main이 이미 있으면 둘이 되어 고르는 화면(CHOOSE)이 뜬다. 그리고 오늘
>   코어는 main을 동봉하지 않아 새 노드가 `MAIN_NOT_FOUND`로 시작한다. `dev`로 두면 이 모듈은 그 오류 화면의 dev
>   버튼으로만 열린다(Terra `docs/modules/terra-gui/design/terra-base-scene-branch-design.md` §4의 표).
> - 시험 설치에서 main 자리를 비워 두고 싶으면 `contributions.gui.scenes[0].branch`를 `"dev"`로 바꾼다.

## 개발

```bash
# Linux — 이 모듈의 web/ 에서. Windows(PowerShell)·macOS 도 같은 명령이다
cd common/lab.stellaxia.node-gui/web
npm ci
npm run dev          # http://localhost:5173 — 단독 실행, 데이터 없음(빈 세계)
npm test             # 연동 층 · 실데이터 층 · 모듈 프로필 · 추가 · 수정 · 삭제 · 이벤트 · 손 동작 시험 (100개)
npm run build        # ../ui/ 를 새로 쓴다
```

```bash
# 저장소 루트에서 — CI 와 릴리스가 부르는 것과 같다
npm run build:web -- --module lab.stellaxia.node-gui
npm run test:web -- --module lab.stellaxia.node-gui
terra module pack common/lab.stellaxia.node-gui --out /tmp/node-gui.tmod
```

화면을 바꾸려면 `web/design/*.dc.html`을 고치고 `npm run gen`(python3) — `web/src/screens/*.js`는 생성물이라
덮어쓰인다. 생성기(`web/tools/gen-pages.py`, module 변형)는 Google Fonts 링크를 빼고, 모듈 스크립트의 **첫 import**로
`frame-boot.js`를 넣고, 페이지가 **부트 프로필(`prep`)이 돌려준 클래스를 마운트**하게 하고, 템플릿에 박힌 예시 글자(세션 띠의 `admin · 21:40`,
`예시 데이터` 배지, 보드의 "시연" 스위치)를 바인딩으로 바꾸고, 시작 화면의 아이디 · 비밀번호 판을 [Terra 로그인]으로 바꾸고,
보드 iframe을 `data-board`로 · 화면 무대를 창 크기로 둔다. 모두 Terra 안에서 필요한 것이라 손으로 고친 페이지가
생성으로 되돌아가지 않게 생성기에 들어 있다. 원본이 바뀌어 패치 대상이 사라지면 생성이 멈춘다.
GUI 원본 저장소(maingui)에서 원본을 가져오는 순서는 [`web/docs/guides/module-profile.md`](web/docs/guides/module-profile.md) §8.

> [!WARNING] `terra module pack` 은 `ui/` 를 보지 않는다
> `ui/`가 없어도, `terra module new --web`의 자리 표시자만 있어도 `VERIFIED true`로 포장되고 설치하면 빈 화면이
> 뜬다(실측 — 아래 표). 손으로 포장할 때는 `npm run build:web`을 먼저 돌린다. 저장소의 `npm run pack`(CI ·
> 릴리스 경로)은 이 경우를 막는다.

## 검증

### 끊긴 뒤 이어서 — MD-21 (2026-10-05, 0.3.0 · io.terra.file 0.2.1)

같은 스택에 io.terra.file 0.2.1과 이 모듈을 깔고, leaf UI 셸 안에서 4 MB 파일(조각 16개)을 주고받다가 **페이지를 떠나** 끊은 뒤 다시 로그인해 이었다.
내용은 SHA-256으로 견줬다 — 자세히는 [`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md) §5.4.

| 항목 | 진짜 스택에서 |
| --- | --- |
| 올리기 | 31%에서 끊김 → 같은 파일을 다시 `↑ 올리기` → `31%부터 이어서` · 조각 11개만 더 보냈다 · 내용이 같다 |
| 받기 | 31%에서 끊김 → 이 브라우저 IndexedDB에 1310720 B → 다시 `받기` → `31%부터 이어서` · 내용이 같다 · 앞선 받기는 닫혔다 |
| 멈춘 카드 | 15초 뒤 `어긋남` · `멈췄다 · 31%에서 보내던 화면이 닫혔다` · [이어서 · 중단] → 이름이 다른 같은 파일로 이었다 |
| 중단 · 치우기 | 중단 → `중단됨` · `31% 남겨 둠` · 부분 파일 1310720 B → 같은 파일 다시 올리기로 이었다. 치우기 → 카드 · 기록 · 부분 파일이 모두 사라졌다 |
| io.terra.file 0.2.1 | 0.2.0은 invoke로 보낸 중단의 `keep_partial`을 듣지 않았다(`kept_partial: false` · 기록 404 · 부분 파일 없음) → 0.2.1은 `kept_partial: true` · 기록 200 · 부분 파일 남음 |
| 시험 | `npm test` 111 · `test:smoke`(진짜 IndexedDB 포함) · io.terra.file `go test`(고치기 전 코드로는 새 시험이 실패) · `validate` · `test:web` · `test:scenes` 통과 · 페이지 오류 0 |

### Terra G0~G6 연동 — MD-11 · MD-12 · MD-15~MD-19 (2026-10-05, 0.3.0)

Terra(main + [Terra#118](https://github.com/StellaxiaLab/Terra/pull/118))로 빌드한 스택에 이 모듈 0.3.0과 modules main의 `io.terra.file` · `io.terra.io-inventory` 0.2.0을 깔고,
이 모듈 앱 토큰으로 Chromium(Playwright)에서 돌렸다. 결과는 관리자 토큰으로 서버에 직접 물어 견줬다 — 자세히는 [`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md) §5.3.

| 항목 | 진짜 스택에서 |
| --- | --- |
| MD-11 실시간 이벤트 | SSE `open` · 네트워크 카드 `실시간`. 장치를 손 등록하자 `terra.io.devices.changed` → I/O 앱만 다시 받았다 |
| MD-18 장치 손 등록 | I/O 앱 폼(이름 · 주소) `rtsp://…` → Daemon `adapter_id: manual.rtsp` · `kind: camera` |
| MD-12 다른 노드 | 그 노드 카탈로그 49개 · `io.devices.get` · 모듈 로그 중계 200 · 로컬 전용(`local-fs`)은 부르지 않고 잠금 |
| MD-20 다른 노드의 공유 폴더 | 모듈 코드를 앱 토큰으로 진짜 게이트웨이에 — 목록 · 400 KB 올리기 · 받기(내용 같음) · 지우기가 모두 원격 모듈 경로로 |
| MD-16 로그 · 탐색기 · 열기 | 모듈 로그 → 상태 화면 출력 칸 · 로컬 루트(`root` · `home🔒`) → `etc` 153개 · 열기 → 이 컨테이너엔 바탕화면이 없다는 글(503) |
| MD-17 올리기 · 받기 | `↑ 올리기` 단추 → 파일 고르기 → 300 KB(조각 둘) 검사 통과 · 서버 크기 같음 → 폴더 앱 `받기` → 내려받은 내용이 같다 |
| MD-15 사용자 문서 | `app:lab.stellaxia.node-gui.web/layout/<node_id>` · **새 브라우저**(빈 저장소)에서 같은 표지 · 메모 · 겹쳐 쓰면 409 한 번 알림 |
| MD-19 디자인 | `design/`이 maingui `2ced429`와 파일 단위로 같다 · 페이지 오류 0 |
| 시험 | `npm test` 100 · `test:smoke` · `validate` · `test:web` 통과 |

### 구현해야 할 것 — MD-4 · MD-5 · MD-8 (2026-10-05)

| 항목 | 진짜 스택에서 |
| --- | --- |
| MD-5 자기 칸 | 이 노드 칸을 고르면 캡슐(이름 · 로고)이 뜬다 — 연결은 원본 규칙(공유 · 내보내기)대로 |
| MD-4 저장본의 `node_id` | 저장본에 `nodeIds: { stack-leaf-01: node_… }`. 이름이 바뀐 노드 · 같은 이름을 얻은 다른 노드는 시험(`tests/module.test.mjs`)으로 본다 |
| MD-8 로그아웃 | 세션 띠의 [로그아웃] → 시작 화면이 노드 화면을 걷고 판으로(누름은 판이 받는다) → [Terra 로그인] → 같은 맵으로 다시 내려간다 |
| 시험 | `npm test` 80 · `test:smoke` · `validate` · `test:web` · `test:scenes` 44 통과 · 예시 표식 0건 |

### maingui 기준 — 추가 · 수정 · 삭제 · 상태 화면 · 모듈 GUI 창 (2026-10-04)

maingui `f24c3bc`에 맞춘 0.2.0을 같은 스택에 깔고, 화면을 사람처럼 눌러(`＋ 추가` · `✎` · `🗑` · 폼 칸 · 저장) 돌린 뒤 관리자 토큰으로 서버에 직접 물어 견줬다.

| 단계 | 관찰 |
| --- | --- |
| 공유 폴더 | 폴더 · 빈 파일 만들기 → 디스크에 생김 · 이름 바꾸기 → 바뀜 · 두 번 눌러 지우기 → 사라짐(서버 목록이 처음과 같아졌다) · 공유 폴더 맨 위 칸에서는 부르지 않고 이유 |
| I/O 장치 | 폼에서 이름 · 승인 → Daemon 별명 `E2E 마이크` · `approved` · 종류는 못 바꾼다고 말한다 · 추가 = 스캔 |
| 명령 · 작업 | 앱 바 `+ 실행` → 폼 → `echo e2e-crud` → 새 Daemon 작업 `succeeded` |
| 터널 · 모듈 | Master op 은 leaf 게이트웨이에 없다고 폼 · API 줄(⚠)에 적는다 · 모듈 설치는 폼을 열지 않는다 · 이 모듈의 GUI 창은 "지금 보고 있는 이 화면" |
| 상태 화면 · 오버헤드 패널 | 자원 · 노드 칸의 진짜 값 · `로그인됨 — 이 화면의 세션` · 패널 접힘이 새로 고침 뒤에도 남는다 |
| 예시 표식 · 콘솔 | **0건** · 콘솔 오류는 셸의 `/api/product/session` 404뿐 |
| 찾아 고친 것 | 시작 화면의 아래 두 알약이 내려간 뒤에도 노드 화면 아래 누름을 가로챘다(폼 저장 단추가 눌리지 않음) — 원본에도 있다(백로그 UP-15) |
| `npm test` · `test:smoke` · `validate` · `test:web` · `test:scenes` | 76 통과 · 연기 시험 통과 · 오류 0 · 통과 · 44 통과 |

원본의 추가 · 수정 · 삭제 대응(`HELM_CRUD`)은 본문 일부가 실제 서버와 달라(폴더 `root` · 선언 모양 · 터널 · 피어 회수 · Master POST의 `node_id`)
모듈은 서버 코드로 확인한 본문으로 옮겼다 — [`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md) §2.4 · 백로그 UP-12 · UP-13.

### 새 GUI — 진짜 스택 (2026-10-04)

같은 스택에 0.2.0(앱 entry = 시작 화면)을 `terra module install --dev --force`로 깔고 Chromium(Playwright)으로 돌렸다.
모든 frame(시작 화면 · 노드 화면 srcdoc · 보드 srcdoc)의 보이는 글자에서 예시 표식을 찾았다.

| 단계 | 관찰 |
| --- | --- |
| 시작 화면 — 로그인 전 | "Terra에 로그인하지 않았다" · [Terra 로그인] · **비밀번호 칸 없음** |
| [Terra 로그인] → 셸 로그인 카드 | frame 다시 띄움 → "admin@stack.local(으)로 들어가는 중…" → 구름 → 미리 읽은 노드 화면(srcdoc) |
| 노드 자원 · 연결 | I/O 장치 둘을 필드에 설치 → 조타륜을 닫아도 모니터링 값이 원본 목록과 이어진다 · 연결하기가 빈 필드에 돌길을 깐다(노드 자신의 칸은 지나지 않는다) |
| 도로 편집기 · 보드 | 보드(srcdoc)로 뜨고 내보내기를 노드 화면이 받는다 · 네트워크 · 설정 · 건물 편집기 — CSP 거절 0 |
| 다시 열기 | 셸 새로 고침 → 다시 로그인 → 자원 · 연결 · 도로 · 메모 · 표지가 되살아난다(LayoutStore) |
| 창 크기 · 로그아웃 | 1800×1050에서 꽉 찬다 · 로그아웃 → 빈 세계, 저장본은 그대로 |
| 예시 표식 · 콘솔 | **0건** · 콘솔 오류는 셸의 `/api/product/session` 404뿐 |
| `npm test` · `test:smoke` · `validate` · `test:web` · `test:scenes` | 53 통과 · 연기 시험 통과 · 오류 0 · 통과 · 44 통과 |

### 실데이터 — 진짜 스택 (2026-10-03)

진짜 Master · Daemon(등록) · 게이트웨이 · `io.terra.file` · `io.terra.io-inventory` · leaf UI 셸(Vite) 위에 포장물을
`terra module install --dev --force`로 깔고 Chromium(Playwright)으로 돌렸다. 화면에 보이는 글자 전체(보드 iframe 포함)에서
예전 예시 표식 60여 개(노드 이름 · 장치 · 메모 · 알림 · IP · `21:40` · `예시 데이터` · `시연` …)를 찾았다.

| 단계 | 관찰 |
| --- | --- |
| 15개 상태 — 로그인 전 · 로그인 · 조타륜 10앱 · 폴더 보관함 · tree 맵 · 네트워크 3묶음 · 설정 5탭 · 자재 편집기 · 로그아웃 | 예시 표식 **0건** |
| 로그인 | 맵 `stack-leaf-01` · 부모 `tree · 127.0.0.1:28080` · 자원 `I/O 장치 3 · 공유 폴더 1 · 모듈 4` · 띠 `admin@stack.local` + 토큰 권한 6개 |
| 동작 | 공유 폴더 만들기 → 디스크에 생김 · 지우기 → 사라짐 · I/O 승인 → Daemon `approved` · 모듈 상태 확인 · 작업 보기 |
| 알림 | 다른 길로 Daemon 작업을 하나 만들면 12초 안에 알림 + 책갈피 |
| 보드 | 네트워크: WireGuard `terra0` 꺼짐 + 데몬이 준 설치 계획 · Master 묶음 "닿지 않음". 설정: `daemon.device_name = stack-leaf-01` 등 실제 값 · 계정 = whoami |
| `npm test` · `npm run test:smoke` | 42개 통과 · 연기 시험 통과 |

실측에서 드러난 플랫폼 사실(whoami 를 invoke 로 부르면 `anonymous`, leaf 게이트웨이의 모듈 로그 미지원 등)은
[`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md) §5.1.

### 포장 · frame (2026-10-01)

| 명령 · 환경 | 결과 |
| --- | --- |
| `npm run validate` | 오류 0 · 이 모듈의 경고 0. `ui/`가 없는 소스 트리에서도 통과 — 웹 모듈의 앱 entry는 모양만 본다 |
| `npm run build:web` | `ui/` 26개 파일 · 931,070 bytes. 앱 entry 검사 통과 |
| `npm run test:web` | 13개 통과 |
| `npm run pack -- --cli … --terra … --tag …` | 저장소 13개 모듈 · 자산 33개 · 디스크와 목록의 수 일치. 이 모듈은 `FILES 37` · `VERIFIED true` · 323,401 bytes |
| 같은 명령, `ui/` 없이 | exit 1 — `앱 lab.stellaxia.node-gui.web 의 entry ui/node.html 가 없다`. `modules.json`을 쓰지 않는다 |
| 같은 명령, `ui/node.html`이 스캐폴드 자리 표시자 | exit 1 — `… 가 아직 자리 표시자다`. `modules.json`을 쓰지 않는다 |
| `terra module pack` 단독, `ui/` 없이 · 자리 표시자 | 둘 다 `VERIFIED true` (`FILES 11` · `12`) — 위 두 줄이 있는 이유 |

브라우저 끝까지(E2E) — 진짜 `terra-gateway`(Master introspection 모드, Master는 forward-auth · Daemon은 auth-file)와
진짜 leaf UI 셸(Vite) 위에서, 포장물을 풀어 Scene 루트로 주고 Chromium(Playwright)으로 돌렸다. Master와
Daemon만 가짜다.

| 단계 | 관찰 |
| --- | --- |
| 셸이 main을 연다 | frame 안에 노드 화면. 띠 *"Terra에 로그인하지 않았습니다"* (`NO_SESSION`) — 그때는 예시 데이터가 보였다. 지금은 빈 세계(위 2026-10-03) |
| [로그인] → `/login` → 자격 로그인 | `POST /api/v1/auth/credentials` 200 → 앱 토큰 발급 200 → frame 토큰의 권한 7개, 값 `{ state: 'signedIn', principal: 'alice@example' }` |
| 조타륜 I/O 장치 | 가짜 Daemon의 장치 목록이 보인다 (`terra.daemon.io.devices.get` 200) |
| 조타륜 공유 자원 (Master) | `쓸 수 없다 · Master를 거치는 기능은 이 화면에 아직 열리지 않았다`. Master 호출은 2번(frame 클라이언트의 토큰 재발급 재시도 포함)에서 멈추고, 10초 폴링 뒤에도 2번이다 |
| 전체 화면 → 건물 편집기 | `about:srcdoc` · 제목 *"Terra · 건물 편집기"* · 보드 안에서 화면이 마운트된다. 보드의 돌아가기 링크 → 전체 화면이 닫힌다 |
| [로그아웃] | `DELETE /api/v1/auth/credentials` · 앱 토큰 회수 → 띠가 돌아온다(지금은 빈 세계로 돌아간다) |
| 콘솔 | CSP 위반 0 · handshake 경고 0. 오류는 둘 — 셸의 `/api/product/session` 404(이 모듈과 무관)와 위의 Master 401(의도) |

## 관련 문서

- [저장소 README](../../README.md) — 접두사(Q-1), 웹 화면을 가진 모듈의 빌드 · 포장
- [`docs/layout.md`](../../docs/layout.md) — L-6 · L-8 웹 모듈 절, L-10 Scene 두 층
- [`web/README.md`](web/README.md) — 웹 프로젝트 소개 · [`web/docs/README.md`](web/docs/README.md) — 웹 개발 문서 MOC
- [`web/docs/api/real-data-layer.md`](web/docs/api/real-data-layer.md) — 예시 데이터를 지운 방법 · 출처 · 빈 자리 · 실측
- [`web/docs/guides/module-profile.md`](web/docs/guides/module-profile.md) — 변형(demo · service · module) · 시작 화면 · LayoutStore · 원본(maingui)과 맞추기
- [`web/docs/guides/implementation-backlog.md`](web/docs/guides/implementation-backlog.md) — 구현해야 할 것 (PF · MD · UP · Q)
- Terra `docs/reports/terra-node-gui-main-module-feasibility-2026-10-01.md` — 가능성 판정 · 플랫폼 공백 P-1~P-5 · 결정 Q-1~Q-6
- Terra `docs/modules/terra-gui/design/terra-base-scene-branch-design.md` — base Scene이 main을 고르는 규칙
- Terra `products/common/apps/terra-cli/internal/app/webscaffold/` — `terra-frame-client.js`의 원본(`web/src/api/`에 그대로 사본)

## 관련 모듈

- `io.terra.scene.terra` (Terra 코어) — 이 main을 띄우는 base Scene
- [`io.terra.file`](../../leaf/io.terra.file) · [`io.terra.io-inventory`](../../leaf/io.terra.io-inventory) — 공유 폴더 · 전송(0.2.0 받기 · 0.2.1 부분을 남기는 중단) · I/O 장치(0.2.0 손 등록) 데이터의 출처
- [`lab.stellaxia.scene.hello`](../lab.stellaxia.scene.hello/README.md) — 같은 tree 레지스트리 경로의 가장 작은 Scene 모듈
- GUI 원본 저장소 [`StellaxiaLab/maingui`](https://github.com/StellaxiaLab/maingui) — 디자인 원본 · service 판(뿌리) · demo 판(`examples/`). 이 모듈의 `design/`은 `2ced429`와 같다

## 관련 흐름

- 위 "어떻게 맞물리나" 그림 — base Scene → 셸 Scene → frame → 시작 화면 → 노드 화면(srcdoc) → Gateway
- 로그인 → 이 노드 · 부모 tree · 자원 읽기(`loadWorld`) → LayoutStore 되살리기(브라우저 · 사용자 문서 중 새 쪽) → 조타륜 앱 연결 → 실시간 이벤트(폴링은 바닥) · 로그아웃 → 빈 세계(저장본은 남는다)
- 다른 노드 — 관계도의 `node_id` → 그 노드 카탈로그 → 노드 주소 호출(Master 중계 · 대상 Daemon 판정)
- 빌드 · 출하 — `npm run build:web` → `npm run pack`(앱 entry 검사) → 릴리스 자산 → `publish`
- 자원 추가 · 수정 · 삭제 — 폼 저장 · 두 번째 누름 → `source.crud`(실제 본문) → 이 노드의 Gateway → 목록 다시 받기 — 서버에 길이 없으면 지어내지 않는다
- 원본 따라가기 — maingui `design/` 복사 → `npm run gen`(패치를 못 찾으면 멈춤) → 시험 → `build:web`
- 끊긴 뒤 이어서 — 올리기는 서버의 checkpoint(전송 목록 → `resume_id`), 받기는 이 브라우저의 조각(IndexedDB) → 서버의 SHA-256으로 끝에서 견준다
