// node --test — 자원화 창(NodeSvi): 보드의 시안 사본이 src/api/svi-make.js 와 같은지, 실제 모드에서 선언 · 허가 · 연결을 부르는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { BUILTIN_TYPES, formFields, validate, canLink, bindingState } from '../src/api/svi-make.js';

const src = readFileSync(fileURLToPath(new URL('../design/NodeSvi.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const script = parseBoard(src).script;
const lib = new Function('DCLogic', script + '\nreturn { Component, BUILTIN, fieldsOf, check, linkable, ST };')(DCLogic);
const strip = (t) => ({ id: t.id, family: t.family, title: t.title, required: t.schema.required, props: t.schema.properties });

test('보드 사본 = src — 내장 유형 스키마 · 칸 · 검사 · 이을 수 있나 · 상태 이름', () => {
  assert.deepEqual(lib.BUILTIN.map(strip), BUILTIN_TYPES.map(strip));
  for (const t of BUILTIN_TYPES) {
    const vals = { path: 'x', command: '/bin/a', args: ['a', 'b'], address: 'tcp://h:1' };
    assert.deepEqual(lib.fieldsOf(t.schema, vals).map((f) => [f.key, f.kind, f.value, f.required]), formFields(t.schema, vals).map((f) => [f.key, f.kind, f.value, f.required]));
    for (const [n, v] of [['', {}], ['Bad', { path: 'rel' }], ['ok', { path: '/a', command: '/b', address: 'udp://h:9' }]]) assert.deepEqual(lib.check(t.schema, n, v), validate(t.schema, n, v));
  }
  const E = (dir, interaction, schema, resId = Math.random()) => ({ resId, dir, interaction, schema });
  for (const [a, b] of [[E('source', 'stream', 'terra.bytes@1'), E('sink', 'stream', 'terra.bytes@1')], [E('sink', 'stream'), E('sink', 'stream')], [E('source', 'stream', 'terra.a@1'), E('sink', 'stream', 'terra.b@1')], [E('source', 'stream'), E('sink', 'command')], [E('source', 'stream', 'terra.a@1'), E('sink', 'blob', 'terra.a@2')]])
    assert.deepEqual(lib.linkable(a, b), canLink(a, b));
  for (const k of Object.keys(lib.ST)) assert.equal(lib.ST[k][0], bindingState({ observed_state: k }).label, k);
});

const DATA = { miss: [], envelope: { file_roots: [{ path: '/data' }], process: 'off', net: false, net_endpoints: [] }, decls: [], retired: [], nodes: [{ id: 'n1', name: 'desk' }, { id: 'n2', name: 'srv' }],
  eps: [{ resId: 'r1', resName: 'log', node: 'n1', epId: 'out', dir: 'source', interaction: 'stream', schema: 'terra.bytes@1' }, { resId: 'r2', resName: 'sink', node: 'n2', epId: 'in', dir: 'sink', interaction: 'stream', schema: 'terra.bytes@1' }],
  grants: [], bindings: [{ id: 'b1', src: { resource_id: 'r1', endpoint_id: 'out' }, dst: { resource_id: 'r2', endpoint_id: 'in' }, srcNode: 'n1', dstNode: 'n2', st: bindingState({ observed_state: 'degraded', reason: 'participant_disconnected' }) }] };
const real = (calls, mods = []) => ({ TerraSviMake: { load: async () => DATA, declare: async (rid, inp) => { calls.push(['declare', rid, inp]); }, grant: async (...a) => { calls.push(['grant', ...a]); }, link: async (a, b) => { calls.push(['link', a.resId, b.resId]); }, unlink: async (id) => { calls.push(['unlink', id]); } }, TerraSviTypes: () => mods });
const mount = (win, props) => { const prev = globalThis.window; globalThis.window = win; const c = new lib.Component(Object.assign({ nodeName: 'desk', nodeRid: 'n1' }, props)); c._live = true; c.state.data = DATA; return { c, done: () => { globalThis.window = prev; } }; };

test('실제 — 시안 값이 새지 않고, 모듈 유형이 없으면 그 까닭을 적는다', () => {
  const { c, done } = mount(real([])); try {
    const v = c.renderVals(), txt = JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
    assert.doesNotMatch(txt, /cam-front|meter-log|io\.lab\.camera|\/srv\/share/);
    assert.equal(v.src, 'Terra'); assert.match(v.typeGroups[1].emptyT, /Terra 에 아직 없다/); assert.equal(v.env[0].v, '/data');
    assert.equal(v.binds[0].label, '끊김'); assert.equal(v.binds[0].reason, '한쪽 노드 연결 끊김');
  } finally { done(); }
});

test('실제 — 양식 제출은 declarations 입력 그대로, 울타리 밖이면 미리 알림', async () => {
  const calls = [], { c, done } = mount(real(calls), { pre: JSON.stringify({ type: 'file', name: 'log2', values: { path: '/etc/x' } }) }); try {
    let v = c.renderVals(); assert.equal(v.envBad, true); assert.match(v.envWhy, /열린 폴더 밖 — \/data/);
    c.setState({ vals: { path: '/data/a.csv', direction: 'source' } }); c.renderVals().submit(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls[0], ['declare', 'n1', { family: 'file', name: 'log2', direction: 'source', path: '/data/a.csv' }]);
  } finally { done(); }
});

test('실제 — 모듈이 내놓은 유형은 양식만 그리고 만들기는 잠금', () => {
  const T = [{ id: 'io.x/cam', module: 'io.x', moduleName: 'X', title: '카메라', schema: { required: ['url'], properties: { url: { type: 'string', title: 'RTSP 주소' } } } }];
  const { c, done } = mount(real([], T)); try {
    c.setState({ typeId: 'io.x/cam' }); const v = c.renderVals();
    assert.deepEqual(v.fields.map((f) => f.title), ['RTSP 주소']); assert.equal(v.makeOff, true); assert.equal(v.makeT, '만들기 — 코어 대기');
  } finally { done(); }
});

test('실제 — 원천 누르고 대상 누르면 link, 허가 칩은 grant(읽기 · 연결 원천 · 기한)', async () => {
  const calls = [], { c, done } = mount(real(calls)); try {
    c.setState({ tab: 'link' }); c.renderVals().srcs[0].pick(); c.renderVals().dsts[0].pick(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls[0], ['link', 'r1', 'r2']);
    c.state.data = Object.assign({}, DATA, { decls: [{ family: 'file', name: 'log', dir: 'source', resId: 'r1', state: 'applied', reason: '', detail: '/data/log' }] });
    c.renderVals().decls[0].nodes[0].toggle(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls[1], ['grant', 'r1', 'n2', ['read', 'subscribe', 'bind.source'], 604800]);
  } finally { done(); }
});
