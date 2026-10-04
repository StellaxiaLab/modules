// 조타륜 자원 추가 · 수정 · 삭제 — 본문이 실제 서버의 입력과 맞는지, 화면이 항목을 지어내지 않는지.
//   npm test
// 본문 모양은 서버 코드에서 확인했다: Daemon local API(DisallowUnknownFields) · Master 라우트(decodeJSON — 모르는 키 거절) ·
// io.terra.file 계약(additionalProperties: false). 게이트웨이는 경로 자리({device_id} …)를 채우고 본문에서 뺀다.
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource } = await import('../src/api/source.js');
const { CRUD_TEXT } = await import('../src/api/operations.js');
const { withGui } = await import('../src/api/adapters.js');
const { wireHelm } = await import('../src/api/wire.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return answer(url, init); };
  f.calls = calls;
  return f;
}
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
const ok = () => json(200, { status: 'ok', data: {} });
const LOCAL = 'stack-leaf-01';
function live(answer = ok) {
  const f = fakeFetch(answer);
  return { f, source: new LiveSource(new TerraClient('', { fetch: f }), { localNode: LOCAL, localId: 'node_1' }) };
}
const EXAMPLE = /edge-01|nas-01|tree-home|gpu-0\d|laptop-0\d|build-srv|maru|ci-bot|100\.80\.0|192\.168\.0\.30|예시 데이터/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('폴더 — 추가는 폴더면 mkdir, 파일이면 빈 파일(exclusive). 공유 폴더(맨 위 칸) 자리에는 만들지 않는다', async () => {
  const { f, source } = live();
  await source.crud(LOCAL, 'folder', 'create', { name: 'logs', dir: true }, null, { path: 'share-0/docs' });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body], ['io.terra.file.entries.mkdir', { root: 'share-0', path: 'docs/logs' }]);
  await source.crud(LOCAL, 'folder', 'create', { name: 'a.txt', dir: false }, null, { path: 'share-0' });
  assert.deepEqual([opOf(f.calls[1].url), f.calls[1].body], ['io.terra.file.entries.write', { root: 'share-0', path: 'a.txt', data: '', exclusive: true }]);
  const top = await source.crud(LOCAL, 'folder', 'create', { name: 'x', dir: true }, null, { path: '' });
  assert.deepEqual([top.kind, top.reason], ['unavailable', 'share-root']);
  assert.equal((await source.crud(LOCAL, 'folder', 'create', { name: 'a/b', dir: true }, null, { path: 'share-0' })).reason, 'bad-name');
  assert.equal(f.calls.length, 2);
});

test('폴더 — 이름 바꾸기는 같은 공유 폴더 안의 rename(새 칸 id 를 돌려준다), 지우기는 폴더면 recursive', async () => {
  const { f, source } = live();
  const r = await source.crud(LOCAL, 'folder', 'update', { name: 'new.md' }, { id: 'share-0/docs/old.md', dir: false });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body, r.id], ['io.terra.file.entries.rename', { root: 'share-0', path: 'docs/old.md', to: 'docs/new.md' }, 'share-0/docs/new.md']);
  const d = await source.crud(LOCAL, 'folder', 'del', null, { id: 'share-0/docs', dir: true });
  assert.deepEqual([opOf(f.calls[1].url), f.calls[1].body, d.verb], ['io.terra.file.entries.remove', { root: 'share-0', path: 'docs', recursive: true }, '지움']);
  assert.equal((await source.crud(LOCAL, 'folder', 'del', null, { id: 'share-0', dir: true, root: true })).reason, 'share-root');
  assert.equal((await source.crud(LOCAL, 'folder', 'update', { name: 'x' }, { id: 'share-0', dir: true, root: true })).reason, 'share-root');
});

