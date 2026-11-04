// node --test — 자원 추이: 하트비트 스냅샷 고리 버퍼 · 점열 · 글자 그래프 · 갱신 주기 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointOf, addPoint, series, sparkText, cadence, createMetrics } from './metrics.js';

const T0 = Date.parse('2026-11-04T10:00:00Z'), iso = (s) => new Date(T0 + s * 1000).toISOString();
const rec = (id, s, cpu, mem, extra) => Object.assign({ node_id: id, last_heartbeat_at: iso(s), resource: { cpu_percent: cpu, memory_percent: mem } }, extra);

test('pointOf — 하트비트 시각이 없으면 쌓지 않고, 없는 값은 null', () => {
  assert.equal(pointOf({ node_id: 'a', resource: { cpu_percent: 5 } }), null);
  assert.deepEqual(pointOf(rec('a', 0, 50, undefined), 9), { at: T0, obs: 9, cpu: 0.5, mem: null, disk: null });
  assert.equal(pointOf(rec('a', 0, 250, 1)).cpu, 1);   // 0..1 로 자른다
});

test('addPoint — 같은 하트비트 · 더 오래된 것은 하나로, cap 을 넘으면 오래된 것부터', () => {
  let B = [];
  for (const s of [0, 0, 30, 10, 60, 90]) B = addPoint(B, pointOf(rec('a', s, s, 1)), 3);
  assert.deepEqual(B.map((p) => (p.at - T0) / 1000), [30, 60, 90]);
  assert.equal(addPoint(B, null), B);
});

test('series · sparkText — 보고한 점만, 모자란 앞자리는 ·', () => {
  const B = [pointOf(rec('a', 0, 0, 10)), pointOf(rec('a', 30, 100, undefined)), pointOf(rec('a', 60, 50, 20))];
  assert.deepEqual(series(B, 'mem').map((p) => p.v), [0.1, 0.2]);
  assert.equal(sparkText(series(B, 'cpu'), 5), '··▁▇▄');
  assert.equal(sparkText([], 5), '');
  assert.equal(sparkText(series(B, 'cpu'), 2), '▇▄');
});

test('cadence — 주기 · 나이를 적는다(실시간인 척하지 않는다)', () => {
  assert.equal(cadence([], T0).text, '갱신 : 30s · 아직 없음 (하트비트)');
  const B = [pointOf(rec('a', 0, 1, 1))];
  const c = cadence(B, T0 + 12000);
  assert.deepEqual([c.n, c.ageSec, c.everySec], [1, 12, 30]); assert.equal(c.text, '갱신 : 30s · 12s 전 (하트비트)');
  assert.equal(cadence(B, T0 + 600000, 60000).text, '갱신 : 60s · 10m 전 (하트비트)');
});

test('createMetrics — 노드 기록들을 받을 때마다 노드마다 쌓는다', () => {
  let now = T0 + 5000; const M = createMetrics({ now: () => now });
  assert.equal(M.ingest([rec('a', 0, 10, 20), rec('b', 0, 90, 80), { node_id: 'c' }, null]), 2);
  assert.equal(M.ingest([rec('a', 0, 10, 20)]), 0);   // 같은 하트비트 — 새 점 아님
  now = T0 + 40000; M.ingest([rec('a', 30, 40, 20)]);
  assert.deepEqual(M.series('a', 'cpu').map((p) => p.v), [0.1, 0.4]);
  assert.equal(M.spark('a', 'cpu', 3), '·▂▃');
  assert.equal(M.cadence('a').text, '갱신 : 30s · 10s 전 (하트비트)');
  assert.deepEqual(M.points('zz'), []);
  M.clear(); assert.deepEqual(M.points('a'), []);
});
