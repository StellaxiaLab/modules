// node --test — AUD-86: SVI 만들기의 "같은 이름 자원 교체" 칸은 앱(위임) 토큰이면 잠기고 이유를 보인다 — Terra 는 앱 토큰의 replace 를 403 DELEGATION_NOT_OPEN 으로 늘 거절한다(daemon_delegation.go)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { gate } from '../src/api/gates.js';

const src = readFileSync(fileURLToPath(new URL('../design/NodeSvi.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Comp = new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);
const DATA = { miss: [], envelope: { file_roots: [{ path: '/data' }], process: 'off', net: false, net_endpoints: [] }, decls: [{ family: 'file', name: 'log2', dir: 'source', resId: 'r-log2', origin: 'runtime', state: 'applied', reason: '', detail: '/data/a' }],
  retired: [], nodes: [{ id: 'n1', name: 'desk' }], eps: [], grants: [], bindings: [] };
const real = (calls, G) => Object.assign({ TerraSviMake: { load: async () => DATA, declare: async (rid, inp) => { calls.push(['declare', rid, inp]); } }, TerraSviTypes: () => [] }, G ? { TerraGate: G } : {});
const mount = (win) => {
  const prev = globalThis.window; globalThis.window = win;
  const c = new Comp({ nodeName: 'desk', nodeRid: 'n1', pre: JSON.stringify({ type: 'file', name: 'log2', values: { path: '/data/a.csv', direction: 'source' } }) }); c._live = true; c.state.data = DATA;
  return { c, done: () => { globalThis.window = prev; } };
};

test('gate — 앱 토큰으로 선언 replace 는 늘 닫힘(다른 선언은 그대로)', () => {
  const g = gate('terra.daemon.svi.declarations.post', { replace: true });
  assert.equal(g.open, false); assert.match(g.why, /^잠김 : 앱 토큰에 닫힘 — 같은 이름 자원 교체/);
  assert.equal(gate('terra.daemon.svi.declarations.post', { family: 'file' }).open, true);
});

test('실제 · 앱 토큰 — 같은 이름이 있으면 교체 칸이 잠기고 이유, 켜져 있어도 replace 를 보내지 않는다', async () => {
  const calls = [], { c, done } = mount(real(calls, (op, o) => gate(op, o))); try {
    let v = c.renderVals(); assert.equal(v.exists, true);
    assert.equal(v.repDis, 'disabled'); assert.match(v.repWhy, /앱 토큰에 닫힘/); assert.equal(v.onReplace, null);
    c.setState({ replace: true });   // 옛 상태가 남아 있어도
    v = c.renderVals(); assert.equal(v.replace, false, '켜진 채로 보이지 않는다'); v.submit(); await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 0, '거절될 게 뻔한 선언을 보내지 않는다'); assert.match(c.renderVals().msg, /같은 이름 있음 — 교체는 앱 토큰에 닫힘/);
  } finally { done(); }
});

test('시안(문 없음) — 교체 칸은 그대로 켤 수 있다', () => {
  const { c, done } = mount(real([], null)); try {
    const v = c.renderVals(); assert.equal(v.exists, true); assert.equal(v.repDis, null); assert.equal(typeof v.onReplace, 'function');
  } finally { done(); }
});
