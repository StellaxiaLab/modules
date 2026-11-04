// node --test — 네트워크 창의 Master 읽기 → 행. lab.stellaxia.node-gui tests/netmaster.test.mjs 의 응답 → 행 시험을 옮겼다
import test from 'node:test';
import assert from 'node:assert/strict';
import { meshRows, graphView, candidateRows, policyRows, sessionRows, probeRows, logRows, when, nameMap, networkRows, peerRows } from '../src/api/net-read.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const visible = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
const EXAMPLE = /edge-01|nas-01|tree-home|tree-lab|gpu-0\d|laptop-03|bench-pi|10\.60\.0|203\.0\.113|rp-0\d|rt_8f2c|cg_19|epoch 42|시연/;

const STATUS = { route_graph_epoch: 7, nodes: [
  { node_id: 'n-a', display_name: 'alpha', status: 'online', relay_connected: true, network_generation: 3, transport_capabilities: [] },
  { node_id: 'n-b', display_name: 'beta', status: 'offline', relay_connected: false, network_generation: 3, transport_capabilities: [] }
] };
const STATE = {
  cluster_id: 'c1', route_graph_epoch: 7,
  networks: [{ id: 'net1', name: 'lan', cidr: '10.9.0.0/24', gateway: '10.9.0.1', dns: ['10.9.0.1'], status: 'active' }],
  assignments: [{ id: 'as1', node_id: 'n-a', network_id: 'net1', assigned_ip: '10.9.0.5', status: 'active', updated_at: '2026-10-09T10:00:00Z' }],
  desired_transports: [{ id: 'd1', node_id: 'n-a', adapter: 'wireguard', enabled: true }],
  observed_transports: [{ id: 'o1', node_id: 'n-a', adapter: 'wireguard', reachability: 'lan', network_generation: 2, endpoint: {} }],
  wireguard_push_deliveries: [{ id: 'p1', node_id: 'n-a', status: 'rejected', last_error: 'key mismatch', updated_at: '2026-10-09T10:00:00Z' }]
};
const GRAPH = { route_graph_epoch: 7, edges: [
  { source_node_id: 'n-a', target_node_id: 'n-b', candidates: [{ route_type: 'cloud_relay', adapter: 'websocket', healthy: false }, { route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }], denied_candidates: [], policy_source: 'default' },
  { source_node_id: 'n-b', target_node_id: 'n-a', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }], denied_candidates: [], policy_source: 'default' }
] };

test('응답 → 행: 노드 × 네트워크는 노드마다 할당 · desired · observed · 배포를 잇는다', () => {
  const rows = meshRows(STATE, STATUS);
  const a = rows.find((r) => r.id === 'n-a'), b = rows.find((r) => r.id === 'n-b');
  assert.deepEqual([a.name, a.ip, a.net, a.desired, a.observed, a.obsGen, a.gen, a.push, a.pushErr], ['alpha', '10.9.0.5', 'lan', 'wireguard', 'lan', 2, 3, 'rejected', 'key mismatch']);
  assert.deepEqual([b.name, b.status, b.ip, b.observed, b.push], ['beta', 'offline', '—', null, null]);
  assert.deepEqual(meshRows(null, null), [], 'null 목록(Go 의 nil 슬라이스)도 빈 표다');
});

test('응답 → 그래프: 쌍마다 선 하나, 건강한 후보의 route_type', () => {
  const G = graphView(GRAPH, STATUS);
  assert.equal(G.epoch, 7);
  assert.equal(G.edges.length, 1, '방향만 다른 쌍은 한 선');
  assert.deepEqual(G.edges[0].slice(2), ['mesh_vpn_direct']);
  assert.deepEqual(G.nodes.map((n) => n.name).sort(), ['alpha', 'beta']);
});

