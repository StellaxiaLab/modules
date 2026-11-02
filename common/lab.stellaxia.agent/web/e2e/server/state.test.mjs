// 세션 상태기계와 시나리오 — idle→running→waiting-approval→idle/done/failed/cancelled/archived 와
// 승인 카드(M-2 contract·"적지 않음", M-3 expires_ms), entry 의 reason/judgement(M-4), last_error_code(M-6), model 줄(M-7).

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { checkScenario } from '../scenarios/index.mjs';
import { startAgent, until, waitState } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startAgent();
});
after(async () => ctx?.close());

const RESTART = 'terra.daemon.modules.by-module-id.restart.post';
const begin = async (preset = 'ready') => {
  await ctx.control.reset(preset);
  await ctx.control.config({ model_delay_ms: 5 });
};
const open = async (id, body = {}, principal = 'alice') => {
  const r = await ctx.api('POST', '/sessions', { principal, body: { session_id: id, ...body } });
  assert.equal(r.status, 200, r.text);
  return r.json;
};
const say = (id, text, principal = 'alice') => ctx.api('POST', `/sessions/${id}/messages`, { principal, body: { text } });
const session = async (id, principal = 'alice') => (await ctx.api('GET', `/sessions/${id}`, { principal })).json;
const lines = async (id, principal = 'alice') => (await ctx.api('GET', `/sessions/${id}/messages?limit=0`, { principal })).json.entries;
const kinds = async (id) => (await lines(id)).map((e) => e.kind);
const respond = (card, deny = false) => ctx.api('POST', `/approvals/${card.request_id}`, { body: deny ? { deny: true } : {} });

