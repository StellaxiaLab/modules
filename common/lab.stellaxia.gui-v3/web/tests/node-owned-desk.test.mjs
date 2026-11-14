// node --test — 제어기 바탕 구성은 그 노드가 원본이다(설계 node-owned-desk.md §7 · §8 · §10 · §12 · §13).
//   TerraNodes 의 desk 층: 사본 불변 + 표시층, 전송 하나 + 합본, 충돌 복귀, 타이머 · 가시성, 코드별 판정, 순번 · gen, 분할.
//   DOM 은 아주 작은 흉내. 가짜 노드는 revs 로 충돌을 판정하는 서버 규칙 그대로(첫 쓰기 형태 포함).
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

test('읽기 — 모르면 loading(요청 없음 · 기본값 view · 읽기 전용), 받으면 ok, revision 0 이면 empty', async () => {
  const w = world(), T = store(w), r0 = T.deskRead('n1');
  assert.equal(r0.state, 'loading'); assert.equal(r0.ro, true); assert.equal(r0.doc, null); assert.deepEqual(r0.view, DEFAULTS); assert.equal(w.calls.length, 0);
  assert.equal(await T.deskFetch('n1'), true);
  const r1 = T.deskRead('n1'); assert.equal(r1.state, 'empty'); assert.equal(r1.revision, 0); assert.equal(r1.ro, false); assert.deepEqual(r1.view, DEFAULTS);
  w.seed('n2'); await T.deskFetch('n2'); const r2 = T.deskRead('n2'); assert.equal(r2.state, 'ok'); assert.equal(r2.revision, 1); assert.equal(r2.doc.prefs.wallFit, 'cover');
  assert.equal(T.deskRead('').state, 'norid'); assert.equal(T.deskRead('').ro, true);
  assert.equal(await T.deskFetch(''), false); assert.equal(w.calls.length, 2);
});

test('캐시 — 키는 rid|nodedesk 하나뿐(입력이 키에 없다), unchanged 는 doc 을 지우지 않고 at 만 갱신', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1000 });
  const w = world(), T = store(w); w.seed('n1');
  await T.deskFetch('n1'); const at1 = T.deskRead('n1').at; mock.timers.tick(3000);
  await T.deskFetch('n1'); await T.deskFetch('n1');
  assert.equal(w.calls[0].input.since_revision, undefined); assert.equal(w.calls[1].input.since_revision, 1);
  const r = T.deskRead('n1'); assert.ok(r.doc && r.doc.icons.a); assert.equal(r.at, at1 + 3000);
  assert.deepEqual([...T.cache.keys()].filter((k) => k.includes('nodedesk')), ['n1|nodedesk']);
  w.other('n1', { 'icons.a': { c: 5, r: 5 } }); await T.deskFetch('n1');
  assert.deepEqual([...T.cache.keys()].filter((k) => k.includes('nodedesk')), ['n1|nodedesk']);
  assert.equal(T.deskRead('n1').revision, 2);
});

test('첫 쓰기 — revision 0 이면 기본값 전체(prefs 6칸 · icons)를 펼치고 사용자 변경을 위에, base 0', async () => {
  const w = world(), T = store(w); await T.deskFetch('n1');
  const r = await T.deskPatch('n1', { 'icons.a': { c: 3, r: 3 } });
  const c = sets(w, 'patch')[0].input; assert.equal(c.base_revision, 0);
  assert.deepEqual(Object.keys(c.set).sort(), ['icons.a', 'icons.b', 'prefs.anim', 'prefs.dark', 'prefs.dock', 'prefs.snap', 'prefs.wall', 'prefs.wallFit']);
  assert.equal(c.set['prefs.wallFit'], 'cover'); assert.deepEqual(c.set['icons.a'], { c: 3, r: 3 }); assert.deepEqual(c.set['icons.b'], { c: 1, r: 0 });
  assert.equal(r.revision, 1); assert.deepEqual(T.deskRead('n1').doc.icons.a, { c: 3, r: 3 }); assert.equal(T.deskRead('n1').state, 'ok');
  await T.deskPatch('n1', { 'prefs.dark': false });   // 두 번째부터는 바뀐 키만
  assert.deepEqual(sets(w, 'patch')[1].input, { base_revision: 1, set: { 'prefs.dark': false } });
});

test('응답 전 — 사본은 그대로, view 에는 반영, pending 에 키. 저장 시각은 응답 뒤에만', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const before = JSON.stringify(T.deskRead('n1').doc), p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': null });
  const r = T.deskRead('n1');
  assert.equal(JSON.stringify(r.doc), before, '사본 불변'); assert.deepEqual(r.view.icons.a, { c: 9, r: 9 }); assert.equal('b' in r.view.icons, false);
  assert.deepEqual([...r.pending].sort(), ['icons.a', 'icons.b']); assert.equal(r.save.state, 'saving'); assert.equal(r.save.at, 0);
  w.hold = false; w.release(); await p;
  const d = T.deskRead('n1'); assert.equal(d.pending.size, 0); assert.equal(d.save.state, 'saved'); assert.ok(d.save.at > 0);
  assert.deepEqual(d.doc.icons.a, { c: 9, r: 9 }); assert.equal('b' in d.doc.icons, false); assert.deepEqual(d.view, d.doc);
});

