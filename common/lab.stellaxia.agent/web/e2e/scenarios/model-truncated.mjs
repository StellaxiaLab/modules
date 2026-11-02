// 답이 토큰 한도에서 잘렸다 — assistant 줄 뒤에 error(MODEL_TRUNCATED), 이어서 done. 상태는 idle.
export default {
  id: 'model-truncated',
  title: '답이 잘림',
  description: 'MODEL_TRUNCATED 줄 + done 줄, idle.',
  steps: [{ text: '긴 설명을 시작합니다. 먼저 첫째로 모듈 구조는 다음과 같', truncated: true }],
};
