// node --test — 장면 가운데 카드(MapCard 보드): 지도를 한 번도 못 받았을 때("노드 목록을 받지 못함" · 다시 시도)와 정말 없을 때("이 Tree 에 노드 없음")만 뜬다.
//   상단 상태 줄을 없앤 뒤(11/15) 사용자 결정 "가운데 카드 남겨". 사본이 있는 채 실패하면 카드는 없다(지도는 마지막 사본 그대로).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { mapState } from '../src/api/map-state.js';
import { buildTopology, nodeStats } from '../src/api/topology.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, p); } }
const Board = () => new Function('DCLogic', parseBoard(read('MapCard')).script + '\nreturn Component;')(DCLogic);
const bar = { left: () => 300 };
const withWindow = (w, fn, props = {}) => { const prev = globalThis.window; globalThis.window = Object.assign({ TerraMapState: mapState, TerraNodeStats: nodeStats, TerraDesk: { ago: () => '방금' } }, w); let r; try { r = fn(new (Board())({ bar, on: true, ...props })); } catch (e) { globalThis.window = prev; throw e; } if (r && typeof r.then === 'function') return r.finally(() => { globalThis.window = prev; }); globalThis.window = prev; return r; };
const EMPTY = () => buildTopology([], { rev: 'none' });
const NODES = () => buildTopology([{ node_id: 't', display_name: 'home', roles: ['tree'], status: 'online', last_heartbeat_at: new Date().toISOString() }], { rev: 'x', masterId: 't' });

test('못 받음 — 카드(빨간 테두리) · 다시 시도, 전역 틀 오른쪽에', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'error', error: 'MASTER_UNAVAILABLE', at: 1 } }, (c) => {
  const r = c.renderVals();
  assert.equal(r.cardOn, true); assert.equal(r.head, '노드 목록을 받지 못함'); assert.match(r.sub, /MASTER_UNAVAILABLE/); assert.equal(r.canRetry, true); assert.equal(r.left, 300); assert.match(r.cardEdge, /err2/); assert.equal(r.retryT, '다시 시도');
}));

test('사본이 있는 채 실패 — 카드 없음', () => withWindow({ TerraTransport: {}, TerraTopology: NODES(), TerraTopologyState: { state: 'error', error: 'X', at: 1 } }, (c) => assert.equal(c.renderVals().cardOn, false)));

test('받았고 비었다 — 없음 카드, 다시 시도 없음', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'empty', at: 1 } }, (c) => {
  const r = c.renderVals(); assert.equal(r.cardOn, true); assert.equal(r.head, '이 Tree 에 노드 없음'); assert.equal(r.canRetry, false); assert.doesNotMatch(r.cardEdge, /err2/);
}));

test('정상 · 시안 · 받기 전 — 카드 없음', () => {
  withWindow({ TerraTransport: {}, TerraTopology: NODES(), TerraTopologyState: { state: 'ok', at: Date.now() } }, (c) => assert.equal(c.renderVals().cardOn, false));
  withWindow({}, (c) => assert.equal(c.renderVals().cardOn, false));
  withWindow({ TerraTransport: {}, TerraTopology: EMPTY() }, (c) => assert.equal(c.renderVals().cardOn, false));
});

test('로그인 중(on=false)에는 뜨지 않는다', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'empty', at: 1 } }, (c) => assert.equal(c.renderVals().cardOn, false), { on: false }));

test('다시 시도 — 받는 중엔 한 번만 부르고 끝나면 되돌린다', async () => {
  let calls = 0, done; const wait = new Promise((r) => { done = r; });
  await withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'error', at: 1 }, TerraTopologyRetry: () => { calls++; return wait; } }, async (c) => {
    c._redraw = () => c.setState({ v: c.readAll() });
    const r = c.renderVals(); r.retry(); r.retry(); assert.equal(calls, 1);
    assert.equal(c.renderVals().retryT, '받는 중…'); assert.equal(c.renderVals().retryOff, 'disabled');
    done(); await wait; await new Promise((x) => setImmediate(x));
    assert.equal(c.renderVals().retryT, '다시 시도');
  });
});
