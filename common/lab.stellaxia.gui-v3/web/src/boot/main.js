// 앱 입구 — 두 층을 세운다.
//   장면 층  #field  — 글자 장(WebGL2, 되면 Worker 의 OffscreenCanvas). 장면 코드는 칸 모델에 그리고 렌더러가 GPU 로 낸다
//   창 층    #windows — DOM 창(WindowLayer). 장면과 따로 그려져 창을 끌어도 장면을 다시 계산하지 않는다
// 장면 계산(트리 · 리프 · 리소스 뷰, 융기 · 워프)은 아직 시안(design/Scene.dc.html)에 있다 — 옮겨 올 때까지 글자 장 바탕(idle)만 흐른다.

import { FieldGrid, recorder } from '../scene/field-grid.js';
import { createFieldHost } from '../scene/field-host.js';
import { drawWorkload } from '../scene/workload.js';
import { WindowLayer } from '../ui/window-layer.js';

const CELL = { cw: 7.2, ch: 14 };   // 시안의 칸 크기(CSS px)
const BG = [[0.016, 0.024, 0.078, 1], [0.008, 0.012, 0.04, 1]];
const status = document.getElementById('status');
const fontsFor = (dpr) => ['400', '700', '500', '700'].map((w) => w + ' ' + (12 * dpr).toFixed(2) + 'px "Geist Mono", GmarketSans, "Noto Sans KR", ui-monospace, monospace');

async function boot() {
  const q = new URLSearchParams(location.search);
  let canvas = document.getElementById('field'), host;
  try { host = await createFieldHost(canvas, { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', bg: BG }); }
  catch {
    // Worker 를 못 세웠다 — 넘긴 캔버스는 쓸 수 없으니 새로 놓고 이 스레드에서
    const fresh = canvas.cloneNode(); canvas.replaceWith(fresh); canvas = fresh;
    host = await createFieldHost(canvas, { mode: 'main', bg: BG });
  }
  const grid = new FieldGrid(1, 1), ctx = recorder(grid, () => CELL);
  let dpr = 1, m = null;
  const fit = () => {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    host.resize(Math.round(w * dpr), Math.round(h * dpr));
    grid.resize(Math.ceil(w / CELL.cw), Math.ceil(h / CELL.ch));
    m = { cw: CELL.cw, ch: CELL.ch, dpr, fonts: fontsFor(dpr) };
  };
  fit();
  new ResizeObserver(fit).observe(canvas);
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => host.fontsChanged());
  status.textContent = `글자 장 ${host.kind} · ${host.mode === 'worker' ? 'Worker' : '메인 스레드'} · ${grid.cols}×${grid.rows}`;

  const windows = new WindowLayer(document.getElementById('windows'));
  window.__terra = { host, grid, windows };   // 연기 시험 · 개발 도구용

  let f = 0;
  const frame = () => {
    grid.clear(); drawWorkload(ctx, { cols: grid.cols, rows: grid.rows, cw: CELL.cw, ch: CELL.ch }, f++, 'idle');
    host.draw(grid, m);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
