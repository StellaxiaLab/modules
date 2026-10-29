// 비교용 장면 부하 — 시안의 글자 장과 같은 모양의 프레임을 만든다(벤치마크 · 연기 시험).
//
//   'idle'     글자 장 바탕 노이즈만 천천히(칸의 2% 남짓이 바뀐다) — 로그인 대기 · 가만히 있는 트리 뷰
//   'mask'     마스크 투영 · 하이라이트처럼 색이 연속으로 흐른다(칸 대부분의 색이 매 프레임 바뀐다) — 융기 · 워프 · 진입
//   'labels'   'mask' + 한글 이름표(넓은 글자) 줄 · 창 자리 구멍
// 장면 코드처럼 recorder()(캔버스 꼴)에 그린다 — 실제 장면을 옮겨 왔을 때와 같은 길을 지난다.

const CHARS = '·.,:;-=+*#%@abcdefghijklmnopqrstuvwxyz0123456789<>[]{}|/\\';
const NAMES = ['트리', '리프', '자원', '연결', '노드', '모듈', '설정', '상태'];

const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * @param {ReturnType<import('./field-grid.js').recorder>} ctx 기록기
 * @param {{ cols: number, rows: number, cw: number, ch: number }} g
 * @param {number} f 프레임 번호
 * @param {'idle'|'mask'|'labels'} kind
 */
export function drawWorkload(ctx, g, f, kind) {
  const { cols, rows, cw, ch } = g, slow = Math.floor(f / 24);
  const cx = cols * (0.5 + 0.3 * Math.sin(f * 0.013)), cy = rows * (0.5 + 0.3 * Math.cos(f * 0.017)), rad = Math.min(cols, rows * 2) * 0.35;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hz = hash(c, r, 0);
      if (hz > 0.62) continue;   // 바탕만인 칸
      const turn = hz < 0.02 ? slow : 0;   // 2% 는 천천히 글자가 바뀐다
      const ch0 = CHARS[Math.floor(hash(c, r, turn + 1) * CHARS.length)];
      let lv = 40 + Math.floor(hz * 60);
      if (kind !== 'idle') {
        const d = Math.hypot(c - cx, (r - cy) * 2) / rad, k = Math.max(0, 1 - d);
        lv = Math.min(255, lv + Math.round(k * k * 200 + Math.sin(f * 0.05 + c * 0.11 + r * 0.07) * 12));
      }
      ctx.fillStyle = 'rgba(' + Math.round(lv * 0.55) + ',' + lv + ',' + Math.round(lv * 0.65) + ',' + (0.55 + hz * 0.45).toFixed(3) + ')';
      ctx.font = hz < 0.05 ? '700 12px mono' : '400 12px mono';
      ctx.fillText(ch0, c * cw, r * ch);
    }
  }
  if (kind === 'labels') {
    ctx.fillStyle = 'rgb(208,255,150)'; ctx.font = '700 12px mono';
    for (let k = 0; k < 24; k++) {
      const r = Math.floor(hash(k, 3, slow) * rows), c0 = Math.floor(hash(k, 5, slow) * (cols - 10)), nm = NAMES[k % NAMES.length] + ' ' + (k + 1);
      let c = c0;
      for (const chx of nm) { ctx.fillText(chx, c * cw, r * ch); c += chx.codePointAt(0) >= 0x1100 ? 2 : 1; }
    }
    // 창 자리 — 구멍(뒤가 비친다)
    const w0 = Math.floor(cols * 0.55), h0 = Math.floor(rows * 0.2);
    for (let r = h0; r < h0 + Math.floor(rows * 0.45); r++) for (let c = w0; c < w0 + Math.floor(cols * 0.3); c++) ctx.clearRect(c * cw, r * ch, cw, ch);
  }
}
