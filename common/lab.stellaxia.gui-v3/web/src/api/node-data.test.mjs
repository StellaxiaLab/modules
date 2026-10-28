// node --test web/src/api/node-data.test.mjs — 백엔드를 흉내 낸 request 로 클라이언트의 순서 · 나눔을 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeData, apiBase, safeName } from './node-data.js';

function fakeBackend({ chunk = 4, maxFile = 64 } = {}) {
  const files = new Map(), log = [];
  let props = {}, staged = new Map();
  const request = async (method, path, body) => {
    const u = new URL('http://x' + path), p = u.pathname.replace(/^.*\/v1/, '');
    log.push(method + ' ' + p + (u.search || ''));
    if (p === '/status') return { status: 'ok', maxFileBytes: maxFile, maxChunkBytes: chunk, maxTotalBytes: 1e6, usedBytes: 0, dataPrefix: '/데이터', version: 't' };
    if (p === '/node/props' && method === 'GET') return { props };
    if (p === '/node/props' && method === 'PATCH') {
      for (const [k, v] of Object.entries(body.set)) { if (v === null) delete props[k]; else props[k] = v; }
      return { props };
    }
    if (p === '/node/files/content' && method === 'PUT') {
      const raw = Buffer.from(body.data, 'base64'), have = staged.get(body.path) || Buffer.alloc(0);
      if (body.offset !== (body.offset === 0 ? 0 : have.length)) return { error: { code: 'CHUNK_OUT_OF_ORDER' } };
      const next = Buffer.concat([body.offset === 0 ? Buffer.alloc(0) : have, raw]);
      if (next.length < body.total) { staged.set(body.path, next); return { done: false, received: next.length, total: body.total }; }
      staged.delete(body.path); files.set(body.path, next);
      return { done: true, received: next.length, total: body.total, entry: { path: body.path, size: next.length, mime: 'image/gif' } };
    }
    if (p === '/node/files/content' && method === 'GET') {
      const f = files.get(u.searchParams.get('path'));
      return f ? { path: u.searchParams.get('path'), size: f.length, mime: 'image/gif', data: f.toString('base64') } : { error: { code: 'NOT_FOUND' } };
    }
    if (p === '/node/files/content' && method === 'DELETE') {
      return files.delete(u.searchParams.get('path')) ? { deleted: true } : { error: { code: 'NOT_FOUND' } };
    }
    return { error: { code: 'METHOD_NOT_ALLOWED' } };
  };
  return { request, files, log, get props() { return props; } };
}

test('apiBase — 이 노드와 원격 노드', () => {
  assert.equal(apiBase(), '/api/modules/lab.stellaxia.gui-v3/v1');
  assert.equal(apiBase('nd 1'), '/api/nodes/nd%201/modules/lab.stellaxia.gui-v3/v1');
});

test('safeName — 백엔드가 거부할 문자를 미리 바꾼다', () => {
  assert.equal(safeName('a/b:c?.gif'), 'a_b_c_.gif');
  assert.equal(safeName('.hidden.png'), '_hidden.png');
});

test('setProfile — 청크로 올리고, 속성을 가리키고, 지난 그림을 지운다', async () => {
  const B = fakeBackend({ chunk: 4 });
  const api = createNodeData(B.request);
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const sent = [];
  assert.equal(await api.setProfile({ name: 'old.gif', bytes }, (s) => sent.push(s)), '/데이터/profile/image/old.gif');
  assert.deepEqual(sent, [4, 8, 10]);
  assert.equal(await api.setProfile({ name: 'new.gif', bytes: bytes.subarray(0, 3) }), '/데이터/profile/image/new.gif');
  assert.deepEqual([...B.files.keys()], ['profile/image/new.gif']);
  assert.deepEqual(B.props, { profile: { image: '/데이터/profile/image/new.gif' } });
  assert.match(await api.profileDataURL(), /^data:image\/gif;base64,/);
  assert.equal(await api.setProfile(null), '');
  assert.equal(B.files.size, 0);
  assert.deepEqual(B.props, {});
});

test('put — 파일 한도를 넘으면 보내기 전에 멈춘다', async () => {
  const B = fakeBackend({ maxFile: 5 });
  const api = createNodeData(B.request);
  await assert.rejects(api.put('a.gif', new Uint8Array(6)), { code: 'TOO_LARGE' });
  assert.ok(!B.log.some((l) => l.startsWith('PUT')));
});
