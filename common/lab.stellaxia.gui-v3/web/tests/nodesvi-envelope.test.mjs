// node --test — 자원화 창의 울타리 확장(ADR-GW-011 E3): 로컬/원격 분기 · 출처별 해제 · 확인 문구 · 오류 문구 · 만들기 양식의 "울타리 밖" 갱신
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { rootRows, affectedBy, sensitiveWhy, envelopeError, joinRoot, under } from '../src/api/svi-envelope.js';

const src = readFileSync(fileURLToPath(new URL('../design/NodeSvi.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const lib = new Function('DCLogic', parseBoard(src).script + '\nreturn { Component, rootRows, affectedBy, sensitiveWhy, envelopeError, joinRoot, under };')(DCLogic);
const tick = () => new Promise((r) => setTimeout(r, 0));

const ENV = () => ({ file_roots: [{ path: '/data' }, { path: '/srv/drop' }], file_root_sources: [{ path: '/data', origin: 'config' }, { path: '/srv/drop', origin: 'runtime' }], process: 'off', net: false, net_endpoints: [] });
const DECLS = [{ family: 'file', name: 'drop-log', dir: 'source', resId: 'r1', state: 'applied', reason: '', detail: '/srv/drop/log.txt' }, { family: 'file', name: 'data-log', dir: 'source', resId: 'r2', state: 'applied', reason: '', detail: '/data/a.csv' }];
const mk = (local = true, o = {}) => {
  const calls = [], data = { miss: [], envelope: ENV(), decls: DECLS.map((d) => ({ ...d })), retired: [], nodes: [], eps: [], grants: [], bindings: [] };
  const Env = { isLocal: () => local, add: async (rid, p) => { calls.push(['add', rid, p]); if (o.fail) throw o.fail; }, remove: async (rid, p) => { calls.push(['remove', rid, p]); if (o.fail) throw o.fail; },
    fsRoots: async () => ({ roots: [{ name: 'home', path: '/home/u', readable: true }] }), fsEntries: async () => ({ entries: [{ name: 'proj', is_dir: true }, { name: 'a.txt', is_dir: false }] }) };
  const win = { TerraSviMake: { load: async () => data }, TerraSviTypes: () => [], TerraSviEnvelope: Env,
    TerraDesk: { fileRoots: (d, k) => d.roots.map((r) => ({ id: k + ':' + r.name, kind: k, root: r.name, label: '로컬 · ' + r.name, path: r.path, locked: false })),
      fileEntries: (d, rel) => d.entries.map((e) => ({ name: e.name, path: rel ? rel + '/' + e.name : e.name, dir: !!e.is_dir, locked: false })) } };
  const prev = globalThis.window; globalThis.window = win;
  const c = new lib.Component({ nodeName: 'desk', nodeRid: 'n1' }); c._live = true; c.state.data = data; c.pull = () => {};
  return { c, calls, data, done: () => { globalThis.window = prev; } };
};

test('보드 사본 = src — 울타리 확장 순수 함수', () => {
  const envs = [ENV(), { file_roots: ['/x'] }, { file_roots: [{ path: 'C:\\Share\\' }], file_root_sources: [{ path: 'c:/share', origin: 'runtime' }] }, null];
  for (const e of envs) assert.deepEqual(lib.rootRows(e), rootRows(e));
  for (const p of ['/home/u', 'C:\\Users\\kim', '/srv/share', '/Users/a', '/root', '']) assert.equal(lib.sensitiveWhy(p), sensitiveWhy(p));
  for (const e of [{ code: 'SVI_ENVELOPE_ROOT_REFUSED', details: { reason: 'protected' } }, { code: 'SVI_ENVELOPE_ROOT_FROM_CONFIG' }, { code: 'X', status: 429 }, { code: 'Q', message: 'm' }]) assert.equal(lib.envelopeError(e), envelopeError(e));
  assert.equal(lib.joinRoot('C:\\Users\\k', 'a/b'), joinRoot('C:\\Users\\k', 'a/b'));
  assert.equal(lib.under('C:/A/b', 'c:\\a'), under('C:/A/b', 'c:\\a'));
  assert.deepEqual(lib.affectedBy(DECLS, '/data', rootRows(ENV())).map((d) => d.name), affectedBy(DECLS, '/data', rootRows(ENV())).map((d) => d.name));
});

test('출처 — 설정 파일 root 는 해제 못 하고, GUI root 만 해제 버튼', () => {
  const rows = rootRows(ENV());
  assert.deepEqual(rows.map((r) => [r.path, r.origin, r.removable]), [['/data', 'config', false], ['/srv/drop', 'runtime', true]]);
  assert.equal(rootRows({ file_roots: [{ path: '/old' }] })[0].removable, false, 'file_root_sources 없는 옛 Terra 는 닫아 둔다');
  const { c, done } = mk(); try { const v = c.renderVals(); assert.deepEqual(v.roots.map((r) => [r.origin, r.canRemove]), [['설정 파일', false], ['GUI', true]]); } finally { done(); }
});

test('로컬이면 폴더 허용 버튼, 다른 노드면 버튼 대신 안내', () => {
  let t = mk(true); try { const v = t.c.renderVals(); assert.equal(v.envLocal, true); assert.equal(v.envRemote, false); assert.equal(v.roots[1].canRemove, true); } finally { t.done(); }
  t = mk(false); try {
    const v = t.c.renderVals(); assert.equal(v.envLocal, false); assert.equal(v.envRemote, true);
    assert.equal(v.envRemoteT, '다른 노드의 울타리는 아직 그 노드에서만 바꿀 수 있습니다'); assert.ok(v.roots.every((r) => !r.canRemove));
  } finally { t.done(); }
});

test('허용 — 고르기 → 확인 → 허용 호출, 만들기의 "울타리 밖" 경고가 바로 사라진다', async () => {
  const { c, calls, done } = mk(); try {
    c.setState({ vals: { path: '/srv/new/a.txt' }, fname: 'n' }); assert.equal(c.renderVals().envBad, true);
    c.renderVals().allow(); await tick(); let v = c.renderVals(); assert.equal(v.dlgOn, true); assert.equal(v.dlgPick, true); assert.equal(v.dlgNextOff, true);
    v.brRoots[0].pick(); await tick(); v = c.renderVals(); assert.equal(v.dlgPath, '/home/u'); assert.deepEqual(v.brItems.map((i) => i.name), ['proj'], '폴더만');
    v.brItems[0].pick(); await tick(); assert.equal(c.renderVals().dlgPath, '/home/u/proj');
    c.renderVals().onDlgPath({ target: { value: '/srv/new' } }); v = c.renderVals(); assert.equal(v.dlgNextOff, false); v.dlgNext();
    v = c.renderVals(); assert.equal(v.dlgConfirm, true); assert.equal(v.hasSens, false);
    v.dlgGo(); await tick(); await tick();
    assert.deepEqual(calls, [['add', 'n1', '/srv/new']]); v = c.renderVals(); assert.equal(v.dlgOn, false);
    assert.equal(v.envBad, false, '새 root 에 맞게 즉시'); assert.deepEqual(v.roots.map((r) => [r.path, r.origin]).pop(), ['/srv/new', 'GUI']);
  } finally { done(); }
});

test('홈 폴더를 고르면 더 강한 경고', async () => {
  const { c, done } = mk(); try {
    c.envOpen('add', '/home/kim'); c.renderVals().dlgNext(); const v = c.renderVals(); assert.equal(v.hasSens, true); assert.match(v.dlgSens, /\.ssh/); assert.match(v.dlgSens, /브라우저 프로필/);
    c.envOpen('add', '/srv/share'); c.renderVals().dlgNext(); assert.equal(c.renderVals().hasSens, false);
    await tick();
  } finally { done(); }
});

test('해제 — 멈출 자원을 먼저 보이고, 다른 root 가 품는 자원은 뺀다', async () => {
  const { c, calls, done } = mk(); try {
    c.renderVals().roots[1].remove(); let v = c.renderVals(); assert.equal(v.dlgRemove, true); assert.deepEqual(v.affected.map((a) => a.name), ['drop-log']);
    v.dlgDel(); await tick(); await tick(); assert.deepEqual(calls, [['remove', 'n1', '/srv/drop']]);
    v = c.renderVals(); assert.equal(v.dlgOn, false); assert.deepEqual(v.roots.map((r) => r.path), ['/data']);
    assert.equal(c.state.data.decls.find((d) => d.name === 'drop-log').state, 'refused_by_policy');
  } finally { done(); }
  assert.deepEqual(affectedBy([{ family: 'file', state: 'applied', name: 'x', detail: '/data/sub/f' }], '/data/sub', [{ path: '/data' }, { path: '/data/sub' }]), [], '남는 /data 가 품는다');
});

test('오류 — reason 별 한국어 문장, 대화상자는 열려 있다', async () => {
  for (const [reason, re] of [['not_absolute', /절대 경로/], ['not_found', /폴더가 없습니다/], ['not_directory', /파일입니다/], ['filesystem_root', /드라이브/], ['protected', /데이터·설정/]]) {
    const { c, done } = mk(true, { fail: Object.assign(new Error('x'), { code: 'SVI_ENVELOPE_ROOT_REFUSED', status: 400, details: { reason } }) }); try {
      c.envOpen('add', '/x'); c.renderVals().dlgNext(); c.renderVals().dlgGo(); await tick(); await tick();
      const v = c.renderVals(); assert.equal(v.dlgOn, true); assert.match(v.dlgErr, re, reason); assert.equal(v.dlgBusy, false);
    } finally { done(); }
  }
  assert.match(envelopeError({ code: 'SVI_ENVELOPE_ROOT_FROM_CONFIG', status: 409 }), /설정 파일/);
  assert.match(envelopeError({ code: 'SVI_ENVELOPE_ROOT_NOT_FOUND', status: 404 }), /이미 울타리에 없는/);
  assert.match(envelopeError({ code: 'HTTP_429', status: 429 }), /분당 5회/);
  assert.match(envelopeError({ code: 'FORBIDDEN', status: 403 }), /node\.control/);
});
