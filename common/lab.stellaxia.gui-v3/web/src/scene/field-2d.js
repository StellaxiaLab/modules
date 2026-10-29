// 글자 장 Canvas 2D 렌더러 — WebGL2 가 없을 때 돌아가는 길이자, 시안(Scene.dc.html 의 fieldFlush)의 알고리즘을 그대로 옮긴 비교 기준.
//
// 지난 프레임과 견줘 바뀐 칸만 바탕을 다시 칠하고 (글자 × 색 × 굵기) 타일을 붙인다. 매 프레임 가로줄 하나를 통째로 다시
// 그리는 '보험'과 넓은 글자의 이웃 칸 다시 그리기도 시안과 같다. 칸 경계는 기기 픽셀로 반올림한다.

import { FLAG_HOLE, WEIGHT_MASK, colorCss, isWide } from './field-grid.js';

const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

export class Field2D {
  static create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    return ctx ? new Field2D(canvas, ctx) : null;
  }

  constructor(canvas, ctx) {
    this.canvas = canvas; this.ctx = ctx; this.kind = 'canvas2d';
    this.prev = null; this.full = true; this.sweep = 0; this.atlas = null;
    this.bg = '#040614';
  }

  /** 바탕 — [r, g, b, a] 두 개(위 · 아래), FieldGL 과 같은 꼴 */
  setBackground(top, bottom) {
    const css = (c) => 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + c[3] + ')';
    this.bgTop = css(top); this.bgBot = css(bottom || top); this.bgGrad = null; this.full = true;
  }

  invalidateGlyphs() { this.atlas = null; this.full = true; }

  tiles(cw, ch, fonts, dpr) {
    const key = cw + 'x' + ch + '|' + fonts.join('|');
    let A = this.atlas;
    if (A && A.key === key) return A;
    this.full = true;
    const PG = 1024, perRow = Math.floor(PG / (cw * 2)), perPage = perRow * Math.floor(PG / ch), IN = Math.max(1, Math.round(0.5 * dpr)), INY = Math.round(1.5 * dpr);
    A = this.atlas = { key, map: new Map(), pages: [], slot: 0 };
    A.tile = (cp, rgba, weight) => {
      const k = weight + ':' + rgba + ':' + cp; let t = A.map.get(k); if (t) return t;
      if (A.slot >= perPage * 16) { A.map.clear(); A.slot = 0; }
      const p = Math.floor(A.slot / perPage), s2 = A.slot % perPage; A.slot++;
      let pg = A.pages[p]; if (!pg) { const cv = makeCanvas(PG, PG); pg = A.pages[p] = { cv, x: cv.getContext('2d') }; }
      const wide = isWide(cp), sx = (s2 % perRow) * cw * 2, sy = Math.floor(s2 / perRow) * ch, tw = wide ? cw * 2 : cw, o = pg.x, g = String.fromCodePoint(cp), css = colorCss(rgba);
      o.save(); o.clearRect(sx, sy, cw * 2, ch); o.beginPath(); o.rect(sx, sy, tw, ch); o.clip();
      o.font = fonts[weight] || fonts[0]; o.fillStyle = css; o.textBaseline = 'top';
      let fy = sy + INY; if (wide) { const fz = ch * 0.82; o.font = o.font.replace(/[\d.]+px/, fz.toFixed(2) + 'px'); fy = sy + (ch - fz) / 2; }
      const mw = o.measureText(g).width, avail = wide ? tw - 1 : tw - IN - 1, kx = mw > avail ? avail / mw : 1, x = wide ? sx + Math.max(0, (tw - mw * kx) / 2) : sx + IN;
      o.translate(x, fy); if (kx < 1) o.scale(kx, 1);
      o.fillText(g, 0, 0); if (weight === 1) { o.strokeStyle = css; o.lineWidth = 0.6 * dpr; o.strokeText(g, 0, 0); }
      o.restore();
      t = { cv: pg.cv, x: sx, y: sy, w: tw, h: ch, wide }; A.map.set(k, t); return t;
    };
    return A;
  }

  draw(grid, m) {
    const RC = this.ctx, n = grid.n, cols = grid.cols, rows = grid.rows, dpr = m.dpr;
    const X = (c) => Math.round(c * m.cw * dpr), Y = (r) => Math.round(r * m.ch * dpr);
    const P = this.prev && this.prev.n === n ? this.prev : null, full = this.full || !P;
    this.full = false;
    const G = grid.glyph, C = grid.color, F = grid.flags;
    if (!this.bgGrad) { const gr = RC.createLinearGradient(0, 0, 0, this.canvas.height); gr.addColorStop(0, this.bgTop || this.bg); gr.addColorStop(1, this.bgBot || this.bg); this.bgGrad = gr; }
    RC.setTransform(1, 0, 0, 1, 0, 0);
    const dirty = [];
    if (full) { RC.clearRect(0, 0, this.canvas.width, this.canvas.height); for (let i = 0; i < n; i++) dirty.push(i); }
    else {
      const r0 = this.sweep = (this.sweep + 1) % rows, i0 = r0 * cols, i1 = i0 + cols;
      for (let i = 0; i < n; i++) if ((i >= i0 && i < i1) || G[i] !== P.glyph[i] || C[i] !== P.color[i] || F[i] !== P.flags[i]) dirty.push(i);
      const ds = new Set(dirty), more = [];
      for (const i of dirty) {
        if (i > 0 && !ds.has(i - 1) && (isWide(G[i - 1]) || isWide(P.glyph[i - 1]))) { ds.add(i - 1); more.push(i - 1); }
        if (i + 1 < n && !ds.has(i + 1) && (isWide(G[i]) || isWide(P.glyph[i]))) { ds.add(i + 1); more.push(i + 1); }
      }
      for (const i of more) dirty.push(i);
    }
    for (const i of dirty) if (F[i] & FLAG_HOLE) { const c = i % cols, r = (i / cols) | 0, x0 = X(c), y0 = Y(r); RC.clearRect(x0, y0, X(c + 1) - x0, Y(r + 1) - y0); }
    RC.beginPath();
    for (const i of dirty) if (!(F[i] & FLAG_HOLE)) { const c = i % cols, r = (i / cols) | 0, x0 = X(c), y0 = Y(r); RC.rect(x0, y0, X(c + 1) - x0, Y(r + 1) - y0); }
    RC.fillStyle = this.bgGrad; RC.fill();
    const cw = Math.ceil(m.cw * dpr), ch = Math.ceil(m.ch * dpr), AT = this.tiles(cw, ch, m.fonts, dpr);
    const TL = [];
    for (const i of dirty) { const cp = G[i]; if (!cp || (F[i] & FLAG_HOLE)) continue; TL.push(i, AT.tile(cp, C[i], F[i] & WEIGHT_MASK)); }
    for (let k = 0; k < TL.length; k += 2) {
      const i = TL[k], t = TL[k + 1], c0 = i % cols, r0 = (i / cols) | 0, x0 = X(c0), y0 = Y(r0);
      const w = Math.min(t.w, X(c0 + (t.wide ? 2 : 1)) - x0), h = Math.min(t.h, Y(r0 + 1) - y0);
      if (w > 0 && h > 0) RC.drawImage(t.cv, t.x, t.y, w, h, x0, y0, w, h);
    }
    // 이번 프레임을 다음 비교 기준으로
    if (!P) this.prev = { n, glyph: new Uint32Array(n), color: new Uint32Array(n), flags: new Uint8Array(n) };
    this.prev.glyph.set(G); this.prev.color.set(C); this.prev.flags.set(F);
    return { cells: n, dirty: dirty.length, tiles: AT.map.size };
  }
}