test('승인 한 판: idle → running → waiting-approval → running → idle, 접수는 accepted-job 이고 카드는 한 번만 답한다', async () => {
  await begin();
  await ctx.control.config({ model_delay_ms: 300 }); // running 이 눈에 보일 만큼
  await ctx.control.scenario('approval-flow');
  assert.equal((await open('s1', { autonomy: 'ask', topic: '승인 시험' })).state, 'idle');
  const sent = await say('s1', '모듈 다시 시작');
  assert.equal(sent.status, 201);
  assert.equal(sent.json.entry.kind, 'user');
  assert.equal(sent.json.entry.author_label, 'alice');
  assert.equal((await session('s1')).state, 'running', '글을 받으면 곧바로 running');
  assert.equal((await say('s1', '또')).json.error.code, 'SESSION_BUSY', 'running 중에는 SESSION_BUSY');

  const waiting = await waitState(ctx.api, 's1', 'waiting-approval');
  const [card] = waiting.pending_approvals;
  assert.equal(card.operation_id, RESTART);
  assert.match(card.request_id, /^apr_/);
  assert.equal(card.reason, 'chat 모듈이 멈춰 있어 다시 시작해야 합니다'); // 모델의 주장(M-4)
  assert.match(card.judgement, /every dangerous operation needs a person/); // 게이트의 판정 근거
  assert.deepEqual(card.input, { module_id: 'io.terra.chat' });
  // M-2: 계약 사실
  assert.deepEqual(card.contract, {
    risk: 'dangerous', confirmation_mode: 'required', idempotency_mode: 'none', retry_mode: 'never', output_mode: 'accepted-job',
    side_effects: [{ resource_id: 'module', action: 'restart' }], permissions: ['modules.restart'],
  });
  // M-3: expires_ms = 질문 + min(30분, 턴에 남은 시간) — 기본 한도 900초가 30분보다 짧아 남은 턴 시간이다
  assert.ok(card.expires_ms - card.created_ms <= 900_000 && card.expires_ms - card.created_ms > 890_000, String(card.expires_ms - card.created_ms));
  assert.equal((await say('s1', '또')).json.error.code, 'SESSION_BUSY', 'waiting-approval 중에도 SESSION_BUSY');

  const approved = await respond(card);
  assert.deepEqual([approved.status, approved.json.decision, approved.json.session_id], [200, 'approved', 's1']);
  assert.equal((await respond(card)).json.error.code, 'APPROVAL_NOT_FOUND');
  const rest = await waitState(ctx.api, 's1', 'idle');
  assert.deepEqual(rest.pending_approvals, []);
  assert.match(rest.answer, /접수/);
  assert.equal(rest.steps, 2);

  const log = await lines('s1');
  assert.deepEqual(log.map((e) => e.kind), ['user', 'model', 'assistant', 'approval', 'approved', 'call', 'model', 'assistant', 'done']);
  assert.deepEqual(log.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const call = log.find((e) => e.kind === 'call');
  assert.deepEqual([call.decision, call.status, call.operation_id], ['confirm', 'ok', RESTART]);
  assert.match(call.trace_id, /^tr_/);
  assert.equal(call.reason, card.reason);
  assert.ok(call.judgement);
  const approval = log.find((e) => e.kind === 'approval');
  assert.equal(approval.request_id, card.request_id);
  assert.match(approval.text, /Approval needed/);
  assert.equal('output_mode' in call, false, '결과 방식은 call 줄에 없다(GAP-6) — 카드에만 있다');
});

test('model 줄: 나간 바이트가 늘고 provider·model 구조 필드가 있다(M-7), usage 는 세션 누적이다', async () => {
  await begin();
  await ctx.control.scenario('read-only-answer');
  await open('m1');
  await say('m1', '첫 질문');
  await waitState(ctx.api, 'm1', 'idle');
  await say('m1', '둘째 질문');
  await until(async () => (await kinds('m1')).filter((k) => k === 'done').length === 2);
  const models = (await lines('m1')).filter((e) => e.kind === 'model');
  assert.equal(models.length, 4);
  assert.ok(models.every((e) => e.provider === 'anthropic' && e.model === 'fake-model-1'));
  assert.ok(models.every((e, i) => i === 0 || e.sent_bytes > models[i - 1].sent_bytes), '나간 바이트는 기록이 쌓일수록 는다');
  const s = await session('m1');
  assert.equal(s.steps, 4);
  assert.ok(s.usage.input_tokens > 0 && s.usage.output_tokens > 0);
  assert.deepEqual([s.provider, s.model, s.owner, s.topic], ['anthropic', 'fake-model-1', 'alice', '첫 질문']);
});

test('거부: TERRA_APPROVAL_DENIED 줄, 재시작은 일어나지 않는다, 안내 글, idle', async () => {
  await begin();
  await ctx.control.scenario('approval-flow');
  await open('d1', { autonomy: 'ask' });
  await say('d1', '다시 시작');
  const [card] = (await waitState(ctx.api, 'd1', 'waiting-approval')).pending_approvals;
  assert.equal((await respond(card, true)).json.decision, 'denied');
  const rest = await waitState(ctx.api, 'd1', 'idle');
  assert.match(rest.answer, /거부하셨으므로/);
  const log = await lines('d1');
  assert.ok(log.some((e) => e.kind === 'denied' && e.request_id === card.request_id));
  const call = log.find((e) => e.kind === 'call');
  assert.deepEqual([call.status, call.error_code, call.decision], ['refused', 'TERRA_APPROVAL_DENIED', 'confirm']);
  assert.equal(call.trace_id, undefined, 'Gateway 에 닿지 않았다');
  assert.deepEqual((await ctx.control.calls()).map((c) => [c.outcome, c.approved]), [['denied', false]]);
});

test('I18: 거부 뒤 같은 (operation_id, input) 이 새 카드로 다시 온다', async () => {
  await begin();
  await ctx.control.scenario('approval-deny-repropose');
  await open('r1', { autonomy: 'ask' });
  await say('r1', '다시 시작');
  const [first] = (await waitState(ctx.api, 'r1', 'waiting-approval')).pending_approvals;
  await respond(first, true);
  const second = await until(async () => {
    const s = await session('r1');
    return s.state === 'waiting-approval' && s.pending_approvals[0].request_id !== first.request_id && s.pending_approvals[0];
  });
  assert.deepEqual([second.operation_id, second.input], [first.operation_id, first.input]);
  await respond(second);
  const rest = await waitState(ctx.api, 'r1', 'idle');
  assert.match(rest.answer, /접수/);
  assert.equal((await lines('r1')).filter((e) => e.kind === 'denied').length, 1);
});

test('시간 초과: 시계를 한도만큼 앞당기면 카드가 사라지고 TIME_LIMIT 한 줄(denied 없음), idle, 입력 복귀', async () => {
  await begin();
  await ctx.control.scenario('approval-timeout');
  await open('t1', { autonomy: 'ask', max_seconds: 300 });
  await say('t1', '다시 시작');
  const [card] = (await waitState(ctx.api, 't1', 'waiting-approval')).pending_approvals;
  assert.ok(card.expires_ms - card.created_ms <= 300_000 && card.expires_ms - card.created_ms > 290_000, '남은 턴 시간(300초)이 30분보다 짧다');
  await ctx.control.advance(299);
  assert.equal((await session('t1')).state, 'waiting-approval');
  await ctx.control.advance(2);
  const after = await waitState(ctx.api, 't1', 'idle');
  assert.deepEqual(after.pending_approvals, []);
  assert.equal(after.last_error_code, 'TIME_LIMIT'); // M-6
  assert.equal(after.last_error, 'stopped: this turn ran past its limit of 300s');
  const log = await lines('t1');
  assert.deepEqual(log.filter((e) => ['denied', 'approved'].includes(e.kind)), []);
  const error = log.find((e) => e.kind === 'error');
  assert.deepEqual([error.error_code, error.author], ['TIME_LIMIT', 'terra']);
  assert.equal((await respond(card)).json.error.code, 'APPROVAL_NOT_FOUND', '만료된 카드는 답할 수 없다');
  assert.equal((await say('t1', '다시')).status, 201, 'idle 이라 다음 글을 받는다');
});

test('한도가 크면 30분 무응답 거부: denied 줄(note "no answer within 30m0s")과 이어지는 모델 차례', async () => {
  await begin();
  await ctx.control.scenario('approval-flow');
  await open('t2', { autonomy: 'ask', max_seconds: 7200 });
  await say('t2', '다시 시작');
  await waitState(ctx.api, 't2', 'waiting-approval');
  await ctx.control.advance(30 * 60 + 1);
  const rest = await waitState(ctx.api, 't2', 'idle');
  assert.deepEqual(rest.pending_approvals, []);
  assert.match(rest.answer, /답이 없어/);
  const denied = (await lines('t2')).find((e) => e.kind === 'denied');
  assert.equal(denied.note, 'no answer within 30m0s');
  assert.equal(rest.last_error, undefined);
});

test('취소: running·waiting-approval 에서 cancelled 가 되고 줄이 더 늘지 않으며 종료 상태에도 cancelled 줄이 쌓인다', async () => {
  await begin();
  await ctx.control.scenario('cancel-mid-turn');
  await open('c1');
  await say('c1', '오래 걸리는 일');
  assert.equal((await session('c1')).state, 'running');
  const cancelled = await ctx.api('POST', '/sessions/c1/cancel');
  assert.deepEqual([cancelled.status, cancelled.json], [200, { session_id: 'c1', state: 'cancelled' }]);
  const count = (await lines('c1')).length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await lines('c1')).length, count, '취소 뒤에는 줄이 늘지 않는다');
  assert.equal((await say('c1', 'x')).json.error.code, 'SESSION_FINISHED');
  await ctx.api('POST', '/sessions/c1/cancel');
  assert.equal((await kinds('c1')).filter((k) => k === 'cancelled').length, 2, '상태 가드가 없다 — 소스 그대로');

  await ctx.control.scenario('approval-flow');
  await open('c2', { autonomy: 'ask' });
  await say('c2', '다시 시작');
  await waitState(ctx.api, 'c2', 'waiting-approval');
  await ctx.api('POST', '/sessions/c2/cancel');
  const s = await session('c2');
  assert.deepEqual([s.state, s.pending_approvals], ['cancelled', []]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await kinds('c2')).filter((k) => k === 'cancelled').length, 1);
});

