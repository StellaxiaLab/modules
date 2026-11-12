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
