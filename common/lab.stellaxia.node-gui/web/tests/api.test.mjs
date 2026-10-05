// 연동 층 단위 시험 — 브라우저 없이 node --test 로 돈다 (npm test).
// frame 안에서 실제 게이트웨이와 맞물리는 것은 실측으로 확인했다(모듈 README "검증").
// 여기서 지키는 것은 그때 드러난 결함이 다시 생기지 않는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TerraClient, toResult, resultText, fillRoute, RELAY_OP, NODE_CATALOG_OP } from '../src/api/client.js';
import { fileBinding } from '../src/api/operations.js';
import { LiveSource, fillNode } from '../src/api/source.js';
import { frameRole } from '../src/api/frame-boot.js';
import { pageOf } from '../src/api/frame-boards.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 부른 것을 적어 두는 가짜 fetch */
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, init }); return answer(url, init); };
  f.calls = calls;
  return f;
}

const catalog = (ids) => json(200, { operations: ids.map((operationId) => ({ operationId })) });

test('Daemon 봉투 { status, data } 를 벗긴다', async () => {
  const r = await toResult(json(200, { status: 'ok', data: { devices: [{ id: 'd1' }] }, meta: {} }));
  assert.deepEqual(r, { kind: 'ok', data: { devices: [{ id: 'd1' }] } });
});

test('Master 봉투 { ok, data } 를 벗긴다', async () => {
  const r = await toResult(json(200, { ok: true, data: { nodes: [] }, meta: {} }));
  assert.deepEqual(r, { kind: 'ok', data: { nodes: [] } });
});

test('게이트웨이 오류 봉투의 code 가 이유가 된다 — "[object Object]" 가 아니다', async () => {
  const r = await toResult(json(404, { error: { code: 'MODULE_ROUTE_NOT_FOUND', message: '…', traceId: 't' } }));
  assert.equal(r.kind, 'error');
  assert.equal(r.reason, 'MODULE_ROUTE_NOT_FOUND');
  assert.match(resultText(r), /MODULE_ROUTE_NOT_FOUND$/);
});

test('접수(202 · accepted)는 작업 번호를 꺼낸다', async () => {
  const r = await toResult(json(202, { status: 'accepted', data: { task_id: 'T-1' } }));
  assert.deepEqual(r, { kind: 'accepted', job: 'T-1', data: { task_id: 'T-1' } });   // data — 전송 만들기(202)는 transfer 를 싣는다
});

test('invoke 는 주입한 fetch 로 상대 경로를 부르고 확인 헤더를 싣지 않는다', async () => {
  const f = fakeFetch((url) => (url.endsWith('/catalog') ? catalog(['terra.daemon.io.devices.get']) : json(200, { status: 'ok', data: { devices: [] } })));
  const client = new TerraClient('', { fetch: f, delegated: true });
  await client.refreshCatalog();
  const r = await client.invoke('terra.daemon.io.devices.get', { node_id: 'n' });
  assert.equal(r.kind, 'ok');
  const call = f.calls.at(-1);
  assert.equal(call.url, '/api/v1/operations/terra.daemon.io.devices.get/invoke');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, undefined);
  assert.equal(call.init.headers['X-Terra-Confirm'], undefined);
  assert.deepEqual(JSON.parse(call.init.body), { node_id: 'n' });
});

test('노드 주소 호출 길이 없는 게이트웨이(카탈로그에 없다)면 다른 노드를 부르지 않는다', async () => {
  const f = fakeFetch((url) => (url.endsWith('/api/v1/catalog') ? catalog(['terra.daemon.io.devices.get']) : json(200, {})));
  const client = new TerraClient('', { fetch: f });
  await client.refreshCatalog();
  const r = await client.invoke('terra.daemon.io.devices.get', {}, { node: 'node_b' });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'remote-node' });
  assert.equal(f.calls.length, 1, '카탈로그만 받았다');
});

test('위임 자격의 Master 401 은 "닿지 않음"으로 읽고, 다음부터는 부르지 않는다', async () => {
  const f = fakeFetch(() => json(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'authentication is required' } }));
  const client = new TerraClient('', { fetch: f, delegated: true });
  const first = await client.invoke('terra.master.svi.resources.get', {});
  assert.equal(first.kind, 'unavailable');
  assert.equal(first.reason, 'master-delegation');
  assert.match(resultText(first), /Master를 거치는 기능/);
  const second = await client.invoke('terra.master.nodes.get', {});
  assert.deepEqual(second, { kind: 'unavailable', reason: 'master-delegation' });
  assert.equal(f.calls.length, 1);
});

