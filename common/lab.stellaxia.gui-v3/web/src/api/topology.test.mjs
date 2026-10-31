// node --test — Master 노드 목록 → 씬 지도(TerraTopology)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, loadTopology, nodeStats, MAX_LEAVES } from './topology.js';

const N = [
  { node_id: 'tr-root', display_name: 'home', roles: ['tree'] },
  { node_id: 'tr-sub', display_name: 'lab', roles: ['tree'], parent_node_id: 'tr-root' },
  { node_id: 'lf-b', display_name: 'ws/b', roles: ['leaf'], parent_node_id: 'tr-root' },
  { node_id: 'lf-a', display_name: 'ws-a', roles: ['leaf'], parent_node_id: 'tr-root' },
  { node_id: 'lf-c', display_name: 'cam', roles: ['leaf'], parent_node_id: 'tr-sub' },
  { node_id: 'lf-x', display_name: 'orphan', roles: ['leaf'], parent_node_id: 'tr-gone' },
];

test('트리 · 리프 · 경로 — 이름순, 목록에 없는 부모는 이름 없는 트리로, / 는 경로와 겹치지 않게', () => {
  const T = buildTopology(N, { localId: 'lf-a', rev: 1 });
  assert.deepEqual(T.spec, [[[]], []]);   // home(자식 트리 lab) · 이름 없는 트리
  assert.equal(T.label([1]), 'home'); assert.equal(T.rid([1]), 'tr-root');
  assert.equal(T.label([1, 1]), 'lab'); assert.equal(T.label([2]), 'Tree');
  assert.deepEqual(T.leaves([1]).map((l) => l.name), ['ws-a', 'ws∕b']);
  assert.deepEqual(T.leaves([1, 1]).map((l) => l.id), ['lf-c']);
  assert.deepEqual(T.leaves([2]).map((l) => l.id), ['lf-x']);
  assert.equal(T.leaves([9]), null); assert.equal(T.localId, 'lf-a');
});

test('리프는 트리마다 12 개까지 — 넘는 것은 개수로', () => {
  const many = [{ node_id: 't', roles: ['tree'], display_name: 't' }].concat(Array.from({ length: 15 }, (_, i) => ({ node_id: 'l' + i, display_name: 'n' + String(i).padStart(2, '0'), parent_node_id: 't' })));
  const T = buildTopology(many);
  assert.equal(T.leaves([1]).length, MAX_LEAVES); assert.equal(T.more([1]), 3);
});

test('loadTopology — 노드 목록 · 로컬 id, 못 받으면 null', async () => {
  const terra = { invoke: async (op) => op === 'terra.master.nodes.get' ? { nodes: N } : { daemon: { node_id: 'x' }, enrollment: { node_id: 'lf-a' } } };
  const T = await loadTopology(terra); assert.equal(T.localId, 'lf-a'); assert.equal(T.count, 7);
  assert.equal(await loadTopology({ invoke: async () => { throw new Error('no'); } }), null);
});

test('nodeStats — 하트비트 자원 스냅샷 · 상태 · 마지막 하트비트, 없는 칸은 null', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.deepEqual(nodeStats({ status: 'online', resource: { cpu_percent: 42, memory_percent: 61.5 }, last_heartbeat_at: '2026-10-31T11:59:50Z' }, now), { status: '● 온라인', online: true, cpu: 0.42, mem: 0.615, disk: null, seen: '방금' });
  assert.equal(nodeStats({ status: 'offline', last_heartbeat_at: '2026-10-31T09:00:00Z' }, now).seen, '3시간 전');
  assert.deepEqual(nodeStats(null, now), { status: '—', online: false, cpu: null, mem: null, disk: null, seen: '' });
  const T = buildTopology([{ node_id: 't', roles: ['tree'], display_name: 'home' }, { node_id: 'l', parent_node_id: 't', resource: { cpu_percent: 5 } }]);
  assert.equal(T.node('l').resource.cpu_percent, 5); assert.equal(T.node('x'), null);
});
