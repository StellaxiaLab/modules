// node --test — 제어기(NodeDesktopEmbed) 단추가 실제 모드에서 진짜 operation 을 부른다 (AUD-76 · 77 · 78 · 83 · 84 · 87)
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

/** 시험 전송 — 이 노드(L)의 Daemon · Master 를 흉내. S 는 노드 쪽 값(쓰기가 바꾼다) */
function fakeGateway() {
  const calls = [];
  const S = { cfg: { master: { url: 'https://tree:8080' }, heartbeat: { interval_sec: '10' }, storage: { shared_dirs: [{ name: 'docs', path: '/srv/docs' }], memos_dir: '' }, local_fs: { enabled: true } },
    devs: [{ id: 'dev-1', name: 'cam0', alias: '', kind: 'camera', present: true, approval: 'approved', enabled: true }], health: { status: 'ok' }, failOps: {}, restart: false };
  const ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' } }, localId: () => 'L', calls, S,
    invoke(node, op, i) {
      calls.push([node, op, i]);
      if (S.failOps[op]) return Promise.reject(S.failOps[op]);
      if (op === 'terra.daemon.config.get') return ok({ config: S.cfg });
      if (op === 'terra.daemon.config.patch') { for (const k in i.set) { const [a, b] = k.split('.'); if (b !== undefined) (S.cfg[a] = S.cfg[a] || {})[b] = i.set[k]; } return ok({ changed: Object.keys(i.set), restart_required: !!S.restart, config: S.cfg }); }
      if (op === 'terra.daemon.io.devices.get') return ok({ devices: S.devs });
      if (op === 'terra.daemon.io.devices.by-device-id.alias.post') { S.devs[0].alias = i.alias; return ok({}); }
      if (op === 'terra.daemon.health.get') return ok(S.health);
      if (op === 'terra.daemon.ready.get' || op === 'terra.daemon.live.get') return ok({ status: 'ok' });
      if (op === 'terra.daemon.config.schema.get') return ok({ fields: {} });
      if (op === 'terra.daemon.modules.get') return ok({ modules: [] });
      if (op === 'terra.master.jobs.get') return ok({ jobs: S.jobs || [], count: (S.jobs || []).length });
      if (op === 'terra.master.jobs.by-job-id.get') return ok((S.jobs || []).find((j) => j.job_id === i.job_id));
      if (op.startsWith('terra.daemon.') || op.startsWith('terra.master.')) return ok({});
      return Promise.reject({ code: 'OP_UNKNOWN', message: op });
    } };
  return t;
}

async function realDesk(o = {}) {
  globalThis.localStorage = mem();
  const t = fakeGateway(); if (o.setup) o.setup(t.S);
  globalThis.window = { TerraTransport: t };
  const T = await loadStore(t);
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraGate: o.gate || ((op, x) => gate(op, x)), TerraRisk: () => '' });
  const C = Desk(), c = new C({ nodeName: 'desk', nodeKey: 'L', winW: 1240, winH: 760 }); c.persist = () => {};
  c.renderVals(); await tick(5); c.renderVals();
  const win = (id) => c.renderVals().wins.find((w) => w.app === id);
  return { c, t, T, win, calls: (op) => t.calls.filter(([, o2]) => o2 === op) };
}
const btn = (list, label) => list.find((b) => b.label === label);
const open = (c, id, st) => { c.launch(id); Object.assign(c.state, st || {}); };

test('AUD-76 별칭 — 칸을 떠나면(change) io.devices.by-device-id.alias.post 를 보내고, 입력 중엔 보내지 않는다', async () => {
  const { c, win, calls } = await realDesk(); open(c, 'svi', { resTab: 'dev' });
  let w = win('svi'); assert.equal(w.nx.hasDev, true); w.nx.d.aliasIn({ target: { value: '앞 카메라' } });
  assert.equal(calls('terra.daemon.io.devices.by-device-id.alias.post').length, 0, '입력 중엔 보내지 않는다');
  w = win('svi'); assert.equal(w.nx.d.alias, '앞 카메라', '입력 중 값은 칸에 그대로');
  w.nx.d.aliasSet({ target: { value: ' 앞 카메라 ' } }); await tick(20);
  const sent = calls('terra.daemon.io.devices.by-device-id.alias.post'); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][2], { device_id: 'dev-1', alias: '앞 카메라' });
  await tick(20); assert.equal(win('svi').nx.d.name, '앞 카메라', '노드에서 다시 읽은 값이 보인다');
});

