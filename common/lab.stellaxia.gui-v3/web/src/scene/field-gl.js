// 글자 장 GPU 렌더러 — WebGL2, 칸 전체를 인스턴스 두 번(바탕 · 글자)으로 그린다.
//
// 시안의 fieldFlush(Canvas 2D)는 CPU 가 매 프레임 칸 1.5만 개를 지난 프레임과 견주고, 바뀐 칸마다 바탕 사각형과
// 글자 타일을 하나씩 붙였다(drawImage). 여기서는:
//   · 칸 데이터(형식 배열)를 그대로 GPU 버퍼에 한 번 올리고(칸당 8바이트), 셰이더가 칸 위치를 인스턴스 번호로 계산한다
//   · 매 프레임 통째로 그린다 — 바뀐 칸 비교가 필요 없고, 그래서 비교가 놓친 칸에 찌꺼기가 남는 일(시안의 '보험' 줄)도 없다
//   · 칸 경계는 시안과 같이 기기 픽셀로 반올림한다(round(c · cw · dpr)) — 배율 1.25 · 1.5 화면에서도 칸이 픽셀에 맞는다
//   · 글자 타일은 texelFetch 로 1:1 — 필터링으로 번지지 않는다
// OffscreenCanvas 에서도 돈다(Worker).

import { GlyphAtlas } from './glyph-atlas.js';
import { FLAG_HOLE, FLAG_WIDE, WEIGHT_MASK } from './field-grid.js';

