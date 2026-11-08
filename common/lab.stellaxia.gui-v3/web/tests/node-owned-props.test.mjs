// node --test — 노드의 프로필 · 스킨은 그 노드가 원본이다. 그 노드를 먼저 고치고, 다른 곳은 그 노드에서 읽는다. 끊긴 노드는 표시만 한다.
//   설정 창이 브라우저(localStorage)에만 써서 다른 PC 에 보이지 않던 것 — 그 회귀를 본다.
//   DOM 은 아주 작은 흉내(마크업은 비운다 — 여기서 보는 것은 데이터 층의 순서다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { c.parentNode = this; return c; }, insertBefore(c) { c.parentNode = this; return c; }, removeChild(c) { c.parentNode = null; }, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {} });
globalThis.document = globalThis.document || { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;

const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef, mountBoard } = await import(RT);
const src = (name) => readFileSync(fileURLToPath(new URL('../design/' + name + '.dc.html', import.meta.url)), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'node-owned-'));
const f = join(dir, 'TerraNodes.mjs');
writeFileSync(f, boardModule(src('TerraNodes'), 'TerraNodes', RT));
await import(pathToFileURL(f).href);
const P = 'lab.stellaxia.gui-v3.node-';

/** 노드마다 저장소를 가진 가짜 전송 — 호출 순서를 적고, down 인 노드는 끊김으로 답한다 */
function nodes() {
  const db = {}, calls = [], down = new Set();
  const at = (n) => db[n] || (db[n] = { props: {}, files: {} });
  const t = {
    kind: 'gateway', localId: () => 'desk', calls, down, db,
    async invoke(n, op, input) {
      calls.push([n, op.replace(P, ''), input && input.path]);
      if (down.has(n)) throw { code: 'NODE_OFFLINE', message: 'target node is offline' };
      const N = at(n);
      if (op === P + 'props.get') return { props: { ...N.props } };
      if (op === P + 'props.patch') { for (const k in input.set) { if (input.set[k] === null) delete N.props[k]; else N.props[k] = input.set[k]; } return { props: { ...N.props } }; }
      if (op === P + 'files.put') { const b = (input.offset ? N.files[input.path] || '' : '') + atob(input.data); N.files[input.path] = b; return { received: b.length, total: input.total, done: b.length >= input.total }; }
      if (op === P + 'files.get') { const b = N.files[input.path]; if (b == null) throw { code: 'NOT_FOUND' }; return { size: b.length, mime: 'image/gif', data: btoa(b.slice(input.offset, input.offset + input.limit)) }; }
      if (op === P + 'files.delete') { delete N.files[input.path]; return {}; }
      throw new Error('op ' + op);
    },
  };
  return t;
}
function store(t) { delete window.TerraNodes; window.TerraTransport = t; new (boardDef('TerraNodes').Logic)({}); const T = window.TerraNodes; return T; }
const tick = () => new Promise((r) => setTimeout(r, 5));
const gif = 'data:image/gif;base64,' + btoa('GIF89a-pixels');
const settle = async (fn) => { for (let i = 0; i < 40; i++) { const v = fn(); if (v) return v; await tick(); } return fn(); };

test('프로필 — 그 노드에 파일 → 속성 순으로 쓰고, 다른 PC(새 사본)도 그 노드에서 읽는다', async () => {
  const t = nodes(), T = store(t);
  await T.setProfile('server', { name: 'me.gif', mime: 'image/gif', data: gif });
  assert.deepEqual(t.calls.map((c) => c[1]), ['props.get', 'files.put', 'props.patch']);
  const img = t.db.server.props.profile.image; assert.match(img, /^\/데이터\/profile\/image\/.+-me\.gif$/);
  assert.deepEqual(t.db.desk, undefined, '이 PC 의 노드에는 아무것도 쓰지 않는다');

  mem.clear(); const T2 = store(t);   // 노트북 — 사본 없음
  assert.equal(T2.nodeProps('server').props, null);
  const got = await settle(() => T2.peekProps('server'));
  assert.equal(got.profile.image, img);
  const B = await settle(() => T2.blob('server', img.slice(5)));
  assert.equal(B.url, gif);
});

test('스킨 — 구 파일을 그 노드로 복사하고 속성이 그것을 가리킨다, 지난 파일은 지운다', async () => {
  const t = nodes(), T = store(t), J = JSON.stringify({ type: 'terra.sphere', surface: { frames: [] } });
  await T.setSkin('server', { id: 'mars', text: J });
  const rel = t.db.server.props.skin.file.slice(5); assert.match(rel, /^skin\/mars-.+\.json$/);
  assert.equal(new TextDecoder().decode(Uint8Array.from(t.db.server.files[rel], (c) => c.charCodeAt(0))), J);
  await new Promise((r) => setTimeout(r, 3));
  await T.setSkin('server', { id: 'venus', text: J });
  assert.equal(t.db.server.files[rel], undefined, '지난 구 파일이 남지 않는다');
  await T.setSkin('server', null);
  assert.equal(t.db.server.props.skin, undefined);
  assert.deepEqual(Object.keys(t.db.server.files), []);
});

