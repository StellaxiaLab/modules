// node --test — 글자 장의 순수 부분(칸 모델 · 색 · 기록기 · 타일 배치 · 부하)
import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldGrid, parseColor, colorCss, recorder, FLAG_HOLE, FLAG_WIDE, WEIGHT_MASK } from '../src/scene/field-grid.js';
import { atlasLayout } from '../src/scene/glyph-atlas.js';
import { drawWorkload } from '../src/scene/workload.js';

test('parseColor — rgb · rgba · hex, 묶기(RGB 6 · 알파 0.02)', () => {
  assert.equal(parseColor('rgb(255,0,0)', false), 0xff0000ff);
  assert.equal(parseColor('#00ff00', false), 0x00ff00ff);
  assert.equal(parseColor('#00f', false), 0x0000ffff);
  assert.equal(parseColor('rgba(10,20,30,0.5)', false), ((10 << 24) | (20 << 16) | (30 << 8) | 128) >>> 0);
  // 묶으면 6 단위 · 알파 0.02 단위로 — 시안의 qcss 와 같은 값
  const q = parseColor('rgba(13,20,31,0.511)');
  assert.equal(q >>> 24, 12); assert.equal((q >>> 16) & 255, 18); assert.equal((q >>> 8) & 255, 30); assert.equal(q & 255, Math.round(0.52 * 255));
  assert.match(colorCss(0xff8000ff), /^rgba\(255,128,0,1\.000\)$/);
});

test('recorder — 캔버스 꼴로 그리면 칸 모델에 적힌다', () => {
  const g = new FieldGrid(10, 4), ctx = recorder(g, () => ({ cw: 8, ch: 16 }));
  ctx.fillStyle = 'rgb(255,0,0)'; ctx.font = '400 12px mono'; ctx.fillText('A', 16, 16);
  ctx.font = '700 12px mono'; ctx.fillText('한', 0, 48);
  ctx.clearRect(72, 0, 8, 16);
  const i = 1 * 10 + 2, j = 3 * 10 + 0;
  assert.equal(g.glyph[i], 65); assert.equal(g.color[i], 0xff0000ff); assert.equal(g.flags[i] & WEIGHT_MASK, 0);
  assert.equal(g.glyph[j], '한'.codePointAt(0)); assert.equal(g.flags[j] & WEIGHT_MASK, 1); assert.ok(g.flags[j] & FLAG_WIDE);
  assert.ok(g.flags[9] & FLAG_HOLE);
  ctx.fillText('B', 999, 999);   // 화면 밖 — 무시
  g.clear(); assert.equal(g.glyph.reduce((a, b) => a + b, 0), 0);
});

test('atlasLayout — 슬롯은 두 칸 너비, 겹치지 않는다', () => {
  const L = atlasLayout(2048, 15, 28);
  assert.equal(L.perRow, Math.floor(2048 / 30)); assert.equal(L.perCol, Math.floor(2048 / 28));
  const seen = new Set();
  for (let s = 0; s < L.capacity; s += 97) { const { x, y } = L.at(s); assert.ok(x + 30 <= 2048 && y + 28 <= 2048); const k = x + ',' + y; assert.ok(!seen.has(k)); seen.add(k); }
});

test('workload — 같은 프레임은 같은 칸, mask 는 idle 보다 많이 바뀐다', () => {
  const g = new FieldGrid(120, 40), ctx = recorder(g, () => ({ cw: 7, ch: 14 })), dims = { cols: 120, rows: 40, cw: 7, ch: 14 };
  const frame = (f, k) => { g.clear(); drawWorkload(ctx, dims, f, k); return { glyph: g.glyph.slice(), color: g.color.slice() }; };
  const a = frame(5, 'idle'), b = frame(5, 'idle');
  assert.deepEqual(a, b);
  const changed = (p, q) => p.color.reduce((n, c, i) => n + (c !== q.color[i] || p.glyph[i] !== q.glyph[i] ? 1 : 0), 0);
  const idle = changed(frame(30, 'idle'), frame(31, 'idle')), mask = changed(frame(30, 'mask'), frame(31, 'mask'));
  assert.ok(mask > idle * 5, `mask ${mask} · idle ${idle}`);
  g.clear(); drawWorkload(ctx, dims, 1, 'labels');
  assert.ok([...g.flags].some((x) => x & FLAG_HOLE)); assert.ok([...g.flags].some((x) => x & FLAG_WIDE));
});

test('recorder — fillStyle 에 숫자를 넣으면 그대로', () => {
  const g = new FieldGrid(4, 1), ctx = recorder(g, () => ({ cw: 8, ch: 16 }));
  ctx.fillStyle = 0x11223344; ctx.font = '400 12px m'; ctx.fillText('x', 8, 0);
  assert.equal(g.color[1], 0x11223344);
});
