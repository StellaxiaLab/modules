// unattended — 물을 사람이 없으니 사전 승인 목록 밖은 묻지 않고 거절한다(TERRA_APPROVAL_REQUIRED).
// 사전 승인된 restart 는 묻지 않고 돈다. 'unattended-credential' 프리셋(alice)이 restart 를 사전 승인한다.
export default {
  id: 'unattended-refuse',
  title: '무인 — 거절',
  description: 'unattended 세션: 사전 승인 밖의 쓰기(files.write)는 카드 없이 refused · TERRA_APPROVAL_REQUIRED, 사전 승인된 restart 는 돈다.',
  session: { autonomy: 'unattended' },
  steps: [
    {
      text: '두 가지를 시도합니다.',
      calls: [
        { operation_id: 'terra.files.write', input: { path: '/tmp/x' }, reason: '파일을 씁니다' },
        { operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'io.terra.chat' }, reason: '다시 시작합니다' },
      ],
    },
    { text: '쓰기는 거절되었고 다시 시작은 사전 승인되어 접수되었습니다.' },
  ],
};
