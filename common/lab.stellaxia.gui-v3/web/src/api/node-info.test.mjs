// node --test — 노드 상태 창의 실제 값(식별 · 통신 · 최근 활동)
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeInfo, createNodeInfo, INFO_READS } from './node-info.js';

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

test('최근 활동 — 하트비트 · 세션 · probe · 이 노드의 조작만, 최신순', () => {
  const v = nodeInfo(REC, D, { now: NOW });
  assert.deepEqual(v.recent.events.map((e) => e.msg.split(' ')[0]), ['session', 'heartbeat', 'probe', 'peer.revoke']);
  assert.equal(v.recent.events.find((e) => /peer.revoke/.test(e.msg)).lv, 'warn');
  assert.equal(v.res.rxT, '5.0 MB'); assert.equal(v.res.mem, 0.635);
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
