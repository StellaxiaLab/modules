# 글자 타일(아틀라스) — 바뀐 칸만 다시 그리는 글자 장(fieldFlush)의 글자 그리기를 타일 붙이기로 바꾼다
import sys
METHOD = r'''  // ───── 글자 타일(아틀라스) ─────
  // 글자 하나 × 색 × 굵기 · 글꼴을 칸 크기로 잘라(clip) 화면 밖 캔버스에 한 번만 그려 두고, 칸에는 그 타일을 칸 크기 그대로 붙인다(drawImage)
  //   → 잉크가 칸 밖으로 나갈 수 없다: 어떤 글꼴이든 바뀐 칸만 다시 그릴 때 이웃 칸에 찌꺼기(노이즈)가 남지 않는다. 붙이기는 fillText 보다 빠르다
  //   칸보다 넓은 글자는 칸 너비에 맞춰 가로로 살짝 줄인다. 넓은 글자(한글)는 두 칸 타일에 가운데로. 글꼴이 새로 들어오면(loadingdone) 타일을 비우고 통째로 다시
  glyphAtlas(dpr, fonts) {
    if (!this._fontHook && document.fonts && document.fonts.addEventListener) { this._fontHook = true; document.fonts.addEventListener('loadingdone', () => { this._fontGen = (this._fontGen || 0) + 1; this._fullRedraw = true; }); }
    const cw = Math.ceil(this._cw * dpr), ch = Math.ceil(this._ch * dpr), key = cw + 'x' + ch + '|' + fonts.join('|') + '|' + (this._fontGen || 0);
    let A = this._atlas;
    if (!A || A.key !== key) {
      const PG = 1024, perRow = Math.floor(PG / (cw * 2)), perPage = perRow * Math.floor(PG / ch), IN = Math.max(1, Math.round(0.5 * dpr)), INY = Math.round(1.5 * dpr);
      if (A) this._fullRedraw = true;   // 글꼴 · 칸 크기가 바뀌었다 — 다음 프레임은 통째로
      A = this._atlas = { key, map: new Map(), pages: [], slot: 0 };
      A.tile = (g, css, bd, wide) => {
        const k = bd + css + '\u0001' + g; let t = A.map.get(k); if (t) return t;
        if (A.slot >= perPage * 16) { A.map.clear(); A.slot = 0; }   // 너무 많아지면 비우고 다시 (다시 쓰일 때 만든다)
        const p = Math.floor(A.slot / perPage), s2 = A.slot % perPage; A.slot++;
        let pg = A.pages[p]; if (!pg) { const cv = document.createElement('canvas'); cv.width = PG; cv.height = PG; pg = A.pages[p] = { cv, x: cv.getContext('2d') }; }
        const sx = (s2 % perRow) * cw * 2, sy = Math.floor(s2 / perRow) * ch, tw = wide ? cw * 2 : cw, o = pg.x;
        o.save(); o.clearRect(sx, sy, cw * 2, ch); o.beginPath(); o.rect(sx, sy, tw, ch); o.clip();
        o.font = bd === 3 ? fonts[3] : bd === 2 ? fonts[2] : bd === 1 ? fonts[1] : fonts[0]; o.fillStyle = css; o.textBaseline = 'top';
        let fy = sy + INY; if (wide) { const fz = ch * 0.82; o.font = o.font.replace(/[\d.]+px/, fz.toFixed(2) + 'px'); fy = sy + (ch - fz) / 2; }   // 한글 — 두 칸에 꽉 차게 (칸 높이의 0.82)
        const mw = o.measureText(g).width, avail = wide ? tw - 1 : tw - IN - 1, kx = mw > avail ? avail / mw : 1, x = wide ? sx + Math.max(0, (tw - mw * kx) / 2) : sx + IN;
        o.translate(x, fy); if (kx < 1) o.scale(kx, 1);
        o.fillText(g, 0, 0); if (bd === 1) { o.strokeStyle = css; o.lineWidth = 0.6 * dpr; o.strokeText(g, 0, 0); }
        o.restore();
        t = { cv: pg.cv, x: sx, y: sy, w: tw, h: ch, wide }; A.map.set(k, t); return t;
      };
    }
    return A;
  }
'''
BLOCK = r'''    // 글자 — 글자 타일(아틀라스)에서 칸 크기 그대로 붙인다 (잉크가 칸 밖으로 나가지 않는다 — glyphAtlas)
    const FN0 = R.fontN || R.font, sz = parseFloat(FN0.replace(/^\d+ /, '')) || 10;
    const FN = FN0.replace(/^(\d+ )[\d.]+px/, (m, w) => w + (sz * dpr).toFixed(2) + 'px'), FB = FN.replace(/^\d+ /, '700 '), FG = '500 ' + (sz * dpr).toFixed(2) + 'px GmarketSans, "Geist Mono", "Noto Sans KR", sans-serif', FGB = FG.replace(/^\d+ /, '700 ');   // 보통 · 볼드 · 전역 틀 미디움 · 전역 틀 볼드
    const AT = this.glyphAtlas(dpr, [FN, FB, FG, FGB]);
    // 두 번에 나눈다 — 먼저 이번에 필요한 타일을 다 만들고, 그다음 한꺼번에 붙인다 (만들기 · 붙이기를 번갈아 하면 타일 캔버스를 매번 다시 올려 크게 느려진다)
    const TL = []; for (const i of dirty) { const css = R.css[i], g = R.gl[i]; if (css === '#bg' || css === '#hole' || !g) continue; TL.push(i, AT.tile(g, css, R.bd[i], g.charCodeAt(0) >= 0x1100)); }
    for (let k = 0; k < TL.length; k += 2) { const i = TL[k], t = TL[k + 1], c0 = i % cols, r0 = (i / cols) | 0, x0 = X(c0), y0 = Y(r0);
      const w = Math.min(t.w, X(c0 + (t.wide ? 2 : 1)) - x0), h = Math.min(t.h, Y(r0 + 1) - y0);
      if (w > 0 && h > 0) RC.drawImage(t.cv, t.x, t.y, w, h, x0, y0, w, h); }
    RC.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 이번 프레임 기록'''
