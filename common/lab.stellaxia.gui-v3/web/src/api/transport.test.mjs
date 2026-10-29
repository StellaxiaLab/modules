// node --test — B 모드: 자격 핸들 로그인 · Gateway 전송(로컬 · 원격 · 노드 묶기 · 보기 상태)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerra, TerraError } from './terra.js';
import { createSession } from './session.js';
import { createGatewayTransport } from './transport.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('session — 핸들만 받고(토큰 아님), 실패는 화면 말로, 로그아웃은 Gateway 에서도 폐기', async () => {
  const calls = [];
  const fetch = async (path, init) => { calls.push([init.method, path, init.headers && init.headers.authorization, init.body && JSON.parse(init.body)]);
    if (init.method === 'DELETE') return J(200, { status: 'ok', data: { revoked: true } });
    const b = JSON.parse(init.body); return b.password === 'pw' ? J(200, { status: 'ok', data: { handle: 'h-1', session: { principal: 'u1', displayName: '나' } } }) : J(401, { status: 'error', error: { code: 'CREDENTIAL_REJECTED', message: 'rejected' } }); };
  const st = mem(), S = createSession({ fetch, storage: st });
  await assert.rejects(S.login('a@b', 'no'), (e) => e instanceof TerraError && e.code === 'CREDENTIAL_REJECTED' && /맞지 않아요/.test(e.message));
  assert.equal(S.authorization(), null);
  await S.login('a@b', 'pw');
  assert.equal(S.authorization(), 'Handle h-1'); assert.equal(S.who.displayName, '나');
  assert.match(st.getItem('terra.handle'), /h-1/);   // 이 탭에만
  assert.equal(createSession({ fetch, storage: st }).authorization(), 'Handle h-1');   // 새로 고침해도 그 탭이면
  await S.logout();
  assert.equal(S.authorization(), null); assert.equal(st.getItem('terra.handle'), null);
  assert.deepEqual(calls.at(-1).slice(0, 3), ['DELETE', '/api/v1/auth/credentials', 'Handle h-1']);
  const N = createSession({ fetch: async () => { throw new TypeError('fail'); }, storage: mem() });
  await assert.rejects(N.login('a', 'b'), { code: 'NETWORK' });
});

test('terra — Handle 을 싣고, 502 · 504 는 분할로 읽을 이름, details.via 는 그대로', async () => {
  const seen = [];
  const fetch = async (path, init) => { seen.push(init.headers.authorization);
    if (path.includes('/nodes/far/')) return J(409, { status: 'error', error: { code: 'DELEGATION_REQUIRED', message: 'x', details: { via: 'nd-mid' } } });
    if (path.includes('/nodes/gone/')) return new Response('bad gateway', { status: 502 });
    return J(200, { status: 'ok', data: 1 }); };
  const T = createTerra({ fetch, authorization: () => 'Handle h', token: () => 'tk' });
  await T.invoke('terra.daemon.status.get');
  assert.equal(seen[0], 'Handle h');   // 핸들이 있으면 Bearer 대신
  await assert.rejects(T.invoke('terra.daemon.status.get', {}, { node: 'far' }), (e) => e.code === 'DELEGATION_REQUIRED' && e.via === 'nd-mid');
  await assert.rejects(T.invoke('terra.daemon.status.get', {}, { node: 'gone' }), (e) => e.code === 'GATEWAY_UNREACHABLE' && e.retryable);
  const D = createTerra({ fetch: async () => { throw new TypeError('down'); } });
  await assert.rejects(D.invoke('x'), { code: 'NETWORK' });
});

test('transport — 장면 노드 묶기: 로컬은 로컬 길, 나머지는 Master 노드 이름으로, 없으면 NODE_UNMAPPED', async () => {
  const calls = [];
  const fetch = async (path, init) => { calls.push([init.method, path, init.body ? JSON.parse(init.body) : null]);
    if (path.endsWith('/terra.master.nodes.get/invoke')) return J(200, { status: 'ok', data: { nodes: [{ node_id: 'nd_b', display_name: '01.01·b' }] } });
    if (path.startsWith('/api/v1/me/documents')) return J(200, { status: 'ok', data: init.method === 'GET' ? { documents: [{ key: 'view/desk.A', value: { wins: { term: {} } } }] } : { revision: 1 } });
    return J(200, { status: 'ok', data: { path } }); };
  const T = createTerra({ fetch, authorization: () => 'Handle h' }), tp = createGatewayTransport({ terra: T, storage: mem(), saveMs: 0 });
  tp.bindScene('A', [{ id: 'A', name: '01.01·a' }, { id: 'B', name: '01.01·b' }, { id: 'C', name: '01.01·c' }]);
  assert.equal(tp.localId(), 'A');
  assert.deepEqual(await tp.invoke('A', 'terra.daemon.modules.get', {}), { path: '/api/v1/operations/terra.daemon.modules.get/invoke' });
  assert.deepEqual(await tp.invoke('B', 'terra.daemon.modules.get', {}), { path: '/api/v1/nodes/nd_b/operations/terra.daemon.modules.get/invoke' });
  await assert.rejects(tp.invoke('C', 'terra.daemon.modules.get', {}), { code: 'NODE_UNMAPPED' });
  assert.equal(calls.filter((c) => c[1].includes('master.nodes.get')).length, 1);   // 노드 목록은 한 번만
  assert.deepEqual(await tp.invoke('B', 'gui-v3.desk.patch', {}), { ok: true, local: true });   // 화면 안 초안은 보내지 않는다
  await tp.master('B', 'terra.master.nodes.by-node-id.modules.get');
  assert.deepEqual(calls.at(-1).slice(1), ['/api/v1/operations/terra.master.nodes.by-node-id.modules.get/invoke', { node_id: 'nd_b' }]);
  // 보기 상태 — 계정 문서에서 미리 받고, 쓰면 계정에 덮어 쓴다
  assert.equal(await tp.ready(), true);
  assert.deepEqual(tp.loadView('desk.A'), { wins: { term: {} } });
  tp.saveView('desk.B', { wins: {} }); await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.at(-1), ['PUT', '/api/v1/me/documents/gui-v3/view/desk.B', { value: { wins: {} }, force: true }]);
});

test('transport — 로그인 전이면 부르지 않는다', async () => {
  let n = 0; const T = createTerra({ fetch: async () => { n++; return J(200, { status: 'ok', data: {} }); } });
  const tp = createGatewayTransport({ terra: T, authed: () => false, storage: mem() }); tp.bindScene('A', []);
  await assert.rejects(tp.invoke('A', 'terra.daemon.modules.get', {}), { code: 'UNAUTHENTICATED' });
  await assert.rejects(tp.master('B', 'terra.master.nodes.by-node-id.get'), { code: 'UNAUTHENTICATED' });
  assert.equal(n, 0);
});
