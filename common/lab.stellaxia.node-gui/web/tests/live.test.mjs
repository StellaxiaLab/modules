// 실데이터 층 — 진짜 응답 모양으로 화면이 서는지, 예시가 다시 새어 나오지 않는지.
//   npm test
// 응답 모양은 실제 스택(Master + Daemon + 게이트웨이 + io.terra.file · io-inventory)에서 받은 것을 줄였다.
import test from 'node:test';
import assert from 'node:assert/strict';

// 화면 클래스는 브라우저 밖에서도 만들어진다 — localStorage 만 흉내 낸다. parent === window 라 frame 밖(단독)으로 본다
const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource, pathInput, appFor } = await import('../src/api/source.js');
const { ADAPT, modState, jobState, xferState, tunnelState } = await import('../src/api/adapters.js');
const { realNode, wgLine } = await import('../src/data/node-live.js');
const { flatten, toWire, realSettings, enrollmentState } = await import('../src/data/settings-live.js');
const { roleOf, tunnelRows, peerRows, realNetwork } = await import('../src/data/network-live.js');
const { realMaterial, realField } = await import('../src/data/editors-live.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return answer(url, init); };
  f.calls = calls;
  return f;
}
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');

/** 예전 예시 데이터에만 있던 이름 · 값 — 화면 어디에도 다시 나오면 안 된다 */
const EXAMPLE = /edge-01|nas-01|tree-home|tree-lab|tree-office|tree-cloud|tree-backup|gpu-0\d|laptop-03|build-srv|bench-pi|MX Master|기계식 키보드|CH340|예전 마우스|오늘 할 일|회의 메모|맵 아이디어|J-2031|T-118|SMB 공유|RTSP 카메라|벤치 대시보드|maru|21:40|minji|ci-bot|claude-agent|node_7f3a|10\.60\.0|203\.0\.113|100\.80\.0|나무 울타리|횃불 \(불꽃\)|예시 데이터|시연/;
const visible = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));

test('op 이름의 by-… 자리만 입력으로 싣는다 — 모듈 · Daemon 은 모르는 키를 거절한다', () => {
  assert.deepEqual(pathInput('terra.daemon.io.devices.by-device-id.approve.post', 'cam-1'), { device_id: 'cam-1' });
  assert.deepEqual(pathInput('terra.daemon.svi.declarations.by-family.by-name.undeclare.post', 'process/p1', { fam: 'process', name: 'p1' }), { family: 'process', name: 'p1' });
  assert.deepEqual(pathInput('terra.daemon.tasks.by-task-id.cancel.post', 'task-1'), { task_id: 'task-1' });
  assert.deepEqual(pathInput('terra.daemon.io.scan.post', null), {});
});

test('로컬 노드의 작업 앱은 Master 가 아니라 Daemon 작업을 본다', () => {
  assert.equal(appFor('job', false).list.op, 'terra.master.jobs.get');
  const A = appFor('job', true);
  assert.equal(A.list.op, 'terra.daemon.tasks.get');
  assert.equal(A.adapt, 'jobLocal');
  assert.equal(A.acts.cancel.op, 'terra.daemon.tasks.by-task-id.cancel.post');
  assert.equal(A.acts.run.form, 'add', '명령은 추가 폼에 적는다 — 실행 단추는 폼을 연다');
  assert.equal(A.acts.rerun.op, 'terra.daemon.tasks.by-task-id.rerun.post', 'Daemon 이 원래 명세로 다시 실행한다(Terra PF-7) — tests/taskout.test.mjs');
  assert.equal(A.acts.out.op, 'terra.daemon.tasks.by-task-id.output.get');
});

test('Daemon 동작은 node_id 를 싣지 않고, 이름 자리만 채운다', async () => {
  const f = fakeFetch(() => json(200, { status: 'ok', data: {} }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'stack-leaf-01', localId: 'node_1' });
  await source.act('stack-leaf-01', 'io', 'camera-default', 'approve', { id: 'camera-default' });
  assert.equal(opOf(f.calls[0].url), 'terra.daemon.io.devices.by-device-id.approve.post');
  assert.deepEqual(f.calls[0].body, { device_id: 'camera-default' });
});

