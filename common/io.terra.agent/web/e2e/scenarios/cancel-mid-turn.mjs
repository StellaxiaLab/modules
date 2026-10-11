// 취소 — 모델이 1분 걸리므로 그 안에 sessions.cancel 을 부른다. 취소 뒤에는 줄이 더 늘지 않아야 한다.
// (상태 가드가 없다 — 취소 뒤 cancelled 줄이 쌓이고, 종료 상태에도 또 쌓인다: 소스 그대로.)
export default {
  id: 'cancel-mid-turn',
  title: '진행 중 취소',
  description: '60초짜리 모델 호출. 취소하면 state=cancelled, cancelled 줄 하나, 이후 줄 증가 없음.',
  steps: [{ delayMs: 60_000, text: '이 말은 취소되면 나오지 않는다.' }],
};