test('합본 — 전송은 하나, 전송 중 변경은 키별 최신값으로 다음 패치 한 번, 타이머 없음', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p1 = T.deskPatch('n1', { 'icons.a': { c: 1, r: 1 } }), p2 = T.deskPatch('n1', { 'icons.b': { c: 2, r: 2 } }), p3 = T.deskPatch('n1', { 'icons.b': { c: 3, r: 3 }, 'prefs.dark': false });
  assert.equal(sets(w, 'patch').length, 1, '동시에 전송은 하나'); assert.equal(w.held.length, 1);
  assert.deepEqual(T.deskRead('n1').view.icons.b, { c: 3, r: 3 });
  w.hold = false; w.release(); await p1; await flush();
  const ps = sets(w, 'patch'); assert.equal(ps.length, 2, '합본 한 번');
  assert.deepEqual(ps[1].input, { base_revision: 1, set: { 'icons.b': { c: 3, r: 3 }, 'prefs.dark': false } });
  await Promise.all([p2, p3]);
  const d = T.deskRead('n1'); assert.deepEqual(d.doc.icons.b, { c: 3, r: 3 }); assert.equal(d.doc.prefs.dark, false); assert.equal(d.pending.size, 0); assert.equal(d.save.state, 'saved');
});

test('실패 — 표시층 · 대기열을 비우고 사본 그대로, save failed 는 남는다, deskRetry 가 같은 set 을 다시', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 5000 });
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }), q = T.deskPatch('n1', { 'icons.b': { c: 8, r: 8 } });
  const before = JSON.stringify(T.deskRead('n1').doc);
  w.held[0].fail({ code: 'MODULE_PERMISSION_DENIED', message: 'no write' }); w.hold = false;
  await assert.rejects(p, { code: 'MODULE_PERMISSION_DENIED' }); await assert.rejects(q, { code: 'MODULE_PERMISSION_DENIED' });
  let r = T.deskRead('n1'); assert.equal(r.save.state, 'failed'); assert.equal(r.save.code, 'MODULE_PERMISSION_DENIED'); assert.equal(r.save.at, 0, '성공 시각이 아니다');
  assert.equal(r.pending.size, 0); assert.equal(JSON.stringify(r.doc), before); assert.deepEqual(r.view, r.doc); assert.equal(r.state, 'ok', '쓰기 거절은 읽기 상태를 바꾸지 않는다');
  assert.equal(sets(w, 'patch').length, 1, '대기분은 나가지 않았다');
  mock.timers.tick(120000); await flush(); assert.equal(T.deskRead('n1').save.state, 'failed', '저절로 사라지지 않는다');
  await T.deskRetry('n1'); assert.deepEqual(sets(w, 'patch')[1].input.set, { 'icons.a': { c: 7, r: 7 }, 'icons.b': { c: 8, r: 8 } }, '전송분 + 그때 대기분');
  r = T.deskRead('n1'); assert.equal(r.save.state, 'saved'); assert.deepEqual(r.doc.icons.a, { c: 7, r: 7 });
  w.fail.patch = { code: 'MODULE_UNAVAILABLE' }; await assert.rejects(T.deskPatch('n1', { 'prefs.snap': false }), { code: 'MODULE_UNAVAILABLE' });
  T.deskClearSave('n1'); assert.equal(T.deskRead('n1').save.state, 'idle'); await assert.rejects(T.deskRetry('n1'), { code: 'NOTHING_TO_RETRY' });
});

test('충돌 — 노드 값으로 돌아가고 "다른 곳에서 먼저 바뀌었습니다", lost 에 키', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } });   // 다른 곳에서 먼저
  await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } }), (e) => e.code === 'REVISION_CONFLICT' && e.lost.join() === 'icons.a');
  assert.deepEqual(w.calls.slice(-2).map((c) => c.op), ['patch', 'get'], '곧바로 force 읽기');
  const r = T.deskRead('n1'); assert.deepEqual(r.view.icons.a, { c: 4, r: 4 }, '노드 값'); assert.equal(r.pending.size, 0);
  assert.equal(r.save.state, 'failed'); assert.equal(r.save.code, 'REVISION_CONFLICT'); assert.equal(r.save.msg, '다른 곳에서 먼저 바뀌었습니다'); assert.deepEqual(r.save.lost, ['icons.a']);
  assert.equal(sets(w, 'patch').length, 1);
});

