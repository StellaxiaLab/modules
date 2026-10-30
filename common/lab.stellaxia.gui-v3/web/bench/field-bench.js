// 글자 장 렌더러 비교 — 같은 부하(workload.js)를 렌더러마다 같은 프레임 수만큼 그리고 메인 스레드 시간을 잰다.
//   ?modes=2d,gl,worker&kinds=idle,mask,labels&frames=240&dpr=1&cell=7.2x14
// 결과는 window.__bench 에 쌓인다(tools/bench-field.mjs 가 읽는다).
import { FieldGrid, recorder } from '../src/scene/field-grid.js';
import { createFieldHost } from '../src/scene/field-host.js';
import { drawWorkload } from '../src/scene/workload.js';

const q = new URLSearchParams(location.search);
const MODES = (q.get('modes') || '2d,gl,worker').split(',');
const KINDS = (q.get('kinds') || 'idle,mask,labels').split(',');
const FRAMES = +(q.get('frames') || 240), DPR = +(q.get('dpr') || window.devicePixelRatio || 1);
const [CW, CH] = (q.get('cell') || '7.2x14').split('x').map(Number);
const out = document.getElementById('out');
const BG = [[0.016, 0.024, 0.078, 1], [0.008, 0.012, 0.04, 1]];
const W = innerWidth, H = innerHeight, cols = Math.ceil(W / CW), rows = Math.ceil(H / CH);
const fonts = ['400', '700', '500', '700'].map((w) => w + ' ' + (12 * DPR).toFixed(2) + 'px ui-monospace, "Noto Sans KR", monospace');
const m = { cw: CW, ch: CH, dpr: DPR, fonts };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const raf = () => new Promise((r) => requestAnimationFrame(r));

async function run(mode, kind) {
  const old = document.querySelector('canvas'); if (old) old.remove();
  const cv = document.createElement('canvas'); cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); document.body.prepend(cv);
  const host = await createFieldHost(cv, { mode: mode === 'worker' ? 'worker' : 'main', prefer: mode === '2d' ? '2d' : 'webgl2', bg: BG });
  const grid = new FieldGrid(cols, rows), ctx = recorder(grid, () => ({ cw: CW, ch: CH }));
  const wk = [], rec = [], drw = [], gaps = []; let workerMs = 0, workerN = 0;
  host.onFrame = (d) => { workerMs += d.ms; workerN++; };
  for (let f = 0; f < 20; f++) { grid.clear(); drawWorkload(ctx, { cols, rows, cw: CW, ch: CH }, f, kind); host.draw(grid, m); await raf(); }   // 데우기(타일 · 셰이더)
  let last = performance.now();
  for (let f = 20; f < 20 + FRAMES; f++) {
    const t0 = performance.now();
    grid.clear(); drawWorkload(ctx, { cols, rows, cw: CW, ch: CH }, f, kind);
    const t1 = performance.now();
    host.draw(grid, m);
    const t2 = performance.now();
    rec.push(t1 - t0); drw.push(t2 - t1); wk.push(t2 - t0);
    await raf(); const now = performance.now(); gaps.push(now - last); last = now;
  }
  await raf(); await raf();
  const r = { mode, kind: host.kind, where: host.mode, scene: kind, cells: grid.n, frames: FRAMES,
    recordMs: +pct(rec, 0.5).toFixed(2), drawMs: +pct(drw, 0.5).toFixed(2), drawP95: +pct(drw, 0.95).toFixed(2), mainMs: +pct(wk, 0.5).toFixed(2),
    frameMs: +pct(gaps, 0.5).toFixed(2), frameP95: +pct(gaps, 0.95).toFixed(2), workerMs: workerN ? +(workerMs / workerN).toFixed(2) : null, dropped: host.dropped };
  host.destroy();
  return r;
}

(async () => {
  const res = [];
  out.textContent = cols + '×' + rows + ' = ' + cols * rows + ' 칸 · dpr ' + DPR + '\n';
  for (const kind of KINDS) for (const mode of MODES) {
    try { const r = await run(mode, kind); res.push(r); out.textContent += `${kind.padEnd(7)} ${mode.padEnd(6)} ${r.kind.padEnd(8)} 기록 ${r.recordMs}ms · 그리기 ${r.drawMs}ms (p95 ${r.drawP95}) · 프레임 ${r.frameMs}ms${r.workerMs != null ? ' · worker ' + r.workerMs + 'ms' : ''}\n`; }
    catch (e) { res.push({ mode, scene: kind, error: String(e && e.message || e) }); out.textContent += `${kind} ${mode} 실패: ${e && e.message}\n`; }
  }
  window.__bench = { cols, rows, dpr: DPR, ua: navigator.userAgent, gl: (() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'none'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); })(), results: res };
})();
