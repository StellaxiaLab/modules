// 조타륜 — 자원을 끌어 놓은 뒤에도 눈금판이 보여야 한다.
//   npm test
// 재현(브라우저 실측): 조타륜 앱 카드를 끌어 필드에 놓으면 place 상태가 바뀌며 화면이 조타륜 캔버스 · 입력 띠를 새 요소로 갈아 끼운다.
// hxStart는 처음 잡은 캔버스에만 그려서, 새 캔버스(300×150, 빈 그림)가 남아 어두운 원판만 보였다 → loop가 새 요소로 갈아타야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';

const raf = [];
const mkCanvas = () => {
  const ctx = new Proxy({ draws: 0 }, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 8 }) : () => { t.draws++; }), set: () => true });
  return { width: 300, height: 150, style: {}, ctx, getContext() { return ctx; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 285, right: 600, bottom: 285 }) };
};
const mkZone = () => ({ style: {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 255, width: 600, height: 30, right: 600, bottom: 285 }) });
let cvEl = mkCanvas(), zoneEl = mkZone();
globalThis.window = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {}, innerWidth: 1447, innerHeight: 945 };
globalThis.window.parent = globalThis.window;
globalThis.document = {
  querySelector: (q) => (q === '[data-hx-cv]' ? cvEl : q === '[data-hx-zone]' ? zoneEl : null),
  addEventListener() {}, removeEventListener() {},
  createElement: () => mkCanvas(), fonts: null,
};
globalThis.requestAnimationFrame = (f) => { raf.push(f); return raf.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance ||= { now: () => Date.now() };

const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

test('조타륜 — 캔버스가 갈아 끼워져도 loop가 새 캔버스에 다시 그린다', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.hxStart();
  assert.ok(s._hx, 'hxStart가 시작돼야 한다');
  assert.equal(cvEl.width, 1200, '처음 캔버스는 크기가 잡힌다');
  const old = cvEl;

  // 화면이 조타륜 DOM을 새로 만든다 — 새 캔버스는 기본 300×150, 그림 없음
  cvEl = mkCanvas(); zoneEl = mkZone();
  assert.equal(cvEl.width, 300);
  raf.shift()(performance.now() + 50);

  assert.equal(cvEl.width, 1200, '새 캔버스의 크기를 다시 잡는다');
  assert.equal(cvEl.height, 570);
  assert.ok(cvEl.ctx.draws > 0, '새 캔버스에 눈금판을 그린다');
  assert.equal(old.ctx.draws > 0, true, '처음 캔버스에는 처음에 그렸다');
  assert.equal(zoneEl.style.height, '88px', '입력 띠도 새 요소를 따라간다 (숨었을 땐 보이는 눈금 높이)');
});
