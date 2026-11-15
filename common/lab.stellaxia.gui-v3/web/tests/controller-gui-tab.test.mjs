// node --test — 상단 상태 줄을 없앤 뒤(11/15) 그 줄에만 있던 둘이 제어기 › 설정 › GUI 에 있는지:
//   라이트 · 다크 전환(window.TerraTheme)과 지도 상태 · 다시 시도(window.TerraMapState · TerraTopologyRetry). 장면에는 줄이 없다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { mapState } from '../src/api/map-state.js';
import { buildTopology, nodeStats } from '../src/api/topology.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
const embedSrc = read('NodeDesktopEmbed');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Embed = new Function('DCLogic', parseBoard(embedSrc).script + '\nreturn Component;')(DCLogic);
const T = { line2: '#333', dim: '#888', ink: '#eee' };

function withWindow(w, fn) {
  const keys = ['TerraTheme', 'TerraMapState', 'TerraTopologyState', 'TerraTopology', 'TerraTopologyRetry', 'TerraTransport', 'TerraNodeStats', 'TerraDesk'], prev = {};
  for (const k of keys) { prev[k] = globalThis[k]; delete globalThis[k]; }
  if (!globalThis.window) globalThis.window = globalThis;
  Object.assign(globalThis, { TerraMapState: mapState, TerraNodeStats: nodeStats, TerraDesk: { ago: () => '방금' } }, w);
  try { return fn(new Embed({})); } finally { for (const k of keys) { if (prev[k] === undefined) delete globalThis[k]; else globalThis[k] = prev[k]; } }
}
const theme = (cur) => { const t = { cur, calls: 0, get: () => t.cur, toggle: () => { t.calls++; t.cur = t.cur === 'light' ? 'dark' : 'light'; } }; return t; };

test('설정에 GUI 탭이 있다 — 이 브라우저에서만', () => {
  assert.match(embedSrc, /\{ id: 'gui',\s+label: 'GUI',[^}]*scope: 'browser' \}/);
  assert.match(embedSrc, /<sc-if value="\{\{w\.sGui\}\}"/);
  assert.match(embedSrc, /role="switch" aria-checked="\{\{w\.gui\.theme\.on\}\}"/);
  assert.match(embedSrc, /role="status" aria-label="지도 상태"/);
});

test('라이트 테마 스위치 — 지금 값을 보이고, 누르면 전역 테마를 바꾼다', () => {
  const TH = theme('dark');
  withWindow({ TerraTheme: TH }, (c) => {
    let g = c.guiTab(T); assert.equal(g.theme.on, 'false'); assert.equal(g.theme.off, null);
    g.theme.flip(); assert.equal(TH.calls, 1);
    g = c.guiTab(T); assert.equal(g.theme.on, 'true'); assert.equal(g.theme.knob, 19);
  });
});

test('테마 없이(시안 캔버스) — 스위치는 잠기고 지도는 시안이라고 말한다', () => withWindow({}, (c) => {
  const g = c.guiTab(T); assert.equal(g.theme.off, 'disabled'); assert.equal(g.map.stat, '시안 데이터'); assert.equal(g.map.retryOn, false);
}));

test('지도를 못 받음 — 못 받았다고 말하고 다시 시도는 한 번만 부른다', async () => {
  let calls = 0, done; const wait = new Promise((r) => { done = r; });
  await withWindow({ TerraTheme: theme('dark'), TerraTransport: {}, TerraTopology: buildTopology([], { rev: 'none' }), TerraTopologyState: { state: 'error', error: 'MASTER_UNAVAILABLE', at: 1 }, TerraTopologyRetry: () => { calls++; return wait; } }, async (c) => {
    const g = c.guiTab(T);
    assert.match(g.map.stat, /못 봤음/); assert.equal(g.map.head, '노드 목록을 받지 못함'); assert.match(g.map.sub, /MASTER_UNAVAILABLE/); assert.equal(g.map.retryOn, true);
    g.map.retry(); g.map.retry(); assert.equal(calls, 1, '받는 중엔 또 부르지 않는다');
    assert.equal(c.guiTab(T).map.retryT, '받는 중…');
    done(); await wait; await new Promise((r) => setImmediate(r));
    assert.equal(c.guiTab(T).map.retryT, '다시 시도');
  });
});

test('비었다 — 없다고 말하고 다시 시도는 없다', () => withWindow({ TerraTransport: {}, TerraTopology: buildTopology([], { rev: 'none' }), TerraTopologyState: { state: 'empty', at: 1 } }, (c) => {
  const g = c.guiTab(T); assert.equal(g.map.stat, '노드 없음'); assert.equal(g.map.head, '이 Tree 에 노드 없음'); assert.equal(g.map.retryOn, false);
}));

test('장면에 상단 상태 줄이 없다 — 가운데 카드(MapCard)만 있다', () => {
  const scene = read('Scene');
  assert.doesNotMatch(scene, /StatusBar|data-statusbar|barApi/);
  assert.match(scene, /<dc-import name="MapCard" on="\{\{cardOn\}\}" bar="\{\{cardApi\}\}"/);
});