test('응답 → 후보 · 정책 · 세션 · probe · 이력 행', () => {
  const c = candidateRows({ candidates: [{ route_type: 'lan_direct', adapter: 'tcp', healthy: true, latency_ms: 3, bandwidth_bps: 4e8, last_probe_at: '0001-01-01T00:00:00Z' }], denied_candidates: [{ route_type: 'cloud_relay', adapter: 'websocket', reason: 'policy denies' }], policy_source: 'stored:x' });
  assert.deepEqual([c.cands[0].lat, c.cands[0].bw, c.cands[0].probe, c.denied[0].reason, c.source], ['3ms', '400 Mbps', '—', 'policy denies', 'stored:x']);
  const names = nameMap(STATUS);
  const p = policyRows({ policies: [{ id: 'pol1', scope: { source_node_id: 'n-a', channel: 'control' }, policy: { mode: 'prefer', prefer: ['lan_direct'], fallback: true }, updated_at: '2026-10-09T10:00:00Z' }] }, names);
  assert.deepEqual([p[0].src, p[0].dst, p[0].channel, p[0].mode, p[0].prefer, p[0].fallback], ['alpha', '*', 'control', 'prefer', 'lan_direct', '예']);
  const s = sessionRows({ sessions: [{ id: 's1', source_node_id: 'n-a', target_node_id: 'n-b', route_type: 'lan_direct', state: 'active', health: { bytes_sent: 2048, bytes_received: 0 } }] }, names);
  assert.deepEqual([s[0].src, s[0].dst, s[0].sent, s[0].recv], ['alpha', 'beta', '2.0KiB', '0B']);
  const pr = probeRows({ probes: [{ id: 'pr1', source_node_id: 'n-a', target_node_id: 'n-b', adapter: 'tcp', fresh: false, stale_reason: 'probe_expired', result: { reachable: true, observed_at: '2026-10-09T10:00:00Z' } }] }, names);
  assert.deepEqual([pr[0].src, pr[0].reachable, pr[0].fresh, pr[0].stale], ['alpha', true, false, 'probe_expired']);
  const l = logRows({ logs: [{ action: 'network.probe', result: 'accepted', target_type: 'probe', target_id: 'x', detail: { a: 1 }, created_at: '2026-10-09T10:00:00Z' }] });
  assert.deepEqual([l[0].action, l[0].detail], ['network.probe', '{"a":1}']);
  assert.equal(when('0001-01-01T00:00:00Z'), '—');
});

/** 위임 자격의 leaf 클라이언트 — 카탈로그에 Master op 가 없어 /api/upstream 으로 부른다 */

test('네트워크 · 피어 행 — 없는 칸은 —', () => {
  assert.deepEqual(networkRows({ networks: [{ id: 'n1', name: 'mesh', cidr: '10.8.0.0/24', adapter: 'wireguard' }] }).map((x) => [x.name, x.cidr, x.adapter]), [['mesh', '10.8.0.0/24', 'wireguard']]);
  assert.deepEqual(peerRows({ peers: [{ node_id: 'a', allowed_ips: ['10.8.0.2/32'], endpoint: '1.2.3.4:51820', public_key: 'abcdefghijk' }] }, new Map([['a', 'leaf-a']])), [{ node: 'leaf-a', ip: '10.8.0.2/32', endpoint: '1.2.3.4:51820', key: 'abcdefgh…' }]);
  assert.deepEqual(peerRows(null), []);
});

test('netTable — 탭마다 열 수와 행의 칸 수가 같고, 모르는 탭은 빈 표', async () => {
  const { netTable, NET_TABS, NET_READS } = await import('../src/api/net-read.js');
  const D = { status: { nodes: [{ node_id: 'a', display_name: 'alpha', status: 'online' }, { node_id: 'b', display_name: 'beta' }] },
    graph: { edges: [{ source_node_id: 'a', target_node_id: 'b', candidates: [{ route_type: 'direct', healthy: true }] }] },
    sessions: { sessions: [{ id: 's1', source_node_id: 'a', target_node_id: 'b', state: 'open' }] }, logs: { logs: [{ action: 'mesh.plan', target_type: 'cluster', target_id: 'c' }] } };
  for (const [tab, , reads] of NET_TABS) { const T = netTable(tab, D); for (const r of T.rows) assert.equal(r.length, T.cols.length, tab); for (const k of reads) assert.ok(NET_READS[k], k); }
  assert.deepEqual(netTable('graph', D).rows, [['alpha', 'beta', 'direct']]);
  assert.deepEqual(netTable('sessions', D).rows[0].slice(0, 3), ['s1', 'alpha', 'beta']);
  assert.deepEqual(netTable('x', D), { cols: [], rows: [] });
});
