---
title: "Terra 노드 — 게임 GUI main 모듈"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "draft"
version: "v0.1"
last_updated: "2026-10-01"
---

# Terra 노드 (`lab.stellaxia.node-gui`)

게임 GUI 형태의 Terra 노드 화면 — 육각 필드 맵 · 조타륜 · 오버헤드 패널 · 편집기 — 을 노드의 **main GUI**로 내는
모듈이다. base Scene(`io.terra.scene.terra`)은 main이 하나면 그것을 곧장 띄운다.

화면은 프로토타입 `terra-node-gui`를 그대로 옮긴 것이다. 모듈이 더한 것은 셋이다.

1. **얇은 셸 Scene** — `terra.web/frame` 하나와 로그인 Route 하나.
2. **frame 배선** — 웹이 Terra 셸 안에서 스코프 토큰으로 이 노드의 게이트웨이를 부른다.
3. **웹 빌드 단계** — 이 저장소가 `web/`을 `ui/`로 굽는다([저장소 README](../../README.md)의 "웹 화면을 가진 모듈" 절).

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
│  ├─ src/                     화면(screens) · 런타임(runtime) · 연동 층(api) · 모델(model)
│  ├─ design/                  디자인 캔버스 원본 (*.dc.html)
│  ├─ tools/gen-pages.py       design → 화면 페이지
│  └─ tests/api.test.mjs       연동 층 시험 (node:test — 브라우저 없이 돈다)
└─ ui/                         web/ 의 빌드 결과 — 커밋하지 않는다 (.gitignore)
```

[`docs/layout.md`](../../docs/layout.md)의 L-10(Scene 두 층)을 따르고, `web/` · `ui/`는 L-6 · L-8의
**웹 모듈** 절을 따른다 — `ui/`는 `bin/`처럼 빌드 산출물이다.

## 어떻게 맞물리나

```mermaid
flowchart LR
  BASE["base Scene<br/>io.terra.scene.terra"] -->|"main 하나 → 곧장 연다"| SH["셸 Scene<br/>lab.stellaxia.node-gui.ui"]
  SH -->|"/ — terra.web/frame"| APP["웹 앱<br/>lab.stellaxia.node-gui.web<br/>ui/node.html"]
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
| `contributions.gui.apps[0]` | `mode: static` · `embed: "scene"` · `entry: ui/node.html`. 게이트웨이가 앱별 origin(`app-….localhost`)에서 서빙한다. 권한 7개(`session.identity` · `node.read` · `node.control` · `file.read` · `file.write` · `process.execute` · `module.manage`) — 토큰에 실리는 것은 **사용자 권한 ∩ 이 목록**이다 |
| `node-gui.main` (`/`) | 루트가 `terra.web/frame` 하나다(Fragment 루트라 셸의 1120px 틀을 벗는다). `bind: session` → `terra.frame.value`, `on: login → node-gui.login.open · logout → node-gui.signout` |
| `node-gui.login` (`/login`) | 자격 로그인. **웹은 비밀번호를 보지 않는다.** 성공하면 `session`(memory)을 `signedIn`으로 쓰고 `/`로 돌아간다 — frame은 새 토큰과 값을 받는다 |
| `session` 스토어 | frame에 건네는 값(`state` · `principal`). 비밀번호를 든 `signin`(view)과 따로 둔 것은 그 값이 frame으로 나가지 않게 하려는 것이다 |

웹 쪽 배선(`frame-boot.js`가 첫 import로 `hello`를 보내는 이유, 보드를 `srcdoc`으로 여는 이유 등)은
[`web/docs/architecture.md`](web/docs/architecture.md) §7과 [`web/docs/api/frontend-api.md`](web/docs/api/frontend-api.md) §6.5.

## 무엇이 실데이터이고 무엇이 예시인가

