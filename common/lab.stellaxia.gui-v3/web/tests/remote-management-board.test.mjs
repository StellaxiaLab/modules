// node --test — 원격 제어기의 원격 관리 잠금 칩 · 쓰기 문 · 위험 영역 줄 · 경고 띠 (P15-4)
//   TerraNodes(보드 그대로) + 시험 전송(kind gateway) + 실제 src/api 모듈들.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import * as deskAdapt from '../src/api/desk-adapt.js';
import { gate } from '../src/api/gates.js';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const src = readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = () => new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);
async function loadStore(transport) {
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}

import * as RM from '../src/api/remote-management.js';

const SW = { on: { enabled: true, duration: '1h', expires_at: new Date(Date.now() + 58 * 60000).toISOString(), changed_by: 'maru' }, off: { enabled: false, duration: '', expires_at: '' } };
function fakeGateway(sw) {
  const calls = [], ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' }, R: { id: 'R', name: 'lab-ws-02', rid: 'nd_R' } }, localId: () => 'L', calls, sw,
    invoke(node, op, i) {
      calls.push([node, op, i]);
      if (op === RM.REMOTE_GET) return sw[node] ? ok(sw[node]) : Promise.reject({ code: 'NODE_OFFLINE', message: 'x' });
      if (op === 'terra.daemon.config.get') return ok({ config: { master: { url: 'https://tree:8080' } } });
      if (op === 'terra.daemon.config.schema.get') return ok({ fields: {} });
      if (op === 'terra.daemon.modules.get') return ok({ modules: [] });
      if (op.startsWith('terra.daemon.') || op.startsWith('terra.master.')) return ok({});
      return Promise.reject({ code: 'OP_UNKNOWN', message: op });
    } };
  return t;
}
async function board(sw, props) {
  globalThis.localStorage = mem();
  const t = fakeGateway(sw); globalThis.window = { TerraTransport: t };
  const T = await loadStore(t);
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '', TerraRemoteMgmt: { view: RM.remoteMgmtView, chip: RM.remoteChip, canAsk: () => false }, TerraErrorSilent: () => false });
  const C = Desk(), c = new C(Object.assign({ nodeName: 'x', winW: 1240, winH: 760 }, props)); c.persist = () => {};
  c.renderVals(); await tick(10); c.renderVals(); await tick(10);
  return { c, t, T };
}
const wins = (c) => c.renderVals().wins;
const btn = (list, label) => list.find((b) => b.label === label);
const openSet = (c) => { c.launch('set'); Object.assign(c.state, { setTab: 'node' }); const w = wins(c).find((x) => x.app === 'set'); return w; };

test('원격 제어기 — 그 노드의 원격 관리가 꺼져 있으면 칩 · 저장 · 다시 시작 · 동기화가 잠기고 이유를 말한다, 설정 칸은 읽기 전용', async () => {
  const { c } = await board({ L: SW.off, R: SW.off }, { nodeName: 'lab-ws-02', nodeKey: 'R', remote: true });
  const w = openSet(c), X = w.nx;
  assert.equal(X.rmc.on, true); assert.equal(X.rmc.chip, '원격 관리 꺼짐'); assert.match(X.rmc.why, /lab-ws-02 의 원격 관리가 꺼져 있음/);
  const save = btn(X.cfgBtns, '저장'); assert.equal(save.lock, true); assert.match(save.tip, /^잠김 : lab-ws-02 의 원격 관리가 꺼져 있음/);
  assert.equal(btn(X.cfgBtns, '다시 시작').lock, true);
  assert.equal(X.keys.every((k) => k.dis === 'disabled'), true); assert.equal(X.keys.length > 0, true);
  assert.match(X.dzR.status, /^꺼짐/); assert.equal(X.dzR.dis, 'disabled'); assert.match(X.dzR.why, /이 노드에서만/);
});

test('원격 제어기 — 켜져 있으면 칩에 남은 시간, 저장 · 다시 시작이 열리고 설정 칸을 고칠 수 있다(승인 문은 전송 층)', async () => {
  const { c } = await board({ L: SW.off, R: SW.on }, { nodeName: 'lab-ws-02', nodeKey: 'R', remote: true });
  const X = openSet(c).nx;
  assert.equal(X.rmc.on, true); assert.match(X.rmc.chip, /^원격 관리 켜짐 · \d+분 남음$/); assert.equal(X.rmc.cls, 'warn');
  assert.equal(btn(X.cfgBtns, '저장').lock, false); assert.equal(btn(X.cfgBtns, '다시 시작').lock, false);
  assert.equal(X.keys.some((k) => k.dis !== 'disabled'), true, '고칠 수 있는 설정 칸');
  assert.match(X.dzR.status, /^허용 중 · \d+분 남음/);
});

test('원격 제어기 — 스위치를 못 읽으면(끊김) 잠그지 않는다 · 칩도 없다(서버가 가른다)', async () => {
  const { c } = await board({ L: SW.off }, { nodeName: 'lab-ws-02', nodeKey: 'R', remote: true });
  const X = openSet(c).nx;
  assert.equal(X.rmc.on, false); assert.equal(btn(X.cfgBtns, '저장').lock, false);
  assert.match(X.dzR.status, /읽지 못함/);
});

test('이 노드의 제어기 — 칩 없음 · 저장 열림 · 위험 영역 줄은 터미널 문구, 켜져 있으면 경고 띠에 원격 관리', async () => {
  const { c } = await board({ L: SW.on }, { nodeName: 'desk', nodeKey: 'L' });
  const X = openSet(c).nx;
  assert.equal(X.rmc.on, false); assert.equal(btn(X.cfgBtns, '저장').lock, false);
  assert.match(X.dzR.status, /^허용 중/); assert.equal(X.dzR.dis, 'disabled'); assert.ok(X.dzR.why.includes(RM.REMOTE_SET_HINT));
  const dgr = c.renderVals().dgr; assert.equal(dgr.d, 'inline-flex'); assert.match(dgr.banner, /원격 관리/); assert.match(dgr.tip, /다른 노드의 사람이 승인 문으로/);
});

test('이 노드의 제어기 — 꺼져 있으면 경고 띠 없음', async () => {
  const { c } = await board({ L: SW.off }, { nodeName: 'desk', nodeKey: 'L' });
  openSet(c); assert.equal(c.renderVals().dgr.d, 'none');
});