test('모델 실패: error(MODEL_UNAVAILABLE) 줄, failed, last_error 는 영어 원문, 이후 메시지는 SESSION_FINISHED', async () => {
  await begin();
  await ctx.control.scenario('model-failure');
  await open('f1');
  await say('f1', '안녕');
  const failed = await waitState(ctx.api, 'f1', 'failed');
  assert.equal(failed.last_error_code, 'MODEL_UNAVAILABLE');
  assert.match(failed.last_error, /^fake: anthropic API returned 529/);
  const error = (await lines('f1')).find((e) => e.kind === 'error');
  assert.deepEqual([error.error_code, error.author], ['MODEL_UNAVAILABLE', 'terra']);
  assert.match(error.text, /^model call failed:/);
  assert.equal((await say('f1', '다시')).json.error.code, 'SESSION_FINISHED');
  assert.equal(failed.steps, 0, '실패한 호출은 차례로 세지 않는다');
});

test('모듈 재시작: 끝나지 않은 세션은 모두 archived(idle 포함), done·cancelled·failed 는 그대로, 대기 승인은 사라진다', async () => {
  await begin();
  await ctx.control.scenario('approval-flow');
  await open('x-wait', { autonomy: 'ask' });
  await say('x-wait', '다시 시작');
  await waitState(ctx.api, 'x-wait', 'waiting-approval');
  await open('x-idle');
  await open('x-cancel');
  await ctx.api('POST', '/sessions/x-cancel/cancel');
  await ctx.control.scenario('read-only-answer');
  const run = await ctx.api('POST', '/runs', { body: { prompt: '한 번 실행' } });
  assert.equal(run.json.state, 'done');
  await ctx.control.scenario('model-failure');
  await open('x-fail');
  await say('x-fail', 'x');
  await waitState(ctx.api, 'x-fail', 'failed');

  await ctx.control.restartModule();
  assert.equal((await session('x-wait')).state, 'archived');
  assert.deepEqual((await session('x-wait')).pending_approvals, []);
  assert.equal((await session('x-idle')).state, 'archived');
  assert.equal((await session('x-cancel')).state, 'cancelled');
  assert.equal((await session('x-fail')).state, 'failed');
  assert.equal((await session(run.json.session_id)).state, 'done');
  assert.equal((await say('x-idle', '다시')).json.error.code, 'SESSION_FINISHED');
  assert.ok((await lines('x-wait')).length > 0, '기록은 읽을 수 있다');
  // 자격·모델 등록은 디스크에 있어 남는다
  assert.equal((await ctx.api('GET', '/credentials')).json.registered, true);
});

