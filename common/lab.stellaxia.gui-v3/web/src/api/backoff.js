// 다시 열기 간격 — 시도 n 번째(1부터)는 base · 2배 · 4배 … 로 늘다가 max 에서 멈춘다(지수는 5 에서 멈춘다).
// 이어 붙이는 길(push · live-stream · svi-view)이 각자 쓰던 같은 식을 한 곳으로 모았다(재사용 분석 G-6).
export function backoffMs(tries, base, max) {
  return Math.min(max, base * 2 ** Math.min(Math.max(1, tries) - 1, 5));
}
