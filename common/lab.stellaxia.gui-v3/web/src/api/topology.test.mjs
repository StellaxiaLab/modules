// node --test — Master 노드 목록 → 씬 지도(TerraTopology)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, loadTopology, loadTopologyState, nodeStats, fmtBytes, MAX_LEAVES, STALE_SEC } from './topology.js';

const N = [
  { node_id: 'tr-root', display_name: 'home', roles: ['tree'] },
  { node_id: 'tr-sub', display_name: 'lab', roles: ['tree'], parent_node_id: 'tr-root' },
  { node_id: 'lf-b', display_name: 'ws/b', roles: ['leaf'], parent_node_id: 'tr-root' },
  { node_id: 'lf-a', display_name: 'ws-a', roles: ['leaf'], parent_node_id: 'tr-root' },
  { node_id: 'lf-c', display_name: 'cam', roles: ['leaf'], parent_node_id: 'tr-sub' },
  { node_id: 'lf-x', display_name: 'orphan', roles: ['leaf'], parent_node_id: 'tr-gone' },
];

test('트리 · 리프 · 경로 — 이름순, 목록에 없는 부모는 이름 없는 트리로, / 는 경로와 겹치지 않게', () => {
  const T = buildTopology(N, { localId: 'lf-a', rev: 1 });
  assert.deepEqual(T.spec, [[[]], []]);   // home(자식 트리 lab) · 이름 없는 트리
  assert.equal(T.label([1]), 'home'); assert.equal(T.rid([1]), 'tr-root');
  assert.equal(T.label([1, 1]), 'lab'); assert.equal(T.label([2]), 'Tree');
  assert.deepEqual(T.leaves([1]).map((l) => l.name), ['ws-a', 'ws∕b']);
  assert.deepEqual(T.leaves([1, 1]).map((l) => l.id), ['lf-c']);
  assert.deepEqual(T.leaves([2]).map((l) => l.id), ['lf-x']);
  assert.equal(T.leaves([9]), null); assert.equal(T.localId, 'lf-a');
});

test('리프는 트리마다 12 개까지 — 넘는 것은 개수로', () => {
  const many = [{ node_id: 't', roles: ['tree'], display_name: 't' }].concat(Array.from({ length: 15 }, (_, i) => ({ node_id: 'l' + i, display_name: 'n' + String(i).padStart(2, '0'), parent_node_id: 't' })));
  const T = buildTopology(many);
  assert.equal(T.leaves([1]).length, MAX_LEAVES); assert.equal(T.more([1]), 3);
});

test('loadTopology — 노드 목록 · 로컬 id, 못 받으면 null', async () => {
  const terra = { invoke: async (op) => op === 'terra.master.nodes.get' ? { nodes: N } : { daemon: { node_id: 'x' }, enrollment: { node_id: 'lf-a' } } };
  const T = await loadTopology(terra); assert.equal(T.localId, 'lf-a'); assert.equal(T.count, 7);
  assert.equal(await loadTopology({ invoke: async () => { throw new Error('no'); } }), null);
});

test('nodeStats — 하트비트 자원 스냅샷 · 상태 · 마지막 하트비트, 없는 칸은 null', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  const E = { stale: false, version: '', relay: null, memTotal: null, memUsed: null, diskTotal: null, diskUsed: null };
  assert.deepEqual(nodeStats({ status: 'online', resource: { cpu_percent: 42, memory_percent: 61.5 }, last_heartbeat_at: '2026-10-31T11:59:50Z' }, now), { status: '● 온라인', online: true, ageSec: 10, seenAt: Date.parse('2026-10-31T11:59:50Z'), cpu: 0.42, mem: 0.615, disk: null, seen: '방금', ...E });
  assert.equal(nodeStats({ status: 'offline', last_heartbeat_at: '2026-10-31T09:00:00Z' }, now).seen, '3시간 전');
  assert.deepEqual(nodeStats(null, now), { status: '—', online: false, ageSec: null, seenAt: null, cpu: null, mem: null, disk: null, seen: '', ...E });
  const T = buildTopology([{ node_id: 't', roles: ['tree'], display_name: 'home' }, { node_id: 'l', parent_node_id: 't', resource: { cpu_percent: 5 } }]);
  assert.equal(T.node('l').resource.cpu_percent, 5); assert.equal(T.node('x'), null);
});

