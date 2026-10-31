import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from './session.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const gw = (handle) => async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', data: { handle, session: { principal: 'u' } } }) });

test('Gateway 가 handle 을 객체로 줘도 헤더에는 id 만 간다 (Handle [object Object] 회귀)', async () => {
  const s = createSession({ fetch: gw({ id: 'h-1', issuer: 'gateway', expiresAt: 'x' }), storage: mem() });
  await s.login('a@b', 'pw');
  assert.equal(s.handle, 'h-1');
  assert.equal(s.authorization(), 'Handle h-1');
});

test('문자열 handle 도 받고, 탭 저장본(옛 객체)도 id 로 읽는다', async () => {
  const st = mem();
  await createSession({ fetch: gw('h-2'), storage: st }).login('a@b', 'pw');
  assert.equal(createSession({ storage: st }).authorization(), 'Handle h-2');
  st.setItem('terra.handle', JSON.stringify({ handle: { id: 'h-3' }, session: {} }));
  assert.equal(createSession({ storage: st }).authorization(), 'Handle h-3');
});
