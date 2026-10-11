// 승인 카드가 답을 못 받고 만료된다. 카드의 expires_ms = 질문 시각 + min(30분, 턴에 남은 시간).
// 시험은 세션을 max_seconds 를 작게(예 300) 열고, 카드가 서면 POST /__control/clock {advance_s: 301} 로 시계를 감는다.
// → 카드가 사라지고(pending_approvals 에서 빠짐) error TIME_LIMIT 한 줄(denied 줄 없음), 세션은 idle(한 번 실행은 done), last_error_code=TIME_LIMIT.
// max_seconds 를 크게(예 7200) 열고 31분 감으면 반대로 `denied`(note "no answer within 30m0s")가 남는다.
import { RESTART } from './approval-flow.mjs';

export default {
  id: 'approval-timeout',
  title: '승인 시간 초과',
  description: 'restart 카드가 서고 아무도 답하지 않는다. 시계를 감아 TIME_LIMIT(또는 30분 무응답 거부)을 만든다.',
  session: { autonomy: 'ask', max_seconds: 300 },
  steps: [{ text: '승인을 기다립니다.', calls: [RESTART] }, { when: ['approved', 'denied'], text: '답을 받았습니다.' }],
};
