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
  await assert.rejects(S.login('a@b', 'no'), (e) => e instanceof TerraError && e.code === 'CREDENTIAL_REJECTED' && /불일치/.test(e.message));
  assert.equal(S.authorization(), null);
  await S.login('a@b', 'pw');
  assert.equal(S.authorization(), 'Handle h-1'); assert.equal(S.who.displayName, '나');
  assert.match(st.getItem('terra.handle'), /h-1/);   // 이 탭에만
  assert.equal(createSession({ fetch, storage: st }).authorization(), 'Handle h-1');   // 새로 고침해도 그 탭이면
  await S.logout();
  assert.equal(S.authorization(), null); assert.equal(st.getItem('terra.handle'), null);
  assert.deepEqual(calls.at(-1).slice(0, 3), ['DELETE', '/api/v1/auth/credentials', 'Handle h-1']);
  const N = createSession({ fetch: async () => { throw new TypeError('fail'); } });
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
    return J(200, { status: 'ok', data: { path } }); };
  const T = createTerra({ fetch, authorization: () => 'Handle h' }), tp = createGatewayTransport({ terra: T });
  tp.bindScene('A', [{ id: 'A', name: '01.01·a' }, { id: 'B', name: '01.01·b' }, { id: 'C', name: '01.01·c' }]);
  assert.equal(tp.localId(), 'A');
  assert.deepEqual(await tp.invoke('A', 'terra.daemon.modules.get', {}), { path: '/api/v1/operations/terra.daemon.modules.get/invoke' });
  assert.deepEqual(await tp.invoke('B', 'terra.daemon.modules.get', {}), { path: '/api/v1/nodes/nd_b/operations/terra.daemon.modules.get/invoke' });
  await assert.rejects(tp.invoke('C', 'terra.daemon.modules.get', {}), { code: 'NODE_UNMAPPED' });
  assert.equal(calls.filter((c) => c[1].includes('master.nodes.get')).length, 1);   // 노드 목록은 한 번만
  await assert.rejects(tp.invoke('B', 'gui-v3.desk.patch', {}), (e) => e instanceof TerraError && e.code === 'OP_UNSUPPORTED' && e.status === 501);   // 모르는 gui-v3.* 쓰기는 가짜 성공 대신 거절
  await tp.master('B', 'terra.master.nodes.by-node-id.modules.get');
  assert.deepEqual(calls.at(-1).slice(1), ['/api/v1/operations/terra.master.nodes.by-node-id.modules.get/invoke', { node_id: 'nd_b' }]);
  // Master 쓰기는 노드로 중계하지 않는다 — 로컬 Gateway 로, 그 노드의 Master id 를 실어
  await tp.invoke('B', 'terra.master.nodes.by-node-id.modules.assignments.post', { module_id: 'io.terra.agent', version: '0.6.2' });
  assert.deepEqual(calls.at(-1).slice(1), ['/api/v1/operations/terra.master.nodes.by-node-id.modules.assignments.post/invoke', { module_id: 'io.terra.agent', version: '0.6.2', node_id: 'nd_b' }]);
  // 보기 상태는 계정 문서로 가지 않는다 — 저장 · 미리 받기 · 보기 읽기 함수가 전송에 없다(제어기의 PC 상태는 이 브라우저, 바탕 구성은 invokeRid 로 그 노드에)
  for (const f of ['saveView', 'loadView', 'ready']) assert.equal(tp[f], undefined, f + ' 가 남아 있다');
  assert.ok(!calls.some((c) => c[1].includes('/me/documents')), '계정 문서를 부르면 안 된다');
});

test('transport — 로그인 전이면 부르지 않는다', async () => {
  let n = 0; const T = createTerra({ fetch: async () => { n++; return J(200, { status: 'ok', data: {} }); } });
  const tp = createGatewayTransport({ terra: T, authed: () => false }); tp.bindScene('A', []);
  await assert.rejects(tp.invoke('A', 'terra.daemon.modules.get', {}), { code: 'UNAUTHENTICATED' });
  await assert.rejects(tp.master('B', 'terra.master.nodes.by-node-id.get'), { code: 'UNAUTHENTICATED' });
  assert.equal(n, 0);
});

