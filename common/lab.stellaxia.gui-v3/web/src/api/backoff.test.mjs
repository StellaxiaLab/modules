import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs } from './backoff.js';

test('backoffMs — 두 배씩 늘다가 max 에서 멈춘다', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => backoffMs(n, 5000, 60000)), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.deepEqual([1, 2, 3, 6, 7].map((n) => backoffMs(n, 1000, 30000)), [1000, 2000, 4000, 30000, 30000]);
  assert.equal(backoffMs(0, 2000, 30000), 2000);
});
