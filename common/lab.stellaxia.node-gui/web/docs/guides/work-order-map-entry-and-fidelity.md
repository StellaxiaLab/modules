---
title: "작업 지시서 — 맵 진입 지연 · 지어낸 값 · 빈 창"
aliases:
  - "작업 지시서"
  - "맵 진입 개선 작업 지시서"
  - "Work Order: Map Entry and Fidelity"
doc_type: "work-order"
scope: "module"
target: "lab.stellaxia.node-gui"
status: "done"
version: "0.2.0"
last_updated: "2026-10-09"
language: "ko-KR"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[docs/README|개발 문서 MOC]]"
  - "[[performance-and-fidelity-recommendations|맵 진입 지연과 가짜 값 — 개선 권고안]]"
  - "[[implementation-backlog|구현해야 할 것]]"
  - "[[module-profile|모듈 프로필]]"
  - "[[real-data-layer|실데이터 층]]"
  - "[[testing|시험]]"
---

# 작업 지시서 — 맵 진입 지연 · 지어낸 값 · 빈 창

> [!IMPORTANT] 이 문서를 쓰는 법
> 세션에는 **이 한 줄만** 붙이면 된다.
>
> ```text
> common/lab.stellaxia.node-gui/web/docs/guides/work-order-map-entry-and-fidelity.md 를 읽고 §3 순서대로 끝까지 진행해라. 항목마다 전/후 숫자를 §6 기록표에 남기고, §7 진행 로그를 갱신하고, PR은 draft로 올려라.
> ```
>
> 근거와 측정 전체는 [[performance-and-fidelity-recommendations|개선 권고안]]에 있다. 이 문서는 **무엇을 어떤 순서로 하고 언제 끝났다고 하는지**만 적는다.
> 세션이 끊기면 §7 진행 로그를 보고 이어서 한다.

---

## 1. 배경 (한 문단)

레지스트리로 설치한 `lab.stellaxia.node-gui` 0.4.1을 Terra 셸 안에서 열었더니 **로그인 후 맵이 뜨기까지 20초 넘게** 걸렸다. 서버는 빠르다(catalog 응답 2ms · 앱 토큰 5ms).
맵 화면이 타일 · 도로를 SVG → canvas → PNG로 **런타임에 메인 스레드에서** 굽는다(`toDataURL` 318회 · 약 36MB · 3.4초 + `drawImage` 151회 · 1.0초). 같은 시간대 `catalog` 요청이 클라이언트에서 7.9초 걸리고 나머지 요청은 14.7초에야 나간다
("굽기가 지연의 원인"은 **추정**이다 — 바다 애니메이션 루프를 꺼도 같아서 애니메이션은 원인이 아니다). 노드 카드의 CPU · 메모리 · 디스크는 노드 이름 해시로 만든 **지어낸 값**이고, 모듈 · 사용자 · 설정 창은 본문이 비었다.
측정 환경은 헤드리스 Chromium(GPU 없음 · 4코어) — 절대 시간은 실제 PC보다 길 수 있으니 **전/후는 같은 환경에서** 비교한다.

## 2. 구조 규칙

- `src/screens/*.js`와 화면 페이지(`*.html`)는 `web/design/*.dc.html`(디자인 캔버스 원본)에서 `tools/gen-pages.py`가 만드는 **생성 파일**이다. 손으로 고치지 않는다.
- **maingui 저장소는 더 이상 쓰지 않는다.** `web/design/`이 이 저장소의 원본이다 — 화면 로직을 바꿀 때는 `design/*.dc.html`을 고치고 `npm run gen`(web 디렉터리)으로 다시 만든다. 생성이 멱등인지(고치기 전 `npm run gen`이 변경 0)는 2026-10-09에 확인했다.
- 모듈 전용 바꿔 끼우기(`src/boot/module.js` · `src/data/*.js` · `gen-pages.py`의 "정확히 한 번" 패치)는 그대로 쓸 수 있다.
- `src/api/*`(연동 층)는 이 저장소가 실측으로 고친 판이다 — 어디에서도 덮어쓰지 않는다.
- 추정을 사실처럼 적지 않는다. 확인하지 못한 것은 "확인하지 못했다"로 적는다.
- 작업은 `main`에서 딴 브랜치에서 하고 PR은 draft로 올린다. 머지는 사람이 승인한 뒤에 한다.

