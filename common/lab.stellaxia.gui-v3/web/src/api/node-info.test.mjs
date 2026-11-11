// node --test — 노드 상태 창의 실제 값(식별 · 통신 · 최근 활동)
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeInfo, createNodeInfo, groupRoutes, INFO_READS } from './node-info.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const REC = {
  node_id: 'lf-a', device_id: 'dev-9', display_name: 'ws-a', roles: ['leaf'], capabilities: ['exec'], tags: ['lab'], parent_node_id: 'tr-root', depth: 1,
  cluster_address: '10.80.0.5', dns_label: 'ws-a', status: 'online', relay_connected: true, daemon_version: '1.7.2',
  last_heartbeat_at: '2026-11-01T11:58:00Z', created_at: '2026-10-01T09:00:00Z',
  resource: { cpu_percent: 42, memory_percent: 63.5, network_rx_bytes: 5 * 1024 * 1024, network_tx_bytes: 2048 },
};
const D = {
  status: { nodes: [{ node_id: 'lf-a', display_name: 'ws-a', status: 'online', relay_connected: true, network_generation: 4 }, { node_id: 'tr-root', display_name: 'home' }, { node_id: 'lf-b', display_name: 'ws-b' }] },
  state: { networks: [{ id: 'n1', name: 'lab-mesh' }], assignments: [{ node_id: 'lf-a', network_id: 'n1', assigned_ip: '100.64.0.5' }], desired_transports: [{ node_id: 'lf-a', adapter: 'wireguard', enabled: true }], observed_transports: [{ node_id: 'lf-a', reachability: 'direct' }] },
  graph: { edges: [{ source_node_id: 'lf-a', target_node_id: 'lf-b', candidates: [{ route_type: 'relay', healthy: false }, { route_type: 'direct', adapter: 'wireguard', healthy: true, latency_ms: 4 }] }, { source_node_id: 'tr-root', target_node_id: 'lf-b', candidates: [] }] },
  sessions: { sessions: [{ source_node_id: 'lf-b', target_node_id: 'lf-a', channel: 'svi', route_type: 'direct', state: 'open', updated_at: '2026-11-01T11:59:00Z' }] },
  probes: { probes: [{ source_node_id: 'lf-a', target_node_id: 'lf-b', adapter: 'wireguard', result: { reachable: false, error_code: 'TIMEOUT', observed_at: '2026-11-01T11:50:00Z' } }] },
  logs: { logs: [{ created_at: '2026-11-01T11:00:00Z', action: 'peer.revoke', target_type: 'node', target_id: 'lf-a', result: 'failed' }, { created_at: '2026-11-01T11:30:00Z', action: 'plan', target_id: 'lf-b', result: 'ok' }] },
};

test('식별 — node id · 장치 · 역할 · 부모(이름) · 주소 · DNS · 버전', () => {
  const v = nodeInfo(REC, D, { now: NOW });
  assert.equal(v.ident.nodeId, 'lf-a'); assert.equal(v.ident.deviceId, 'dev-9'); assert.equal(v.ident.roles, 'Leaf');
  assert.equal(v.ident.parent, 'home'); assert.equal(v.ident.parentId, 'tr-root'); assert.equal(v.ident.depth, '1');
  assert.equal(v.ident.address, '10.80.0.5'); assert.equal(v.ident.dns, 'ws-a.terra'); assert.equal(v.ident.version, '1.7.2');
  assert.equal(v.seen, '2m 전'); assert.equal(v.online, true);
});

test('통신 — 관측 전송이 연결 방식 · 이 노드가 낀 경로 · 세션만', () => {
  const v = nodeInfo(REC, D, { now: NOW });
  assert.equal(v.comm.via, 'direct'); assert.equal(v.comm.relay, true); assert.equal(v.comm.net, 'lab-mesh'); assert.equal(v.comm.gen, '4');
  assert.deepEqual(v.comm.routes.map((r) => [r.peer, r.rt, r.healthy]), [['ws-b', 'direct', true]]);
  assert.deepEqual(v.comm.sessions.map((s) => [s.peer, s.dir, s.state]), [['ws-b', '←', 'open']]);
});

const leg = (peer, dir, rt = 'mesh_vpn_direct', ad = 'wireguard', healthy = true, lat = '') => ({ peerId: 'id-' + peer, peer, dir, rt, ad, healthy, lat });

test('groupRoutes — 양방향이 같으면 ⇄ 한 줄, 지연이 달라도 같은 경로이고 느린 쪽을 보인다', () => {
  const [g] = groupRoutes([leg('srv', '←', undefined, undefined, true, '9ms'), leg('srv', '→', undefined, undefined, true, '4ms')]);
  assert.equal(g.dir, '⇄'); assert.equal(g.rt, 'mesh_vpn_direct'); assert.equal(g.oneWay, false); assert.deepEqual(g.legs, []);
  assert.equal(g.lat, '9ms'); assert.equal(g.latTip, '→ 4ms · ← 9ms');
  const [q] = groupRoutes([leg('srv', '→', undefined, undefined, true, '4ms'), leg('srv', '←', undefined, undefined, true, '4ms')]);
  assert.equal(q.lat, '4ms'); assert.equal(q.latTip, '');
});

test('groupRoutes — 방향별로 경로가 다르면 묶음 아래 → 먼저 ← 다음', () => {
  const [g] = groupRoutes([leg('sub', '←', 'cloud_relay', 'websocket'), leg('sub', '→')]);
  assert.equal(g.dir, ''); assert.equal(g.rt, ''); assert.equal(g.healthy, true);
  assert.deepEqual(g.legs.map((x) => [x.dir, x.rt, x.ad]), [['→', 'mesh_vpn_direct', 'wireguard'], ['←', 'cloud_relay', 'websocket']]);
});

