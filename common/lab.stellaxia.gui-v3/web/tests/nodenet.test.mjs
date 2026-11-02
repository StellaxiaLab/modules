// node --test — 네트워크 속성 창(NodeNet 보드): 실제 모드에서 Master/Daemon 보고만 보이고, 시안 주소를 지어내지 않는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { netProps } from '../src/api/net-props.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Board = () => { const B = parseBoard(read('NodeNet')); return new Function('DCLogic', B.script + '\nreturn Component;')(DCLogic); };
const REC = { node_id: 'n-desk', display_name: 'desk', cluster_address: '100.80.0.11', dns_label: 'desk', relay_connected: true, status: 'online' };
const D = {
  status: { nodes: [{ node_id: 'n-desk', display_name: 'desk', status: 'online', relay_connected: true }, { node_id: 'n-srv', display_name: 'server' }] },
  state: { observed_transports: [{ node_id: 'n-desk', adapter: 'wireguard-bootstrap', details: { nat_identity: '203.0.113.9', nat_identity_source: 'stun', lan_endpoint: '192.168.7.4:51820' } }] },
  graph: { edges: [{ source_node_id: 'n-desk', target_node_id: 'n-srv', candidates: [{ route_type: 'lan_direct', adapter: 'tcp', healthy: true, latency_ms: 2 }], denied_candidates: [{ route_type: 'webrtc_p2p', reason: 'policy deny' }] }] },
};
const real = (fn) => { const prev = globalThis.window; globalThis.window = { TerraTransport: {}, TerraNetProps: Object.assign(async () => null, { pair: async () => ({ cands: [], denied: [], policy: 'default' }) }) }; try { return fn(); } finally { globalThis.window = prev; } };
const text = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));

test('NodeNet 실제 — 보고된 주소 · 경로만, 보고 안 된 칸은 —', () => real(() => {
  const C = Board(), c = new C({ nodeName: 'desk', nodeRid: 'n-desk' }); c.state.info = netProps(REC, D, { id: 'n-desk' });
  const v = c.renderVals(), A = (k) => v.addrs.find((a) => a.k === k).v;
  assert.equal(A('Terra 주소'), '100.80.0.11'); assert.equal(A('공인 IP'), '203.0.113.9'); assert.equal(A('로컬(LAN)'), '192.168.7.4:51820'); assert.equal(A('공인 endpoint'), '—');
  assert.equal(v.links[0].peer, 'server'); assert.equal(v.links[0].rt, 'LAN 직결'); assert.equal(v.links[0].lat, '2ms');
  assert.equal(v.src, 'Master · Daemon 보고');
  assert.doesNotMatch(text(v), /10\.40\.2\.|121\.\d+\.|home-mesh|stun\.l\.google/);   // 시안 값이 새지 않는다
  assert.ok(v.gaps.length >= 3);
}));

test('NodeNet 실제 — 줄을 펼치면 방향별 경로 · 거부 수, 후보 보기는 pair 를 부른다', () => real(() => {
  const C = Board(), c = new C({ nodeName: 'desk', nodeRid: 'n-desk' }); c._live = true; c.state.info = netProps(REC, D, { id: 'n-desk' });
  c.renderVals().links[0].toggle(); const L = c.renderVals().links[0];
  assert.equal(L.open, true); assert.match(L.rows.map((r) => r.k + ' ' + r.v).join('\n'), /→ 보낼 때 LAN 직결 · tcp · 2ms[\s\S]*거부된 후보 1개/);
  L.loadCand(); assert.equal(c.state.pair['n-srv'].busy, true);
}));

test('NodeNet 실제 — Master 목록 밖 노드 · 아직 못 받음', () => real(() => {
  const C = Board();
  assert.match(new C({ nodeName: 'x' }).renderVals().note, /Terra 노드 목록에 없는 노드/);
  const v = new C({ nodeName: 'desk', nodeRid: 'n-desk' }).renderVals(); assert.equal(v.note, '불러오는 중…'); assert.equal(v.addrs.length, 0);
}));

test('NodeNet 시안 — 실제 netProps 와 같은 칸 · 순서', () => {
  const prev = globalThis.window; globalThis.window = {};
  try {
    const C = Board(), s = new C({ nodeName: 'desk' }).sample(), r = netProps(REC, D, { id: 'n-desk' });
    assert.deepEqual(s.addrs.map((a) => a.k), r.addrs.filter((a) => a.k !== '사설망 IP').map((a) => a.k).toSpliced(2, 0, '사설망 IP'));
    for (const k of Object.keys(r)) assert.ok(k in s, k);
  } finally { globalThis.window = prev; }
});