test('Master 목록은 화면 이름이 아니라 진짜 node_id 를 싣는다', async () => {
  const f = fakeFetch(() => json(200, { ok: true, data: { resources: [] } }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'stack-leaf-01', localId: 'node_1' });
  await source.list('stack-leaf-01', 'svi');
  assert.equal(f.calls[0].body.node_id, 'node_1');
});

test('폴더 지우기는 io.terra.file 이 받는 키(root · path · recursive)만 보낸다', async () => {
  const f = fakeFetch(() => json(200, { removed: true }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' });
  await source.act('n', 'folder', 'share-0/docs', 'del', { id: 'share-0/docs', share: 'share-0', rel: 'docs', dir: true });
  assert.equal(opOf(f.calls[0].url), 'io.terra.file.entries.remove');
  assert.deepEqual(f.calls[0].body, { root: 'share-0', path: 'docs', recursive: true });
});

test('폴더 앱은 들어간 경로까지 단계마다 읽는다 — 지금 경로가 목록에 있어야 화면이 그 안을 보인다', async () => {
  const f = fakeFetch((url, init) => {
    const op = opOf(url), body = JSON.parse(init.body);
    if (op === 'terra.daemon.files.list.get') return json(200, { status: 'ok', data: { count: 1, roots: [{ name: 'share-0', path: '/srv/share' }] } });
    if (op === 'io.terra.file.entries.list' && !body.path) return json(200, { entries: [{ path: 'docs', name: 'docs', size: 0, is_dir: true }], count: 1 });
    if (op === 'io.terra.file.entries.list' && body.path === 'docs') return json(200, { entries: [{ path: 'docs/a.md', name: 'a.md', size: 5, is_dir: false }], count: 1 });
    return json(404, {});
  });
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' });
  const list = await source.list('n', 'folder', { path: 'share-0/docs' });
  assert.deepEqual(list.map((x) => [x.id, x.parent]), [['share-0', ''], ['share-0/docs', 'share-0'], ['share-0/docs/a.md', 'share-0/docs']]);
  assert.equal(list[0].root, true);
  assert.equal(list[1].root, undefined, '항목은 공유 폴더 줄(root)이 아니다 — 지우기가 보여야 한다');
});

test('WireGuard 가 꺼져 있으면 피어를 부르지 않는다 — 422 가 와도 오류가 아니라 피어가 없는 것이다', async () => {
  const off = fakeFetch((url) => (opOf(url) === 'terra.daemon.wireguard.status.get' ? json(200, { status: 'ok', data: { enabled: false, interface_name: 'terra0' } }) : json(500, {})));
  assert.deepEqual(await new LiveSource(new TerraClient('', { fetch: off }), { localNode: 'n' }).list('n', 'wg'), []);
  assert.deepEqual(off.calls.map((c) => opOf(c.url)), ['terra.daemon.wireguard.status.get']);
  const rejected = fakeFetch((url) => (opOf(url) === 'terra.daemon.wireguard.status.get' ? json(200, { status: 'ok', data: { enabled: true } }) : json(422, { status: 'error', error: { code: 'LOCAL_API_CONTROL_REJECTED' } })));
  assert.deepEqual(await new LiveSource(new TerraClient('', { fetch: rejected }), { localNode: 'n' }).list('n', 'wg'), []);
});

test('작업 기록은 접수가 아니다 — 상태가 있는 job_id · task_id 응답은 ok 로 읽는다', async () => {
  const { toResult } = await import('../src/api/client.js');
  const rec = await toResult(json(200, { status: 'ok', data: { id: 'task-1', job_id: 'plan-1', state: 'succeeded' } }));
  assert.equal(rec.kind, 'ok');
  const acc = await toResult(json(202, { status: 'accepted', data: { task_id: 'task-2' } }));
  assert.deepEqual(acc, { kind: 'accepted', job: 'task-2', data: { task_id: 'task-2' } });
});

test('API 가 없는 동작은 부르지 않고 이유를 낸다', async () => {
  const f = fakeFetch(() => json(200, {}));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' });
  const r = await source.act('n', 'xfer', null, 'push', null);
  assert.deepEqual(r, { kind: 'unavailable', reason: 'no-upload' });
  assert.equal(f.calls.length, 0);
});

test('상태는 화면의 낱말로 옮긴다 — 표에 없는 값이 오면 렌더 전체가 멈춘다', () => {
  assert.equal(modState('discovered'), 'stopped');
  assert.equal(modState('starting'), 'degraded');
  assert.equal(modState('뭔지 모름'), 'stopped');
  assert.equal(jobState('succeeded'), 'success');
  assert.equal(jobState('dead_letter'), 'failed');
  assert.equal(xferState('prepared'), 'transferring');
  assert.equal(tunnelState('closed'), 'draining');
  const mods = ADAPT.mod({ modules: [{ id: 'lab.stellaxia.node-gui', name: 'Terra 노드', kind: 'scene', state: 'discovered', version: '0.1.0' }] });
  assert.equal(mods[0].state, 'stopped');
  assert.match(mods[0].note, /Scene 모듈/);
  const jobs = ADAPT.jobLocal({ tasks: [{ id: 'task-1', type: 'process.execute.request', state: 'succeeded' }] });
  assert.deepEqual([jobs[0].id, jobs[0].cmd, jobs[0].state], ['task-1', 'process.execute.request', 'success']);
});

test('진짜 응답 필드 — 터널 id · status, 피어 handshake 초, 전송 transfer_id', () => {
  const t = ADAPT.tunnel({ tunnels: [{ id: 'tun-1', service_id: 'svc.ssh', target_node_id: 'n2', target_host: '127.0.0.1', target_port: 22, local_address: '127.0.0.1:2222', status: 'listening', active_sessions: 1, max_connections: 8 }] }, {});
  assert.deepEqual([t[0].id, t[0].state, t[0].conn, t[0].to], ['tun-1', 'listening', '1 / 8', '127.0.0.1:22']);
  const p = ADAPT.wg({ peers: [{ public_key: 'PK', allowed_ips: ['10.0.0.2/32'], seconds_since_handshake: 75 }] });
  assert.deepEqual([p[0].id, p[0].hs, p[0].health], ['PK', '1분 전', 'healthy']);
  const x = ADAPT.xfer({ transfers: [{ transfer_id: 'tr-1', direction: 'pull', path: 'a/b.bin', size_bytes: 2000000, offset: 500000, state: 'transferring' }] });
  assert.deepEqual([x[0].id, x[0].name, x[0].off], ['tr-1', 'b.bin', 0.25]);
  const d = ADAPT.decl({ envelope: { process: 'off', max_declarations: 256 }, declarations: [], retired: [{ family: 'process', name: 'old' }] });
  assert.equal(d.envelope.max_declarations, 256);
  assert.equal(d[0].dir, '—');
});

test('노드 화면 — 로그인 전에는 빈 세계다: 예시 노드 · tree · 알림 · 메모 · 장치가 없다', async () => {
  const { default: Screen } = await import('../src/screens/node.js');
  const s = new (realNode(Screen))({ skin: 'grass' });
  assert.doesNotMatch(visible(s.state), EXAMPLE);
  assert.doesNotMatch(visible(s.renderVals()), EXAMPLE);
  assert.deepEqual(Object.keys(s.NET), ['이 노드']);
  assert.deepEqual([s.state.trees.length, s.state.alarms.length, s.state.memos.length, s.state.io.length, Object.keys(s.state.placed).length], [0, 0, 0, 0, 0]);
  assert.deepEqual(s.hbSeed('이 노드', 'io'), []);
  assert.equal(s.hbPerm('이 노드').role, '로그인 필요');
  assert.equal(s.renderVals().who.name, '로그인 전');
});

test('노드 화면 — 진짜 권한: 이 노드는 토큰의 권한, 모듈 수명 · 작업 취소는 node.control 로 연다. 다른 노드는 노드 주소 호출로 닿을 때만', async () => {
  const { default: Screen } = await import('../src/screens/node.js');
  const s = new (realNode(Screen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  s.__real.principal = 'admin@stack.local';
  const P = s.hbPerm('이 노드');
  assert.equal(P.role, '관리자');
  assert.ok(P.has.includes('module.manage') && P.has.includes('process.cancel'));
  assert.ok(!P.has.includes('file.write'));
  assert.equal(s.hbPerm('다른 노드').role, '닿지 않음');
  assert.equal(s.renderVals().who.name, 'admin@stack.local');
  // 다른 노드 — node_id 를 알고 게이트웨이에 노드 주소 호출(B-1)이 있으면 같은 권한(Master · 대상 Daemon 이 다시 좁힌다)
  s.NET['leaf-b'] = { role: 'Leaf', kids: [], res: [], id: 'node_b' };
  s.NET['tree-x'] = { role: 'Tree', kids: [], res: [], id: null };
  s.__client = { canRelay: () => true, has: () => true, catalog: new Map() };
  const B = s.hbPerm('leaf-b');
  assert.equal(B.role, '관리자 · 중계');
  assert.ok(B.has.includes('module.manage'));
  assert.match(s.hbPerm('tree-x').why, /node_id 를 모른다/);
  s.__client = { canRelay: () => false, has: () => false, catalog: new Map([['x', {}]]) };
  assert.match(s.hbPerm('leaf-b').why, /노드 주소 호출이 없다/);
});

test('노드 화면 — tree 자식이 18을 넘어도 버리지 않는다(바깥 겹, 그래도 넘치면 새 노드 목록)', async () => {
  const { default: Screen } = await import('../src/screens/node.js');
  const s = new (realNode(Screen))({ skin: 'grass' });
  const kids = Array.from({ length: 70 }, (_, i) => 'n' + i);
  s.NET = { t: { role: 'Tree', kids }, ...Object.fromEntries(kids.map((k) => [k, { role: 'Leaf', kids: [] }])) };
  const m = s.defaultMap('t');
  const placed = Object.values(m.nodes).filter((n) => !n.parent).length;
  assert.equal(placed + m.pending.length, 70);
  assert.equal(placed, 60);
});

test('WireGuard 요약 줄은 진짜 인터페이스 · 주소', () => {
  assert.equal(wgLine({ interface_name: 'terra0', enabled: false }, 0), 'terra0 · 꺼짐 · 피어 0');
  assert.equal(wgLine({ interface_name: 'terra0', address_cidr: '10.9.0.2/24', enabled: true }, 3), 'terra0 · 10.9.0.2/24 · 피어 3');
  assert.equal(wgLine(null, 2), '피어 2');
});

test('설정 — config.get 의 중첩 값을 점 키로, 저장은 스키마 타입으로', () => {
  assert.deepEqual(flatten({ daemon: { device_name: 'x', roles: ['leaf', 'gw'] }, wireguard: { enabled: false } }), { 'daemon.device_name': 'x', 'daemon.roles': 'leaf, gw', 'wireguard.enabled': false });
  const objects = new Set();
  assert.deepEqual(flatten({ storage: { shared_dirs: [{ name: 'share-0', path: '/srv/share' }] } }, '', {}, objects), { 'storage.shared_dirs': 'share-0=/srv/share' });
  assert.deepEqual([...objects], ['storage.shared_dirs'], '객체 목록 키는 따로 모아 읽기만으로 둔다');
  assert.equal(toWire('int', '15'), 15);
  assert.equal(toWire('켜기/끄기', true), true);
  assert.deepEqual(toWire('string_list', 'a, b,'), ['a', 'b']);
});

test('보드 — 연결 전에는 예시가 없고 이유만 보인다 (네트워크 · 설정의 모든 묶음 · 탭)', async () => {
  const { default: Net } = await import('../src/screens/network.js');
  const n = new (realNetwork(Net))({});
  n.state.live = false; n.state.why = 'STANDALONE';
  for (const sec of ['mesh', 'route', 'tunnel', 'wg', 'log']) { n.state.sec = sec; assert.doesNotMatch(visible(n.renderVals()), EXAMPLE, sec); }
  assert.doesNotMatch(visible(n.state), EXAMPLE);
  const { default: Set_ } = await import('../src/screens/settings.js');
  const s = new (realSettings(Set_))({});
  s.state.live = false; s.state.why = 'NO_SESSION';
  for (const tab of ['general', 'account', 'node', 'res', 'cluster', 'server']) { s.state.tab = tab; assert.doesNotMatch(visible(s.renderVals()), EXAMPLE, tab); }
  assert.doesNotMatch(visible(s.state), EXAMPLE);
});

test('네트워크 — 역할은 카탈로그로, 터널 · 피어는 진짜 필드로', () => {
  assert.equal(roleOf(new Map([['terra.daemon.node.get', {}]])), 'leaf');
  assert.equal(roleOf(new Map([['terra.master.nodes.get', {}]])), 'tree');
  assert.equal(roleOf(new Map()), null);
  const t = tunnelRows({ tunnels: [{ id: 'tun-1', service_id: 'svc', source_node_id: 'a', target_node_id: 'b', local_address: '127.0.0.1:1', target_host: '127.0.0.1', target_port: 22, status: 'active', bytes_sent: 2048 }] });
  assert.deepEqual([t[0].service, t[0].target, t[0].sent], ['svc', '127.0.0.1:22', '2.0 KB']);
  const p = peerRows({ peers: [{ public_key: 'ABCDEFGHIJKLMNOP', never_seen: true }] });
  assert.equal(p[0].never, true);
});

test('편집기 — 사용자 작품 예시(커스텀 자재 · 전용 부모 디자인)를 뺀다', async () => {
  const { default: Mat } = await import('../src/screens/material.js');
  const m = new (realMaterial(Mat))({});
  assert.ok(!m.state.mats.some((x) => x.kind === 'custom'));
  assert.ok(m.state.mats.length >= 2);
  const { default: Fld } = await import('../src/screens/field.js');
  const f = new (realField(Fld))({});
  assert.ok(!f.state.skins.some((x) => x.parent));
});

test('설정 — 사용자 관리(M-1)는 Master op 라 비어 있고 닿지 않는다고 한다 · 등록 상태(O-6)는 Daemon 값', async () => {
  const { default: Set_ } = await import('../src/screens/settings.js');
  const s = new (realSettings(Set_))({});
  assert.deepEqual(s.state.users, []);
  assert.equal(s.state.usersState, 'error');
  assert.equal(s.state.enrSt.state, 'none');
  const r = await s.userApi('create', { email: 'x@example.com' });
  assert.equal(r.ok, false);
  assert.match(r.msg, /Master operation/);
  assert.deepEqual(s.state.users, [], '예시 동작처럼 화면 안에서만 사용자를 늘리지 않는다');
  // 응답 없음 · 실패 → 말없이 없음
  assert.deepEqual(enrollmentState(null), { state: 'none' });
  assert.deepEqual(enrollmentState({ kind: 'error' }), { state: 'none' });
  // 등록된 기계
  const e = enrollmentState({ kind: 'ok', data: { registered: true, node_id: 'n1', device_id: 'd1', master_url: 'http://m:8080', registered_at: '2026-10-02T14:03:00', credential_ready: true, fleet: { fleet_id: 'f', slot_id: 's' } } });
  assert.deepEqual([e.state, e.registered, e.nodeId, e.deviceId, e.masterUrl, e.credentialReady, e.fleet, e.registeredAt], ['ok', true, 'n1', 'd1', 'http://m:8080', true, 'f · s', '2026-10-02 14:03']);
  assert.equal(enrollmentState({ kind: 'ok', data: { registered: false } }).registered, false);
});
