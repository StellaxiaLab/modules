// node --test — 제어기(NodeDesktopEmbed)의 파일 내용 · 전송, 작업 출력 따라가기 · Master 작업, 밀어 받기 표시(바뀐 줄)
//   실제 모드: TerraNodes(보드 그대로) + 시험 전송(kind gateway) + 실제 src/api 모듈들. 시안 모드: 창문 없이
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import * as deskAdapt from '../src/api/desk-adapt.js';
import * as fileTransfer from '../src/api/file-transfer.js';
import * as taskFollow from '../src/api/task-follow.js';
import * as changes from '../src/api/changes.js';
import { gate } from '../src/api/gates.js';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const src = readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => createHash('sha256').update(b).digest('hex');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = () => new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);

async function loadStore(transport) {
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}

/** 시험 전송 — 이 노드(L)의 Daemon · lab.stellaxia.file · Master 를 흉내 */
function fakeGateway() {
  const calls = [], files = new Map([['notes.md', new TextEncoder().encode('# 노트\n한 줄\n')], ['pic.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3])]]), tx = new Map(); let n = 0;
  const S = { mods: [{ id: 'io.terra.file', name: '파일', state: 'running', enabled: true, version: '0.2.1' }], tasks: [{ id: 't-1', type: 'process.execute', state: 'running' }, { id: 't-2', type: 'process.execute', state: 'succeeded' }],
    jobs: [{ job_id: 'job_a', type: 'process.execute.request', status: 'running', target_node_id: 'nd_L', created_at: new Date().toISOString(), request: { command: 'sleep', args: ['30'] } }] };
  const ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const t = { kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' } }, localId: () => 'L', calls, files, S,
    invoke(node, op, i) {
      calls.push([node, op, i]);
      if (op === 'terra.daemon.tasks.get') return ok({ tasks: S.tasks });
      if (op === 'terra.daemon.modules.get') return ok({ modules: S.mods });
      if (op.startsWith('terra.daemon.')) return ok({});
      if (op === 'lab.stellaxia.file.roots.list') return ok({ roots: [{ name: 'share-0', path: '/srv/share' }] });
      if (op === 'terra.daemon.local-fs.roots.get') return ok({ roots: [] });
      if (op === 'lab.stellaxia.file.entries.list') return ok({ entries: [...files].map(([name, b]) => ({ name, size: b.length, is_dir: false, modified_at: '2026-11-04T01:00:00Z' })) });
      if (op === 'lab.stellaxia.file.entries.read') { const f = files.get(i.path), d = f.subarray(i.offset, i.offset + i.length); return ok({ offset: i.offset, length: d.length, data: Buffer.from(d).toString('base64'), sha256: hex(d), eof: i.offset + d.length >= f.length, size: f.length }); }
      if (op === 'lab.stellaxia.file.transfers.create') { const id = 'tr-' + (++n); tx.set(id, { path: i.path, buf: new Uint8Array(i.size_bytes), off: 0, sum: i.checksum_sha256 }); return ok({ transfer: { transfer_id: id, chunk_size: 4, offset: 0, state: 'prepared' } }); }
      if (op === 'lab.stellaxia.file.transfers.chunks.put') { const T = tx.get(i.transfer_id), d = Buffer.from(i.data, 'base64'); T.buf.set(d, T.off); T.off += d.length; return ok({ next_offset: T.off }); }
      if (op === 'lab.stellaxia.file.transfers.complete') { const T = tx.get(i.transfer_id); files.set(T.path, T.buf); return ok({ transfer_id: i.transfer_id, bytes: T.off, verified: hex(T.buf) === T.sum }); }
      if (op === 'terra.master.jobs.get') return ok({ jobs: S.jobs, count: S.jobs.length });
      if (op === 'terra.master.jobs.by-job-id.get') return ok(S.jobs.find((j) => j.job_id === i.job_id));
      if (op === 'terra.master.jobs.by-job-id.cancel.post') return ok({ job_id: i.job_id, status: 'cancel_sent', cancel_job_id: 'job_c' });
      return Promise.reject({ code: 'OP_UNKNOWN', message: op });
    } };
  return t;
}

async function realDesk(o = {}) {
  globalThis.localStorage = mem();
  const t = fakeGateway(), follows = [];
  globalThis.window = { TerraTransport: t };
  const T = await loadStore(t);
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraFileTransfer: Object.assign({ create: (inv) => fileTransfer.createFileTransfer({ invoke: inv }) }, fileTransfer),
    TerraTaskFollow: Object.assign((n, id, onUpdate) => { const F = { n, id, onUpdate, stopped: false, stop() { F.stopped = true; } }; follows.push(F); return F; }, taskFollow),
    TerraGate: o.gate || ((op, x) => gate(op, x)), TerraRisk: () => '' });
  const C = Desk(), c = new C({ nodeName: 'desk', nodeKey: 'L', winW: 1240, winH: 760 }); c.persist = () => {};
  c.renderVals(); await tick(5); c.renderVals();
  return { c, t, T, follows, win: (id) => c.renderVals().wins.find((w) => w.app === id), done: () => { c.followStop(); } };
}

test('CHG(보드) 와 src/api/changes.js — 같은 목록에 같은 답', () => {
  const C = Desk(); const c = new C({}); void c;
  const CHG = new Function(parseBoard(src).script.match(/const CHG = \{[\s\S]*?\n\};/)[0] + '\nreturn CHG;')();
  const cases = [[null, [{ id: 'a', s: 1 }]], [[{ id: 'a', s: 1 }, { id: 'b', s: 2 }], [{ id: 'a', s: 9 }, { id: 'c', s: 3 }, { id: '', s: 0 }]], [[], [{ id: 'x', s: 1 }]]];
  const id = (r) => r.id, sig = (r) => r.s, sets = (d) => [[...d.added], [...d.changed], [...d.removed]];
  for (const [a, b] of cases) assert.deepEqual(sets(CHG.diffSigns(a && CHG.signMap(a, id, sig), CHG.signMap(b, id, sig))), sets(changes.diffRows(a, b, id, sig)));
});

test('파일 실제 — 공유 폴더: 미리보기는 entries.read(앞부분 · 고정폭), 그림은 objectURL, 올리기는 create → chunks.put(chunk_size) → complete', async () => {
  const { c, t, win, done } = await realDesk(); try {
    globalThis.URL.createObjectURL = () => 'blob:test'; globalThis.URL.revokeObjectURL = () => {};
    c.launch('files'); c.state.fmLoc = 'share:share-0'; c.renderVals(); await tick(5); c.renderVals(); await tick(5);
    let w = win('files'); assert.equal(w.path, 'share-0:/'); assert.deepEqual(w.items.map((i) => i.name), ['notes.md', 'pic.png']);
    assert.equal(w.fx.upLock, false); assert.match(w.fx.upTip, /^올리기 : share-0:\//);
    w.items[0].open(); await tick(20); w = win('files');
    assert.equal(w.pv.on, true); assert.equal(w.pv.isText, true); assert.equal(w.pv.text, '# 노트\n한 줄\n'); assert.match(w.pv.note, /^전체 · /);
    assert.ok(t.calls.some(([n, op, i]) => n === 'L' && op === 'lab.stellaxia.file.entries.read' && i.root === 'share-0' && i.path === 'notes.md' && i.length === fileTransfer.PREVIEW.text));
    w.items[1].open(); await tick(20); w = win('files'); assert.equal(w.pv.isImg, true); assert.equal(w.pv.url, 'blob:test');
    const body = new TextEncoder().encode('0123456789');
    c.upStart([{ name: 'up.txt', size: body.length, arrayBuffer: async () => body.buffer }], { share: true, root: 'share-0', rel: '' });
    for (let k = 0; k < 100 && c._tx.some((x) => x.job.state !== 'done' && x.job.state !== 'fail'); k++) await tick(10);
    await tick(5);
    const ops = t.calls.filter(([, op]) => op.startsWith('lab.stellaxia.file.transfers')).map(([, op, i]) => op.replace('lab.stellaxia.file.transfers.', '') + (i.offset !== undefined ? '@' + i.offset : ''));
    assert.deepEqual(ops, ['create', 'chunks.put@0', 'chunks.put@4', 'chunks.put@8', 'complete']);
    assert.deepEqual([...t.files.get('up.txt')], [...body]);
    w = win('files'); assert.equal(w.fx.tx[0].stat, '끝 · 10B'); assert.equal(w.fx.tx[0].arrow, '↑');
    assert.ok(t.calls.filter(([, op]) => op === 'lab.stellaxia.file.entries.list').length >= 2, '올린 뒤 목록을 다시 읽는다');
    c._tx.push({ node: 'L', sample: true, where: 'x', job: { dir: 'up', name: '시안', size: 1, done: 1, state: 'done' } });
    assert.ok(!win('files').fx.tx.some((r) => r.name === '시안'), '실제 모드에 시안 전송이 새지 않는다');
  } finally { done(); }
});

test('파일 실제 — 바탕화면 · 로컬 탐색은 내용 · 전송 단추를 잠그고 이유', async () => {
  const { c, win, done } = await realDesk(); try {
    c.launch('files'); c.state.fmLoc = 'desk'; const w = win('files');
    assert.equal(w.fx.upLock, true); assert.match(w.fx.upTip, /화면 전용/);
    assert.ok(w.fx.btns.every((b) => b.lock && b.dis === 'disabled' && /화면 전용/.test(b.tip)));
    assert.match(w.fx.dragT, /^🔒 /);
    const lfs = c.fxGate({ share: false, lockWhy: '로컬 탐색 : 읽기 op 없음 (Daemon local-fs 는 목록만) — 내용 · 전송은 공유 폴더에서' }, 'down'); assert.equal(lfs.open, false); assert.match(lfs.why, /읽기 op 없음/);
    assert.match(src, /lockWhy: loc\.locked \? loc\.reason : share \? '' : '로컬 탐색 : 읽기 op 없음/);
  } finally { done(); }
});

test('작업 실제 — 고른 작업은 TerraTaskFollow(노드 키 · task id)로 따라가고, stderr 색 · 끝 줄 · 멈춤 중 새 줄 수', async () => {
  const { c, follows, win, done } = await realDesk(); try {
    c.launch('jobs'); let w = win('jobs'); assert.deepEqual(w.jobs.map((j) => j.id), ['t-1', 't-2']); assert.ok(w.jobs.every((j) => j.fl === ''), '처음은 깜박이지 않는다');
    w.jobs[0].pick(); w = win('jobs');
    assert.equal(follows.length, 1); assert.deepEqual([follows[0].n, follows[0].id], ['L', 't-1']);
    let L = taskFollow.emptyLog(); const F = follows[0];
    L = taskFollow.applyEvent(L, { id: '1', event: 'output', data: { stream: 'stdout', at: '2026-11-04T01:02:03Z', text: 'a' } });
    L = taskFollow.applyEvent(L, { id: '2', event: 'output', data: { stream: 'stderr', text: 'b' } });
    F.onUpdate(L, { mode: 'live', why: '' }); w = win('jobs');
    assert.equal(w.out.modeT, '실시간 · SSE'); assert.deepEqual(w.out.lines.map((x) => [x.t, x.c]), [['a', w.out.lines[0].c], ['b', '#ff8f8f']]);
    w.out.toggle(); L = taskFollow.applyEvent(L, { id: '3', event: 'output', data: { stream: 'stdout', text: 'c' } }); F.onUpdate(L, { mode: 'live', why: '' }); w = win('jobs');
    assert.equal(w.out.lines.length, 2, '멈춤 중에는 보이는 줄이 그대로'); assert.equal(w.out.newOn, true); assert.equal(w.out.newN, '1'); assert.equal(w.out.followT, '따라가기');
    w.out.resume(); L = taskFollow.applyEvent(taskFollow.applyEvent(L, { event: 'state', data: { state: 'failed', exit_code: 3 } }), { event: 'end', data: {} }); F.onUpdate(L, { mode: 'live', why: '' }); w = win('jobs');
    assert.equal(w.out.lines.length, 3); assert.equal(w.out.endT, '끝 · 실패 · exit 3'); assert.equal(w.out.endC, '#ff6b6b');
    c.closeWin('jobs'); c.renderVals(); assert.equal(F.stopped, true, '창을 닫으면 따라가기를 끊는다');
  } finally { done(); }
});

test('밀어 받기 — 다시 읽은 작업 목록에서 바뀐 줄 · 새 줄에 깜박임 배지', async () => {
  const { c, t, T, win, done } = await realDesk(); try {
    c.launch('jobs'); c.launch('mods'); win('jobs'); assert.equal(win('mods').nx.mods[0].cls.trim(), 'on');
    t.S.mods = [{ id: 'io.terra.file', name: '파일', state: 'failed', enabled: true, version: '0.2.1' }];
    t.S.tasks = [{ id: 't-1', type: 'process.execute', state: 'succeeded' }, { id: 't-2', type: 'process.execute', state: 'succeeded' }, { id: 't-3', type: 'process.execute', state: 'running' }];
    await T.refresh('L', 'desk'); const w = win('jobs'); assert.equal(win('mods').nx.mods[0].cls, 'on nx-fl nx-fl-chg');
    assert.deepEqual(w.jobs.map((j) => [j.id, j.fl.trim(), j.chg]), [['t-1', 'nx-fl nx-fl-chg', '바뀜'], ['t-2', '', ''], ['t-3', 'nx-fl nx-fl-new', '새로']]);
    assert.match(src, /@keyframes nxFl\{/); assert.match(src, /\.nx-li\.nx-fl-new::after\{content:'새로'\}/);   // 모듈 줄(마크업을 건드리지 않음)은 ::after 배지
  } finally { done(); clearTimeout(c._mkT); }
});

test('Master 작업 — 목록 · 상세 · 취소는 확인 단계(무엇을 · 어디에 · 되돌리기) 뒤 cancel.post, 문이 닫히면 잠그고 이유', async () => {
  const { c, t, win, done } = await realDesk(); try {
    c.launch('jobs'); c.state.jbTab = 'master'; win('jobs'); await tick(5);
    let w = win('jobs'); assert.equal(w.jb.vMaster, true); assert.deepEqual(w.jb.mjobs.map((m) => [m.id, m.label, m.node]), [['job_a', '진행 중', 'desk']]);
    assert.ok(t.calls.some(([, op, i]) => op === 'terra.master.jobs.get' && i.node_id === 'nd_L'));
    w.jb.mjobs[0].pick(); w = win('jobs'); await tick(5); w = win('jobs');
    assert.equal(w.jb.d.id, 'job_a'); assert.deepEqual(w.jb.d.btns.map((b) => [b.label, b.dis]), [['취소', null], ['다시 보내기', 'disabled']]);
    w.jb.d.btns[0].run(); w = win('jobs');
    assert.equal(w.jb.ask.on, true); assert.deepEqual(w.jb.ask.rows.map((r) => r.k), ['무엇을', '어디에', '되돌리기']);
    assert.ok(!t.calls.some(([, op]) => op.endsWith('cancel.post')), '확인 전에는 부르지 않는다');
    w.jb.ask.yes(); await tick(5);
    assert.deepEqual(t.calls.filter(([, op]) => op.endsWith('cancel.post')).map(([, , i]) => i), [{ job_id: 'job_a' }]);
    assert.match(c.state.jbMsg, /^취소 전달 \(노드\)/);
  } finally { done(); }
  const R = await realDesk({ gate: (op) => (op === 'terra.master.jobs.get' ? { open: false, why: '잠김 : 위임 없음 — terra.master.jobs.get' } : { open: true, why: '' }) }); try {
    R.c.launch('jobs'); R.c.state.jbTab = 'master'; const w = R.win('jobs');
    assert.equal(w.jb.mLock, true); assert.equal(w.jb.mWhy, '잠김 : 위임 없음 — terra.master.jobs.get'); assert.equal(w.jb.tabs[1].n, '🔒');
    assert.ok(!R.t.calls.some(([, op]) => op === 'terra.master.jobs.get'), '닫힌 문은 부르지 않는다');
  } finally { R.done(); }
});

test('시안 — 파일 미리보기는 내용을 지어내지 않고 시안이라 밝히고, 전송 · Master 조작은 시안 표시', async () => {
  globalThis.localStorage = mem(); const prev = globalThis.window; globalThis.window = {};
  try {
    const C = Desk(), c = new C({ nodeName: 'desk', winW: 1240, winH: 760 }); c.persist = () => {}; c.renderVals(); c.launch('files'); c.state.fmPick = 'home:notes.md';
    let w = c.renderVals().wins.find((x) => x.app === 'files'); w.fx.btns[0].run(); w = c.renderVals().wins.find((x) => x.app === 'files');
    assert.match(w.pv.text, /^\(시안\) notes\.md — 실제 연결 : /); assert.equal(w.pv.note, '시안 — 노드 내용 읽지 않음');
    w.fx.btns[1].run(); await tick(300); w = c.renderVals().wins.find((x) => x.app === 'files'); assert.match(w.fx.tx[0].stat, /시안$/);
    c.launch('jobs'); c.state.jbTab = 'master'; c.state.mjSel = MJ(c); let j = c.renderVals().wins.find((x) => x.app === 'jobs'); j.jb.d.btns[0].run(); j = c.renderVals().wins.find((x) => x.app === 'jobs'); j.jb.ask.yes();
    assert.match(c.state.jbMsg, /^\(시안\) .*변경 없음$/);
    for (const x of c._tx || []) clearTimeout(x.t); c.followStop();
  } finally { globalThis.window = prev; }
});
const MJ = (c) => c.renderVals().wins.find((x) => x.app === 'jobs').jb.mjobs[0].id;
