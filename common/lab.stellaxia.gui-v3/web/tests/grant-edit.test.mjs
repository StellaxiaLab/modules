// node --test — 허가 고치기(grants.by-grant-id.patch): 좁히기는 통과 · 넓히기는 위임 가드, 바뀐 칸만 보낸다, NodeShare 사본 = src
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as G from '../src/api/svi-grant.js';
import * as sviRead from '../src/api/svi-read.js';
import { gate } from '../src/api/gates.js';

class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const SH = new Function('DCLogic', parseBoard(readFileSync(fileURLToPath(new URL('../design/NodeShare.dc.html', import.meta.url)), 'utf8')).script + '\nreturn { Component, grantNarrows, checkGrantEdit, grantPatch };')(DCLogic);

const NOW = Date.parse('2026-11-09T00:00:00Z'), DAY = 86400;
const node = { subject_type: 'node', subject_id: 'n2', operations: ['read', 'subscribe'], endpoint_id: '', expires_at: '2026-11-19T00:00:00Z' };   // 10일 남음

test('좁히기 — 작업 빼기 · 끝점 전체 → 하나 · 기한 앞당기기는 가드 없이 통과', () => {
  assert.deepEqual(G.checkGrantEdit(node, { operations: ['read'], endpoint_id: '', ttl_seconds: null }, 'u', NOW), { ok: true, why: '', narrows: true });
  assert.equal(G.checkGrantEdit(node, { operations: ['read', 'subscribe'], endpoint_id: 'v', ttl_seconds: null }, 'u', NOW).narrows, true);
  assert.equal(G.checkGrantEdit(node, { operations: ['read', 'subscribe'], endpoint_id: '', ttl_seconds: DAY }, 'u', NOW).narrows, true);
  // CLI 로 준 넓은 허가(write)도 빼기는 된다
  const wide = Object.assign({}, node, { operations: ['read', 'write'] });
  assert.equal(G.checkGrantEdit(wide, { operations: ['read'], endpoint_id: '', ttl_seconds: null }, 'u', NOW).ok, true);
});

test('넓히기 — 고친 뒤 허가에 위임 가드(작업 · 기한 90d)', () => {
  assert.equal(G.checkGrantEdit(node, { operations: ['read', 'subscribe', 'bind.source'], endpoint_id: '', ttl_seconds: null }, 'u', NOW).ok, true);
  assert.match(G.checkGrantEdit(node, { operations: ['read', 'bind.target'], endpoint_id: '', ttl_seconds: null }, 'u', NOW).why, /^넓히기 · 위임 가드 — 노드 : bind\.target 불가/);
  assert.equal(G.checkGrantEdit(node, { operations: ['read'], endpoint_id: '', ttl_seconds: 30 * DAY }, 'u', NOW).narrows, false);
  assert.equal(G.checkGrantEdit(node, { operations: ['read'], endpoint_id: '', ttl_seconds: 30 * DAY }, 'u', NOW).ok, true);
  const scoped = Object.assign({}, node, { endpoint_id: 'v' });
  assert.equal(G.checkGrantEdit(scoped, { operations: ['read'], endpoint_id: '', ttl_seconds: null }, 'u', NOW).narrows, false);
  // 남에게 준 사람 허가는 넓히지 못한다(D-3)
  const other = { subject_type: 'user', subject_id: 'x', operations: ['read'], endpoint_id: '', expires_at: null };
  assert.match(G.checkGrantEdit(other, { operations: ['read', 'inspect'], endpoint_id: '', ttl_seconds: DAY }, 'u', NOW).why, /사람은 나 자신만/);
  // 기한 없던 허가에 기한을 두는 것은 좁히기
  assert.equal(G.checkGrantEdit(other, { operations: ['read'], endpoint_id: '', ttl_seconds: DAY }, 'u', NOW).narrows, true);
});

test('막힘 — 작업 없음 · 바뀐 것 없음', () => {
  assert.equal(G.checkGrantEdit(node, { operations: [], endpoint_id: '', ttl_seconds: null }, 'u', NOW).why, '작업 1개 이상 선택');
  assert.equal(G.checkGrantEdit(node, { operations: ['subscribe', 'read'], endpoint_id: '', ttl_seconds: null }, 'u', NOW).why, '바뀐 것 없음');
});

