// node --test — 데이터 갱신(노드 사본 · 하트비트 스냅샷 · 알림)이 전역 틀을 다시 배치할 때 화면이 깜빡이지 않는다.
//   30초마다 지표가 오면 전역 틀이 통째로 다시 배치되고, 값이 바뀐 줄(하트비트 나이 · 추이 · CPU%)이 랜덤 갱신으로 처음부터 다시 찍혔다.
//   사본 하나를 받을 때도 시작 · 끝 두 번 알려 두 번 다시 배치했다 — 그 회귀를 본다.
//   DOM 은 아주 작은 흉내(마크업은 비운다 — 여기서 보는 것은 로직이다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { c.parentNode = this; return c; }, insertBefore(c) { c.parentNode = this; return c; }, removeChild(c) { c.parentNode = null; }, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false }, addEventListener() {} });
globalThis.document = globalThis.document || { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;

const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const src = (name) => readFileSync(fileURLToPath(new URL('../design/' + name + '.dc.html', import.meta.url)), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'data-relayout-'));
async function logicOf(name) {
  const f = join(dir, name + '.mjs');
  writeFileSync(f, boardModule(src(name), name, RT));
  await import(pathToFileURL(f).href);
  return boardDef(name).Logic;
}
const frame = () => new Promise((r) => setTimeout(r, 40));

for (const [board, M, Q] of [['Field', 'dataLayout', '_quiet'], ['Scene', 'gf_dataLayout', '_q_quiet']]) {
  test(board + ' — 몰려온 데이터 신호는 한 번만, 조용히 다시 배치한다', async () => {
    const L = await logicOf(board), o = Object.create(L.prototype), seen = [];
    const lay = board === 'Field' ? 'layout' : 'gf_layout';
    o._live = true; o[lay] = function () { seen.push(this[Q]); };
    o[M](); o[M](); o[M]();   // 사본 받기 시작 · 끝 + 지표 — 한 프레임 안
    assert.deepEqual(seen, [], '바로 다시 배치하지 않는다(다음 프레임에 한 번)');
    await frame();
    assert.deepEqual(seen, [true], '한 번 · 조용히');
    assert.equal(o[Q], false, '끝나면 조용한 모드를 푼다');
    o[M](); await frame();
    assert.deepEqual(seen, [true, true], '다음 프레임의 신호는 다시 받는다');
    o._live = false; o[M](); await frame();
    assert.equal(seen.length, 2, '내려간 화면은 다시 배치하지 않는다');
  });
}

test('데이터 신호는 조용한 배치로 — 노드 사본 · 알림 · 지표가 layout() 을 곧장 부르지 않는다', () => {
  for (const [board, lay, data] of [['Field', 'this.layout()', 'this.dataLayout()'], ['Scene', 'this.gf_layout()', 'this.gf_dataLayout()']]) {
    const S = src(board);
    const sub = S.match(/T\.subscribe\(\(\) => \{[^}]*\}\);/), al = S.match(/_alEv = \(\) => \{[^}]*\}/);
    assert.ok(sub && sub[0].includes(data) && !sub[0].includes(lay), board + ': 노드 사본이 바뀌면 ' + data);
    assert.ok(al && al[0].includes(data) && !al[0].includes(lay), board + ': terra-alarms · terra-metrics 면 ' + data);
  }
});

test('조용한 배치 — 떠 있던 줄은 새 값으로 바로, 사라진 줄 · 레거시 그래픽은 다시 그리지 않는다', () => {
  for (const [board, Q] of [['Field', 'this._quiet'], ['Scene', 'this._q_quiet']]) {
    const S = src(board);
    assert.ok(S.includes('else if (' + Q + " && P && P.st && P.st.dir === 'in') T.st = { dir: 'in', at: nowL - 1e5 };"), board + ': 바뀐 줄은 랜덤 갱신 없이');
    assert.ok(S.includes('for (const id in OLD) if (!' + Q + ' && !ids.has(id)'), board + ': 사라지는 모습 없이');
    assert.ok(S.includes('if (P.sig === e.sig || ' + Q + ') e.st = P.st;'), board + ': 그래프 다시 긋기 없이');
  }
});

test('지표 — 새 점이 없으면 terra-metrics 를 보내지 않는다', () => {
  const M = readFileSync(fileURLToPath(new URL('../src/boot/main.js', import.meta.url)), 'utf8');
  assert.match(M, /if \(t\.records && window\.TerraMetrics\.ingest\(t\.records\(\), r\.at\) > 0\) \{ try \{ window\.dispatchEvent\(new Event\('terra-metrics'\)\)/);
});