test('자율성: plan 은 제안만, ask 는 카드, auto 는 쓰기를 묻지 않고 접수, unattended 는 묻지 않고 거절', async () => {
  await begin('unattended-credential');
  // plan
  await ctx.control.scenario('propose-call');
  await open('p1', { autonomy: 'plan' });
  await say('p1', '제안해 줘');
  await waitState(ctx.api, 'p1', 'idle');
  const proposal = (await lines('p1')).find((e) => e.kind === 'call');
  assert.deepEqual([proposal.decision, proposal.status, proposal.error_code], ['plan', 'refused', 'TERRA_APPROVAL_REQUIRED']);
  assert.deepEqual((await ctx.control.calls()).filter((c) => c.reached), [], '제안은 Gateway 에 닿지 않는다');
  // auto: 쓰기는 돈다(접수), 위험한 restart 는 묻는다
  await ctx.control.scenario('accepted-job');
  await open('p2', { autonomy: 'auto' });
  await say('p2', '재균형');
  const job = await waitState(ctx.api, 'p2', 'idle');
  assert.match(job.answer, /접수되었을 뿐/);
  const ran = (await lines('p2')).find((e) => e.kind === 'call');
  assert.deepEqual([ran.decision, ran.status], ['run', 'ok']);
  assert.equal((await kinds('p2')).includes('approval'), false);
  await ctx.control.scenario('approval-flow');
  await open('p3', { autonomy: 'auto' });
  await say('p3', '다시 시작');
  await waitState(ctx.api, 'p3', 'waiting-approval');
  // unattended: 사전 승인 밖은 거절, 사전 승인된 restart 는 묻지 않고 돈다
  await ctx.control.scenario('unattended-refuse');
  await open('p4', { autonomy: 'unattended' });
  await say('p4', '시도');
  await waitState(ctx.api, 'p4', 'idle');
  const calls = (await lines('p4')).filter((e) => e.kind === 'call');
  assert.deepEqual(calls.map((e) => [e.operation_id, e.decision, e.status, e.error_code ?? '']), [
    ['terra.files.write', 'refuse', 'refused', 'TERRA_APPROVAL_REQUIRED'],
    [RESTART, 'run', 'ok', ''],
  ]);
  assert.equal((await kinds('p4')).includes('approval'), false);
});

