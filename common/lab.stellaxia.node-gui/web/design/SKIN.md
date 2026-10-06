# ver.2 겉모습 지침 (작업자용)

ver.2 = **원본 화면의 기능 · 데이터 · 모션 · 맵 그림은 그대로** + **겉모습만 어두운 유리 HUD**.
사용자가 마음에 들어 한 것: 새 UI 배치 · 선 아이콘 · 색/글꼴. 싫어한 것: 원본보다 빠진 기능, 바뀐 맵 품질, 바뀐 편집 데이터, 약해진 모션.

## 지켜야 할 것 (어기면 안 됨)

- `<script type="text/x-dc" data-dc-script>` 안의 **로직 · 데이터 · 상태 · 핸들러 · 애니메이션 코드는 바꾸지 않는다.** 바꾸는 건 보이는 값(색 · 글꼴 · 테두리 · 그림자 · 모서리 · 간격 · 아이콘 글리프)뿐이다. 레이아웃 좌표 계산을 바꿔야 하면 최소한으로, 동작이 그대로인지 확인한다.
- 템플릿의 `{{…}}` 구멍, `on*` 핸들러, `<sc-for>` · `<sc-if>` 구조, `aria-label`은 그대로 둔다 (요소를 감싸거나 스타일을 바꾸는 건 된다).
- 맵(필드 SVG · 타일 · 건물 그림) · 자재/건물/도로의 **그림 데이터 색은 건드리지 않는다.**
- 원본에 있던 기능 · 버튼 · 정보는 하나도 빼지 않는다.

## 토큰

| 쓰임 | 값 |
| --- | --- |
| 화면 바탕 | `#07090c` ~ `#0d0f13` |
| 유리 패널 | `rgba(13,15,19,.82)` + `backdrop-filter: blur(14px)` · 테두리 `1px solid rgba(255,255,255,.10)` · 모서리 14 · 그림자 `0 10px 30px rgba(0,0,0,.30)` |
| 창 | `rgba(15,17,21,.92)` · 머리 46px · 아래 선 `rgba(255,255,255,.10)` |
| 면 한 단 위 | `rgba(255,255,255,.05)` · 마우스 올림 `.09` |
| 선 | `rgba(255,255,255,.10)` · 진한 선 `.18` |
| 글자 | 본문 `#ede9e1` · 보조 `#b4bac3` · 흐림 `#9aa1ab` · 더 흐림 `#6b7280` |
| 주 버튼 | 바탕 `#ede9e1` · 글자 `#111` (파란 주 버튼 대신) |
| 보통 버튼 | 바탕 `rgba(255,255,255,.04)` · 선 `.18` · 모서리 9 · 높이 34 (작게 28) |
| 역할 색 | Tree `#f0a63a` · Leaf `#5aa8ff` · 선택(햇빛) `#ffd84d` |
| 상태 | 정상 `#3ecf8e` · 주의 `#f5b83d` · 실패 `#ff5d5d` · 정보 `#7aa7ff` |
| 칩 | 높이 20 · 모서리 10 · 색 글자 + 같은 색 50% 테두리 + 10% 바탕 |
| 글꼴 | `'Noto Sans KR'` 본문 · `'JetBrains Mono'` 이름 · 수치 · 키 · 좌표 · 워드마크 `TERRA` 자간 .42em |
| 캡션 | 10px · 600 · 자간 .28em · 대문자 · `#9aa1ab` |

## 아이콘

이모지 · 픽셀 아이콘 대신 **선 아이콘** (viewBox 24, `fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round`).
경로 모음: `v2/design/icons.md` (복사해 인라인 `<svg>`로 쓴다). 그림 데이터(맵 · 건물 · 자재 미리보기)의 이모지는 그대로.

## 참고 그림

`/tmp/claude-0/-home-claude-maingui/9e9b6d58-d0bc-5222-b806-24e50a3f4065/scratchpad/rebuild-ref/look/` — 사용자가 좋아한 ver.2 겉모습 캡처
(v2_1 · v2_app · v2_bld · v2_editors_* · v2_admin_* · v2_login · v2_panels).
`.../rebuild-ref/skin-tokens.css` — 그때의 CSS (부품 모양 참고용).

## 확인

```bash
python3 v2/tools/gen.py <페이지>      # 예: node · building · settings
# http://localhost:5173/v2/<페이지>.html  (서버: cd 저장소 && python3 -m http.server 5173)
```
원본과 같이 동작하는지 http://localhost:5173/examples/demo/<페이지>.html 와 비교한다.