## 3. 작업 순서

| 순서 | ID | 무엇 | 우선 | 선행 | 상태 |
| --- | --- | --- | --- | --- | --- |
| W0 | — | 재측정 환경을 만들고 **"전" 숫자**를 §6에 기록 | — | — | 완료 |
| W1 | MD-37 | 데이터 요청을 굽기보다 **먼저** 시작 · 굽기 그대로 둔 채 효과 검증 | 높음 | W0 | **효과 없음 — 코드는 되돌렸다**(§7) |
| W2 | MD-36 | 노드 카드의 **지어낸** CPU · 메모리 · 디스크 제거 | 높음 | W0 | 완료 |
| W3 | MD-35 | 타일 · 도로 굽기를 메인 스레드와 런타임에서 걷어낸다 | 높음 | W1 결과 | 완료 — 쓰이는 것만 · 한 장씩 · 비동기 PNG |
| W4 | MD-40 | 모듈 · 사용자 · 설정 창 본문과 상태 구분 · 속성 메뉴 확인 | 중간 | — | 완료 |
| W5 | MD-41 | 진입 연출을 로딩과 겹친다 | 낮음 | W3 | 완료 — 이미 겹쳐 있었고 고정 지연만 줄였다 |
| W6 | MD-38 | 모듈 없음과 오류를 구분 | 낮음 | — | 완료 |
| W7 | MD-39 | 굽기 결과 캐시 — **W3로 충분하면 하지 않는다** | 낮음 | W3 | **하지 않음**(불필요) |
| W8 | — | 문서 정리 · **"후" 숫자** · backlog 갱신 | — | W1~W7 | 완료 |

각 W는 **커밋 하나 이상**으로 끝내고 §7에 한 줄을 남긴다. 한 W가 막히면 이유를 §7에 적고 다음 W로 넘어간다(W3은 W1 결과를 봐야 하므로 W1은 건너뛰지 않는다).

---

## 4. 작업 상세

### W0. 재측정 환경

[[performance-and-fidelity-recommendations|권고안]] §6을 따라 진짜 스택을 띄운다.

1. Terra 저장소 체크아웃에서 `terra-master` · `terra-daemon` · `terra-gateway` · `terra-cli`를 `go build -buildvcs=false`로 빌드한다(`products/tree/master/cmd/terra-master` · `products/leaf/daemon/cmd/terra-daemon` · `products/common/apps/terra-gateway-service/cmd/terra-gateway` · `products/common/apps/terra-cli/cmd/terra`).
2. master 설정 파일(`http_addr` · `data_dir` · `jwt_secret` · `tree_node_id` · `runtime_mode: test` · `bootstrap_*` · `service_credential`)로 master를 띄우고 로그인해 토큰을 받는다.
3. `POST /api/v1/modules/prefixes {"prefix":"lab.stellaxia"}` → 이 모듈을 `npm run build:web` · `npm run pack -- --tag <임의>`(`TERRA_CHECKOUT` · `TERRA_CLI` 환경변수)로 `.tmod`로 만들고 `PUT /api/v1/modules/packages/{sha256}` → `POST /api/v1/modules/publications {digest, policy:"available"}`.
4. leaf 데몬 설정 파일을 직접 쓰고(`master.url` = `ws://…/ws/daemon` · `require_tls: false` · `gateway_service.master_service_credential` = master의 `service_credential` · `modules.directories` = 설치 디렉터리 + 코어 모듈 디렉터리) `--enroll-email --enroll-password-file --enroll-only`로 등록한 뒤 `terra daemon login --token-file <local_api_token>` → `terra module consent lab.stellaxia.node-gui`로 설치한다.
5. 코어 모듈(`io.terra.scene.terra` · `io.terra.player` · `io.terra.scene-runtime`)은 Terra에서 `npm run build:packages` · `npm run build:scene-modules` 뒤 `module/common/`에서 별도 디렉터리로 복사해 `modules.directories`에 더한다.
6. leaf 셸을 `products/leaf/ui`에서 `VITE_TERRA_GATEWAY_URL` · `VITE_TERRA_GATEWAY_PROXY_TARGET`을 주고 vite로 띄운다.
7. 로그인(셸의 로그인 카드)은 앱 화면의 "Terra 로그인" 버튼(뷰포트 1280×800 기준 `(640, 577)`)을 눌러 연다.