test('patch 입력 — 바뀐 칸만, 작업은 GRANT_OPS 순서, 끝점 전체 = 빈 문자열', () => {
  assert.deepEqual(G.grantPatch(node, { operations: ['subscribe'], endpoint_id: '', ttl_seconds: null }), { operations: ['subscribe'] });
  assert.deepEqual(G.grantPatch(Object.assign({}, node, { endpoint_id: 'v' }), { operations: ['read', 'subscribe'], endpoint_id: '', ttl_seconds: 3600 }), { endpoint_id: '', ttl_seconds: 3600 });
  assert.deepEqual(G.grantPatch(node, { operations: ['bind.source', 'read', 'subscribe'], endpoint_id: '', ttl_seconds: null }), { operations: ['read', 'subscribe', 'bind.source'] });
});

test('NodeShare 사본 = src', () => {
  const cases = [[node, { operations: ['read'], endpoint_id: 'v', ttl_seconds: 3600 }], [node, { operations: ['read', 'bind.target'], endpoint_id: '', ttl_seconds: null }], [node, { operations: [], endpoint_id: '', ttl_seconds: null }]];
  for (const [b, a] of cases) {
    assert.deepEqual(SH.checkGrantEdit(b, a, 'u', NOW), G.checkGrantEdit(b, a, 'u', NOW));
    assert.deepEqual(SH.grantPatch(b, a), G.grantPatch(b, a));
    assert.equal(SH.grantNarrows(b, a, NOW), G.grantNarrows(b, a, NOW));
  }
});

// ── NodeShare 실제 — 수정 → 저장 = patch ──
const RES = { items: [{ resource_id: 'r1', node_id: 'n1', display_name: 'cam', status: 'available', endpoints: [{ endpoint_id: 'v', direction: 'source' }, { endpoint_id: 'a', direction: 'source' }] }] };
const GR = { items: [{ grant_id: 'g2', subject: { type: 'node', id: 'n2' }, resource_id: 'r1', operations: ['read', 'subscribe'], expires_at: '2099-01-01T00:00:00Z' }] };
const real = async (fn) => {
  const prev = globalThis.window, writes = [];
  globalThis.window = { TerraTransport: {}, TerraSvi: sviRead, TerraTopology: { node: () => ({ parent_node_id: 'nT' }) }, TerraWho: { principal: 'user:u-me via app' }, TerraGate: (op) => gate(op),
    TerraNodes: { t: { kind: 'gateway', localId: () => 'k1', meta: { k1: { rid: 'n1', name: 'desk' }, k2: { rid: 'n2', name: 'srv' } } }, subscribe: () => () => {}, refresh: () => {},
      read: (k, op) => ({ data: op.endsWith('resources.get') ? RES : op.endsWith('grants.get') ? GR : { items: [] } }), write: async (k, op, inp) => { writes.push([op, inp]); } } };
  try { await fn(new SH.Component({ nodeName: 'desk' }), writes); } finally { globalThis.window = prev; }
};

test('NodeShare 실제 — 수정: 대상 고정, 가드 밖 작업은 잠금, 저장은 patch(바뀐 칸만)', () => real(async (c, writes) => {
  let g = c.renderVals().grants[0];
  assert.equal(g.editing, false); g.edit(); g = c.renderVals().grants[0];
  assert.equal(g.editing, true);
  assert.deepEqual(g.eOps.filter((x) => !x.off).map((x) => x.name), ['읽기', '구독', '연결 원천']);
  assert.deepEqual(g.eEps.map((x) => x.name), ['전체', 'v', 'a']);
  assert.equal(g.eOff, 'disabled'); assert.equal(g.eNote, '바뀐 것 없음');
  g.eOps.find((x) => x.name === '구독').pick(); g = c.renderVals().grants[0];
  g.eEps.find((x) => x.name === 'v').pick(); g = c.renderVals().grants[0];
  assert.match(g.eNote, /^좁히기 — 위임 가드 통과 · 바뀜 : operations · endpoint_id$/);
  g.eSave(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes[0], ['terra.master.svi.grants.by-grant-id.patch', { grant_id: 'g2', operations: ['read'], endpoint_id: 'v' }]);
  assert.equal(c.renderVals().grants[0].editing, false);
  assert.equal(gate('terra.master.svi.grants.by-grant-id.patch').open, true);
}));

test('NodeShare 시안 — 수정해 저장하면 줄이 바뀌고 변경으로 센다', () => {
  const c = new SH.Component({ nodeName: '02·b' });
  let v = c.renderVals(); v.grants[0].edit(); v = c.renderVals();
  v.grants[0].eEps.find((x) => x.name === 'stream').pick(); v = c.renderVals();
  v.grants[0].eSave(); v = c.renderVals();
  assert.equal(v.grants[0].epT, '끝점 : stream'); assert.equal(v.dirtyT, '변경 1');
});