| 영역 | Terra 안에서 |
| --- | --- |
| 조타륜 앱 중 Daemon operation을 부르는 목록 — I/O 장치 · 선언 · 폴더 · 터널 · WireGuard · 모듈 | **실데이터.** 맵의 로컬 노드가 이 노드를 대신한다 |
| 조타륜 앱 중 Master operation — 공유 자원 · 허가 · 작업 | `쓸 수 없다 · Master를 거치는 기능은 이 화면에 아직 열리지 않았다` |
| 모듈 namespace operation — 전송 · 폴더 동작 | 이 노드의 카탈로그에 있으면 실데이터, 없으면 `이 노드의 게이트웨이에 없다` |
| 맵의 다른 노드 | 예시. 그 노드의 자원은 `다른 노드의 자원은 아직 이 화면에서 볼 수 없다` |
| 맵 · 관리 노드 창 · tree 목록 · 폴더 보관함 · 메모 | 예시 (메모는 메모리) |
| 로그인 전 · 토큰을 잃었을 때 | 예시 데이터로 돌아가고, 띠가 *"Terra에 로그인하지 않았습니다 — 지금 보이는 것은 예시 데이터입니다"* 와 [로그인]을 보인다 |

Master가 닿지 않는 것은 **결함이 아니라 설계상 경계**다 — 앱 스코프 토큰은 Bearer를 싣지 않으므로 forward-auth인
Master는 401을 낸다. 그 401을 "로그인 필요"로 읽으면 사용자를 헛되이 로그인 화면으로 보내므로, 위임 자격으로 받은
Master 401은 "쓸 수 없다"로 바꾸고 그 뒤로 Master를 부르지 않는다. 어떻게 열지는 아래 Q-2다.

## 남은 결정 — 이번 구현이 고른 기본값

판정서 §7의 결정은 아직 사람이 내리지 않았다. 이 모듈은 **되돌리기 쉬운 쪽**을 골라 두었다.

| | 질문 | 이번 기본값 | 바꾸려면 |
| --- | --- | --- | --- |
| **Q-1** | 어떻게 나가나 (접두사) | **tree 레지스트리** — `lab.stellaxia.*`, `pack` → `publish`. 이 저장소의 규칙 그대로다 | 제품 동봉으로 가면 `io.terra.*`로 개명하고 코어 `bundled-modules.json`에 선언한다. **게시 전이라 개명 비용이 0이다** |
| **Q-2** | Master 데이터를 웹에 어떻게 건네나 | **(다) 이 화면은 Master 데이터를 갖지 않는다** — "쓸 수 없다"로 보인다 | (가) Scene 중계 — 셸 Scene의 Function이 사용자 자격으로 `call`하고 `bind`로 넘긴다 · (나) Core peer 중계를 넓힌다(ADR 감) |
| **Q-3** | 메모 · 설계도 · 맵 배치를 어디에 두나 | 정하지 않았다 — 메모리(새로 고치면 사라진다). `kind`는 `scene` 그대로 | `kind: service`로 올려 모듈 백엔드가 `X-Terra-Subject`로 사람별로 저장한다 |
| **Q-4** | 보드를 어떻게 여나 | **`srcdoc`** — 판정서의 (가) · (나) · (다) 어느 것도 아닌 넷째 길. 프로토타입의 iframe 구조를 그대로 두고, 같은 앱의 페이지를 받아 `srcdoc`으로 넣는다. `srcdoc` 문서는 부모의 origin · CSP를 이어받아 `frame-ancestors` 검사를 타지 않는다 | (가) 한 문서 안에 마운트 · (다) 플랫폼 `frame-ancestors`에 `'self'`(P-3) |
| **Q-5** | 여러 tree 전환 | **(가) 뺀다** — 전환 연출은 예시로 남기고 한 번 알린다(*"다른 tree의 게이트웨이에는 이 화면이 닿지 않는다"*) | (나) 셸 수준의 기능으로 따로 설계한다 |
| **Q-6** | 폰트 | **(나) 시스템 글꼴** — Google Fonts를 뺐다(CSP `font-src 'self' data:`). 글꼴 스택의 `Noto Sans KR` → `system-ui` … 로 떨어진다 | (가) 서브셋을 `web/public/`에 넣어 번들 |

## 개발

```bash
# Linux — 이 모듈의 web/ 에서. Windows(PowerShell)·macOS 도 같은 명령이다
cd common/lab.stellaxia.node-gui/web
npm ci
npm run dev          # http://localhost:5173 — 단독 실행, 예시 데이터
npm test             # 연동 층 시험 (13개)
npm run build        # ../ui/ 를 새로 쓴다
```