test('장치 — 고치기는 바뀐 것만 차례로(별명 · 승인 · 켜기). 종류는 못 바꾸고, 승인 대기로 되돌리는 op 는 없다', async () => {
  const { f, source } = live();
  const it = { id: 'camera-1', name: 'cam', kind: 'camera', approval: 'pending', enabled: false };
  const r = await source.crud(LOCAL, 'io', 'update', { name: '현관 카메라', kind: 'camera', approval: 'approved', enabled: true }, it);
  assert.deepEqual(f.calls.map((c) => opOf(c.url)), ['terra.daemon.io.devices.by-device-id.alias.post', 'terra.daemon.io.devices.by-device-id.approve.post', 'terra.daemon.io.devices.by-device-id.enable.post']);
  assert.deepEqual([f.calls[0].body, f.calls[1].body, r.kind], [{ device_id: 'camera-1', alias: '현관 카메라' }, { device_id: 'camera-1' }, 'ok']);
  assert.ok((await source.crud(LOCAL, 'io', 'update', Object.assign({}, it), it)).same, '바뀐 것이 없으면 부르지 않는다');
  assert.equal((await source.crud(LOCAL, 'io', 'update', Object.assign({}, it, { kind: 'mouse' }), it)).reason, 'io-kind');
  assert.equal((await source.crud(LOCAL, 'io', 'update', Object.assign({}, it, { approval: 'pending' }), Object.assign({}, it, { approval: 'approved' }))).reason, 'io-pending');
  assert.equal(f.calls.length, 3);
});

test('장치 — 여러 번 부르다 하나가 실패하면 거기서 멈춘다 · 삭제는 잊기', async () => {
  const { f, source } = live((url) => (opOf(url).endsWith('.alias.post') ? json(400, { error: { code: 'BAD_REQUEST', message: 'x' } }) : ok()));
  const it = { id: 'kbd-1', name: 'k', kind: 'keyboard', approval: 'pending', enabled: false };
  const r = await source.crud(LOCAL, 'io', 'update', { name: 'k2', kind: 'keyboard', approval: 'approved', enabled: false }, it);
  assert.notEqual(r.kind, 'ok');
  assert.equal(f.calls.length, 1);
  const d = await source.crud(LOCAL, 'io', 'del', null, it);
  assert.deepEqual([opOf(f.calls[1].url), f.calls[1].body, d.verb], ['terra.daemon.io.devices.by-device-id.forget.post', { device_id: 'kbd-1' }, '잊음']);
});

test('장치 — 추가는 스캔이다(손으로 등록하는 op 는 없다). 무엇이 바뀌었는지를 글줄로', async () => {
  const { f, source } = live(() => json(200, { status: 'ok', data: { adapter: 'linux', scanned: 4, added: ['a'], updated: [], missing: ['b', 'c'] } }));
  const r = await source.crud(LOCAL, 'io', 'create', { name: 'x', kind: 'keyboard', approval: 'approved', enabled: false });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body, r.say], ['terra.daemon.io.scan.post', {}, '스캔 — 장치 4 · 새 1 · 바뀜 0 · 사라짐 2']);
});

test('작업 — 이 노드는 Daemon 으로 실행 · 취소(취소한 작업은 목록에 남는다). 다른 노드는 Master 명령이고 본문에 node_id 를 싣지 않는다', async () => {
  const { f, source } = live(() => json(202, { status: 'accepted', data: { task_id: 'task-9', type: 'process.execute.request' } }));
  const r = await source.crud(LOCAL, 'job', 'create', { cmd: 'echo  hello world' });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body], ['terra.daemon.commands.execute.post', { command: 'echo', args: ['hello', 'world'] }]);
  assert.deepEqual([r.kind, r.job, r.where], ['accepted', 'task-9', 'L']);
  const c = await source.crud(LOCAL, 'job', 'del', null, { id: 'task-9' });
  assert.deepEqual([opOf(f.calls[1].url), f.calls[1].body, c.keep, c.verb], ['terra.daemon.tasks.by-task-id.cancel.post', { task_id: 'task-9' }, true, '취소']);
  await source.crud('leaf-b', 'job', 'create', { cmd: 'uptime' });
  assert.deepEqual([opOf(f.calls[2].url), f.calls[2].body], ['terra.master.commands.post', { target_node_id: 'leaf-b', type: 'process.execute.request', payload: { command: 'uptime' } }]);
});