test('단독 리프 — Master 노드를 모르면(옛 Master) 부모 없는 리프는 이름 없는 Master(rid 없음) 아래로 — 대체 표시', () => {
  const T = buildTopology([{ node_id: 'node_a', display_name: 'iso-leaf', status: 'online' }], { localId: 'node_a' });
  assert.equal(T.spec.length, 1);
  assert.equal(T.label([1]), 'Master'); assert.equal(T.rid([1]), '');   // 노드 기록이 없다 — 노드 주소 호출을 하지 않는다
  assert.deepEqual(T.roles([1]), ['master']); assert.equal(T.masterId, '');
  assert.deepEqual(T.leaves([1]).map((l) => l.id), ['node_a']);
  // 진짜 Tree 가 있으면 그 아래 리프는 그대로, 부모 없는 리프만 따로 모인다
  const U = buildTopology([{ node_id: 't', roles: ['tree'], display_name: 'home' }, { node_id: 'l', parent_node_id: 't' }, { node_id: 'x' }]);
  assert.deepEqual(U.spec.length, 2);
  assert.deepEqual([U.label([1]), U.label([2])].sort(), ['Master', 'home']);
});

// 11/2 실제 Master(marui-server) 모양 — 클러스터 하나, 노드 넷, 부모는 전부 빈 값(= 이 Master 바로 아래), 서버만 leaf+tree
const LIVE = [
  { node_id: 'node_srv', display_name: 'marui-server', roles: ['leaf', 'tree'], parent_node_id: '', depth: 0, status: 'online' },
  { node_id: 'node_desk', display_name: 'MARUI-NANO-DESK', roles: ['leaf'], parent_node_id: '', depth: 0, status: 'online' },
  { node_id: 'node_sub2', display_name: 'marui-sub2', roles: ['leaf'], parent_node_id: '', depth: 0, status: 'offline' },
  { node_id: 'node_book', display_name: 'BOOK-SB82N10UHA', roles: ['leaf'], parent_node_id: '', depth: 0, status: 'offline' },
];

test('노드 단위 — Master 가 도는 노드를 알면 그 노드가 항성계 하나(트리 · 리프 둘 다), 나머지는 그 행성', () => {
  for (const [how, list, o] of [['master_node_id', LIVE, { masterId: 'node_srv' }], ['master_host', LIVE.map((n) => (n.node_id === 'node_srv' ? { ...n, master_host: true } : n)), {}]]) {
    const T = buildTopology(list, { localId: 'node_desk', ...o });
    assert.deepEqual(T.spec, [[]], how + ' — 항성계 하나, 가짜 Tree 없음');
    assert.equal(T.label([1]), 'marui-server', how); assert.equal(T.rid([1]), 'node_srv', how);   // 상태는 서버 자신의 기록
    assert.deepEqual(T.roles([1]).sort(), ['leaf', 'master', 'tree'], how);
    assert.equal(T.node(T.rid([1])).display_name, 'marui-server', how);
    const names = T.leaves([1]).map((l) => l.name);
    assert.deepEqual(names, ['BOOK-SB82N10UHA', 'MARUI-NANO-DESK', 'marui-sub2'], how);
    assert.ok(!names.includes('marui-server'), how + ' — 서버를 행성으로 한 번 더 그리지 않는다');
    assert.equal(T.count, 4, how + ' — 지어낸 노드 없음');
  }
});

test('노드 단위 — 목록에 없는 masterId 는 믿지 않고 대체 표시로', () => {
  const T = buildTopology(LIVE, { masterId: 'node_gone' });
  assert.equal(T.masterId, '');
  assert.deepEqual(T.spec.map((_, i) => T.label([i + 1])).sort(), ['Master', 'marui-server']);
});

