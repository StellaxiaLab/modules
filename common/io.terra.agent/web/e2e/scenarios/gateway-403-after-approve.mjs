// I5 — 승인은 "물어봤다"이지 권한이 아니다. 승인해도 Gateway 가 한 번 더 판정해 403 이 난다.
export default {
  id: 'gateway-403-after-approve',
  title: '승인 뒤 Gateway 403',
  description: 'ask 세션: 승인하면 호출이 MODULE_PERMISSION_DENIED 로 실패한다(call status=error). 화면은 "승인했지만 거절되었다"고 말해야 한다.',
  session: { autonomy: 'ask' },
  steps: [
    { text: '다시 시작을 요청합니다.', calls: [{ operation_id: 'terra.daemon.modules.by-module-id.restart.post', input: { module_id: 'io.terra.chat' }, reason: '멈춰 있습니다', outcome: { status: 'error', error_code: 'MODULE_PERMISSION_DENIED' } }] },
    { when: 'error', text: '승인을 받았지만 Gateway 가 이 자격으로는 안 된다고 거절했습니다.' },
  ],
};
