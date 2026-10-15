// 모듈 재시작 → archived(함정 4). 카드가 서 있는 동안 POST /__control/restart-module 을 부르면
// done·cancelled·failed 가 아닌 모든 세션(idle 이던 것도)이 archived 가 되고 대기 승인은 사라진다. 이후 messages.post 는 SESSION_FINISHED.
import { RESTART } from './approval-flow.mjs';

export default {
  id: 'module-restart',
  title: '모듈 재시작(archived)',
  description: '승인 대기에 멈춰 선 턴. 재시작을 일으키면 archived 가 된다 — 시험은 /__control/restart-module 을 부른다.',
  session: { autonomy: 'ask' },
  steps: [{ text: '승인을 기다립니다.', calls: [RESTART] }],
};
