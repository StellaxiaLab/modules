---
title: "GUI v3 main Scene — 얇은 껍데기와 로그인"
aliases:
  - "main Scene"
  - "gui-v3 main"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-31"
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
| `/` | `surface/fragments/main.fragment.json` | 루트가 `terra.web/frame` 하나 — 셸 틀을 벗고 창 전체. `bind` 로 `session` Store(state · principal)를 웹에, `on` 으로 웹의 `login` · `logout` · `launch` 를 받는다 |
| `/login` | `surface/fragments/login.fragment.json` | 내장 엘리먼트 로그인 카드(자유 디자인 아님) |
| Store | `credentials`(secret, Handle 은 `/session`) · `signin`(view, 입력칸) · `session`(memory, 웹에 가는 값) | 호스트는 `credentials` `/session` 의 Handle 을 따라가 frame 에 토큰을 준다 |
| Function | `signin.field` · `signin.submit`(credential.login) · `signout`(credential.revoke) · `login.open` · `login.close` · `app.launch`(terra.app:launch) | |

## 2. 로그인은 누가 하나 — Scene 이 한다, 웹은 비밀번호를 받지 않는다

| | node-gui | gui-v3 (main Scene 안 = A 모드) | gui-v3 단독(B 모드, 개발 · 시험) |
| --- | --- | --- | --- |
| 비밀번호를 받는 곳 | Scene `/login` 카드 | Scene `/login` 카드 | 웹의 Login 보드 → `POST /api/v1/auth/credentials` |
| 웹이 쓰는 자격 | 앱 스코프 토큰(`Bearer tsa_`) | 앱 스코프 토큰(`Bearer tsa_`) | 자격 핸들(`Handle …`, 사용자 권한 전부) |
| 토큰이 없을 때 | 시작 화면의 [로그인] → `emit('login')` | 화면 위 로그인 문 [로그인] → `emit('login')` | 로그인 층(보드) |
| 로그아웃 | `emit('logout')` (session.state 가 signedIn 일 때만) | 같다. 셸 세션 토큰이면 "셸에서 로그아웃" 안내 | `DELETE /api/v1/auth/credentials` |
| 다른 모듈 앱 열기 | `emit('launch', appId)` | Scene 은 받을 수 있다(`gui-v3.app.launch`). **웹은 아직 보내지 않는다** — 격차표 | — |

B 모드(커밋 df5149f)는 **웹이 스스로 비밀번호를 받는다.** 그것은 웹 프로그램 감싸기 설계 §3.3.1 이 막으려는 모양이다 —
모듈 JS 가 사용자의 Terra 비밀번호를 보면 스코프 토큰의 교집합을 우회할 수 있다. 그래서 main 으로 실릴 때는 B 를 쓰지 않는다:
셸 안(다른 origin 부모)이면 `mode.js` 가 A 를 고르고, 로그인은 껍데기가 맡는다. B 는 웹을 단독으로 여는 개발 · 시험 길로만 남는다.

### A 모드 흐름 (`web/src/boot/main.js`)

1. 마운트 전에 `hello` → frame 의 `init`(appId · 토큰 또는 없음 · `session` 값)
2. 토큰이 있으면 지도(`terra.master.nodes.get` + 로컬 status) · Tree 길 · 보기 상태 · 밀어 받기
3. 없으면 화면 위에 로그인 문(`[data-gate=login]`) — [로그인] 이 `emit('login')` → Scene 이 `/login` 으로
4. 로그인하면 `signin.submit` 이 `/` 로 돌려보낸다 → frame 이 새로 서서 토큰이 든 `init` 이 온다(같은 frame 에 `terra.frame.token` 이 와도 2 로 간다)
5. 씬의 로그아웃(`sceneLogout`)은 A 모드에서 보드의 로그인 층을 띄우지 않고 `emit('logout')` → `signout` 이 Handle 을 폐기 → frame 이 `signed_out` → 3

### A 모드의 한계 (그대로 node-gui 와 같다)

스코프 토큰은 사용자 권한 ∩ 앱 선언이고, **Master 는 위임 문 37개만** 열린다([[terra-reach|Terra 도달 분석]] §5).
지도(`nodes.get`)는 되지만 Tree 로그인 길(`crossboundary.login-routes`)과 Tree 설정은 `DELEGATION_NOT_OPEN` 이다.
node-gui 도 같은 껍데기라 같은 한계를 가진다 — 대체로 잃는 것은 없다. 더 넓히려면 코어(위임 문 목록)가 바뀌어야 한다.