test('터널 — 즉석 열기 · 선언은 Master 가 경로를 정한다(두 끝 node_id · 포트 · loopback 로컬 주소). 닫기는 Daemon', async () => {
  const { f, source } = live(() => json(202, { status: 'accepted', data: {} }));
  const nodeIdOf = (n) => ({ 'peer-b': 'node_9' }[n] || null);
  await source.crud(LOCAL, 'tunnel', 'create', { type: 'tun', to: 'peer-b:22', bind: '127.0.0.1:2222' }, null, { nodeIdOf });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body], ['terra.master.service-tunnels.open.post', { source_node_id: 'node_1', target_node_id: 'node_9', target_port: 22, local_bind_host: '127.0.0.1', local_port: 2222 }]);
  await source.crud(LOCAL, 'tunnel', 'create', { type: 'decl', to: 'peer-b:80', bind: '127.0.0.1:8080' }, null, { nodeIdOf });
  assert.equal(opOf(f.calls[1].url), 'terra.master.service-tunnels.declarations.post');
  assert.equal((await source.crud(LOCAL, 'tunnel', 'create', { type: 'tun', to: 'peer-b', bind: '127.0.0.1:1' }, null, { nodeIdOf })).reason, 'tunnel-addr');
  assert.equal((await source.crud(LOCAL, 'tunnel', 'create', { type: 'tun', to: 'nobody:22', bind: '127.0.0.1:1' }, null, { nodeIdOf })).reason, 'unknown-node');
  const r = await source.crud(LOCAL, 'tunnel', 'del', null, { id: 'tun-1', type: 'tun' });
  assert.deepEqual([opOf(f.calls[2].url), f.calls[2].body, r.verb], ['terra.daemon.service-tunnels.by-tunnel-id.close.post', { tunnel_id: 'tun-1' }, '닫음']);
});

test('피어 회수 — 이 노드 → 피어 두 끝을 싣는다(카드 동작도 같다). 공개 키뿐인 피어는 회수하지 못한다', async () => {
  const { f, source } = live();
  await source.crud(LOCAL, 'wg', 'del', null, { id: 'node_7' });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body], ['terra.master.network.mesh.wireguard.peers.revoke.post', { source_node_id: 'node_1', target_node_id: 'node_7' }]);
  await source.act(LOCAL, 'wg', 'node_7', 'revoke', { id: 'node_7' });
  assert.deepEqual(f.calls[1].body, { source_node_id: 'node_1', target_node_id: 'node_7' });
  const key = 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5PQ==';
  assert.equal((await source.crud(LOCAL, 'wg', 'del', null, { id: key })).reason, 'wg-no-node');
  assert.equal((await source.act(LOCAL, 'wg', key, 'revoke', { id: key })).reason, 'wg-no-node');
  assert.equal(f.calls.length, 2);
});

test('허가 · 선언 — Master · Daemon 이 받는 평평한 본문. 선언의 계열 · 이름은 고칠 수 없고, 퇴역한 이름은 reuse_name 으로 다시', async () => {
  const { f, source } = live();
  await source.crud(LOCAL, 'grant', 'create', { who: 'user_2', res: 'svi.n.process.m', ops: 'read · subscribe', ttl: '2시간' });
  assert.deepEqual(f.calls[0].body, { subject_id: 'user_2', resource_id: 'svi.n.process.m', operations: ['read', 'subscribe'], ttl_seconds: 7200 });
  await source.crud(LOCAL, 'decl', 'create', { name: 'probe', fam: 'process', dir: 'source', what: '/usr/bin/probe --stdout -v' });
  assert.deepEqual(f.calls[1].body, { family: 'process', name: 'probe', direction: 'source', command: '/usr/bin/probe', args: ['--stdout', '-v'] });
  const old = { id: 'process/probe', fam: 'process', name: 'probe', dir: 'source', state: 'retired' };
  await source.crud(LOCAL, 'decl', 'update', { name: 'probe', fam: 'process', dir: 'source', what: '/bin/p2' }, old);
  assert.deepEqual(f.calls[2].body, { family: 'process', name: 'probe', direction: 'source', command: '/bin/p2', reuse_name: true });
  await source.crud(LOCAL, 'decl', 'update', { name: 'probe', fam: 'process', dir: 'source', what: '/bin/p3' }, Object.assign({}, old, { state: 'applied' }));
  assert.equal(f.calls[3].body.replace, true);
  assert.equal((await source.crud(LOCAL, 'decl', 'update', { name: 'other', fam: 'process', dir: 'source', what: 'x' }, old)).reason, 'decl-key');
  const r = await source.crud(LOCAL, 'decl', 'del', null, old);
  assert.deepEqual([f.calls[4].body, r.keep, r.verb], [{ family: 'process', name: 'probe' }, true, '철회']);
});

