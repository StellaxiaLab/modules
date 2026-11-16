// node --test — 경로 · 권한 · 오류 분류 · 전송 줄 · 공유 폴더 상태 · 동기화 계획 · API 호출 모양.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, cleanPath, joinPath, parentPath, crumbs, outsideRoot, sortEntries, rootsState, describeError, transferRow, suggestName } from './model.js';
import { planSync, planSummary, planTotal } from './sync-plan.js';
import { createApi, TerraError } from './api.js';

test('권한 — 읽기만 있으면 쓰기를 잠근다', () => {
  assert.deepEqual(capabilities(['file.read']), { read: true, write: false, nodes: false });
  assert.deepEqual(capabilities(['file.read', 'file.write', 'node.read']), { read: true, write: true, nodes: true });
  assert.deepEqual(capabilities(undefined), { read: false, write: false, nodes: false });
});

test('경로 — 정리 · 합치기 · 위 폴더 · 빵부스러기', () => {
  assert.equal(cleanPath('/a//b/./c/'), 'a/b/c');
  assert.equal(joinPath('a/b', '/c'), 'a/b/c');
  assert.equal(joinPath('', 'x'), 'x');
  assert.equal(parentPath('a/b/c'), 'a/b');
  assert.equal(parentPath('a'), '');
  assert.deepEqual(crumbs('a/b'), [{ name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]);
});

test('공유 폴더 밖 경로를 보내기 전에 알아본다', () => {
  assert.equal(outsideRoot('/etc/passwd'), true);
  assert.equal(outsideRoot('C:\\Windows'), true);
  assert.equal(outsideRoot('a/../../b'), true);
  assert.equal(outsideRoot('logs/2026-11'), false);
});

test('항목은 폴더 먼저, 이름순', () => {
  const s = sortEntries([{ name: 'b', is_dir: false }, { name: 'z', is_dir: true }, { name: 'a', is_dir: false }, { name: 'c', is_dir: true }]);
  assert.deepEqual(s.map((e) => e.name), ['c', 'z', 'a', 'b']);
});

test('공유 폴더 목록 — 비어 있음 · 못 봤음 · 있음을 섞지 않는다', () => {
  assert.equal(rootsState({ roots: [{ name: 'share-0', path: '/x' }], count: 1 }).state, 'ok');
  assert.equal(rootsState({ roots: [], count: 0 }).state, 'empty');
  assert.equal(rootsState(null).state, 'empty');
  const err = Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' });
  const s = rootsState(null, err);
  assert.equal(s.state, 'unseen');
  assert.equal(s.err, err);
});

test('오류 분류 — 못 봤음(unseen)은 파일이 없다는 뜻이 아니라고 말한다', () => {
  for (const code of ['MODULE_NOT_FOUND', 'MODULE_ROUTE_NOT_FOUND', 'NETWORK', 'TIMEOUT', 'GATEWAY_UNREACHABLE']) {
    const d = describeError({ code });
    assert.equal(d.tone, 'unseen', code);
  }
  assert.match(describeError({ code: 'MODULE_NOT_FOUND' }).body, /없다는 뜻이 아닙니다/);
  assert.equal(describeError({ code: 'FILE_NOT_FOUND' }).tone, 'warn');
  assert.equal(describeError({ code: 'PATH_DENIED' }).tone, 'error');
  assert.equal(describeError({ code: 'WHATEVER', status: 403 }).title, '권한이 없습니다');
  assert.equal(describeError({ code: 'WHATEVER', status: 401 }).title, '로그인이 필요합니다');
  assert.equal(describeError({ code: 'WHATEVER', status: 503 }).tone, 'unseen');
  assert.equal(describeError({ code: 'ODD', message: '이상함' }).body, '이상함');
});

test('전송 줄 — 화면이 돌리지 않는 transferring 은 멈춤, 이어받기를 준다', () => {
  const base = { transfer_id: 't1', direction: 'push', root: 'share-0', path: 'a.zip', size_bytes: 1000, offset: 410 };
  const idle = transferRow({ ...base, state: 'transferring' }, new Set());
  assert.equal(idle.label, '멈춤');
  assert.equal(idle.pct, 41);
  assert.deepEqual(idle.actions, ['resume', 'discard']);
  const live = transferRow({ ...base, state: 'transferring' }, new Set(['t1']));
  assert.equal(live.label, '전송 중');
  assert.deepEqual(live.actions, ['cancel']);
  assert.equal(transferRow({ ...base, state: 'completed', offset: 1000 }).pct, 100);
  const expired = transferRow({ ...base, state: 'aborted', reason: 'expired' });
  assert.equal(expired.label, '만료');
  assert.deepEqual(expired.actions, ['resume']);
  assert.equal(transferRow({ ...base, direction: 'pull', state: 'aborted' }).actions.length, 0);
});

test('같은 이름 — 겹치지 않는 이름을 낸다', () => {
  assert.equal(suggestName('a.zip', ['a.zip']), 'a (1).zip');
  assert.equal(suggestName('a.zip', ['a.zip', 'a (1).zip']), 'a (2).zip');
  assert.equal(suggestName('README', ['README']), 'README (1)');
});

test('동기화 계획 — 없음 · 크기 다름 · 로컬이 새것 · 같음 · 노드에만 있음', () => {
  const T = Date.parse('2026-11-01T00:00:00Z');
  const local = [
    { path: 'new.txt', size: 1, mtime: T },
    { path: 'size.txt', size: 5, mtime: T },
    { path: 'newer.txt', size: 3, mtime: T + 5000 },
    { path: 'same.txt', size: 3, mtime: T },
  ];
  const remote = [
    { path: 'size.txt', size: 4, modified_at: '2026-11-01T00:00:00Z' },
    { path: 'newer.txt', size: 3, modified_at: '2026-11-01T00:00:00Z' },
    { path: 'same.txt', size: 3, modified_at: '2026-11-01T00:00:00Z' },
    { path: 'old.txt', size: 9, modified_at: '2026-10-01T00:00:00Z' },
    { path: 'dir', size: 0, modified_at: '2026-10-01T00:00:00Z', is_dir: true },
  ];
  const keep = planSync(local, remote);
  assert.deepEqual(keep.add.map((f) => f.path), ['new.txt']);
  assert.deepEqual(keep.change.map((f) => f.path), ['size.txt', 'newer.txt']);
  assert.equal(keep.same, 1);
  assert.equal(keep.remove.length, 0, '--delete 없이는 노드에만 있는 파일을 두고, 폴더는 지우지 않는다');
  const del = planSync(local, remote, { remove: true });
  assert.deepEqual(del.remove.map((f) => f.path), ['old.txt']);
  assert.equal(planTotal(del), 4);
  assert.deepEqual(planSummary(del), { add: 1, change: 2, remove: 1, same: 1, bytes: 9 });
});

const fakeFrame = (handler) => ({ fetch: async (path, init) => handler(path, init) });
const res = (status, body) => ({ ok: status < 300, status, statusText: '', text: async () => JSON.stringify(body) });

test('API — 이 노드는 operations, 다른 노드는 nodes/{node}/operations 로 부른다', async () => {
  const seen = [];
  const api = createApi(fakeFrame((path, init) => { seen.push([path, JSON.parse(init.body)]); return res(200, { status: 'ok', data: { roots: [], count: 0 } }); }));
  await api.files().roots();
  await api.files('node-2').list('share-0', 'logs');
  assert.equal(seen[0][0], '/api/v1/operations/lab.stellaxia.file.roots.list/invoke');
  assert.equal(seen[1][0], '/api/v1/nodes/node-2/operations/lab.stellaxia.file.entries.list/invoke');
  assert.deepEqual(seen[1][1], { root: 'share-0', path: 'logs' });
});

test('API — 봉투를 벗기고 오류 코드를 보존한다', async () => {
  const ok = createApi(fakeFrame(() => res(200, { status: 'ok', data: { count: 2 } })));
  assert.deepEqual(await ok.invoke('x'), { count: 2 });
  const bad = createApi(fakeFrame(() => res(409, { error: { code: 'CHUNK_OUT_OF_ORDER', message: 'late', details: { retry_offset: 5 } } })));
  await assert.rejects(bad.invoke('x'), (e) => e instanceof TerraError && e.code === 'CHUNK_OUT_OF_ORDER' && e.details.retry_offset === 5 && e.status === 409);
  const down = createApi(fakeFrame(() => { throw new Error('boom'); }));
  await assert.rejects(down.invoke('x'), (e) => e.code === 'NETWORK');
  const gw = createApi(fakeFrame(() => ({ ok: false, status: 502, statusText: '', text: async () => 'bad gateway' })));
  await assert.rejects(gw.invoke('x'), (e) => e.code === 'GATEWAY_UNREACHABLE');
});

test('API — 노드 목록은 node_id 없는 줄을 버리고 이름을 고른다', async () => {
  const api = createApi(fakeFrame(() => res(200, { ok: true, data: [{ node_id: 'a', display_name: 'desktop-01', online: true }, { name: '이상함' }] })));
  assert.deepEqual(await api.nodes(), [{ id: 'a', name: 'desktop-01', online: true }]);
});
