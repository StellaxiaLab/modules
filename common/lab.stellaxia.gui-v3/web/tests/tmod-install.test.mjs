// node --test — 모듈 창 [설치]: .tmod 고르기 → 노드로 올리기(조각 · 진행 · 취소) → 노드가 살핀 결과(신뢰 · 호환 · 권한 · 동작) → 확인(권한 묶음 digest · 동작) → 설치 → 결과 · 목록 새로고침.
//   Terra Daemon op terra.daemon.modules.packages.uploads.* (module.manage · 이 노드와 다른 노드 모두). commands.execute 길과 DECIDE.tmodInstall 잠금은 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import * as deskAdapt from '../src/api/desk-adapt.js';
import * as changes from '../src/api/changes.js';
import * as Tmod from '../src/api/tmod-install.js';
import { gate } from '../src/api/gates.js';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const src = readFileSync(process.env.NDE_SRC || join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = () => new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);
const OP = Tmod.TMOD_OPS;

async function loadStore() {
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}
const err = (code, status, message, details) => Object.assign(new Error(message || code), { code, status, details });
const file = (n, name = 'demo.tmod') => { const u = new Uint8Array(n).map((_, i) => i % 251); return { name, size: n, arrayBuffer: async () => u.buffer.slice(0) }; };
const INSP = (o) => Object.assign({ upload_id: 'up-1', module_id: 'io.terra.demo', version: '1.1.0', installed_version: '1.0.0', action: 'upgrade', trust: { tier: 'verified', key_id: 'k1', quarantined: false }, compatible: true, dev_install_allowed: false, permissions: ['node.read', 'storage:data'], permissions_digest: 'sha256:abc' }, o);

// h(op, input, node, calls) — 노드 쪽 흉내. 기본: 정상
function api(h) {
  const calls = [], up = { got: 0 };
  const base = (op, input) => {
    if (op === OP.start) return { upload_id: 'up-1', chunk_bytes: 256, expires_at: 'x' };
    if (op === OP.chunk) { up.got = input.offset + Buffer.from(input.data, 'base64').length; return { received: up.got, complete: false }; }
    if (op === OP.inspect) return INSP();
    if (op === OP.install) return { module_id: 'io.terra.demo', version: '1.1.0', action: 'upgrade', previous_version: '1.0.0', trust: { tier: 'verified' }, state: 'running' };
    if (op === OP.cancel) return { upload_id: 'up-1', state: 'cancelled' };
    return {};
  };
  return { calls, up, fn: async (node, op, input) => { calls.push({ node, op, input }); if (h) { const r = await h(op, input, node, calls, base); if (r !== undefined) return r; } return base(op, input); } };
}

async function desk(a, opts = {}) {
  globalThis.localStorage = mem();
  let listed = 0;
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' }, R: { id: 'R', name: 'far', rid: 'nd_R' } }, localId: () => 'L',
    invokeRid(rid, op, input) { return this.invoke(rid, op, input); },
    invoke(node, op, input) {
      if (op === 'terra.daemon.modules.get') { listed++; return Promise.resolve({ modules: [{ id: 'io.terra.demo', name: '데모', state: opts.state || 'running', enabled: true, version: '1.0.0' }] }); }
      if (op.startsWith('terra.daemon.modules.packages.') || /by-module-id\.rollback/.test(op)) return a.fn(node, op, input);
      return Promise.resolve({});
    } };
  globalThis.window = { TerraTransport: t, TerraGuiApps: [], addEventListener() {} };
  await loadStore();
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraTmod: Tmod, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '' });
  const C = Desk(), r = !!opts.remote, c = new C({ nodeName: r ? 'far' : 'desk', nodeKey: r ? 'R' : 'L', nodeRid: r ? 'nd_R' : 'nd_L', remote: r, winW: 1240, winH: 760 }); c.persist = () => {};
  const said = []; c.say = (m) => said.push(m);
  c.renderVals(); await tick(10); c.renderVals(); await tick(10); c.renderVals();
  c.state.modView = 'add'; c.launch('mods');
  const X = () => c.renderVals().wins.find((w) => w.id === 'mods').nx.add;
  return { c, X, said, listed: () => listed };
}
const settle = async (c, ms = 60) => { await tick(ms); c.renderVals(); };
const check = (c, X, k) => { X().checks[k].flip(); c.renderVals(); };
const btn = (list, label) => list.find((b) => b.label.startsWith(label));

