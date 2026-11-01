// node --test — 실제 모드(앱이 Terra 에 붙음)에서 노드 상태 창이 시안 값을 지어내지 않는지.
//   2026-11-01 실측: 모든 노드가 'DISK … / 200 GB' · '코어 1.7.x' · '온라인'으로 보였다 — NodeStatus 보드가 노드 이름 해시로 만든 시안 값이었다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { buildTopology, nodeStats, fmtBytes } from '../src/api/topology.js';

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
  const prev = globalThis.window;
  globalThis.window = { TerraTransport: {}, TerraTopology: buildTopology(NODES), TerraNodeStats: nodeStats, TerraFmtBytes: fmtBytes };
  try { return fn(); } finally { globalThis.window = prev; }
};
const render = (props) => withWindow(() => { const C = board('NodeStatus'); const c = new C(props); return c.renderVals(); });
const text = (v) => JSON.stringify(v);

test('NodeStatus 실제 — Master 기록 그대로, 200 GB · 1.7.x · 지어낸 healthcheck 없음', () => {
  const v = render({ nodeName: 'MARUI-NANO-DESK', nodeKind: '리프', nodeRid: 'n-desk' });
  assert.equal(v.core, '0.6.10'); assert.equal(v.stText, '온라인');
  const disk = v.bars.find((b) => b.name === 'DISK');
  assert.equal(disk.pctT, '81%'); assert.equal(disk.note, '829 GB / 1 TB');
  assert.equal(v.bars.find((b) => b.name === 'MEM').note, '총량 보고 없음');   // Master 가 총량을 안 실었으면 만들지 않는다
  assert.deepEqual(v.checks, []); assert.equal(v.pid, '—');
  assert.doesNotMatch(text(v), /200 GB|8\.0 GB|1\.7\.|heartbeat ok|svi lease/);
});

test('NodeStatus 실제 — 9/24 이후 끊긴 노드는 온라인이 아니다', () => {
  const v = render({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  assert.notEqual(v.stText, '온라인'); assert.equal(v.stText, '응답 없음'); assert.equal(v.core, '0.5.5');
  assert.match(v.uptime, /하트비트 \d+일 전/);
});

test('NodeStatus 실제 — Master 목록에 없는 노드(시안 지도 · rid 없음)는 값 없이', () => {
  const v = render({ nodeName: 'lab-ws-02', nodeKind: '리프', nodeRid: '' });
  assert.equal(v.stText, 'Master 기록 없음'); assert.deepEqual(v.bars, []); assert.equal(v.core, '—');
  assert.doesNotMatch(text(v), /온라인|200 GB|1\.7\./);
});

test('NodeStatus 시안(캔버스 · ?demo) — 예시 값은 그대로 남는다', () => {
  const prev = globalThis.window; globalThis.window = undefined;
  try { const C = board('NodeStatus'); const v = new C({ nodeName: '02·b', nodeKind: '리프' }).renderVals(); assert.match(v.bars[2].note, /\/ 200 GB/); }
  finally { globalThis.window = prev; }
});

test('NodeConf 실제 — 코어 1.7.0 · 지어낸 노드 id · 사용자 · 경보 대신 Master 기록 · 빈 값', () => withWindow(() => {
  const C = board('NodeConf'); const c = new C({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  c.skinOf = () => ''; c.profOf = () => '';   // localStorage 를 보지 않게
  const d = c.defaults();
  assert.equal(d['core.version'], '0.5.5'); assert.equal(d['registration.node_id'], 'n-rdk'); assert.equal(c.nodeId(), 'n-rdk');
  assert.deepEqual([d.users, d.codes, d.alerts], [[], [], []]);
  assert.doesNotMatch(JSON.stringify(d), /1\.7\.|terra\.local|TR-7Q2K|디스크 92%/);
}));

test('NodeStatus 실제 — 꺼진 노드의 자원 값은 마지막 보고로 표시', () => {
  const v = render({ nodeName: 'hanium', nodeKind: '리프', nodeRid: 'n-rdk' });
  for (const b of v.bars) assert.match(b.note, /^마지막 보고 · \d+일 전$/, b.name);
  const live = render({ nodeName: 'marui-server', nodeKind: '리프', nodeRid: 'n-server' });
  assert.equal(live.bars[0].note, ''); assert.equal(live.bars[2].note, '총량 보고 없음');
});
