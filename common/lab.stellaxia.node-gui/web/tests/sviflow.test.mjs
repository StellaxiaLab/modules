// SVI 흐름도 (maingui A-28) — 자원 → 엔드포인트 → 쓰는 쪽(핸들 · 바인딩 · 허가) + 핸들 흐름 이벤트(SSE).
//   npm test
// 모양은 Terra main Master 계약에서 확인했다: svi.resources.get · svi.grants.get · svi.handles.get · svi.bindings.get → { items[…] } ·
// 허가 { grant_id, subject{ type, id }, resource_id, operations[], expires_at? }(routes_svi_grants.go sviGrantView — 기한이 없으면 expires_at 이 없다) ·
// 바인딩 { binding_id, source{ resource_id, endpoint_id }, target{…}, source_node_id, target_node_id, desired_state, observed_state, reason, qos_profile }(BindingView) ·
// 핸들 { handle_id, resource_id, endpoint_id, operation, node_id, state } · 흐름 이벤트 svi.handles.by-handle-id.events.get = SSE `event: status | frame`(StreamMessage)
// 앱 토큰은 Master 에 닿지 않아(PF-1) 진짜 스택의 이 모듈은 이 목록을 받지 못한다 — 닿을 때 맞게 그리는지를 여기서 지킨다
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource } = await import('../src/api/source.js');
const { ADAPT } = await import('../src/api/adapters.js');
const { HELM_APPS } = await import('../src/api/operations.js');
const { frameEvent } = await import('../src/api/events.js');
const { wireHelm } = await import('../src/api/wire.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) return false; await sleep(25); } return true; };

const RES = { resource_id: 'svi.node_a.cam1', node_id: 'node_a', kind: 'camera', display_name: 'cam1', status: 'available',
  endpoints: [{ endpoint_id: 'frames', direction: 'source', interaction: 'stream' }, { endpoint_id: 'snapshot', direction: 'source', interaction: 'read' }] };
const GRANTS = { items: [
  { grant_id: 'g1', subject: { type: 'node', id: 'node_b' }, resource_id: RES.resource_id, operations: ['read', 'subscribe'], created_at: '2026-10-05T10:00:00Z' },
  { grant_id: 'g2', subject: { type: 'user', id: 'u-kim' }, resource_id: RES.resource_id, operations: ['read'], created_at: '2026-10-05T10:00:00Z', expires_at: '2020-01-01T00:00:00Z' },
  { grant_id: 'g3', subject: { type: 'user', id: 'u-lee' }, resource_id: 'svi.node_a.other', operations: ['read'], created_at: '2026-10-05T10:00:00Z' }
] };
const HANDLES = { items: [
  { handle_id: 'svih_live', resource_id: RES.resource_id, endpoint_id: 'frames', operation: 'read', node_id: 'node_a', state: 'active' },
  { handle_id: 'svih_old', resource_id: RES.resource_id, endpoint_id: 'frames', operation: 'read', node_id: 'node_a', state: 'closed' }
] };
const BINDINGS = { items: [
  { binding_id: 'b1', source: { resource_id: RES.resource_id, endpoint_id: 'frames' }, target: { resource_id: 'svi.node_b.display' }, source_node_id: 'node_a', target_node_id: 'node_b',
    desired_state: 'active', observed_state: 'active', qos_profile: 'realtime' },
  { binding_id: 'b2', source: { resource_id: RES.resource_id, endpoint_id: 'snapshot' }, target: { resource_id: 'svi.node_c.store' }, source_node_id: 'node_a', target_node_id: 'node_c',
    desired_state: 'active', observed_state: 'preparing' },
  { binding_id: 'b9', source: { resource_id: 'svi.node_x.mic' }, target: { resource_id: 'svi.node_y.rec' }, source_node_id: 'node_x', target_node_id: 'node_y', observed_state: 'active' }
] };
const NAMES = { node_a: 'leaf-a', node_b: 'leaf-b' };
const nameOf = (id) => NAMES[id] || null;

test('ADAPT.svi — 흐름도(flow): 엔드포인트 전부 · 열린 핸들 · 이 자원의 바인딩 · 허가. 상대 노드는 이름으로, 닫힌 핸들은 빼고 카드의 handle 은 열린 것', () => {
  const [it] = ADAPT.svi({ items: [RES] }, { local: false, grants: GRANTS, handleList: HANDLES, bindings: BINDINGS, nameOf });
  assert.deepEqual([it.id, it.name, it.node, it.status, it.ep, it.epId, it.handle], [RES.resource_id, 'cam1', 'node_a', 'available', 'frames · source · stream', 'frames', 'svih_live']);
  assert.deepEqual(it.grant, ['read', 'subscribe'], '이 자원에 대한 허가의 동작을 모은다');
  assert.deepEqual(it.flow.eps, [{ id: 'frames', dir: 'source', inter: 'stream' }, { id: 'snapshot', dir: 'source', inter: 'read' }]);
  assert.deepEqual(it.flow.handles, [{ id: 'svih_live', who: '내 핸들', op: 'read', ep: 'frames', state: 'active', mine: true }]);
  assert.deepEqual(it.flow.binds, [
    { id: 'b1', ep: 'frames', to: 'leaf-b · svi.node_b.display', state: 'active', qos: 'realtime', reason: '' },
    { id: 'b2', ep: 'snapshot', to: 'node_c · svi.node_c.store', state: 'failed', qos: '', reason: '' }
  ]);
  assert.deepEqual(it.flow.grants, [{ id: 'g1', who: 'node:node_b', ops: 'read · subscribe', alive: true }, { id: 'g2', who: 'u-kim', ops: 'read', alive: false }]);
  // 이 노드의 자원은 내 것 · 핸들이 없으면 handle 은 null · 엔드포인트가 없으면 그렇다고(화면이 예시 엔드포인트를 지어내지 않게 flow 는 늘 있다)
  const [bare] = ADAPT.svi({ resources: [{ resource_id: 'r2', kind: 'camera', status: 'weird' }] }, { local: true });
  assert.deepEqual([bare.grant, bare.handle, bare.status, bare.ep], ['own', null, 'unavailable', '엔드포인트 없음']);
  assert.deepEqual(bare.flow, { eps: [], handles: [], binds: [], grants: [] });
});

test('ADAPT.grant — Master 의 답 모양(items · subject{type, id} · source{resource_id}) — 예전 키(grants · subject_id · source_resource_id)로는 비어 보였다', () => {
  const items = ADAPT.grant(GRANTS, { bindings: BINDINGS, nodeId: 'node_a', nameOf });
  const g = items.filter((x) => x.type === 'grant'), b = items.filter((x) => x.type === 'bind');
  assert.deepEqual(g.map((x) => [x.id, x.who, x.res, x.ops, x.ttl, x.alive]), [
    ['g1', 'node:node_b', RES.resource_id, 'read · subscribe', '기한 없음', true],
    ['g2', 'u-kim', RES.resource_id, 'read', '만료됨', false],
    ['g3', 'u-lee', 'svi.node_a.other', 'read', '기한 없음', true]
  ]);
  assert.deepEqual(b.map((x) => [x.id, x.from, x.to, x.state, x.reason]), [
    ['b1', RES.resource_id + '#frames', 'leaf-b · svi.node_b.display', 'active', ''],
    ['b2', RES.resource_id + '#snapshot', 'node_c · svi.node_c.store', 'failed', '원하는 상태 active · 지금 preparing']
  ], '이 노드에 닿는 바인딩만 · 상태는 화면 낱말(active · failed)로');
  assert.equal(ADAPT.grant({ items: [] }, { bindings: BINDINGS }).length, 3, 'node_id 를 모르면 거르지 않는다');
});

test('frameEvent — raw 면 data 를 벗기지 않는다(SVI 핸들 StreamMessage) · 기본은 신호 봉투의 data', () => {
  const msg = { kind: 'frame', sequence: 7, data: 'YWJj', schema_ref: 'video.frame' };
  assert.deepEqual(frameEvent({ id: '1', event: 'frame', data: JSON.stringify(msg) }, true), { id: '1', signal: 'frame', nodeId: undefined, data: msg });
  assert.deepEqual(frameEvent({ id: '2', event: 'terra.modules.changed', data: JSON.stringify({ signal: 'terra.modules.changed', data: { id: 'm' } }) }).data, { id: 'm' });
  assert.equal(HELM_APPS.svi.events.op, 'terra.master.svi.handles.by-handle-id.events.get');
});

/** Master 가 닿는다고 치고 — SVI 목록 넷 + 핸들 흐름 이벤트(SSE) */
function sviServer() {
  const calls = [];
  let streams = 0;
  const sse = (text) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const f = async (url, init = {}) => {
    const c = { url, op: opOf(url), body: init.body ? JSON.parse(init.body) : null, accept: (init.headers || {}).Accept };
    calls.push(c);
    if (c.op === 'terra.master.svi.resources.get') return json(200, { status: 'ok', data: { items: [RES] } });
    if (c.op === 'terra.master.svi.grants.get') return json(200, { status: 'ok', data: GRANTS });
    if (c.op === 'terra.master.svi.handles.get') return json(200, { status: 'ok', data: HANDLES });
    if (c.op === 'terra.master.svi.bindings.get') return json(200, { status: 'ok', data: BINDINGS });
    if (c.op === HELM_APPS.svi.events.op) {
      if (streams++) return json(404, { error: { code: 'SVI_HANDLE_NOT_FOUND', message: 'handle closed' } });
      return sse('event: status\ndata: {"kind":"status","state":"active"}\n\n'
        + 'event: frame\ndata: {"kind":"frame","sequence":1,"data":"YWJj","schema_ref":"video.frame"}\n\n'
        + 'event: status\ndata: {"kind":"status","state":"closed","reason":"lease ended"}\n\n');
    }
    return json(200, { status: 'ok', data: {} });
  };
  f.calls = calls;
  return f;
}

test('source.list(svi) — 허가 · 핸들 · 바인딩을 함께 받아 흐름도를 채운다 · 상대 노드는 nameOf 로', async () => {
  const f = sviServer();
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a', localId: 'node_a', nameOf });
  const [it] = await source.list('leaf-a', 'svi');
  assert.deepEqual(f.calls.map((c) => c.op), ['terra.master.svi.resources.get', 'terra.master.svi.grants.get', 'terra.master.svi.handles.get', 'terra.master.svi.bindings.get']);
  assert.equal(it.handle, 'svih_live');
  assert.deepEqual(it.flow.binds.map((b) => b.to), ['leaf-b · svi.node_b.display', 'node_c · svi.node_c.store']);
  assert.equal(it.grant, 'own', '이 노드의 자원');
});

test('wire — 흐름도에서 고른 자원에 열린 핸들이 있으면 그 핸들의 흐름 이벤트를 받아 state.sviEv 에(실시간). 끝나면 목록을 다시 받는다 · 끊으면 닫는다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  const local = s.state.localNode.name;
  const f = sviServer();
  const client = new TerraClient('', { fetch: f });
  s.__client = client;
  const source = new LiveSource(client, { localNode: local, localId: 'node_a', nameOf });
  const unwire = wireHelm(s, source, { pollMs: 60000 });
  try {
    s.setState({ fs: 'hb:svi', sviSel: RES.resource_id });
    assert.ok(await until(() => (s.hbItems(local, 'svi') || []).length === 1), '목록을 받았다');
    assert.ok(await until(() => { const E = (s.state.sviEv || {})[RES.resource_id]; return E && E.items.length >= 3; }), JSON.stringify(s.state.sviEv));
    const E = s.state.sviEv[RES.resource_id];
    assert.deepEqual([E.frames, E.bytes, E.live], [1, 3, true]);
    assert.deepEqual(E.items.slice(0, 3).map((x) => x.text), ['status · active', 'frame #1 · 3 B · video.frame', 'status · closed — lease ended']);
    const ev = f.calls.find((c) => c.op === HELM_APPS.svi.events.op);
    assert.deepEqual([ev.body, ev.accept], [{ handle_id: 'svih_live' }, 'text/event-stream']);
    assert.ok(await until(() => f.calls.filter((c) => c.op === 'terra.master.svi.resources.get').length >= 2), '핸들이 닫히자 목록을 다시 받았다');
    const view = s.sviEvView(RES.resource_id);
    assert.match(view.head, /프레임 1 · 3 B · ● 실시간 \(SSE\)/);
  } finally {
    unwire();
    clearInterval(s._hbX); clearTimeout(s._hbT);
  }
  assert.deepEqual(s.state.sviEv, {}, '끊으면 받은 흐름 이벤트를 지운다');
});

