---
title: "시안 ↔ 실제 운영 격차 — 보드가 실제 화면에서 의도대로 안 되는 곳"
aliases:
  - "시안 운영 격차"
  - "design-ops gaps"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "active"
version: "0.2.0"
last_updated: "2026-11-04"
language: "ko-KR"
related:
  - "[[replacement-readiness|node-gui 대체 준비도]]"
  - "[[web-architecture|GUI v3 웹 구조]]"
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
  - "[[main-scene|main Scene — 껍데기와 로그인]]"
  - "[[global-windows|전역 틀의 창]]"
  - "[[desk-flows|제어기 쓰기 흐름]]"
---

# 시안 ↔ 실제 운영 격차

화면은 캔버스 보드(`web/design/*.dc.html`)가 정하고, 실제 웹 빌드는 `web/src/boot/main.js` 가 그 보드를 불러 Terra 에 붙인다
([[web-architecture|GUI v3 웹 구조]]). 붙이는 길은 둘 — main.js 가 보드 Logic 을 상속해 덮어쓰거나, `window.Terra*` 전역을 놓고 보드가
"있으면 실제 · 없으면 시안 값"으로 가른다. **이 문서는 그 갈림이 빠졌거나 어긋나서 실제 화면에서 의도대로 안 되는 곳의 목록이다.**

- [[replacement-readiness|node-gui 대체 준비도]] 의 격차표는 *기능* 단위(Terra 가 무엇을 열어 주나), 이 문서는 *화면* 단위(그 기능이 보이는 창마다 실제냐 시안이냐)다.
- 2026-11-01 점검(보드 전수 읽기). 줄 번호는 그날 기준 — 고치기 전에 다시 확인.
- 이 문서를 고치는 쪽: 항목을 고치면 `상태` 를 바꾸고 PR 번호를 적는다. 새로 찾으면 같은 꼴로 더한다.

## 1. 열린 항목 — 심각도 순

`종류` A 더미 값만 · B 시안 전용 UI 노출 · C 이름 · 모양 어긋남 · D 실제 데이터에서 깨지는 레이아웃 · E 문서와 코드가 다름.
`고칠 곳` 보드 = `web/design/*.dc.html`(캔버스 원본은 디자인 쪽) · main = `web/src/boot/main.js` · api = `web/src/api/*`.

