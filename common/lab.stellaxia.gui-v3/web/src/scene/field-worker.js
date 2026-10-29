// 글자 장 Worker — 메인 스레드에서 넘겨받은 OffscreenCanvas 에 그린다.
//
// 지금은 '그리기만' 맡는다: 메인이 칸 배열(형식 배열 셋)을 복사 없이 넘기고(transfer), 다 그리면 그 배열을 돌려준다.
// 다음 단계는 장면 계산(트리 배치 · 융기 · 워프 · 노이즈)도 여기로 옮겨, 메인은 입력(카메라 · 포인터 · 데이터)만 보내는 것이다 —
// 장면 코드는 recorder()(캔버스와 같은 꼴, DOM 없음)에 그리므로 Worker 에서 그대로 돈다.

import { FieldGL } from './field-gl.js';
import { Field2D } from './field-2d.js';
import { FieldGrid } from './field-grid.js';

let R = null;
const grid = new FieldGrid(1, 1);

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    R = (msg.prefer !== '2d' && FieldGL.create(msg.canvas)) || Field2D.create(msg.canvas);
    if (msg.bg) R.setBackground(msg.bg[0], msg.bg[1]);
    self.postMessage({ type: 'ready', kind: R ? R.kind : 'none' });
    return;
  }
  if (msg.type === 'resize') { R.canvas.width = msg.w; R.canvas.height = msg.h; if (R.kind === 'canvas2d') R.invalidateGlyphs(); return; }
  if (msg.type === 'background') { R.setBackground(msg.bg[0], msg.bg[1]); return; }
  if (msg.type === 'bgimage') { R.setBackgroundImage(msg.img); return; }
  if (msg.type === 'fonts') { R.invalidateGlyphs(); return; }
  if (msg.type === 'frame') {
    const s = msg.grid, t0 = performance.now();
    // 받은 배열을 그대로 칸 모델로 (복사하지 않는다)
    grid.cols = s.cols; grid.rows = s.rows; grid.n = s.n; grid.glyph = s.glyph; grid.color = s.color; grid.flags = s.flags;
    const st = R.draw(grid, msg.m);
    self.postMessage({ type: 'done', id: msg.id, ms: performance.now() - t0, stats: st, grid: s }, [s.glyph.buffer, s.color.buffer, s.flags.buffer]);
  }
};
