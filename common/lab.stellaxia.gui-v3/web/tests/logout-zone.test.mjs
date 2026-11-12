// node --test — AUD-21: 좁은 창(약 720px)에서 로고 → 로그아웃 라벨로 옮기는 동안 호버가 꺼져 누르기가 버려지던 회귀.
//   긴 principal(65칸)이 로그아웃 라벨을 info 호버 구역(x0+wCol) 밖으로 밀었다. 이제 principal 은 줄여 보이고, 구역은 라벨까지 넓힌다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
globalThis.document = globalThis.document || { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;
const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const dir = mkdtempSync(join(tmpdir(), 'logout-zone-'));
async function logic(name) {
  const f = join(dir, name + '.mjs');
  writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/' + name + '.dc.html', import.meta.url)), 'utf8'), name, RT));
  await import(pathToFileURL(f).href);
  return boardDef(name).Logic;
}

const PRINCIPAL = 'app:' + 'x'.repeat(61);   // 65칸 — whoami 에는 표시 이름이 없다

for (const [board, P, Z, Lo, Lg, Tap] of [['Field', '', '_zones', '_lo', '_lg', 'ctlTap'], ['Scene', 'gf_', '_q_zones', '_q_lo', '_q_lg', 'gf_ctlTap']]) {
  test(board + ' — 720px · 65칸 principal: 로그아웃 라벨이 info 호버 구역 안, 옮겨 가 눌러도 로그아웃', async () => {
    const C = await logic(board), o = Object.create(C.prototype);
    window.TerraTransport = {}; window.TerraWho = { principal: PRINCIPAL };
    const cw = 8, ch = 16, W = 720;
    Object.assign(o, board === 'Field'
      ? { props: {}, state: {}, _cw: cw, _ch: ch, _w: W, _h: 600, _cols: 90, _rows: 37 }
      : { props: {}, state: {}, _q_cw: cw, _q_ch: ch, _q_w: W, _q_h: 600, _q_cols: 90, _q_rows: 37 });
    o[P + 'logoShape'] = () => ({ w: 160, h: 60, key: 'k', idx: new Map() });
    try {
      o[P + 'layout']();
      const Q = o[Lo], z = o[Z].info;
      assert.ok(Q, '로그아웃 자리가 있다');
      // 호버 판정(update 의 inZ)과 같은 여유: 구역 오른쪽 + 1칸
      assert.ok(Q.x1 <= z.c1 * cw + cw, `라벨 오른쪽 ${Q.x1}px 이 info 구역 오른쪽 ${(z.c1 + 1) * cw}px 안`);
      assert.ok(Q.x0 <= z.c1 * cw + cw);
      // 로고 → 라벨 경로의 가운데(라벨 시작 직전)도 구역 안
      // 화면 폭 안에도 있다
      assert.ok(Q.x1 <= W, '창 폭 안');
      let called = 0; o[P + 'doLogout'] = () => { called++; };
      o[Lg] = { on: true, open: false, m: 0, mp: 0 };
      const mid = (Q.x0 + Q.x1) / 2, y = Q.row * ch + ch / 2;
      assert.equal(o[Tap](mid, y), true); assert.equal(called, 1, '라벨 누르기 → 로그아웃');
    } finally { delete window.TerraTransport; delete window.TerraWho; }
  });

  test(board + ' — 긴 principal 은 24칸 안으로 줄여(…) 보인다', async () => {
    const S = readFileSync(fileURLToPath(new URL('../design/' + board + '.dc.html', import.meta.url)), 'utf8');
    assert.match(S, /WHO\.principal/);
    assert.match(S, /…/);
    assert.match(S, new RegExp(P + 'whoShort|whoShort'), '표시용 줄임 함수');
  });
}

test('whoShort — 24칸 이하는 그대로, 넘으면 … 로', async () => {
  const C = await logic('Field'), o = Object.create(C.prototype);
  assert.equal(o.whoShort('admin'), 'admin');
  const s = o.whoShort(PRINCIPAL);
  assert.ok(o.dw(s) <= 24 && s.endsWith('…'), s);
});

// AUD-21 재점검 — 실제 누르기 경로(Scene 의 tap 핸들러 → gfOver/gfHit → gfTap → ctlTap)를 720px 배치로 구동.
//   라벨 x 는 컨트롤 구역(viewX0) 밖이라 예전엔 gfTap 까지 가지 못해 로그아웃이 불리지 않았다.
test('Scene — 720px 실제 tap 경로: 로그아웃 라벨 누르기가 로그아웃에 닿고, 그 밖 누르기는 씬으로', async () => {
  const C = await logic('Scene'), o = Object.create(C.prototype);
  window.TerraTransport = {}; window.TerraWho = { principal: PRINCIPAL };
  const cw = 8, ch = 16, W = 720;
  Object.assign(o, { props: {}, state: {}, _q_cw: cw, _q_ch: ch, _q_w: W, _q_h: 600, _q_cols: 90, _q_rows: 37 });
  o.gf_logoShape = () => ({ w: 160, h: 60, key: 'k', idx: new Map() });
  try {
    o.gf_layout();
    const Q = o._q_lo; assert.ok(Q);
    assert.ok(Q.x0 > o.viewX0(), `전제: 라벨(${Q.x0}px)이 컨트롤 구역 오른쪽 끝(${o.viewX0()}px) 밖`);
    let lo = 0, scene = 0, tapped = 0;
    o.gf_doLogout = () => { lo++; };
    o.sceneLogout = () => { lo++; };
    o._q_lg = { on: true, open: false, m: 0, mp: 0 };
    o._cv = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    o._hits = [{}];
    o.pickHit = () => { scene++; return null; };
    const gt = o.gfTap.bind(o); o.gfTap = (x, y) => { tapped++; return gt(x, y); };
    const tap = o.renderVals().tap, ev = (x, y) => ({ button: 0, clientX: x, clientY: y, target: null });
    tap(ev((Q.x0 + Q.x1) / 2, Q.row * ch + ch / 2));
    assert.equal(tapped, 1, '라벨 누르기가 전역 틀(gfTap)에 닿는다');
    assert.equal(lo, 1, '로그아웃 호출');
    // 라벨 밖(같은 줄 오른쪽 · 화면 가운데)은 씬이 받는다
    tap(ev(W - 20, Q.row * ch + ch / 2)); tap(ev(W / 2, 400));
    assert.equal(tapped, 1, '라벨 밖은 gfTap 으로 가지 않는다');
    assert.equal(scene, 2, '라벨 밖은 씬(pickHit)으로');
    assert.equal(lo, 1);
  } finally { delete window.TerraTransport; delete window.TerraWho; }
});

// AUD-21 3차 — 로고에서 로그아웃 라벨로 '대각선'으로 가도 호버가 유지된다(로고 구역과 info 구역 사이 빈 칸을 지난다).
//   실제 프레임 갱신(gf_step)과 실제 tap 경로로 구동: 켜진 뒤엔 로고~info 를 감싸는 복도 안에서 유지, 복도를 벗어나면 꺼진다.
test('Scene — 720px · 65칸: 로고 중심 → 로그아웃 라벨 중심 직선 경로에서 호버 유지, 마지막 누르기가 로그아웃', async () => {
  const C = await logic('Scene'), o = Object.create(C.prototype);
  window.TerraTransport = {}; window.TerraWho = { principal: PRINCIPAL };
  const cw = 8, ch = 16, W = 720;
  Object.assign(o, { props: {}, state: {}, _q_cw: cw, _q_ch: ch, _q_w: W, _q_h: 600, _q_cols: 90, _q_rows: 37 });
  o.gf_logoShape = () => ({ w: 160, h: 60, key: 'k', idx: new Map() });
  try {
    o.gf_layout();
    const Q = o._q_lo, Zl = o._q_zones.logo, Zi = o._q_zones.info;
    assert.ok(Q && Zl && Zi);
    const L = o.gf_TL(), Tm = L.mSpread + L.mCell + L.G;
    o._q_lg = { mp: Tm, m: 0, on: false, onAt: 0, open: false, cAt: 0, ring: 0 };
    o._q_boot = -1e6; o._cv = { getBoundingClientRect: () => ({ left: 0, top: 0 }), parentElement: null };
    let now = 1e6; const frame = (x, y) => { o._mouse = { x, y }; now += 16; o.gf_step(now, 16); };
    const A = { x: (Zl.c0 + Zl.c1) / 2 * cw, y: (Zl.r0 + Zl.r1) / 2 * ch }, B = { x: (Q.x0 + Q.x1) / 2, y: Q.row * ch + ch / 2 };
    frame(A.x, A.y); assert.equal(o._q_lg.on, true, '로고 위에서 켜진다');
    const N = 60; for (let i = 0; i <= N; i++) { const t = i / N; frame(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t); assert.equal(o._q_lg.on, true, `경로 ${i}/${N} 에서 호버 유지`); }
    let lo = 0; o.gf_doLogout = () => { lo++; }; o.sceneLogout = () => { lo++; };
    o._hits = [{}]; o.pickHit = () => null;
    o.renderVals().tap({ button: 0, clientX: B.x, clientY: B.y, target: null });
    assert.equal(lo, 1, '마지막 누르기 → 로그아웃');
    // 복도 밖으로 나가면 꺼진다 (아래쪽 info 구역 밑 · 복도 오른쪽 밖)
    const out = (x, y) => { frame(x, y); for (let i = 0; i < 40; i++) frame(x, y); return o._q_lg.on; };
    assert.equal(out(B.x, (Math.max(Zl.r1, Zi.r1) + 4) * ch), false, '복도 아래로 벗어나면 꺼짐');
    frame(A.x, A.y); assert.equal(o._q_lg.on, true);
    assert.equal(out(Math.max(Zl.c1, Zi.c1) * cw + 4 * cw, A.y), false, '복도 오른쪽으로 벗어나면 꺼짐');
  } finally { delete window.TerraTransport; delete window.TerraWho; }
});
