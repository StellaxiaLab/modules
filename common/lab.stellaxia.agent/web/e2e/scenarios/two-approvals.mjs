// 한 차례에 승인 둘 — 호출은 차례로 돌므로 카드도 하나씩 선다(첫 답 뒤에 둘째). 대기 여럿·인박스 시험용.
export default {
  id: 'two-approvals',
  title: '승인 둘(차례로)',
  description: 'ask 세션: restart 와 쓰기(files.write)를 한 차례에 제안한다. 첫 카드에 답하면 둘째 카드가 선다.',
  session: { autonomy: 'ask' },
  steps: [
    {
      text: '두 가지 작업이 필요합니다.',
      calls: [
        { operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'io.terra.chat' }, reason: '모듈을 다시 시작합니다' },
        { operation_id: 'terra.files.write', input: { path: '/etc/terra/note.txt' }, reason: '메모를 남깁니다' },
      ],
    },
    { text: '두 작업의 처리가 끝났습니다.' },
  ],
};
