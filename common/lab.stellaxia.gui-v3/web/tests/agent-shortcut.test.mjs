// node --test — 바탕 모듈 앱 바로가기: 기본 agent 아이콘은 그 노드에 에이전트 모듈이 있을 때만, 눌러서 모듈 관리 창이 아니라 그 앱을,
//   없으면 '이 노드에 설치되지 않음'. 노드에 저장돼 있던 옛 agent 아이콘은 지우지 않고 회색 '설치 안 됨'으로.
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

// opts.mods — 노드의 모듈 · opts.saved — 노드에 저장된 바탕 구성(icons)
async function desk(opts) {
  globalThis.localStorage = mem();
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' } }, localId: () => 'L',
    invokeRid(rid, op) { return this.invoke(rid, op); },
    invoke(node, op) {
      if (op === 'terra.daemon.modules.get') return Promise.resolve({ modules: opts.mods });
      if (op === 'lab.stellaxia.gui-v3.node-desk.get') return Promise.resolve(opts.saved ? { revision: 1, doc: { icons: opts.saved } } : { revision: 0, doc: null });
      return Promise.resolve({});
    } };
  const launched = [];
  globalThis.window = { TerraTransport: t, TerraLaunch: (id) => { launched.push(id); return true; }, TerraGuiApps: opts.apps, addEventListener() {} };
  await loadStore();
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '' });
  const C = Desk(), c = new C({ nodeName: 'desk', nodeKey: 'L', nodeRid: 'nd_L', winW: 1240, winH: 760 }); c.persist = () => {};
  const said = []; c.say = (m) => said.push(m);
  c.renderVals(); await tick(10); c.renderVals(); await tick(10); c.renderVals();
  return { c, launched, said };
}
const AGENT = { id: 'io.terra.agent', name: '에이전트', state: 'running', enabled: true, version: '0.4.1' };
const APPS = [{ id: 'io.terra.agent.web', moduleId: 'io.terra.agent', name: '에이전트', mode: 'static', entry: 'index.html' }];

test('에이전트 모듈이 없는 노드 — 기본 agent 바로가기가 없다', async () => {
  const { c } = await desk({ mods: [], apps: [] });
  assert.ok(!c.ics().agent, '모듈이 없는데 agent 아이콘'); assert.ok(c.ics().jobs, 'Terra 기능 바로가기는 그대로');
});

test('모듈 목록을 못 읽은 노드 — 기본 agent 바로가기를 내지 않는다', async () => {
  const { c } = await desk({ mods: undefined, apps: null });
  assert.ok(!c.ics().agent);
});

test('에이전트가 있는 노드 — 바로가기를 누르면 모듈 관리 창이 아니라 에이전트 앱을 연다', async () => {
  const { c, launched } = await desk({ mods: [AGENT], apps: APPS });
  assert.ok(c.ics().agent, '모듈이 있으면 보인다');
  c.iconOpen('agent');
  assert.deepEqual(launched, ['io.terra.agent.web']); assert.ok(!c.state.wins.mods, '모듈 관리 창이 열리지 않는다');
});

test('노드에 저장된 옛 agent 아이콘 — 설치 안 됨이면 회색으로 남고 누르면 안내', async () => {
  const saved = { agent: { c: 1, r: 0, name: '에이전트', k: 'short', app: 'mods', mod: 'agent', src: '모듈 · 에이전트' } };
  const { c, launched, said } = await desk({ mods: [], apps: [], saved });
  const ic = c.ics().agent; assert.ok(ic, '조용히 지우지 않는다'); assert.match(ic.off, /설치 안 됨/);
  const row = c.renderVals().icons.find((i) => /에이전트/.test(i.name)); assert.match(row.name, /설치 안 됨/); assert.ok(row.op < 1);
  c.iconOpen('agent'); assert.deepEqual(said, ['이 노드에 설치되지 않음']); assert.deepEqual(launched, []); assert.ok(!c.state.wins.mods);
});

test('사용자가 고정한 모듈 앱 바로가기(moduleId/appId) — 같은 길 · 같은 안내', async () => {
  const saved = { 'm-x': { c: 2, r: 0, name: '에이전트 웹', k: 'short', app: 'mods', mod: 'io.terra.agent/io.terra.agent.web' }, 'm-y': { c: 2, r: 1, name: '없는 앱', k: 'short', app: 'mods', mod: 'io.terra.gone/x' } };
  const { c, launched, said } = await desk({ mods: [AGENT], apps: APPS, saved });
  c.iconOpen('m-x'); assert.deepEqual(launched, ['io.terra.agent.web']);
  said.length = 0; c.iconOpen('m-y'); assert.deepEqual(said, ['이 노드에 설치되지 않음']);
});
