// node --test — 2차 리뷰 결함의 회귀 시험(설계 node-owned-desk.md §6.3 · §7 · §9.2 · §11): 실패 표시 누적 · 첫 쓰기 대기분 base · 배경 정리(modified) · 장면 id 재묶기(rebound · 열린 제어기 창 다시 찾기)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { c.parentNode = this; return c; }, insertBefore(c) { c.parentNode = this; return c; }, removeChild(c) { c.parentNode = null; }, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {} });
const handlers = {};   // 가시성 · 포커스 구독을 손으로 부른다
globalThis.document = { visibilityState: 'visible', createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el(),
  addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener: (n, f) => { if (handlers[n] === f) delete handlers[n]; } };
globalThis.window = globalThis;
globalThis.addEventListener = (n, f) => { handlers[n] = f; };
globalThis.removeEventListener = (n, f) => { if (handlers[n] === f) delete handlers[n]; };

const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const dir = mkdtempSync(join(tmpdir(), 'node-desk-'));
const f = join(dir, 'TerraNodes.mjs');
writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/TerraNodes.dc.html', import.meta.url)), 'utf8'), 'TerraNodes', RT));
await import(pathToFileURL(f).href);
const P = 'lab.stellaxia.gui-v3.node-desk.';
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
const DEFAULTS = { icons: { a: { c: 0, r: 0 }, b: { c: 1, r: 0 } }, prefs: { dark: true, wall: 'none', dock: 'bottom', snap: true, anim: true } };

