# modules

Terra 외부 모듈 모음.

## 레이아웃

Terra 저장소의 `module/` 과 같은 계층을 쓴다 — 모듈이 두 저장소 사이를 오가도
경로 모양이 바뀌지 않게 하기 위해서다.

```text
<소유 계층>/<module-id>/
├─ module.json          Manifest v2
├─ README.md
└─ …                    kind 에 따라 scene/ · bin/ · contracts/ · ui/ …
```

소유 계층은 `common`(제품 공통) · `leaf` · `tree` 셋이고, 폴더 이름과
`module.json` 의 `id` 는 같아야 한다.

## 모듈

| 모듈 | kind | 무엇 |
| --- | --- | --- |
| [`common/io.terra.scene.terra`](common/io.terra.scene.terra) | scene | Leaf·Tree가 함께 쓰는 통합 GUI base Scene이자 노드 모듈 런처 |

## 검증

패키지가 자립하는지는 Terra CLI 가 판정한다.

```bash
terra module pack <계층>/<module-id> --out /tmp/<module-id>.tmod
```

`VERIFIED true` 가 나오면 매니페스트가 가리키는 파일이 전부 있고 id 가 풀린다는
뜻이다. Scene 모듈의 화면 어휘까지 재려면 Terra 저장소의 출하 Scene 시험을 쓴다
(실 로더 · 실 계약 · 실 DOM · dry run).
