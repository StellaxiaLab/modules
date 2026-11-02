---
title: "GUI v3 main Scene — 얇은 껍데기와 로그인"
aliases:
  - "main Scene"
  - "gui-v3 main"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.2.0"
last_updated: "2026-11-02"
language: "ko-KR"
related:
  - "[[web-architecture|GUI v3 웹 구조]]"
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[replacement-readiness|node-gui 대체 준비도]]"
---

# GUI v3 main Scene — 얇은 껍데기와 로그인

0.3.0 부터 GUI v3 는 **main GUI 를 선언한다.** base Scene 이 main 하나를 보면 곧장 그것을 띄우고, main 이 둘 이상이거나
dev 가 있으면 고르는 화면(CHOOSE)을 띄운다(Terra `docs/modules/terra-gui/design/terra-base-scene-branch-design.md`).
코어는 어느 모듈이 main 인지 모른다 — **모듈의 선언이 정한다.**

```json
"contributions": { "gui": {
  "scenes": [{ "id": "lab.stellaxia.gui-v3.ui", "entry": "scene/scene.json", "role": "application", "branch": "main" }],
  "apps":   [{ "id": "lab.stellaxia.gui-v3.web", "mode": "static", "entry": "ui/index.html", "isolation": "sandboxed", "embed": "scene", … }]
} }
```

- `scenes[].id` 는 `scene/scene.json` 의 `id` 와 같아야 한다(Gateway `CodeGuiIDMismatch`).
- `embed: "scene"` — 웹 앱은 Scene 밖(dock · 앱 목록)에서 열리지 않는다(web-frame 설계 §3.2).
- `lab.stellaxia.node-gui` 도 main 을 선언한다. **둘이 한 노드에 같이 깔리면 CHOOSE 가 뜬다.** 대체 순서는 [[replacement-readiness|node-gui 대체 준비도]].

## 1. 구조 — node-gui 와 같은 껍데기

`scene/` 은 `lab.stellaxia.node-gui/scene/` 을 그대로 옮기고 id 만 `gui-v3.*` 로 바꿨다(웹 프로그램 감싸기 설계 §3.3 · §3.3.1).

| 자리 | 파일 | 하는 일 |
| --- | --- | --- |
| `/` | `surface/fragments/main.fragment.json` | 루트가 `terra.web/frame` 하나 — 셸 틀을 벗고 창 전체. `bind` 로 `session` Store(state · principal · error)를 웹에, `on` 으로 웹의 `signin` · `login` · `logout` · `launch` 를 받는다. `props.secret` 이 호스트 비밀번호 칸을 켠다(§1-2) |
| `/login` | `surface/fragments/login.fragment.json` | 내장 엘리먼트 로그인 카드 — **호스트 비밀번호 칸을 모르는 이전 Terra 에서만** 쓰인다(§1-1 · §1-2) |
| Store | `credentials`(secret, Handle 은 `/session`) · `signin`(view, 입력칸) · `session`(memory, 웹에 가는 값) | 호스트는 `credentials` `/session` 의 Handle 을 따라가 frame 에 토큰을 준다 |
| Function | `signin.host`(셸 칸 → credential.login, §1-2) · `signin.field` · `signin.submit`(credential.login) · `signout`(credential.revoke) · `login.open` · `login.close` · `app.launch`(terra.app:launch) | |

### 1-1. `/login` 카드의 모양 — Login.dc.html 에 맞춘 것과 못 옮긴 것 (0.3.1)

A 모드의 로그인은 웹 보드(`web/design/Login.dc.html`)가 아니라 이 카드다(§2). 0.3.1 은 **비밀번호 입력을 호스트의 내장 엘리먼트로
그대로 두고**(보안 규칙 · 코어 · 프레임 계약 그대로) 카드의 배치 · 문구 · 분위기를 보드에 가깝게 다시 짰다(a안).