test('Master 호출 — 읽기 · 지우기만 node_id 를 query 로 싣는다(본문이 있는 POST 는 모르는 키를 거절한다)', async () => {
  const { f, source } = live();
  await source.crud(LOCAL, 'grant', 'del', null, { id: 'g-1', type: 'grant' });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body], ['terra.master.svi.grants.by-grant-id.delete', { node_id: 'node_1', grant_id: 'g-1' }]);
  await source.crud(LOCAL, 'grant', 'create', { who: 'u', res: 'r', ops: 'read', ttl: '' });
  assert.equal('node_id' in f.calls[1].body, false);
  await source.list(LOCAL, 'svi');
  assert.equal(f.calls[2].body.node_id, 'node_1');
});

test('전송 — 올리기 · 받기는 아직 없다. 끝난 전송은 화면에서만 치우고, 도는 전송은 포기한다(부분 파일도 지운다)', async () => {
  const { f, source } = live();
  assert.equal((await source.crud(LOCAL, 'xfer', 'create', { name: 'a', dir: 'push', total: 1 })).reason, 'no-transfer');
  const done = await source.crud(LOCAL, 'xfer', 'del', null, { id: 'tr-1', state: 'completed' });
  assert.deepEqual([done.screen, done.verb, f.calls.length], [true, '치움', 0]);
  const r = await source.crud(LOCAL, 'xfer', 'del', null, { id: 'tr-2', state: 'transferring' });
  assert.deepEqual([opOf(f.calls[0].url), f.calls[0].body, r.keep], ['io.terra.file.transfers.abort', { transfer_id: 'tr-2', keep_partial: false }, true]);
});

test('길이 없는 것 — SVI 자원 · 모듈 · 허가 고치기 · 피어 추가는 null(화면이 지어내지 않는다). 이 노드의 게이트웨이에 없는 op 는 부르지 않는다', async () => {
  const { f, source } = live();
  for (const [app, mode] of [['svi', 'create'], ['svi', 'update'], ['svi', 'del'], ['mod', 'create'], ['mod', 'update'], ['mod', 'del'], ['grant', 'update'], ['wg', 'create'], ['job', 'update']]) {
    assert.equal(await source.crud(LOCAL, app, mode, {}, { id: 'x' }), null, app + ' ' + mode);
  }
  source.client.catalog = new Map([['terra.daemon.io.scan.post', {}]]);   // leaf 게이트웨이 — Master op 가 없다
  const r = await source.crud(LOCAL, 'tunnel', 'create', { type: 'tun', to: 'p:22', bind: '127.0.0.1:1' }, null, { nodeIdOf: () => 'node_9' });
  assert.deepEqual([r.kind, r.reason], ['unavailable', 'not-in-catalog']);
  assert.equal(f.calls.length, 0);
});

test('모듈 앱 — 게이트웨이의 설치된 GUI 앱(/api/v1/gui/apps)으로 gui · ui 를 붙인다. 못 읽으면 GUI 가 없다고 단정하지 않는다', async () => {
  const apps = [{ id: 'lab.x.web', moduleId: 'lab.x', name: 'X 앱', route: '/apps/lab.x.web', embed: 'scene', origin: 'http://app-lab--x--web.localhost:28787' }];
  const items = [{ id: 'lab.x', name: 'X', gui: false }, { id: 'io.terra.file', name: 'File', gui: false }];
  const out = withGui(items, apps);
  assert.deepEqual([out[0].gui, out[0].ui, out[0].apps[0].id, out[1].gui], [true, '/apps/lab.x.web', 'lab.x.web', false]);
  assert.equal(withGui(items, null), items);
  const { f, source } = live((url) => (/\/api\/v1\/gui\/apps$/.test(url) ? json(200, { apps, count: 1 }) : json(200, { status: 'ok', data: { modules: [{ id: 'lab.x', name: 'X', state: 'running' }] } })));
  const list = await source.list(LOCAL, 'mod');
  assert.deepEqual([list[0].gui, list[0].ui], [true, '/apps/lab.x.web']);
  assert.ok(f.calls.some((c) => /\/api\/v1\/gui\/apps$/.test(c.url)));
});

// ───── 화면과 함께 (실데이터 층 RealNode + wire.js) ─────

