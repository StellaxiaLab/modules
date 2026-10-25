---
title: "기존 node-gui 기능 층 분석 — 표현을 뺀 앱 계층"
aliases:
  - "node-gui 기능 층 분석"
  - "앱 계층 분석"
  - "Legacy App Layer"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-22"
language: "ko-KR"
based_on: "modules main 9d37f62 · common/lab.stellaxia.node-gui/web/src 의 api · store · model · data · boot (정독 + 결합도 계측 — 실행 · 시험은 하지 않음)"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|GUI v3 문서 MOC]]"
  - "[[legacy-node-gui-overview|기존 node-gui 전체 분석]]"
---

# 기존 node-gui 기능 층 분석 — 표현을 뺀 앱 계층

## 1. 한 줄

UI를 뺀 기능 층(`src/api` · `src/store` · `src/model` · `src/data` · `src/boot`)은 약 6,800줄이다.
**약 2,800줄은 화면과 무관해 그대로 가져갈 수 있고**, 약 1,500줄은 표현(문구 · 색 · 옛 화면 모양)만 걷어내면 되고,
약 2,500줄은 옛 화면에 끼워 넣는 연결 코드라 v3에서 새로 짠다 — 다만 그 안의 **동작 순서와 규칙**은 옮겨야 한다.

판정 기준은 파일마다 화면 객체(`screen.state` · `setState` · 화면 메서드)와 DOM을 몇 번 건드리는지 센 값이다(§4).

## 2. 계층

```text
L6 연결(glue) ── wire.js · data/*-live.js · link-wire · svi-live · frame-boards · boot/*   ← v3에서 새로 짠다
        │  화면 메서드를 바꿔 끼우고 screen.setState로 결과를 쓴다
L5 저장 ──────── store/layout · docs(사용자 문서) · parts(IndexedDB 조각)
L4 서비스 ────── source.js LiveSource(list · act · crud · upload · download · lockFor) · events.js(SSE)
L3 도메인 ────── adapters · model/link-io · link-apply · link-sync · task-output · svi-stream
                 · data/world · files · alarms · network-master · sha256
L2 계약 표 ───── operations.js(앱별 op · 권한 · 입력 만들기 · CRUD) · master-delegated.js(생성물)
L1 클라이언트 ── client.js TerraClient(카탈로그 · Result · 위임 · 노드 중계 · upstream) · module-gate · config
L0 전송 · 세션 ─ terra-frame-client · frame-token · frame-boot · frame-session · live-host
```

경로는 모두 `common/lab.stellaxia.node-gui/web/src/` 기준이다.

## 3. 계층별로 하는 일

| 층 | 핵심 | 지키는 규칙 |
| --- | --- | --- |
| **L0 전송 · 세션** | 셸 frame과 hello/init을 주고받고 앱 스코프 토큰을 받는다. 토큰 갱신은 한 번에 하나만(single-flight). 로그인 · 로그아웃은 셸에 요청만 보낸다(`emit`) | hello는 첫 import에서(셸 대기 10초). 웹은 비밀번호를 받지 않는다. 401이 동시에 여러 개 와도 토큰은 한 번만 새로 받는다 |
| **L1 클라이언트** | `invoke(opId)` 한 길로 부르고, 응답을 `Result`(`ok` · `accepted` · `forbidden` · `unavailable` …)로 바꾼다 | 카탈로그에 없는 op는 부르지 않는다. Master op는 tree에선 op id로, leaf에선 `/api/upstream` 경로로. 403 `DELEGATION_NOT_OPEN`은 그 op 하나만 잠그고, 옛 Terra의 401이 오면 그 뒤로 Master를 부르지 않는다. 다른 노드는 노드 주소 호출 + 그 노드 카탈로그 60초 캐시. 설치되지 않은 모듈의 op는 부르지 않는다 |
| **L2 계약 표** | 앱 9개(svi · decl · grant · io · folder · xfer · tunnel · wg · job · mod)마다 목록 op · 동작 op · 권한 · 응답 방식 · 입력 만들기, 이 노드일 때(`local`)의 대체 op, CRUD 본문, 등록 · 사용자 · 세션 op | 위치 표시 L(Daemon) · T(Master) · G(Gateway) · M(모듈). 서버에 길이 없는 동작은 `null` — 항목을 지어내지 않는다 |
| **L3 도메인** | 응답 정규화, 노드 관계도, 폴더 트리, 작업 → 알림, 맵 연결 ↔ SVI 바인딩 · 허가(사전 검사 · 적용 · 상태 맞추기 · 끊기), 작업 출력, SVI 흐름 해석, Master 네트워크 읽기 블록 | 대부분 순수 함수 |
| **L4 서비스** | `LiveSource` — 앱 목록 · 동작 · CRUD · 올리기(조각 SHA-256, 409면 서버 offset부터) · 받기(이어받기) · 잠금 사유(`lockFor`). `events` — fetch 스트림 SSE, 백오프, `last_event_id`로 이어 받기 | 신호마다 그 신호에 걸린 앱만 다시 받는다(`SIGNAL_APPS`). SSE가 열려 있으면 폴링은 여섯 배 느린 바닥으로만 남는다 |
| **L5 저장** | 맵 배치 · 노드 모습 · 노드 자원 · 연결 · 메모 · 창 자리를 브라우저에 바로, 사용자 문서(`app:<앱 id>/layout/<node_id>`)에 3초 모아서. 받다 끊긴 파일 조각은 IndexedDB | 새 쪽이 이긴다. 409는 한 번만 알린다. 페이지를 떠날 때 `keepalive`로 마저 쓴다. 로그아웃하면 저장 연결을 먼저 끊어 빈 세계가 저장본을 덮지 않는다 |
| **L6 연결** | 화면 메서드(`hbSeed` · `hbAct` · `hbFormSave` …)를 바꿔 끼우고, 생성자에서 예시 상태를 지우고, `loadWorld` 등이 `setState`를 직접 쓴다 | 옛 화면 구조 전용 |

