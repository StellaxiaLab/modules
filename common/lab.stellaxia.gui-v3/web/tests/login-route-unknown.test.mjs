// node --test — AUD-23(GUI): Tree 로그인 길 조회(login-routes.get)가 실패하면 지어낸 주소 대신 '알 수 없음' + 오류 코드, 주소 묻기(resolve)는 남는다.
//   실제 연결에서 길(route)에 terra.local 같은 지어낸 주소가 들어가지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
globalThis.document = globalThis.document || { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;
const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'login-route-'));
async function logic(name) {
  const f = join(dir, name + '.mjs');
  writeFileSync(f, boardModule(rd('../design/' + name + '.dc.html'), name, RT));
  await import(pathToFileURL(f).href);
  return boardDef(name).Logic;
}
const real = (fn) => { window.TerraTransport = {}; try { return fn(); } finally { delete window.TerraTransport; delete window.TerraLoginRoutes; delete window.TerraLoginRoutesErr; } };

for (const [board, m] of [['Field', 'loginRoute'], ['Scene', 'gf_loginRoute']]) {
  test(board + ' — 실제 연결: 길을 못 받았으면 주소 없음 · 주소 묻기, terra.local 은 어디에도 없다', async () => {
    const C = await logic(board), o = Object.create(C.prototype), t = { name: '02-tree', rid: 'rid-2', parent: null };
    o.gf_treeOf = o.treeOf = (n) => n; o.gf_localNode = o.localNode = () => ({ name: 'me' });
    real(() => {
      for (const RR of [null, {}, { other: { node_id: 'other', login_url: 'https://x' } }]) {
        window.TerraLoginRoutes = RR;
        const R = o[m](t);
        assert.equal(R.url, ''); assert.equal(R.need, true); assert.equal(R.reach, false);
        assert.ok(!JSON.stringify(R).includes('terra.local'), JSON.stringify(R));
      }
    });
  });
}

test('TreeLogin — 길 조회 실패: 알 수 없음 + 오류 코드, 주소 묻기는 그대로', async () => {
  const C = await logic('TreeLogin'), o = Object.create(C.prototype);
  o.props = { treeName: '02', treeKey: 'T2', direction: 'far', loginUrl: '', reachable: false, needsResolve: true };
  o.state = { email: '', pass: '', keep: false, phase: null, msg: '', bad: false, err: null, manual: false, manualUrl: '' };
  o._chg = {}; o._g = 0; o._t0 = 0; o._k = 'T2|02';
  real(() => {
    window.TerraLoginRoutes = null; window.TerraLoginRoutesErr = 'DELEGATION_NOT_OPEN';
    const v = o.renderVals();
    assert.equal(v.stT, '알 수 없음'); assert.match(v.urlT, /DELEGATION_NOT_OPEN/);
    assert.equal(v.isResolve, true, '주소 묻기가 남는다'); assert.ok(!v.urlT.includes('terra.local'));
    window.TerraLoginRoutesErr = '';   // 오류가 없으면(길은 왔는데 이 Tree 만 없음) 지금 표시 그대로
    assert.notEqual(o.renderVals().stT, '알 수 없음');
  });
});

test('main.js — 조회 실패 코드를 남기고, 주소 요청 실패는 코드를 보이며 다시 물을 수 있다(조용한 실패 없음)', () => {
  const M = rd('../src/boot/main.js');
  assert.match(M, /\(e\) => \{ window\.TerraLoginRoutes = null; window\.TerraLoginRoutesErr = /);
  assert.match(M, /resolved: false, url: null, msg: '주소 요청 실패 · '/);
});