test('충돌 + 다른 키 — 충돌 키만 잃고 나머지는 새 revision 으로 한 번 자동 재전송', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } });
  await T.deskPatch('n1', { 'icons.b': { c: 6, r: 6 } });   // 선행 쓰기(아직 알려진 revision 이 낡은 사본 · b 는 충돌 아님)
  w.other('n1', { 'icons.a': { c: 5, r: 5 } }); const base0 = T.deskRead('n1').revision;
  const r = await Promise.allSettled([T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': { c: 7, r: 7 } })]);
  assert.equal(r[0].status, 'rejected'); assert.deepEqual(r[0].reason.lost, ['icons.a']);
  const ps = sets(w, 'patch'); assert.equal(ps.length, 3, 'b 선행 1 + 충돌 1 + 자동 재전송 1(원래 base 그대로)');
  assert.deepEqual(ps[2].input, { base_revision: base0, set: { 'icons.b': { c: 7, r: 7 } } });
  const d = T.deskRead('n1'); assert.deepEqual(d.doc.icons.b, { c: 7, r: 7 }); assert.deepEqual(d.doc.icons.a, { c: 5, r: 5 });
  assert.equal(d.save.state, 'failed'); assert.deepEqual(d.save.lost, ['icons.a']); assert.ok(d.save.at > 0); assert.equal(d.pending.size, 0);
});

test('충돌 + 재전송도 409 — 그것도 lost 에 합치고 끝(세 번째 전송 없음)', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.again = 0;
  const orig = w.t.invokeRid; let n = 0;
  w.t.invokeRid = (rid, op, input, o) => { if (op === P + 'patch' && ++n === 2) { w.other('n1', { 'icons.b': { c: 0, r: 9 } }); } return orig(rid, op, input, o); };   // 재전송 직전에 b 도 먼저 바뀐다
  await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': { c: 7, r: 7 } }), (e) => e.lost.sort().join() === 'icons.a,icons.b');
  assert.equal(sets(w, 'patch').length, 2); assert.deepEqual(T.deskRead('n1').save.lost.sort(), ['icons.a', 'icons.b']); assert.equal(T.deskRead('n1').pending.size, 0);
  assert.deepEqual(T.deskRead('n1').view.icons.b, { c: 0, r: 9 }, '노드 값');
});

test('충돌 — details.keys 가 없으면(Gateway 가 안 넘김) 보낸 키 전부가 충돌', async () => {
  const w = world(), T = store(w); await ready(w, T); w.noDetails = true;
  w.other('n1', { 'icons.a': { c: 4, r: 4 } });
  await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': { c: 7, r: 7 } }), (e) => e.lost.sort().join() === 'icons.a,icons.b');
  assert.equal(sets(w, 'patch').length, 1, '재전송 없음'); assert.deepEqual(T.deskRead('n1').save.lost.sort(), ['icons.a', 'icons.b']);
  assert.deepEqual(T.deskRead('n1').doc.icons.b, { c: 1, r: 0 });
});

test('분할 — 읽기 전용 · 대기열 없음 · PARTITIONED 즉시 거절(표시층 없음) · 재연결 때 몰래 보내지 않는다', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 2, r: 2 } }), q = T.deskPatch('n1', { 'icons.b': { c: 3, r: 3 } });   // q 는 대기
  w.held[0].fail({ code: 'UPSTREAM_UNREACHABLE', message: 'cut' }); w.fail.get = { code: 'UPSTREAM_UNREACHABLE', message: 'cut' }; w.hold = false;   // 끊김은 계속 — 실패 뒤 다시 읽어도 끊겨 있다
  await assert.rejects(p, { code: 'UPSTREAM_UNREACHABLE' }); await assert.rejects(q, { code: 'UPSTREAM_UNREACHABLE' });
  const r = T.deskRead('n1'); assert.equal(r.state, 'offline'); assert.equal(r.ro, true); assert.equal(r.save.state, 'failed'); assert.equal(r.pending.size, 0); assert.ok(r.doc, '마지막 사본은 남는다');
  const n = w.calls.length;
  await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 8, r: 8 } }), { code: 'PARTITIONED' });
  assert.equal(T.deskRead('n1').pending.size, 0); assert.equal(w.calls.length, n, '나가지 않았다');
  delete w.fail.get; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'ok');   // 재연결
  await flush(); assert.equal(sets(w, 'patch').length, 1, '재연결해도 낡은 의도를 보내지 않는다'); assert.deepEqual(T.deskRead('n1').doc.icons.a, { c: 0, r: 0 });
});

test('아직 모르면 쓰기는 DESK_NOT_READY(표시층 없음)', async () => {
  const w = world(), T = store(w);
  await assert.rejects(T.deskPatch('n1', { 'icons.a': null }), { code: 'DESK_NOT_READY' }); assert.equal(T.deskRead('n1').pending.size, 0); assert.equal(w.calls.length, 0);
});

const TABLE = [['OPERATION_NOT_REMOTE', 'old'], ['MODULE_ROUTE_NOT_FOUND', 'down'], ['MODULE_UNAVAILABLE', 'down'], ['MODULE_PERMISSION_DENIED', 'denied'], ['DELEGATION_REQUIRED', 'far'], ['NODE_NOT_FOUND', 'none'], ['NODE_UNMAPPED', 'none'], ['NO_NODE', 'norid'],
  ['NODE_OFFLINE', 'offline'], ['RELAY_NOT_CONNECTED', 'offline'], ['NETWORK', 'offline'], ['TIMEOUT', 'offline'], ['GATEWAY_UNREACHABLE', 'offline'], ['UPSTREAM_UNREACHABLE', 'offline'], ['MODULE_INVOCATION_TIMEOUT', 'offline'], ['RELAY_SEND_FAILED', 'offline'], ['SOMETHING_ELSE', 'error']];