- **포스터 그림** — `image` 하나에 `data:` SVG(호스트 CSP `img-src 'self' data:`). 보드의 바탕 그라디언트(#060a1d → #040614 → #020308) · 보라 빛무리 · 대각 색 띠 · 큰 `TERRA` 로고 · CLI 틀(`┌─ TERRA // LOGIN ── 01/02 ─┐` · `└─ NODE AUTH // GATEWAY ─┘`)을 싣는다.
- **CLI 줄** — `○ terra login --as user` · `admin    >` [아이디] · `password >` [비밀번호] · 구분선 · `← 돌아가기` / `⏎ Login` · `enter · 로그인`. 라벨은 `mono` 글.
- 로그인된 채 들어오면 `● terra login — 로그인되어 있습니다` · 주체 · `로그아웃` / `⏎ GUI 로 돌아가기`.

**내장 엘리먼트로 못 옮긴 것**(dom.basic 은 시맨틱 HTML 과 `data-*` 만 내고 색 · 크기 · 배경 · 애니메이션을 열지 않는다 — 열려면 코어의 결정이거나 b안):

| 보드의 것 | 이 카드 | 왜 |
| --- | --- | --- |
| 창 전체의 글자 장(WebGL 캔버스 · 팔레트 은하수/성운/단색 · 속도 · 움직임) | 정지 그림(포스터) 안에만 | 엘리먼트에 캔버스가 없고, `custom` 은 호스트가 등록한 component 만(`terra.web/frame` 등) |
| 창 전체 바탕 그라디언트 | 포스터 안에만. 카드 밖 바탕은 셸 테마 | 엘리먼트에 배경 · 색 속성이 없다(토큰은 셸이 정한다) |
| 여는 연출 — TERRA 만 있다가 누르면 로고가 올라가고 줄이 차례로 나타남, Esc 로 거꾸로 | 처음부터 다 보인다 | 애니메이션 · 키 이벤트가 없다(`onSubmit` 의 Enter 만) |
| 입력도 글자 칸 — 친 글자는 흰 칸, 빈 자리 흐린 점, 커서 칸 깜박임, 실패 때 물결 | 호스트의 보통 입력 칸 | 비밀번호 입력은 호스트 소유여야 한다 — 모양을 바꿀 길이 없다 |
| 노드 타입 낱말 마스크(TREE · LEAF) · `--as leaf` · `[LEAF]` · `NODE TYPE … L/03` | `--as user` 로 고정, 타입 낱말 없음 | 이 노드의 설치 타입을 Scene 이 읽을 Store · Operation 이 없다(계약을 늘려야 한다) |
| `[ ] auto · 로그인 유지` | 없음 | `credential.login` 에 유지 옵션이 계약에 없다 — 넣으면 Function · 코어 계약이 바뀐다 |
| `social` 줄 | 없음 | 보드에서도 기능이 없는 자리 |
| `+ New Tree Connect` | 없음 | 보드에서도 "주소 · 등록 코드 창이 이어질 자리"(기능 없음) |
| 글꼴(GmarketSans · Geist · Geist Mono) | 셸 글꼴. 포스터 안도 시스템 글꼴로 떨어진다 | 글꼴은 `scene.css` 토큰. `<img>` 속 SVG 는 웹 글꼴을 불러오지 못한다 |
| 색 — Login 흰색 · New Tree 파랑 · 타입 초록/연두 · 칸 바탕 섞임 | 버튼 · 입력은 셸 토큰(강조색), 밝은/어두운은 OS 를 따른다 | 엘리먼트별 색이 없다 |
| 누를 수 있는 것 밑의 호버 밑줄 · `enter · tab · esc` | `enter · 로그인` 만 | Esc 키를 받을 길이 없어 `← 돌아가기` 버튼으로 |
| 메시지를 틀 아래 가운데 흐린 글로 | `mono` 상태 글(`role=status`) | 정렬 · 색 속성이 없다 |

### 1-2. 디자인 로그인 — 호스트 비밀번호 칸 (0.4.0, Terra PR #301 이후)

§1-1 의 표는 "비밀번호 입력이 호스트 소유여야 한다"는 규칙 하나 때문에 생겼다. Terra 의 `terra.web/frame` 이 **호스트 비밀번호
칸**(웹 프로그램 감싸기 설계 §4.9)을 갖게 되면서 이 규칙을 지킨 채 보드를 그대로 쓴다: 로그인 화면은 웹의 Login 보드가 그리고,
비밀번호 `<input>` 하나만 셸 문서(다른 origin)에 있어 보드의 `password >` 자리에 겹친다. 웹은 그 값을 볼 수 없다.

| 단계 | 어디서 |
| --- | --- |
| 켜기 | `main.fragment.json` 의 frame `props.secret = { "event": "signin" }`. 셸이 알면 `init.features` 에 `secret` 이 온다 |
| 감지 | `web/src/api/host-secret.js` `hostSecretOf(frame)` — 없으면(이전 Terra) 지금까지처럼 로그인 문 → `emit('login')` → `/login` 카드 |
| 자리 | `bindHostSecret` 이 매 프레임 보드의 숨은 password 칸 자리를 재어 바뀔 때만 `secret.place`. 로그인이 열려 입력을 받을 때만 둔다(닫힘 · 워프 · 층 내려감이면 걷는다) |
| 모양 | 셸에는 보드의 글꼴이 없어 `monospace` 로, 그 글꼴 `•` 너비를 재어 글자 사이를 띄워 점이 칸에 한 칸씩 앉게 한다. 셸 칸에 글자가 있으면 보드는 그 줄의 점 · 남은 자리를 비운다 |
| 키 | 칸의 Enter → 보드 `login()`, Esc → `closeLogin()`, Tab → auto, Shift+Tab → admin. 보드의 숨은 password 칸으로 Tab 이 오면 셸 칸으로 넘긴다 |
| 제출 | `secret.submit({ email, auto, node, attempt })` → 셸이 칸의 값을 더해 `signin` → `gui-v3.signin.host` 가 `credential.login` |
| 결과 | 성공 = 새 토큰 → 워프 전환 · 실데이터. 실패 = `session.error { message, attempt }` → 보드 아래 문구 + 물결, 칸으로 포커스 |

이것으로 §1-1 표의 글자 장 · 바탕 · 여는 연출 · 칸 글자 입력(아이디) · TREE/LEAF 낱말 · auto · New Tree Connect · 글꼴 · 색 · 호버 밑줄 ·
`enter · tab · esc` · 메시지 자리가 **A 모드에서도 보드 그대로**다. 남는 것:

- **비밀번호 줄의 점은 셸이 그린다** — 웹은 몇 글자인지 모른다(셸은 비었는지만 알려 준다). 글꼴이 `monospace` 라 보드의 칸 글자와 굵기가 조금 다르고, 커서는 비었을 때만 보드의 칸 커서, 글자가 있으면 셸 칸의 캐럿이다.
- **auto(로그인 유지)** 는 값이 Function 까지 가지만 `credential.login` 에 유지 옵션이 없어 쓰이지 않는다(B 모드도 같다).
- **TREE/LEAF** 는 보드의 표시 그대로(B 모드와 같다) — 이 노드의 설치 타입을 읽어 오는 것은 별도.
- **New Tree Connect** 는 보드에서도 기능 없는 자리다.

## 2. 로그인은 누가 하나 — Scene 이 한다, 웹은 비밀번호를 받지 않는다

| | node-gui | gui-v3 (main Scene 안 = A 모드) | gui-v3 단독(B 모드, 개발 · 시험) |
| --- | --- | --- | --- |
| 비밀번호를 받는 곳 | Scene `/login` 카드 | 셸 문서의 비밀번호 칸(웹 Login 보드 위에 겹침, §1-2) → Scene `signin.host`. 이전 Terra 는 Scene `/login` 카드 | 웹의 Login 보드 → `POST /api/v1/auth/credentials` |
| 웹이 쓰는 자격 | 앱 스코프 토큰(`Bearer tsa_`) | 앱 스코프 토큰(`Bearer tsa_`) | 자격 핸들(`Handle …`, 사용자 권한 전부) |
| 첫 화면 | 시작 화면 | **로그인 보드(TERRA 연출)** — B 와 같다. 토큰이 있으면 연출 뒤 폼 없이 워프로 트리 뷰 | 로그인 보드 |
| 토큰이 없을 때 | 시작 화면의 [로그인] → `emit('login')` | 보드의 폼 + 셸 비밀번호 칸(§1-2). 이전 Terra 는 TERRA 를 누르면 폼 대신 `emit('login')` → `/login` 카드 | 로그인 층(보드) |
| 로그아웃 | `emit('logout')` (session.state 가 signedIn 일 때만) | 같다. 셸 세션 토큰이면 "셸에서 로그아웃" 안내 | `DELETE /api/v1/auth/credentials` |
| 다른 모듈 앱 열기 | `emit('launch', appId)` | Scene 은 받을 수 있다(`gui-v3.app.launch`). **웹은 아직 보내지 않는다** — 격차표 | — |

B 모드(커밋 df5149f)는 **웹이 스스로 비밀번호를 받는다.** 그것은 웹 프로그램 감싸기 설계 §3.3.1 이 막으려는 모양이다 —
모듈 JS 가 사용자의 Terra 비밀번호를 보면 스코프 토큰의 교집합을 우회할 수 있다. 그래서 main 으로 실릴 때는 B 를 쓰지 않는다:
셸 안(다른 origin 부모)이면 `mode.js` 가 A 를 고르고, 로그인은 껍데기가 맡는다. B 는 웹을 단독으로 여는 개발 · 시험 길로만 남는다.

### A 모드 흐름 (`web/src/boot/main.js`)

1. 첫 화면은 B 와 같은 로그인 보드(TERRA 연출)다. 마운트 전에 `hello` → frame 의 `init`(appId · 토큰 또는 없음 · `session` 값 · `features`)
2. 토큰이 있으면 지도(`terra.master.nodes.get` + 로컬 status) · Tree 길 · 보기 상태 · 밀어 받기
3. 토큰이 있으면(셸 세션 · `/login` 카드에서 로그인하고 돌아옴) 연출을 1.4초 보이고 폼을 열어 줄이 다 서면 입력을 받지 않고 워프로 트리 뷰(누르면 바로). 셸 칸은 두지 않는다 — 워프는 열린 폼의 글자를 날려 보내는 전환이라 닫힌 TERRA 화면에서는 시작하지 않는다
4. 없으면 — 셸 칸이 있으면 보드의 폼으로 로그인(§1-2), 없으면(이전 Terra) TERRA 를 누를 때 폼을 열지 않고 `emit('login')` → Scene 이 `/login` 으로. 보드의 숨은 password 칸은 A 모드에서 값을 받지 않는다
5. 카드로 로그인하면 `signin.submit` 이 `/` 로 돌려보낸다 → frame 이 새로 서서 토큰이 든 `init` 이 온다 → 3(같은 frame 에 `terra.frame.token` 이 와도 3)
6. 씬의 로그아웃(`sceneLogout`)은 이 Scene 이 로그인했으면 `emit('logout')` 과 함께 보드의 로그인 층을 거꾸로 띄운다 → `signout` 이 Handle 을 폐기 → frame 이 `signed_out`. 셸 세션 토큰이면 "셸에서 로그아웃" 안내만. 토큰을 잃어도 로그인 층으로 돌아간다

### A 모드의 한계 (그대로 node-gui 와 같다)

스코프 토큰은 사용자 권한 ∩ 앱 선언이고, **Master 는 위임 문 37개만** 열린다([[terra-reach|Terra 도달 분석]] §5).
지도(`nodes.get`)는 되지만 Tree 로그인 길(`crossboundary.login-routes`)과 Tree 설정은 `DELEGATION_NOT_OPEN` 이다.
node-gui 도 같은 껍데기라 같은 한계를 가진다 — 대체로 잃는 것은 없다. 더 넓히려면 코어(위임 문 목록)가 바뀌어야 한다.
