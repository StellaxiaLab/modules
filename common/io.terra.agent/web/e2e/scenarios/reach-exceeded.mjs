// 자격의 reach 밖 — 다른 노드를 건드리는 호출은 게이트가 거절한다(TERRA_REACH_EXCEEDED). 카드가 서지 않는다.
export default {
  id: 'reach-exceeded',
  title: 'reach 밖 호출',
  description: 'fleet 범위가 필요한 reboot 을 node 자격으로 제안 → refuse · TERRA_REACH_EXCEEDED.',
  session: { autonomy: 'ask' },
  steps: [
    { text: '다른 노드를 재부팅합니다.', calls: [{ operation_id: 'terra.fleet.nodes.reboot.post', input: { node: 'tree-02' }, reason: '다른 노드도 멈췄습니다' }] },
    { text: '이 자격의 범위 밖이라 실행하지 못했습니다.' },
  ],
};