test('코드별 판정 표 — 코드만 본다(HTTP 상태는 무시), 읽기 전용, 사본은 남는다', async () => {
  for (const [code, state] of TABLE) for (const status of [403, 404, 502]) {
    const w = world(), T = store(w); await ready(w, T); w.fail.get = { code, status, message: 'm' };
    await T.deskFetch('n1'); if (code === 'TIMEOUT') await T.deskFetch('n1'); const r = T.deskRead('n1');   // TIMEOUT 은 연속 2번째부터 분할
    assert.equal(r.state, state, code + '/' + status); assert.equal(r.code, code); assert.equal(r.ro, true); assert.ok(r.doc, '사본은 그대로');
  }
  const w = world(), T = store(w); w.fail.get = { code: 'OPERATION_NOT_REMOTE' }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').doc, null); assert.equal(T.deskRead('n1').state, 'old');
});

test('타이머 — watch 즉시 1회, 5초 주기, 같은 노드 두 창은 합쳐 1회, unwatch 뒤 없음(타이머도 멈춘다)', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); w.seed('n1'); const adv = async (s) => { for (let i = 0; i < s; i++) { mock.timers.tick(1000); await flush(); } };
  T.watch('n1'); T.watch('n1'); await flush(); assert.equal(w.calls.length, 1, '즉시 한 번 · 두 창이어도 한 번');
  await adv(4); assert.equal(w.calls.length, 1); await adv(1); assert.equal(w.calls.length, 2, '5초'); assert.equal(w.calls[1].input.since_revision, 1);
  await adv(5); assert.equal(w.calls.length, 3);
  T.unwatch('n1'); await adv(10); assert.equal(w.calls.length, 5, '한 창이 남아 있으면 계속'); T.unwatch('n1'); assert.equal(T._deskT, null); await adv(20); assert.equal(w.calls.length, 5);
  assert.equal(Object.keys(handlers).filter((k) => k !== 'terra-pc-logout' && k !== 'terra-who').length, 0, '구독도 걷는다');
});

test('타이머 — 숨은 탭은 묻지 않고, 보이면 · 포커스가 오면 바로(직전 500ms 안이면 건너뜀)', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); w.seed('n1'); const adv = async (s) => { for (let i = 0; i < s; i++) { mock.timers.tick(1000); await flush(); } };
  T.watch('n1'); await flush(); assert.equal(w.calls.length, 1);
  document.visibilityState = 'hidden'; await adv(30); assert.equal(w.calls.length, 1, '숨겨져 있으면 없다'); handlers.visibilitychange(); assert.equal(w.calls.length, 1, '숨김 전환은 묻지 않는다');
  document.visibilityState = 'visible'; handlers.visibilitychange(); await flush(); assert.equal(w.calls.length, 2, '보이면 즉시');
  handlers.focus(); await flush(); assert.equal(w.calls.length, 2, '곧이어 온 포커스는 건너뜀');
  mock.timers.tick(600); handlers.focus(); await flush(); assert.equal(w.calls.length, 3, '포커스가 오면 즉시');
});

test('타이머 — 옛 버전(old)은 60초, 그 외 실패는 5초마다 다시', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); w.fail.get = { code: 'OPERATION_NOT_REMOTE' }; const adv = async (s) => { for (let i = 0; i < s; i++) { mock.timers.tick(1000); await flush(); } };
  T.watch('n1'); await flush(); assert.equal(T.deskRead('n1').state, 'old'); assert.equal(w.calls.length, 1);
  await adv(59); assert.equal(w.calls.length, 1); await adv(1); assert.equal(w.calls.length, 2, '60초');
  w.fail.get = { code: 'MODULE_UNAVAILABLE' }; await adv(60); assert.equal(T.deskRead('n1').state, 'down'); const n = w.calls.length;
  await adv(5); assert.equal(w.calls.length, n + 1, '5초'); await adv(5); assert.equal(w.calls.length, n + 2);
  w.fail.get = null; await adv(5); assert.equal(T.deskRead('n1').state, 'empty', '돌아오면 바로 읽힌다');
});

test('타이머 — scene 을 주면 같은 타이머로 30초마다 props 를 새로 받는다', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w), got = []; T.refresh = (n, r) => got.push(n + '|' + r);
  T.watch('n1', { scene: 'S1' }); await flush(); const adv = async (s) => { for (let i = 0; i < s; i++) { mock.timers.tick(1000); await flush(); } };
  await adv(29); assert.deepEqual(got, []); await adv(1); assert.deepEqual(got, ['S1|props']); await adv(30); assert.equal(got.length, 2);
});