/** 가짜 노드 저장소 + 전송. hold 면 응답을 손으로 푼다. 서버 규칙: revs 충돌 · base > revision 충돌 · 첫 쓰기 형태 */
function world() {
  const db = {}, calls = [], held = [], w = { db, calls, held, hold: false, fail: {}, noDetails: false, signals: [], ignoreSignal: false, local: '' };
  const at = (rid) => db[rid] || (db[rid] = { revision: 0, doc: null, revs: {}, floor: 0 });
  w.other = (rid, set) => { const N = at(rid), rev = ++N.revision; N.doc = N.doc || { icons: {}, prefs: {} }; for (const k in set) { N.revs[k] = rev; const [g, x] = k.split('.'); if (set[k] === null) delete N.doc[g][x]; else N.doc[g][x] = set[k]; } };
  w.seed = (rid) => { const N = at(rid); N.revision = 1; N.doc = JSON.parse(JSON.stringify(DEFAULTS)); for (const k of ['dark', 'wall', 'dock', 'snap', 'anim']) N.revs['prefs.' + k] = 1; N.doc.prefs.wallFit = 'cover'; };
  const serve = (rid, op, input) => {
    const N = at(rid), e = w.fail[op.replace(P, '')] || w.fail[rid];
    if (e) throw e;
    if (op === P + 'get') { if (N.revision === 0) return { revision: 0, doc: null }; return input.since_revision === N.revision ? { revision: N.revision, unchanged: true } : { revision: N.revision, doc: JSON.parse(JSON.stringify(N.doc)) }; }
    const keys = Object.keys(input.set), bad = keys.filter((k) => (N.revs[k] ?? N.floor) > input.base_revision);
    if (input.base_revision > N.revision || bad.length || w.again) { if (w.again) w.again--; throw { code: 'REVISION_CONFLICT', status: 409, details: w.noDetails ? undefined : { keys: bad.length ? bad : keys } }; }
    if (N.revision === 0 && !(['dark', 'wall', 'wallFit', 'dock', 'snap', 'anim'].every((f) => 'prefs.' + f in input.set) && keys.some((k) => k.startsWith('icons.')))) throw { code: 'INVALID_REQUEST', status: 400 };
    const before = JSON.parse(JSON.stringify(N)); w.other(rid, input.set); void before;
    return { revision: N.revision, doc: JSON.parse(JSON.stringify(N.doc)) };
  };
  w.t = {
    kind: 'gateway', localId: () => w.local,
    invokeRid(rid, op, input, o = {}) {
      calls.push({ rid, op: op.replace(P, ''), input: JSON.parse(JSON.stringify(input)), signal: o.signal }); if (o.signal) w.signals.push(o.signal);
      return new Promise((ok, no) => {
        const run = () => { try { ok(serve(rid, op, input)); } catch (e) { no(e); } };
        if (!w.hold) return run();
        const h = { rid, op: op.replace(P, ''), run, fail: no }; held.push(h);
        if (o.signal && !w.ignoreSignal) o.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  };
  w.release = (i = 0) => { const h = held.splice(i, 1)[0]; h.run(); return h; };
  return w;
}
const live = [];
function store(w) {
  delete window.TerraNodes; window.TerraTransport = w.t; mem.clear();
  new (boardDef('TerraNodes').Logic)({}); const T = window.TerraNodes; T.deskDefaults = JSON.parse(JSON.stringify(DEFAULTS)); live.push(T); return T;
}
test.afterEach(() => { for (const T of live.splice(0)) T.deskStop(); document.visibilityState = 'visible'; mock.timers.reset(); for (const k of Object.keys(handlers)) delete handlers[k]; });
/** 받고 첫 쓰기까지 — 'ok' 상태 */
async function ready(w, T, rid = 'n1') { w.seed(rid); await T.deskFetch(rid); return T; }
const sets = (w, op) => w.calls.filter((c) => c.op === op);


const J = JSON.stringify;
const embedSrc = readFileSync(fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url)), 'utf8');

test('1 일반 실패 표시 — 다른 키의 저장 성공이 지우지 못한다 · 키별 누적 · 그 키가 성공하거나 닫을 때만 제거 · deskRetry 는 남은 전부', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.fail.patch = { code: 'MODULE_UNAVAILABLE', message: 'x' };
  await T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }).catch(() => {}); await flush();
  await T.deskPatch('n1', { 'icons.b': { c: 8, r: 8 } }).catch(() => {}); await flush();
  assert.equal(T.deskRead('n1').save.state, 'failed'); assert.equal(T.deskRead('n1').save.code, 'MODULE_UNAVAILABLE');
  delete w.fail.patch;
  await T.deskPatch('n1', { 'prefs.dark': false });   // 다른 키 — 성공
  let r = T.deskRead('n1'); assert.equal(r.save.state, 'failed', '다른 저장 성공은 실패 표시를 지우지 못한다'); assert.equal(r.save.code, 'MODULE_UNAVAILABLE'); assert.ok(r.save.at > 0);
  assert.equal(w.db.n1.doc.prefs.dark, false);
  await T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } });   // 실패했던 키 a 가 성공 → a 만 빠진다
  r = T.deskRead('n1'); assert.equal(r.save.state, 'failed', 'b 가 남아 있다');
  w.calls.length = 0; await T.deskRetry('n1');   // 남은 전부(b)
  assert.deepEqual(Object.keys(w.calls.find((c) => c.op === 'patch').input.set), ['icons.b'], 'deskRetry 는 남은 것 전부'); assert.deepEqual(w.db.n1.doc.icons.a, { c: 9, r: 9 });
  r = T.deskRead('n1'); assert.equal(r.save.state, 'saved'); await assert.rejects(T.deskRetry('n1'), { code: 'NOTHING_TO_RETRY' });
  // 닫기
  w.fail.patch = { code: 'INTERNAL', message: 'x' }; await T.deskPatch('n1', { 'icons.a': { c: 1, r: 1 } }).catch(() => {}); await flush(); delete w.fail.patch;
  await T.deskPatch('n1', { 'prefs.snap': false }); assert.equal(T.deskRead('n1').save.state, 'failed');
  T.deskClearSave('n1'); assert.equal(T.deskRead('n1').save.state, 'idle'); await assert.rejects(T.deskRetry('n1'), { code: 'NOTHING_TO_RETRY' });
});

test('2 공유 폴더 설정 저장의 성공 문구는 ndSet 의 ok 콜백으로(실패하면 말하지 않는다)', () => {
  assert.ok(embedSrc.includes("save: true }, { ok: () => this.say('저장 — 재시작 후 반영 (설정 › 노드 설정)') }); }"));
  assert.ok(!/save: true \}\); this\.say\('저장 — 재시작/.test(embedSrc));
});