test('unattended 는 무인 자격이 있어야 열린다(CREDENTIAL_NOT_UNATTENDED), 외부 MCP 와는 못 쓴다', async () => {
  await begin();
  const refused = await ctx.api('POST', '/sessions', { body: { autonomy: 'unattended' } });
  assert.deepEqual([refused.status, refused.json.error.code], [403, 'CREDENTIAL_NOT_UNATTENDED']);
  await ctx.control.credential('alice', { unattended: true, pre_approved: [] });
  const empty = await ctx.api('POST', '/sessions', { body: { autonomy: 'unattended' } });
  assert.match(empty.json.error.message, /pre-approves nothing/);
  await ctx.control.credential('alice', { unattended: true, pre_approved: [RESTART] });
  assert.equal((await ctx.api('POST', '/sessions', { body: { session_id: 'u1', autonomy: 'unattended' } })).status, 200);
  const conflict = await ctx.api('POST', '/sessions', { body: { autonomy: 'unattended', mcp_servers: ['x'] } });
  assert.deepEqual([conflict.status, conflict.json.error.code], [409, 'MCP_UNATTENDED_CONFLICT']);
});

test('함정 6: 승인 대기 중에 글로 보낸 y·n·approve·deny 는 가장 오래된 카드에 답한다', async () => {
  await begin();
  await ctx.control.scenario('two-approvals');
  await open('y1', { autonomy: 'ask' });
  await say('y1', '두 가지');
  const first = (await waitState(ctx.api, 'y1', 'waiting-approval')).pending_approvals[0];
  const typed = await say('y1', 'y');
  assert.equal(typed.status, 201);
  assert.equal(typed.json.entry.text, 'y');
  const second = await until(async () => {
    const s = await session('y1');
    return s.state === 'waiting-approval' && s.pending_approvals[0].request_id !== first.request_id && s.pending_approvals[0];
  });
  assert.equal(second.operation_id, 'terra.files.write');
  assert.equal((await respond(first)).json.error.code, 'APPROVAL_NOT_FOUND', "'y' 가 첫 카드를 승인했다");
  assert.equal((await say('y1', 'deny nope')).json.error.code, 'APPROVAL_NOT_FOUND', '모르는 id 는 404 지만 줄은 이미 쌓였다');
  assert.equal((await kinds('y1')).filter((k) => k === 'user').length, 3);
  await say('y1', 'no');
  await waitState(ctx.api, 'y1', 'idle');
  // 대기가 없을 때의 'y' 는 그냥 글이다
  await ctx.control.scenario('read-only-answer');
  assert.equal((await say('y1', 'y')).json.entry.kind, 'user');
  assert.equal((await session('y1')).state, 'running');
});

