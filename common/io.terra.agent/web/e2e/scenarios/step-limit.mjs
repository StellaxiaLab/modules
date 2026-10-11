// 한도 — 모델이 끝없이 읽기 호출을 한다. max_steps 에 닿으면 error(STEP_LIMIT), 상태는 idle(한 번 실행은 done).
// 시험은 max_steps 를 작게(예 3) 열어 쓴다.
export default {
  id: 'step-limit',
  title: '차례 한도(STEP_LIMIT)',
  description: '끝없이 읽는 모델. max_steps 에 닿아 STEP_LIMIT 으로 멈춘다 — failed 가 아니다.',
  steps: (ctx) => ({ text: `${ctx.step}번째 확인`, calls: [{ operation_id: 'terra.daemon.modules.list', reason: '한 번 더 확인' }] }),
};
