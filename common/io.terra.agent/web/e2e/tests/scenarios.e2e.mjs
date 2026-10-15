// 시나리오 엔진을 실제 브리지 위에서 돌려 본다 — 점검용 앱의 window.probe.call 로 승인 한 판·시간 초과·오류 주입을 구동한다.
// (실제 앱 점검은 같은 시나리오를 화면에서 구동한다 — TODO-checks.md)

import { MODULE, assert, check, openShell, until } from '../lib/harness.mjs';

const PROBE = { apps: ['probe'] };
const open = (t, who = 'alice') => openShell(t, { principal: who }, { wait: 'body[data-done="1"]' });
const getSession = async (shell, id) => (await shell.call('GET', `${MODULE}/sessions/${id}`)).data;
const entries = async (shell, id) => (await shell.call('GET', `${MODULE}/sessions/${id}/messages`)).data.entries;
const waitState = (shell, id, state) => until(async () => (await getSession(shell, id)).state === state && (await getSession(shell, id)), { message: `${id} 가 ${state} 가 되지 않았다` });

check('승인 한 판: ask 세션 → waiting-approval(계약 사실·expires_ms) → 승인 → 접수 → idle, 두 번째 승인은 404', async (t) => {
  const shell = await open(t);
  await t.control.pin('approval-flow', 'e2e-ask');
  const opened = await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-ask', autonomy: 'ask' });
  assert.deepEqual([opened.status, opened.data.created, opened.data.state], [200, true, 'idle']);
  const sent = await shell.call('POST', `${MODULE}/sessions/e2e-ask/messages`, { text: 'chat 모듈을 다시 시작해 줘' });
  assert.equal(sent.status, 201);

  const waiting = await waitState(shell, 'e2e-ask', 'waiting-approval');
  const [card] = waiting.pending_approvals;
  assert.equal(card.operation_id, 'terra.daemon.modules.by-module-id.restart.post');
  assert.equal(card.contract.risk, 'dangerous');
  assert.equal(card.contract.output_mode, 'accepted-job');
  assert.deepEqual(card.contract.side_effects, [{ resource_id: 'module', action: 'restart' }]);
  assert.ok(card.expires_ms > card.created_ms && card.expires_ms - card.created_ms <= 30 * 60 * 1000);
  assert.match(card.reason, /chat/); // 모델의 주장(reason)은 계약 사실(contract)과 갈라 온다

  // 함정 6: 대기 중에 'y' 를 글로 보내면 승인으로 읽힌다 — 여기서는 보내지 않고 approvals.post 로만 답한다(I8).
  const approve = await shell.call('POST', `${MODULE}/approvals/${card.request_id}`, {});
  assert.deepEqual([approve.status, approve.data.decision], [200, 'approved']);
  const again = await shell.call('POST', `${MODULE}/approvals/${card.request_id}`, {});
  assert.deepEqual([again.status, again.data.error.code], [404, 'APPROVAL_NOT_FOUND']);

  const done = await waitState(shell, 'e2e-ask', 'idle');
  assert.equal(done.pending_approvals.length, 0);
  const kinds = (await entries(shell, 'e2e-ask')).map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => ['approval', 'approved', 'call', 'done'].includes(k)), ['approval', 'approved', 'call', 'done']);
  assert.match(done.answer, /접수/); // "접수 ≠ 완료"
  const calls = await t.control.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].approved, true);
}, PROBE);

check('거부 후 같은 호출 재제안(I18): 거부 → 둘째 카드가 선다', async (t) => {
  const shell = await open(t);
  await t.control.pin('approval-deny-repropose', 'e2e-deny');
  await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-deny', autonomy: 'ask' });
  await shell.call('POST', `${MODULE}/sessions/e2e-deny/messages`, { text: '다시 시작' });
  const first = (await waitState(shell, 'e2e-deny', 'waiting-approval')).pending_approvals[0];
  await shell.call('POST', `${MODULE}/approvals/${first.request_id}`, { deny: true });
  const second = await until(async () => {
    const s = await getSession(shell, 'e2e-deny');
    return s.state === 'waiting-approval' && s.pending_approvals[0].request_id !== first.request_id && s.pending_approvals[0];
  }, { message: '둘째 카드가 서지 않았다' });
  assert.equal(second.operation_id, first.operation_id);
  assert.deepEqual(second.input, first.input);
  const lines = await entries(shell, 'e2e-deny');
  const denied = lines.find((e) => e.kind === 'call' && e.error_code === 'TERRA_APPROVAL_DENIED');
  assert.ok(denied, '거부 줄(TERRA_APPROVAL_DENIED)이 call 에 남아야 한다');
}, PROBE);