test('8초 abort — 첫 TIMEOUT 은 상태 · ro 불변, 연속 2번째부터 offline(TIMEOUT). signal 을 무시하는 전송도 마찬가지', async () => {
  for (const ignore of [false, true]) {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
    const w = world(), T = store(w); await ready(w, T); w.hold = true; w.ignoreSignal = ignore;
    const p = T.deskFetch('n1', { force: true }); mock.timers.tick(7999); await flush(); assert.equal(T.deskRead('n1').state, 'ok');
    mock.timers.tick(1); assert.equal(await p, false); let r = T.deskRead('n1');
    assert.equal(r.state, 'ok', '첫 번째는 분할이 아니다'); assert.equal(r.ro, false); assert.equal(w.signals.at(-1).aborted, true);
    const p2 = T.deskFetch('n1', { force: true }); mock.timers.tick(8000); await p2; r = T.deskRead('n1');
    assert.equal(r.state, 'offline'); assert.equal(r.code, 'TIMEOUT'); assert.equal(r.ro, true);
    mock.timers.reset();
  }
});

test('TIMEOUT 연속 카운터 — 중간에 응답(성공 · 다른 코드)이 있으면 0 부터, 실제 분할 코드는 즉시 offline, TerraError TIMEOUT 도 같다', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.fail.get = { code: 'TIMEOUT', message: 'late' }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'ok');
  delete w.fail.get; await T.deskFetch('n1');   // 성공 — 리셋
  w.fail.get = { code: 'TIMEOUT' }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'ok', '다시 첫 번째');
  w.fail.get = { code: 'MODULE_UNAVAILABLE' }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'down');   // 다른 코드 — 리셋
  w.fail.get = { code: 'TIMEOUT' }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'down', '리셋된 첫 TIMEOUT 은 상태를 바꾸지 않는다');
  await T.deskFetch('n1'); assert.equal(T.deskRead('n1').state, 'offline');
  const w2 = world(), T2 = store(w2); await ready(w2, T2); w2.fail.get = { code: 'NODE_OFFLINE' }; await T2.deskFetch('n1'); assert.equal(T2.deskRead('n1').state, 'offline', '실제 분할 코드는 즉시');
});

test('폴링 주기는 시작 기준 — 느린 응답이 간격을 늘리지 않는다(tick 500ms)', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); w.seed('n1'); w.hold = true;
  T.watch('n1'); await flush(); assert.equal(w.calls.length, 1);
  mock.timers.tick(3000); w.hold = false; w.release(); await flush(); assert.equal(w.calls.length, 1, '3초 걸려 받았다');
  mock.timers.tick(1999); await flush(); assert.equal(w.calls.length, 1); mock.timers.tick(500); await flush(); assert.equal(w.calls.length, 2, '끝난 뒤 5초가 아니라 시작 뒤 5초(+tick)');
  w.fail.get = { code: 'OPERATION_NOT_REMOTE' }; mock.timers.tick(5000); await flush(); assert.equal(T.deskRead('n1').state, 'old'); const n = w.calls.length;
  mock.timers.tick(58500); await flush(); assert.equal(w.calls.length, n); mock.timers.tick(1500); await flush(); assert.equal(w.calls.length, n + 1, '옛 버전 60초도 시작 기준');
});

test('MODULE_ROUTE_NOT_FOUND — 받은 적이 있으면 down(5초 · down 문구), 처음부터 없으면 old(60초)', async () => {
  const w = world(), T = store(w); await ready(w, T); w.fail.get = { code: 'MODULE_ROUTE_NOT_FOUND', message: 'route' };
  await T.deskFetch('n1'); let r = T.deskRead('n1'); assert.equal(r.state, 'down'); assert.match(r.msg, /꺼져 있음/); assert.equal(T.desks.get('n1').nextAt - T.desks.get('n1').lastStart, 5000);
  const w2 = world(), T2 = store(w2); w2.fail.get = { code: 'MODULE_ROUTE_NOT_FOUND' }; await T2.deskFetch('n2'); r = T2.deskRead('n2');
  assert.equal(r.state, 'old'); assert.equal(T2.desks.get('n2').nextAt - T2.desks.get('n2').lastStart, 60000);
  const w3 = world(), T3 = store(w3); w3.other('n3', { 'icons.a': { c: 1, r: 1 } }); await T3.deskFetch('n3'); w3.fail.get = { code: 'MODULE_ROUTE_NOT_FOUND' }; await T3.deskFetch('n3'); assert.equal(T3.deskRead('n3').state, 'down');
});

test('늦은 응답 — 요청 순번으로 거른다(revision 이 줄어도 새 응답은 반영)', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const g1 = T.deskFetch('n1', { force: true }), g2 = T.deskFetch('n1', { force: true });
  w.other('n1', { 'icons.a': { c: 5, r: 5 } }); w.release(1); await g2; assert.equal(T.deskRead('n1').revision, 2);
  w.db.n1.revision = 1; w.release(0); await g1; assert.equal(T.deskRead('n1').revision, 2, '먼저 출발한 응답은 버린다'); assert.deepEqual(T.deskRead('n1').doc.icons.a, { c: 5, r: 5 });
  w.hold = false; w.db.n1.revision = 1; w.db.n1.doc.icons.a = { c: 1, r: 1 }; await T.deskFetch('n1'); assert.equal(T.deskRead('n1').revision, 1, '복원으로 revision 이 줄어도 새 응답은 받는다');
});