test('끊긴 노드 — 쓰기를 거부하고 사본은 그대로, 값은 계속 보인다', async () => {
  const t = nodes(), T = store(t);
  await T.setProfile('server', { name: 'a.gif', mime: 'image/gif', data: gif });
  const before = T.peekProps('server');
  t.down.add('server'); t.calls.length = 0;
  await assert.rejects(T.setProfile('server', { name: 'b.gif', mime: 'image/gif', data: gif }), (e) => e.code === 'NODE_OFFLINE');
  assert.deepEqual(t.calls.map((c) => c[1]), ['props.get'], '읽기에서 끊겼으면 파일을 올리지 않는다');
  assert.deepEqual(T.peekProps('server'), before, '실패한 쓰기가 사본을 바꾸지 않는다');
  assert.equal(T.canWrite('server'), false);
  t.calls.length = 0;
  await assert.rejects(T.setSkin('server', { id: 'x', text: '{}' }), (e) => e.code === 'PARTITIONED');
  assert.deepEqual(t.calls, [], '끊긴 줄 알면 노드를 두드리지도, 큐에 쌓지도 않는다');
  assert.equal(T.linkText('server', Date.now()).ro, true);
});

test('큰 파일은 나눠 읽는다 — 다른 노드 응답 상한을 넘지 않게', async () => {
  const t = nodes(), T = store(t), big = 'x'.repeat(1200 * 1024);
  (t.db.server = { props: {}, files: {} }).files['skin/a-1.json'] = big;
  const B = await settle(() => T.blob('server', 'skin/a-1.json'));
  assert.equal(atob(B.url.slice(B.url.indexOf(',') + 1)).length, big.length);
  assert.equal(t.calls.filter((c) => c[1] === 'files.get').length, 3);
});

test('설정 창 — 적용하면 그 노드에 쓰고, 늦게 온 노드 값을 따라가며, 끊기면 바꾸지 못한다', async () => {
  const f2 = join(dir, 'NodeConf.mjs'); writeFileSync(f2, boardModule(src('NodeConf'), 'NodeConf', RT)); await import(pathToFileURL(f2).href); boardDef('NodeConf').compiled = [];
  const t = nodes(); (t.db.server = { props: { profile: { image: '/데이터/profile/image/old.gif' } }, files: { 'profile/image/old.gif': 'GIF89a' } });
  store(t);
  const h = mountBoard('NodeConf', el(), { nodeKey: 'server', nodeName: 's', nodeKind: '리프' });
  try {
    assert.equal(h.logic.V().profile, '');
    await settle(() => window.TerraNodes.peekProps('server'));
    assert.equal(h.logic.V().profile, '/데이터/profile/image/old.gif', '그 노드의 값을 따라간다');
    h.logic._pend = { name: 'new.gif', mime: 'image/gif', data: gif };
    h.logic.set('profile', '(새 파일) new.gif');
    await h.logic.renderVals().apply();
    assert.match(t.db.server.props.profile.image, /new\.gif$/);
    assert.equal(t.db.server.files['profile/image/old.gif'], undefined);
    assert.equal(mem.has('terra.fs'), false, '브라우저에 노드 값을 쓰지 않는다');
    assert.equal(h.logic.V().profile, t.db.server.props.profile.image);
    window.TerraNodes.setLink('server', { state: 'offline', code: 'NODE_OFFLINE', retryAt: Date.now() + 5000 });
    assert.ok(h.logic.locked());
    const cur = h.logic.V().skin; h.logic.set('skin', 'mars');
    assert.equal(h.logic.V().skin, cur, '끊긴 노드의 값은 바꿀 수 없다');
  } finally { h.unmount(); }
});

test('화면은 브라우저 저장소를 노드 값의 원본으로 읽지 않는다', () => {
  for (const b of ['NodeConf', 'Field', 'Scene', 'TerraNodes']) assert.doesNotMatch(src(b), /['"]terra\.(skin|fs)(\.f\.)?['"]/, b);
});

test('계약 — 프로필 · 스킨은 다른 노드에서 부를 수 있고, 앱이 가진 권한으로 닿는다', () => {
  const c = JSON.parse(readFileSync(fileURLToPath(new URL('../../contracts/api/terra-api.json', import.meta.url)), 'utf8'));
  const m = JSON.parse(readFileSync(fileURLToPath(new URL('../../module.json', import.meta.url)), 'utf8'));
  const app = m.contributions.gui.apps[0].permissions;
  for (const op of ['props.get', 'props.patch', 'files.list', 'files.get', 'files.put', 'files.delete']) {
    const o = c.operations[P + op];
    assert.ok(o.availability.scopes.includes('cluster'), op + ': cluster');
    for (const p of o.security.permissions) assert.ok(app.includes(p), op + ': 앱 권한 ' + p);
  }
});
