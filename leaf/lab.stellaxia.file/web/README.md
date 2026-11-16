# Terra File — 웹 화면

노드가 내놓은 공유 폴더를 탐색하고 파일을 받고·올리고·지우고·동기화하는 화면이다. 모듈의 Scene(`lab.stellaxia.file.ui`)은 이 웹을 `terra.web/frame`으로 감싸는 얇은 껍데기이고 로그인도 그쪽이 맡는다. 화면은 전부 여기서 그린다. 설계: `terra-docs:docs/modules/terra-gui/design/terra-scene-web-frame-design.md`. 화면 설계안은 Claude Design 캔버스 5장(탐색 · 전송 관리 · 올리기 · 동기화 · 상태와 오류)이다.

```text
web/        이 소스. 최상위 web/은 패키지에서 빠진다
  ↓ npm run build
ui/         패키지가 싣는 빌드 결과(.gitignore). module.json의 앱 lab.stellaxia.file.web가 가리킨다
```

## 어떻게 열리나

Scene은 `branch: "dev"`로 선언되어 있다. base가 main 하나만 보면 곧장 띄우는데, gui-v3가 이미 main이라 이 화면까지 main이면 고르는 화면(CHOOSE)이 뜬다. 그래서 dev로 두었고, base의 고르는 화면에서 dev 쪽으로 연다. 제품 화면에 넣는 길(gui-v3가 이 앱을 직접 감싸기, 앱 목록에서 열기)은 문서상 막혀 있을 수 있어 확인이 더 필요하다.

## 호출 방식

모듈 자기 API(`/api/modules/lab.stellaxia.file/v1/…`)가 아니라 Gateway의 주소 독립 입구를 쓴다. 그래야 다른 노드의 파일 모듈도 같은 모양으로 부른다.

| 대상 | 호출 |
| --- | --- |
| 이 노드 | `POST /api/v1/operations/{id}/invoke` |
| 다른 노드 | `POST /api/v1/nodes/{node}/operations/{id}/invoke` (Master 중계, 대상 노드가 자기 계약으로 다시 판정) |

토큰은 frame이 준 스코프 토큰(사용자 권한 ∩ `module.json` 앱의 `permissions`)이다. 앱 권한은 `session.identity`, `node.read`(노드 목록), `file.read`, `file.write`다. `file.write`가 없으면 올리기·삭제·이름 바꾸기·동기화를 숨기지 않고 이유와 함께 잠근다.

## 구조

| 파일 | 하는 일 |
| --- | --- |
| `src/main.js` | frame에 연결하고 `mountApp`을 부른다 |
| `src/app.js` | 화면 전체(DOM). 본문·전송 트레이·대화상자를 따로 다시 그린다 |
| `src/lib/api.js` | operation 호출, 봉투 벗기기, 오류 코드 보존 |
| `src/lib/file-transfer.js` | 청크 올리기·받기, 재개, 체크섬. gui-v3의 같은 이름 파일을 옮겨 왔다(`resume_id`를 받도록 한 줄만 더함) |
| `src/lib/model.js` | 경로·권한·오류 분류("없음"과 "못 봤음"을 가름)·전송 줄 |
| `src/lib/sync-plan.js` | `terra file sync`와 같은 규칙의 계획(크기·시각 비교) |

## 빌드와 시험

```bash
npm ci
npm test             # node --test src/lib/*.test.mjs
npm run build        # vite build → ../ui
```

시험은 순수 함수와 전송 상태기계를 본다. 화면 자체의 브라우저 시험은 없다(러너에 브라우저가 없다).

## 하지 않는 것

- 미리보기(글·그림)는 아직 없다. 받기만 된다.
- 동기화는 크기·시각만 비교한다. 체크섬 비교는 노드가 모든 파일을 읽어야 해서 CLI(`terra file sync --checksum`)에서만 한다.
- 브라우저가 파일 전체의 SHA-256을 한 번에 계산하므로 올리기·받기는 256 MiB까지다. 넘으면 CLI(`terra file send` / `get`)를 쓴다.
- "받은 파일 저장"은 `<a download>`로 한다. 앱이 sandbox iframe 안에서 도는데 다운로드가 허용되는지는 실제 셸에서 확인하지 못했다. 막히면 트레이의 `저장` 버튼이 같은 일을 사용자 클릭으로 다시 시도한다.

## frame 밖에서 개발하기

`npm run dev`는 이 웹을 단독으로 띄운다(`http://127.0.0.1:5173`). `/api`는 로컬 게이트웨이로 넘어간다(`TERRA_GATEWAY`로 바꿀 수 있다). 앱이 게이트웨이에 설치되어 있어야 토큰을 받는다.

1. CLI 세션으로 개발용 토큰을 받는다.

   ```bash
   terra module call terra.gateway.gui.apps.by-id.token.post --input '{"id":"lab.stellaxia.file.web","ttlMs":3600000}'
   ```

2. 답의 `token`을 `web/.env.development.local`에 적는다(`*.local`은 `.gitignore`에 있고 빌드에는 들어가지 않는다).

   ```text
   VITE_TERRA_DEV_TOKEN=tsa_…
   ```

3. `npm run dev`.

## 알아 둘 제약

| 무엇 | 규칙 |
| --- | --- |
| 자산 경로 | `base: './'` |
| CSP | 스크립트·폰트·이미지·연결은 자기 origin만. 외부 글꼴을 쓰지 않고 시스템 글꼴을 쓴다 |
| 요청 본문 | 1 MiB. 청크는 모듈이 640 KiB 상한으로 지킨다(응답의 `chunk_size`를 그대로 따른다) |
| 오래 걸리는 일 | 일반 호출은 15초에서 끊긴다. 큰 파일은 청크 단위라 한 호출이 짧다 |
