// node --test — 제어기(NodeDesktopEmbed)가 바탕 구성을 노드에서 읽고 노드에 쓴다(설계 node-owned-desk.md §4 · §5 · §7 · §10 · §11 · §12 · §13).
//   노드 식별(rid) · 표시층(반투명) · 드롭 한 번에 패치 하나 · 읽기 전용 잠금 · 저장 표시 문구 · PC 키 분리 · 로그아웃 신호 순서.
//   TerraNodes 는 실제 보드(실행기로), 제어기는 로직만(DOM 없음), 가짜 노드는 서버 규칙(revs 충돌 · 첫 쓰기 형태) 그대로.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import { pcLogout, termPrefix, deskKey } from '../src/api/pc-state.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null };
const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {} });
const bus = {};
globalThis.document = { visibilityState: 'visible', createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el(), addEventListener() {}, removeEventListener() {} };
globalThis.window = globalThis;
globalThis.addEventListener = (n, f) => { (bus[n] || (bus[n] = new Set())).add(f); };
globalThis.removeEventListener = (n, f) => { if (bus[n]) bus[n].delete(f); };
globalThis.dispatchEvent = (e) => { for (const f of [...(bus[e.type] || [])]) f(e); return true; };

const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const dir = mkdtempSync(join(tmpdir(), 'node-owned-embed-'));
const f = join(dir, 'TerraNodes.mjs');
writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/TerraNodes.dc.html', import.meta.url)), 'utf8'), 'TerraNodes', RT));
await import(pathToFileURL(f).href);
const embedSrc = readFileSync(fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Embed = new Function('DCLogic', parseBoard(embedSrc).script + '\nreturn Component;')(DCLogic);

const P = 'lab.stellaxia.gui-v3.node-desk.';
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
const PREFS = ['dark', 'wall', 'wallFit', 'dock', 'snap', 'anim'];

function world() {
  const db = {}, calls = [], held = [], w = { db, calls, held, hold: false, fail: {}, local: '' };
  const at = (rid) => db[rid] || (db[rid] = { revision: 0, doc: null, revs: {}, floor: 0 });
  w.other = (rid, set) => { const N = at(rid), rev = ++N.revision; N.doc = N.doc || { icons: {}, prefs: {} }; for (const k in set) { N.revs[k] = rev; if (k === 'wall') { if (set[k] === null) delete N.doc.wall; else N.doc.wall = set[k]; continue; } const [g, x] = k.split('.'); if (set[k] === null) delete N.doc[g][x]; else N.doc[g][x] = set[k]; } };
  w.seed = (rid, T) => { const set = {}; for (const k of PREFS) set['prefs.' + k] = T.deskDefaults.prefs[k]; for (const id in T.deskDefaults.icons) set['icons.' + id] = T.deskDefaults.icons[id]; w.other(rid, set); };
  const serve = (rid, op, input) => {
    const N = at(rid), e = w.fail[op.replace(P, '')] || w.fail[rid];
    if (e) throw e;
    if (op === P + 'get') { if (N.revision === 0) return { revision: 0, doc: null }; return input.since_revision === N.revision ? { revision: N.revision, unchanged: true } : { revision: N.revision, doc: JSON.parse(JSON.stringify(N.doc)) }; }
    const keys = Object.keys(input.set), bad = keys.filter((k) => (N.revs[k] ?? N.floor) > input.base_revision);
    if (input.base_revision > N.revision || bad.length) throw { code: 'REVISION_CONFLICT', status: 409, details: { keys: bad.length ? bad : keys } };
    if (N.revision === 0 && !(PREFS.every((x) => 'prefs.' + x in input.set) && keys.some((k) => k.startsWith('icons.')))) throw { code: 'INVALID_REQUEST', status: 400 };
    w.other(rid, input.set); return { revision: N.revision, doc: JSON.parse(JSON.stringify(N.doc)) };
  };
  w.t = {
    kind: 'gateway', localId: () => w.local, meta: {},
    invoke() { return Promise.reject({ code: 'OP_UNSUPPORTED' }); },
    invokeRid(rid, op, input) {
      calls.push({ rid, op: op.replace(P, ''), input: JSON.parse(JSON.stringify(input)) });
      return new Promise((ok, no) => { const run = () => { try { ok(serve(rid, op, input)); } catch (e) { no(e); } }; if (!w.hold) return run(); held.push({ rid, op: op.replace(P, ''), run, fail: no }); });
    },
  };
  w.release = (i = 0) => held.splice(i, 1)[0].run();
  return w;
}
const live = [];
function setup(w, props = {}, who) {
  delete window.TerraNodes; window.TerraTransport = w.t; mem.clear(); window.TerraWho = who === undefined ? null : who;
  new (boardDef('TerraNodes').Logic)({}); const T = window.TerraNodes; live.push(T);
  const c = new Embed(Object.assign({ nodeName: 'ws', nodeKey: 'T1', nodeRid: 'n1', winW: 1240, winH: 760, chrome: 'none' }, props)); c.componentDidMount(); live.push(c);
  return { T, c };
}
test.afterEach(() => { for (const x of live.splice(0)) { if (x.deskStop) x.deskStop(); if (x.componentWillUnmount) { try { x.componentWillUnmount(); } catch (e) {} } } mock.timers.reset(); for (const k of Object.keys(bus)) delete bus[k]; window.TerraWho = null; });
/** 받고 첫 그림까지 */
async function ready(w, o = {}, who) {
  const S = setup(w, o.props, who); if (!o.empty) w.seed(o.props && o.props.nodeRid || 'n1', S.T);
  S.c.renderVals(); await flush(); return S;
}
const icons = (c) => c.renderVals().icons;
const byName = (c, n) => icons(c).find((i) => i.name === n);

test('노드 식별 — 실제 전송: nodeRid 가 없으면 rid 비움 · 호출 0 · 읽기 전용 기본값 / 목업: nodeKey 가 rid', async () => {
  const w = world(), S = setup(w, { nodeRid: '' });
  const v = S.c.renderVals(); await flush();
  assert.equal(S.c.deskRid(), '', '실제 전송은 장면 id(nodeKey)가 아니라 nodeRid 만 쓴다');
  assert.equal(w.calls.length, 0, '어떤 호출도 하지 않는다');
  assert.equal(S.c.desk().state, 'norid'); assert.equal(S.c.desk().ro, true);
  assert.deepEqual(v.icons.map((i) => i.name).sort(), Object.values(S.T.deskDefaults.icons).map((i) => i.name).sort(), '기본값은 보인다');
  assert.ok(!v.icons.some((i) => i.name === 'backup.tar'), '시안 아이콘은 기본값에서 뺐다');
  assert.match(v.save.text, /노드 id 가 없어/);
  S.c.dropIcon('home'); S.c.setPref('dark', false); await flush(); assert.equal(w.calls.length, 0, '쓰기도 호출 없이 거절');
  // 목업 전송 — nodeKey 가 rid
  const w2 = world(); w2.t.kind = 'mock'; w2.t.seeds = {}; const M = setup(w2, { nodeRid: '' }); assert.equal(M.c.deskRid(), 'T1');
  // 쓰이는 값 — nodeRid
  const w3 = world(), R = setup(w3, { nodeRid: 'rid-9', nodeKey: 'T7' }); R.c.renderVals(); await flush(); assert.ok(w3.calls.every((c) => c.rid === 'rid-9'), 'rid-9 로만 부른다 — ' + JSON.stringify(w3.calls.map((c) => c.rid)));
});

test('아이콘 · 모양은 노드 값에서 — state 에 두지 않고, 노드가 바꾸면 그대로 따라온다', async () => {
  const w = world(), { T, c } = await ready(w);
  assert.equal(c.state.icons, undefined); assert.equal(c.state.prefs, undefined);
  assert.ok(byName(c, '내 폴더'));
  w.other('n1', { 'icons.home': { c: 5, r: 4, name: '다른 PC 가 옮김', k: 'dir', loc: 'home' }, 'prefs.dock': 'left' });
  await T.deskFetch('n1', { force: true });
  const v = c.renderVals(); const ic = v.icons.find((i) => i.name === '다른 PC 가 옮김'); assert.ok(ic, '노드 값이 보인다');
  assert.equal(c.prf().dock, 'left');
});

test('드롭 — 응답 전: 사본(terra.cache) 불변 + 반투명, 응답 후: 확정 · 반투명 해제, 패치는 하나 · 항목 전체', async () => {
  const w = world(), { T, c } = await ready(w);
  const cached = () => JSON.stringify(T.cache.get('n1|nodedesk').data), before = cached();
  w.hold = true; const n0 = w.calls.length;
  c.state.ov = { id: 'home', x: 10 * 100, y: 5 * 90 };   // 끄는 층
  c.dropIcon('home'); await flush();
  assert.equal(w.calls.length - n0, 1, '패치 하나');
  const q = w.calls.at(-1); assert.equal(q.op, 'patch'); assert.equal(q.input.base_revision, 1);
  assert.deepEqual(Object.keys(q.input.set), ['icons.home']); const sent = q.input.set['icons.home'];
  assert.deepEqual(Object.keys(sent).sort(), ['c', 'k', 'loc', 'name', 'r'], '{c, r} 만이 아니라 항목 전체');
  assert.equal(cached(), before, '응답 전 사본은 그대로');
  const mid = byName(c, '내 폴더'); assert.equal(mid.op, 0.5, '응답 전 반투명'); assert.equal(byName(c, '공유 폴더').op, 1);
  assert.equal(c.deskLine().text, '그 노드에 저장 중…');
  w.release(); await flush();
  assert.notEqual(cached(), before); assert.equal(byName(c, '내 폴더').op, 1);
  assert.match(c.deskLine().text, /^그 노드에 저장됨 · \d\d:\d\d:\d\d$/);
});

test('드래그 중 다른 곳에서 지워진 아이콘을 드롭하면 패치하지 않는다({c, r} 만 든 항목 금지)', async () => {
  const w = world(), { T, c } = await ready(w);
  w.other('n1', { 'icons.home': null }); await T.deskFetch('n1', { force: true });
  assert.equal(c.ics().home, undefined);
  const n0 = w.calls.length; c.state.ov = { id: 'home', x: 200, y: 100 }; c.dropIcon('home'); await flush();
  assert.equal(w.calls.length, n0, '호출 없음'); assert.equal(c.state.ov, null); assert.equal(c.ics().home, undefined);
});

test('드래그는 drag 층만 — 움직이는 동안 노드 호출 · 사본 변화 없음', async () => {
  const w = world(), { T, c } = await ready(w), before = JSON.stringify(T.cache.get('n1|nodedesk').data), n0 = w.calls.length;
  c.iconDown({ currentTarget: {}, clientX: 10, clientY: 10, pointerId: 1 }, 'home');
  c.iconMove({ clientX: 80, clientY: 90 }, 'home'); c.iconMove({ clientX: 120, clientY: 140 }, 'home');
  assert.equal(w.calls.length, n0); assert.equal(JSON.stringify(T.cache.get('n1|nodedesk').data), before);
  assert.ok(c.state.ov && c.state.ov.id === 'home');
});

test('같은 칸의 아이콘 둘 — 그릴 때 id 순으로 다음 빈 칸으로 밀고 저장값은 그대로(§7)', async () => {
  const w = world(), { T, c } = await ready(w);
  w.other('n1', { 'icons.aaa': { c: 4, r: 4, name: 'A', k: 'dir', loc: 'home' }, 'icons.bbb': { c: 4, r: 4, name: 'B', k: 'dir', loc: 'home' } }); await T.deskFetch('n1', { force: true });
  const v = c.renderVals(), A = v.icons.find((i) => i.name === 'A'), B = v.icons.find((i) => i.name === 'B');
  assert.notDeepEqual([A.x, A.y], [B.x, B.y], '겹치지 않는다');
  assert.deepEqual([c.ics().aaa.c, c.ics().aaa.r, c.ics().bbb.c, c.ics().bbb.r], [4, 4, 4, 4], '저장값 불변');
  assert.deepEqual(w.db.n1.doc.icons.bbb && [w.db.n1.doc.icons.bbb.c, w.db.n1.doc.icons.bbb.r], [4, 4]);
});

test('읽기 전용(끊김) — 드래그 시작 · 추가 · 삭제 · 설정 칸이 잠기고, 호출 없이 이유가 보인다 · 창 같은 PC 항목은 계속', async () => {
  const w = world(), { T, c } = await ready(w);
  w.fail.n1 = { code: 'NODE_OFFLINE', status: 409 }; await T.deskFetch('n1', { force: true });
  assert.equal(c.desk().state, 'offline'); assert.equal(c.desk().ro, true);
  const n0 = w.calls.length; c.iconDown({ currentTarget: {}, clientX: 1, clientY: 1, pointerId: 1 }, 'home');
  assert.equal(c.drag, null, '드래그가 시작되지 않는다'); assert.equal(c.state.iconSel, 'home', '선택은 된다');
  c.addShortcut({ id: 'm', name: 'M' }, { id: 'a', name: 'A' }); c.newFolder(); c.setPref('dark', false); await flush();
  assert.equal(w.calls.length, n0, '아무 호출도 안 나간다');
  const v = c.renderVals(); assert.match(v.save.text, /^끊김 · 읽기 전용 · .* 사본$/);
  assert.match(v.lk.t, /바탕 읽기 전용/, '머리 링크 표시에 읽기 전용이 드러난다');
  c.openApp && void 0; c.setState({ wins: { files: { x: 1 } } }); assert.deepEqual(c.state.wins, { files: { x: 1 } }, '창 상태는 PC 것이라 바뀐다');
  // 설정 창의 칸 — 잠금(disabled)
  c.state.wins = { set: { x: 120, y: 120, w: 600, h: 420 } }; c.state.setTab = 'wall';
  const sv = c.renderVals().wins.find((x) => x.isSet);
  assert.ok(sv.walls.every((x) => x.off === 'disabled') && sv.docks.every((x) => x.off === 'disabled') && sv.wImg.off === 'disabled' && sv.fits.every((x) => x.off === 'disabled'), '바탕 · 독 · 맞춤 · 그림 칸이 잠긴다');
  c.state.setTab = 'look'; assert.ok(c.renderVals().wins.find((x) => x.isSet).toggles.every((x) => x.off === 'disabled'), '토글 칸이 잠긴다');
});

test('저장 표시 문구(§11 · §13) — 상태마다 정확히', async () => {
  // 처음 쓰는 노드
  const w0 = world(), E0 = await ready(w0, { empty: true });
  assert.equal(E0.c.desk().state, 'empty'); assert.equal(E0.c.renderVals().save.text, '이 노드에 아직 저장 안 됨');
  assert.ok(E0.c.desk().view.icons.home, '기본값은 보인다'); assert.ok(!E0.c.renderVals().save.run);
  // 정상 · 값 받음
  const w = world(), { T, c } = await ready(w); assert.match(c.deskLine().text, /^그 노드의 값 · /); assert.equal(c.deskLine().kind, 'ok');
  // 저장 중 → 저장됨
  w.hold = true; c.setPref('dock', 'left'); await flush(); assert.equal(c.renderVals().save.text, '그 노드에 저장 중…'); w.release(); w.hold = false; await flush();
  assert.match(c.renderVals().save.text, /^그 노드에 저장됨 · \d\d:\d\d:\d\d$/);
  // 설정 창 문구 — '다른 기기에서도 같은 바탕화면' 은 노드에 닿은 값에만
  c.state.wins = { set: { x: 1, y: 1, w: 500, h: 400 } }; c.state.setTab = 'acct';
  assert.match(c.renderVals().wins.find((x) => x.isSet).saveText, /^바탕 구성 : 그 노드에 저장됨 · \d\d:\d\d:\d\d · 다른 기기에서도 같은 바탕화면$/);
  // 실패 — 저절로 사라지지 않고, 클릭하면 다시 시도
  w.fail.patch = { code: 'INTERNAL', status: 500 }; c.setPref('snap', false); await flush();
  assert.equal(c.renderVals().save.text, '저장 못 함 — INTERNAL · 다시 시도');
  assert.equal(c.renderVals().wins.find((x) => x.isSet).saveText, '바탕 구성 : 저장 못 함 — INTERNAL · 다시 시도', '실패에는 다른 기기 문구를 달지 않는다');
  assert.equal(c.prf().snap, true, '원래 값으로');
  await new Promise((r) => setTimeout(r, 30)); assert.equal(c.renderVals().save.text, '저장 못 함 — INTERNAL · 다시 시도', '시간이 지나도 남는다');
  delete w.fail.patch; c.renderVals().save.run(); await flush();
  assert.match(c.renderVals().save.text, /^그 노드에 저장됨 · /); assert.equal(c.prf().snap, false, '다시 시도가 같은 변경을 보낸다');
  // 충돌 — 문구와 닫기
  w.other('n1', { 'prefs.dock': 'bottom' }); w.hold = true; c.setPref('dock', 'left'); await flush();
  w.other('n1', { 'prefs.dock': 'bottom' }); w.hold = false; w.release(); await flush();
  const conf = c.renderVals().save; assert.equal(conf.text, '다른 곳에서 먼저 바뀌었습니다 · 닫기'); conf.run(); assert.match(c.renderVals().save.text, /^그 노드의 값 · /);
  // 끊김 — 사본 있음 / 없음
  w.fail.n1 = { code: 'NODE_OFFLINE', status: 409 }; await T.deskFetch('n1', { force: true });
  assert.match(c.renderVals().save.text, /^끊김 · 읽기 전용 · .* 사본$/);
  const w2 = world(); w2.fail.n1 = { code: 'RELAY_NOT_CONNECTED', status: 409 }; const O = setup(w2); O.c.renderVals(); await flush();
  assert.equal(O.c.renderVals().save.text, '끊김 · 사본 없음');
  // 옛 버전 · 모듈 꺼짐 · 권한
  const old = world(); old.fail.n1 = { code: 'OPERATION_NOT_REMOTE', status: 404 }; const OC = setup(old); OC.c.renderVals(); await flush();
  assert.equal(OC.c.renderVals().save.text, '이 노드의 gui-v3가 옛 버전이라 바탕 구성을 읽고 쓸 수 없습니다');
  const dn = world(); dn.fail.n1 = { code: 'MODULE_UNAVAILABLE', status: 503 }; const DC = setup(dn); DC.c.renderVals(); await flush();
  assert.equal(DC.c.renderVals().save.text, '그 노드의 gui-v3가 꺼져 있음 · 읽기 전용');
  const dd = world(); dd.fail.n1 = { code: 'MODULE_PERMISSION_DENIED', status: 403 }; const DD = setup(dd); DD.c.renderVals(); await flush();
  assert.equal(DD.c.renderVals().save.text, '바탕 구성 권한 없음 · 읽기 전용 — MODULE_PERMISSION_DENIED');
});

test('저장 실패는 처리 안 된 rejection 을 남기지 않는다(드롭 · 설정 · 다시 시도)', async () => {
  const seen = []; const h = (e) => seen.push(e); process.on('unhandledRejection', h);
  try {
    const w = world(), { c } = await ready(w);
    w.fail.patch = { code: 'INTERNAL', status: 500 }; c.state.ov = { id: 'home', x: 300, y: 200 }; c.dropIcon('home'); c.setPref('dark', false); await flush();
    c.renderVals().save.run(); await flush(); await new Promise((r) => setTimeout(r, 20));
    w.fail.n1 = { code: 'NODE_OFFLINE' }; await c.TN().deskFetch('n1', { force: true }); delete w.fail.patch;
    c.setPref('dark', true); c.addShortcut({ id: 'm', name: 'M' }, { id: 'a', name: 'A' }); c.newFolder(); await flush(); await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, [], '처리 안 된 rejection 없음');
  } finally { process.off('unhandledRejection', h); }
});

