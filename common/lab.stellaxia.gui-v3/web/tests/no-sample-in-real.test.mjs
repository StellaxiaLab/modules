// node --test — 실제 모드(앱이 Terra 에 붙음)에서 노드 상태 창이 시안 값을 지어내지 않는지.
//   2026-11-01 실측: 모든 노드가 'DISK … / 200 GB' · '코어 1.7.x' · '온라인'으로 보였다 — NodeStatus 보드가 노드 이름 해시로 만든 시안 값이었다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { buildTopology, nodeStats, fmtBytes } from '../src/api/topology.js';
import { nodeInfo } from '../src/api/node-info.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const board = (n) => { const B = parseBoard(read(n)); return new Function('DCLogic', B.script + '\nreturn Component;')(DCLogic); };

const NOW = Date.now(), ago = (s) => new Date(NOW - s * 1000).toISOString();
const NODES = [
  { node_id: 'n-server', display_name: 'marui-server', roles: ['leaf', 'tree'], status: 'online', relay_connected: true, last_heartbeat_at: ago(5), daemon_version: '0.6.10', resource: { cpu_percent: 2.2, memory_percent: 29.7, disk_percent: 7.4 } },
  { node_id: 'n-desk', display_name: 'MARUI-NANO-DESK', roles: ['leaf'], status: 'online', relay_connected: true, last_heartbeat_at: ago(5), daemon_version: '0.6.10', resource: { cpu_percent: 8.9, memory_percent: 87.5, disk_percent: 81, disk_total_bytes: 1024 * 2 ** 30, disk_used_bytes: 829 * 2 ** 30 } },
  { node_id: 'n-rdk', display_name: 'hanium', roles: ['leaf'], status: 'online', relay_connected: false, last_heartbeat_at: '2026-09-24T02:12:04Z', daemon_version: '0.5.5', resource: { cpu_percent: 66, memory_percent: 35, disk_percent: 71.3 } },
];
const withWindow = (fn) => {
  const prev = globalThis.window, T = buildTopology(NODES);
  globalThis.window = { TerraTransport: {}, TerraTopology: T, TerraNodeStats: nodeStats, TerraFmtBytes: fmtBytes, TerraNodeInfo: async (rid) => nodeInfo(T.node(rid), {}, { id: rid }) };
  try { return fn(); } finally { globalThis.window = prev; }
};
// 상태 창은 TerraNodeInfo(비동기)로 받은 값을 state.info 에 둔다 — 시험은 그 값을 바로 넣고 그린다
const render = (props) => withWindow(() => { const C = board('NodeStatus'), c = new C(props); if (props.nodeRid) c.state.info = nodeInfo(window.TerraTopology.node(props.nodeRid), {}, { id: props.nodeRid }); return c.renderVals(); });
const text = (v) => JSON.stringify(v);

test('NodeStatus 실제 — Master 기록 그대로, 200 GB · 1.7.x 없음, 총량은 실린 것만', () => {
  const v = render({ nodeName: 'MARUI-NANO-DESK', nodeKind: '리프', nodeRid: 'n-desk' });
  assert.equal(v.stText, '● 온라인'); assert.equal(v.src, 'Master 노드 기록');
  assert.equal(v.ident.find((x) => x.k === '버전').v, '0.6.10');
  const disk = v.bars.find((b) => b.name === 'DISK');
  assert.equal(disk.pctT, '81%'); assert.equal(disk.note, '829GiB / 1TiB');
  assert.equal(v.bars.find((b) => b.name === 'MEM').note, '총량 보고 없음');   // Master 가 총량을 안 실었으면 만들지 않는다
  assert.doesNotMatch(text(v), /200 ?Gi?B|8\.0 ?Gi?B|1\.7\./);
});

