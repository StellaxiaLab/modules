// 장면 다리 — 시안의 씬 보드(Scene)를 고치지 않고, 글자 장을 내는 마지막 단계만 GPU 렌더러로 바꾼다.
//
// 시안의 씬은 프레임마다 칸 기록(fieldRec: 칸마다 색 문자열 · 글자 · 굵기, '#bg' 바탕 · '#hole' 구멍)을 채우고
// fieldFlush 가 지난 프레임과 견줘 바뀐 칸만 Canvas 2D 에 글자 타일을 붙였다. 여기서는 그 기록을 칸 모델(FieldGrid,
// 형식 배열)로 옮겨 FieldHost 에 넘긴다 — Worker 의 OffscreenCanvas 에서 WebGL2 가 칸 전체를 인스턴스 두 번으로 그린다.
// 메인 스레드에 남는 것: 장면 계산(트리 · 리프 · 리소스 뷰, 융기 · 워프)과 그 위의 2D 층(전역 틀 · 3D 구 · 선). 다음 단계에서 계산도 Worker 로.
// 바탕 그림(bgPaint: 세로 그라데이션 · 사선 띠 · 성운 빛)은 한 번 그려 ImageBitmap 으로 넘기고, 셰이더가 칸 바탕에서 그대로 읽는다.
// GPU 가 준비되기 전이나 실패하면 시안의 2D 길을 그대로 쓴다.

import { boardDef } from '../ui/dc/runtime.js';
import { createFieldHost } from './field-host.js';
import { FieldGrid, parseColor, FLAG_HOLE, FLAG_WIDE, isWide } from './field-grid.js';

/**
 * @param {string} name 씬 보드 이름
 * @param {{ mode?: 'worker'|'main', prefer?: 'webgl2'|'2d', onReady?: (host) => void }} [o]
 */
export function useGpuField(name = 'Scene', o = {}) {
  const def = boardDef(name);
  if (!def || def.Logic.__gpu) return;
  const Base = def.Logic;
  class GpuScene extends Base {
    componentDidMount() { if (super.componentDidMount) super.componentDidMount(); this.gpuStart(); }
    componentWillUnmount() { const G = this.__gpu; if (G && G.host) G.host.destroy(); this.__gpu = null; if (super.componentWillUnmount) super.componentWillUnmount(); }

    async gpuStart() {
      const G = this.__gpu = { host: null, grid: new FieldGrid(1, 1), col: new Map(), bgSent: null, size: '' };
      const root = this.__host && this.__host.el, src = root && root.querySelector('canvas[data-field]');
      if (!src) return;
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true'); cv.dataset.fieldGpu = '1';
      cv.style.cssText = src.style.cssText;   // 같은 자리 · 같은 z-index(1)
      src.after(cv);
      try { G.host = await createFieldHost(cv, { mode: o.mode || 'worker', prefer: o.prefer || 'webgl2', readyMs: 20000 }); }
      catch (e) {
        G.workerError = String(e && e.message || e);
        // Worker 를 못 세웠다 — 넘긴 캔버스는 못 쓰니 새로 놓고 이 스레드에서
        const fresh = cv.cloneNode(); cv.replaceWith(fresh);
        try { G.host = await createFieldHost(fresh, { mode: 'main', prefer: o.prefer || 'webgl2' }); } catch (e2) { fresh.remove(); console.warn('GPU 글자 장 실패 — 2D 로 그린다', e2); return; }
      }
      if (!this.__gpu) { G.host.destroy(); return; }
      src.style.visibility = 'hidden';   // 시안의 2D 캔버스는 자리만 (크기 · 화면 안 판정은 그대로 이 캔버스로)
      this._fullRedraw = true;
      if (document.fonts) document.fonts.addEventListener('loadingdone', () => { if (this.__gpu && this.__gpu.host) this.__gpu.host.fontsChanged(); });
      if (o.onReady) o.onReady(G.host);
    }

    // 바탕 그림을 붙잡는다 — 시안의 bgPaint 는 화면 밖 캔버스로 그린 뒤 패턴으로 돌려준다
    bgPaint(c) { return super.bgPaint({ createPattern: (oc, rep) => { this.__bgCv = oc; return c.createPattern(oc, rep); } }); }

    fieldFlush(RC, R) {
      const G = this.__gpu;
      if (!G || !G.host) return super.fieldFlush(RC, R);
      const cols = this._cols, rows = this._rows, n = R.n, dpr = RC.canvas.width / Math.max(1, this._w);
      const key = RC.canvas.width + 'x' + RC.canvas.height;
      if (G.size !== key) { G.size = key; G.host.resize(RC.canvas.width, RC.canvas.height); }
      if (this.__bgCv && G.bgSent !== this.__bgCv) { const bc = G.bgSent = this.__bgCv; createImageBitmap(bc).then((b) => { if (this.__gpu && this.__gpu.bgSent === bc) this.__gpu.host.setBackgroundImage(b); else b.close(); }).catch(() => {}); }
      const g = G.grid; if (g.cols !== cols || g.rows !== rows) g.resize(cols, rows);
      const GL = g.glyph, CO = g.color, FL = g.flags, C = G.col;
      for (let i = 0; i < n; i++) {
        const css = R.css[i];
        if (css === '#hole') { GL[i] = 0; CO[i] = 0; FL[i] = FLAG_HOLE; continue; }
        const t = R.gl[i];
        if (css === '#bg' || !t) { GL[i] = 0; CO[i] = 0; FL[i] = 0; continue; }
        let rgba = C.get(css); if (rgba === undefined) { if (C.size > 20000) C.clear(); rgba = parseColor(css, false); C.set(css, rgba); }
        const cp = t.codePointAt(0);
        GL[i] = cp; CO[i] = rgba; FL[i] = (R.bd[i] & 3) | (isWide(cp) ? FLAG_WIDE : 0);
      }
      // 글꼴 — 시안의 fieldFlush 와 같은 넷(보통 · 볼드 · 전역 틀 미디움 · 전역 틀 볼드), 기기 픽셀 크기로
      const FN0 = R.fontN || R.font, sz = parseFloat(FN0.replace(/^\d+ /, '')) || 10;
      const FN = FN0.replace(/^(\d+ )[\d.]+px/, (m, w) => w + (sz * dpr).toFixed(2) + 'px'), FB = FN.replace(/^\d+ /, '700 '), FG = '500 ' + (sz * dpr).toFixed(2) + 'px GmarketSans, "Geist Mono", "Noto Sans KR", sans-serif', FGB = FG.replace(/^\d+ /, '700 ');
      G.host.draw(g, { cw: this._cw, ch: this._ch, dpr, fonts: [FN, FB, FG, FGB] });
      this._dirtyN = n;
    }
  }
  GpuScene.__gpu = true;
  def.Logic = GpuScene;
}