/** 로그인한 것처럼 — 권한 · 클라이언트 · 가짜 서버 목록 */
function signedIn(perms = ['node.read', 'node.control', 'node.config', 'file.read', 'file.write', 'process.execute']) {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = perms;
  s.__client = { has: () => true };
  return s;
}
function fakeServer(local, lists, answer) {
  const calls = [];
  return {
    calls, mock: false, localNode: local,
    async list(node, app) { return (lists[app] || []).slice(); },
    async act() { return { kind: 'ok' }; },
    async crud(node, app, mode, vals, item, ctx) { calls.push({ node, app, mode, vals, item, ctx }); return answer(app, mode, vals, item); }
  };
}
const stop = (s, unwire) => { unwire(); clearInterval(s._hbX); clearTimeout(s._hbT); };

test('wire — 폼 저장은 서버로: 값을 다듬어 보내고, 받으면 폼을 닫고 다시 받는다. 서버에 길이 없으면 지어 넣지 않는다', async () => {
  const s = signedIn(), local = s.state.localNode.name;
  const lists = { folder: [{ id: 'share-0', parent: '', name: 'share-0', dir: true, root: true }] };
  const src = fakeServer(local, lists, (app) => (app === 'decl' ? null : { kind: 'ok', data: {} }));
  const unwire = wireHelm(s, src, { pollMs: 5000 });
  s.setState({ hbPath: 'share-0' });
  s.hbFormOpen('folder', 'add', null, local, 'fs');
  s.hbFormSet('name', '  logs  ');
  s.hbFormSet('dir', true);
  await s.hbFormSave();
  assert.equal(src.calls.length, 1);
  assert.deepEqual([src.calls[0].app, src.calls[0].mode, src.calls[0].vals.name, src.calls[0].vals.dir, src.calls[0].ctx.path], ['folder', 'create', 'logs', true, 'share-0']);
  assert.equal(s.state.hbForm, null);
  await sleep(10);
  assert.ok(!(s.hbItems(local, 'folder') || []).some((x) => x.name === 'logs'), '서버가 돌려준 목록에만 생긴다 — 지어 넣지 않는다');
  // 열쇠 칸(명령)이 비면 부르지 않는다
  s.hbFormOpen('job', 'add', null, local, 'fs');
  await s.hbFormSave();
  assert.match(s.state.hbForm.err, /명령/);
  // 서버에 길이 없으면(null) 폼에 그렇다고 적고 목록은 그대로
  s.hbFormOpen('decl', 'add', null, local, 'fs');
  s.hbFormSet('name', 'probe'); s.hbFormSet('what', '/bin/probe');
  await s.hbFormSave();
  assert.match(s.state.hbForm.err, /길이 없다/);
  assert.equal((s.hbItems(local, 'decl') || []).length, 0);
  assert.equal(src.calls.length, 2);
  stop(s, unwire);
});

test('wire — 고치면 맵에 설치한 자원 · 상태 화면이 새 이름 · 새 칸 id 를 따라간다', async () => {
  const s = signedIn(), local = s.state.localNode.name;
  const lists = { folder: [{ id: 'share-0', parent: '', name: 'share-0', dir: true, root: true }, { id: 'share-0/old.md', parent: 'share-0', name: 'old.md', dir: false }] };
  const src = fakeServer(local, lists, () => ({ kind: 'ok', data: {}, id: 'share-0/new.md' }));
  const unwire = wireHelm(s, src, { pollMs: 5000 });
  s.hbPut(local, 'folder', lists.folder);
  s.setState({ rsrc: { '3-3': { node: local, app: 'folder', id: 'share-0/old.md', name: 'old.md' } }, rst: { kind: 'res', node: local, app: 'folder', id: 'share-0/old.md', name: 'old.md' } });
  s.hbFormOpen('folder', 'edit', 'share-0/old.md', local, 'rst');
  s.hbFormSet('name', 'new.md');
  await s.hbFormSave();
  assert.deepEqual([s.state.rsrc['3-3'].id, s.state.rsrc['3-3'].name], ['share-0/new.md', 'new.md']);
  assert.equal(s.state.rst.id, 'share-0/new.md');
  stop(s, unwire);
});