test('한도·거절·잘림: STEP_LIMIT·TOKEN_BUDGET·MODEL_REFUSED·MODEL_TRUNCATED 는 failed 가 아니라 idle(한 번 실행은 done)', async () => {
  await begin();
  await ctx.control.scenario('step-limit');
  await open('l1', { max_steps: 3 });
  await say('l1', '계속');
  const stopped = await waitState(ctx.api, 'l1', 'idle');
  assert.deepEqual([stopped.steps, stopped.last_error_code, stopped.last_error], [3, 'STEP_LIMIT', 'step limit reached']);
  assert.equal((await lines('l1')).at(-1).error_code, 'STEP_LIMIT');

  await ctx.control.scenario('token-budget');
  await open('l2', { token_budget: 10000 });
  await say('l2', '계속');
  const spent = await waitState(ctx.api, 'l2', 'idle');
  assert.equal(spent.last_error_code, 'TOKEN_BUDGET');
  assert.equal(spent.token_budget, 10000);

  await ctx.control.scenario('model-refusal');
  await open('l3');
  await say('l3', '거절될 말');
  const refused = await waitState(ctx.api, 'l3', 'idle');
  assert.equal(refused.last_error_code, 'MODEL_REFUSED');

  await ctx.control.scenario('model-truncated');
  await open('l4');
  await say('l4', '길게');
  await waitState(ctx.api, 'l4', 'idle');
  assert.deepEqual((await lines('l4')).filter((e) => e.kind === 'error').map((e) => e.error_code), ['MODEL_TRUNCATED']);

  const run = await ctx.api('POST', '/runs', { body: { prompt: '끝없이', max_steps: 2 } });
  await ctx.control.scenario('step-limit');
  const limited = await ctx.api('POST', '/runs', { body: { prompt: '끝없이', max_steps: 2 } });
  assert.equal(run.json.state, 'done');
  assert.deepEqual([limited.json.state, limited.json.last_error], ['done', 'step limit reached']);
});

test('simulate: 호출이 0 — planned 줄만 남고 카드도 호출도 없다(I13)', async () => {
  await begin();
  await ctx.control.scenario('simulate-planned');
  await open('sim', { autonomy: 'ask', simulate: true });
  await say('sim', '시뮬레이션');
  await waitState(ctx.api, 'sim', 'idle');
  const log = await lines('sim');
  assert.deepEqual(log.filter((e) => e.kind === 'planned').map((e) => [e.operation_id, e.status]), [[RESTART, 'planned'], ['terra.daemon.modules.list', 'planned']]);
  assert.equal(log.some((e) => e.kind === 'call' || e.kind === 'approval'), false);
  assert.deepEqual((await ctx.control.calls()).filter((c) => c.reached), [], 'simulate 는 호출이 0이다');
  assert.equal((await session('sim')).simulate, true);
});

test('외부 MCP: external 줄(server·result_bytes·"no gateway audit"), 쓰기 외부 도구의 카드에는 contract 가 없다', async () => {
  await begin();
  await ctx.api('PUT', '/mcp/servers/fake-mcp', { principal: 'ext', body: { command: 'fake-mcp-cmd', read_only: ['read_file'] } });
  assert.equal((await ctx.api('GET', '/mcp/servers')).json.servers[0].tools.find((t) => t.name === 'read_file').read_only, true);
  await ctx.control.scenario('external-call');
  await open('e1', { autonomy: 'ask', mcp_servers: ['fake-mcp'] });
  await say('e1', '읽어 줘');
  await waitState(ctx.api, 'e1', 'idle');
  const external = (await lines('e1')).find((e) => e.kind === 'external');
  assert.deepEqual([external.server, external.result_bytes, external.status, external.trace_id], ['fake-mcp', 2048, 'ok', undefined]);
  assert.match(external.note, /external · 2048 B · no gateway audit/);
  assert.equal((await session('e1')).mcp_servers[0], 'fake-mcp');

  await ctx.control.scenario('external-write-ask');
  await open('e2', { autonomy: 'ask', mcp_servers: ['fake-mcp'] });
  await say('e2', '써 줘');
  const [card] = (await waitState(ctx.api, 'e2', 'waiting-approval')).pending_approvals;
  assert.equal('contract' in card, false, '외부 도구에는 Gateway 계약이 없다');
  assert.ok(card.expires_ms);
});

test('"적지 않음"과 "없음": 계약이 안 적은 키는 없고, 빈 목록은 적었다는 뜻이다(DC-17)', async () => {
  await begin();
  await ctx.control.scenario('legacy-contract');
  await open('lc', { autonomy: 'ask' });
  await say('lc', '두 가지');
  const [legacy] = (await waitState(ctx.api, 'lc', 'waiting-approval')).pending_approvals;
  assert.deepEqual(legacy.contract, { risk: 'write' });
  await respond(legacy);
  const write = await until(async () => {
    const s = await session('lc');
    return s.state === 'waiting-approval' && s.pending_approvals[0].operation_id === 'terra.files.write' && s.pending_approvals[0];
  });
  assert.deepEqual(write.contract.side_effects, []);
  assert.deepEqual(write.contract.permissions, ['files.write']);
});

