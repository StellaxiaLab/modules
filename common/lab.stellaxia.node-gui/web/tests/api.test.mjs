// 연동 층 단위 시험 — 브라우저 없이 node --test 로 돈다 (npm test).
// frame 안에서 실제 게이트웨이와 맞물리는 것은 실측으로 확인했다(모듈 README "검증").
// 여기서 지키는 것은 그때 드러난 결함이 다시 생기지 않는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TerraClient, toResult, resultText, takeEvents } from '../src/api/client.js';
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
  assert.deepEqual(r, { kind: 'accepted', job: 'T-1' });
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

test('다른 노드는 부르지 않는다 — 게이트웨이에 operation 원격 경로가 없다', async () => {
  const f = fakeFetch(() => json(200, {}));
  const client = new TerraClient('', { fetch: f });
  const r = await client.invoke('terra.daemon.io.devices.get', {}, { node: 'tree-home' });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'remote-node' });
  assert.equal(f.calls.length, 0);
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

test('로컬이 아닌 노드의 Daemon 목록은 부르지 않고 이유를 낸다', async () => {
  const f = fakeFetch(() => json(200, {}));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'edge-01' });
  await assert.rejects(source.list('tree-home', 'io'), (r) => r.kind === 'unavailable' && r.reason === 'remote-node');
  assert.equal(f.calls.length, 0);
});

test('SSE 조각에서 끝난 이벤트만 꺼낸다', () => {
  let rest = '';
  const out = takeEvents('data: {"a":1}\n\ndata: {"b"', (r) => { rest = r; });
  assert.deepEqual(out, ['{"a":1}']);
  assert.equal(rest, 'data: {"b"');
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