계측 스크립트는 **저장소에 두지 않고** 매 세션 새로 쓴다(Playwright + CDP). 기록 항목: 로그인 클릭 → 앱 iframe `[data-in-map]` 투명도 1 시각, `HTMLCanvasElement.prototype.toDataURL` 호출 수 · 누적 ms · 바이트, `PerformanceObserver` longtask(50ms 초과), 요청 타임라인(catalog 시작 · 종료), `drawImage` 호출 수.

> [!WARNING] 셸 주의
> `pkill -f <패턴>`은 패턴이 들어 있는 **자기 셸**도 죽인다. 프로세스는 `pkill -x`나 PID로 끈다.

완료 기준: §6 "전" 칸이 채워졌다.

### W1. MD-37 — 데이터 요청을 먼저

- 대상: `src/boot/module.js` · `src/api/*` · `src/data/node-live.js` · `src/data/live-host.js` (생성 파일은 건드리지 않는다).
- 현재: catalog가 6.8초에 나가 14.7초에 끝나고, `whoami` · `node.get` · layout 문서 · operations 약 10건이 그 뒤 15.0~15.4초에 한꺼번에 나간다.
- 해라:
  1. 부트 경로에서 catalog · whoami · node.get · layout 문서 요청을 **화면 굽기보다 먼저** 시작한다.
  2. 첫 화면에 필요 없는 것(io 장치 · 파일 목록 · 와이어가드 · 설정 스키마 12.6KB · 서비스 터널 등)은 첫 화면이 뜬 뒤로 미룬다. 미루는 목록과 이유를 [[real-data-layer|실데이터 층]]에 적는다.
  3. **굽기를 그대로 둔 채** catalog 종료 시각이 줄어드는지 숫자로 확인한다 — 줄지 않으면 "굽기가 원인"이라는 추정이 틀린 것이다. 그 결과를 권고안 §1.3에 **사실로** 갱신한다.
  4. 시험: `node:test`로 요청 시작 순서를 검증하는 연동 층 시험.
- 완료 기준: 첫 화면용 요청이 굽기 시작 전에 시작된다 · 전/후 숫자가 §6에 있다.

### W2. MD-36 — 지어낸 미터 제거

- 대상: `web/design/Artboard-qcfu.dc.html`의 `meters: [['CPU', m(0)], ['메모리', m(7) + 12], ['디스크', m(13) + 18]]`(`m`은 노드 이름 해시). 같은 해시 · 시퀀스 패턴이 더 있는지 `grep`한다(진단 문구의 `cpu= mem= seq=` 포함) — 목록을 [[real-data-layer|실데이터 층]]에 남긴다.
- 해라:
  1. Terra에 노드 자원 사용량을 주는 operation이 있는지 조사한다(Daemon · Master 계약, gateway catalog). 있으면 값 · 단위 · 갱신 주기를 정해 `src/data`로 잇는다. 없으면 Terra PF 항목으로 [[implementation-backlog|backlog]]에 올린다.
  2. 못 이으면 **값 없음** 상태(`—` · 빈 막대 · 80% 초과 노랑 규칙 끔)를 원본에 만든다.
  3. 시험: 값이 없으면 숫자가 그려지지 않고, 이름만 다른 두 노드가 같은 값을 내지 않는다.
- 완료 기준: 맵에서 노드를 선택한 카드에 지어낸 값이 보이지 않는다(스크린샷).

### W3. MD-35 — 굽기 걷어내기