test('아이콘 id · 길이 — 서버 규칙(^[a-z0-9][a-z0-9_-]{0,63}$ · 이름 256B · loc/app/mod/src 128B)에 맞춘다', async () => {
  const w = world(), { T, c } = await ready(w), ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const M = { id: 'Lab.Stellaxia.Agent', name: 'Agent' + '가'.repeat(90) }, A = { id: 'Main.App', name: '이름'.repeat(80) };
  c.addShortcut(M, A); await flush();
  const added = w.calls.filter((x) => x.op === 'patch').at(-1).input.set, keys = Object.keys(added).filter((k) => k.startsWith('icons.'));
  assert.equal(keys.length, 1); const id = keys[0].slice(6), v = added[keys[0]];
  assert.match(id, ID, id);
  assert.ok(Buffer.byteLength(v.name) <= 256 && v.name.length > 0, '이름 256B'); assert.ok(Buffer.byteLength(v.src) <= 128, 'src 128B');
  const long = { id: 'x'.repeat(200) + '.y', name: 'L' }, long2 = { id: 'x'.repeat(200) + '.z', name: 'L' };
  const ids = []; for (const m of [long, long2]) { c.addShortcut(m, { id: 'a', name: 'a' }); await flush(); ids.push(Object.keys(w.calls.filter((x) => x.op === 'patch').at(-1).input.set).find((k) => k.startsWith('icons.')).slice(6)); }
  assert.ok(ids.every((x) => ID.test(x)), '긴 id 도 규칙에 맞는다 — ' + ids.map((x) => x.length)); assert.notEqual(ids[0], ids[1], '잘려도 서로 다른 모듈이면 다른 id');
  assert.ok(Buffer.byteLength(w.calls.filter((x) => x.op === 'patch').at(-1).input.set['icons.' + ids[1]].mod) <= 128, 'mod 128B');
  void T;
});