test('4 첫 쓰기(revision 0) 전송 중 쌓인 다른 키는 첫 쓰기 응답 revision 으로 base 가 올라 409 없이 나간다', async () => {
  const w = world(), T = store(w); await T.deskFetch('n1'); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 3, r: 3 } }), q = T.deskPatch('n1', { 'prefs.dark': false });
  w.hold = false; w.release(); await p; await flush(); await flush(); await q; await flush();
  assert.equal(w.db.n1.doc.prefs.dark, false); assert.equal(T.deskRead('n1').save.state, 'saved');
  assert.deepEqual(sets(w, 'patch').map((c) => c.input.base_revision), [0, 1]);
});

/** 배경 정리 — node-files.list 의 modified 로만 */
function sweepWorld(entries, now) {
  const w = world(), dels = [], orig = w.t.invokeRid;
  w.t.invokeRid = (rid, op, input, o) => {
    if (op.endsWith('node-files.list')) return Promise.resolve({ entries });
    if (op.endsWith('node-files.delete')) { dels.push(input.path); return Promise.resolve({ deleted: true }); }
    return orig(rid, op, input, o);
  };
  w.dels = dels; if (now) { w.seed('n1'); w.db.n1.doc.wall = { file: now, name: 'n', type: 'image/png', at: 1 }; }
  return w;
}
const ent = (p, sec) => ({ path: p, size: 1, mime: 'image/png', modified: new Date(1.7e12 + sec * 1000).toISOString() });
test('5 배경 정리 — 가리키는 파일보다 오래된 것만 지운다(다른 PC 가 막 올린 새 파일 · 시계 차이와 무관)', async () => {
  const w = sweepWorld([ent('desk/wall/1.png', 10), ent('desk/wall/2.png', 20), ent('desk/wall/3.png', 30)], 'desk/wall/2.png'), T = store(w); await T.deskFetch('n1');
  await T.deskWallSweep('n1', 'desk/wall/2.png');
  assert.deepEqual(w.dels, ['desk/wall/1.png'], '더 새 3.png 는 남긴다');
  // 가리키는 파일의 modified 를 모르면 아무것도 지우지 않는다
  const w2 = sweepWorld([{ path: 'desk/wall/2.png', size: 1, mime: 'x', modified: '' }, ent('desk/wall/1.png', 10)], 'desk/wall/2.png'), T2 = store(w2); await T2.deskFetch('n1');
  await T2.deskWallSweep('n1', 'desk/wall/2.png'); assert.deepEqual(w2.dels, []);
  // 지우기(가리키는 파일 없음) — 전부
  const w3 = sweepWorld([ent('desk/wall/1.png', 10), ent('desk/wall/2.png', 20)]), T3 = store(w3); await ready(w3, T3);
  await T3.deskWallSweep('n1', ''); assert.deepEqual(w3.dels.sort(), ['desk/wall/1.png', 'desk/wall/2.png']);
});

test('3a rebound — 장면 id 의 사본 · 링크가 지워지고, 옛 노드의 늦은 응답은 새 노드 사본이 되지 못한다', async () => {
  const w = world(); w.t.meta = { T3: { id: 'T3', rid: 'nd_a' } };
  let ans; w.t.invoke = () => new Promise((ok) => { ans = ok; });
  const T = store(w);
  T.cache.set('T3|modules', { data: [{ id: 'old' }], at: Date.now(), src: '노드' }); T.cache.set('T4|modules', { data: [{ id: 'keep' }], at: Date.now() }); T.links.set('T3', { state: 'offline' });
  const p = T.refresh('T3', 'modules');   // 옛 노드로 나간 요청
  T.rebound(['T3']);
  assert.equal(T.cache.get('T3|modules'), undefined, '다른 노드 사본이 안 보인다'); assert.equal(T.links.has('T3'), false); assert.ok(T.cache.get('T4|modules'), '다른 id 는 그대로');
  ans([{ id: 'from-old-node' }]); await p;
  assert.equal(T.cache.get('T3|modules'), undefined, '옛 노드의 늦은 응답은 버린다');
  assert.equal(T.read('T3', 'modules').data, null);
});