test('전체 흐름(이 노드) — 올리기(조각) → 살핀 결과 → 확인 → 설치 → 목록 새로고침', async () => {
  const a = api(), { c, X, listed } = await desk(a);
  const before = listed();
  c.tmodPick(file(700)); await settle(c);
  const ops = a.calls.map((x) => x.op);
  assert.deepEqual(ops.slice(0, 5), [OP.start, OP.chunk, OP.chunk, OP.chunk, OP.inspect]);   // 700B / 256B = 3조각
  assert.ok(a.calls.every((x) => x.node === 'L'));
  assert.match(a.calls[0].input.sha256, /^sha256:[0-9a-f]{64}$/); assert.deepEqual([a.calls[1].input.offset, a.calls[2].input.offset, a.calls[3].input.offset], [0, 256, 512]);
  assert.equal(a.calls[1].input.data, Buffer.from(new Uint8Array(256).map((_, i) => i % 251)).toString('base64'), '조각은 base64');
  const v = X().v; assert.ok(v && X().hasV);
  const text = JSON.stringify(v.rows); for (const s of ['io.terra.demo', '1.1.0', '1.0.0', '올리기(업그레이드)', 'verified', 'node.read', 'storage:data']) assert.ok(text.includes(s), s);
  const ins = () => btn(X().btns, '설치'); assert.ok(!ins().run, '권한 확인 전엔 설치 못 누른다');
  check(c, X, 0); assert.ok(ins().run);
  ins().run(); await settle(c);
  const last = a.calls[a.calls.length - 1]; assert.equal(last.op, OP.install);
  assert.deepEqual(last.input, { upload_id: 'up-1', permissions_digest: 'sha256:abc', confirm_action: 'upgrade' });
  assert.equal(X().res.on, true); assert.equal(X().res.chip, '설치됨'); assert.ok(!btn(X().res.btns, '이전 버전으로'));
  assert.ok(listed() > before, '설치 뒤 모듈 목록을 다시 읽는다');
});

test('다른 노드 — 같은 op 를 그 노드로 보낸다', async () => {
  const a = api(), { c, X } = await desk(a, { remote: true });
  c.tmodPick(file(100)); await settle(c); check(c, X, 0); btn(X().btns, '설치').run(); await settle(c);
  assert.ok(a.calls.length >= 4 && a.calls.every((x) => x.node === 'R'), a.calls.map((x) => x.node).join());
  assert.equal(a.calls[a.calls.length - 1].op, OP.install);
});

test('다운그레이드 — 권한 확인 말고 따로 한 번 더 확인해야 설치', async () => {
  const a = api((op) => (op === OP.inspect ? INSP({ action: 'downgrade', version: '0.9.0' }) : undefined)), { c, X } = await desk(a);
  c.tmodPick(file(10)); await settle(c);
  assert.equal(X().checks.length, 2); assert.match(X().checks[1].label, /낮은 버전/); assert.ok(X().v.warns.some((w) => /낮은 버전으로 내립니다/.test(w.t)));
  check(c, X, 0); assert.ok(!btn(X().btns, '설치').run, '권한만 확인해서는 안 된다');
  check(c, X, 1); btn(X().btns, '설치').run(); await settle(c);
  assert.equal(a.calls[a.calls.length - 1].input.confirm_action, 'downgrade');
});

test('설치했지만 시작 실패(state failed) — 오류와 [이전 버전으로] → rollback.post', async () => {
  const a = api((op) => (op === OP.install ? { module_id: 'io.terra.demo', version: '1.1.0', previous_version: '1.0.0', state: 'failed', start_error: 'exit 1' } : undefined)), { c, X } = await desk(a);
  c.tmodPick(file(10)); await settle(c); check(c, X, 0); btn(X().btns, '설치').run(); await settle(c);
  assert.equal(X().res.chip, '시작 실패'); assert.match(JSON.stringify(X().res.lines), /exit 1/); assert.ok(X().res.warn);
  const rb = btn(X().res.btns, '이전 버전으로'); assert.ok(rb && rb.run);
  rb.run(); const S = c.state.cfm.spec; assert.equal(S.op, 'terra.daemon.modules.by-module-id.rollback.post'); assert.match(JSON.stringify(S.steps), /1\.0\.0/);
  await S.final.run({}); const last = a.calls[a.calls.length - 1]; assert.deepEqual([last.node, last.op, last.input], ['L', 'terra.daemon.modules.by-module-id.rollback.post', { module_id: 'io.terra.demo' }]);
});

test('서명 없는 패키지 — 살핀 결과가 격리면 설치 단추 잠금 + "서명 없는 패키지 — 개발 모드 노드에서만"', async () => {
  const a = api((op) => (op === OP.inspect ? INSP({ trust: { tier: 'unsigned', code: 'unsigned', reason: 'signature missing', quarantined: true }, install_refusal: 'PACKAGE_QUARANTINED', dev_install_allowed: false }) : undefined)), { c, X } = await desk(a);
  c.tmodPick(file(10)); await settle(c);
  assert.ok(X().v.warns.some((w) => /서명 없는 패키지 — 개발 모드 노드에서만/.test(w.t))); assert.equal(X().checks.length, 0); assert.ok(!btn(X().btns, '설치').run);
});

test('호환 안 되는 패키지 — 이유를 보이고 설치 못 한다(강제 없음)', async () => {
  const a = api((op) => (op === OP.inspect ? INSP({ compatible: false, incompatible_reason: 'requires terra >= 9', install_refusal: 'PACKAGE_INCOMPATIBLE', incompatible_reason2: 1 }) : undefined)), { c, X } = await desk(a);
  c.tmodPick(file(10)); await settle(c);
  assert.ok(X().v.warns.some((w) => /맞지 않음.*requires terra >= 9/.test(w.t))); assert.ok(!btn(X().btns, '설치').run);
});

