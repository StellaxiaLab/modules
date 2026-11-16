// node --test — SVI handle 만들기 · 지우기 · write(위임 세션) — 429 안내 · 거부 · 닫힘
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSviHandles, explain, isLimited, HANDLE_OPS, LIMITS } from './svi-handles.js';
import { createSviWatch } from './svi-view.js';
import MD from './master-delegated.json' with { type: 'json' };
import { gateAll } from './gates.js';

const err = (status, code) => Object.assign(new Error(code), { status, code });

test('explain — 429 는 한도와 기다릴 시간, 닫힘 · 권한 · 없음은 각자 글', () => {
  assert.match(explain(HANDLE_OPS.create, err(429, 'RATE_LIMITED')).text, /분당 30번.*1분쯤 뒤/); assert.equal(explain(HANDLE_OPS.create, err(429, 'RATE_LIMITED')).kind, 'limit');
  assert.match(explain(HANDLE_OPS.delete, err(429, 'RATE_LIMITED')).text, /분당 60번/); assert.match(explain(HANDLE_OPS.write, err(429, 'RATE_LIMITED')).text, /분당 30번/);
  assert.equal(explain(HANDLE_OPS.create, err(403, 'DELEGATION_NOT_OPEN')).kind, 'closed'); assert.equal(explain(HANDLE_OPS.create, err(403, 'FORBIDDEN')).kind, 'denied');
  assert.equal(explain(HANDLE_OPS.delete, err(404, 'NOT_FOUND')).kind, 'gone'); assert.equal(explain(HANDLE_OPS.create, err(401, 'X')).kind, 'session'); assert.equal(isLimited(err(429)), true); assert.equal(isLimited(err(500)), false);
  assert.deepEqual(LIMITS, { [HANDLE_OPS.create]: 30, [HANDLE_OPS.delete]: 60, [HANDLE_OPS.write]: 30 });
});

test('create · delete — 입력 모양, 429 는 error.explain 으로', async () => {
  const calls = []; let fail = null;
  const terra = { invoke: async (op, inp) => { calls.push([op, inp]); if (fail) throw fail; return { handle_id: 'h1', state: 'requested' }; } };
  const H = createSviHandles(terra);
  assert.equal((await H.create({ resource_id: 'r', endpoint_id: 'in', operation: 'write', qos: 'reliable_ordered' })).handle_id, 'h1');
  assert.equal(calls[0][0], HANDLE_OPS.create); assert.deepEqual(Object.keys(calls[0][1]).sort(), ['endpoint_id', 'idempotency_key', 'operation', 'qos_profile', 'resource_id', 'ttl_seconds']); assert.equal(calls[0][1].operation, 'write');
  await H.delete('h1'); assert.deepEqual(calls[1], [HANDLE_OPS.delete, { handle_id: 'h1' }]);
  fail = err(429, 'RATE_LIMITED');
  await assert.rejects(() => H.create({ resource_id: 'r', endpoint_id: 'in' }), (e) => e.explain.kind === 'limit' && /분당 30번/.test(e.explain.text));
  await assert.rejects(() => H.delete('h1'), (e) => /분당 60번/.test(e.explain.text));
});

test('openWriter — 프레임은 { sequence, data(base64) }, 순번은 1 부터, 거부 · 닫힘을 알리고, 429 는 던진다', async () => {
  const sent = []; let hh = null, closed = 0;
  const terra = { invoke: async () => ({}), streamIO: async (op, inp, h) => { assert.equal(op, HANDLE_OPS.write); assert.deepEqual(inp, { handle_id: 'h1' }); hh = h; return { send: (v) => sent.push(v), close: () => closed++ }; } };
  const H = createSviHandles(terra), rej = [], cl = []; const w = await H.openWriter('h1', { onReject: (m) => rej.push(m), onClose: () => cl.push(1) });
  assert.equal(w.send('hi'), 1); assert.equal(w.send([1, 2, 255]), 2); assert.deepEqual(sent, [{ sequence: 1, data: Buffer.from('hi').toString('base64') }, { sequence: 2, data: Buffer.from([1, 2, 255]).toString('base64') }]);
  hh.onMessage(JSON.stringify({ kind: 'error', code: 'HANDLE_NOT_WRITABLE' })); assert.equal(rej[0].code, 'HANDLE_NOT_WRITABLE');
  w.close(); assert.equal(closed, 1); assert.equal(cl.length, 1); assert.throws(() => w.send('x'), /닫힘/);
  const limited = createSviHandles({ invoke: async () => ({}), streamIO: async () => { throw err(429, 'RATE_LIMITED'); } });
  await assert.rejects(() => limited.openWriter('h1'), (e) => e.explain.kind === 'limit' && /write 소켓 열기 — 요청 한도 초과 \(분당 30번\)/.test(e.explain.text));
  await assert.rejects(() => createSviHandles({ invoke: async () => ({}) }).openWriter('h1'), (e) => e.explain.kind === 'closed');
});

test('createSviWatch — 429 는 다시 붙지 않고 한도 안내를 보인다', async () => {
  const msgs = [], terra = { invoke: async () => { throw err(429, 'RATE_LIMITED'); }, stream: async () => () => {} };
  createSviWatch(terra, { setTimeout: () => assert.fail('한도에서 다시 부르면 안 된다') }).open({ resource_id: 'r', endpoint_id: 'e' }, (m) => msgs.push(m));
  await new Promise((r) => setTimeout(r, 0)); assert.equal(msgs.at(-1).conn, 'error'); assert.match(msgs.at(-1).why, /한도 초과.*1분쯤 뒤/);
});

// 위임 표(master-delegated.json)는 이 PR 이 다시 뽑지 않는다(Terra #429 병합 뒤 따로) — 시험 안에서 열린 것처럼 흉내
test('문 — 위임 표에 없으면 잠그고, 있으면(흉내) 열린다', () => {
  const ops = [HANDLE_OPS.create, HANDLE_OPS.write, HANDLE_OPS.delete];
  const added = ops.filter((op) => !MD.operations[op]);
  if (added.length) assert.equal(gateAll(ops).open, false);
  try { for (const op of added) MD.operations[op] = { permissions: [] }; assert.equal(gateAll(ops).open, true); } finally { for (const op of added) delete MD.operations[op]; }
});