const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in uvec2 aCell;          // x = 슬롯(하위 20비트) | 굵기 · 구멍 · 넓음 · 글자 있음(상위 8비트), y = RGBA8
uniform vec2 uView;                          // 기기 픽셀 화면 크기
uniform vec2 uCell;                          // 기기 픽셀 칸 크기 (소수 — 반올림은 아래에서)
uniform int uCols;
uniform int uPass;                           // 0 바탕 · 1 글자
uniform ivec3 uAtlas;                        // 타일 칸 너비(기기 px, 올림) · 높이 · 한 줄 슬롯 수
out vec4 vColor; out vec2 vLocal; flat out ivec2 vTile;
void main() {
  int id = gl_InstanceID, col = id % uCols, row = id / uCols;
  uint f = aCell.x >> 24u, slot = aCell.x & 0xFFFFFu;
  bool hole = (f & ${FLAG_HOLE}u) != 0u, wide = (f & ${FLAG_WIDE}u) != 0u, has = (f & 128u) != 0u;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  float x0 = floor(float(col) * uCell.x + 0.5), y0 = floor(float(row) * uCell.y + 0.5);
  float x1 = floor(float(col + (uPass == 1 && wide ? 2 : 1)) * uCell.x + 0.5), y1 = floor(float(row + 1) * uCell.y + 0.5);
  if (uPass == 1) { x1 = min(x1, x0 + float(wide ? uAtlas.x * 2 : uAtlas.x)); y1 = min(y1, y0 + float(uAtlas.y)); }
  bool skip = hole || (uPass == 1 && !has);
  vec2 p = mix(vec2(x0, y0), vec2(x1, y1), corner);
  gl_Position = skip ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(p / uView * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  uint c = aCell.y;
  vColor = vec4(float(c >> 24u), float((c >> 16u) & 255u), float((c >> 8u) & 255u), float(c & 255u)) / 255.0;
  vLocal = corner * vec2(x1 - x0, y1 - y0);
  int s = int(slot);
  vTile = ivec2((s % uAtlas.z) * uAtlas.x * 2, (s / uAtlas.z) * uAtlas.y);
}`;

const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uTex; uniform int uPass; uniform vec4 uBgTop; uniform vec4 uBgBot; uniform vec2 uView;
in vec4 vColor; in vec2 vLocal; flat in ivec2 vTile;
out vec4 o;
void main() {
  if (uPass == 0) { vec4 b = mix(uBgTop, uBgBot, clamp(1.0 - gl_FragCoord.y / uView.y, 0.0, 1.0)); o = vec4(b.rgb * b.a, b.a); return; }
  float a = texelFetch(uTex, vTile + ivec2(floor(vLocal)), 0).a * vColor.a;
  o = vec4(vColor.rgb * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('셰이더: ' + gl.getShaderInfoLog(s));
  return s;
}

export class FieldGL {
  /** WebGL2 가 없으면 null — 호출한 쪽이 Canvas 2D 렌더러로 돌아간다 */
  static create(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    return gl ? new FieldGL(canvas, gl) : null;
  }

  constructor(canvas, gl) {
    this.canvas = canvas; this.gl = gl; this.kind = 'webgl2';
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('셰이더 연결: ' + gl.getProgramInfoLog(p));
    this.u = {}; for (const k of ['uView', 'uCell', 'uCols', 'uPass', 'uAtlas', 'uTex', 'uBgTop', 'uBgBot']) this.u[k] = gl.getUniformLocation(p, k);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 8, 0); gl.vertexAttribDivisor(0, 1);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.inst = null; this.atlas = null; this.atlasKey = '';
    this.bg = [[0.016, 0.024, 0.078, 1], [0.016, 0.024, 0.078, 1]];
  }

  /** 바탕 — 위 · 아래 색 [r, g, b, a] (0–1). 시안의 _bg 세로 그라데이션 */
  setBackground(top, bottom) { this.bg = [top, bottom || top]; }

  /** 칸 크기 · 배율 · 글꼴이 바뀌면 타일을 새로 */
  ensureAtlas(cwCss, chCss, dpr, fonts) {
    const cw = Math.ceil(cwCss * dpr), ch = Math.ceil(chCss * dpr), key = cw + 'x' + ch + '|' + fonts.join('|');
    if (this.atlasKey === key) return;
    this.atlasKey = key;
    this.atlas = new GlyphAtlas({ cw, ch, dpr, fonts, size: 2048 });
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  /** 글꼴이 늦게 들어왔을 때(document.fonts loadingdone) — 타일을 통째로 다시 */
  invalidateGlyphs() { this.atlasKey = ''; }

  /**
   * @param {import('./field-grid.js').FieldGrid} grid
   * @param {{ cw: number, ch: number, dpr: number, fonts: string[] }} m  cw · ch = CSS px 칸 크기
   */
  draw(grid, m) {
    const gl = this.gl, n = grid.n;
    this.ensureAtlas(m.cw, m.ch, m.dpr, m.fonts);
    const A = this.atlas;
    // 칸 → 인스턴스 데이터. 글자 슬롯은 타일 사전에서 (처음 보는 글자만 그린다)
    if (!this.inst || this.inst.length !== n * 2) this.inst = new Uint32Array(n * 2);
    const I = this.inst, G = grid.glyph, C = grid.color, F = grid.flags;
    for (let i = 0, j = 0; i < n; i++, j += 2) {
      const cp = G[i], f = F[i];
      I[j] = cp ? (((f | 128) << 24) | A.slot(cp, f & WEIGHT_MASK)) >>> 0 : (f << 24) >>> 0;
      I[j + 1] = C[i];
    }
    const up = A.takeDirty();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (up) gl.texSubImage2D(gl.TEXTURE_2D, 0, up.x, up.y, up.w, up.h, gl.RGBA, gl.UNSIGNED_BYTE, up.data.data);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (this.bufN !== n) { gl.bufferData(gl.ARRAY_BUFFER, I, gl.DYNAMIC_DRAW); this.bufN = n; }
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, I);
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniform2f(this.u.uView, W, H); gl.uniform2f(this.u.uCell, m.cw * m.dpr, m.ch * m.dpr); gl.uniform1i(this.u.uCols, grid.cols);
    gl.uniform3i(this.u.uAtlas, A.L.cw, A.L.ch, A.L.perRow); gl.uniform1i(this.u.uTex, 0);
    gl.uniform4fv(this.u.uBgTop, this.bg[0]); gl.uniform4fv(this.u.uBgBot, this.bg[1]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u.uPass, 0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.uniform1i(this.u.uPass, 1); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    return { cells: n, tiles: A.map.size, uploaded: up ? up.w * up.h : 0 };
  }
}