test('늦은 응답 — 쓰기 응답 뒤에 도착한, 그 전에 출발한 읽기는 버린다', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const g = T.deskFetch('n1', { force: true }), p = T.deskPatch('n1', { 'icons.a': { c: 6, r: 6 } });
  w.release(1); await p; assert.equal(T.deskRead('n1').revision, 2);
  w.release(0); await g; const r = T.deskRead('n1'); assert.equal(r.revision, 2); assert.deepEqual(r.doc.icons.a, { c: 6, r: 6 });
});

test('같은 노드가 진행 중이면 force 가 아닐 때 건너뛴다', async () => {
  const w = world(), T = store(w); w.seed('n1'); w.hold = true;
  const a = T.deskFetch('n1'), b = T.deskFetch('n1'); assert.equal(w.calls.length, 1); T.deskFetch('n1', { force: true }); assert.equal(w.calls.length, 2);
  w.hold = false; w.release(); w.release(); await a; await b; void b;
});

test('clear — 표시층 · 대기열 · 상태를 비우고, 그 뒤 도착한 응답(읽기 · 쓰기)은 버린다. watch 는 유지', async () => {
  const w = world(), T = store(w); await ready(w, T); T.watch('n1'); await flush(); w.hold = true;
  const g = T.deskFetch('n1', { force: true }), p = T.deskPatch('n1', { 'icons.a': { c: 2, r: 2 } }), q = T.deskPatch('n1', { 'icons.b': { c: 3, r: 3 } }), gen = T.gen;
  const fail = [p, q].map((x) => x.then(() => 'ok', (e) => e.code));
  T.clear(); assert.equal(T.gen, gen + 1); assert.equal(T.pendingDesk.size, 0); assert.equal(T.deskRead('n1').state, 'loading'); assert.equal(T.deskRead('n1').doc, null); assert.equal(T.deskRead('n1').save.state, 'idle');
  assert.equal(T.watched.size, 1);
  w.hold = false; for (const h of w.held.splice(0)) h.run(); await g; await flush();
  assert.deepEqual(await Promise.all(fail), ['CLEARED', 'CLEARED']); assert.equal(T.cache.has('n1|nodedesk'), false); assert.equal(T.deskRead('n1').state, 'loading'); assert.equal(T.pendingDesk.size, 0);
});

test('persist — 저장되는 terra.cache 에 표시층이 없고, desk 사본은 rid|nodedesk 한 항목', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  T.deskPatch('n1', { 'icons.a': { c: 42, r: 4242, tag: 'ZZZ-PENDING' } }); T.persist(); mock.timers.tick(500);
  const raw = localStorage.getItem('terra.cache'); assert.ok(raw && raw.includes('n1|nodedesk')); assert.equal(raw.includes('ZZZ-PENDING'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).filter((k) => k.includes('nodedesk')), ['n1|nodedesk']);
  w.hold = false; w.release(); await flush(); T.persist(); mock.timers.tick(500);
  assert.ok(localStorage.getItem('terra.cache').includes('ZZZ-PENDING'), '응답으로 노드 값이 된 뒤에는 사본이다');
});

test('MockTransport(캔버스 시안) — 같은 규칙: 첫 쓰기 · 충돌 409 · unchanged', async () => {
  delete window.TerraTransport; delete window.TerraNodes; mem.clear(); new (boardDef('TerraNodes').Logic)({}); const T = window.TerraNodes; live.push(T);
  T.t.bindScene('A', [{ id: 'A', name: 'a' }, { id: 'B', name: 'b' }]); T.deskDefaults = JSON.parse(JSON.stringify(DEFAULTS));
  await T.deskFetch('B'); assert.equal(T.deskRead('B').state, 'empty');
  await T.deskPatch('B', { 'icons.a': { c: 4, r: 4 } }); const r = T.deskRead('B'); assert.equal(r.revision, 1); assert.deepEqual(r.doc.icons.a, { c: 4, r: 4 }); assert.equal(r.doc.prefs.wallFit, 'cover');
  await T.deskFetch('B'); assert.equal(T.deskRead('B').doc.icons.a.c, 4);   // unchanged
  const mock0 = JSON.parse(localStorage.getItem('terra.mock.B.desk')); mock0.revision = 2; mock0.revs['icons.a'] = 2; mock0.doc.icons.a = { c: 0, r: 0 }; localStorage.setItem('terra.mock.B.desk', JSON.stringify(mock0));
  await assert.rejects(T.deskPatch('B', { 'icons.a': { c: 9, r: 9 } }), { code: 'REVISION_CONFLICT' }); assert.deepEqual(T.deskRead('B').doc.icons.a, { c: 0, r: 0 });
});

