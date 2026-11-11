// node --test — S4: TerraNodes.write 의 낙관 반영을 사본에서 없앴다(설계 node-owned-desk.md §10).
//   변경은 표시층(pendingRes)에만 — read().data(노드 값)는 응답 전까지 그대로, read().view 에 보이고, read().pending 에 이름.
//   성공해도 at 은 쓰기가 바꾸지 않는다(다시 읽은 값만 사본). 다시 읽기가 실패해도 낙관 값이 남지 않는다. 실패한 쓰기가 그 사이의 새 값을 되돌려 덮지 않는다.
//   제어기 ndSet 은 실패를 알리고(false) 성공 문구는 응답 뒤에만(o.ok).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function loadStore(transport) {
  globalThis.localStorage = mem(); globalThis.window = { TerraTransport: transport };
  const dir = mkdtempSync(join(tmpdir(), 'tw-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}
/** 노드 쪽 값 · 쓰기 응답을 손으로 푸는 가짜 전송 */
function fake() {
  const data = { R: { modules: [{ id: 'm', st: 'run' }] } }, held = [], calls = []; const t = { kind: 'test', meta: { R: { name: 'r' } }, data, held, calls, hold: false, failRead: false, localId: () => 'L',
    invoke(n, op, input) { calls.push(op); return new Promise((ok, no) => {
      if (op === 'terra.daemon.modules.get') return t.failRead ? no({ code: 'MODULE_BUSY' }) : ok(JSON.parse(JSON.stringify(data[n].modules)));
      const run = () => { if (op.endsWith('.fail')) return no({ code: 'MODULE_BUSY', message: 'busy' }); if (op.endsWith('.stop.post')) data[n].modules = data[n].modules.map((m) => ({ ...m, st: 'stop' })); ok({ ok: true }); };
      if (t.hold) held.push(run); else run(); }); } };
  return t;
}
const stop = (d) => d.map((m) => ({ ...m, st: 'stop' }));
const OP = 'terra.daemon.modules.by-module-id.stop.post';

test('쓰기 — 응답 전 사본(data)은 그대로, view 에만 반영, pending 에 이름', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5);
  const at0 = S.read('R', 'modules').at; t.hold = true;
  const p = S.write('R', OP, { module_id: 'm' }, { res: 'modules', mark: 'mod:m', apply: stop });
  const r = S.read('R', 'modules');
  assert.equal(r.data[0].st, 'run', '노드가 준 값 그대로'); assert.equal(r.view[0].st, 'stop'); assert.deepEqual([...r.pending], ['mod:m']); assert.equal(r.busy, 1); assert.equal(r.at, at0);
  assert.equal(S.cache.get('R|modules').pending, undefined, '사본 항목에 낙관 표시도 없다');
  t.hold = false; t.held.shift()(); await p; await tick(5);
  const d = S.read('R', 'modules'); assert.equal(d.data[0].st, 'stop', '노드에서 다시 읽은 값'); assert.equal(d.pending.size, 0); assert.equal(d.view, d.data);
});

test('쓰기 — 성공해도 write 는 at 을 바꾸지 않는다(refresh:false 면 사본은 그대로 · 표시층만 걷힘)', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5);
  const at0 = S.read('R', 'modules').at; await tick(10);
  await S.write('R', OP, { module_id: 'm' }, { res: 'modules', apply: stop, refresh: false });
  const r = S.read('R', 'modules'); assert.equal(r.at, at0); assert.equal(r.data[0].st, 'run'); assert.equal(r.pending.size, 0); assert.equal(r.view[0].st, 'run');
});

test('쓰기 — 성공했는데 다시 읽기가 실패해도 낙관 값이 사본에 남지 않는다', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5);
  t.failRead = true; t.data.R.modules = [{ id: 'm', st: 'run' }];
  await S.write('R', 'x.ok', {}, { res: 'modules', apply: stop }); await tick(10);
  const r = S.read('R', 'modules'); assert.equal(r.data[0].st, 'run'); assert.equal(r.view[0].st, 'run'); assert.equal(r.pending.size, 0); assert.equal(r.err.code, 'MODULE_BUSY');
});

test('쓰기 — 실패하면 표시층만 걷고, 그 사이에 새로 받은 값을 되돌려 덮지 않는다(롤백 prev 없음)', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5); t.hold = true;
  const p = S.write('R', 'x.fail', {}, { res: 'modules', apply: stop }); assert.equal(S.read('R', 'modules').view[0].st, 'stop');
  t.data.R.modules = [{ id: 'm', st: 'run', ver: 'new' }]; t.hold = false; await S.refresh('R', 'modules');   // 그 사이 다른 곳에서 바뀐 값을 받았다
  t.hold = true; t.held.shift()();
  await assert.rejects(p, { code: 'MODULE_BUSY' });
  const r = S.read('R', 'modules'); assert.equal(r.data[0].ver, 'new', '새 값이 낡은 prev 로 덮이지 않는다'); assert.equal(r.view[0].st, 'run'); assert.equal(r.pending.size, 0);
});