test('오류 — 이유를 말한다(올리기 · 설치 단계)', async () => {
  const cases = [
    [OP.chunk, err('PACKAGE_HASH_MISMATCH', 422, 'x'), /해시가 맞지 않음/],
    [OP.start, err('FORBIDDEN', 403, 'permission denied'), /module\.manage/],
    [OP.start, err('MODULE_REACH_DENIED', 403, 'x'), /닿는 범위 밖/],
    [OP.start, err('NOT_IMPLEMENTED', 501, 'x'), /이 노드의 Terra가 아직 지원하지 않음/],
    [OP.start, err('UPLOAD_TOO_LARGE', 413, 'x'), /256MiB/],
    [OP.inspect, err('PACKAGE_INVALID', 422, 'x'), /형식이 아님/],
  ];
  for (const [op, e, re] of cases) {
    const a = api((o) => { if (o === op) throw e; }), { c, X } = await desk(a);
    c.tmodPick(file(10)); await settle(c);
    assert.match(X().err, re, e.code); assert.equal(X().hasV, false);
    if (op === OP.inspect) assert.ok(a.calls.some((x) => x.op === OP.cancel), '올리다 실패하면 노드의 올리기를 치운다');
  }
  for (const [e, re] of [[err('PACKAGE_QUARANTINED', 403, 'x', { trust_code: 'unsigned', reason: 'no signature' }), /서명 없는 패키지 — 개발 모드 노드에서만/], [err('GRANT_MISMATCH', 409, 'x'), /권한 목록과 패키지가 달라짐/],
    [err('INSTALL_IN_PROGRESS', 409, 'x'), /다른 설치가 진행 중/], [err('PACKAGE_INCOMPATIBLE', 422, 'x', { reason: 'old os' }), /맞지 않음 — old os/], [err('PACKAGE_TAMPERED', 422, 'x'), /이전 버전 그대로/], [err('FORBIDDEN', 403, 'permission denied'), /module\.manage/]]) {
    const a = api((o) => { if (o === OP.install) throw e; }), { c, X } = await desk(a);
    c.tmodPick(file(10)); await settle(c); check(c, X, 0); btn(X().btns, '설치').run(); await settle(c);
    assert.match(X().err, re, e.code); assert.equal(X().res.on, false); assert.ok(X().hasV, '다시 시도할 수 있게 확인 화면을 남긴다');
  }
});

test('올리는 중 멈춤 — 조각을 더 보내지 않고 노드의 올리기를 취소(delete)한다', async () => {
  let c2; const a = api(async (op) => { if (op === OP.chunk) { await tick(15); } });
  const { c, X } = await desk(a); c2 = c;
  c.tmodPick(file(256 * 6)); await tick(30); c.renderVals();
  assert.equal(X().up.on, true); assert.ok(X().up.btns[0], '멈춤 단추'); X().up.btns[0].run(); await tick(80);
  const chunks = a.calls.filter((x) => x.op === OP.chunk).length; assert.ok(chunks < 6, '모두 보내지 않았다 : ' + chunks);
  assert.equal(a.calls[a.calls.length - 1].op, OP.cancel); assert.equal(c2.state.tm, null);
});

test('uploadTmod — 노드가 아는 자리(UPLOAD_OFFSET_MISMATCH · received)부터 이어 보낸다 · 진행을 알린다', async () => {
  const seen = []; let first = true; const sent = [];
  const invoke = async (op, input) => {
    if (op === OP.start) return { upload_id: 'u', chunk_bytes: 100 };
    if (op === OP.chunk) { if (first && input.offset === 100) { first = false; throw err('UPLOAD_OFFSET_MISMATCH', 409, 'x', { received: 200 }); } sent.push(input.offset); return { received: Math.min(250, input.offset + 100) }; }
    if (op === OP.inspect) return INSP();
  };
  const r = await Tmod.uploadTmod({ invoke, file: file(250), onProgress: (p) => seen.push(p.sent) });
  assert.equal(r.insp.module_id, 'io.terra.demo'); assert.deepEqual(sent, [0, 200]); assert.equal(seen[seen.length - 1], 250);
});

test('상한 256MiB — 넘으면 노드로 올리지 않고 이유', async () => {
  const a = api(), { c, X } = await desk(a);
  c.tmodPick(file(10)); await settle(c); a.calls.length = 0;
  c.tmodPick({ name: 'big.tmod', size: 300 * 1048576, arrayBuffer: async () => new ArrayBuffer(0) }); await settle(c);
  assert.match(X().err, /256MiB/); assert.deepEqual(a.calls, []);
});

test('commands.execute 길 · 결정 표 잠금이 없다', () => {
  assert.ok(!/commands\.execute\.post'/.test(parseBoard(src).script)); assert.ok(!/DECIDE\.tmodInstall/.test(src)); assert.ok(!/tmodInstall: \{ locked/.test(src));
});