// ───────────── S2 리뷰에서 재현된 결함의 회귀 시험 ─────────────
test('리뷰 1 — 충돌로 잃은 키는 뒤따른 저장 성공이 덮지 않는다(deskClearSave 로 닫기 전까지 failed · lost 유지)', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } }).catch((e) => e.code), q = T.deskPatch('n1', { 'icons.b': { c: 7, r: 7 } });
  w.hold = false; w.release(); assert.equal(await p, 'REVISION_CONFLICT'); await q; await flush();
  let r = T.deskRead('n1'); assert.equal(r.save.state, 'failed'); assert.deepEqual(r.save.lost, ['icons.a']); assert.equal(r.save.code, 'REVISION_CONFLICT'); assert.ok(r.save.at > 0, '성공한 저장 시각은 갱신'); assert.deepEqual(r.doc.icons.b, { c: 7, r: 7 });
  await T.deskPatch('n1', { 'prefs.dark': false }); assert.equal(T.deskRead('n1').save.state, 'failed', '다음 저장이 성공해도 잃은 표시는 남는다');
  T.deskClearSave('n1'); r = T.deskRead('n1'); assert.equal(r.save.state, 'idle'); assert.deepEqual(r.save.lost, []);
});

test('리뷰 1b — 부분 충돌 재전송이 성공하고 대기분이 이어 나가도 lost 가 남는다', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': { c: 8, r: 8 } }).catch((e) => e.lost), q = T.deskPatch('n1', { 'prefs.dark': false });
  w.hold = false; w.release(); assert.deepEqual(await p, ['icons.a']); await q; await flush();
  const r = T.deskRead('n1'); assert.equal(r.save.state, 'failed'); assert.deepEqual(r.save.lost, ['icons.a']); assert.deepEqual(r.doc.icons.b, { c: 8, r: 8 }); assert.equal(r.doc.prefs.dark, false);
});

test('리뷰 2 — 같은 키의 대기분도 충돌로 함께 잃는다(새 base 로 나가 다른 PC 값을 덮지 않는다)', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } }).catch((e) => e.code), q = T.deskPatch('n1', { 'icons.a': { c: 8, r: 8 } }).catch((e) => e.code);
  w.hold = false; w.release(); assert.equal(await p, 'REVISION_CONFLICT'); assert.equal(await q, 'REVISION_CONFLICT'); await flush();
  assert.deepEqual(w.db.n1.doc.icons.a, { c: 4, r: 4 }, '다른 PC 값 그대로'); assert.equal(sets(w, 'patch').length, 1); assert.equal(T.deskRead('n1').pending.size, 0);
});

test('리뷰 2b — 대기 키의 base 는 처음 적은 revision 을 지킨다: 다른 키 전송 중 다른 PC 가 바꾼 키는 409', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.b': { c: 7, r: 7 } }), q = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } }).catch((e) => e.code);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } });
  w.hold = false; w.release(); await p; assert.equal(await q, 'REVISION_CONFLICT'); await flush();
  assert.deepEqual(w.db.n1.doc.icons.a, { c: 4, r: 4 }); assert.deepEqual(sets(w, 'patch').map((c) => c.input.base_revision), [1, 1], '대기 키는 낮은 base 그대로');
  assert.deepEqual(T.deskRead('n1').save.lost, ['icons.a']);
});

test('리뷰 2c — 같은 키를 이어 옮기면 자기 응답 revision 을 base 로 삼아 자기 자신과 충돌하지 않는다', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 1, r: 1 } }), q = T.deskPatch('n1', { 'icons.a': { c: 2, r: 2 } });
  w.hold = false; w.release(); await p; await q;
  assert.deepEqual(sets(w, 'patch').map((c) => c.input.base_revision), [1, 2]); assert.deepEqual(T.deskRead('n1').doc.icons.a, { c: 2, r: 2 }); assert.equal(T.deskRead('n1').save.state, 'saved');
});

test('리뷰 2d — 첫 쓰기 펼치기는 사본이 비었을 때만(배치 base 가 아니라)', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 1, r: 1 } }), q = T.deskPatch('n1', { 'icons.b': { c: 2, r: 2 } });
  w.hold = false; w.release(); await p; await q;
  for (const c of sets(w, 'patch')) assert.equal(Object.keys(c.input.set).some((k) => k.startsWith('prefs.')), false);
});

test('리뷰 4 — 충돌 뒤 다시 읽기가 끊기면 대기분은 나가지 않고 실패 처리된다', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 } }).catch((e) => e.code), q = T.deskPatch('n1', { 'icons.b': { c: 7, r: 7 } }).catch((e) => e.code);
  w.fail.get = { code: 'NODE_OFFLINE', message: 'cut' }; w.hold = false; w.release();
  assert.equal(await p, 'REVISION_CONFLICT'); assert.equal(await q, 'NODE_OFFLINE'); await flush();
  const r = T.deskRead('n1'); assert.equal(r.state, 'offline'); assert.equal(sets(w, 'patch').length, 1, '몰래 나가지 않았다'); assert.equal(w.db.n1.doc.icons.b.c, 1); assert.equal(r.pending.size, 0); assert.equal(r.save.state, 'failed');
});