| # | 종류 | 위치 | 실제 화면에서 보이는 것 | 고칠 곳 · 방향 | 상태 |
| --- | --- | --- | --- | --- | --- |
| H1 | C/D | NodeDesktopEmbed `STM`(모듈) · `jobLabel`(작업) | 실패한 모듈 · 작업이 하나라도 있으면 그리기 예외 → **노드 데스크톱 전체가 빈칸**. `deskShape` 는 failed → `'fail'` 로 바꾸는데 보드 표에 `fail` 이 없었다 | 보드 — `fail` · 모르는 상태 기본값 | **고침** #146 |
| H2 | B/C | NodeDesktopEmbed `ndSet` 기본 op `gui-v3.desk.patch` + api `transport.invoke`(`gui-v3.*` 는 보내지 않고 `{ok:true}`) | 모듈 끄기/켜기 · 되돌리기 · 자원 선언 '적용' · 장치 '다시 찾기' · 모듈 '다시 읽기' 가 **성공했다고 뜨지만 노드는 그대로**. 사본이 거짓 상태로 남는다 | 보드 — 실제 노드면 op 를 잇거나 잠금. api — 모르는 `gui-v3.*` 쓰기는 거절 | 열림 |
| H3 | A/B | NodeDesktopEmbed 터미널(`runCmd`, 첫 줄) | `whoami` → stk, `node` → 'tree-home · 코어 0.9.4', `net` → 10.40.2.17 등 **고정 출력** | 보드 — 실제 모드에선 숨기거나 `TerraWho` · status 로 받은 것만 | **고침** #151 — 두 터미널로 나눔, 이어서 노드 터미널은 잠금(설계 [[node-shell\|노드 셸]]) · Terra 터미널은 위임표 읽기만 · 셸 문법 거절([[terminals\|두 터미널]]) |
| H4 | A | Scene `RESOURCES()` · `sceneMap` | 실제 리프마다 **없는 ssh · tty · gpio 위성**. 자원 뷰 · 공유 자원 폴더 · NodeConf 자원 목록 · 자원 상태 창으로 퍼지고, 누르면 'SVI 목록에 없다' | 보드(Field) — 실제 지도면 `svi.resources.get` 의 그 노드 자원으로 | 열림 |
| H5 | A | api `topology.loadTopology` → Scene `build()` | `nodes.get` 실패 · 빈 목록이면 **시안 지도(01 · 02 · 03 · 04)로 조용히** — 그 위의 TreeLogin 은 아무 비밀번호나 통과 | main · 보드 — 실제 모드면 '노드 없음 / 못 받음' 빈 지도 | **고침** 0.5.6 — 실제 모드의 첫 지도는 빈 지도, 상단 줄(StatusBar)이 못 봤음 · 노드 없음을 구분해 보인다 |
| H6 | A/B | NodeConf 전체(`window.Terra*` 분기 없음) | 기능 › 설정 · 우클릭 › 설정으로 **시안 설정 창**(master.url · 사용자 admin · 등록 코드 · 경보) — 적용은 '(시안)' | 보드 — 실제 모드면 Terra/Tree 구역을 숨기거나 노드 데스크톱 › 설정(실제)으로 보냄 | **고침** 0.5.0 — 나눔: 실제 모드는 GUI 구역 + 노드 · Tree 읽기 요약 + '제어기 › 설정 열기'([[global-windows\|전역 틀의 창]]) |
| H7 | A | ModStatus `renderVals` | CPU · MEM · 스파크라인 · 가동 시간 · **최근 로그가 지어낸 값**, 경로 · 소유도 고정 | 보드 — 수치는 '—', 로그는 `modules.by-module-id.logs.get`(데스크톱이 이미 씀) | **고침** 0.5.0 — CPU · MEM '—' + 코어 op 없음, 가동 = started_at, 로그 = logs.get. 전역 틀 그래프 = 하트비트 스냅샷 점열 + 갱신 주기 |
| H8 | A/C | WebBrowser `page()` + Field `T.shapes.modules`(MODPOOL) | 'GUI ↗' · 웹 브라우저로 열면 **미리 만든 가짜 화면**. 앱 목록이 시안 상수에서 와서 풀에 없는 모듈은 GUI 없음. 반면 데스크톱 모듈 › 앱 '열기'는 실제 — 같은 기능이 두 갈래 | 보드 — 원천을 `TerraGuiApps`, 열기를 `TerraLaunch` 로 합침 | 열림 |
| M1 | A | Field 전역 틀 윗줄 | '연결됨 · Terra 코어 1.7.0' · '로그인 admin · 관리자' · NET 1.2 MB/s 고정 | 보드 — `TerraWho` · status | 열림 |
| M2 | A/E | Field 대상 표 ← `TerraTopology`(로그인 때 한 번) | 상태 · 자원이 **로그인 순간에 멈춤**, '하트비트 n분 전'만 늘어남, 새 노드는 다시 로그인해야 보임 | main — 주기 · push 로 지도 다시 읽기 | 열림 |
| M3 | A | NodeDesktopEmbed `ndEmpty` · `deskShape` | 받기 전 · 실패한 칸에 시드: 'wg0 · 10.40.2.17/16', '등록됨 · tree-02', wg plan 늘 '설치됨' | 보드 — 실제 모드는 '—' 에서 시작 | 열림 |
| M4 | A | NodeDesktopEmbed 설정 › 정보 · 계정 | 코어 1.7.0 · OS · 가동 고정, '다시 점검'은 늘 정상, '노드 계정 stk' 고정. 바탕 이미지는 이 브라우저(localStorage)만 | 보드 | 열림 |
| M5 | B | Field 전역 › 유틸 · 설정(`exec 'tool'`), NodeDesktopEmbed '검사' · backup.tar 아이콘 | 눌러도 아무 일 없음 · 가짜 검사 결과 · 없는 파일 | 보드 — 숨기거나 '준비 중' 잠금 | 열림 |
| M6 | D | Field 대상 표 값 칸(14칸) | '하트비트 12분 전' · 긴 이름이 틀을 넘어 계기와 겹침 | 보드 — 자르기 · 말줄임 | 열림 |
| M7 | D/E | api `topology` `MAX_LEAVES=12` | 13번째 리프부터 **표시 없이 사라짐**(`more()` 를 쓰는 보드 없음) | 보드 — '+n' 표시 | 열림 |
| M8 | D | NodeDesktopEmbed 파일 관리자 '위치' 열(150px, overflow 없음) | 드라이브 · 공유 뿌리가 많거나 오류 문구가 길면 아래 항목을 못 누름 | 보드 — 세로 스크롤 | 열림 |
| L1 | A/C | Login `installed` 기본 'Leaf' · 'New Tree Connect' · auto | Tree 에 깔아도 LEAF 표시, 자리 문구 | 보드 · main | 열림 |
| L2 | C | Field ResStatus 마크업에 `node-key` 없음 | 로컬 rid 가 없으면 시안 그래프로 | 보드 | 열림 |
| L3 | A | TreeLogin 프롬프트 'admin' · 서비스 선언 포트 22/8080/5432 · 터널 상대 고정 | 고정 이름 | 보드 | 열림 |
| L4 | C/E | `window.TerraAlarms` 읽는 보드 없음 · 전역 › 설정 › 알림 동작 없음 | — | 보드 | **고침** 0.5.0 — 알림 창(자리 24) · 설정 › 알림 · 안 읽은 수 배지 |

