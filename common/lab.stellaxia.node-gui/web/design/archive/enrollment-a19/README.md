# 노드 등록 화면 (maingui A-19) — 보관본

maingui 저장소의 브랜치 `claude/node-enrollment-code-r2f1yn`(`818d234`, 2026-10-05)에만 있던 "미등록 leaf 등록 화면 — 등록 코드로 등록한다"의 디자인이다. maingui가 더는 쓰이지 않아 이 저장소로 옮겨 둔다.

| 파일 | 내용 |
| --- | --- |
| `Artboard-qcfu.dc.html` · `Intro.dc.html` | 그 브랜치의 디자인 원본 전체(`web/design/`의 같은 이름 파일과 견주면 등록 화면 부분이 보인다) |
| `maingui-a19-full.patch` | 그 브랜치가 maingui `main` 위에 더한 변경 전체(22파일 — 디자인 · `src/api/enroll.js` · 시험 · 가짜 Gateway · 문서) |

- **지금은 쓰지 않는다.** 이 모듈은 등록 화면을 일부러 싣지 않는다(백로그 MD-25 — 등록 코드 발급은 Master op라 앱 토큰으로는 쓸 수 없다, Q-2).
- `web/design/` 바깥이라 `npm run gen`은 읽지 않는다.
- 쓰게 되면: 두 `.dc.html`의 등록 화면 부분을 `web/design/`에 합치고, `maingui-a19-full.patch`의 `src/api/enroll.js` · `src/boot/service.js` 등을 이 모듈 구조에 맞춰 옮긴다.