test('Gateway 가 승인 뒤에도 거절한다(I5) · reach 밖 호출은 카드 없이 거절된다', async () => {
  await begin();
  await ctx.control.scenario('gateway-403-after-approve');
  await open('g1', { autonomy: 'ask' });
  await say('g1', '다시 시작');
  const [card] = (await waitState(ctx.api, 'g1', 'waiting-approval')).pending_approvals;
  await respond(card);
  await waitState(ctx.api, 'g1', 'idle');
  const call = (await lines('g1')).find((e) => e.kind === 'call');
  assert.deepEqual([call.status, call.error_code], ['error', 'MODULE_PERMISSION_DENIED']);

  await ctx.control.scenario('reach-exceeded');
  await open('g2', { autonomy: 'ask' });
  await say('g2', '재부팅');
  await waitState(ctx.api, 'g2', 'idle');
  assert.equal((await kinds('g2')).includes('approval'), false);
  assert.equal((await lines('g2')).find((e) => e.kind === 'call').error_code, 'TERRA_REACH_EXCEEDED');
});

test('기능 스위치로 이전 모듈 모양을 만든다: M-2·M-3·M-4·M-6·M-7 이 없는 응답', async () => {
  await begin();
  await ctx.control.features({ contract: false, expires: false, reasonJudgement: false, lastErrorCode: false, modelFields: false });
  await ctx.control.scenario('approval-timeout');
  await open('old', { autonomy: 'ask', max_seconds: 60 });
  await say('old', '다시 시작');
  const [card] = (await waitState(ctx.api, 'old', 'waiting-approval')).pending_approvals;
  assert.deepEqual(Object.keys(card).sort(), ['created_ms', 'input', 'operation_id', 'request_id']);
  await ctx.control.advance(61);
  const after = await waitState(ctx.api, 'old', 'idle');
  assert.equal('last_error_code' in after, false);
  assert.equal(after.last_error.startsWith('stopped:'), true);
  const log = await lines('old');
  assert.ok(log.filter((e) => e.kind === 'model').every((e) => !('provider' in e) && !('model' in e) && e.note.includes('anthropic/')), '구조 필드는 없고 note 에만 있다');
  assert.ok(log.every((e) => !('reason' in e) && !('judgement' in e)));
  assert.ok(log.find((e) => e.kind === 'error').error_code === 'TIME_LIMIT', '기록의 error 줄 코드는 그 전에도 있었다');
});

test('긴 기록: 1200줄, limit 없이 500줄에서 끊기고 after_seq 로 이어 읽으면 빠짐·겹침이 없다', async () => {
  await begin();
  await ctx.control.seed({ scenario: 'long-history', session_id: 'long', owner: 'alice', entries: 1200 });
  const pages = [];
  let after = 0;
  for (;;) {
    const page = (await ctx.api('GET', `/sessions/long/messages?after_seq=${after}`)).json.entries;
    if (page.length === 0) break;
    pages.push(page.length);
    after = page.at(-1).seq;
  }
  assert.deepEqual(pages, [500, 500, 200]);
  assert.equal((await ctx.api('GET', '/sessions/long/messages?limit=7&after_seq=100')).json.entries[0].seq, 101);
  assert.equal((await session('long')).state, 'idle');
});

test('세션 열기는 멱등이다 — 같은 id 로 다시 부르면 created:false, 열 때의 값은 바뀌지 않는다(I10)', async () => {
  await begin();
  const first = await open('idem', { autonomy: 'ask', max_steps: 5 });
  assert.equal(first.created, true);
  const again = await open('idem', { autonomy: 'auto' });
  assert.deepEqual([again.created, again.autonomy], [false, 'ask']);
  assert.equal((await session('idem')).max_steps, 5);
  const generated = await ctx.api('POST', '/sessions', { body: {} });
  assert.match(generated.json.session_id, /^s-/);
});

