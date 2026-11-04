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
  assert.equal(disk.pctT, '81%'); assert.equal(disk.note, '829 GB / 1 TB');
  assert.equal(v.bars.find((b) => b.name === 'MEM').note, '총량 보고 없음');   // Master 가 총량을 안 실었으면 만들지 않는다
  assert.doesNotMatch(text(v), /200 GB|8\.0 GB|1\.7\./);
});

test('NodeStatus 실제 — 9/24 이후 끊긴 노드는 온라인이 아니고, 자원은 마지막 보고', () => {
  const v = render({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  assert.doesNotMatch(v.stText, /온라인/); assert.equal(v.stText, '◌ 응답 없음');
  for (const b of v.bars) assert.match(b.note, /^마지막 보고 · \d+일 전$/, b.name);
});

test('NodeStatus 실제 — Master 목록에 없는 노드(시안 지도 · rid 없음)는 값 없이', () => {
  const v = render({ nodeName: 'lab-ws-02', nodeKind: '리프', nodeRid: '' });
  assert.match(v.note, /노드 목록에 없는 노드/); assert.equal(v.stText, '—');
  assert.doesNotMatch(text(v), /온라인|200 GB|1\.7\./);
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
