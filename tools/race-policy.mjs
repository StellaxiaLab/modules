// `-race` 를 돌지, 건너뛸지, 실패로 칠지 정하는 판단 — test-modules.mjs 가 쓴다.
//
// **왜 따로 있나** — `go test -race` 는 cgo 가 필요하다. cgo 가 꺼져 있으면(러너에
// C 컴파일러가 없거나 CGO_ENABLED=0) go 는 시험을 시작도 하지 못하고
// `go: -race requires cgo; enable cgo by setting CGO_ENABLED=1` 로 죽는다.
// 그것은 경합이 아니고 시험이 틀린 것도 아닌데, 이 스크립트는 그 종료 코드를 그대로
// "경합 또는 -race 실패" 로 셌다. Terra 의 CI 가 이 스크립트를 부르기 시작하자
// (Terra `Modules migration checks`), 러너 풀 중 C 컴파일러가 없는 러너에 잡이
// 배정된 런이 무작위로 빨개졌다 — 최근 11개 런 중 3건.
//
// **처분** — 기본은 건너뛰되 **말없이 건너뛰지 않는다**(`::notice::` 로 사유를 남긴다).
// 이 저장소의 CI 는 cgo 가 있는 호스팅 러너에서 돌므로 `--require-race` 로 강제한다:
// 거기서 cgo 가 사라지면 건너뛰는 것이 아니라 **실패**한다. 그래야 가드가 조용히
// 약해지지 않는다(G-7·G-10 과 같은 모양을 막는다).
//
// 판단만 한다 — 프로세스를 띄우지도 환경을 읽지도 않는다. 그래서 단위 시험이
// race-policy.test.mjs 에서 모든 갈래를 돈다.

/**
 * @param {{ platform: string, cgoEnabled: boolean, requireRace: boolean }} input
 * @returns {{ run: boolean, fail: boolean, level: 'log'|'notice'|'error', message: string }}
 */
export function decideRace({ platform, cgoEnabled, requireRace }) {
  if (platform !== 'linux') {
    // 윈도우·맥에서는 원래 돌지 않는다(스케줄러 인터리빙이 달라 의미가 없다).
    // 강제 대상도 아니다 — `--require-race` 는 "리눅스에서 cgo 가 있어야 한다" 이다.
    return {
      run: false,
      fail: false,
      level: 'log',
      message: `-race 는 리눅스에서만 돈다 — 이 호스트는 ${platform} 다`
    };
  }
  if (cgoEnabled) {
    return { run: true, fail: false, level: 'log', message: '' };
  }
  if (requireRace) {
    return {
      run: false,
      fail: true,
      level: 'error',
      message:
        '--require-race 인데 cgo 가 꺼져 있다 (CGO_ENABLED=0 이거나 C 컴파일러가 없다). ' +
        '-race 시험을 건너뛰는 대신 실패로 친다 — 이 CI 는 cgo 가 있는 러너에서 돌아야 한다'
    };
  }
  return {
    run: false,
    fail: false,
    level: 'notice',
    message:
      '-race 를 건너뛴다: cgo 가 꺼져 있다 (CGO_ENABLED=0 이거나 C 컴파일러가 없다). ' +
      '경합이 없다는 뜻이 아니다 — 이 저장소의 CI 는 --require-race 로 이것을 강제한다'
  };
}
