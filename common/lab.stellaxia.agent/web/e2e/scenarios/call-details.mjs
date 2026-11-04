// M-5 — call 줄의 입력 요약·결과 요약·output.mode. `details: true` 인 호출만 새 칸을 싣는다(켜지 않은 호출은 이전 모듈의 모양).
// 입력에 비밀로 이름 붙은 칸(api_key)이 있어도 가려진 채 실린다 — 가림은 서버(코어) 몫이고 앱은 되살리지 않는다(I1).
export default {
  id: 'call-details',
  title: '호출 상세(입력·결과·결과 방식)',
  description: 'auto 세션: 접수(accepted-job)되는 쓰기 · 즉시(immediate) 읽기 · 칸 없는 이전 모양 호출 셋. simulate 로 열면 planned 줄에도 입력·결과 방식이 실린다.',
  session: { autonomy: 'auto' },
  steps: [
    {
      text: '세 가지를 불렀습니다.',
      calls: [
        { operation_id: 'terra.nodes.rebalance.post', input: { node: 'tree-home', api_key: 'sk-test-SECRET-1234567890' }, reason: '노드 부하가 치우쳐 있습니다', details: true },
        { operation_id: 'terra.daemon.modules.list', input: {}, reason: '목록을 봅니다', details: true },
        { operation_id: 'terra.daemon.modules.by-module-id.get', input: { module_id: 'io.terra.chat' }, reason: '한 모듈을 봅니다' },
      ],
    },
    { text: '재균형은 접수되었을 뿐 끝나지 않았습니다.' },
  ],
};