test('쓰기 — 끊겼으면 표시층도 만들지 않고 PARTITIONED, clear 뒤 늦은 응답은 표시층을 건드리지 않는다', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5);
  S.setLink('R', { state: 'offline', code: 'NODE_OFFLINE' });
  await assert.rejects(S.write('R', OP, {}, { res: 'modules', apply: stop }), { code: 'PARTITIONED' }); assert.equal(S.pendingRes.size, 0);
  S.setLink('R', { state: 'online' }); t.hold = true; S.write('R', OP, {}, { res: 'modules', apply: stop }).catch(() => {}); assert.equal(S.pendingRes.size, 1);
  S.clear(); assert.equal(S.pendingRes.size, 0); t.hold = false; t.held.shift()(); await tick(5); assert.equal(S.pendingRes.size, 0);
});

test('persist — 저장되는 terra.cache 에 표시층(낙관 값)이 없다', async () => {
  const t = fake(), S = await loadStore(t); S.read('R', 'modules'); await tick(5); t.hold = true;
  S.write('R', OP, {}, { res: 'modules', apply: (d) => d.map((m) => ({ ...m, st: 'ZZZ-OPTIMISTIC' })) }).catch(() => {});
  S.persist(); await tick(500); assert.equal(globalThis.localStorage.getItem('terra.cache').includes('ZZZ-OPTIMISTIC'), false);
});

// ───────────── 제어기 ndSet — 실패 전달 · 성공 문구는 응답 뒤에만 ─────────────
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Embed = new Function('DCLogic', parseBoard(readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8')).script + '\nreturn Component;')(DCLogic);
function embed(write) {
  const c = new Embed({ nodeName: 'ws', nodeKey: 'T1', nodeRid: 'n1' }), said = [], calls = [];
  c.say = (m) => said.push(m); c.TN = () => ({ t: { kind: 'gateway' }, write: (n, op, input, o) => { calls.push({ n, op, input, o }); return write(); }, draft() {} });
  c.link = () => ({ ro: false }); c.nd = () => ({ mods: [{ id: 'm1', name: 'M', st: 'run', en: true }], jobs: [] }); c.nodeKey = () => 'n1';
  c.btn = (label, fn) => ({ label, fn }); c.gateOf = () => ({ open: true }); c.actBtn = (l, g, fn) => ({ label: l, fn });
  return { c, said, calls };
}

test('ndSet — 성공 문구는 응답 뒤에만, 실패하면 문구 없이 오류만(반환 false)', async () => {
  let res, rej; const { c, said, calls } = embed(() => new Promise((a, b) => { res = a; rej = b; }));
  const m = { id: 'm1', name: 'M', st: 'run', en: true }, stopBtn = c.modBtns(m, 0)[0];
  stopBtn.fn(); assert.deepEqual(said, [], '응답 전에는 성공 문구가 없다'); assert.equal(calls[0].o.mark, 'mod:m1'); assert.equal(calls[0].op, 'terra.daemon.modules.by-module-id.stop.post');
  res({ ok: true }); await tick(); assert.deepEqual(said, ['M 멈춤']);
  said.length = 0; stopBtn.fn(); rej({ code: 'MODULE_BUSY', message: '바쁨' }); await tick();
  assert.equal(said.length, 1); assert.match(said[0], /^못 함 · 바쁨/); assert.equal(said.some((x) => /멈춤$/.test(x)), false);
});

test('ndSet — 반환값: 보냄은 Promise<true|false>, op 없는 실모드 변경은 거절 false(동작 그대로)', async () => {
  let ok = true; const { c, said } = embed(() => (ok ? Promise.resolve({}) : Promise.reject({ code: 'X', message: 'x' })));
  assert.equal(await c.ndSet((d) => d, 'terra.daemon.restart.post', {}), true);
  ok = false; assert.equal(await c.ndSet((d) => d, 'terra.daemon.restart.post', {}), false);
  said.length = 0; assert.equal(c.ndSet((d) => d), false); assert.match(said[0], /적용 안 함/);
});

test('ndSet — 호출자의 성공 문구는 전부 o.ok 로(응답 전 문구 없음): 소스 불변식', () => {
  const desk = readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
  assert.equal(/ndSet\([^;]*\) !== false\) this\.say/.test(desk), false, '결과를 안 보고 문구를 띄우는 !== false 가 남지 않았다');
  for (const s of ["{ module_id: m.id }, { ok: () => { this.setState({ modSel: 0 }); this.say(m.name + ' 제거')", "{ device_id: D.id }, { ok: () => { this.setState({ devSel: 0 })", "{ family: dc.fam, name: dc.name }, { ok: () => this.say(dc.name + ' 선언 해제", "{ tunnel_id: tn.id }, { ok: () => this.say(tn.svc + ' 터널 닫음')", "'terra.daemon.restart.post', {}, { ok: () => this.say('노드 다시 시작", "{ set, save: true }, { ok: () => this.say('저장 ' + dk.length", "{ module_id: f.id }, { ok: () => this.say(f.id + ' 지정 해제", "{ ok: () => { this.setState({ modCfg: null }); this.say(M.name + ' 설정 저장"]) assert.ok(desk.includes(s), s);
});