test('wire — 삭제: 첫 누름은 확인 대기, 두 번째에 서버로. 사라지는 것은 목록 · 맵 자리를 걷고, 상태만 바뀌는 것(작업 취소)은 남긴다', async () => {
  const s = signedIn(), local = s.state.localNode.name;
  const lists = { io: [{ id: 'dev-1', name: 'cam', kind: 'camera', presence: 'present', approval: 'approved', enabled: true }], job: [{ id: 'task-1', cmd: 'x', state: 'running' }] };
  const src = fakeServer(local, lists, (app, mode, v, it) => {
    if (app === 'io') { lists.io = lists.io.filter((x) => x.id !== it.id); return { kind: 'ok', data: {}, verb: '잊음' }; }
    return { kind: 'ok', data: {}, keep: true, verb: '취소' };
  });
  const unwire = wireHelm(s, src, { pollMs: 5000 });
  s.hbPut(local, 'io', lists.io); s.hbPut(local, 'job', lists.job);
  s.setState({ rsrc: { '3-3': { node: local, app: 'io', id: 'dev-1', name: 'cam' } } });
  await s.hbDel('io', 'dev-1', local);
  assert.deepEqual([s.state.hbArm, src.calls.length], ['del:dev-1', 0], '첫 누름은 확인 대기');
  await s.hbDel('io', 'dev-1', local);
  assert.equal(src.calls[0].mode, 'del');
  await sleep(10);
  assert.ok(!s.hbItems(local, 'io').some((x) => x.id === 'dev-1'));
  assert.deepEqual(Object.keys(s.state.rsrc), [], '맵 자리도 걷는다');
  await s.hbDel('job', 'task-1', local);
  await s.hbDel('job', 'task-1', local);
  await sleep(10);
  assert.ok(s.hbItems(local, 'job').some((x) => x.id === 'task-1'), '취소한 작업은 목록에 남는다(상태만 바뀐다)');
  assert.match(s.state.hbMsg.t, /취소/);
  stop(s, unwire);
});

test('wire — 값을 적어야 하는 동작(+ 실행 · + 즉석 열기 · 다시 선언)은 앱 전체 화면의 폼을 연다', () => {
  const s = signedIn(), local = s.state.localNode.name;
  const src = fakeServer(local, {}, () => ({ kind: 'ok' }));
  const unwire = wireHelm(s, src, { pollMs: 5000 });
  s.hbAct('job', null, 'run', local);
  assert.deepEqual([s.state.fs, s.state.hbForm.app, s.state.hbForm.mode], ['hb:job', 'job', 'add']);
  s.hbAct('tunnel', null, 'open', local);
  assert.deepEqual([s.state.fs, s.state.hbForm.app, s.state.hbForm.vals.type], ['hb:tunnel', 'tunnel', 'tun']);
  s.hbPut(local, 'decl', [{ id: 'process/old', fam: 'process', name: 'old', dir: 'source', state: 'retired', what: '퇴역 원장' }]);
  s.hbAct('decl', 'process/old', 'redeclare', local);
  assert.deepEqual([s.state.hbForm.app, s.state.hbForm.mode, s.state.hbForm.id], ['decl', 'edit', 'process/old']);
  assert.equal(src.calls.length, 0);
  stop(s, unwire);
  assert.equal(s.hbFormSave, Object.getPrototypeOf(s).hbFormSave, '끊으면 저장 · 삭제를 실데이터 층의 것으로 되돌린다');
  assert.equal(s.state.hbForm, null);
});

test('실데이터 층 — 서버에 길이 없는 추가 · 수정 · 삭제는 폼 · 확인 대기를 열지 않고 그렇다고 말한다. 연결 전의 저장은 지어내지 않는다', () => {
  const s = signedIn(), local = s.state.localNode.name;
  s.hbFormOpen('svi', 'add', null, local, 'fs');
  assert.equal(s.state.hbForm, null);
  assert.match(s.state.hbMsg.t, /선언에서 생긴다/);
  s.hbFormOpen('xfer', 'add', null, local, 'fs');
  assert.equal(s.state.hbForm, null);
  s.hbPut(local, 'mod', [{ id: 'lab.x', name: 'X', state: 'running', gui: false }]);
  s.hbDel('mod', 'lab.x', local);
  assert.equal(s.state.hbArm, null);
  assert.match(s.state.hbMsg.t, /모듈 제거/);
  s.__client = null;   // 연결 전
  s.hbFormOpen('folder', 'add', null, local, 'fs');
  s.hbFormSet('name', 'x');
  s.hbFormSave();
  assert.match(s.state.hbForm.err, /연결되지 않았다/);
  assert.equal((s.hbItems(local, 'folder') || []).length, 0);
  // 로그인 전 — 화면의 자물쇠 글줄
  const out = new (prep('node', NodeScreen))({ skin: 'grass' });
  out.hbFormOpen('folder', 'add', null, out.state.localNode.name, 'fs');
  assert.equal(out.state.hbForm, null);
  assert.match(out.state.hbMsg.t, /🔒/);
  clearTimeout(s._hbT); clearTimeout(out._hbT);
});

