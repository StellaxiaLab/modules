// 글자 장(場)의 칸 모델 — 장면이 매 프레임 칸마다 (글자 · 색 · 굵기)를 적는 곳.
//
// 캔버스 시안(web/design, Scene.dc.html 의 fieldRec)은 칸을 문자열 배열 셋(css · gl · bd)으로 들고 있었다.
// 여기서는 같은 내용을 형식 배열(typed array)로 든다:
//   glyph  Uint32Array  유니코드 코드 포인트, 0 = 빈 칸(바탕만)
//   color  Uint32Array  RGBA8 — 0xRRGGBBAA (곧은 알파, 렌더러가 미리 곱한다)
//   flags  Uint8Array   비트 0–1 굵기(0 보통 · 1 볼드 · 2 틀 미디움 · 3 틀 볼드) · 비트 2 구멍(뒤가 비친다) · 비트 3 넓은 글자(두 칸)
// 형식 배열이라 Worker 로 옮길 때 복사 없이 넘길 수 있고(transfer), GPU 에 그대로 올릴 수 있다.
//
// 그리는 코드는 그대로 둔다 — recorder() 가 캔버스와 같은 꼴(fillStyle · font · fillText · clearRect)을 내므로
// 시안의 장면 코드를 옮겨 와도 한 줄도 바꾸지 않아도 된다.

export const WEIGHT_MASK = 0b11;
export const FLAG_HOLE = 1 << 2;
export const FLAG_WIDE = 1 << 3;

/** 한글 · 넓은 글자 — 시안과 같은 기준(U+1100 이상)으로 두 칸을 쓴다 */
export const isWide = (cp) => cp >= 0x1100;

export class FieldGrid {
  /** @param {number} cols @param {number} rows */
  constructor(cols, rows) {
    this.resize(cols, rows);
  }

  resize(cols, rows) {
    this.cols = Math.max(1, cols | 0);
    this.rows = Math.max(1, rows | 0);
    this.n = this.cols * this.rows;
    this.glyph = new Uint32Array(this.n);
    this.color = new Uint32Array(this.n);
    this.flags = new Uint8Array(this.n);
    this.gen = (this.gen || 0) + 1;   // 크기가 바뀐 횟수 — 렌더러가 버퍼를 다시 만든다
  }

  /** 프레임 시작 — 모든 칸을 바탕으로 */
  clear() {
    this.glyph.fill(0);
    this.color.fill(0);
    this.flags.fill(0);
  }

  /** @param {number} i 칸 번호 @param {number} cp 코드 포인트 @param {number} rgba 0xRRGGBBAA @param {number} weight 0–3 */
  set(i, cp, rgba, weight) {
    if (i < 0 || i >= this.n) return;
    this.glyph[i] = cp;
    this.color[i] = rgba >>> 0;
    this.flags[i] = (weight & WEIGHT_MASK) | (isWide(cp) ? FLAG_WIDE : 0);
  }

  hole(i) {
    if (i < 0 || i >= this.n) return;
    this.glyph[i] = 0;
    this.color[i] = 0;
    this.flags[i] = FLAG_HOLE;
  }

  /** 다른 칸 모델의 내용을 그대로 (Worker 에서 받은 배열을 넣을 때) */
  copyFrom(src) {
    if (src.n !== this.n) this.resize(src.cols, src.rows);
    this.glyph.set(src.glyph);
    this.color.set(src.color);
    this.flags.set(src.flags);
  }

  /** Worker 로 넘길 꼴 — 배열 셋은 transfer 목록에 넣는다 */
  snapshot() {
    return { cols: this.cols, rows: this.rows, n: this.n, glyph: this.glyph, color: this.color, flags: this.flags };
  }
}

// ── 색 ──
// 시안의 qcss 와 같은 묶음(RGB 6단계 · 알파 0.02)을 둔다. GPU 렌더러에는 색마다 타일을 만들지 않으므로 필요 없지만,
// Canvas 2D 렌더러(field-2d.js)는 색이 타일 열쇠라서 묶지 않으면 타일이 끝없이 는다. 같은 값을 보게 둘 다 이것을 쓴다.
const colorCache = new Map();

/** 'rgb(…)' · 'rgba(…)' · '#rrggbb' · '#rgb' → 0xRRGGBBAA. 모르는 꼴은 흰색 */
export function parseColor(css, quantize = true) {
  const key = quantize ? css : '!' + css;
  let v = colorCache.get(key);
  if (v !== undefined) return v;
  if (colorCache.size > 30000) colorCache.clear();
  let r = 255, g = 255, b = 255, a = 1;
  const m = /^rgba?\(([^)]+)\)$/.exec(css);
  if (m) {
    const p = m[1].split(',').map(Number);
    [r, g, b] = p;
    if (p.length > 3) a = p[3];
  } else if (css[0] === '#') {
    const h = css.length === 4 ? css.slice(1).split('').map((c) => c + c).join('') : css.slice(1, 7);
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  }
  if (quantize) {
    const q = (x) => Math.min(255, Math.round(x / 6) * 6);
    r = q(r); g = q(g); b = q(b); a = Math.round(a * 50) / 50;
  }
  v = (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | Math.round(Math.max(0, Math.min(1, a)) * 255)) >>> 0;
  colorCache.set(key, v);
  return v;
}

/** 0xRRGGBBAA → 'rgba(…)' (Canvas 2D 렌더러가 타일을 칠할 때) */
export function colorCss(rgba) {
  return 'rgba(' + (rgba >>> 24) + ',' + ((rgba >>> 16) & 255) + ',' + ((rgba >>> 8) & 255) + ',' + ((rgba & 255) / 255).toFixed(3) + ')';
}

/** 캔버스 font 문자열의 굵기 → 0 보통 · 1 볼드. 시안과 같이 '7'(700)로 본다. 전역 틀 글꼴(2 · 3)은 setFace 로 정한다 */
const weightOf = (font, face) => (face ? 2 : 0) + (font.charCodeAt(0) === 55 ? 1 : 0);

/**
 * 캔버스와 같은 꼴의 기록기 — 장면 코드가 ctx 대신 이것에 그린다. 픽셀 좌표를 칸 번호로 바꿔 칸 모델에 적는다.
 * fillStyle 에 숫자(0xRRGGBBAA)를 넣으면 색 문자열을 만들고 푸는 일을 건너뛴다 — 장면 코드를 옮길 때 뜨거운 줄부터 숫자로 바꾼다.
 * @param {FieldGrid} grid
 * @param {() => {cw: number, ch: number}} cell 칸 크기(CSS px) — 화면 크기가 바뀌면 달라지므로 함수로
 */
export function recorder(grid, cell) {
  const R = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textBaseline: 'top', textAlign: 'start', globalAlpha: 1,
    face: false,   // 전역 틀(로고 · 정보 · 지도) 글꼴이면 true
    fillText(t, x, y) {
      const { cw, ch } = cell(), i = Math.round(y / ch) * grid.cols + Math.round(x / cw);
      const cp = t ? t.codePointAt(0) : 0;
      if (cp) grid.set(i, cp, typeof R.fillStyle === 'number' ? R.fillStyle : parseColor(R.fillStyle), weightOf(R.font, R.face));   // 숫자(0xRRGGBBAA)면 그대로 — 문자열 만들기 · 풀기를 건너뛴다
    },
    clearRect(x, y) {
      const { cw, ch } = cell();
      grid.hole(Math.round(y / ch) * grid.cols + Math.round(x / cw));
    },
    strokeText() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, fill() {}, stroke() {}
  };
  return R;
}
