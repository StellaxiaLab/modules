# internal/testkit

모듈의 **시험 코드만** 쓰는 보조 패키지 모음이다. 모듈 아니고, 포장되지 않고, 어떤 모듈의 바이너리에도 들어가지 않는다.
모듈은 자기 `src/go.mod`에서 `replace github.com/StellaxiaLab/modules/internal/testkit => ../../../../internal/testkit`로 가리킨다.

| 패키지 | 무엇 | 출처 |
| --- | --- | --- |
| `testwait` | 시험이 "참이 될 때까지 기다린다"를 말하는 한 곳 (`TERRA_TEST_WAIT_SCALE`) | Terra `terra-testwait`의 `testwait.go` · `testwait_test.go` 원문. Terra 트리를 훑는 `guard_test.go`는 Terra 저장소 전제라 가져오지 않았다 |
| `climanifest` | `module.json`의 `contributions.cli.commands`를 읽는 시험용 해석기 | 새로 작성 (아래) |

## climanifest

Terra의 `modulert.ManifestCLICommands`는 호스트가 실제로 쓰는 검증기라 공개 SDK(`terra-sdk`)에 없다. 모듈 시험은 지금까지 그것으로
"플랫폼이 이 선언을 받아들이는가"까지 확인했다. 이 패키지는 `module.json`을 JSON으로 직접 읽어 **선언이 말하는 바**(이름 · 연산 · 포인터 · 세션 역할)만
확인한다. 호스트의 거절 규칙 전체는 재현하지 않는다 — 그 권위 검증은 CI의 `terra module pack`이 계속 맡는다.
