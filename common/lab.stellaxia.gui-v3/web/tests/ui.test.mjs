// node --test — 창 층의 순수 부분(signals · 창 자리 규칙)
import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, scope, untrack } from '../src/ui/signals.js';
import { placeWindow, KINDS } from '../src/ui/window-layer.js';

test('signal · effect — 읽은 값이 바뀔 때만 다시 돈다', () => {
  const a = signal(1), b = signal(10), seen = [];
  const off = effect(() => { seen.push(a() + (a() > 1 ? b() : 0)); });
  b.set(11);            // a()==1 이라 b 를 읽지 않았다 — 다시 돌지 않는다
  a.set(2); b.set(12); a.set(2);
  assert.deepEqual(seen, [1, 13, 14]);
  off(); a.set(3); assert.equal(seen.length, 3);
});

test('computed · batch · untrack', () => {
  const x = signal(2), y = signal(3), sum = computed(() => x() + y()), runs = [];
  effect(() => runs.push(sum()));
  batch(() => { x.set(5); y.set(7); });
  assert.deepEqual(runs, [5, 12]);
  const z = signal(0); let n = 0; effect(() => { n++; untrack(() => z()); }); z.set(1); assert.equal(n, 1);
});

test('scope — 안에서 만든 효과를 한꺼번에 끈다 · 정리 함수', () => {
  const s = signal(0); let runs = 0, cleaned = 0;
  const [, dispose] = scope(() => { effect(() => { s(); runs++; return () => cleaned++; }); });
  s.set(1); assert.equal(runs, 2); assert.equal(cleaned, 1);
  dispose(); s.set(2); assert.equal(runs, 2); assert.equal(cleaned, 2);
});

test('placeWindow — 같은 대상은 다시 쓰고, 자리가 차면 가장 뒤 창을 민다', () => {
  const w = [{ kind: 'res', key: 'a', z: 3, min: false }, { kind: 'res', key: 'b', z: 1, min: false }, { kind: 'res', key: 'c', z: 2, min: false }, { kind: 'conf', key: 'x', z: 9, min: false }];
  assert.equal(placeWindow(w, 'res', 'b', 3).reuse, w[1]);
  assert.equal(placeWindow(w, 'res', 'd', KINDS.res.slots).evict, w[1]);
  assert.equal(placeWindow(w, 'conf', 'y', KINDS.conf.slots).evict, w[3]);
  assert.equal(placeWindow(w, 'stat', 'n', KINDS.stat.slots).evict, null);
  w[1].min = true; assert.equal(placeWindow(w, 'res', 'd', 3).evict, null);   // 최소화한 창은 자리를 차지하지 않는다
});
