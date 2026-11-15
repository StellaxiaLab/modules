// node --test — AUD-69: 모듈 창의 끄기 · 켜기 · 이전 버전으로가 Terra 의 POST modules/{id}/disable | enable | rollback
//   (Daemon op terra.daemon.modules.by-module-id.*.post, module.manage) 를 실제로 부른다 — 이 노드는 로컬 길, 다른 노드는 같은 op 를 노드 지정으로.
//   501(옛 Terra)은 솔직한 문구, 꺼진 모듈은 목록에서 흐리게 '꺼짐'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import * as deskAdapt from '../src/api/desk-adapt.js';
import * as changes from '../src/api/changes.js';
import { gate } from '../src/api/gates.js';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const src = readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = () => new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);

async function loadStore() {
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}

// opts.mods — 노드의 모듈 · opts.fail — 쓰기 op 가 던질 오류 · opts.remote — 다른 노드의 제어기
async function desk(opts) {
  globalThis.localStorage = mem();
  const calls = [];
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' }, R: { id: 'R', name: 'far', rid: 'nd_R' } }, localId: () => 'L',
    invokeRid(rid, op, input) { return this.invoke(rid, op, input); },
    invoke(node, op, input) {
      if (op === 'terra.daemon.modules.get') return Promise.resolve({ modules: opts.mods });
      if (/\.by-module-id\.(disable|enable|rollback)\.post$/.test(op)) { calls.push({ node, op, input }); return opts.fail ? Promise.reject(opts.fail) : Promise.resolve({ ok: true }); }
      return Promise.resolve({});
    } };
  globalThis.window = { TerraTransport: t, TerraGuiApps: [], addEventListener() {} };
  await loadStore();
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '' });
  const C = Desk(), r = !!opts.remote, c = new C({ nodeName: r ? 'far' : 'desk', nodeKey: r ? 'R' : 'L', nodeRid: r ? 'nd_R' : 'nd_L', remote: r, winW: 1240, winH: 760 }); c.persist = () => {};
  const said = []; c.say = (m) => said.push(m);
  c.renderVals(); await tick(10); c.renderVals(); await tick(10); c.renderVals();
  return { c, calls, said };
}
const mod = (o) => Object.assign({ id: 'io.terra.agent', name: '에이전트', state: 'running', enabled: true, version: '0.4.1' }, o);
const btnOf = (c, label) => c.modBtns(c.nd().mods[0], 0).find((x) => x.label.startsWith(label));

test('이 노드 — 끄기는 modules.by-module-id.disable.post 를 module_id 로 부른다(잠기지 않는다)', async () => {
  const { c, calls } = await desk({ mods: [mod()] });
  const b = btnOf(c, '끄기'); assert.ok(b, '끄기 단추'); assert.ok(!b.lock && !b.dis, '실제 모드에서 잠기지 않는다');
  b.run(); await tick(10);
  assert.deepEqual(calls.map((x) => [x.node, x.op, x.input]), [['L', 'terra.daemon.modules.by-module-id.disable.post', { module_id: 'io.terra.agent' }]]);
});

test('꺼진 모듈(state disabled) — 켜기 단추가 enable.post 를 부른다', async () => {
  const { c, calls } = await desk({ mods: [mod({ state: 'disabled', enabled: false })] });
  assert.ok(!btnOf(c, '끄기'), '꺼진 모듈에 끄기 없음');
  const b = btnOf(c, '켜기'); assert.ok(b && !b.lock && !b.dis);
  b.run(); await tick(10);
  assert.deepEqual(calls.map((x) => [x.node, x.op, x.input]), [['L', 'terra.daemon.modules.by-module-id.enable.post', { module_id: 'io.terra.agent' }]]);
});

test('다른 노드 — 같은 op 를 그 노드로(노드 지정) 부른다', async () => {
  const { c, calls } = await desk({ mods: [mod()], remote: true });
  const b = btnOf(c, '끄기'); assert.ok(b && !b.lock, '원격에서도 열림(cluster 범위)');
  b.run(); await tick(10);
  assert.deepEqual(calls.map((x) => [x.node, x.op]), [['R', 'terra.daemon.modules.by-module-id.disable.post']]);
});

test('이전 버전으로 — 확인을 거쳐 rollback.post, 확인에 이전 버전이 보인다', async () => {
  const { c, calls } = await desk({ mods: [mod({ rollback_version: '0.4.0' })] });
  const b = btnOf(c, '이전 버전으로'); assert.ok(b && !b.lock && !b.dis); assert.match(b.label, /0\.4\.0/);
  b.run(); assert.equal(calls.length, 0, '누르자마자 부르지 않는다(확인 먼저)');
  const S = c.state.cfm.spec; assert.equal(S.op, 'terra.daemon.modules.by-module-id.rollback.post');
  assert.match(JSON.stringify(S.steps), /0\.4\.0/);
  await S.final.run({}); assert.deepEqual(calls.map((x) => [x.node, x.op, x.input]), [['L', 'terra.daemon.modules.by-module-id.rollback.post', { module_id: 'io.terra.agent' }]]);
});

test('501(옛 Terra) — 솔직한 문구, 성공 문구 없음', async () => {
  const e = Object.assign(new Error('not implemented'), { status: 501, code: 'NOT_IMPLEMENTED' });
  const { c, said } = await desk({ mods: [mod()], fail: e });
  btnOf(c, '끄기').run(); await tick(10);
  assert.equal(said.length, 1); assert.match(said[0], /이 노드의 Terra가 아직 지원하지 않음/); assert.doesNotMatch(said[0], /끔$/);
});

test('409 NO_ROLLBACK · 404 MODULE_NOT_INSTALLED — 이유를 말한다(롤백 확인 결과 줄)', async () => {
  for (const [code, re] of [['NO_ROLLBACK', /이전 버전이 없/], ['ROLLBACK_VERSION_MISSING', /이전 버전 .*없/], ['MODULE_NOT_INSTALLED', /번들|설치/], ['MODULE_NOT_FOUND', /찾을 수 없/]]) {
    const { c } = await desk({ mods: [mod()], fail: Object.assign(new Error('x'), { code, status: code === 'MODULE_NOT_FOUND' || code === 'MODULE_NOT_INSTALLED' ? 404 : 409 }) });
    btnOf(c, '이전 버전으로').run(); const S = c.state.cfm.spec;
    await assert.rejects(S.final.run({}), (e) => { assert.equal(e.code, code); return true; });
    assert.match(S.final.fail(code), re, code);
  }
});

test('꺼진 모듈은 목록에서 흐리게 · "꺼짐"', async () => {
  const { c } = await desk({ mods: [mod({ state: 'disabled', enabled: false }), mod({ id: 'io.terra.file', name: '파일' })] });
  c.launch('mods'); const W = c.renderVals().wins.find((w) => w.id === 'mods'), L = W.nx.mods;
  assert.match(L[0].ver, /꺼짐/); assert.match(L[0].cls, /dim/); assert.doesNotMatch(L[1].ver, /꺼짐/); assert.doesNotMatch(L[1].cls, /dim/);
  assert.equal(W.nx.m.stT, '꺼짐');
});
