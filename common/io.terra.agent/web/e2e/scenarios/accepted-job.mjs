// "접수 ≠ 완료" — auto 세션은 쓰기를 묻지 않고 돌린다. 결과는 접수(accepted-job)일 뿐이다.
// 결과 방식은 call 줄에 없다(GAP-6); 카드에는 contract.output_mode 로만 보인다 — ask 로 열면 카드에서 볼 수 있다.
export default {
  id: 'accepted-job',
  title: '접수된 작업',
  description: 'auto 세션: nodes.rebalance 쓰기가 승인 없이 돌고(run · ok) 작업이 접수된다. 모델은 완료로 말하지 않는다.',
  session: { autonomy: 'auto' },
  steps: [
    { text: '노드를 다시 균형 맞춥니다.', calls: [{ operation_id: 'terra.nodes.rebalance.post', input: { node: 'tree-home' }, reason: '노드 부하가 치우쳐 있습니다' }] },
    { text: '재균형이 접수되었습니다(job-0002). 접수되었을 뿐 아직 끝난 것은 아닙니다.' },
  ],
};
