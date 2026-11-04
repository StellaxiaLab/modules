// node --test — 허가 주체(노드 · 사람): 보드(NodeShare · NodeSvi)의 가드 규칙 사본 = src/api/svi-grant.js, 실제 모드에서 '나'에게만 사람 허가를 보내고 남은 잠근다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as G from '../src/api/svi-grant.js';
import * as sviRead from '../src/api/svi-read.js';
import { gate } from '../src/api/gates.js';

class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const NAMES = 'GRANT_OPS, GUARD_OPS, GRANT_DEFAULTS, GUARD_MAX_TTL, GRANT_TTLS, OP_KO, selfIdOf, subjectRule, allowedOps, toggleOp, checkGrant, opsText';
const load = (n) => new Function('DCLogic', parseBoard(readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8')).script + '\nreturn { Component, ' + NAMES + ' };')(DCLogic);
const SH = load('NodeShare'), SV = load('NodeSvi');

test('보드 사본 = src — 주체별 작업 · 기한 · 거절 이유', () => {
  for (const B of [SH, SV]) {
    for (const k of ['GRANT_OPS', 'GUARD_OPS', 'GRANT_DEFAULTS', 'GUARD_MAX_TTL', 'GRANT_TTLS', 'OP_KO']) assert.deepEqual(B[k], G[k], k);
    for (const [t, id, me] of [['node', 'n', 'u'], ['user', 'u', 'u'], ['user', 'x', 'u'], ['user', 'u', ''], ['application', 'a', 'u']]) assert.deepEqual(B.subjectRule(t, id, me), G.subjectRule(t, id, me));
    for (const [t, p, op] of [['node', ['read'], 'bind.target'], ['user', ['read'], 'bind.target'], ['node', ['read', 'subscribe'], 'read']]) assert.deepEqual(B.toggleOp(t, p, op), G.toggleOp(t, p, op));
    for (const g of [{ subject_type: 'node', subject_id: 'n', operations: ['read'], ttl_seconds: 60 }, { subject_type: 'user', subject_id: 'x', operations: ['read'], ttl_seconds: 60 }, { subject_type: 'node', subject_id: 'n', operations: ['write'], ttl_seconds: 60 }, { subject_type: 'node', subject_id: 'n', operations: ['read'] }])
      assert.deepEqual(B.checkGrant(g, 'u'), G.checkGrant(g, 'u'));
    assert.equal(B.selfIdOf({ principal: 'user:u1 via app' }), 'u1'); assert.equal(B.opsText(['read']), G.opsText(['read']));
  }
});

// ── NodeShare 실제 ──
const RES = { items: [{ resource_id: 'r1', node_id: 'n1', display_name: 'cam', status: 'available', endpoints: [{ endpoint_id: 'v', direction: 'source' }] }] };
const GR = { items: [{ grant_id: 'g1', subject: { type: 'user', id: 'u-me' }, resource_id: 'r1', operations: ['inspect', 'read'], expires_at: '2099-01-01T00:00:00Z' }, { grant_id: 'g2', subject: { type: 'node', id: 'n2' }, resource_id: 'r1', operations: ['read', 'subscribe'] }] };
const shReal = (fn) => {
  const prev = globalThis.window, writes = [];
  globalThis.window = { TerraTransport: {}, TerraSvi: sviRead, TerraTopology: { node: (id) => (id === 'n1' ? { parent_node_id: 'nT' } : {}) }, TerraWho: { principal: 'user:u-me via lab.stellaxia.gui-v3.web' },
    TerraGate: (op) => gate(op),
    TerraNodes: { t: { kind: 'gateway', localId: () => 'k1', meta: { k1: { rid: 'n1', name: 'desk' }, k2: { rid: 'n2', name: 'srv' }, kT: { rid: 'nT', name: 'tree' } } }, subscribe: () => () => {}, refresh: () => {},
      read: (k, op) => ({ data: op.endsWith('resources.get') ? RES : op.endsWith('grants.get') ? GR : { items: [] } }), write: async (k, op, inp) => { writes.push([op, inp]); } } };
  try { const c = new SH.Component({ nodeName: 'desk' }); return fn(c, writes); } finally { globalThis.window = prev; }
};

test('NodeShare 실제 — 허가 목록에 사람 주체는 사람 · 나로, 주체 토글은 노드 · 사람', () => shReal((c) => {
  const v = c.renderVals();
  assert.deepEqual(v.grants.map((g) => [g.who, g.type, g.typeCls]), [['나 · u-me', '사람', 'us'], ['srv', 'Leaf', 'nd']]);
  assert.deepEqual(v.kindOpts.map((k) => k.name), ['노드', '사람']); assert.equal(v.isNodeKind, true);
  assert.deepEqual(v.opChips.filter((x) => !x.off).map((x) => x.name), ['읽기', '구독', '연결 원천']);
  assert.ok(v.ttlOpts.every((t) => t.name !== '없음'));
}));

test('NodeShare 실제 — 사람: 나만 고를 수 있고 사람 목록은 문이 잠근다(why), 공유는 grants.post subject user = 나', async () => shReal(async (c, writes) => {
  c.state.draft = Object.assign({}, c.state.draft, { kind: 'user' });
  let v = c.renderVals();
  assert.equal(v.isUserKind, true); assert.deepEqual(v.people.map((p) => [p.name, p.off]), [['나 · u-me', null]]);
  assert.match(v.peopleWhy, /^사람 목록 · .*terra\.master\.admin\.users\.get/); assert.match(v.peopleWhy, /위임 가드/);
  assert.deepEqual(v.opChips.filter((x) => !x.off).map((x) => x.name), ['살펴보기', '읽기', '구독', '연결 원천', '연결 대상']);
  assert.equal(v.opChips.find((x) => x.name === '쓰기').off, 'disabled');
  v.opChips.find((x) => x.name === '연결 대상').pick(); v = c.renderVals(); v.give(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes[0], ['terra.master.svi.grants.post', { subject_type: 'user', subject_id: 'u-me', resource_id: 'r1', operations: ['inspect', 'read', 'subscribe', 'bind.target'], ttl_seconds: 604800 }]);
  c.state.draft = Object.assign({}, c.state.draft, { me: false }); assert.equal(c.renderVals().giveOff, 'disabled');
}));

test('NodeShare 실제 — 노드: 가드 밖 작업은 보내지 않는다, 허락된 것만', async () => shReal(async (c, writes) => {
  c.state.draft = Object.assign({}, c.state.draft, { who: 'Tree' }); c.renderVals().give(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes[0], ['terra.master.svi.grants.post', { subject_type: 'node', subject_id: 'nT', resource_id: 'r1', operations: ['read', 'subscribe', 'bind.source'], ttl_seconds: 604800 }]);
  c.state.draft = Object.assign({}, c.state.draft, { ops: { node: [], user: [] } }); assert.equal(c.renderVals().giveOff, 'disabled');
}));

test('NodeShare 시안 — 다른 계정은 잠근 칩(가드 why), 나에게 공유하면 사람 줄이 생긴다', () => {
  const prev = globalThis.window; globalThis.window = undefined;
  try {
    const c = new SH.Component({}); c.state.draft = Object.assign({}, c.state.draft, { kind: 'user' });
    let v = c.renderVals(); assert.deepEqual(v.people.map((p) => p.off), [null, 'disabled', 'disabled']); assert.match(v.people[1].tip, /나 자신만/);
    c.state.res = 'tty0'; v = c.renderVals(); v.give(); v = c.renderVals(); assert.deepEqual(v.grants.map((g) => [g.who, g.type]), [['클러스터 전체', '전체'], ['나 · admin', '사람']]);
  } finally { globalThis.window = prev; }
});

// ── NodeSvi 실제 ──
const DATA = { miss: [], envelope: null, decls: [{ family: 'file', name: 'log', dir: 'source', resId: 'r1', state: 'applied', reason: '', detail: '/d/log' }], retired: [], nodes: [{ id: 'n1', name: 'desk' }, { id: 'n2', name: 'srv' }], eps: [],
  grants: [{ id: 'g9', type: 'user', subject: 'u-me', resId: 'r1', ops: ['inspect', 'read'] }], bindings: [] };
test('NodeSvi 실제 — 주체 사람이면 나 칩 하나(이미 있으면 켜짐 · 회수), 없으면 grantTo(user, 나)', async () => {
  const prev = globalThis.window, calls = [];
  globalThis.window = { TerraGate: (op) => gate(op), TerraSviTypes: () => [], TerraSviMake: { load: async () => DATA, selfNow: () => 'u-me', grant: async (...a) => calls.push(['grant', ...a]), grantTo: async (...a) => calls.push(['grantTo', ...a]), revoke: async (id) => calls.push(['revoke', id]) } };
  try {
    const c = new SV.Component({ nodeName: 'desk', nodeRid: 'n1' }); c._live = true; c.state.data = DATA; c.state.tab = 'res';
    let v = c.renderVals(); assert.equal(v.decls[0].gLabel, '허가한 노드'); assert.deepEqual(v.decls[0].nodes.map((n) => n.name), ['srv']);
    c.state.subj = 'user'; v = c.renderVals(); assert.equal(v.decls[0].gLabel, '허가한 사람'); assert.deepEqual(v.decls[0].nodes.map((n) => [n.name, n.on]), [['나 · u-me', 'true']]);
    assert.match(v.grantNote, /^사람 목록 · .*terra\.master\.admin\.users\.get/); assert.deepEqual(v.opChips.filter((x) => !x.off).map((x) => x.label), ['살펴보기', '읽기', '구독', '연결 원천', '연결 대상']);
    v.decls[0].nodes[0].toggle(); await new Promise((r) => setTimeout(r, 0)); assert.deepEqual(calls[0], ['revoke', 'g9']);
    c.state.data = Object.assign({}, DATA, { grants: [] }); c.renderVals().decls[0].nodes[0].toggle(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls[1], ['grantTo', 'user', 'u-me', 'r1', ['inspect', 'read', 'subscribe'], 604800]);
  } finally { globalThis.window = prev; }
});
