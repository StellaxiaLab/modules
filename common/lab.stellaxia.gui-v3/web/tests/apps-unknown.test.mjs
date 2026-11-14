// node --test — AUD-82 · AUD-89: 앱 목록을 못 읽은 것(null · 원격)이 "화면 없음 / 0개"로 보이지 않는다.
//   appsView(순수) · 전역 틀(Field) 의 modsOf · modCatalog · 모듈 상태 창(ModStatus) · 브라우저 창(WebBrowser) 시작 페이지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as A from '../src/api/desk-adapt.js';

const rd = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const load = (n) => new Function('DCLogic', parseBoard(rd(n)).script + '\nreturn Component;')(DCLogic);
const APPS = [{ id: 'a1', moduleId: 'm1', name: '앱 하나', mode: 'static', entry: 'index.html' }];

test('appsView — 목록 null · 원격은 몰랐음, 빈 배열은 정말 0개', () => {
  assert.deepEqual(A.appsView(APPS, 'm1', true).apps.map((a) => a.id), ['a1']);
  assert.equal(A.appsView(APPS, 'm1', true).appsUnknown, false);
  const z = A.appsView([], 'm1', true); assert.equal(z.appsUnknown, false); assert.deepEqual(z.apps, []);
  const f = A.appsView(null, 'm1', true); assert.equal(f.appsUnknown, true); assert.match(f.appsWhy, /읽지 못함/);
  const r = A.appsView(APPS, 'm1', false); assert.equal(r.appsUnknown, true); assert.deepEqual(r.apps, []); assert.match(r.appsWhy, /원격/);
});

function field(G) {
  const Field = load('Field'), c = new Field({});
  const T = { read: () => ({ data: [{ id: 'm1', name: '모듈', ver: '1', st: 'run' }] }) };
  c.TN = () => T; c.localNode = () => ({ id: 'L' });
  globalThis.window = { TerraDesk: A, TerraGuiApps: G };
  return c;
}
const LOC = { id: 'L', kind: 'leaf', name: 'desk' }, REM = { id: 'R', kind: 'leaf', name: 'far' };

test('전역 틀 modsOf — 목록 null 이 [] 로 둔갑하지 않는다', () => {
  try {
    let c = field(null); let m = c.modsOf(LOC)[0];
    assert.equal(m.appsUnknown, true); assert.match(m.appsWhy, /읽지 못함/);
    assert.match(c.modCatalog(LOC).why, /읽지 못함/); assert.equal(c.modCatalog(LOC).length, 0);
    c = field([]); m = c.modsOf(LOC)[0]; assert.equal(m.appsUnknown, false); assert.equal(c.modCatalog(LOC).why, '', '목록을 읽었으면 0개는 사실');
    c = field(APPS); m = c.modsOf(LOC)[0]; assert.equal(m.appsUnknown, false); assert.equal(m.apps.length, 1); assert.equal(c.modCatalog(LOC).length, 1);
    m = c.modsOf(REM)[0]; assert.equal(m.appsUnknown, true); assert.match(m.appsWhy, /원격/); assert.equal(m.apps.length, 0);
    assert.match(c.liveCat(REM).why, /원격/);
  } finally { delete globalThis.window; }
});

test('ModStatus — 못 봤음은 "화면 없음"이 아니다', () => {
  const MS = load('ModStatus'); const row = (o) => Object.assign({ id: 'm1', name: '모듈', ver: '1', kind: 'service', st: 'run', node: 'desk', nodeId: 'L', remote: false, perms: [], svi: [], apps: [] }, o);
  let v = new MS({ mod: row({ appsUnknown: true, appsWhy: '앱 목록을 읽지 못함' }) }).renderVals();
  assert.equal(v.guiUnk, true); assert.equal(v.noGui, false); assert.match(v.guiUnkT, /^못 봤음/);
  v = new MS({ mod: row({ appsUnknown: false, appsWhy: '' }) }).renderVals();
  assert.equal(v.guiUnk, false); assert.equal(v.noGui, true, '읽었고 정말 없으면 화면 없음');
});

test('WebBrowser 시작 — 못 읽은 목록은 "0개"가 아니다', () => {
  const WB = load('WebBrowser'), cat = []; cat.why = '앱 목록을 읽지 못함';
  let c = new WB({ catalog: cat, nodeName: 'desk' }); c.nav('terra://start'); let v = c.renderVals();
  assert.doesNotMatch(v.startNote, /0개/); assert.match(v.startNote, /못 봤음/); assert.match(v.noCardsT, /못 봤음/); assert.equal(v.noCards, true);
  c = new WB({ catalog: [], nodeName: 'desk' }); c.nav('terra://start'); v = c.renderVals();
  assert.match(v.startNote, /0개/); assert.equal(v.noCardsT, '화면 있는 모듈 없음');
});