test('transport — 로컬 노드의 Master id 는 Daemon status 에서, 등록 전이면 NODE_NOT_ENROLLED', async () => {
  const calls = []; let nid = 'nd_a';
  const fetch = async (path, init) => { calls.push([path, init.body ? JSON.parse(init.body) : null]);
    if (path.endsWith('/terra.daemon.status.get/invoke')) return J(200, { status: 'ok', data: { daemon: { node_id: nid } } });
    return J(200, { ok: true, data: {} }); };
  const T = createTerra({ fetch, authorization: () => 'Handle h' }), tp = createGatewayTransport({ terra: T });
  tp.bindScene('A', [{ id: 'A', name: 'a' }]);
  await tp.invoke('A', 'terra.master.nodes.by-node-id.modules.assignments.by-module-id.delete', { module_id: 'm' });
  assert.deepEqual(calls.at(-1), ['/api/v1/operations/terra.master.nodes.by-node-id.modules.assignments.by-module-id.delete/invoke', { module_id: 'm', node_id: 'nd_a' }]);
  await tp.invoke('A', 'terra.master.nodes.get', {});   // by-node-id 가 아닌 Master op 에는 싣지 않는다
  assert.deepEqual(calls.at(-1), ['/api/v1/operations/terra.master.nodes.get/invoke', {}]);
  nid = ''; const tp2 = createGatewayTransport({ terra: T }); tp2.bindScene('A', []);
  await assert.rejects(tp2.invoke('A', 'terra.master.nodes.by-node-id.modules.assignments.post', { module_id: 'm' }), { code: 'NODE_NOT_ENROLLED' });
});

test('transport.invokeRid — localRid 와 같으면 로컬 길, 다르면 노드 길, signal 을 싣는다', async () => {
  const calls = [], fetch = async (path, init) => { calls.push([path, init.signal, JSON.parse(init.body)]); return J(200, { status: 'ok', data: { path } }); };
  const T = createTerra({ fetch, authorization: () => 'Handle h' }), ac = new AbortController();
  const tp = createGatewayTransport({ terra: T, localRid: () => 'nd_local' });
  await tp.invokeRid('nd_local', 'lab.stellaxia.gui-v3.node-desk.get', { since_revision: 3 }, { signal: ac.signal });
  assert.deepEqual(calls.at(-1), ['/api/v1/operations/lab.stellaxia.gui-v3.node-desk.get/invoke', ac.signal, { since_revision: 3 }]);
  await tp.invokeRid('nd_far', 'lab.stellaxia.gui-v3.node-desk.get', {}, { signal: ac.signal });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['/api/v1/nodes/nd_far/operations/lab.stellaxia.gui-v3.node-desk.get/invoke', ac.signal]);
  await tp.invokeRid('nd_far', 'lab.stellaxia.gui-v3.node-desk.patch');   // 입력 · opts 없어도
  assert.deepEqual(calls.at(-1)[2], {});
});

test('transport.invokeRid — Tree Gateway(localRid 가 빈 문자열)는 노드 길 · rid 가 비면 NO_NODE · 로그인 전이면 부르지 않는다', async () => {
  const calls = [], fetch = async (path) => { calls.push(path); return J(200, { status: 'ok', data: {} }); }, T = createTerra({ fetch, authorization: () => 'Handle h' });
  const tree = createGatewayTransport({ terra: T, localRid: () => '' });   // Tree Gateway — 지도 localId 가 비어 있다
  await tree.invokeRid('nd_server', 'lab.stellaxia.gui-v3.node-desk.get', {});
  assert.deepEqual(calls, ['/api/v1/nodes/nd_server/operations/lab.stellaxia.gui-v3.node-desk.get/invoke'], 'Daemon 인스턴스로 간다');
  await assert.rejects(tree.invokeRid('', 'lab.stellaxia.gui-v3.node-desk.get', {}), (e) => e instanceof TerraError && e.code === 'NO_NODE');
  const none = createGatewayTransport({ terra: T });   // localRid 옵션이 없어도 같다 — 로컬로 착각하지 않는다
  await none.invokeRid('nd_x', 'lab.stellaxia.gui-v3.node-desk.get', {}); assert.match(calls.at(-1), /^\/api\/v1\/nodes\/nd_x\//);
  const n = calls.length, off = createGatewayTransport({ terra: T, authed: () => false, localRid: () => 'a' });
  await assert.rejects(off.invokeRid('a', 'x', {}), { code: 'UNAUTHENTICATED' }); assert.equal(calls.length, n);
});
