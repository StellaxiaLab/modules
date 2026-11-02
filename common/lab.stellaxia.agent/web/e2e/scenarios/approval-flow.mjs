// 승인 한 판 — ask 세션. 위험한 restart 를 제안하면 승인 카드가 서고(waiting-approval), 답에 따라 갈린다.
//   승인 → 호출이 돌고 "접수"(accepted-job)로 끝난다. 접수 ≠ 완료.
//   거부 → TERRA_APPROVAL_DENIED 줄, 재시작 없음, 안내 글.
//   답이 없음 → 시계를 앞당기면 TIME_LIMIT(승인 카드는 entry 가 아니다 — 파생한다).
export const RESTART = {
  operation_id: 'terra.daemon.modules.by-module-id.restart.post',
  input: { module_id: 'io.terra.chat' },
  reason: 'chat 모듈이 멈춰 있어 다시 시작해야 합니다',
};

export default {
  id: 'approval-flow',
  title: '승인 한 판(승인·거부)',
  description: 'ask 세션: restart 승인 카드 → 승인하면 접수(accepted-job), 거부하면 TERRA_APPROVAL_DENIED 와 안내 글.',
  session: { autonomy: 'ask' },
  steps: [
    { text: 'io.terra.chat 을 다시 시작해야 합니다. 승인을 요청합니다.', calls: [RESTART] },
    { when: 'approved', text: '다시 시작이 접수되었습니다(job-0001). 접수일 뿐 완료된 것은 아닙니다.' },
    { when: 'denied', text: '거부하셨으므로 다시 시작하지 않았습니다.' },
    { when: 'timeout', text: '답이 없어 다시 시작하지 않았습니다.' },
  ],
};
