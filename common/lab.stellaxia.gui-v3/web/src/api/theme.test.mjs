import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheme, THEME_KEY } from '../ui/theme.js';

const store = (v) => { const m = new Map(v ? [[THEME_KEY, v]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: (k, x) => m.set(k, x) }; };

test('기본은 다크, 저장된 값을 따른다', () => {
  assert.equal(createTheme({ root: { dataset: {} }, storage: store() }).get(), 'dark');
  const root = { dataset: {} };
  assert.equal(createTheme({ root, storage: store('light') }).get(), 'light');
  assert.equal(root.dataset.theme, 'light');
});

test('toggle 은 저장하고 알린다', () => {
  let n = 0; const s = store(), root = { dataset: {} }, T = createTheme({ root, storage: s, emit: () => n++ });
  T.toggle();
  assert.equal(root.dataset.theme, 'light'); assert.equal(s.getItem(THEME_KEY), 'light'); assert.equal(n, 1);
  T.toggle();
  assert.equal(T.get(), 'dark');
});

test('저장소가 막혀도 깨지지 않는다', () => {
  const T = createTheme({ root: { dataset: {} }, storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } });
  assert.equal(T.get(), 'dark'); T.set('light'); assert.equal(T.get(), 'light');
});