test('PC 상태 — terra.pc.desk.<node_id> 에 PC 키만(아이콘 · 모양 없음), 노드가 바뀌면 저장 후 그 노드 것을 불러온다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const w = world(), { T, c } = await ready(w);
  c.setState({ wins: { files: { x: 5, y: 6, w: 400, h: 300 } }, order: ['files'], fmLoc: 'vault' }); c.renderVals(); mock.timers.tick(500);
  const saved = JSON.parse(localStorage.getItem('terra.pc.desk.n1'));
  assert.deepEqual(Object.keys(saved).sort(), ['cfgGrp', 'devSel', 'fmLoc', 'full', 'modSel', 'modTab', 'modView', 'order', 'resTab', 'setTab', 'wins'].filter((k) => k in saved).sort());
  assert.ok(!('icons' in saved) && !('prefs' in saved) && !('tterm' in saved) && !('ttHist' in saved));
  assert.deepEqual(saved.wins, { files: { x: 5, y: 6, w: 400, h: 300 } }); assert.equal(saved.fmLoc, 'vault');
  assert.equal(localStorage.getItem('terra.view.desk.T1'), null, '옛 키는 쓰지 않는다');
  assert.ok(![...mem.keys()].some((k) => k.startsWith('terra.pc.term.')), 'principal 을 모르면 터미널 기록을 쓰지 않는다');
  // 노드 바뀜 — 같은 자리(슬롯)가 다른 노드로
  c.props = Object.assign({}, c.props, { nodeKey: 'T2', nodeRid: 'n2' }); c.renderVals();
  assert.deepEqual(c.state.wins, {}, '다른 노드는 자기 창 상태(처음)부터'); assert.equal(c.state.fmLoc, 'home');
  c.props = Object.assign({}, c.props, { nodeKey: 'T1', nodeRid: 'n1' }); c.renderVals();
  assert.deepEqual(c.state.wins, saved.wins, '돌아오면 그 노드의 창 상태'); void T;
});