test('부모가 채워진 모양 — 중간 Tree(TreeNodeID) 아래 리프 · 자식 Tree, Master 노드가 맨 위', () => {
  const L = [
    { node_id: 'tr_mid', display_name: 'mid', roles: ['tree'] },
    { node_id: 'tr_child', display_name: 'child', roles: ['tree', 'leaf'], parent_node_id: 'tr_mid' },
    { node_id: 'lf_a', display_name: 'a', roles: ['leaf'], parent_node_id: 'tr_mid' },
    { node_id: 'lf_b', display_name: 'b', roles: ['leaf'], parent_node_id: 'tr_child' },
  ];
  const T = buildTopology(L, { masterId: 'tr_mid' });
  assert.deepEqual(T.spec, [[[]]]);
  assert.equal(T.rid([1]), 'tr_mid'); assert.equal(T.rid([1, 1]), 'tr_child');
  assert.deepEqual(T.roles([1, 1]).sort(), ['leaf', 'tree']);   // 이중 역할 자식 Tree 도 항성계 하나
  assert.deepEqual(T.leaves([1]).map((l) => l.id), ['lf_a']); assert.deepEqual(T.leaves([1, 1]).map((l) => l.id), ['lf_b']);
  // masterId 없이도 부모가 채워진 지도는 그대로
  assert.deepEqual(buildTopology(L).spec, [[[]]]);
});

test('loadTopologyState — nodes.get 의 master_node_id 를 지도에 싣는다', async () => {
  const terra = { invoke: async (op) => op === 'terra.master.nodes.get' ? { nodes: LIVE, master_node_id: 'node_srv' } : { enrollment: { node_id: 'node_desk' } } };
  const { topo } = await loadTopologyState(terra);
  assert.equal(topo.masterId, 'node_srv'); assert.deepEqual(topo.spec, [[]]);
  const old = await loadTopologyState({ invoke: async (op) => op === 'terra.master.nodes.get' ? { nodes: LIVE } : null });
  assert.equal(old.topo.masterId, ''); assert.equal(old.topo.spec.length, 2);   // 옛 Master — 대체 표시
});

test('nodeStats — 지어내지 않는다: 낡은 online 은 응답 없음, 총량 · 버전은 보고된 것만', () => {
  const now = Date.parse('2026-11-01T12:00:00Z'), ago = (s) => new Date(now - s * 1000).toISOString();
  // hanium 같은 노드 — 9/24 이후 하트비트 없음. 기록이 online 으로 남아 있어도 연결로 치지 않는다
  const stale = nodeStats({ status: 'online', last_heartbeat_at: '2026-09-24T02:12:04Z', relay_connected: false }, now);
  assert.equal(stale.online, false); assert.equal(stale.status, '◌ 응답 없음'); assert.equal(stale.relay, false);
  assert.equal(nodeStats({ status: 'online', last_heartbeat_at: ago(STALE_SEC + 1) }, now).online, false);
  assert.equal(nodeStats({ status: 'online', last_heartbeat_at: ago(STALE_SEC - 5) }, now).online, true);
  assert.equal(nodeStats({ status: 'online' }, now).online, false);   // 하트비트가 한 번도 없으면 연결이 아니다
  assert.equal(nodeStats({ status: 'offline', last_heartbeat_at: ago(5) }, now).status, '○ 꺼짐');
  // 총량 — Master 가 실어 준 바이트만. 0 · 없음은 null(화면은 '보고 없음'), 200 GB 같은 기본값을 만들지 않는다
  const full = nodeStats({ status: 'online', last_heartbeat_at: ago(3), daemon_version: '0.6.10', resource: { disk_percent: 80.99, disk_total_bytes: 512 * 2 ** 30, disk_used_bytes: 415 * 2 ** 30, memory_total_bytes: 0 } }, now);
  assert.equal(full.version, '0.6.10'); assert.equal(full.diskTotal, 512 * 2 ** 30); assert.equal(full.diskUsed, 415 * 2 ** 30); assert.equal(full.memTotal, null);
  const bare = nodeStats({ status: 'online', last_heartbeat_at: ago(3), resource: { disk_percent: 7.4 } }, now);
  assert.equal(bare.diskTotal, null); assert.equal(bare.version, '');
});

test('fmtBytes — 바이트를 읽을 수 있게, 없으면 빈 글자', () => {
  assert.equal(fmtBytes(512 * 2 ** 30), '512 GB'); assert.equal(fmtBytes(15.5 * 2 ** 30), '15.5 GB'); assert.equal(fmtBytes(1.5 * 2 ** 40), '1.5 TB');
  assert.equal(fmtBytes(0), ''); assert.equal(fmtBytes(null), ''); assert.equal(fmtBytes(undefined), '');
});

