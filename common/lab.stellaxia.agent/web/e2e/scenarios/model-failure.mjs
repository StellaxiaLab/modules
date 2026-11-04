// 모델 API 장애 — 첫 호출부터 실패한다. error(MODEL_UNAVAILABLE) 줄, 세션 failed, last_error 는 영어 원문(함정 5).
export default {
  id: 'model-failure',
  title: '모델 호출 실패',
  description: '모델 호출이 실패해 세션이 failed 가 된다(읽기 전용). HTTP 오류가 아니라 기록의 error 줄로만 온다.',
  steps: [{ delayMs: 400, fail: { message: 'fake: anthropic API returned 529 overloaded' } }],
};