test('리뷰 4b — 충돌 + 다시 읽기 끊김: 충돌 아닌 키도 재전송하지 않고 실패(deskRetry 로 되살릴 수 있다)', async () => {
  const w = world(), T = store(w); await ready(w, T);
  w.other('n1', { 'icons.a': { c: 4, r: 4 } }); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 9, r: 9 }, 'icons.b': { c: 8, r: 8 } }).catch((e) => e.code);
  w.fail.get = { code: 'NODE_OFFLINE', message: 'cut' }; w.hold = false; w.release(); await p; await flush();
  assert.equal(sets(w, 'patch').length, 1); assert.equal(T.deskRead('n1').state, 'offline'); assert.equal(T.deskRead('n1').pending.size, 0);
  delete w.fail.get; await T.deskFetch('n1'); await T.deskRetry('n1'); assert.deepEqual(w.db.n1.doc.icons.b, { c: 8, r: 8 });
});

test('리뷰 5 — 실패 + 대기분: deskRetry 는 전송분과 대기분 모두 다시 보낸다', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }).catch((e) => e.code), q = T.deskPatch('n1', { 'icons.b': { c: 8, r: 8 } }).catch((e) => e.code);
  w.held[0].fail({ code: 'MODULE_UNAVAILABLE', message: 'x' }); w.hold = false; await p; await q;
  await T.deskRetry('n1'); assert.deepEqual(w.db.n1.doc.icons.a, { c: 7, r: 7 }); assert.deepEqual(w.db.n1.doc.icons.b, { c: 8, r: 8 }); assert.equal(T.deskRead('n1').save.state, 'saved');
});

test('리뷰 8 — 응답 본문이 비어도(null · revision 없음) 전송이 멈추지 않고 BAD_RESPONSE 로 실패, 사본은 그대로', async () => {
  for (const body of [null, { ok: true }, { revision: 'x', doc: {} }]) {
    const w = world(), T = store(w); await ready(w, T);
    const orig = w.t.invokeRid; w.t.invokeRid = (rid, op, input, o) => (op === P + 'patch' ? Promise.resolve(body) : orig(rid, op, input, o));
    await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }), { code: 'BAD_RESPONSE' });
    const r = T.deskRead('n1'); assert.equal(T.deskSends.get('n1').sending, false); assert.equal(r.save.state, 'failed'); assert.equal(r.save.code, 'BAD_RESPONSE'); assert.equal(r.pending.size, 0); assert.equal(r.revision, 1); assert.ok(r.doc);
    assert.equal(sets(w, 'get').length, 2, '결과를 모르니 노드 값을 다시 읽는다');
  }
});

test('리뷰 8b — 전송이 동기로 던져도 전송 중 표시가 남지 않는다', async () => {
  const w = world(), T = store(w); await ready(w, T);
  const orig = w.t.invokeRid; let boom = true; w.t.invokeRid = (rid, op, input, o) => { if (boom && op === P + 'patch') throw new Error('sync boom'); return orig(rid, op, input, o); };
  await assert.rejects(T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }), { message: 'sync boom' }); assert.equal(T.deskSends.get('n1').sending, false); assert.equal(T.deskRead('n1').save.code, 'ERROR');
  boom = false; await T.deskPatch('n1', { 'icons.a': { c: 8, r: 8 } }); assert.deepEqual(T.deskRead('n1').doc.icons.a, { c: 8, r: 8 });
});

test('리뷰 8c — 쓰기도 25초 abort(signal 을 무시하는 전송에도), 끊긴 뒤 노드 값을 다시 읽는다', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 10000 });
  const w = world(), T = store(w); await ready(w, T); w.hold = true; w.ignoreSignal = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 7, r: 7 } }).then(() => 'ok', (e) => e.code);
  mock.timers.tick(24999); await flush(); assert.equal(T.deskRead('n1').save.state, 'saving'); mock.timers.tick(1);
  assert.equal(await p, 'TIMEOUT'); await flush(); const r = T.deskRead('n1');
  assert.equal(w.signals.at(-2).aborted, true); assert.equal(r.save.code, 'TIMEOUT'); assert.equal(r.state, 'offline'); assert.equal(w.calls.at(-1).op, 'get'); assert.equal(r.pending.size, 0);
});

test('리뷰 9 — 폴이 끊김으로 판정한 사이 전송 중 패치가 성공하면 상태가 ok 로 돌아오고 대기분이 나간다', async () => {
  const w = world(), T = store(w); await ready(w, T); w.hold = true;
  const p = T.deskPatch('n1', { 'icons.a': { c: 2, r: 2 } }), q = T.deskPatch('n1', { 'icons.b': { c: 3, r: 3 } });
  const g = T.deskFetch('n1', { force: true }); w.held[1].fail({ code: 'NODE_OFFLINE', message: 'cut' }); await g; w.held.splice(1, 1);
  assert.equal(T.deskRead('n1').state, 'offline');
  w.hold = false; w.release(); await p; await q; await flush();
  assert.equal(T.deskRead('n1').state, 'ok'); assert.equal(sets(w, 'patch').length, 2); assert.deepEqual(w.db.n1.doc.icons.b, { c: 3, r: 3 });
});