test('실데이터 층 — 폼 · 상태 화면의 API 줄은 이 모듈이 실제로 부르는 것(게이트웨이에 없는 op 는 ⚠), 자리 표시자에 예시 이름이 없다', () => {
  const s = signedIn();
  s.__client = { has: (op) => !op.startsWith('terra.master.') };   // leaf 게이트웨이
  const C = s.HBCRUD();
  assert.equal(C.io.api.edit, CRUD_TEXT.io.edit);
  assert.match(C.grant.api.add, /⚠ 이 노드의 게이트웨이에 없다$/);
  assert.match(C.tunnel.api.del, /⚠ 없음: service-tunnels\.declarations\.by-declaration-id\.delete$/);
  assert.doesNotMatch(C.folder.api.add, /⚠/);
  assert.deepEqual(C.tunnel.fields.map((f) => f.k), ['type', 'to', 'bind']);
  assert.doesNotMatch(JSON.stringify(C, (k, v) => (typeof v === 'function' ? undefined : v)), EXAMPLE);
});

test('실데이터 층 — 모듈 GUI 창은 다른 모듈의 앱을 이 창에 띄운다고 말하지 않는다(frame 은 자기 모듈의 앱만)', () => {
  const s = signedIn(), local = s.state.localNode.name;
  s.hbPut(local, 'mod', [
    { id: 'lab.x', name: 'X', state: 'running', gui: true, ui: '/apps/lab.x.web', apps: [{ id: 'lab.x.web', name: 'X 앱' }] },
    { id: 'lab.stellaxia.node-gui', name: 'Terra 노드', state: 'stopped', kind: 'scene', gui: true, ui: '/apps/lab.stellaxia.node-gui.web', apps: [{ id: 'lab.stellaxia.node-gui.web', name: 'Terra 노드' }] },
    { id: 'io.terra.file', name: 'File', state: 'running', gui: false }
  ]);
  s.mguiOpen(local, 'lab.x');
  const v = s.mguiVals();
  assert.deepEqual([v.runDisp, v.stopDisp, v.url], ['none', 'flex', '/apps/lab.x.web']);
  assert.match(v.stopMsg, /셸의 앱 목록에서 X 앱/);
  s.mguiOpen(local, 'lab.stellaxia.node-gui');
  assert.match(s.mguiVals().stopMsg, /지금 보고 있는 이 화면/);
  assert.equal(s.mguiVals().state, '화면 모듈', 'Scene 모듈은 프로세스가 없다 — 멈춤이 아니다');
  s.mguiOpen(local, 'io.terra.file');
  assert.match(s.mguiVals().stopMsg, /GUI를 제공하지 않는다/);
});

test('실데이터 층 — 상태 화면의 노드 "로그인" 줄은 이 화면의 세션을 적는다(로그인 전을 "로그인됨"으로 그리지 않는다) · 메모 경로는 이 브라우저', () => {
  const login = (s) => (s.rstVals().kv || []).find((r) => r.k === '로그인').v;
  const out = new (prep('node', NodeScreen))({ skin: 'grass' });
  out.rstOpen({ kind: 'node', key: out.state.self });
  assert.equal(login(out), '로그인 전');
  const s = signedIn();
  s.rstOpen({ kind: 'node', key: s.state.self });
  assert.equal(login(s), '로그인됨 — 이 화면의 세션');
  assert.match(s.rstVals().api[0].op, /\/api\/v1\/agent\/whoami/);
  assert.match(s.memoVals().path, /^메모\//);
});