test('Terra 터미널 기록 — terra.pc.term.<principal>.<node_id>, principal 을 알 때만 · 계정마다 따로', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const w = world(), { c } = await ready(w, {}, { principal: 'user:a' });
  c.setState({ tterm: [{ t: 'hello', c: 'out' }], ttHist: ['node list'] }); c.renderVals(); mock.timers.tick(500);
  const k = termPrefix('user:a') + 'n1'; assert.ok(localStorage.getItem(k), '계정 구분 키에 쓴다'); assert.deepEqual(JSON.parse(localStorage.getItem(k)), { tterm: [{ t: 'hello', c: 'out' }], ttHist: ['node list'] });
  assert.ok(!('tterm' in JSON.parse(localStorage.getItem(deskKey('n1')))), '창 상태 키에는 터미널 기록이 없다');
  // 같은 계정이 다시 열면 불러온다 · 다른 계정은 못 본다
  const w2 = world(); const keep = [...mem.entries()]; const a2 = setup(w2, {}, { principal: 'user:a' }); for (const [kk, vv] of keep) mem.set(kk, vv); w2.seed('n1', a2.T);
  a2.c.props = Object.assign({}, a2.c.props); a2.c._bound = null; a2.c.renderVals();
  assert.deepEqual(a2.c.state.ttHist, ['node list'], '같은 계정은 이어서');
  window.TerraWho = { principal: 'user:b' }; const b = new Embed({ nodeName: 'ws', nodeKey: 'T1', nodeRid: 'n1', winW: 1240, winH: 760, chrome: 'none' }); b.renderVals();
  assert.deepEqual(b.state.ttHist, [], '다른 계정은 앞 사람의 기록을 보지 못한다');
});