test('groupRoutes — 경로가 같아도 상태가 다르면 합치지 않는다', () => {
  const [g] = groupRoutes([leg('sub', '→', undefined, undefined, true), leg('sub', '←', undefined, undefined, false)]);
  assert.equal(g.dir, ''); assert.equal(g.healthy, false);
  assert.deepEqual(g.legs.map((x) => [x.dir, x.healthy]), [['→', true], ['←', false]]);
});

test('groupRoutes — 한쪽 방향만 있으면 그 방향 한 줄로 남고 표시가 붙는다', () => {
  const [o, i] = groupRoutes([leg('a', '→'), leg('b', '←')]);
  assert.deepEqual([o.peer, o.dir, o.oneWay], ['a', '→', true]); assert.deepEqual([i.peer, i.dir, i.oneWay], ['b', '←', true]);
});

test('groupRoutes — 실패한 경로도 사라지지 않는다(양쪽 실패 · 한쪽만 실패)', () => {
  const G = groupRoutes([leg('both', '→', 'cloud_relay', 'websocket', false), leg('both', '←', 'cloud_relay', 'websocket', false), leg('solo', '→', '—', '', false)]);
  assert.deepEqual(G.map((g) => [g.peer, g.dir, g.healthy]), [['both', '⇄', false], ['solo', '→', false]]);
});

test('groupRoutes — 순서는 받은 순서 · 건강과 무관하고, 이름이 같아도 다른 노드면 따로', () => {
  const a = [leg('marui-sub2', '→'), leg('BOOK', '←'), leg('marui-server', '→'), leg('BOOK', '→'), leg('marui-server', '←'), leg('marui-sub2', '←')];
  const order = (rows) => groupRoutes(rows).map((g) => g.peer);
  assert.deepEqual(order(a), ['BOOK', 'marui-server', 'marui-sub2']);
  assert.deepEqual(order(a.slice().reverse()), ['BOOK', 'marui-server', 'marui-sub2']);
  assert.deepEqual(order(a.map((x) => (x.peer === 'BOOK' ? { ...x, healthy: false } : x))), ['BOOK', 'marui-server', 'marui-sub2']);
  const twins = groupRoutes([{ ...leg('nas', '→'), peerId: 'n2' }, { ...leg('nas', '→'), peerId: 'n1' }]);
  assert.deepEqual(twins.map((g) => g.peerId), ['n1', 'n2']);
});

test('groupRoutes — 같은 방향의 똑같은 경로는 하나로, 다른 경로는 숨기지 않는다', () => {
  assert.equal(groupRoutes([leg('x', '→'), leg('x', '→')])[0].oneWay, true);
  assert.deepEqual(groupRoutes([leg('x', '→'), leg('x', '→', 'cloud_relay', 'websocket')])[0].legs.map((y) => y.rt), ['cloud_relay', 'mesh_vpn_direct']);
  assert.deepEqual(groupRoutes(undefined), []);
});

test('nodeInfo — 경로 묶음은 node id 로 묶고 방향별 routes 도 그대로 둔다', () => {
  const v = nodeInfo({ node_id: 'a' }, { status: { nodes: [{ node_id: 'b', display_name: 'bee' }] }, graph: { edges: [
    { source_node_id: 'a', target_node_id: 'b', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }] },
    { source_node_id: 'b', target_node_id: 'a', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }] },
  ] } }, { now: NOW });
  assert.equal(v.comm.routes.length, 2);
  assert.deepEqual(v.comm.routeGroups.map((g) => [g.peerId, g.peer, g.dir]), [['b', 'bee', '⇄']]);
});

test('최근 활동 — 하트비트 · 세션 · probe · 이 노드의 조작만, 최신순', () => {
  const v = nodeInfo(REC, D, { now: NOW });
  assert.deepEqual(v.recent.events.map((e) => e.msg.split(' ')[0]), ['session', 'heartbeat', 'probe', 'peer.revoke']);
  assert.equal(v.recent.events.find((e) => /peer.revoke/.test(e.msg)).lv, 'warn');
  assert.equal(v.res.rxT, '5.0MiB'); assert.equal(v.res.mem, 0.635);
});

test('읽기가 비어도 — 노드 기록만으로 그리고, 없는 칸은 —', () => {
  const v = nodeInfo({ node_id: 'x1' }, {}, { now: NOW });
  assert.equal(v.ident.nodeId, 'x1'); assert.equal(v.ident.version, '—'); assert.equal(v.comm.via, '—'); assert.equal(v.recent.events.length, 0);
});

test('createNodeInfo — 실패한 읽기는 miss, 10초 안에는 다시 부르지 않는다', async () => {
  const calls = [];
  const terra = { invoke: (op) => { calls.push(op); return /logs/.test(op) ? Promise.reject(new Error('DELEGATION_NOT_OPEN')) : Promise.resolve(D[INFO_READS.find((k) => op.includes(k === 'graph' ? 'route.graph' : k === 'sessions' ? 'route.sessions' : 'network.' + k))]); } };
  const get = createNodeInfo(terra, () => ({ node: (id) => (id === 'lf-a' ? REC : null) }));
  const v = await get('lf-a');
  assert.deepEqual(v.miss, ['logs']); assert.equal(v.ident.nodeId, 'lf-a');
  await get('lf-a'); assert.equal(calls.length, INFO_READS.length);
  assert.equal(await get(''), null);
});
