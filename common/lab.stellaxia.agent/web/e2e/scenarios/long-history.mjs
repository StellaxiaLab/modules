// 긴 기록 — 1200줄이 이미 쌓인 세션을 심는다(messages.list 는 limit 없이 500줄에서 끊긴다: 함정 8).
// 턴 시나리오가 아니다: POST /__control/seed {"scenario":"long-history","session_id":"long","owner":"alice","entries":1200}
export default {
  id: 'long-history',
  title: '긴 기록(쪽 넘김)',
  description: '세션 하나에 기록 N줄(기본 1200)을 심는다. after_seq 로 쪽을 넘기고, 이음새에서 줄이 빠지거나 겹치지 않는지 본다.',
  kind: 'seed',
  seed(engine, { session_id = 'long', owner = 'alice', entries = 1200, state = 'idle' } = {}) {
    return engine.seedSession({ id: session_id, owner, entries, finalState: state });
  },
};
