// node --test — 다른 노드의 앱 열기(Terra #394): 셸의 terra.app:launch 에 { appId, moduleId, nodeId, nodeName } 로 부탁한다(이 노드는 appId 그대로).
//   제어기 모듈 창 · 모듈 앱 바로가기 · 브라우저 카탈로그(remote-apps.test.mjs) · 모듈 상태 창이 같은 길. 옛 "셸이 아직 열 수 없음" 안내는 없다 — 셸이 못 받으면 셸의 오류가 보인다.
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
}
const APPS = [{ id: 'io.terra.agent.web', moduleId: 'io.terra.agent', name: '에이전트', mode: 'static', entry: 'index.html' }];

async function desk(remote, saved) {
  globalThis.localStorage = mem();
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' }, R: { id: 'R', name: 'far', rid: 'nd_R' } }, localId: () => 'L', invokeRid(rid, op) { return this.invoke(rid, op); },
    invoke(node, op) {
      if (op === 'terra.daemon.modules.get') return Promise.resolve({ modules: [{ id: 'io.terra.agent', name: '에이전트', state: 'running', enabled: true, version: '0.4.1' }] });
      if (op === 'lab.stellaxia.gui-v3.node-desk.get') return Promise.resolve(saved ? { revision: 1, doc: { icons: saved } } : { revision: 0, doc: null });
      return Promise.resolve({});
    } };
  const launched = [];
  globalThis.window = { TerraTransport: t, TerraLaunch: (...a) => { launched.push(a); return true; }, TerraGuiApps: APPS, addEventListener() {},
    TerraRemoteApps: { get: (id) => (id === 'nd_R' ? { state: 'ok', apps: APPS } : undefined) } };
  await loadStore();
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '' });
  const C = Desk(), c = new C({ nodeName: remote ? 'far' : 'desk', nodeKey: remote ? 'R' : 'L', nodeRid: remote ? 'nd_R' : 'nd_L', remote, winW: 1240, winH: 760 }); c.persist = () => {};
  const said = []; c.say = (m) => said.push(m);
  c.renderVals(); await tick(10); c.renderVals(); await tick(10); c.renderVals();
  return { c, launched, said };
}

test('제어기(다른 노드) 모듈 창 [열기] — 셸에 { appId, moduleId, nodeId, nodeName } 로 부탁한다, 옛 안내 없음', async () => {
  const { c, launched, said } = await desk(true);
  c.state.modView = 'inst'; c.launch('mods');
  const W = c.renderVals().wins.find((w) => w.id === 'mods'), open = W.nx.m.apps[0].btns.find((b) => b.label === '열기');
  assert.ok(open && open.run, '열기 단추'); open.run();
  assert.deepEqual(launched, [['io.terra.agent.web', { moduleId: 'io.terra.agent', nodeId: 'nd_R', nodeName: 'far' }]]);
  assert.ok(!said.some((m) => /아직 열 수 없음/.test(m)), said.join());
});

test('이 노드의 앱은 그대로 appId 만', async () => {
  const { c, launched } = await desk(false);
  c.state.modView = 'inst'; c.launch('mods');
  const W = c.renderVals().wins.find((w) => w.id === 'mods'); W.nx.m.apps[0].btns.find((b) => b.label === '열기').run();
  assert.deepEqual(launched, [['io.terra.agent.web']]);
});

test('다른 노드의 모듈 앱 바로가기 — 같은 payload', async () => {
  const saved = { 'm-x': { c: 2, r: 0, name: '에이전트 웹', k: 'short', app: 'mods', mod: 'io.terra.agent/io.terra.agent.web' } };
  const { c, launched } = await desk(true, saved);
  c.iconOpen('m-x');
  assert.deepEqual(launched, [['io.terra.agent.web', { moduleId: 'io.terra.agent', nodeId: 'nd_R', nodeName: 'far' }]]);
});

test('main.js — TerraLaunch 는 원격이면 { appId, moduleId, nodeId, nodeName } 을 emit 한다(이 노드는 appId)', () => {
  const s = readFileSync(join(D, '../src/boot/main.js'), 'utf8'), line = s.split('\n').find((l) => l.includes('window.TerraLaunch ='));
  const frame = { got: [], emit(k, v) { this.got.push([k, v]); } }, MODE = 'app';
  const fn = new Function('MODE', 'frame', 'window', line.trim() + '\nreturn window.TerraLaunch;')(MODE, frame, {});
  assert.equal(fn('a1'), true); assert.equal(fn('a2', { moduleId: 'm', nodeId: 'n', nodeName: 'far' }), true);
  assert.deepEqual(frame.got, [['launch', 'a1'], ['launch', { appId: 'a2', moduleId: 'm', nodeId: 'n', nodeName: 'far' }]]);
});

// AUD-82(실측 s3-gui): gui-v3.app.launch 의 payload 가 {"appId":"$input.value"} 라 객체 입력이
// { appId: {appId,moduleId,nodeId,nodeName} } 로 감싸져 셸이 읽지 못했다. 입력 전체를 그대로 올린다.
test('Scene — gui-v3.app.launch 는 입력 전체를 terra.app:launch 로 올린다(문자열 · 객체 둘 다 셸이 읽는 모양)', () => {
  const fn = JSON.parse(readFileSync(fileURLToPath(new URL('../../scene/contract/functions/app.launch.function.json', import.meta.url)), 'utf8'));
  const emit = fn.graph.nodes.find((n) => n.type === 'emit'); assert.equal(emit.signal, 'terra.app:launch');
  const ev = (x, input) => (typeof x === 'string' ? (x === '$input.value' ? input.value : x) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ev(v, input)])));
  // Terra runtime-core ScenePlayerSurface.readLaunchTarget 와 같은 규칙(문자열 또는 { appId, moduleId?, nodeId?, nodeName? })
  const read = (p) => { const t = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    if (typeof p === 'string') return t(p) ? { appId: t(p) } : undefined;
    if (p && typeof p === 'object') { const a = t(p.appId); return a ? { appId: a, ...(t(p.moduleId) ? { moduleId: t(p.moduleId) } : {}), ...(t(p.nodeId) ? { nodeId: t(p.nodeId) } : {}), ...(t(p.nodeName) ? { nodeName: t(p.nodeName) } : {}) } : undefined; } return undefined; };
  const remote = { appId: 'io.terra.agent.web', moduleId: 'io.terra.agent', nodeId: 'nd_R', nodeName: 'far' };
  assert.deepEqual(read(ev(emit.payload, { value: remote })), remote, '원격: 객체 그대로');
  assert.deepEqual(read(ev(emit.payload, { value: 'io.terra.agent.web' })), { appId: 'io.terra.agent.web' }, '이 노드: appId 문자열');
});