### 3.1 앱 대응표 (L2)

| 앱 키 | 이름 | 목록 op | 위치 |
| --- | --- | --- | --- |
| `svi` | SVI 자원 | `terra.master.svi.resources.get` (+ grants · handles · bindings) | T |
| `decl` | 자원 선언 | `terra.daemon.svi.declarations.get` | L |
| `grant` | 허가 · 연결 | `terra.master.svi.grants.get` | T |
| `io` | I/O 장치 | `terra.daemon.io.devices.get` | L |
| `folder` | 공유 폴더 | `terra.daemon.files.list.get` | L |
| `xfer` | 파일 전송 | `io.terra.file.transfers.list` | M |
| `tunnel` | 서비스 터널 | `terra.daemon.service-tunnels.get` | L |
| `wg` | WireGuard 피어 | `terra.daemon.wireguard.peers.get` | L |
| `job` | 명령 · 작업 | `terra.master.jobs.get` — 이 노드면 `terra.daemon.tasks.get` | T / L |
| `mod` | 모듈 | `terra.daemon.modules.get` | L |

## 4. 재사용 판정

결합도 계측: 화면 객체 참조 · `setState` · 상태 접근 · DOM(`document` · `window` · `localStorage` · `indexedDB` · `postMessage`) 횟수.

| 판정 | 파일 | 줄 |
| --- | --- | ---: |
| **그대로** — 화면 · DOM과 무관 | `api/client` · `master-delegated` · `module-gate` · `config` · `events` · `frame-token` · `terra-frame-client` · `sha256` · `source` · `svi-stream` · `link-apply` · `link-sync` · `model/link-io` · `link-text` · `permissions` · `types` · `data/world` · `files` · `store/parts` · `docs` | 약 2,800 |
| **손질** — 로직은 좋지만 표현이 섞임 | `api/operations`(앱 이름 · 이모지 · 안내 글 125개) · `adapters`(옛 화면용 상태 낱말 · "3분 전" 같은 문구) · `task-output` · `data/alarms`(색 · 옛 알림 모양 `{t,g,c,m}`) · `network-master`(색 20개) · `model/badges`(색) · `store/layout`(저장 형식이 옛 화면 상태 키) · `api/frame-boot` · `frame-session`(로그인 띠 색) · `data/live-host` | 약 1,500 |
| **새로 짠다** — 옛 화면에 끼워 넣는 연결 코드 | `api/wire` · `data/node-live` · `api/link-wire` · `svi-live` · `data/network-live` · `settings-live` · `intro-live` · `editors-live` · `api/frame-boards` · `boot/*` · `api/index` | 약 2,500 |

결합이 가장 큰 파일: `wire.js`(화면 참조 104 · `setState` 29), `node-live.js`(25 · 13), `link-wire.js`(24 · 7), `svi-live.js`(22 · 3).

### 4.1 새로 짤 코드에서 옮겨야 할 것

- **`wireFrame` + `loadWorld`의 순서** — 토큰 변화 감지 → 카탈로그 → whoami → 이 노드(`terra.daemon.node.get`) · 등록 상태 → 부모 tree · `agent/nodes` → 저장본(브라우저 / 서버 중 새 것) → 자원 · 알림 · 폴더 · 네트워크 · 설정 키 병렬 로드 → 폴링 · SSE 시작. 도중에 세션이 바뀌면 멈춘다.
- **`wire.js` `hbAct`의 규칙** — 위험 동작은 두 번 누르기, 접수(202)된 작업 추적, 동작 뒤 목록 다시 받기.
- **떼어 쓸 순수 함수** — `settings-live`의 135키 스키마 처리(`flatten` · `toWire`), `network-live`의 `tunnelRows` · `peerRows`.