test('AUD-76 별칭 — 거절되면 이유를 보이고 입력 값은 남긴다', async () => {
  const { c, t, win } = await realDesk(); open(c, 'svi', { resTab: 'dev' });
  t.S.failOps['terra.daemon.io.devices.by-device-id.alias.post'] = { code: 'FORBIDDEN', message: 'no node.control' };
  const w = win('svi'); w.nx.d.aliasIn({ target: { value: 'x' } }); w.nx.d.aliasSet({ target: { value: 'x' } }); await tick(20);
  assert.match(c.state.nxMsg, /^못 함/); assert.equal(win('svi').nx.d.alias, 'x', '실패한 입력은 지우지 않는다');
});

test('AUD-77 다시 찾기 — 실제 모드는 io.scan.post 를 부르고 목록을 다시 읽는다', async () => {
  const { c, win, calls } = await realDesk(); open(c, 'svi', { resTab: 'dev' });
  const before = calls('terra.daemon.io.devices.get').length;
  btn(win('svi').nx.devTop, '다시 찾기').run(); await tick(30);
  assert.equal(calls('terra.daemon.io.scan.post').length, 1);
  assert.ok(calls('terra.daemon.io.devices.get').length > before, '목록을 다시 읽는다');
});

test('AUD-78 다시 점검 — health 를 실제로 다시 읽고 결과를 보인다', async () => {
  const { c, t, win, calls } = await realDesk(); open(c, 'set', { setTab: 'about' });
  win('set'); await tick(20); const n0 = calls('terra.daemon.health.get').length;
  t.S.health = { status: 'degraded' };
  btn(win('set').nx.chkBtns, '다시 점검').run(); await tick(30);
  assert.ok(calls('terra.daemon.health.get').length > n0, 'health.get 를 다시 부른다');
  const row = win('set').nx.checks.find((r) => /health/.test(r.name)); assert.equal(row.st, 'degraded'); assert.equal(row.cls, 'err');
});

test('AUD-83 공유 폴더 저장 — config.patch 가 닫히면 잠기고 이유를 보인다(보내지 않는다)', async () => {
  const shut = (op, x) => (op === 'terra.daemon.config.patch' ? { open: false, needs: 'user-perm', why: '잠김 : 계정 권한 없음 — node.config', op } : gate(op, x));
  const { c, win, calls } = await realDesk({ gate: shut }); open(c, 'svi', { resTab: 'dir' });
  let w = win('svi'); btn(w.nx.dirAdd, '+ 공유 폴더').run(); await tick(5); w = win('svi');
  const sv = btn(w.nx.dirBtns, '저장'); assert.equal(sv.dis, 'disabled'); assert.equal(sv.run, null); assert.match(sv.tip, /계정 권한 없음 — node\.config/);
  assert.equal(calls('terra.daemon.config.patch').length, 0);
});

test('AUD-83 공유 폴더 저장 — 저장이 실패하면 초안 줄을 남기고 이유를 보이며 "바뀐 것 없음" 이라 하지 않는다', async () => {
  const { c, t, win, calls } = await realDesk(); open(c, 'svi', { resTab: 'dir' });
  let w = win('svi'); btn(w.nx.dirAdd, '+ 공유 폴더').run(); await tick(5); w = win('svi'); assert.equal(w.nx.dirs.length, 2);
  t.S.failOps['terra.daemon.config.patch'] = { code: 'FORBIDDEN', status: 403, message: 'node.config required' };
  btn(w.nx.dirBtns, '저장').run(); await tick(30);
  assert.equal(calls('terra.daemon.config.patch').length, 1);
  assert.match(c.state.nxMsg, /^못 함/); w = win('svi');
  assert.equal(w.nx.dirs.length, 2, '초안 줄이 남는다'); assert.match(w.nx.dirDirty, /^바뀜/); assert.equal(btn(w.nx.dirBtns, '저장').dis, null, '다시 저장할 수 있다');
});

