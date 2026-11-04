// node --test — 제어기 자리가 다른 노드로 다시 쓰일 때. 이전 노드 값을 비우고(불러오는 중), 늦게 온 이전 노드 응답이 새 노드 화면을 덮지 않는다.
//   웹 빌드 실행기(src/ui/dc/runtime.js)가 componentDidUpdate 를 부르지 않아 보드의 초기화가 돌지 않았다 — 그 회귀를 본다.
//   DOM 은 아주 작은 흉내(마크업은 비운다 — 여기서 보는 것은 로직 수명이다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { c.parentNode = this; return c; }, insertBefore(c) { c.parentNode = this; return c; }, removeChild(c) { c.parentNode = null; }, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false }, addEventListener() {} });
globalThis.document = { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;

const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { defineBoard, boardDef, mountBoard: mount0, DCLogic } = await import(RT);
// 실패해도 창의 타이머가 남아 시험이 멈추지 않게 — 시험마다 띄운 창을 내린다
const live = [];
const mountBoard = (...a) => { const h = mount0(...a); live.push(h); return h; };
test.afterEach(() => { for (const h of live.splice(0)) h.unmount(); for (const k of ['TerraNodeInfo', 'TerraNetProps', 'TerraSviMake']) delete window[k]; });
const dir = mkdtempSync(join(tmpdir(), 'node-switch-'));
async function board(name) {
  const f = join(dir, name + '.mjs');
  writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/' + name + '.dc.html', import.meta.url)), 'utf8'), name, RT));
  await import(pathToFileURL(f).href);
  boardDef(name).compiled = [];   // 마크업은 그리지 않는다
}
const tick = () => new Promise((r) => setTimeout(r, 0));
/** 노드별로 응답을 손으로 풀어 주는 가짜 읽기 */
function deferred() { const q = []; const fn = (rid) => new Promise((res, rej) => q.push({ rid, res, rej })); fn.q = q; fn.take = (rid) => { const i = q.findIndex((x) => x.rid === rid); return q.splice(i, 1)[0]; }; return fn; }

test('실행기 — 속성이 바뀌면 componentDidUpdate(이전 props), 같으면 부르지 않는다', async () => {
  const seen = [];
  class L extends DCLogic { componentDidUpdate(prev) { seen.push([prev.nodeRid, this.props.nodeRid]); } }
  defineBoard({ name: 'T_cdu', Logic: L, markup: '', css: '', props: {} });
  boardDef('T_cdu').compiled = [];
  const h = mountBoard('T_cdu', el(), { nodeRid: 'A' });
  h.update({ nodeRid: 'A' });
  assert.deepEqual(seen, []);
  h.update({ nodeRid: 'B' });
  assert.deepEqual(seen, [['A', 'B']]);
});

const NODE_INFO = { name: 'x', status: '● 온라인', online: true, ident: { nodeId: 'A-id' }, comm: {}, res: { rx: 0, tx: 0 }, recent: { hbAt: 1, events: [] }, miss: [] };

test('상태 창 — 노드가 바뀌면 이전 값을 비우고, 늦은 이전 응답은 버린다', async () => {
  await board('NodeStatus');
  const rd = deferred(); window.TerraNodeInfo = rd;
  const h = mountBoard('NodeStatus', el(), { nodeRid: 'A', nodeName: 'a' });
  rd.take('A').res(Object.assign({}, NODE_INFO, { name: 'a' })); await tick();
  assert.equal(h.logic.state.info.name, 'a');
  rd.q.length = 0;
  h.update({ nodeRid: 'B', nodeName: 'b' }); await tick();
  assert.equal(h.logic.state.info, null, 'B 로 바뀐 순간 A 값이 남아 있으면 안 된다');
  assert.equal(h.logic.renderVals().note, '불러오는 중…');
  assert.ok(rd.q.some((x) => x.rid === 'B'), 'B 를 새로 읽는다');
});

test('상태 창 — A 요청이 B 로 바꾼 뒤 도착해도 B 화면을 덮지 않는다', async () => {
  const rd = deferred(); window.TerraNodeInfo = rd;
  const h = mountBoard('NodeStatus', el(), { nodeRid: 'A', nodeName: 'a' });
  const a = rd.take('A');
  h.update({ nodeRid: 'B', nodeName: 'b' }); await tick();
  a.res(Object.assign({}, NODE_INFO, { name: 'a' })); await tick();
  assert.equal(h.logic.state.info, null);
  rd.take('B').res(Object.assign({}, NODE_INFO, { name: 'b' })); await tick();
  assert.equal(h.logic.state.info.name, 'b');
});

test('네트워크 창 — 노드가 바뀌면 비우고, 늦은 A 응답 · A 짝 응답은 버린다', async () => {
  await board('NodeNet');
  const rd = deferred(), pr = []; rd.pair = (rid, peer) => new Promise((res) => pr.push({ rid, peer, res })); window.TerraNetProps = rd;
  const h = mountBoard('NodeNet', el(), { nodeRid: 'A', nodeName: 'a' });
  rd.take('A').res({ name: 'a' }); await tick();
  h.logic.loadPair('p1');
  h.update({ nodeRid: 'B', nodeName: 'b' }); await tick();
  assert.equal(h.logic.state.info, null);
  assert.deepEqual(h.logic.state.pair, {});
  pr[0].res({ ok: 'A 짝' }); await tick();
  assert.deepEqual(h.logic.state.pair, {}, 'A 의 짝 응답이 B 창에 들어오면 안 된다');
});

test('SVI 창 — 노드가 바뀌면 비우고, 늦은 A 실패 문구도 버린다', async () => {
  await board('NodeSvi');
  const rd = deferred(); window.TerraSviMake = { load: rd };
  const h = mountBoard('NodeSvi', el(), { nodeRid: 'A', nodeName: 'a' });
  rd.take('A').res({ miss: [] }); await tick();
  assert.ok(h.logic.state.data);
  h.logic.pull(); const a = rd.take('A');   // 돌고 있던 A 요청 하나(10초 갱신)
  h.update({ nodeRid: 'B', nodeName: 'b' }); await tick();
  assert.equal(h.logic.state.data, null);
  a.rej({ code: 'TIMEOUT' }); await tick();
  assert.equal(h.logic.state.msg, '', 'A 실패가 B 창에 뜨면 안 된다');
});
