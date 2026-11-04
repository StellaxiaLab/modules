// plan 자율성 — 모델이 위험한 호출을 제안하지만 실행되지 않는다("제안 · 실행 안 됨").
export default {
  id: 'propose-call',
  title: '호출 제안(plan)',
  description: 'plan 세션: restart 를 제안하면 call 줄이 decision=plan · status=refused · TERRA_APPROVAL_REQUIRED 로 남고 아무것도 실행되지 않는다.',
  session: { autonomy: 'plan' },
  steps: [
    { text: 'io.terra.chat 을 다시 시작하는 것을 제안합니다.', calls: [{ operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'io.terra.chat' }, reason: 'chat 모듈이 멈춰 있습니다' }] },
    { text: '제안만 했고 실행하지는 않았습니다. 실행하려면 ask 세션이 필요합니다.' },
  ],
};