QMETHOD = r'''  // 칸 색을 눈에 안 띄는 단계(RGB 6 · 알파 0.02)로 묶는다 — 마스크 투영 · 하이라이트처럼 연속인 색이 칸마다 다 달라 타일이 끝없이 늘고, 바뀐 칸도 쓸데없이 많아지는 것을 막는다
  qcss(c) { const M = this._qc || (this._qc = new Map()); let q = M.get(c); if (q !== undefined) return q; if (M.size > 30000) M.clear();
    const m = /^rgba?\(([^)]+)\)$/.exec(c); if (!m) { M.set(c, c); return c; }
    const v = m[1].split(',').map(Number), r = (x) => Math.min(255, Math.round(x / 6) * 6);
    q = v.length > 3 ? 'rgba(' + r(v[0]) + ',' + r(v[1]) + ',' + r(v[2]) + ',' + (Math.round(v[3] * 50) / 50) + ')' : 'rgb(' + r(v[0]) + ',' + r(v[1]) + ',' + r(v[2]) + ')';
    M.set(c, q); return q; }
'''
def patch(s):
    s = s.replace("if (i < 0 || i >= n) return; self.css[i] = self.fillStyle;", "if (i < 0 || i >= n) return; self.css[i] = this.qcss(self.fillStyle);", 1)
    a = s.index('    // 글자 — 같은 색 · 굵기끼리 묶어서'); b = s.index('    RC.setTransform(dpr, 0, 0, dpr, 0, 0);\n    // 이번 프레임 기록', a) + len('    RC.setTransform(dpr, 0, 0, dpr, 0, 0);\n    // 이번 프레임 기록')
    s = s[:a] + BLOCK + s[b:]
    k = s.index('  fieldFlush(RC, R) {')
    return s[:k] + METHOD + QMETHOD + s[k:]
if __name__ == '__main__':
    for p in sys.argv[1:]:
        s = open(p).read()
        if 'glyphAtlas(dpr, fonts)' in s: print('skip', p); continue
        assert 'self.css[i] = self.fillStyle;' in s
        open(p, 'w').write(patch(s)); print('patched', p)
