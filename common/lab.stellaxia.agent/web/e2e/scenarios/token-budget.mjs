// 토큰 예산 — 한 차례에 입력 9000 토큰씩 쓴다. token_budget 을 작게(예 10000) 열면 둘째 차례 앞에서 TOKEN_BUDGET 으로 멈춘다.
export default {
  id: 'token-budget',
  title: '토큰 예산(TOKEN_BUDGET)',
  description: '차례마다 입력 9000 토큰. token_budget=10000 이면 둘째 차례에 닿는다. 상태는 idle.',
  steps: (ctx) => ({ text: `${ctx.step}번째`, usage: { input_tokens: 9000, output_tokens: 500, cache_read_tokens: 4000 }, calls: [{ operation_id: 'terra.daemon.modules.list', reason: '확인' }] }),
};