test('3b 열린 제어기 창 — 지도가 다시 만들어져 장면 id 가 밀려도 pinned rid 로 다시 찾고, 사라지면 닫는다(watch 짝 유지) · rid 가 바뀐 id 만 rebound', async () => {
  const { parseBoard } = await import('../tools/dc-board.mjs');
  class DC { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, p); } }
  for (const [name, file, pre] of [['Field', 'Field.dc.html', ''], ['Scene', 'Scene.dc.html', 'gf_']]) {
    const C = new Function('DCLogic', parseBoard(readFileSync(fileURLToPath(new URL('../design/' + file, import.meta.url)), 'utf8')).script + '\nreturn Component;')(DC);
    const c = Object.create(C.prototype); c.state = {}; c.setState = (p) => Object.assign(c.state, p);
    const N = (id, rid, nm) => ({ id, rid, name: nm, kind: 'leaf', parent: { name: 'p' }, kids: [], path: '/' + nm });
    let MD = { all: [N('P1:a', 'ra', 'a'), N('P1:b', 'rb', 'b'), N('P1:c', 'rc', 'c')], byId: {} };
    const calls = [], meta = {}, rebound = [];
    window.TerraNodes = { shapes: {}, subscribe() {}, watch: (r, o) => calls.push(['w', r, o.scene]), unwatch: (r) => calls.push(['u', r]), rebound: (ids) => rebound.push(...ids), t: { meta, kind: 'gateway', bindScene(l, ms) { for (const m of ms) meta[m.id] = m; } } };
    const WL = pre ? '_q_wins' : '_wins', WS = pre ? '_q_ctlWs' : '_ctlWs';
    c[pre ? 'sceneMap' : 'mapData'] = () => MD; c[pre + 'localNode'] = () => MD.all[0]; c[pre + 'layout'] = () => {};
    const tn = () => c[pre + 'TN']();
    tn();   // 첫 묶기
    const b = MD.all[1], cc = MD.all[2]; c[WL] = [{ node: b, kind: 'ctl', arg: '' }, { node: cc, kind: 'ctl', arg: '' }];   // b: 슬롯 1 에 열림 · c: 최소화(슬롯 없음)
    const slot = { slot: 1, kind: 'ctl', node: b, wrap: { style: {} }, raf: 0 }; c[WS] = [null, slot]; c.state.ctlKey1 = 'P1:b'; c.state.ctlRid1 = 'rb';
    c[pre + 'ctlWatch'](b, true); c[pre + 'ctlWatch'](cc, true); calls.length = 0;
    // 지도 재구성 — 새 노드가 끼어 b 의 장면 id 가 밀린다(옛 'P1:b' 는 이제 다른 노드), c 는 지도에서 사라짐
    MD = { all: [N('P1:a', 'ra', 'a'), N('P1:aa', 'rnew', 'aa'), N('P1:b', 'rother', 'x'), N('P1:bb', 'rb', 'b')], byId: {} };
    tn();
    assert.equal(slot.node.rid, 'rb', name + ' — 슬롯의 창이 pinned rid 로 다시 찾는다'); assert.equal(slot.node.id, 'P1:bb'); assert.equal(c.state.ctlKey1, 'P1:bb', name + ' — 장면 id(ctlKey) 갱신');
    assert.equal(c.state.ctlRid1, 'rb', 'pinned rid 는 그대로'); assert.equal(c[WL][0].node, slot.node);
    assert.deepEqual(rebound, ['P1:b'], name + ' — rid 가 바뀐 장면 id 만 rebound');
    assert.deepEqual(calls.slice(0, 2), [['u', 'rb'], ['w', 'rb', 'P1:bb']], name + ' — watch 의 scene 도 새 id 로');
    await new Promise((r) => setTimeout(r, 5));   // 사라진 c 의 창은 한 박자 뒤에 닫는다
    assert.equal(c[WL].length, 1, name + ' — 사라진 노드의 창 기록은 버린다'); assert.deepEqual(calls.at(-1), ['u', 'rc'], name + ' — unwatch 짝');
    delete window.TerraNodes;
  }
});