```bash
# 저장소 루트에서 — CI 와 릴리스가 부르는 것과 같다
npm run build:web -- --module lab.stellaxia.node-gui
npm run test:web -- --module lab.stellaxia.node-gui
terra module pack common/lab.stellaxia.node-gui --out /tmp/node-gui.tmod
```

화면을 바꾸려면 `web/design/*.dc.html`을 고치고 `npm run gen`(python3) — `web/src/screens/*.js`는 생성물이라
덮어쓰인다. 생성기(`web/tools/gen-pages.py`)는 Google Fonts 링크를 빼고, 모듈 스크립트의 **첫 import**로
`frame-boot.js`를 넣는다. 둘 다 Terra 안에서 필요한 것이라 손으로 고친 페이지가 생성으로 되돌아가지 않게
생성기에 들어 있다.

> [!WARNING] `terra module pack` 은 `ui/` 를 보지 않는다
> `ui/`가 없어도, `terra module new --web`의 자리 표시자만 있어도 `VERIFIED true`로 포장되고 설치하면 빈 화면이
> 뜬다(실측 — 아래 표). 손으로 포장할 때는 `npm run build:web`을 먼저 돌린다. 저장소의 `npm run pack`(CI ·
> 릴리스 경로)은 이 경우를 막는다.

## 검증

2026-10-01 실측.

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
| 셸이 main을 연다 | frame 안에 노드 화면. 띠 *"Terra에 로그인하지 않았습니다 — 지금 보이는 것은 예시 데이터입니다"* (`NO_SESSION`) |
| [로그인] → `/login` → 자격 로그인 | `POST /api/v1/auth/credentials` 200 → 앱 토큰 발급 200 → frame 토큰의 권한 7개, 값 `{ state: 'signedIn', principal: 'alice@example' }` |
| 조타륜 I/O 장치 | 가짜 Daemon의 장치 목록이 보인다 (`terra.daemon.io.devices.get` 200) |
| 조타륜 공유 자원 (Master) | `쓸 수 없다 · Master를 거치는 기능은 이 화면에 아직 열리지 않았다`. Master 호출은 2번(frame 클라이언트의 토큰 재발급 재시도 포함)에서 멈추고, 10초 폴링 뒤에도 2번이다 |
| 전체 화면 → 건물 편집기 | `about:srcdoc` · 제목 *"Terra · 건물 편집기"* · 보드 안에서 화면이 마운트된다. 보드의 돌아가기 링크 → 전체 화면이 닫힌다 |
| [로그아웃] | `DELETE /api/v1/auth/credentials` · 앱 토큰 회수 → 띠가 돌아오고 예시 데이터로 되돌아간다 |
| 콘솔 | CSP 위반 0 · handshake 경고 0. 오류는 둘 — 셸의 `/api/product/session` 404(이 모듈과 무관)와 위의 Master 401(의도) |

## 관련 문서

- [저장소 README](../../README.md) — 접두사(Q-1), 웹 화면을 가진 모듈의 빌드 · 포장
- [`docs/layout.md`](../../docs/layout.md) — L-6 · L-8 웹 모듈 절, L-10 Scene 두 층
- [`web/README.md`](web/README.md) — 웹 프로젝트 소개 · [`web/docs/README.md`](web/docs/README.md) — 웹 개발 문서 MOC
- Terra `docs/reports/terra-node-gui-main-module-feasibility-2026-10-01.md` — 가능성 판정 · 플랫폼 공백 P-1~P-5 · 결정 Q-1~Q-6
- Terra `docs/modules/terra-gui/design/terra-base-scene-branch-design.md` — base Scene이 main을 고르는 규칙
- Terra `products/common/apps/terra-cli/internal/app/webscaffold/` — `terra-frame-client.js`의 원본(`web/src/api/`에 그대로 사본)

## 관련 모듈

- `io.terra.scene.terra` (Terra 코어) — 이 main을 띄우는 base Scene
- [`lab.stellaxia.scene.hello`](../lab.stellaxia.scene.hello/README.md) — 같은 tree 레지스트리 경로의 가장 작은 Scene 모듈

## 관련 흐름

- 위 "어떻게 맞물리나" 그림 — base Scene → 셸 Scene → frame → 웹 → Gateway
- 빌드 · 출하 — `npm run build:web` → `npm run pack`(앱 entry 검사) → 릴리스 자산 → `publish`