### 처리된 것

| 항목 | PR |
| --- | --- |
| 제어기 안 파일 · 작업 · 앱 목록이 잘리고 스크롤 안 됨 | #146 |
| 모듈 상태 창만 바탕이 비쳐 다른 창과 디자인이 다름 | #146 |
| 'TEST · 로그인부터' 버튼 · Tree 로그인 TEST 안내가 실제 화면에 나옴 | #146 |
| 노드 상태 창(NodeStatus) 전부 예시 값 → 식별 · 통신 · 자원 · 최근 활동을 Master 데이터로(`window.TerraNodeInfo`) | #146 |

### 운영 경로 밖(해당 없음)

Leaf · Resource · Tree 보드는 Scene 이 불러오지 않는다(Tree 는 Login 의 bare 배경, embed 에선 숨김). StarMaker 는 이 브라우저 전용 도구.
보드가 기대하는 전역 이름 · 서명(`TerraDesk` · `TerraNet` · `TerraSvi` · `TerraNodeStats` · `TerraLaunch`)은 main.js 와 모두 맞다.

## 2. 문서(대체 준비도 §3)와 다른 것

| 문서 표기 | 실제 화면 |
| --- | --- |
| 모듈 목록 · 시작/정지/제거 '됨' | 같은 패널의 끄기/켜기 · 되돌리기는 가짜 성공(H2), 실패 모듈이면 화면이 비었다(H1, 고침) |
| 모듈 로그 '됨' | 데스크톱에서만. 모듈 상태 창의 로그는 지어낸 줄(H7) |
| 다른 모듈 앱 열기 '됨' | 데스크톱 모듈 › 앱만. GUI ↗ · 웹 브라우저는 가짜(H8) |
| 작업 · 출력 '됨(읽기)' | 실패 작업이면 비었다(H1, 고침). 진행률은 늘 0 |
| 시작 화면 · 지도 '됨' | 위성 가짜(H4) · 로그인 시점에 멈춤(M2) · 12개 넘는 리프 사라짐(M7) |
| WireGuard '됨' | plan 문구가 시드, 피어 목록은 늘 빔(M3) |
| 모듈 설치(파일) '잠금' | 잠금은 맞지만 '검사'(가짜) · '다시 읽기'(가짜 작업)는 열려 있음(M5 · H2) |

## 3. 어긋나지 않게 — 절차

이번 버그들은 모두 같은 틈에서 나왔다: **보드는 시안 값으로 완결돼 보이고, 실제로 이을 때 어느 칸이 남았는지 보이지 않는다.**

1. **보드마다 실연결 표.** 보드 머리말(스크립트 첫 주석)에 화면 요소마다 `real(op 이름)` · `seed` · `demo-only` 를 적는다. 새 칸을 만들 때 같이 적는다. 이 문서의 표는 그 모음.
2. **시안 전용 UI 는 한 가지 표시로.** 시험 안내 · 시연 버튼 · 가짜 실패 시나리오는 `window.TerraTransport` 가 있으면 숨긴다(지금은 보드마다 `testD` · `loginAgainD` 처럼 따로 — 하나의 `demo()` 로 모으는 것이 다음 단계).
3. **실제 모드의 기본값은 '—'.** 시드(`ndSeed` · `defaults()`)는 시안 전송일 때만. 실제 전송은 빈 값에서 시작해, 못 받은 칸이 시안 값으로 보이지 않게.
4. **실제 응답의 모든 상태로 그려 본다.** 시험 픽스처에 상태 열거값 전부(failed · unknown 포함) · 긴 이름 · 많은 항목(리프 13+ · 드라이브 10+)을 넣어 보드를 그리고, `renderVals` 예외면 실패.
5. **'됨'은 화면 단위로.** 대체 준비도에 '됨'을 적을 때 그 기능이 보이는 창을 모두 적는다 — 한 진입로만 실제고 다른 진입로가 시안으로 남지 않게.
6. **새 창 · 칸은 시안과 실제가 같은 모양.** 시안 값은 실제 어댑터(`src/api/*`)의 반환 모양을 그대로 흉내 낸다 — 상태 창(NodeStatus ↔ `node-info.js`)이 첫 예.
7. **코어가 열지 않은 단추는 문(gate)으로.** 화면은 다 짓고, 단추마다 `window.TerraGate(op)`(src/api/gates.js — 위임 표 · 계약 표 · 앱 권한 · 사람 권한)로 판정해 닫혔으면 why 를 그대로 보인다. 보드에 op 이름을 박은 '잠금' 플래그를 따로 두지 않는다 — 표만 다시 뽑으면 저절로 열린다. 위임 밖 op 를 부르는 곳은 tests/master-delegated.test.mjs 의 `GATED` 에 이유와 함께 적는다. 결과표는 [[replacement-readiness\|대체 준비도]] §3-2.
