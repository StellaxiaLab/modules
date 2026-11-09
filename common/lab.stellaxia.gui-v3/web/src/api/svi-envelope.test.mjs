import test from 'node:test';
import assert from 'node:assert/strict';
import { createSviEnvelope, ENVELOPE_ADD_OP, ENVELOPE_REMOVE_OP, under, joinRoot } from './svi-envelope.js';

test('로컬이면 op 를 입력 {path} 그대로 부르고, 다른 노드면 부르지 않는다', async () => {
  const calls = []; const terra = { invoke: async (...a) => { calls.push(a); return {}; } };
  const E = createSviEnvelope(terra, () => ({ localId: 'n1' }));
  await E.add('n1', '/srv/a'); await E.remove('n1', '/srv/a');
  assert.deepEqual(calls, [[ENVELOPE_ADD_OP, { path: '/srv/a' }], [ENVELOPE_REMOVE_OP, { path: '/srv/a' }]]);
  assert.equal(E.isLocal('n2'), false);
  await assert.rejects(E.add('n2', '/x'), (e) => e.code === 'LOCAL_ONLY');
  await assert.rejects(E.remove('n2', '/x'), (e) => e.code === 'LOCAL_ONLY');
  assert.equal(calls.length, 2);
});

test('경로 도우미', () => {
  assert.equal(under('/a/b', '/a'), true); assert.equal(under('/ab', '/a'), false); assert.equal(under('C:\\Share\\x', 'c:/share/'), true);
  assert.equal(joinRoot('C:\\Users\\k', 'a/b'), 'C:\\Users\\k\\a\\b'); assert.equal(joinRoot('/home/u', ''), '/home/u');
});

test('공유 폴더 — 로컬은 그대로, 다른 노드는 Master 중계(at.node)', async () => {
  const calls = [], E = createSviEnvelope({ invoke: async (op, inp, at) => { calls.push([op, inp, at]); return {}; } }, () => ({ localId: 'n1' }));
  await E.shareRoots('n1'); await E.shareRoots('n2'); await E.shareEntries('n2', 'media', 'a/b');
  assert.deepEqual(calls, [['io.terra.file.roots.list', {}, {}], ['io.terra.file.roots.list', {}, { node: 'n2' }], ['io.terra.file.entries.list', { root: 'media', path: 'a/b' }, { node: 'n2' }]]);
});