test('NodeStatus 실제 — 9/24 이후 끊긴 노드는 온라인이 아니고, 자원은 마지막 보고', () => {
  const v = render({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  assert.doesNotMatch(v.stText, /온라인/); assert.equal(v.stText, '◌ 응답 없음');
  for (const b of v.bars) assert.match(b.note, /^마지막 보고 · \d+d 전$/, b.name);
});

test('NodeStatus 실제 — Master 목록에 없는 노드(시안 지도 · rid 없음)는 값 없이', () => {
  const v = render({ nodeName: 'lab-ws-02', nodeKind: '리프', nodeRid: '' });
  assert.match(v.note, /노드 목록에 없는 노드/); assert.equal(v.stText, '—');
  assert.doesNotMatch(text(v), /온라인|200 ?Gi?B|1\.7\./);
});

test('NodeConf 실제 — 코어 1.7.0 · 지어낸 노드 id · 사용자 · 경보 대신 Master 기록 · 빈 값', () => withWindow(() => {
  const C = board('NodeConf'); const c = new C({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  c.skinOf = () => ''; c.profOf = () => '';   // localStorage 를 보지 않게
  const d = c.defaults();
  assert.equal(d['core.version'], '0.5.5'); assert.equal(d['registration.node_id'], 'n-rdk'); assert.equal(c.nodeId(), 'n-rdk');
  assert.deepEqual([d.users, d.codes, d.alerts], [[], [], []]);
  assert.doesNotMatch(JSON.stringify(d), /1\.7\.|terra\.local|TR-7Q2K|디스크 92%/);
}));


test('NodeConf 실제 — 노드 설정은 읽기 요약 + 제어기 › 설정으로, 시안 설정 값 · (시안) 적용이 없다', () => withWindow(() => {
  const C = board('NodeConf'), opened = [];
  window.TerraTopology = buildTopology(NODES, { localId: 'n-desk', masterId: 'n-server', master: { url: 'https://tree.lab:8080', registered: true, registeredAt: '2026-10-01T00:00:00Z' } });
  const c = new C({ nodeName: 'MARUI-NANO-DESK', nodeKind: '리프', nodeRid: 'n-desk', onOpen: (k, a) => opened.push([k, a]) });
  c.skinOf = () => ''; c.profOf = () => '';
  const G = c.SECS().map(([g, it]) => g + ':' + it.map((x) => x[0]).join(','));
  assert.deepEqual(G, ['GUI:show,prof,skin,view,tlog', 'Terra:sum', 'Leaf:res', '기타:etc']);   // 연결 · 네트워크 · 업데이트 · 로그 · 노드 관리 편집 칸 없음
  c.setState({ sec: 'sum' }); const v = c.renderVals(), rows = v.rows, val = (l) => (rows.find((r) => r.label === l) || {}).val;
  assert.equal(val('표시 이름'), 'MARUI-NANO-DESK'); assert.equal(val('역할'), 'Leaf'); assert.equal(val('노드 ID'), 'n-desk'); assert.equal(val('코어 버전'), '0.6.10');
  assert.equal(val('Master 주소'), 'https://tree.lab:8080'); assert.equal(val('등록'), '등록됨 · 2026-10-01'); assert.match(val('부모'), /Master 바로 아래/);
  rows[0].noteRun(); assert.deepEqual(opened, [['ctl', 'set:node']]);
  assert.doesNotMatch(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x)), /시안|terra\.local|1\.7\.|TR-7Q2K/);
  // 원격 노드 — Master 주소 · 등록은 이 GUI 노드 것만 안다
  const r = new C({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk', remote: true, onOpen: () => {} }); r.skinOf = () => ''; r.profOf = () => ''; r.setState({ sec: 'sum' });
  const rv = r.renderVals().rows; assert.match(rv.find((x) => x.label === 'Master 주소').val, /이 GUI 노드 등록만/); 
  // Tree — Tree 요약(바로 아래 노드 · Master 노드)
  const t = new C({ nodeName: 'marui-server', nodeKind: '트리', nodeRid: 'n-server' }); t.skinOf = () => ''; t.profOf = () => ''; t.setState({ sec: 'tsum' });
  const tv = t.renderVals().rows; assert.match(tv.find((x) => x.label === 'Master 노드').val, /^예/); assert.match(tv.find((x) => x.label === '바로 아래 노드').val, /^2개/);
}));

// 2026-11-08 실측: 노드 4개인데 '경로 6개'. Master 경로 그래프는 방향 있는 간선(N×(N−1)=12)이라 상대 한 노드가 → ← 두 줄로 온다 — 데이터 중복이 아니라 방향이 다른 경로다
// 2026-11-10 사용자: 방향별 6줄이 섞여 나와 정리가 안 됐다 — 같은 노드는 하나로
test('NodeStatus 실제 — 경로는 상대 노드별 묶음이고, 같으면 ⇄ 한 줄 · 다르면 머리줄 아래 방향 줄 · 실패와 한쪽만은 표시', () => {
  const ids = ['n-server', 'n-desk', 'n-rdk', 'n-sub'], names = { 'n-server': 'marui-server', 'n-desk': 'MARUI-NANO-DESK', 'n-rdk': 'hanium', 'n-sub': 'marui-sub2' };
  const mesh = [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }], relay = [{ route_type: 'cloud_relay', adapter: 'websocket', healthy: true }];
  const edges = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => ({ source_node_id: a, target_node_id: b, candidates: a === 'n-desk' && b === 'n-sub' ? relay : mesh })));
  assert.equal(edges.length, 12);
  const info = nodeInfo({ node_id: 'n-desk', display_name: names['n-desk'], status: 'online' }, { graph: { edges }, status: { nodes: ids.map((n) => ({ node_id: n, display_name: names[n] })) } }, { id: 'n-desk' });
  assert.deepEqual(info.comm.routes.map((r) => r.dir + r.peer).sort(), ['←hanium', '←marui-server', '←marui-sub2', '→hanium', '→marui-server', '→marui-sub2']);
  const C = board('NodeStatus'), c = new C({ nodeName: names['n-desk'], nodeKind: '리프', nodeRid: '' });
  c.state.info = info;
  const v = withWindow(() => c.renderVals());
  assert.equal(v.routeSum, '상대 3개');
  // n-desk→n-sub 만 중계라 marui-sub2 는 머리줄 + 방향 두 줄, 나머지는 ⇄ 한 줄
  assert.deepEqual(v.routes.map((r) => [r.dir, r.peer, r.rt]), [
    ['⇄', 'hanium', 'mesh_vpn_direct'], ['⇄', 'marui-server', 'mesh_vpn_direct'],
    ['', 'marui-sub2', '방향별 다름'], ['→', '보낼 때', 'cloud_relay'], ['←', '받을 때', 'mesh_vpn_direct'],
  ]);
  // 실패 · 한쪽만 — 줄이 남고 글로 구분된다
  const bad = nodeInfo({ node_id: 'n-desk', display_name: 'x', status: 'online' }, { graph: { edges: [{ source_node_id: 'n-desk', target_node_id: 'n-sub', candidates: [{ route_type: 'cloud_relay', adapter: 'websocket', healthy: false }] }] }, status: { nodes: [{ node_id: 'n-sub', display_name: 'marui-sub2' }] } }, { id: 'n-desk' });
  c.state.info = bad; const w = withWindow(() => c.renderVals());
  assert.equal(w.routeSum, '상대 1개 · 실패 1개');
  assert.deepEqual([w.routes[0].mark, w.routes[0].dir, w.routes[0].tag], ['!', '→', '한쪽만 · 실패']);
});
