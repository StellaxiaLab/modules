// 호출을 끝낸 뒤의 모델 실패 — 진행 중 호출은 끝났고 새 계획은 세우지 않는다(§13).
export default {
  id: 'model-failure-after-call',
  title: '호출 뒤 모델 실패',
  description: '읽기 호출은 성공하고 다음 모델 호출이 실패한다: call 줄은 남고 세션은 failed.',
  steps: [
    { text: '목록을 읽습니다.', calls: [{ operation_id: 'terra.daemon.modules.list', reason: '확인' }] },
    { fail: { message: 'fake: connection reset by peer' } },
  ],
};