test('wire — 열린 핸들이 없거나 흐름 이벤트 op 가 카탈로그에 없으면(앱 토큰 — Master 밖) 열지 않는다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  const local = s.state.localNode.name;
  const f = sviServer();
  const client = new TerraClient('', { fetch: f });
  client.catalog = new Map([['terra.master.svi.resources.get', {}], ['terra.master.svi.grants.get', {}], ['terra.master.svi.handles.get', {}], ['terra.master.svi.bindings.get', {}]]);
  const source = new LiveSource(client, { localNode: local, localId: 'node_a', nameOf });
  const unwire = wireHelm(s, source, { pollMs: 60000 });
  try {
    s.setState({ fs: 'hb:svi', sviSel: RES.resource_id });
    assert.ok(await until(() => (s.hbItems(local, 'svi') || []).length === 1));
    await sleep(700);
    assert.ok(!f.calls.some((c) => c.op === HELM_APPS.svi.events.op), '카탈로그에 없는 op 는 부르지 않는다');
    assert.equal((s.state.sviEv || {})[RES.resource_id], undefined);
  } finally {
    unwire();
    clearInterval(s._hbX); clearTimeout(s._hbT);
  }
});

test('RealNode — 예시 흐름 이벤트를 만들지 않는다(디자인의 sviDemoTick · 0.5초 박자). 흐름 이벤트 칸은 "열린 핸들이 없다"', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const local = s.state.localNode.name;
  s.hbPut(local, 'svi', [{ id: RES.resource_id, kind: 'camera', name: 'cam1', status: 'available', ep: 'frames · source · stream', grant: 'own', handle: 'svih_live' }]);
  s.setState({ fs: 'hb:svi' });
  s.sviDemoTick();
  s.hbTick();
  assert.deepEqual(s.state.sviEv || {}, {});
  const view = s.sviEvView(RES.resource_id);
  assert.equal(view.live, false);
  assert.match(view.head, /열린 핸들이 없다/);
  assert.doesNotMatch(view.head, /예시/);
});