- 대상: `web/design/Artboard-qcfu.dc.html`의 `bakeImgs` · `roadImgOf`(그리고 같은 모양의 굽기가 있는 field · ground · road · building · material 화면의 원본).
- 해라:
  1. 318번이 서로 다른 그림 몇 장인지 센다(중복이 많으면 키 설계부터 고친다).
  2. 굽는 함수를 "같은 입력 → 같은 출력"으로 분리한다(Node 빌드 스크립트가 부를 수 있게).
  3. 입력이 정적인 타일 · 도로는 `tools/build-web.mjs`에서 **빌드 시점에** PNG(또는 아틀라스)로 구워 `ui/`에 싣고, 런타임은 URL만 쓴다.
  4. 데이터에 따라 달라지는 것(런타임에만 아는 입력)은 `toDataURL` 대신 `canvas.toBlob` + `URL.createObjectURL`, 가능하면 `createImageBitmap`/`OffscreenCanvas`(워커)로 메인 스레드에서 빼고, 보이는 칸부터 `requestIdleCallback`으로 나눠 굽는다(한 틱 50ms 이하). 해상도는 `SCALE = 3` 고정이 아니라 `devicePixelRatio`(1~2)와 표시 크기에 맞춘다.
  5. `.tmod` 크기(현재 약 939KB)와 `pack` 무결성 기록을 확인한다.
- 완료 기준: 맵 진입 구간 50ms 초과 롱태스크 ≤ 1건 · 메인 스레드 `toDataURL` 0회(또는 보이는 것에 한정) · 로그인 → 맵이 현재(20초+)의 **절반 이하**.

### W4. MD-40 — 빈 창 본문

- 대상: `web/design/Artboard-qcfu.dc.html`의 `{{w.title}} 화면이 이 창 안에 들어옵니다`와 아래 숫자 줄. 데이터는 `src/data/*-live.js`.
- 해라:
  1. 상태를 구분한다: 로딩 / 아직 구현 없음 / 열 수 없음+이유 / 보드에서 열기. "보드에서 열기"는 눈에 띄는 버튼으로.
  2. 모듈 창: 설치 N · 실행 N · 실패 N의 의미를 풀어 쓴다(Scene 모듈은 프로세스가 없어 "실행 0"이 정상). 사용자 창: 권한 목록. 설정 창: Daemon 설정 키 수 + 보드로 가는 길.
  3. "보드에서 열기"를 눌러 실제로 열리는지, 조타륜 "속성" 메뉴가 동작하는지 확인한다 — 이전 측정에서 둘 다 확인하지 못했다. 결과를 **사실로** 적는다.
  4. 접근성(키보드 · 포커스 · 대비)을 기존 창과 같은 수준으로.
- 완료 기준: 세 창이 비었을 때도 이유와 다음 행동을 말한다.

### W5. MD-41 — 진입 연출 겹치기

- 현재: 데이터 준비 뒤에 `autoMs`(기본 1.4초, `src/data/intro-live.js`의 `screen._autoT`)와 내려가는 모션(약 4~5초)이 직렬로 시작한다.
- 해라: 로딩 중에 연출을 시작하고 준비되면 이어 붙인다. 준비가 늦으면 어색하게 멈추지 않게. `prefers-reduced-motion`이면 즉시 전환. `flyBack`(로그아웃 후 재진입)도 같은 모델.
- 완료 기준: 데이터가 이미 준비돼 있으면 연출 시간만큼만, 아직이면 준비되는 즉시 이어서.

### W6. MD-38 — 모듈 없음과 오류 구분

- 현상: `io.terra.io-inventory` · `io.terra.file`이 없는 노드에서 `terra.daemon.io.devices.get` · `terra.daemon.files.list.get`이 503이고 콘솔에 오류가 남는다. `me/documents/.../layout/<node>` · `.../assets`가 404(저장된 맵 없음으로 보이나 확인하지 못했다).
- 해라: 503 사유를 읽어 "이 노드에 입출력 모듈이 없다"로 구분해 보이고, 첫 호출 전에 `modules.get`으로 건너뛴다. 404가 빈 맵으로 자연스럽게 처리되는지 확인해 사실로 적는다. 시험: 가짜 Gateway가 503 · 404를 줄 때 화면 상태.
- 완료 기준: 모듈이 없는 노드에서 정상 흐름의 콘솔 오류가 없고 화면이 이유를 말한다.