test('사용자 자격(단독 실행)의 401 은 그대로 "로그인이 필요하다"', async () => {
  const f = fakeFetch(() => json(401, { ok: false, error: { code: 'UNAUTHORIZED' } }));
  const client = new TerraClient('http://127.0.0.1:8790', { fetch: f });
  const r = await client.invoke('terra.master.nodes.get', {});
  assert.equal(r.kind, 'unauthenticated');
  assert.equal(client.masterBlocked, false);
});

test("'<노드>' 자리 표시자가 실제 노드를 덮지 않는다", async () => {
  assert.deepEqual(fillNode({ node_id: '<노드>', limit: 100 }, 'edge-01'), { node_id: 'edge-01', limit: 100 });
  assert.deepEqual(fillNode({ target_node_id: '<노드>', type: 'x' }, 'n2'), { target_node_id: 'n2', type: 'x' });
  const f = fakeFetch(() => json(200, { ok: true, data: { resources: [] } }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'edge-01' });
  await source.list('edge-01', 'svi');
  assert.equal(JSON.parse(f.calls[0].init.body).node_id, 'edge-01');
});

test('다른 노드의 Daemon 목록 — node_id 를 모르거나(tree 항목) 노드 주소 호출이 없는 게이트웨이면 부르지 않고 이유를 낸다', async () => {
  const f = fakeFetch(() => json(200, {}));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'edge-01' });
  await assert.rejects(source.list('tree-home', 'io'), (r) => r.kind === 'unavailable' && r.reason === 'no-node-id');
  assert.equal(f.calls.length, 0);
  // 카탈로그에 노드 주소 호출이 없는 게이트웨이
  const g = fakeFetch((url) => (url.endsWith('/api/v1/catalog') ? catalog(['terra.daemon.io.devices.get']) : json(200, {})));
  const c = new TerraClient('', { fetch: g });
  await c.refreshCatalog();
  const s2 = new LiveSource(c, { localNode: 'edge-01', idOf: (n) => ({ 'leaf-b': 'node_b' }[n]) });
  await assert.rejects(s2.list('leaf-b', 'io'), (r) => r.reason === 'remote-node');
  assert.equal(g.calls.length, 1, '카탈로그만 받았다');
  assert.match(s2.lockFor('io', 'approve', 'leaf-b'), /노드 주소 호출이 없다/);
});

