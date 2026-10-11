// 모델이 계속하기를 거절한다 — error(MODEL_REFUSED), 상태는 idle(failed 가 아니다). 다른 모델로 넘기지 않는다.
export default {
  id: 'model-refusal',
  title: '모델 거절',
  description: 'MODEL_REFUSED 줄과 idle — 한도·거절은 failed 가 아니다(I20).',
  steps: [{ text: '', refuse: { reason: 'policy' } }],
};