## 5. 숨은 결합 — v3 전에 알아 둘 것

1. **노드를 이름으로 식별한다** — 맵 칸 · 관계도 · 권한 표가 이름이 키이고, `world.nameNodes`와 `layout.remapNodes`가 이름과 id를 이어 붙인다. v3는 처음부터 `node_id`를 키로 쓰고, 옛 저장본을 이어받을 때만 remap을 쓴다.
2. **어댑터 출력이 옛 화면 모양에 맞춰져 있다** — 화면이 상태별 표에 없는 값을 받으면 렌더가 멈췄기 때문에 어댑터가 화면 낱말로 바꾼다. 정규화(도메인)와 표시 문구(UI)를 나눈다.
3. **사용자에게 보일 한국어 문구가 로직 안에 있다** — `client.js` 사유 문구 70개, `operations.js` 125개. 메시지 표로 빼면 L1 · L2가 완전히 UI 중립이 된다.
4. **`operations.js`가 계약과 UI를 섞는다** — op id · 권한 · 입력 만들기 옆에 앱 이름 · 이모지 · 폼 안내가 있다. "조타륜"(`HELM_*` · `hb*`) 같은 옛 화면 용어도 도메인 이름으로 바꾼다.
5. **저장 형식이 옛 화면 상태다** — `maps` · `rsrc` · `links` · `wins` · `utilItems` · `ovhHide`. 맵을 그래프로 바꾸면 형식도 바뀌므로 옛 문서를 옮길지 정한다. 앱 id를 그대로 두면 서버의 옛 배치 문서를 읽을 수 있다(v3는 모듈 id가 달라 앱 id도 달라진다 — 이어받으려면 결정이 필요하다).
6. **`MockSource`는 흔적이다** — 실데이터 층에서는 빈 목록만 돌려준다. 버린다.

## 6. 시험 재사용

| 판정 | 시험 |
| --- | --- |
| 그대로 돈다 | `api` · `frametoken` · `data` · `module-gate` |
| 기능 층 위주지만 연결 코드도 import | `linkapply`(`link-wire`) · `linkio`(`boot/fixes` · `store/layout`) · `linksync`(`link-wire` · `data/node-live` · `store/layout`) — 그 파일이 바뀌면 손본다 |
| 새 상태 층에 맞춰 다시 쓴다 | `crud` · `events` · `live` · `module` · `node-ops` · `resume` · `sviflow` · `taskout` · `modcfg` · `netmaster` · `helm-rebind` — `screens/*.js`나 `wire.js` · `data/*-live.js`를 거친다 |

다시 쓸 시험 안의 **가짜 서버 · 실제 응답 모양 · 기대값**은 가장 값진 자산이라 그대로 옮긴다.

## 7. v3 경계 제안

```text
core/        DOM · 프레임워크 없음 — L0~L5를 옮기고 문구 · 색만 걷어낸다
  transport/   frame · 토큰
  client/      TerraClient · 위임 표 · module-gate
  contract/    op 표 (UI 문구 없음)
  domain/      resources · files · tasks · svi-links · network · settings · enrollment
  store/       layout(새 형식) · docs · parts
app/         프레임워크 중립 상태 층 — L6의 순서와 규칙을 여기로 옮긴다
  session · world · apps · alarms · layout   (액션 + 셀렉터)
ui/          v3 화면 — app만 본다
```

이렇게 나누면 v3 디자인이 어떻게 바뀌어도 Terra와 붙는 부분은 손대지 않는다. 다음 단계는 `core`와 `app` 사이 인터페이스(도메인별 액션 · 상태 모양)다.

## 관련 문서

- [[docs/README|GUI v3 문서 MOC]]
- [[legacy-node-gui-overview|기존 node-gui 전체 분석]]
- 기존 GUI의 프론트엔드 API — `common/lab.stellaxia.node-gui/web/docs/api/frontend-api.md`
- 기존 GUI의 실데이터 층 — `common/lab.stellaxia.node-gui/web/docs/api/real-data-layer.md`
- 기존 GUI의 모듈 프로필 — `common/lab.stellaxia.node-gui/web/docs/guides/module-profile.md`

## 관련 모듈

- `common/lab.stellaxia.node-gui/web/src/api/` — client · operations · source · events · wire
- `common/lab.stellaxia.node-gui/web/src/store/` — layout · docs · parts
- `common/lab.stellaxia.node-gui/web/src/model/` — link-io · permissions · badges
- `common/lab.stellaxia.node-gui/web/src/data/` — node-live · world · files · alarms

## 관련 흐름

- §4.1 — 세션 → 카탈로그 → 세계 로드 → 앱 목록 · 동작 → 이벤트 · 폴링
- 기존 GUI 구조 문서 §7 — base Scene → 셸 → frame → 시작 화면 → 노드 화면 → 보드
