// node --test — approveOp : 승인 문 위의 얇은 층 + frame 클라이언트 approve() 메시지
import test from 'node:test';
import assert from 'node:assert/strict';
import { approveOp } from './approve.js';
import { connectTerra, FRAME_APPROVE, FRAME_APPROVAL } from './terra-frame-client.js';

const OP = 'terra.master.network.mesh.wireguard.reconcile.post';

test('frame 이 없으면 APPROVAL_UNAVAILABLE — 던지지 않는다', async () => {
  for (const f of [null, undefined, {}]) {
    const r = await approveOp(f, OP, {});
    assert.equal(r.ok, false); assert.equal(r.code, 'APPROVAL_UNAVAILABLE'); assert.equal(r.text, '승인 문 없음 — Terra 셸 안에서 열기');
  }
});

test('승인 — 결과 그대로, 입력은 복사해 보낸다', async () => {
  const seen = []; const inputs = { cluster_id: 'c-01' };
  const frame = { approve: async (r) => { seen.push(r); return { ok: true, status: 200, data: { done: 1 }, withheld: [] }; } };
  const r = await approveOp(frame, OP, inputs);
  assert.deepEqual(r, { ok: true, status: 200, data: { done: 1 }, withheld: [] });
  assert.equal(seen[0].operationId, OP); assert.deepEqual(seen[0].inputs, inputs); assert.notEqual(seen[0].inputs, inputs);
});

test('만료 · 거절 · 던짐 — 표 문구 / 조용함', async () => {
  const mk = (x) => ({ approve: async () => x });
  assert.equal((await approveOp(mk({ ok: false, code: 'APPROVAL_EXPIRED', message: 'x' }), OP)).text, '승인 요청이 만료됨(5분) — 다시 누르기');
  assert.equal((await approveOp(mk({ ok: false, code: 'APPROVAL_DECLINED', message: '' }), OP)).text, '');
  const t = await approveOp({ approve: async () => { throw new Error('boom'); } }, OP); assert.equal(t.ok, false); assert.equal(t.code, 'APPROVAL_FAILED');
});

test('frame 클라이언트 — 승인 메시지 이름은 Terra 호스트와 같다', () => {
  assert.equal(FRAME_APPROVE, 'terra.frame.approve'); assert.equal(FRAME_APPROVAL, 'terra.frame.approval');
  assert.equal(typeof connectTerra, 'function');
});