test('대상 표 행 — node_id · relay · CPU/MEM · 마지막 보고 나이 · stale, 12 개 넘는 리프는 overflow 로', () => {
  const now = Date.parse('2026-11-01T00:10:00Z');
  const nodes = [{ node_id: 'tr', display_name: 'T', roles: ['tree'] }];
  for (let i = 0; i < 14; i++) nodes.push({ node_id: 'lf' + String(i).padStart(2, '0'), display_name: 'n' + String(i).padStart(2, '0'), parent_node_id: 'tr', status: 'online', relay_connected: i % 2 === 0, last_heartbeat_at: i === 0 ? '2026-11-01T00:09:30Z' : '2026-11-01T00:00:00Z', resource: i === 0 ? { cpu_percent: 40, memory_percent: 55 } : undefined });
  const T = buildTopology(nodes, { now }), r = T.leaves([1]);
  assert.equal(r.length, MAX_LEAVES); assert.equal(T.more([1]), 2);
  assert.deepEqual(T.overflow([1]).map((l) => l.nodeId), ['lf12', 'lf13']);
  assert.equal(r[0].nodeId, 'lf00'); assert.equal(r[0].relayConnected, true); assert.equal(r[0].cpu, 0.4); assert.equal(r[0].mem, 0.55);
  assert.equal(r[0].ageSec, 30); assert.equal(r[0].stale, false); assert.equal(r[0].online, true);
  assert.equal(r[1].stale, true); assert.equal(r[1].online, false); assert.equal(r[1].cpu, null); assert.equal(r[1].ageSec, 600); assert.equal(r[1].relayConnected, false);
  assert.deepEqual(T.overflow([9]), []);
});

test('nodeStats — stale: online 이라지만 하트비트가 없거나 낡은 것만, offline 은 stale 아님', () => {
  const now = Date.parse('2026-11-01T00:10:00Z');
  assert.equal(nodeStats({ status: 'online' }, now).stale, true); assert.equal(nodeStats({ status: 'online' }, now).ageSec, null);
  assert.equal(nodeStats({ status: 'offline', last_heartbeat_at: '2026-10-01T00:00:00Z' }, now).stale, false);
  assert.equal(nodeStats({ status: 'online', last_heartbeat_at: '2026-11-01T00:09:59Z' }, now).stale, false);
});

test('loadTopologyState — 실패 · 빈 목록을 가르고, Master 는 등록 상태에서', async () => {
  const mk = (nodes, fail) => ({ invoke: async (op) => { if (op === 'terra.master.nodes.get') { if (fail) { const e = new Error('x'); e.code = 'GATEWAY_UNREACHABLE'; throw e; } return nodes; } if (op === 'terra.daemon.enrollment.status.get') return { registered: true, master_url: 'https://m', registered_at: '2026-10-01' }; return { enrollment: { node_id: 'lf' } }; } });
  const bad = await loadTopologyState(mk([], true)); assert.equal(bad.state, 'error'); assert.equal(bad.error, 'GATEWAY_UNREACHABLE'); assert.equal(bad.topo, null);
  const empty = await loadTopologyState(mk([])); assert.equal(empty.state, 'empty'); assert.equal(empty.topo, null);
  const ok = await loadTopologyState(mk([{ node_id: 'lf', display_name: 'a', parent_node_id: 'tr' }]));
  assert.equal(ok.state, 'ok'); assert.deepEqual(ok.topo.master, { url: 'https://m', registered: true, registeredAt: '2026-10-01' }); assert.equal(ok.topo.localId, 'lf');
  assert.equal(await loadTopology(mk([], true)), null);
});

test('records — Master 노드 기록 전부, 세운 트리는 빼고', () => {
  const T = buildTopology([{ node_id: 'l1', parent_node_id: 'gone', display_name: 'a' }, { node_id: 'm', master_host: true }]);
  assert.deepEqual(T.records().map((n) => n.node_id).sort(), ['l1', 'm']);
});