test('다른 노드 — 노드 주소 호출(B-1): 그 노드 카탈로그를 받아(60초) 연 것만 /api/v1/nodes/{node_id}/operations/{id}/invoke 로. 대상의 봉투가 그대로 온다', async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith('/api/v1/catalog')) return catalog([RELAY_OP, NODE_CATALOG_OP, 'terra.daemon.io.devices.get']);
    if (url === '/api/v1/nodes/node_b/catalog') return json(200, { nodeId: 'node_b', generation: 3, operations: [
      { operationId: 'terra.daemon.io.devices.get', allowed: true }, { operationId: 'terra.daemon.io.devices.by-device-id.approve.post', allowed: false },
      { operationId: 'terra.daemon.modules.by-module-id.logs.get', allowed: true }] });
    if (url === '/api/v1/nodes/node_b/operations/terra.daemon.io.devices.get/invoke') return json(200, { status: 'ok', data: { devices: [{ id: 'd9', kind: 'camera', presence: 'present', approval: 'approved', enabled: true }] }, meta: {} });
    if (url === '/api/v1/nodes/node_b/operations/terra.daemon.modules.by-module-id.logs.get/invoke') return json(200, { status: 'ok', data: { module_id: 'm1', lines: [{ at: 't', stream: 'stdout', text: 'ready' }, { at: 't', stream: 'stderr', text: 'warn' }], truncated: false }, meta: {} });
    if (url === '/api/v1/nodes/node_c/catalog') return json(200, { nodeId: 'node_c', operations: [{ operationId: 'terra.daemon.io.devices.get', allowed: true }] });
    if (url === '/api/v1/nodes/node_c/operations/terra.daemon.io.devices.get/invoke') return json(409, { ok: false, error: { code: 'NODE_OFFLINE', message: 'offline' } });
    return json(404, {});
  });
  const client = new TerraClient('', { fetch: f });
  await client.refreshCatalog();
  const source = new LiveSource(client, { localNode: 'edge-01', idOf: (n) => ({ 'leaf-b': 'node_b', 'leaf-c': 'node_c' }[n]) });
  const items = await source.list('leaf-b', 'io');
  assert.deepEqual(items.map((x) => x.id), ['d9']);
  const urls = f.calls.map((c) => c.url);
  assert.deepEqual(urls.slice(1), ['/api/v1/nodes/node_b/catalog', '/api/v1/nodes/node_b/operations/terra.daemon.io.devices.get/invoke'], '카탈로그 한 번 · 그다음 노드 주소 호출');
  assert.equal(f.calls[2].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[2].init.body), {}, '본문에 node_id 를 싣지 않는다 — 노드는 경로에 있다');
  // 누르기 전 자물쇠 — 그 노드가 연 것 · 막은 것 · 열지 않은 것
  assert.equal(source.lockFor('io', 'scan', 'leaf-b'), resultText({ kind: 'unavailable', reason: 'not-remote' }));
  assert.equal(source.lockFor('io', 'approve', 'leaf-b'), resultText({ kind: 'forbidden', reason: 'remote-denied' }));
  assert.equal(source.lockFor('mod', 'log', 'leaf-b'), null, '모듈 로그는 그 노드 Daemon 의 것으로(remote)');
  // 막힌 것은 누르면 부르지 않는다
  const n = f.calls.length;
  const r = await source.act('leaf-b', 'io', 'd9', 'approve', { id: 'd9' });
  assert.deepEqual([r.kind, r.reason, f.calls.length], ['forbidden', 'remote-denied', n]);
  // 모듈 로그 — 다른 노드는 Daemon 의 로그 op(줄은 { at, stream, text })
  const lg = await source.act('leaf-b', 'mod', 'm1', 'log', { id: 'm1', name: 'm1' });
  assert.equal(f.calls.at(-1).url, '/api/v1/nodes/node_b/operations/terra.daemon.modules.by-module-id.logs.get/invoke');
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body), { module_id: 'm1' });
  assert.match(lg.say, /m1 · ! warn/);
  // 카탈로그는 60초 동안 다시 받지 않는다
  await source.list('leaf-b', 'io');
  assert.equal(f.calls.filter((c) => c.url === '/api/v1/nodes/node_b/catalog').length, 1);
  // Master 의 길 오류는 코드 그대로 — 화면 글로
  const off = await source.list('leaf-c', 'io').catch((e) => e);
  assert.deepEqual([off.kind, off.status, off.reason], ['error', 409, 'NODE_OFFLINE']);
  assert.match(resultText(off), /오프라인/);
});

test('경로 채우기(fillRoute) — {name} 자리 · GET · DELETE 는 query · 그 밖은 본문 · {name...} 은 / 를 살린다 · 못 채우면 missing', () => {
  assert.deepEqual(fillRoute('GET', '/api/modules/io.terra.file/v1/entries', { root: 'share-0', path: 'a b/c' }), { path: '/api/modules/io.terra.file/v1/entries?root=share-0&path=a%20b%2Fc', body: undefined, missing: null });
  assert.deepEqual(fillRoute('PUT', '/x/transfers/{transfer_id}/chunks', { transfer_id: 'tr 1', offset: 0, data: 'QQ==' }), { path: '/x/transfers/tr%201/chunks', body: { offset: 0, data: 'QQ==' }, missing: null });
  assert.equal(fillRoute('GET', '/x/{key...}', { key: 'a/b c' }).path, '/x/a/b%20c');
  assert.equal(fillRoute('POST', '/x/{transfer_id}/complete', {}).missing, 'transfer_id');
  assert.deepEqual(fileBinding('io.terra.file.transfers.pulls.create'), { method: 'POST', path: '/api/modules/io.terra.file/v1/transfers/pulls' });
  assert.equal(fileBinding('terra.daemon.io.devices.get'), null);
});