test('로그아웃 신호 — 저장 타이머가 삭제보다 먼저 취소되고, 메모리의 터미널 기록은 초기값으로, 토큰 갱신(clear 만)은 기록을 지우지 않는다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const w = world(), { T, c } = await ready(w, {}, { principal: 'user:a' });
  c.setState({ tterm: [{ t: 'secret', c: 'out' }], ttHist: ['api x'] }); c.renderVals(); mock.timers.tick(500);   // 저장됨
  const k = termPrefix('user:a') + 'n1'; assert.ok(localStorage.getItem(k));
  c.setState({ ttHist: ['api x', 'api y'] }); c.renderVals();   // 저장 타이머가 대기 중
  assert.ok(c._vt, '대기 중인 저장 타이머');
  // 토큰 갱신 — clear 만 부른다: 기록 불변
  T.clear(); assert.ok(localStorage.getItem(k), '토큰 갱신은 터미널 기록을 지우지 않는다'); assert.deepEqual(c.state.ttHist, ['api x', 'api y']);
  // 로그아웃 — 신호 → 삭제 → TerraWho = null
  pcLogout(window, localStorage);
  assert.equal(c._vt, 0, '타이머 취소'); assert.equal(localStorage.getItem(k), null, '삭제됨'); assert.equal(window.TerraWho, null);
  mock.timers.tick(2000); assert.equal(localStorage.getItem(k), null, '취소된 타이머가 지운 기록을 되살려 쓰지 않는다');
  assert.deepEqual(c.state.tterm.map((l) => l.t), ['Terra 터미널 — terra shell 낱말 · 명령 목록 : help'].map((t) => t), '메모리의 터미널 줄은 초기값'); assert.deepEqual(c.state.ttHist, []);
  c.renderVals(); mock.timers.tick(2000); assert.equal(localStorage.getItem(k), null, '그 뒤 그려도(principal 없음) 쓰지 않는다');
});

