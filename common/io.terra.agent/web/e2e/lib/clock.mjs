// 가짜 시계. 실제 시간에 오프셋을 더한다 — 승인 카드의 만료·세션 한도·자격 만료가 이 시계를 따른다.
// 시험은 `/__control/clock` 으로 오프셋을 올려 5분·30분을 기다리지 않고 건너뛴다.

export function createClock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    advance(ms) {
      offset += ms;
      return Date.now() + offset;
    },
    reset() {
      offset = 0;
    },
    get offset() {
      return offset;
    },
  };
}
