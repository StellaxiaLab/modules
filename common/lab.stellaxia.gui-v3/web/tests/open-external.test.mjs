// node --test — AUD-74: 창 안 브라우저는 외부 사이트를 못 띄운다(CSP). 실제(셸 안)에서는 iframe 을 만들지 않고
//   솔직한 안내를 보이며 호스트에 "기본 브라우저로 열어 달라"고 부탁한다(terra.frame.emit('openExternal', url) → Scene → 셸 확인 창).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';

const rd = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
const root = (p) => readFileSync(fileURLToPath(new URL('../../' + p, import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const WB = new Function('DCLogic', parseBoard(rd('WebBrowser')).script + '\nreturn Component;')(DCLogic);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('실제 모드 — 외부 주소는 iframe 없이 안내 + 호스트 요청 한 번', async () => {
  const asked = [];
  globalThis.window = { TerraOpenExternal: (u) => { asked.push(u); return true; }, addEventListener() {} };
  try {
    const c = new WB({ catalog: [], nodeName: 'desk' }); c.renderVals(); c.nav('https://example.com/a'); let v = c.renderVals();
    assert.equal(v.isWeb, false, '외부 사이트 iframe 을 만들지 않는다'); assert.equal(v.isExt, true);
    assert.match(v.extT, /Terra 안에서 열 수 없습니다/); assert.match(v.extT, /기본 브라우저/);
    await tick(); v = c.renderVals(); c.renderVals(); await tick();
    assert.deepEqual(asked, ['https://example.com/a'], '그리는 동안 반복해 부르지 않고 한 번만 요청');
    assert.match(v.extNote, /확인/);
    c.nav('http://example.org/'); c.renderVals(); await tick();
    assert.deepEqual(asked, ['https://example.com/a', 'http://example.org/'], 'http 도 같은 길(확인은 셸이)');
    v = c.renderVals(); v.extOpen(); await tick(); assert.equal(asked.length, 3, '다시 열기 단추');
  } finally { delete globalThis.window; }
});

test('호스트가 요청을 받지 못하면 못 열었다고 말한다', async () => {
  globalThis.window = { TerraOpenExternal: () => false, addEventListener() {} };
  try {
    const c = new WB({ catalog: [] }); c.renderVals(); c.nav('https://example.com'); c.renderVals(); await tick();
    const v = c.renderVals(); assert.match(v.extNote, /열지 못함/);
  } finally { delete globalThis.window; }
});

test('시안(셸 없음)은 그대로 iframe — allow-popups 없음', () => {
  globalThis.window = { addEventListener() {} };
  try {
    const c = new WB({ catalog: [] }); c.renderVals(); c.nav('https://example.com'); const v = c.renderVals();
    assert.equal(v.isWeb, true); assert.equal(v.isExt, false);
  } finally { delete globalThis.window; }
  assert.doesNotMatch(rd('WebBrowser'), /allow-popups/);
});

test('Scene — emit(openExternal) 가 terra.app:open-external 로 올라간다', () => {
  const fn = JSON.parse(root('scene/contract/functions/app.openExternal.function.json'));
  assert.equal(fn.id, 'gui-v3.app.openExternal'); assert.equal(fn.graph.nodes[0].signal, 'terra.app:open-external'); assert.deepEqual(fn.graph.nodes[0].payload, { url: '$input.value' });
  const fr = JSON.parse(root('scene/surface/fragments/main.fragment.json'));
  assert.equal(fr.root.on.openExternal.function, 'gui-v3.app.openExternal'); assert.ok(fr.functions.includes('gui-v3.app.openExternal'));
  assert.ok(JSON.parse(root('scene/scene.json')).functions.includes('contract/functions/app.openExternal.function.json'));
});