test('다른 노드의 공유 폴더 안 · 전송 — 모듈 op 는 원격 모듈 경로 /api/nodes/{node_id}/modules/io.terra.file/v1/… (카탈로그 bindings, 없으면 대응표)', async () => {
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/api/v1/catalog')) return json(200, { operations: [{ operationId: RELAY_OP }, { operationId: NODE_CATALOG_OP }, { operationId: 'terra.daemon.files.list.get' },
      { operationId: 'io.terra.file.entries.list', bindings: ['GET /api/modules/io.terra.file/v1/entries'] }] });
    if (url === '/api/v1/nodes/node_b/catalog') return json(200, { nodeId: 'node_b', operations: [{ operationId: 'terra.daemon.files.list.get', allowed: true }] });
    if (url === '/api/v1/nodes/node_b/operations/terra.daemon.files.list.get/invoke') return json(200, { status: 'ok', data: { roots: [{ name: 'share-0' }] }, meta: {} });
    if (url.startsWith('/api/nodes/node_b/modules/io.terra.file/v1/entries')) return json(200, { count: 1, entries: [{ path: 'docs/a.txt', name: 'a.txt', size: 3, is_dir: false }] });
    if (url === '/api/nodes/node_b/modules/io.terra.file/v1/transfers' && init.method === 'POST') return json(202, { transfer: { transfer_id: 'tr-9', chunk_size: 4, offset: 0 } });
    if (url === '/api/nodes/node_b/modules/io.terra.file/v1/transfers/tr-9/chunks') return json(200, { next_offset: 3 });
    if (url === '/api/nodes/node_b/modules/io.terra.file/v1/transfers/tr-9/complete') return json(200, { transfer_id: 'tr-9', verified: true });
    return json(404, { error: { code: 'NOT_FOUND' } });
  });
  const client = new TerraClient('', { fetch: f });
  await client.refreshCatalog();
  const source = new LiveSource(client, { localNode: 'edge-01', idOf: (n) => ({ 'leaf-b': 'node_b' }[n]) });
  const items = await source.list('leaf-b', 'folder', { path: 'share-0/docs' });
  assert.ok(items.some((x) => x.id === 'share-0/docs/a.txt'), '들어간 폴더의 항목이 원격 모듈 경로로 왔다');
  const ent = f.calls.find((c) => c.url.startsWith('/api/nodes/node_b/modules/io.terra.file/v1/entries'));
  assert.equal(ent.init.method, 'GET');
  assert.match(ent.url, /root=share-0/);
  assert.equal(source.lockFor('folder', 'del', 'leaf-b'), null, '모듈 경로를 알면 잠그지 않는다');
  // 올리기 — 카탈로그에 bindings 가 없는 op 는 대응표(fileBinding)로
  const up = await source.upload('leaf-b', new File(['abc'], 'n.txt'), 'share-0');
  assert.equal(up.kind, 'ok');
  const put = f.calls.find((c) => c.url.endsWith('/transfers/tr-9/chunks'));
  assert.equal(put.init.method, 'PUT');
  assert.deepEqual(Object.keys(JSON.parse(put.init.body)).sort(), ['data', 'offset'], '경로 자리(transfer_id)는 본문에서 뺀다');
  assert.ok(!f.calls.some((c) => /\/api\/v1\/nodes\/node_b\/operations\/io\.terra\.file/.test(c.url)), '모듈 op 는 노드 주소 호출로 부르지 않는다');
  // Master 에 닿지 않는 자격이면 중계도 없다
  client.masterBlocked = true;
  assert.match(source.lockFor('folder', 'del', 'leaf-b'), /Master/);
});

test('frame 안인지 가린다 — 다른 origin 부모 · 같은 origin 부모(보드) · 단독', () => {
  const top = {}; top.parent = top;
  assert.equal(frameRole(top), 'standalone');
  assert.equal(frameRole(undefined), 'standalone');
  const crossOrigin = { parent: { get document() { throw new Error('SecurityError'); } } };
  assert.equal(frameRole(crossOrigin), 'frame');
  const sameOrigin = { parent: { document: {} } };
  assert.equal(frameRole(sameOrigin), 'board');
});

test('보드 링크에서 페이지 이름을 꺼낸다', () => {
  assert.equal(pageOf('building.html'), 'building.html');
  assert.equal(pageOf('./network.html#mesh'), 'network.html');
  assert.equal(pageOf('http://app-x.localhost:8787/api/v1/gui/apps/x/files/node.html'), 'node.html');
  assert.equal(pageOf('https://example.com/'), null);
  assert.equal(pageOf(''), null);
});
