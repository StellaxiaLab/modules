// 가장 단순한 판 — 읽기 호출 하나(묻지 않고 돈다)와 답. 어떤 자율성에서도 같다.
export default {
  id: 'read-only-answer',
  title: '읽기 호출 후 답',
  description: '모듈 목록을 읽고(run · ok) 답한다. 승인 카드가 없다. 기본 시나리오.',
  session: { autonomy: 'plan' },
  steps: [
    { text: '모듈 목록을 확인합니다.', calls: [{ operation_id: 'terra.daemon.modules.list', reason: '현재 모듈 상태를 알아야 합니다' }] },
    { text: '모듈은 둘이고 io.terra.chat 만 멈춰 있습니다.' },
  ],
};