check('시간 초과: 시계를 앞당기면 카드가 사라지고 TIME_LIMIT 한 줄(denied 없음), 상태는 idle', async (t) => {
  const shell = await open(t);
  await t.control.pin('approval-timeout', 'e2e-time');
  await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-time', autonomy: 'ask', max_seconds: 300 });
  await shell.call('POST', `${MODULE}/sessions/e2e-time/messages`, { text: '다시 시작' });
  const waiting = await waitState(shell, 'e2e-time', 'waiting-approval');
  const [card] = waiting.pending_approvals;
  assert.ok(card.expires_ms - card.created_ms <= 300_000);
  await t.control.advance(301);
  const after = await waitState(shell, 'e2e-time', 'idle');
  assert.deepEqual(after.pending_approvals, []);
  assert.equal(after.last_error_code, 'TIME_LIMIT');
  assert.match(after.last_error, /ran past its limit of 300s/);
  const lines = await entries(shell, 'e2e-time');
  assert.ok(lines.some((e) => e.kind === 'error' && e.error_code === 'TIME_LIMIT'));
  assert.equal(lines.filter((e) => e.kind === 'denied').length, 0);
}, PROBE);

check('모듈 재시작: 끝나지 않은 세션은 archived, 이후 메시지는 SESSION_FINISHED', async (t) => {
  const shell = await open(t);
  await t.control.pin('module-restart', 'e2e-arch');
  await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-arch', autonomy: 'ask' });
  await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-idle', autonomy: 'plan' });
  await shell.call('POST', `${MODULE}/sessions/e2e-arch/messages`, { text: '다시 시작' });
  await waitState(shell, 'e2e-arch', 'waiting-approval');
  await t.control.restartModule();
  assert.equal((await getSession(shell, 'e2e-arch')).state, 'archived');
  assert.equal((await getSession(shell, 'e2e-idle')).state, 'archived', 'idle 이던 것도 archived 다(함정 4)');
  assert.deepEqual((await getSession(shell, 'e2e-arch')).pending_approvals, []);
  const rejected = await shell.call('POST', `${MODULE}/sessions/e2e-arch/messages`, { text: '다시' });
  assert.deepEqual([rejected.status, rejected.data.error.code], [409, 'SESSION_FINISHED']);
}, PROBE);

check('응답 유실 주입(drop after): 앱은 502 BRIDGE_GATEWAY_UNREACHABLE 를 받지만 서버에는 글이 쌓였다', async (t) => {
  const shell = await open(t);
  await shell.call('POST', `${MODULE}/sessions`, { session_id: 'e2e-lost', autonomy: 'plan' });
  await t.control.inject({ op: 'io.terra.agent.messages.post' }, { drop: 'after' });
  const lost = await shell.call('POST', `${MODULE}/sessions/e2e-lost/messages`, { text: '이 응답은 유실된다' });
  assert.deepEqual([lost.ok, lost.status, lost.error.code], [false, 502, 'BRIDGE_GATEWAY_UNREACHABLE']);
  const lines = await entries(shell, 'e2e-lost');
  assert.equal(lines.filter((e) => e.kind === 'user' && e.text === '이 응답은 유실된다').length, 1, '요청은 처리되었다 — 확인은 messages.list 로');
}, PROBE);

check('오류 봉투 두 모양: 모듈 {error:{code,message}} 와 Gateway {error:{code,message,traceId}}, 성공 봉투 선택', async (t) => {
  const shell = await open(t);
  await t.control.inject({ op: 'io.terra.agent.sessions.list' }, { module_error: { code: 'AGENT_UNAVAILABLE', message: 'store broken' } });
  const moduleErr = await shell.call('GET', `${MODULE}/sessions`);
  assert.deepEqual([moduleErr.status, moduleErr.data], [503, { error: { code: 'AGENT_UNAVAILABLE', message: 'store broken' } }]);

  await t.control.inject({ op: 'io.terra.agent.sessions.list' }, { gateway_error: { code: 'QUOTA_EXCEEDED', status: 429 } });
  const gatewayErr = await shell.call('GET', `${MODULE}/sessions`);
  assert.equal(gatewayErr.status, 429);
  assert.deepEqual(Object.keys(gatewayErr.data), ['error']);
  assert.deepEqual([gatewayErr.data.error.code, Object.keys(gatewayErr.data.error).sort()], ['QUOTA_EXCEEDED', ['code', 'message', 'traceId']]);

  await t.control.config({ envelope: 'gateway' });
  const wrapped = await shell.call('GET', `${MODULE}/sessions`);
  assert.equal(wrapped.data.ok, true);
  assert.deepEqual(wrapped.data.data, { sessions: [] });
  assert.ok(wrapped.data.meta.request_id);
}, PROBE);

check('긴 기록: 1200줄 세션은 limit 없이 500줄에서 끊기고 after_seq 로 쪽을 넘긴다', async (t) => {
  const shell = await open(t);
  await t.control.seed({ scenario: 'long-history', session_id: 'long', owner: 'alice', entries: 1200 });
  const page1 = (await shell.call('GET', `${MODULE}/sessions/long/messages`)).data.entries;
  assert.equal(page1.length, 500);
  const page2 = (await shell.call('GET', `${MODULE}/sessions/long/messages?after_seq=${page1.at(-1).seq}`)).data.entries;
  const page3 = (await shell.call('GET', `${MODULE}/sessions/long/messages?after_seq=${page2.at(-1).seq}`)).data.entries;
  assert.deepEqual([page2.length, page3.length], [500, 200]);
  assert.deepEqual([...page1, ...page2, ...page3].map((e) => e.seq), Array.from({ length: 1200 }, (_, i) => i + 1));
}, PROBE);
