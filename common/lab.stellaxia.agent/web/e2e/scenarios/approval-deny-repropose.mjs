// I18 — 거부 뒤 모델이 **같은** (operation_id, input) 을 다시 제안한다. 거부 기억이 없으니 새 카드가 선다.
import { RESTART } from './approval-flow.mjs';

export default {
  id: 'approval-deny-repropose',
  title: '거부 후 같은 호출 재제안(I18)',
  description: '첫 카드를 거부하면 모델이 같은 호출을 다시 제안해 둘째 카드가 선다("이전에 거부한 같은 호출" 표식 시험). 둘째에서 승인하면 접수, 또 거부하면 포기한다.',
  session: { autonomy: 'ask' },
  steps: [
    { text: '다시 시작을 요청합니다.', calls: [RESTART] },
    { when: 'denied', text: '그래도 필요한 작업이라 한 번 더 요청합니다.', calls: [RESTART] },
    { when: 'denied', text: '알겠습니다. 더는 요청하지 않겠습니다.' },
    { when: 'approved', text: '다시 시작이 접수되었습니다(job-0001). 완료된 것은 아닙니다.' },
  ],
};
