// 네트워크 보드의 Master 묶음 — 위임 입구 1차 읽기(Terra ADR-GW-003). npm test
// 응답 모양은 Terra Master 코드(api/routes_network.go · models/network_state.go · models/route_runtime.go)를 따른다.
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { realNetwork } = await import('../src/data/network-live.js');
const { meshRows, graphView, candidateRows, policyRows, sessionRows, probeRows, logRows, when, nameMap } = await import('../src/data/network-master.js');

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
  assert.deepEqual([s[0].src, s[0].dst, s[0].sent, s[0].recv], ['alpha', 'beta', '2.0 KB', '0 B']);
  const pr = probeRows({ probes: [{ id: 'pr1', source_node_id: 'n-a', target_node_id: 'n-b', adapter: 'tcp', fresh: false, stale_reason: 'probe_expired', result: { reachable: true, observed_at: '2026-10-09T10:00:00Z' } }] }, names);
  assert.deepEqual([pr[0].src, pr[0].reachable, pr[0].fresh, pr[0].stale], ['alpha', true, false, 'probe_expired']);
  const l = logRows({ logs: [{ action: 'network.probe', result: 'accepted', target_type: 'probe', target_id: 'x', detail: { a: 1 }, created_at: '2026-10-09T10:00:00Z' }] });
  assert.deepEqual([l[0].action, l[0].detail], ['network.probe', '{"a":1}']);
  assert.equal(when('0001-01-01T00:00:00Z'), '—');
});

/** 위임 자격의 leaf 클라이언트 — 카탈로그에 Master op 가 없어 /api/upstream 으로 부른다 */
function leafMaster(answers) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    for (const [re, body] of answers) if (re.test(url)) return json(200, { ok: true, data: body });
    return json(404, { ok: false, error: { code: 'NOT_FOUND' } });
  };
  const client = new TerraClient('', { fetch: f, delegated: true });
  client.catalog = new Map([['terra.daemon.node.get', {}], ['terra.daemon.wireguard.status.get', {}]]);
  return { client, calls };
}

async function board(client) {
  const { default: Net } = await import('../src/screens/network.js');
  const n = new (realNetwork(Net))({});
  n.state.help = true;
  n.__live = { client, principal: 'u1', permissions: ['node.read'], node: { name: 'here' } };
  Object.assign(n.state, { live: true, why: null, role: 'leaf', perms: ['node.read'] });
  return n;
}

test('보드 — leaf 의 앱 토큰도 Master 묶음을 진짜 값으로 읽는다(예시 없음 · 쓰기 버튼 없음)', async () => {
  const { client, calls } = leafMaster([[/\/network\/state/, STATE], [/\/network\/status/, STATUS], [/\/route\/graph/, GRAPH],
    [/\/route\/policies/, { policies: [] }], [/\/route\/sessions/, { sessions: [] }], [/\/network\/probes/, { probes: [] }],
    [/\/network\/logs/, { logs: [{ action: 'route.policy.put', result: 'created', created_at: '2026-10-09T10:00:00Z' }] }],
    [/\/route\/candidates/, { candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }], denied_candidates: [], policy_source: 'default' }]]);
  const n = await board(client);

  n.state.sec = 'mesh';
  await n.refresh();
  assert.ok(calls.some((u) => u.startsWith('/api/upstream/v1/network/state')), calls.join(' '));
  let v = visible(n.renderVals());
  assert.match(v, /alpha/); assert.match(v, /10\.9\.0\.5/); assert.match(v, /key mismatch/);
  assert.doesNotMatch(v, EXAMPLE);
  assert.doesNotMatch(v, /"label":"(자동 조정 실행|수동 계획 적용…|철회|probe 실행|\+ CIDR|\+ 정책|닫기|삭제)"/, '쓰기 버튼은 없다');

  n.state.sec = 'route';
  await n.refresh();
  n.pickPair('n-a'); n.pickPair('n-b');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.some((u) => /\/api\/upstream\/v1\/route\/candidates\?source_node_id=n-a&target_node_id=n-b&channel=service_tunnel/.test(u)), calls.join(' '));
  v = visible(n.renderVals());
  assert.match(v, /mesh_vpn_direct/); assert.match(v, /epoch 7/);
  assert.doesNotMatch(v, EXAMPLE);

  n.state.sec = 'log';
  await n.refresh();
  v = visible(n.renderVals());
  assert.match(v, /route\.policy\.put/);
  assert.doesNotMatch(v, EXAMPLE);
});

test('보드 — Master 에 닿지 않으면(예전 Terra 401) 묶음은 "닿지 않음"과 이유', async () => {
  const f = async () => json(401, { ok: false, error: { code: 'UNAUTHORIZED' } });
  const client = new TerraClient('', { fetch: f, delegated: true });
  client.catalog = new Map([['terra.daemon.node.get', {}]]);
  const n = await board(client);
  n.state.sec = 'mesh';
  await n.refresh();
  assert.equal(client.masterBlocked, true);
  const v = visible(n.renderVals());
  assert.match(v, /닿지 않습니다/);
  assert.doesNotMatch(v, EXAMPLE);
});
