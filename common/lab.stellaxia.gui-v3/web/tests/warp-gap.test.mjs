// node --test — 노드 이동(떠나기 확대)이 천체를 뚫지 않는지.
//   2026-11-02 실측: 리프 없는 Tree 의 리프 뷰(행성 0개)에서 다른 노드로 가면 gapLeaf 가 null → navBegin 이 화면 가운데(= 항성)로 확대해
//   항성을 관통했다. 시안 지도는 행성이 늘 있어 이 길을 안 밟는다 — 실제 지도에서만 보였다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL('../design/' + p, import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Scene = new Function('DCLogic', parseBoard(read('Scene.dc.html')).script + '\nreturn Component;')(DCLogic);
const W = 1280, H = 800;
const scene = () => { const s = new Scene({}); s._sw = W; s._sh = H; return s; };
const onScreen = (G) => G.x >= 60 && G.x <= W - 60 && G.y >= 60 && G.y <= H - 60;

test('리프 뷰 · 행성 0개 — 빈 곳은 항성 밖 · 화면 안 (가운데로 확대하지 않는다)', () => {
  const s = scene(), star = { x: W / 2, y: H / 2, r: 90 };
  s._pnLast = { C: null, Rs: [], rIn: 1, sc: [star.x, star.y], sr: star.r, pl: [] };
  const G = s.gapLeaf();
  assert.ok(G, 'gapLeaf 가 null 이면 navBegin 은 화면 가운데(항성)로 확대한다');
  assert.ok(Math.hypot(G.x - star.x, G.y - star.y) > star.r * 1.5, '확대 중심이 항성 가장자리에서 떨어져 있어야 한다');
  assert.ok(onScreen(G) && G.d > 0);
  s._lv = true; s._res = null; s.navBegin({ kind: 'tree', name: 'other' });
  assert.equal(s._navS.phase, 'dive'); assert.notDeepEqual([s._navS.gx, s._navS.gy], [W / 2, H / 2]);
  assert.ok(s._navS.K >= 6 && s._navS.K <= 90);
});

test('트리 뷰 · 초점 노드에 자식 궤도 없음 — 빈 곳은 초점 노드와 이웃 노드 밖', () => {
  const s = scene(), root = { id: 0, parent: null }, a = { id: 1, parent: root, orbit: 0.6 }, b = { id: 2, parent: root, orbit: 0.9 };
  s.build = () => ({ nodes: [root, a, b] });
  s._focus = { id: 1 }; s._lastS = 320;
  s._hits = [{ id: 0, x: 300, y: 400, r: 70, vis: 1 }, { id: 1, x: W / 2, y: H / 2, r: 60, vis: 1 }, { id: 2, x: 900, y: 300, r: 40, vis: 1 }];
  const G = s.gapTree();
  assert.ok(G, '자식이 없다고 null 이면 초점 노드를 뚫는다');
  for (const h of s._hits) assert.ok(Math.hypot(G.x - h.x, G.y - h.y) > h.r, '노드 ' + h.id + ' 안에 확대 중심이 있으면 안 된다');
  assert.ok(onScreen(G));
});

test('생성기 원본(gf_scene_methods.js)에도 같은 빈 곳 찾기 — 다시 구워도 사라지지 않게', () => {
  const src = read('build/gf_scene_methods.js'), board = read('Scene.dc.html');
  for (const k of ['gapAround(b, obs) {', 'return best || this.gapAround(', 'if (!kids.length) return around();', 'if (!best) return around();']) {
    assert.ok(src.includes(k), 'gf_scene_methods.js 에 없음: ' + k); assert.ok(board.includes(k), 'Scene.dc.html 에 없음: ' + k);
  }
});
