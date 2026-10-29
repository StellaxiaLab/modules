// 글자 장 렌더러 고르기 — 메인 스레드 쪽 입구.
//
//   mode 'worker'  OffscreenCanvas 를 Worker 로 넘기고 그쪽 WebGL2(없으면 2D)에 그린다. 메인 스레드에는 배열 복사만 남는다
//   mode 'main'    이 스레드의 WebGL2(없으면 2D)
//   prefer '2d'    GPU 를 쓰지 않는다(비교 · 문제 확인용)
// 고른 결과는 host.kind('webgl2' · 'canvas2d')와 host.mode 로 알 수 있다.
//
// Worker 는 앱 origin 의 파일로 띄운다(new URL(…, import.meta.url)) — Gateway 의 앱 CSP(script-src 'self')가 이미 허락한다.
// blob: Worker 가 아니므로 contributions.gui.apps[].capabilities 의 'workers' 가 필요 없다.

import { FieldGL } from './field-gl.js';
import { Field2D } from './field-2d.js';

const canWorker = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ mode?: 'worker'|'main', prefer?: 'webgl2'|'2d', bg?: number[][], workerUrl?: URL }} [o]
 * @returns {Promise<FieldHost>}
 */
export async function createFieldHost(canvas, o = {}) {
  const host = new FieldHost(canvas, o);
  await host.start();
  return host;
}

export class FieldHost {
  constructor(canvas, o) {
    this.canvas = canvas; this.o = o; this.kind = 'none'; this.mode = 'main';
    this.pool = []; this.inflight = 0; this.dropped = 0; this.lastWorkerMs = 0; this.id = 0;
  }

  async start() {
    const o = this.o;
    if (o.mode !== 'main' && canWorker()) {
      try {
        const off = this.canvas.transferControlToOffscreen();
        this.worker = o.workerUrl ? new Worker(o.workerUrl, { type: 'module' }) : new Worker(new URL('./field-worker.js', import.meta.url), { type: 'module' });   // 이 꼴 그대로여야 Vite 가 Worker 파일을 따로 굽는다
        this.kind = await new Promise((ok, no) => {
          const t = setTimeout(() => no(new Error('Worker 응답 없음')), o.readyMs || 5000);   // 메인 스레드가 바쁘면(장면 첫 준비) 늦게 닿는다 — 부르는 쪽이 늘릴 수 있다
          this.worker.onmessage = (e) => { if (e.data.type === 'ready') { clearTimeout(t); ok(e.data.kind); } };
          this.worker.onerror = (e) => { clearTimeout(t); no(e); };
          this.worker.postMessage({ type: 'init', canvas: off, prefer: o.prefer, bg: o.bg }, [off]);
        });
        this.worker.onmessage = (e) => this.onDone(e.data);
        this.mode = 'worker';
        return;
      } catch (err) {
        // 캔버스는 이미 넘겼을 수 있다 — 넘긴 캔버스로는 메인에서 그릴 수 없으니 호출한 쪽이 새 캔버스로 다시 만든다
        this.error = err; this.kind = 'none';
        if (this.worker) this.worker.terminate();
        throw err;
      }
    }
    this.R = (o.prefer !== '2d' && FieldGL.create(this.canvas)) || Field2D.create(this.canvas);
    if (o.bg && this.R) this.R.setBackground(o.bg[0], o.bg[1]);
    this.kind = this.R ? this.R.kind : 'none';
  }

  resize(w, h) {
    if (this.mode === 'worker') this.worker.postMessage({ type: 'resize', w, h });
    else { this.canvas.width = w; this.canvas.height = h; if (this.R && this.R.kind === 'canvas2d') this.R.invalidateGlyphs(); }
  }

  setBackground(top, bottom) {
    if (this.mode === 'worker') this.worker.postMessage({ type: 'background', bg: [top, bottom] });
    else this.R.setBackground(top, bottom);
  }

  /** 바탕 그림(ImageBitmap) — Worker 로는 넘긴다(복사 없음) */
  setBackgroundImage(img) {
    if (this.mode === 'worker') this.worker.postMessage({ type: 'bgimage', img }, img ? [img] : []);
    else this.R.setBackgroundImage(img);
  }

  fontsChanged() {
    if (this.mode === 'worker') this.worker.postMessage({ type: 'fonts' });
    else this.R.invalidateGlyphs();
  }

  /**
   * 한 프레임. Worker 모드에서는 칸 배열을 풀의 버퍼에 복사해 넘긴다 — 두 벌이 다 나가 있으면(아직 안 그렸으면) 이 프레임을 건너뛴다.
   * @returns {object|null} 이 스레드에서 그렸으면 렌더러 통계
   */
  draw(grid, m) {
    if (this.mode !== 'worker') return this.R.draw(grid, m);
    this.pool = this.pool.filter((x) => x.n === grid.n);   // 크기가 바뀌었으면 지난 크기의 버퍼는 버린다
    this.lastN = grid.n;
    let b = this.pool.find((x) => x.n === grid.n);
    if (b) this.pool.splice(this.pool.indexOf(b), 1);
    else if (this.inflight >= 2) { this.dropped++; return null; }
    else b = { cols: grid.cols, rows: grid.rows, n: grid.n, glyph: new Uint32Array(grid.n), color: new Uint32Array(grid.n), flags: new Uint8Array(grid.n) };
    b.cols = grid.cols; b.rows = grid.rows;
    b.glyph.set(grid.glyph); b.color.set(grid.color); b.flags.set(grid.flags);
    this.inflight++;
    this.worker.postMessage({ type: 'frame', id: ++this.id, grid: b, m }, [b.glyph.buffer, b.color.buffer, b.flags.buffer]);
    return null;
  }

  onDone(d) {
    if (d.type !== 'done') return;
    this.inflight--; this.lastWorkerMs = d.ms; this.lastStats = d.stats;
    if (this.pool.length < 2 && d.grid.n === this.lastN) this.pool.push(d.grid);
    if (this.onFrame) this.onFrame(d);
  }

  destroy() { if (this.worker) this.worker.terminate(); }
}