test('AUD-84 다시 시작 — 재시작 필요 저장 뒤 다시 읽어도 켜져 있고, 누르면 restart.post 를 부른다', async () => {
  const { c, win, calls } = await realDesk({ setup: (S) => { S.restart = true; } }); open(c, 'set', { setTab: 'node', cfgQ: 'heartbeat' });
  let w = win('set'); const row = w.nx.keys.find((k) => k.k === 'heartbeat.interval_sec'); assert.ok(row, '재시작 표시가 있는 키 행'); assert.equal(btn(w.nx.cfgBtns, '다시 시작').dis, 'disabled');
  row.input({ target: { value: '20' } }); await tick(5);
  btn(win('set').nx.cfgBtns, '저장').run(); await tick(60);   // 저장 → 노드에서 다시 읽기(사본이 노드 값으로 바뀐다)
  assert.equal(calls('terra.daemon.config.patch').length, 1);
  w = win('set'); const rs = btn(w.nx.cfgBtns, '다시 시작'); assert.equal(rs.dis, null, '다시 읽은 뒤에도 켜져 있다'); assert.match(w.nx.dirtyT, /다시 시작 대기/);
  rs.run(); await tick(30);
  assert.equal(calls('terra.daemon.restart.post').length, 1);
  assert.equal(btn(win('set').nx.cfgBtns, '다시 시작').dis, 'disabled', '보낸 뒤엔 다시 잠긴다');
});

test('AUD-87 다시 보내기 — 앱 토큰에 없는 process.execute.delegated 라 잠기고 이유를 보인다', async () => {
  const { c, win } = await realDesk({ setup: (S) => { S.jobs = [{ job_id: 'job_f', type: 'process.execute.request', status: 'failed', target_node_id: 'nd_L', created_at: new Date().toISOString(), request: { command: 'x' } }]; } });
  open(c, 'jobs', { mjSel: 'job_f', jbTab: 'master' }); await tick(20);
  const w = win('jobs'); const B = btn((w.jb && w.jb.d && w.jb.d.btns) || [], '다시 보내기');
  assert.ok(B, '다시 보내기 단추를 찾는다 ' + JSON.stringify(Object.keys(w.jb || {})));
  assert.equal(B.dis, 'disabled'); assert.equal(B.lock, true); assert.equal(B.run, null); assert.match(B.tip, /process\.execute\.delegated/);
});

test('AUD-84 다시 시작 — 저장 응답이 재시작 불필요(restart_required false)면 켜지 않는다', async () => {
  const { c, win, calls } = await realDesk({ setup: (S) => { S.restart = false; } }); open(c, 'set', { setTab: 'node', cfgQ: 'heartbeat' });
  win('set').nx.keys.find((k) => k.k === 'heartbeat.interval_sec').input({ target: { value: '30' } }); await tick(5);
  btn(win('set').nx.cfgBtns, '저장').run(); await tick(60);
  assert.equal(calls('terra.daemon.config.patch').length, 1);
  assert.equal(btn(win('set').nx.cfgBtns, '다시 시작').dis, 'disabled');
});

test('AUD-84 다시 시작 — 공유 폴더 저장도 재시작 대기를 다시 읽기 뒤까지 남긴다', async () => {
  const { c, win, calls } = await realDesk({ setup: (S) => { S.restart = true; } }); open(c, 'svi', { resTab: 'dir' });
  btn(win('svi').nx.dirAdd, '+ 공유 폴더').run(); await tick(5);
  btn(win('svi').nx.dirBtns, '저장').run(); await tick(60);
  assert.equal(calls('terra.daemon.config.patch').length, 1);
  open(c, 'set', { setTab: 'node' }); assert.equal(btn(win('set').nx.cfgBtns, '다시 시작').dis, null);
});