### W7. MD-39 — 캐시 (조건부)

W3로 충분하면 **하지 않는다**(§7에 "불필요"로 적는다). 런타임 굽기가 남아 두 번째 진입이 여전히 느리면: 키(정의 해시 + 해상도 + 앱 버전) → Blob을 `Cache Storage` 또는 IndexedDB에 두고(접근 실패는 `try/catch`로 무시), 용량 상한과 정리 정책을 문서에 적는다.

### W8. 마무리

- [[implementation-backlog|backlog]]에서 끝난 MD를 "끝낸 것"으로 옮기고 묶음 표 숫자를 갱신한다.
- 권고안 §1.3 · §7(확인하지 못한 것)을 새 사실로 갱신하고, §6 기록표의 "후" 칸을 채운다.
- [[testing|시험]] · [[real-data-layer|실데이터 층]]을 W1 · W2 · W6 결과로 갱신한다.
- 모듈 버전을 `docs/layout.md` 규칙으로 올린다.

---

## 5. 공통 검증

모든 W의 커밋 전에:

```bash
cd /home/user/modules            # 저장소 뿌리
npm run validate                 # 모듈 14개 · 오류 0
npm run test:web                 # web 시험
npm run build:web                # ui/ 빌드
# web/ 에서 design 을 고쳤다면
cd common/lab.stellaxia.node-gui/web && npm run gen
git diff --stat                  # 의도한 파일만
```

W3 · W8에서는 추가로 `npm run pack -- --tag <임의>`로 `.tmod`가 만들어지는지(`TERRA_CHECKOUT` · `TERRA_CLI` 필요), 그리고 §6 재측정으로 완료 기준을 확인한다.

## 6. 기록표 (전/후)

같은 환경(헤드리스 Chromium · 4코어)에서 잰다. 아직 안 쟀으면 `—`.

| 항목 | 전 (n=4) | W1 후 (n=2) | W2 후 | W3 후 (n=2) | 최종 (n=3 · 레지스트리로 설치한 0.4.2 n=2) |
| --- | --- | --- | --- | --- | --- |
| 로그인 클릭 → 맵 표시 (초) | 18.1 · 18.6 · 20.6 · 23.0 (평균 20.1) | 18.3 · 19.5 | — (성능과 무관) | 7.8 · 8.0 | **7.0 · 7.4 · 7.5** (평균 7.3) · 설치본 7.3 · 7.3 |
| `catalog` 요청 시작 → 종료 (초) | 6.3~9.2 → 13.8~18.7 (**7.5~9.5초 걸림**) | 0.2 → 0.3 (미리 시작) | — | 3.3~3.4 → 3.5~3.6 (**0.2초**) | 2.3~2.7 → 2.5~3.0 (**0.2~0.3초**) |
| 첫 데이터 요청 시작 — `whoami` (초) | 13.8 · 14.3 · 16.2 · 18.8 | 0.2 (미리) | — | 3.6 | 2.6 · 3.0 · 3.1 |
| 조타륜 앱 첫 요청 — `modules.get` 시작 (초) | 14.2 · 14.9 | **14.0 · 15.7** (그대로) | — | 3.8 · 3.9 | 2.7 · 3.3 · 3.4 |
| `toDataURL` 호출 수 / 누적 ms / MB | 318 / 3,260~3,730 / 36.6 | 318 / 3,490~3,570 / 36.6 | — | 167 / 18~25 / 0.1 (작은 무늬 `bakePx`) | 167 / 20~25 / 0.1 |
| `toBlob` 호출 수 (비동기 PNG) | 0 | 0 | — | 6~7 | 6~9 |
| `drawImage` 호출 수 / 누적 ms | 151 / 1,085~1,219 | 151 / 850~1,080 | — | 6~7 / 17~18 | 6~9 / 20~25 |
| 50ms 초과 롱태스크 수 / 최대 ms / 합 ms | 43~53 / 4,714~7,490 / 7,820~11,629 | 41~44 / 4,856~5,214 / 7,988~8,544 | — | 17~18 / 1,795~1,871 / 2,868~2,935 | 19~25 / 1,737~2,132 / 3,322~3,532 |
| 서로 다른 그림 수 (중복 제거 후) | 313 / 318 (중복 5) | — | — | — | 쓰인 것만 6~11장 |
| `.tmod` 크기 | 939,430 B (0.4.1) | — | — | — | 940,968 B (0.4.2) |
| 노드 카드 지어낸 값 (있음/없음) | 있음 (24 · 48 · 87%) | 있음 | **없음** | 있음 | **없음** |
| 로그인→맵 구간 5xx | 503 두 건(`io.devices.get` · `files.list.get`) | 같음 | — | 같음 | **0** |