test('자격·모델 준비 상태: 없으면 세션을 못 열고(세션이 목록에 남지 않는다), 만료도 CREDENTIAL_MISSING', async () => {
  await begin('empty');
  const noCredential = await ctx.api('POST', '/sessions', { body: { session_id: 'z1' } });
  assert.deepEqual([noCredential.status, noCredential.json.error.code], [409, 'CREDENTIAL_MISSING']);
  await begin('no-model');
  assert.equal((await ctx.api('POST', '/sessions', { body: { session_id: 'z2' } })).json.error.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual((await ctx.api('GET', '/sessions')).json.sessions, []);
  await begin('expired-credential');
  const expired = await ctx.api('POST', '/sessions', { body: { session_id: 'z3' } });
  assert.equal(expired.json.error.code, 'CREDENTIAL_MISSING');
  assert.match(expired.json.error.message, /expired at/);
  const facts = (await ctx.api('GET', '/credentials')).json;
  assert.deepEqual([facts.registered, facts.expired], [true, true]);
  // 시계로도 만료시킨다
  await begin();
  await ctx.control.credential('alice', { ttl_ms: 120_000 });
  assert.equal((await ctx.api('GET', '/credentials')).json.expired, false);
  await ctx.control.advance(121);
  assert.equal((await ctx.api('GET', '/credentials')).json.expired, true);
  // 자격 등록 규칙
  const put = await ctx.api('PUT', '/credentials', { principal: 'carol', body: { credential: 'tsa_carol_unattended_fleet' } });
  assert.deepEqual([put.json.unattended, put.json.reach, put.json.pre_approved], [true, 'fleet', [RESTART]]);
  assert.equal('expired' in put.json, false);
  assert.equal((await ctx.api('GET', '/credentials', { principal: 'dave' })).json.registered, false);
});

test('시나리오 선택: 세션에 못 박기 > 한 번짜리 대기열 > 전역 기본', async () => {
  await begin();
  await ctx.control.scenario('model-refusal');
  await ctx.control.queue('read-only-answer', 1);
  await ctx.control.pin('model-failure', 'pinned');
  await open('pinned');
  await open('other');
  await say('pinned', 'a');
  await waitState(ctx.api, 'pinned', 'failed');
  await say('other', 'b'); // 대기열 한 번
  await waitState(ctx.api, 'other', 'idle');
  assert.equal((await session('other')).last_error_code, undefined);
  await say('other', 'c'); // 전역 기본 model-refusal
  await until(async () => (await session('other')).last_error_code === 'MODEL_REFUSED');
});

test('모든 시나리오가 형식을 지키고 끝까지 돈다', async () => {
  await begin('unattended-credential');
  const list = (await ctx.control.scenarios()).scenarios;
  assert.ok(list.length >= 20, `시나리오 ${list.length}개`);
  for (const scenario of ctx.agent.scenarios.ids().map((id) => ctx.agent.scenarios.get(id))) {
    assert.deepEqual(checkScenario(scenario, `${scenario.id}.mjs`), []);
  }
  await ctx.api('PUT', '/mcp/servers/fake-mcp', { principal: 'ext', body: { command: 'fake-mcp-cmd' } });
  for (const info of list.filter((s) => s.kind === 'turn')) {
    if (info.id === 'cancel-mid-turn') continue; // 60초짜리 — 위에서 취소로 시험했다
    const id = `all-${info.id}`;
    await ctx.control.pin(info.id, id);
    await open(id, { autonomy: 'plan', ...info.session });
    const sent = await say(id, '시나리오 시험');
    assert.equal(sent.status, 201, info.id);
    // 카드가 서면 승인하며 쉴 때까지
    await until(async () => {
      const s = await session(id);
      if (s.state === 'waiting-approval') await respond(s.pending_approvals[0]);
      return ['idle', 'failed', 'done'].includes(s.state) && s;
    }, { timeout: 8000, message: `${info.id} 가 끝나지 않았다` });
    const engineFailure = (await lines(id)).find((e) => /fake engine failure/.test(e.text ?? ''));
    assert.equal(engineFailure, undefined, `${info.id}: ${engineFailure?.text}`);
  }
});
