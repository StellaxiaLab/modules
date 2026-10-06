// 실데이터 층(src/data)의 순수 함수 — 진짜 응답 모양 → 화면 모양.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { treeFromMaster, nameNodes, buildNet, resourceSummary } from '../src/data/world.js';
import { taskAlarms, taskAlarm, clock } from '../src/data/alarms.js';
import { rootItems, entryItems, splitId, fmtSize } from '../src/data/files.js';

test('tree 이름은 Master 주소의 host:port 다 — 주소가 없으면 tree 가 없다', () => {
  assert.deepEqual(treeFromMaster('http://127.0.0.1:28080'), { name: 'tree · 127.0.0.1:28080', role: 'Tree', bid: null, url: 'http://127.0.0.1:28080' });
  assert.equal(treeFromMaster(''), null);
  assert.equal(treeFromMaster('not a url'), null);
});

test('표시 이름이 겹치는 노드는 node_id 끝 네 글자로 가른다', () => {
  const named = nameNodes([
    { nodeId: 'node_a_1111', displayName: 'pi' },
    { nodeId: 'node_b_2222', displayName: 'pi', status: 'offline' },
    { nodeId: 'node_c_3333' },
    { displayName: 'id 없음' }
  ]);
  assert.deepEqual(named.map((n) => n.name), ['pi · 1111', 'pi · 2222', 'node_c_3333']);
  assert.equal(named[1].status, 'offline');
});

test('관계도 — tree 아래에 보이는 노드를 두고, 로컬 노드는 목록에 없어도 넣는다', () => {
  const nodes = nameNodes([{ nodeId: 'n2', displayName: 'other' }]);
  const { NET, mapOwner, localName } = buildNet({ tree: { name: 'tree · m:1', role: 'Tree' }, nodes, local: { id: 'n1', name: 'me' } });
  assert.equal(mapOwner, 'tree · m:1');
  assert.equal(localName, 'me');
  assert.deepEqual(NET['tree · m:1'].kids, ['me', 'other']);
  assert.equal(NET.me.role, 'Leaf');
  assert.deepEqual(NET.me.res, []);
});

test('관계도 — 로컬 노드가 목록에 있으면 그 이름을 쓴다', () => {
  const nodes = nameNodes([{ nodeId: 'n1', displayName: 'stack-leaf-01', status: 'online' }]);
  const { NET, localName } = buildNet({ tree: { name: 't' }, nodes, local: { id: 'n1', name: '다른 이름' } });
  assert.equal(localName, 'stack-leaf-01');
  assert.deepEqual(NET.t.kids, ['stack-leaf-01']);
});

test('관계도 — tree 를 모르면 로컬 노드 하나가 맵의 주인이다', () => {
  const { NET, mapOwner } = buildNet({ tree: null, nodes: [], local: { name: 'solo' } });
  assert.equal(mapOwner, 'solo');
  assert.deepEqual(Object.keys(NET), ['solo']);
});

test('자원 요약은 진짜 개수만 싣는다', () => {
  assert.deepEqual(resourceSummary({ devices: 3, roots: 1, modules: undefined }), [['I/O 장치 3', '장치'], ['공유 폴더 1', '파일']]);
});

test('작업 알림 — 처음엔 최근 것만, 그 뒤엔 바뀐 것만', () => {
  const seen = new Map();
  const tasks = [
    { id: 'task-1', type: 'process.execute.request', state: 'succeeded', finished_at: '2026-10-03T13:48:10Z' },
    { id: 'task-2', type: 'process.execute.request', state: 'running', started_at: '2026-10-03T13:50:00Z' }
  ];
  const first = taskAlarms(seen, tasks, { first: true });
  assert.equal(first.length, 2);
  assert.equal(first[0].id, 'task-2');   // 최근 것이 앞
  assert.equal(taskAlarms(seen, tasks).length, 0);   // 그대로면 알림 없음
  tasks[1].state = 'failed';
  const next = taskAlarms(seen, tasks);
  assert.equal(next.length, 1);
  assert.match(next[0].m, /실패/);
  assert.equal(next[0].c, '#ff6b81');
});

test('작업 알림 한 줄의 모양', () => {
  const a = taskAlarm({ id: 'task-1791035290088767914-1', type: 'process.execute.request', state: 'succeeded', finished_at: '2026-10-03T13:48:10Z' });
  assert.equal(a.g, '●');
  assert.equal(a.m, 'process.execute.request · 완료 — #7914-1');
  assert.match(a.t, /^\d\d:\d\d$/);
  assert.equal(clock('bad'), '');
});

test('공유 폴더 → 맨 위 칸, 폴더 항목 → 그 아래 칸', () => {
  assert.deepEqual(rootItems([{ name: 'share-0', path: '/srv/share' }]), [{ id: 'share-0', parent: '', name: 'share-0', dir: true, info: 'share-0 · /srv/share', share: 'share-0', rel: '' }]);
  const items = entryItems('share-0', '', [
    { path: 'docs', name: 'docs', size: 0, is_dir: true, modified_at: '2026-10-03T13:00:00Z' },
    { path: 'hello.txt', name: 'hello.txt', size: 2048, is_dir: false, modified_at: '2026-10-03T13:00:00Z' }
  ]);
  assert.deepEqual(items.map((i) => [i.id, i.parent, i.dir, i.size]), [['share-0/docs', 'share-0', true, undefined], ['share-0/hello.txt', 'share-0', false, '2.0 KB']]);
  const sub = entryItems('share-0', 'docs', [{ path: 'docs/ops.md', name: 'ops.md', size: 12, is_dir: false }]);
  assert.equal(sub[0].parent, 'share-0/docs');
  assert.equal(sub[0].id, 'share-0/docs/ops.md');
});

test('보관함 칸 id 를 공유 폴더 · 상대 경로로 가른다', () => {
  assert.deepEqual(splitId('share-0/docs/ops.md'), { root: 'share-0', rel: 'docs/ops.md' });
  assert.deepEqual(splitId('share-0'), { root: 'share-0', rel: '' });
  assert.deepEqual(splitId(''), { root: '', rel: '' });
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(1536), '1.5 KB');
});
