// simulate — 호출이 0이다. 모든 호출이 planned 줄("실행되지 않았다")로 남는다(I13).
export default {
  id: 'simulate-planned',
  title: '시뮬레이션(planned)',
  description: 'simulate:true 세션: call 대신 planned 줄. 아무것도 실행되지 않고 카드도 서지 않는다.',
  session: { autonomy: 'ask', simulate: true },
  steps: [
    { text: '실행하면 이렇게 됩니다.', calls: [{ operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'io.terra.chat' }, reason: '시뮬레이션' }, { operation_id: 'terra.daemon.modules.list', reason: '목록' }] },
    { text: '위는 계획일 뿐 실행되지 않았습니다.' },
  ],
};