test('배경 그림 — 전용 메서드로 올리고(노드 id 로) 노드 값에서 읽는다: 받는 동안은 "배경 불러오는 중", 노을로 떨어지지 않는다', async () => {
  const w = world(), { T, c } = await ready(w);
  const bytes = new Uint8Array(1500 * 1024).fill(7);
  let tick = 0; const files = new Map(); w.t.invokeRid = ((orig) => (rid, op, input) => {   // 파일 연산 흉내(받기 조각 480KiB)
    if (op.endsWith('node-files.put')) { const cur = files.get(input.path) || { chunks: [], size: input.total, mod: ++tick }; cur.chunks[input.offset] = input.data; files.set(input.path, cur); w.calls.push({ rid, op: 'put', input: { path: input.path, offset: input.offset, total: input.total, mime: input.mime } });
      const got = Object.entries(cur.chunks).reduce((a, [, d]) => a + Buffer.from(d, 'base64').length, 0); return Promise.resolve({ done: got >= input.total, received: got, total: input.total }); }
    if (op.endsWith('node-files.list')) { w.calls.push({ rid, op: 'list', input }); return Promise.resolve({ entries: [...files].map(([p, f]) => ({ path: p, size: 1, mime: 'image/png', modified: new Date(1.7e12 + f.mod * 1000).toISOString() })) }); }
    if (op.endsWith('node-files.delete')) { w.calls.push({ rid, op: 'delete', input }); files.delete(input.path); return Promise.resolve({ deleted: true }); }
    if (op.endsWith('node-files.get')) { const cur = files.get(input.path); const all = Buffer.concat(Object.keys(cur.chunks).map(Number).sort((a, b) => a - b).map((o) => Buffer.from(cur.chunks[o], 'base64'))); const part = all.subarray(input.offset, input.offset + input.limit); return Promise.resolve({ path: input.path, size: all.length, mime: 'image/png', data: part.toString('base64') }); }
    return orig(rid, op, input); })(w.t.invokeRid);
  // 형식 · 크기 거절
  await assert.rejects(T.deskWallPut('n1', { name: 'a.bmp', type: 'image/bmp', bytes }), { code: 'WALL_TYPE' });
  await assert.rejects(T.deskWallPut('n1', { name: 'a.png', type: 'image/png', bytes: new Uint8Array(2.5 * 1024 * 1024 + 1) }), { code: 'WALL_TOO_LARGE' });
  await T.deskWallPut('n1', { name: '내 배경.png', type: 'image/png', bytes });
  const puts = w.calls.filter((x) => x.op === 'put'); assert.ok(puts.length >= 3, '640KiB 청크로 나눠 올린다 — ' + puts.length);
  assert.match(puts[0].input.path, /^desk\/wall\/\d+\.png$/); assert.ok(puts.every((p) => p.rid === 'n1'));
  const patch = w.calls.filter((x) => x.op === 'patch').at(-1).input.set;
  assert.deepEqual(Object.keys(patch).sort(), ['prefs.wall', 'wall']); assert.equal(patch['prefs.wall'], 'img'); assert.equal(patch.wall.file, puts[0].input.path); assert.equal(patch.wall.name, '내 배경.png'); assert.equal(patch.wall.type, 'image/png');
  assert.equal(w.db.n1.doc.prefs.wall, 'img'); assert.equal(w.calls.filter((x) => x.op === 'delete').length, 0, '지울 지난 파일이 없다');
  // 두 번째 올리기 — 지난 파일 정리(방금 것은 남긴다)
  await new Promise((r) => setTimeout(r, 3)); await T.deskWallPut('n1', { name: 'b.png', type: 'image/png', bytes: new Uint8Array(1000).fill(3) });
  const newest = w.db.n1.doc.wall.file; assert.notEqual(newest, patch.wall.file);
  assert.deepEqual([...files.keys()], [newest], '지난 파일은 지워지고 지금 파일만'); assert.ok(w.calls.some((x) => x.op === 'delete' && x.input.path === patch.wall.file));
  // 화면 — 이미 받은 그림은 바로(방금 올린 것은 사본에 있다)
  let v = c.renderVals(); assert.match(v.wall.bg, /^url\('data:image\/png;base64,/);
  // 다른 PC 가 올린 그림(우리 쪽 사본 없음) — 받는 동안 노을로 떨어지지 않는다
  const f2 = 'desk/wall/9999999999999.png'; files.set(f2, { chunks: { 0: Buffer.from(new Uint8Array(900).fill(9)).toString('base64') }, size: 900, mod: ++tick });
  w.other('n1', { wall: { file: f2, name: '다른 PC.png', type: 'image/png', at: 1 }, 'prefs.wall': 'img' }); await T.deskFetch('n1', { force: true });
  v = c.renderVals(); assert.equal(v.wallWait, 'flex', '"배경 불러오는 중" 표시'); assert.equal(v.wall.id, 'img-wait'); assert.doesNotMatch(v.wall.bg, /linear-gradient/, '노을로 떨어지지 않는다');
  await flush(); v = c.renderVals(); assert.match(v.wall.bg, /^url\('data:image\/png;base64,/); assert.equal(v.wallWait, 'none');
  // 지우기 — 노을로, 파일 정리
  await T.deskWallClear('n1'); assert.equal(w.db.n1.doc.wall, undefined); assert.equal(w.db.n1.doc.prefs.wall, 'dusk');
  assert.equal(files.size, 0, '지운 뒤 desk/wall/ 에 파일 0개'); assert.equal(c.renderVals().wall.id, 'dusk');
  // 읽기 전용이면 올리지 않는다
  w.fail.n1 = { code: 'NODE_OFFLINE' }; await T.deskFetch('n1', { force: true }); const n0 = w.calls.length;
  await assert.rejects(T.deskWallPut('n1', { name: 'c.png', type: 'image/png', bytes }), { code: 'PARTITIONED' }); assert.equal(w.calls.length, n0);
  assert.equal(localStorage.getItem('terra.wall.ws'), null, 'terra.wall.* 에 쓰지 않는다');
});

test('소스 — 옛 저장 흔적이 없다(wallKey · terra.wall · terra.view · 500ms 가짜 saved · state.icons/prefs)', () => {
  const code = parseBoard(embedSrc).script;
  for (const bad of ['wallKey', "terra.wall.", "terra.view.", "save: 'saved'", "s.save ===", 'state.icons', 'state.prefs', 'tar:']) assert.ok(!code.includes(bad), bad + ' 가 남아 있다');
  assert.ok(!/name: 'backup\.tar'/.test(code), '시안 아이콘 backup.tar 는 기본값에서 뺐다');
  assert.match(code, /wallFit: 'cover'/); assert.match(code, /T\.deskDefaults = /);
});