> [!NOTE] 숫자 읽는 법
> - "전"은 같은 환경에서 네 번 쟀다(처음 두 번은 23.0 · 20.6, 이어서 잰 두 번은 18.6 · 18.1 — 환경 부하에 따라 흔들린다). 전후 비교는 같은 날 같은 스택으로 했다.
> - "최종 롱태스크 19~25건"에는 바다 애니메이션 렌더 루프의 50~80ms 작업(소프트웨어 렌더링)이 주기적으로 들어 있다 — 굽기가 아니다(§8).
> - W1 열의 `catalog` 0.2→0.3은 네트워크 단계의 시간이다. 그 응답을 **쓰는 코드**(조타륜 앱 첫 요청)는 14~15.7초에야 돌았다 — W1이 효과 없던 근거다.

## 7. 진행 로그

한 줄씩 추가한다: `날짜 · W# · 한 일 · 커밋 · 막힌 것`.

| 날짜 | W | 한 일 | 커밋 | 비고 |
| --- | --- | --- | --- | --- |
| 2026-10-09 | — | 지시서 작성 · maingui 중단에 따라 UP-33~36을 MD로 흡수 | `1b70d03` | — |
| 2026-10-09 | W0 | master · leaf 데몬 · 게이트웨이(master 세션) · leaf 셸(vite) · 코어 모듈(base Scene · player · scene-runtime)을 띄우고 "전" 4회 측정 | — | 컨테이너가 재시작되어 한 번 다시 띄웠다 |
| 2026-10-09 | W1 | `src/api/warm.js` — 시작 화면이 토큰을 받는 즉시 catalog · whoami · node.get · enrollment.status · nodes 요청을 시작하고 노드 화면이 그 응답을 받게 했다(시험 10개) | (되돌림) | 요청은 0.2초에 끝났지만 조타륜 앱 첫 요청은 14~15.7초에 돌았고 맵 표시도 18.3~19.5초로 그대로였다 — **지연은 요청 순서가 아니라 굽기가 메인 스레드를 쥔 것**이라 코드를 되돌렸다 |
| 2026-10-09 | W3 | 굽기 분석(318회 중 313 서로 다름 · 큰 그림 151장은 SVG 38MB · 호출 위치: 타일 `bakeImgs` 65 · 건물 `bakeBuildings` 68 · 도로 `roadImgOf` 18 · 작은 무늬 `bakePx` 166 · 비용은 앞 셋) → 쓰이는 것만(`needTile` · `needBld` · `roadImgOf`) · 한 장씩 `requestIdleCallback`(`bakeEnq`) · 비동기 PNG(`toBlob` + `FileReader` — CSP가 `blob:`을 막는다) | `9870c35` | 로그인→맵 18~23초 → 7.8~8.0초 · catalog 7.5~9.5초 → 0.2초 |
| 2026-10-09 | W2 | `meters` 해시 계산 제거 → `nodeMeters(nd)`(받은 값만) · 없으면 "사용량 — 이 노드의 게이트웨이가 아직 알려 주지 않는다". leaf 게이트웨이에 사용량 op가 없음을 확인 → PF-25 | `f57e2fa` | 시험 1개 |
| 2026-10-09 | W4 | 창 본문 — 보드가 있는 창은 [전체 화면으로 열기] · 없는 창(모듈 · 사용자)은 "이 앱에 아직 없다". **"보드에서 열기 →" 링크는 누르면 srcdoc이 CSP 오류 페이지로 바뀌어 노드 화면이 깨지는 버그라 제거**. 속성 메뉴는 정상 | `31c13d5` | 시험 2개 |
| 2026-10-09 | W5 | 미리 읽기 시작 1200ms → 250ms · 준비 판정을 load+900ms 고정에서 liveHub 값 기준(최대 3.5초)으로 · `autoMs` 1400 → 900 | `73d20d9` | 7.8~8.0 → 7.1~7.2초. 연출은 이미 구름에서 기다리고 있었다 |
| 2026-10-09 | W6 | `src/api/module-gate.js` — modules.get(15초 캐시)로 모듈이 없으면 `io.devices.get` · `files.list.get`을 부르지 않는다 | `1a1dc3f` | 503 두 건 제거 · 시험 5개 |
| 2026-10-09 | W7 | 하지 않음 | — | W3로 런타임 굽기가 1~11장으로 줄어 캐시가 필요 없다 |
| 2026-10-09 | W8 | 문서 정리 · 모듈 0.4.2 · 레지스트리에 0.4.2를 올려 노드가 합의해 업그레이드(롤백 0.4.1 보존)하고 설치본으로 다시 측정(7.3초 · 7.3초) | (이 PR 마지막 커밋) | — |

