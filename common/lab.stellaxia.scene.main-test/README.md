---
title: "MAIN Test — base 분기 main 시험 모듈 (웹 프로그램)"
doc_type: "module-design"
scope: "module"
target: "stellaxialab/modules"
status: "active"
version: "v0.2"
last_updated: "2026-09-28"
---

# MAIN Test

흰 바탕 한가운데에 `MAIN Test`를 크게 띄우는 main 모듈. 화면은 **평범한 웹 프로그램**
(`ui/index.html` + `ui/style.css`)이고, Scene은 그 웹을 감싸는 얇은 껍데기 하나다.

## 왜 있나

Terra 0.5.8부터 base Scene(`io.terra.scene.terra`)은 자기 화면이 없는 **진입점**이다
(Terra#92, 설계 `docs/modules/terra-gui/design/terra-base-scene-branch-design.md`).
사람이 쓰는 화면은 모듈이 `contributions.gui.scenes[]`에 `"branch": "main"`으로 선언하고,
base는 main이 하나이고 dev가 없으면 BASE를 그리지 않고 곧장 그것을 띄운다. 0.5.8 번들에는
main이 없어 노드가 `MAIN_NOT_FOUND`부터 보인다 — 이 모듈이 그 자리를 채운다.

### 왜 Scene이 아니라 웹인가

Scene만으로 만들면 표현에 상한이 있다(엘리먼트 19종, 토큰 22종, 색·일반 `style` 필드 없음).
v0.1은 Scene만으로 만들었고, 바탕을 칠할 수 없어 셸 테마의 `#eef1ec`가 그대로 보였다.
자유도와 확장성을 위해 **화면은 일반 웹 프로그램으로 만든다**고 정했고(2026-09-28), 그
길이 0.5.8의 `terra.web/frame`이다(Terra#91·#93, 설계 `terra-scene-web-frame-design.md`).
진입은 여전히 Scene이 갖고, 웹은 그 Scene의 알맹이다.

## 구성

```text
common/lab.stellaxia.scene.main-test/
├─ module.json                              scenes[]: branch main · apps[]: embed scene
├─ scene/
│  ├─ scene.json                            얇은 껍데기 — Route 1 · Fragment 1 · Function/Store 0
│  └─ surface/fragments/main.fragment.json  루트 = custom terra.web/frame { app: <모듈>.ui }
└─ ui/
   ├─ index.html                            화면 전부
   └─ style.css                             흰 바탕 · 가운데 · 큰 글자
```

```json
"apps": [{ "id": "lab.stellaxia.scene.main-test.ui", "mode": "static", "entry": "ui/index.html",
           "isolation": "sandboxed", "embed": "scene" }]
```

## 어떻게 뜨나

1. base가 GUI 목록에서 main 하나를 보고 이 Scene을 연다.
2. Fragment 루트의 `terra.web/frame`이 `/api/v1/gui/apps`에서 `props.app`을 찾는다 —
   **같은 모듈의** static·proxied 앱이어야 하고, `embed: "scene"`이 붙은 앱은 dock에 뜨지 않는다.
3. 앱은 **앱별 origin**에서 뜬다: `http://app-lab--stellaxia--scene--main-test--ui.localhost:<게이트웨이 포트>`
   (id의 점이 `--`가 된다 — 그래서 앱 id에 `--`를 쓸 수 없다). 게이트웨이가 리슨 주소로 origin을
   만들므로 iframe은 셸을 거치지 않고 게이트웨이에서 직접 자산을 받는다. sandbox는
   `allow-scripts allow-forms allow-same-origin allow-downloads`.
4. frame이 Fragment 루트라서 호스트 틀(1120px·여백)이 벗겨지고 웹이 화면 전체를 쓴다.

게이트웨이는 `entry`를 앱 디렉터리(`ui/`) 기준으로 정규화한다 — 자산 주소는
`/api/v1/gui/apps/<앱 id>/files/index.html`이다(`files/ui/index.html`이 아니다).

## 웹을 쓸 때 지킬 것

- **앱 자산 CSP**: `script-src 'self'` — 인라인 스크립트는 막히고 스크립트는 같은 origin 파일로
  둔다. 스타일은 인라인도 된다. 외부 글꼴·이미지·API는 안 된다(`default-src`·`connect-src 'self'`).
  감싸는 쪽은 `127.0.0.1:*`·`localhost:*`만 된다(`frame-ancestors`).
- **API 호출**: 웹이 `parent`에 `{ type: 'terra.frame.hello', protocol: 1 }`을 보내면 frame이
  `terra.frame.init`으로 답한다. 로그인된 세션이면 스코프 토큰(사용자 권한 ∩ 앱이 선언한
  `permissions`, 15분)이 실리고, 웹은 `fetch('/api/modules/<id>/v1/...')`에 그 토큰을 붙인다.
  참조 클라이언트는 Terra의 `@terra/frame-client`(`connectTerra()` → `terra.fetch()`).
  이 모듈은 호출이 없으므로 `permissions`를 선언하지 않고 hello도 보내지 않는다. hello가 오지
  않으면 frame은 `WEB_FRAME_HANDSHAKE_TIMEOUT` 진단만 남기고 화면은 그대로 둔다
  (Terra `web-frame.ts` — "토큰이 필요 없는 페이지면 무시해도 됩니다"; 실측 중 콘솔에는 나오지 않았다).

## 시험

### 정적

| 명령 | 결과 (2026-09-28) |
| --- | --- |
| `npm run validate` | 모듈 2개 · 오류 0 · 경고 0 |
| `npm run check:schema -- --terra <terra v0.5.8>` | 스키마 대조 통과 |
| `terra module pack common/lab.stellaxia.scene.main-test` | `verified: true` — payload 4파일(scene 2 · ui 2) |

### 실물 — 빌드된 제품 셸 + Product Host

Terra 0.5.8 릴리스 번들의 게이트웨이·Product Host·제품 셸(`ui/leaf`·`ui/tree`)을 그대로 썼다.
게이트웨이 `--scene-root` 둘(번들 `modules/` — base 포함 — 과 이 모듈), 앞에 Product Host,
헤드리스 Chromium. 웹 프레임을 **개발 셸이 아닌 제품 셸·Product Host 경로에서 본 첫 실측**이다.

| 경우 | 본 것 |
| --- | --- |
| `GET /api/v1/gui/apps` | `mode: static` · `embed: scene` · `origin: http://app-lab--stellaxia--scene--main-test--ui.localhost:18787` |
| 앱 origin으로 자산 | `index.html`·`style.css` 200, CSP·`nosniff` 붙음. **다른 앱의 origin으로는 404** |
| leaf 셸 1280×800 | base → 이 Scene → frame `ready` → 앱 origin iframe이 (0, 0, 1280×800) 전체. 웹 바탕 **`#ffffff`**, `MAIN Test` 153.6px·800, 중심 (640, 400). 바깥 scene-root 둘 다 `max-width: none`·`padding: 0`. 콘솔 오류·경고 0 |
| leaf 셸 375×667 | 48px, 중심 (188, 334), iframe 전체 |
| tree 셸 | 같은 결과 |
| 웹이 hello를 보냄 | `terra.frame.init` — `apiBase: /api/modules/lab.stellaxia.scene.main-test`, `permissions: []`, **`reason: NO_SESSION`**, 토큰 없음, `/token` 요청 0 |

**확인하지 못한 것**: 토큰이 실리는 경로. 시험 환경에 Master 로그인이 없어 frame이 토큰을
청하지 않았다(`NO_SESSION`). 웹에서 API를 부르려면 로그인된 세션이 필요하고, 그 흐름
(Handle 경로)은 Master가 있는 실제 노드에서 확인해야 한다.

> [!NOTE] 브라우저로 열 때는 제품 세션부터
> 빌드된 셸은 첫 요청 전에 Product Host의 로컬 세션(`POST /api/product/session`)을 가져야
> 한다. 세션 없이 연 탭은 첫 게이트웨이 요청이 401이 되어 레거시 콘솔로 내려간다(Terra 알려진
> 문제, #82). 데스크톱 셸은 실행 토큰으로 세션을 먼저 쥐므로 해당 없다.

## 노드에 깔기

```bash
terra module pack common/lab.stellaxia.scene.main-test --out /tmp/main-test.tmod
terra module publish /tmp/main-test.tmod --policy available   # tree 운영자 — 접두사 lab.stellaxia 발급 후
```

main은 하나일 때만 곧장 뜬다. 다른 main이나 dev가 함께 깔린 노드에서는 base가 `/choose`
목록을 보이고, 거기서 `MAIN Test`를 고를 수 있다.
