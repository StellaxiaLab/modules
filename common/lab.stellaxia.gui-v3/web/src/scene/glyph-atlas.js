// 글자 타일 — GPU 렌더러용. 글자 모양만(흰색 알파 마스크) 그려 두고 색은 셰이더가 입힌다.
//
// 시안의 glyphAtlas 는 (글자 × 색 × 굵기)마다 타일을 만들었다. 색이 연속으로 변하는 마스크 투영 · 하이라이트에서는
// 타일이 끝없이 늘어 qcss 로 색을 묶어야 했다. 여기서는 열쇠가 (굵기 × 글자)뿐이라 타일 수가 글자 종류 수에서 멈춘다.
//
// 그리는 규칙은 시안과 같다 — 잉크가 칸 밖으로 나가지 않게 칸 크기로 잘라(clip) 그리고, 칸보다 넓은 글자는 가로로 줄이고,
// 넓은 글자(한글)는 두 칸 타일에 칸 높이의 0.82 로 가운데.
// 메인 스레드와 Worker 양쪽에서 돈다 — OffscreenCanvas 가 있으면 그것, 없으면 <canvas>.

import { isWide } from './field-grid.js';

const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};

/** 칸 크기 · 글꼴로 정해지는 타일 배치 — 순수 계산이라 시험할 수 있다 */
export function atlasLayout(size, cw, ch) {
  const slotW = cw * 2, perRow = Math.max(1, Math.floor(size / slotW)), perCol = Math.max(1, Math.floor(size / ch));
  return { size, cw, ch, slotW, perRow, perCol, capacity: perRow * perCol,
    at: (slot) => ({ x: (slot % perRow) * slotW, y: Math.floor(slot / perRow) * ch }) };
}

export class GlyphAtlas {
  /**
   * @param {{ cw: number, ch: number, dpr: number, fonts: string[], size?: number }} o
   *   cw · ch 는 기기 픽셀 칸 크기(올림), fonts = [보통, 볼드, 틀 미디움, 틀 볼드] (기기 픽셀 크기로)
   */
  constructor(o) {
    this.size = o.size || 2048;
    this.dpr = o.dpr || 1;
    this.fonts = o.fonts;
    this.L = atlasLayout(this.size, o.cw, o.ch);
    this.canvas = makeCanvas(this.size, this.size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.map = new Map();      // (굵기 << 21 | 코드 포인트) → 슬롯
    this.next = 0;
    this.dirty = null;         // 아직 GPU 에 올리지 않은 영역 {x0, y0, x1, y1}
    this.resets = 0;
  }

  /** 슬롯 번호 — 없으면 그린다. 꽉 차면 비우고 처음부터(다음 프레임에 다시 만든다) */
  slot(cp, weight) {
    const key = (weight << 21) | cp;
    let s = this.map.get(key);
    if (s !== undefined) return s;
    if (this.next >= this.L.capacity) { this.map.clear(); this.next = 0; this.resets++; this.ctx.clearRect(0, 0, this.size, this.size); this.markDirty(0, 0, this.size, this.size); }
    s = this.next++;
    this.draw(s, cp, weight);
    this.map.set(key, s);
    return s;
  }

  draw(s, cp, weight) {
    const { cw, ch, slotW } = this.L, { x: sx, y: sy } = this.L.at(s), o = this.ctx, wide = isWide(cp), tw = wide ? cw * 2 : cw;
    const IN = Math.max(1, Math.round(0.5 * this.dpr)), INY = Math.round(1.5 * this.dpr), g = String.fromCodePoint(cp);
    o.save();
    o.clearRect(sx, sy, slotW, ch);
    o.beginPath(); o.rect(sx, sy, tw, ch); o.clip();
    o.font = this.fonts[weight] || this.fonts[0];
    o.fillStyle = '#fff'; o.strokeStyle = '#fff'; o.textBaseline = 'top';
    let fy = sy + INY;
    if (wide) { const fz = ch * 0.82; o.font = o.font.replace(/[\d.]+px/, fz.toFixed(2) + 'px'); fy = sy + (ch - fz) / 2; }
    const mw = o.measureText(g).width, avail = wide ? tw - 1 : tw - IN - 1, kx = mw > avail ? avail / mw : 1;
    const x = wide ? sx + Math.max(0, (tw - mw * kx) / 2) : sx + IN;
    o.translate(x, fy); if (kx < 1) o.scale(kx, 1);
    o.fillText(g, 0, 0);
    if (weight === 1) { o.lineWidth = 0.6 * this.dpr; o.strokeText(g, 0, 0); }
    o.restore();
    this.markDirty(sx, sy, sx + slotW, sy + ch);
  }

  markDirty(x0, y0, x1, y1) {
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 };
  }

  /** GPU 에 올릴 영역을 꺼낸다 — 렌더러가 texSubImage2D 로 그 부분만 올린다 */
  takeDirty() {
    const d = this.dirty; this.dirty = null;
    if (!d) return null;
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    return { x: d.x0, y: d.y0, w, h, data: this.ctx.getImageData(d.x0, d.y0, w, h) };
  }
}
