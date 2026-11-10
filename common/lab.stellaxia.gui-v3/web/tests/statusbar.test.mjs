// node --test — 상단 상태 줄(StatusBar 보드): "못 봤음"과 "없음"을 화면에서 구분하는지, 값이 같으면 다시 그리지 않는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { buildTopology, nodeStats } from '../src/api/topology.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, p); } }
const Board = () => new Function('DCLogic', parseBoard(read('StatusBar')).script + '\nreturn Component;')(DCLogic);
const bar = { crumbs: () => [{ id: 'T0', name: '계정' }], left: () => 300, unread: () => 2, wins: () => 0, go() {}, alarm() {}, fly() {}, logout() {} };
const withWindow = (w, fn) => { const prev = globalThis.window; globalThis.window = Object.assign({ TerraNodeStats: nodeStats, TerraDesk: { ago: () => '방금' } }, w); try { return fn(new (Board())({ bar, on: true })); } finally { globalThis.window = prev; } };
const EMPTY = () => buildTopology([], { rev: 'none' });
const NODES = () => buildTopology([{ node_id: 't', display_name: 'home', roles: ['tree'], status: 'online', last_heartbeat_at: new Date().toISOString() }, { node_id: 'l', display_name: 'a', parent_node_id: 't', status: 'offline' }], { rev: 'x', masterId: 't' });

test('시안은 시안이라고 말한다', () => withWindow({}, (c) => assert.equal(c.readAll().stat, '시안 데이터')));

test('받은 적 없이 실패 — 못 봤음 카드 · 다시 시도, 빈 지도로 보이지 않는다', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'error', error: 'MASTER_UNAVAILABLE', at: 1 } }, (c) => {
  const v = c.readAll();
  assert.equal(v.card, 'err'); assert.equal(v.tone, 'err'); assert.equal(v.canRetry, true); assert.match(v.stat, /못 봤음/); assert.match(v.sub, /MASTER_UNAVAILABLE/);
}));

test('사본이 있는 채 실패 — 지도는 그대로, 줄만 못 봤음', () => withWindow({ TerraTransport: {}, TerraTopology: NODES(), TerraTopologyState: { state: 'error', error: 'X', at: 1 } }, (c) => {
  c._okAt = Date.now(); const v = c.readAll();
  assert.equal(v.card, ''); assert.match(v.stat, /못 봤음 · 방금 사본/);
}));

test('받았고 비었다 — 없음 카드, 다시 시도 없음', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY(), TerraTopologyState: { state: 'empty', at: 1 } }, (c) => {
  const v = c.readAll();
  assert.equal(v.card, 'empty'); assert.equal(v.stat, '노드 없음'); assert.equal(v.canRetry, false);
}));

test('정상 — 노드 수와 끊긴 노드 수', () => withWindow({ TerraTransport: {}, TerraTopology: NODES(), TerraTopologyState: { state: 'ok', at: Date.now() } }, (c) => {
  const v = c.readAll();
  assert.equal(v.card, ''); assert.equal(v.tone, 'warn'); assert.match(v.stat, /노드 2 · 연결 안 됨 1/);
}));

test('받기 전에는 받는 중', () => withWindow({ TerraTransport: {}, TerraTopology: EMPTY() }, (c) => assert.match(c.readAll().stat, /받는 중/)));