test('wire — 보고 있는 앱의 목록을 받지 못하면(Master 전용 — 앱 토큰) 그 이유를 2.6초 뒤에도 남긴다 · 다시 받으면 지운다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  const local = s.state.localNode.name;
  const f = sviServer();
  const client = new TerraClient('', { fetch: f });
  client.catalog = new Map([['terra.daemon.modules.get', {}]]);   // 앱 토큰의 카탈로그 — Master op 가 없다
  const source = new LiveSource(client, { localNode: local, localId: 'node_a', nameOf });
  const unwire = wireHelm(s, source, { pollMs: 60000 });
  try {
    s.setState({ fs: 'hb:svi' });
    assert.ok(await until(() => s.state.hbMsg && /게이트웨이에 없다/.test(s.state.hbMsg.t)), JSON.stringify(s.state.hbMsg));
    await sleep(3000);
    assert.match((s.state.hbMsg || {}).t || '', /이 노드의 게이트웨이에 없다/, '2.6초가 지나도 이유가 남는다');
    assert.ok(!f.calls.some((c) => /svi/.test(c.op)), '카탈로그에 없는 op 는 부르지 않는다');
    // 길이 생기면(카탈로그) 다음 받기가 목록을 채우고 남겨 둔 이유를 지운다 — 여기서는 앱을 다시 연다(폴링 간격을 기다리지 않게)
    client.catalog = new Map();
    s.setState({ fs: null });
    await sleep(500);
    s.setState({ fs: 'hb:svi' });
    await until(() => !s.state.hbMsg, 3000);
    assert.equal(s.state.hbMsg, null);
    assert.equal(s.hbItems(local, 'svi').length, 1);
  } finally {
    unwire();
    clearInterval(s._hbX); clearTimeout(s._hbT);
  }
});