## 8. 결과 요약과 남은 것

완료 기준 대비(같은 환경):

| 기준 | 결과 |
| --- | --- |
| 로그인 → 맵이 현재(20초+)의 절반 이하 | **달성** — 평균 20.1초 → 7.3초(−64%) |
| 메인 스레드 `toDataURL` 0회(또는 보이는 것에 한정) | **달성** — 큰 굽기 0회. 남은 167회는 작은 무늬(`bakePx` 32×32, 합 0.02초). 쓰이는 큰 그림은 `toBlob`(6~11장) |
| 맵 진입 구간 50ms 초과 롱태스크 ≤ 1건 | **미달** — 19~25건. 마운트 동기 작업 1건(1.7~2.1초) + 바다 애니메이션 렌더 루프의 50~80ms 주기 작업(소프트웨어 렌더링). 굽기 때문에 생기는 롱태스크는 없다 |
| 지어낸 CPU · 메모리 · 디스크 없음 | **달성** |
| 빈 창이 이유와 다음 행동을 말한다 | **달성** |

남은 것(이 지시서 밖):

1. **노드 화면 마운트의 동기 작업 약 2초** — 첫 롱태스크. 스킨 · 타일 벡터 생성(`ensureBake` · `bakeTile`)이 들어 있는 것으로 보이나 프로파일로 쪼개지는 않았다(MD-42 후보).
2. **GPU 환경 실측** — 이 숫자는 헤드리스 소프트웨어 렌더링이다. 하늘 연출의 `dt` 제한(40ms) 때문에 프레임이 느리면 연출이 더 길어진다.
3. **편집기 보드 페이지**(건물 · 도로 · 필드 · 자재 편집기 — `building.js` · `road.js` · `field.js` · `material.js`)에도 굽기 코드(`getImageData` 사용)가 있다 — 전체 화면으로 열 때의 비용은 재지 않았다.
4. **PF-25** — 노드 사용량(CPU · 메모리 · 디스크)을 앱 토큰으로 읽는 길. Master에는 `GET /api/v1/monitor/snapshot`이 있으나 leaf 게이트웨이가 게시하지 않는다.
5. 로그인 이후 쓰기 기능(자원 추가 · 수정 · 삭제 · 연결 · 도로 편집)은 이번에도 확인하지 않았다.

## 관련 문서

- [[docs/README|개발 문서 MOC]]
- [[performance-and-fidelity-recommendations|맵 진입 지연과 가짜 값 — 개선 권고안]]
- [[implementation-backlog|구현해야 할 것]]
- [[module-profile|모듈 프로필]]
- [[real-data-layer|실데이터 층]]
- [[testing|시험]]
