// 모듈 프로필 — 새 GUI(시작 화면 · 노드 자원 · 연결 · 도로 · LayoutStore)를 Terra 안에서 돌리는 층.
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';

// 브라우저 밖에서 화면 클래스를 만든다 — localStorage 는 메모리로 흉내 낸다. parent === window 라 단독으로 본다
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), _m: m };
}
const mem = memoryStorage();
const win = { localStorage: mem, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;
globalThis.localStorage = mem;

const { prep, boot, REAL } = await import('../src/boot/module.js');
const { reviveMaps, reviveWins, reviveMemos, bindLayout, layoutKey, loadLayout, saveLayout, remapNodes } = await import('../src/store/layout.js');
const { DocStore, newerDoc, pullAssets, watchAssets } = await import('../src/store/docs.js');
const { loadWorld, resetWorld } = await import('../src/data/node-live.js');
const { buildNet } = await import('../src/data/world.js');
const { borrowFrame } = await import('../src/api/frame-boot.js');
const { realIntro, bootIntro } = await import('../src/data/intro-live.js');
const { wireHelm } = await import('../src/api/wire.js');
const { default: NodeScreen } = await import('../src/screens/node.js');
const { default: IntroScreen } = await import('../src/screens/index.js');
const { default: RoadScreen } = await import('../src/screens/road.js');
const { default: BuildingScreen } = await import('../src/screens/building.js');

const EXAMPLE = /edge-01|nas-01|tree-home|tree-lab|gpu-0\d|laptop-03|build-srv|MX Master|오늘 할 일|J-2031|SMB 공유|21:40|100\.80\.0|예시 데이터/;
const visible = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('prep — 노드 · 시작 · 보드 · 자재 · 필드는 예시를 지운 클래스, 건물 · 도로 · 그라운드 편집기는 원본 그대로', () => {
  assert.deepEqual(Object.keys(REAL).sort(), ['field', 'intro', 'material', 'network', 'node', 'settings']);
  const RealNode = prep('node', NodeScreen);
  assert.notEqual(RealNode, NodeScreen);
  assert.ok(RealNode.prototype instanceof NodeScreen);
  const s = new RealNode({ skin: 'grass' });
  assert.doesNotMatch(visible(s.state), EXAMPLE);
  assert.deepEqual([Object.keys(s.state.rsrc).length, s.state.links.length, s.state.place, s.state.conn], [0, 0, null, null]);
  assert.equal(prep('road', RoadScreen), RoadScreen);
  assert.equal(prep('building', BuildingScreen), BuildingScreen);
  assert.equal(boot('road', {}), null);
});

test('공통 보정 — 필드가 하나도 없는 맵에서도 해안선 엔진이 멈추지 않는다', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s._coast = { loops: [] };
  assert.equal(s.coastEngine(), null);
});

test('공통 보정 — leaf 맵의 자기 칸은 노드 칸이다: 도로가 지나가지 못하고, 연결 대상이 되고, 자원을 놓지 못한다', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const self = s.state.self;
  assert.ok(self, 'leaf 맵은 가운데가 자기 칸');
  assert.equal(s.connPass(self), false);
  const other = s.state.fields.find((k) => k !== self);
  assert.equal(s.connPass(other), true);
  assert.equal(s.connTarget(self, { from: other, start: other }), true);
  assert.equal(s.connTarget(self, { from: self, start: self }), false);
  s.state.place = { app: 'io', id: 'x', name: '장치', node: s.state.localNode.name, emoji: '🖱️', type: 'I/O' };
  s.placeAt(self, false, null);
  assert.deepEqual(Object.keys(s.state.rsrc), []);
  assert.match(s.state.placeMsg, /노드가 있는 필드/);
  // 두 번 끼워도 한 겹이다
  const once = NodeScreen.prototype.placeAt;
  prep('node', NodeScreen);
  assert.equal(NodeScreen.prototype.placeAt, once);
});

test('자기 칸 — 상태 창(캡슐)이 뜨고, 자원 → 자기 칸 연결은 공유가 된다. 자기 칸에서 나가는 연결은 다른 맵에서 들어온 자원이 있어야 한다(원본의 규칙)', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const self = s.state.self;
  const other = s.state.fields.find((k) => k !== self && !s.state.nodes[k] && Math.abs(+k.split('-')[0] - +self.split('-')[0]) >= 2);
  s.state.place = { app: 'io', id: 'dev-1', name: '장치', node: s.state.localNode.name, emoji: '🖱️', type: 'I/O' };
  s.placeAt(other, false, null);
  s.setState({ place: null, sel: self });
  const pill = s.renderVals().pill;
  assert.deepEqual([pill.disp, pill.name, pill.logoDisp], ['inline', s.state.localNode.name, 'block'], '자기 칸에도 캡슐이 뜬다');
  // 나가는 연결 — 이 노드로 들어온 자원이 없으면 원본 규칙대로 거절한다
  s.connStart(self, self, 0, 0);
  s.connSet(Object.assign({}, s.state.conn, { over: other }));
  s.connEnd();
  assert.equal((s.state.links || []).length, 0);
  assert.match(s.state.fieldNote, /내보낼 자원이 없다/);
  // 자원 → 자기 칸 — 공유. 길은 자기 칸 위로 깔리지 않는다
  s.connStart(other, other, 0, 0);
  s.connSet(Object.assign({}, s.state.conn, { over: self }));
  assert.equal(s.state.conn.ok, true);
  s.connEnd();
  const L = s.state.links;
  assert.deepEqual([L.length, L[0].from, L[0].to, (L[0].path || []).includes(self)], [1, other, self, false]);
  assert.match(s.state.fieldNote, /공유 목록에 들어갔다/);
});

test('world — Master 가 오프라인으로 본 노드는 auth offline (그 필드의 건물에 정지 이벤트)', () => {
  const { NET } = buildNet({ tree: { name: 't', role: 'Tree' }, nodes: [{ id: 'a', name: 'a', status: 'offline', roles: [] }, { id: 'b', name: 'b', status: 'online', roles: [] }], local: { id: 'b', name: 'b' } });
  assert.equal(NET.a.auth, 'offline');
  assert.equal(NET.b.auth, undefined);
  assert.equal(NET.t.auth, 'saved');
});

test('LayoutStore — 저장된 맵을 지금 노드 관계에 맞춘다: 주인이 사라진 맵은 버리고, 사라진 노드는 칸에서, 칸 없는 자식은 새 노드로', () => {
  const NET = { t: { role: 'Tree', kids: ['a', 'b', 'c'] }, a: { role: 'Leaf', kids: [] }, b: { role: 'Leaf', kids: [] }, c: { role: 'Leaf', kids: [] } };
  const maps = {
    t: { fields: ['4-4', '4-3', '5-3'], nodes: { '4-4': { name: 't', role: 'Tree', parent: true }, '4-3': { name: 'a', role: 'Leaf' }, '5-3': { name: 'gone', role: 'Leaf' } }, pending: [{ name: 'b', role: 'Leaf', at: '09:00' }], rsrc: { '3-3': { app: 'io', id: 'x', node: 'a' } }, links: [{ id: 'l1' }], sel: '4-3' },
    gone: { fields: ['4-4'], nodes: {} },
    broken: 'x'
  };
  const out = reviveMaps(maps, NET, (r) => /Tree/.test(r));
  assert.deepEqual(Object.keys(out), ['t']);
  assert.deepEqual(Object.values(out.t.nodes).map((n) => n.name).sort(), ['a', 't']);
  assert.deepEqual(out.t.pending.map((p) => p.name + '@' + p.at), ['b@09:00', 'c@새로']);
  assert.equal(Object.keys(out.t.rsrc).length, 1);
  assert.equal(out.t.links.length, 1);
  assert.equal(out.t.sel, null);
  const memos = reviveMemos([{ id: 'a.md', name: 'a.md', text: 'x' }, { id: 'd', name: 'd', dir: true, info: '폴더' }, { id: 3 }, null, 'x']);
  assert.deepEqual(memos, [{ id: 'a.md', name: 'a.md', text: 'x', parent: '', info: '' }, { id: 'd', name: 'd', dir: true, info: '폴더', parent: '' }], '다른 판 · 기기의 메모도 화면이 읽는 모양으로');
  const wins = reviveWins({ net: { x: 1, y: 1, w: 300 }, rd: { x: 2, y: 2, w: 400 } }, { net: { x: 50, y: 60 }, old: { x: 0, y: 0 } });
  assert.deepEqual(wins, { net: { x: 50, y: 60, w: 300 }, rd: { x: 2, y: 2, w: 400 } });
});

test('LayoutStore — 묶으면 모아서 저장하고, 끊으면 더는 저장하지 않는다(빈 세계가 저장본을 덮지 않게)', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const key = layoutKey('n-bind', 'u');
  const unbind = bindLayout(s, key);
  s.setState({ memos: [{ id: 'a.md', parent: '', name: 'a.md', text: '1' }] });
  await sleep(900);
  assert.equal(loadLayout(key).memos[0].name, 'a.md');
  unbind();
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'setState'), false, '감싼 setState 를 되돌린다');
  s.setState({ memos: [] });
  await sleep(900);
  assert.equal(loadLayout(key).memos.length, 1);
});

/** loadWorld 가 부르는 것만 답하는 가짜 클라이언트 (실제 스택 응답을 줄인 모양) */
function fakeClient() {
  const answers = {
    'terra.daemon.node.get': { node_id: 'node-1', device_name: 'leaf-a' },
    'terra.daemon.enrollment.status.get': { registered: true, master_url: 'http://127.0.0.1:28080' },
    'terra.daemon.io.devices.get': { devices: [] },
    'terra.daemon.files.list.get': { roots: [] },
    'terra.daemon.modules.get': { modules: [] },
    'terra.daemon.tasks.get': { tasks: [] },
    'io.terra.file.roots.list': { roots: [] },
    'terra.daemon.service-tunnels.get': { tunnels: [] },
    'terra.daemon.wireguard.status.get': { enabled: false },
    'terra.daemon.config.schema.get': { fields: {} }
  };
  return {
    calls: [],
    async invoke(op) { this.calls.push(op); return op in answers ? { kind: 'ok', data: answers[op] } : { kind: 'error', status: 404 }; },
    async get(path) { this.calls.push(path); return path === '/api/v1/agent/nodes' ? { kind: 'ok', data: { nodes: [{ nodeId: 'node-1', displayName: 'leaf-a', status: 'online' }, { nodeId: 'node-2', displayName: 'leaf-b', status: 'offline' }] } } : { kind: 'error', status: 404 }; }
  };
}

test('loadWorld — 노드 · 주체마다 저장한 배치 · 노드 자원 · 연결 · 메모 · 표시 설정을 되살린다. 로그아웃은 저장본을 지우지 않는다', async () => {
  const key = layoutKey('node-1', 'admin@stack.local');
  mem.setItem(key, JSON.stringify({
    maps: {
      'leaf-a': { fields: ['4-4', '3-3', '4-3'], mat: {}, placed: { '4-3': { bid: 'road:stone', rot: 0 } }, nodes: {}, pending: [], self: '4-4', grounds: [], gmat: {}, grot: {}, frot: {}, rsrc: { '3-3': { app: 'io', id: 'dev-1', name: '키보드', node: 'leaf-a', emoji: '⌨️', type: 'I/O 장치', io: null, at: '09:00' } }, links: [{ id: 'k1', from: '3-3', to: '4-4', start: '3-3', path: ['4-3'], road: 'stone' }] },
      'gone-node': { fields: ['4-4'], nodes: {} }
    },
    looks: { 'leaf-a': { skin: 'grass', bid: 'tower', rot: 0 } },
    roadsOn: false, markStyle: 'flat', roadPick: 'rail', ovhHide: true,
    memos: [{ id: '할 일.md', parent: '', name: '할 일.md', text: '- 백업 보기' }],
    wins: { net: { x: 10, y: 20 } }
  }));
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  // 로그인 전에 열어 둔 상태 화면 · 폼 · 모듈 GUI 창 · 그래프 고름은 로그인한 세계로 넘어가지 않는다
  s.setState({ rst: { kind: 'node', key: '4-4' }, hbForm: { app: 'job', node: '이 노드', mode: 'add', vals: {} }, mgui: { node: '이 노드', id: 'x' }, netSel: '이 노드' });
  await loadWorld(s, fakeClient(), { permissions: ['node.read'], principal: 'admin@stack.local' });
  const S = s.state;
  assert.equal(S.map, 'leaf-a');
  assert.deepEqual(Object.keys(S.rsrc), ['3-3']);
  assert.equal(S.links.length, 1);
  assert.equal(S.placed['4-3'].bid, 'road:stone');
  assert.deepEqual([S.roadsOn, S.markStyle, S.roadPick, S.ovhHide], [false, 'flat', 'rail', true]);
  assert.deepEqual([S.rst, S.hbForm, S.mgui, S.netSel], [null, null, null, null]);
  assert.equal(S.memos[0].name, '할 일.md');
  assert.deepEqual([S.wins.net.x, S.wins.net.y], [10, 20]);
  assert.ok(S.wins.rd && S.wins.rcfg, '새 창(도로 편집기 · 자원 설정)은 기본 자리');
  assert.deepEqual(Object.keys(S.maps).sort(), ['leaf-a'], '주인이 사라진 맵은 버린다');
  assert.equal(s.NET['leaf-b'].auth, 'offline');
  assert.equal(s.__real.layoutKey, key);
  assert.match(s.FBMODES().memo.desc, /이 브라우저에만 저장/, 'appId 가 없으면 사용자 문서를 쓰지 않는다');
  assert.equal(s.__real.docs, null);
  // 바꾸면 저장된다
  s.setState({ markStyle: 'none' });
  await sleep(900);
  assert.equal(loadLayout(key).markStyle, 'none');
  assert.deepEqual(loadLayout(key).nodeIds, { 'leaf-a': 'node-1', 'leaf-b': 'node-2' }, '저장본에 이름 → node_id 를 같이 적는다(tree 는 id 가 없다)');
  // 로그아웃 — 빈 세계로 돌아가되 저장본은 그대로
  resetWorld(s);
  assert.deepEqual([Object.keys(s.state.rsrc).length, s.state.links.length, s.state.memos.length], [0, 0, 0]);
  assert.deepEqual([s.state.markStyle, s.state.roadsOn, s.state.roadPick, s.state.ovhHide], ['flag', true, 'stone', false], '앞 사용자의 표시 설정을 남기지 않는다');
  await sleep(900);
  const kept = loadLayout(key);
  assert.equal(kept.markStyle, 'none');
  assert.equal(kept.memos.length, 1);
  assert.deepEqual(Object.keys(kept.maps['leaf-a'].rsrc), ['3-3']);
});

test('loadWorld — 읽는 사이 로그아웃하면 멈춘다: 빈 세계를 다시 채우지 않고 저장도 묶지 않는다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const c = fakeClient();
  const slow = c.invoke.bind(c);
  c.invoke = async (op, input) => { if (op === 'terra.daemon.node.get') { resetWorld(s); } return slow(op, input); };
  await loadWorld(s, c, { permissions: ['node.read'], principal: 'admin@stack.local' });
  assert.equal(s.state.localNode.name, '이 노드');
  assert.equal(s.__real.layoutKey, null);
  assert.ok(!c.calls.includes('/api/v1/agent/nodes'), '멈춘 뒤로는 부르지 않는다');
});

/** 사용자 문서 저장소 흉내 — Master 의 규칙: 없으면 404 · base_revision 이 안 맞거나 있는데 base 없이 쓰면 409 · 없는데 base 없이 쓰면 만든다 */
function docServer() {
  const docs = new Map();
  let rev = 0;
  const keyOf = (path) => path.split('/').slice(6).map(decodeURIComponent).join('/');
  return {
    docs, reqs: [], catalog: new Set(), has: () => false,
    put(key, value) { docs.set(key, { revision: ++rev, value }); },
    async request(method, path, body) {
      this.reqs.push({ method, path, body });
      const key = keyOf(path), cur = docs.get(key);
      if (method === 'GET') return cur ? { kind: 'ok', data: { key, revision: cur.revision, value: cur.value } } : { kind: 'error', status: 404, reason: 'DOCUMENT_NOT_FOUND' };
      const base = body.base_revision;
      if ((base == null && cur) || (base != null && (!cur || cur.revision !== base))) return { kind: 'error', status: 409, reason: 'DOCUMENT_REVISION_CONFLICT' };
      this.put(key, body.value);
      return { kind: 'ok', data: { key, revision: rev } };
    }
  };
}

test('DocStore — 앱 이름공간 경로 · 없음(404)은 써서 만들고 못 쓰는 저장소(501)는 끈다 · 쓰기마다 base_revision · 409면 한 번 알리고 지금 판 위에 다시 쓴다', async () => {
  const srv = docServer();
  const d = new DocStore(srv, 'lab.stellaxia.node-gui.web');
  assert.equal(d.available(), true, '카탈로그를 못 받았으면 해 본다');
  assert.equal(d.path('layout/node 1'), '/api/v1/me/documents/app%3Alab.stellaxia.node-gui.web/layout/node%201');
  assert.equal(await d.read('layout/n1'), null);
  assert.notEqual(d.state, 'off', '없음(404)은 저장소가 있다는 뜻');
  assert.equal(await d.write('layout/n1', { a: 1 }), true);
  const v = srv.docs.get('layout/n1').value;
  assert.deepEqual([v.version, v.data.a, v.savedAt > 0], [1, 1, true]);
  assert.equal(srv.reqs.at(-1).body.base_revision, undefined, '처음 쓰기는 base 없이');
  await d.write('layout/n1', { a: 2 });
  assert.equal(srv.reqs.at(-1).body.base_revision, 1, '다음 쓰기는 받은 revision 을 싣는다');
  // 다른 창 · 기기가 먼저 썼다 → 409 → 한 번 알리고 지금 판 위에 덮는다
  const notes = []; d.onNote = (t) => notes.push(t);
  srv.put('layout/n1', { version: 1, savedAt: 1, data: { a: 'other' } });
  assert.equal(await d.write('layout/n1', { a: 3 }), true);
  assert.equal(srv.docs.get('layout/n1').value.data.a, 3);
  srv.put('layout/n1', { version: 1, savedAt: 1, data: { a: 'other2' } });
  await d.write('layout/n1', { a: 4 });
  assert.equal(srv.docs.get('layout/n1').value.data.a, 4);
  assert.equal(notes.length, 1, '겹침은 한 번만 알린다');
  // 쓰기가 막혔다(할당량 …) — 한 번 알리고 브라우저에만
  const bad = new DocStore({ catalog: new Set(), async request(m) { return m === 'GET' ? { kind: 'error', status: 404 } : { kind: 'error', status: 429, reason: 'DOCUMENT_QUOTA_EXCEEDED' }; } }, 'x');
  const bn = []; bad.onNote = (t) => bn.push(t);
  assert.equal(await bad.write('k', {}), false);
  await bad.write('k', {});
  assert.equal(bn.length, 1);
  assert.match(bn[0], /DOCUMENT_QUOTA_EXCEEDED/);
  // Master 연결이 없는 게이트웨이(501) — 끄고, 더 쓰지 않는다
  const off = new DocStore({ catalog: new Set(), reqs: [], async request(m) { this.reqs.push(m); return { kind: 'unsupported', status: 501, reason: 'MANAGEMENT_UNAVAILABLE' }; } }, 'x');
  assert.equal(await off.read('layout/n1'), null);
  assert.equal(off.state, 'off');
  assert.equal(await off.write('layout/n1', {}), false);
  assert.equal(off.c.reqs.length, 1, '꺼진 저장소에는 쓰지 않는다');
  // 카탈로그에 사용자 문서가 없는 게이트웨이
  assert.equal(new DocStore({ catalog: new Set(['terra.daemon.node.get']), has: () => false }, 'x').available(), false);
});

test('DocStore — 새 쪽이 이긴다(savedAt · _savedAt) · 모아서 쓰고(같은 키는 마지막 것만) · 끊으면 모아 둔 쓰기를 버린다', async () => {
  assert.equal(newerDoc({ _savedAt: 5 }, { savedAt: 9, data: { x: 1 } }).x, 1);
  assert.equal(newerDoc({ _savedAt: 9 }, { savedAt: 5, data: { x: 1 } }), null);
  assert.equal(newerDoc({}, null), null);
  assert.equal(newerDoc({}, { savedAt: 1, data: 'x' }), null);
  const was = DocStore.WAIT; DocStore.WAIT = 30;
  try {
    const srv = docServer(), d = new DocStore(srv, 'a');
    d.later('k', () => ({ n: 1 })); d.later('k', () => ({ n: 2 }));
    await sleep(90);
    assert.equal(srv.reqs.filter((r) => r.method === 'PUT').length, 1);
    assert.equal(srv.docs.get('k').value.data.n, 2);
    d.later('k', () => ({ n: 3 })); d.stop();
    await sleep(90);
    assert.equal(srv.docs.get('k').value.data.n, 2, '끊으면 버린다');
  } finally { DocStore.WAIT = was; }
});

test('DocStore — 편집기 자산: 서버 것이 새로우면 받아 화면에 알리고, 편집기가 내보내면(storage 이벤트) 서버로', async () => {
  const was = DocStore.WAIT; DocStore.WAIT = 30;
  try {
    const ls = memoryStorage(), srv = docServer(), d = new DocStore(srv, 'a');
    srv.put('assets', { version: 1, savedAt: 1000, data: { 'terra.gui.buildings': '[{"id":"b1"}]', 'terra.gui.roads': null } });
    const got = [];
    assert.equal(await pullAssets(d, (k, v) => got.push([k, v]), ls), true);
    assert.deepEqual(got, [['terra.gui.buildings', '[{"id":"b1"}]']]);
    assert.equal(ls.getItem('terra.gui.assetsAt'), '1000');
    assert.equal(await pullAssets(d, () => got.push('again'), ls), false, '같은 것은 다시 받지 않는다');
    // 편집기(다른 문서)가 내보냈다
    const fns = [];
    const w = { addEventListener: (n, f) => fns.push(f), removeEventListener: (n, f) => fns.splice(fns.indexOf(f), 1) };
    const stop = watchAssets(d, w, ls);
    ls.setItem('terra.gui.roads', '[{"id":"r1"}]');
    fns.forEach((f) => f({ key: 'terra.gui.roads' }));
    fns.forEach((f) => f({ key: 'terra.gui.innerHelp' }));
    await sleep(90);
    assert.equal(srv.reqs.filter((r) => r.method === 'PUT').length, 1, '자산이 아닌 키는 보내지 않는다');
    assert.equal(srv.docs.get('assets').value.data['terra.gui.roads'], '[{"id":"r1"}]');
    assert.ok(Number(ls.getItem('terra.gui.assetsAt')) > 1000, '브라우저 쪽 시각을 새로 적는다 — 다음 받기가 덮지 않게');
    stop();
    assert.equal(fns.length, 0);
  } finally { DocStore.WAIT = was; }
});

test('LayoutStore — 바뀐 것이 있을 때만 저장하고 서버로 보낸다(onSave) · 서버 문서를 받아 적을 때는 그 시각으로', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const key = layoutKey('n-onsave', 'u');
  const sent = [];
  const unbind = bindLayout(s, key, win, (d) => sent.push(d));
  s.setState({ hbMsg: null });   // 저장할 것은 그대로다
  await sleep(900);
  assert.equal(loadLayout(key), null, '같은 것은 쓰지 않는다 — _savedAt 만 새로워져 다른 기기의 새 문서를 이기지 않게');
  assert.equal(sent.length, 0);
  s.setState({ markStyle: 'flat' });
  await sleep(900);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].markStyle, 'flat');
  assert.equal(sent[0]._savedAt, undefined, '서버로 가는 것에는 브라우저 시각을 싣지 않는다');
  assert.ok(loadLayout(key)._savedAt > 0);
  unbind();
  saveLayout(key, { markStyle: 'none' }, 1234);
  assert.equal(loadLayout(key)._savedAt, 1234);
});

test('loadWorld — 사용자 문서(서버)가 더 새로우면 그 배치를 쓰고, 브라우저 것이 새로우면 한 번 올린다 · 바꾸면 뒤따라 쓴다 · 저장소가 없으면 브라우저만', async () => {
  const was = DocStore.WAIT; DocStore.WAIT = 60;
  const APP = 'lab.stellaxia.node-gui.web', docKey = 'layout/node-1';
  const withDocs = (srv) => Object.assign(fakeClient(), { request: srv.request.bind(srv), catalog: new Set(), has: () => false });
  try {
    // ① 다른 기기에서 나중에 고친 배치가 서버에 있다
    const key = layoutKey('node-1', 'docs@stack.local');
    mem.setItem(key, JSON.stringify({ markStyle: 'flat', memos: [], _savedAt: 1000 }));
    const srv = docServer();
    srv.put(docKey, { version: 1, savedAt: 2000, data: { markStyle: 'none', memos: [{ id: 'm.md', parent: '', name: 'm.md', text: '서버' }] } });
    const s = new (prep('node', NodeScreen))({ skin: 'grass' });
    await loadWorld(s, withDocs(srv), { permissions: ['node.read'], principal: 'docs@stack.local', appId: APP });
    assert.equal(s.state.markStyle, 'none');
    assert.equal(s.state.memos[0].text, '서버');
    assert.equal(loadLayout(key)._savedAt, 2000, '브라우저 저장본도 서버 시각으로 — 다음엔 다시 올리지 않는다');
    assert.ok(s.__real.docs, '서버 저장소에 묶였다');
    assert.match(s.FBMODES().memo.desc, /사용자 문서/);
    assert.ok(srv.reqs.every((r) => r.path.startsWith('/api/v1/me/documents/app%3A' + APP + '/')), '앱 이름공간만 쓴다');
    await sleep(1000);
    assert.equal(srv.reqs.filter((r) => r.method === 'PUT').length, 0, '받은 것을 다시 올리지 않는다');
    s.setState({ markStyle: 'flag' });   // 바꾸면 브라우저(0.8초) → 서버(모아서)
    await sleep(1000);
    const puts = srv.reqs.filter((r) => r.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].body.base_revision, 1);
    assert.equal(srv.docs.get(docKey).value.data.markStyle, 'flag');
    resetWorld(s);
    assert.equal(s.__real.docs, null, '로그아웃하면 서버 쓰기를 끊는다');

    // ② 이 브라우저에서 더 나중에 고쳤다(서버가 없던 때) — 한 번 올린다
    const key2 = layoutKey('node-1', 'docs2@stack.local');
    mem.setItem(key2, JSON.stringify({ markStyle: 'flat', _savedAt: Date.now() }));
    const srv2 = docServer();
    const s2 = new (prep('node', NodeScreen))({ skin: 'grass' });
    await loadWorld(s2, withDocs(srv2), { permissions: ['node.read'], principal: 'docs2@stack.local', appId: APP });
    assert.equal(s2.state.markStyle, 'flat');
    await sleep(200);
    assert.equal(srv2.docs.get(docKey).value.data.markStyle, 'flat');
    resetWorld(s2);

    // ③ Master 연결이 없는 게이트웨이(501) — 브라우저에만
    const c3 = Object.assign(fakeClient(), { async request() { return { kind: 'unsupported', status: 501 }; }, catalog: new Set(), has: () => false });
    const s3 = new (prep('node', NodeScreen))({ skin: 'grass' });
    await loadWorld(s3, c3, { permissions: ['node.read'], principal: 'docs3@stack.local', appId: APP });
    assert.equal(s3.__real.docs, null);
    assert.match(s3.FBMODES().memo.desc, /이 브라우저에만 저장/);
    resetWorld(s3);
  } finally { DocStore.WAIT = was; }
});

test('frame-boot — 같은 origin 부모가 내놓은 frame 연결을 빌린다(hello 는 한 번만)', () => {
  const p = Promise.resolve('terra');
  assert.equal(borrowFrame({ parent: { __terraFrameReady: p } }), p);
  const self = {}; self.parent = self;
  assert.equal(borrowFrame(self), null);
  assert.equal(borrowFrame({ parent: { __terraFrameReady: 'x' } }), null);
  assert.equal(borrowFrame({ get parent() { throw new Error('cross-origin'); } }), null);
});

/** 시험용 frame — 토큰 · 값 · emit 만 */
function fakeTerra(token, value) {
  const fns = new Set();
  return {
    emitted: [], tok: token, val: value,
    token() { return this.tok; }, value() { return this.val; }, permissions() { return this.tok ? ['node.read', 'node.control'] : []; },
    absence() { return this.tok ? null : 'NO_SESSION'; }, emit(name) { this.emitted.push(name); },
    onToken(fn) { fns.add(fn); return () => fns.delete(fn); }, onValue() { return () => {}; },
    fetch: async () => new Response('{}', { status: 404 }),
    set(t) { this.tok = t; fns.forEach((fn) => fn()); }
  };
}
const stubDoc = () => { const stage = { querySelectorAll: () => [] }; return { getElementById: () => stage, body: stage }; };

test('시작 화면 — 비밀번호를 받지 않는다: Terra 밖이면 둘러보기, 안이면 Terra 로그인 카드를 부른다', () => {
  const I = prep('intro', IntroScreen);
  const s = new I({});
  assert.deepEqual([s.state.username, s.state.phase, s.readAuto()], ['', 'form', null]);
  let v = s.renderVals().v;
  assert.equal(v.goLabel, '둘러보기 (데이터 없음)');
  assert.match(v.gwText, /Terra 밖/);
  assert.doesNotMatch(visible(v), /admin|예시/);
  // frame 안 · 로그인 전
  const t = fakeTerra(null, { state: 'signedOut', principal: '' });
  Object.assign(s.__sess, { role: 'frame', terra: t, why: 'NO_SESSION' });
  v = s.renderVals().v;
  assert.equal(v.goLabel, 'Terra 로그인');
  assert.match(v.whoTitle, /로그인하지 않았다/);
  s.submit();
  assert.deepEqual(t.emitted, ['login']);
  assert.equal(s.state.phase, 'form');
});

test('시작 화면 — 토큰이 있으면 "들어가는 중"을 잠깐 보이고 내려간다. 토큰을 잃으면 판으로 돌아온다', async () => {
  const s = new (realIntro(IntroScreen))({});
  const t = fakeTerra('tsa_x', { state: 'signedIn', principal: 'admin@stack.local' });
  const stop = await bootIntro(s, { role: 'frame', frameReady: Promise.resolve(t), doc: stubDoc(), autoMs: 30 });
  assert.equal(s.state.phase, 'auto');
  assert.match(s.renderVals().v.stTitle, /admin@stack\.local/);
  await sleep(60);
  assert.equal(s.state.phase, 'done');
  stop();
  // 다른 화면 — 들어가는 중에 토큰을 잃으면
  const s2 = new (realIntro(IntroScreen))({});
  const t2 = fakeTerra('tsa_y', { state: 'signedIn', principal: 'u' });
  await bootIntro(s2, { role: 'frame', frameReady: Promise.resolve(t2), doc: stubDoc(), autoMs: 1000 });
  assert.equal(s2.state.phase, 'auto');
  t2.set(null);
  assert.equal(s2.state.phase, 'form');
  assert.equal(s2.renderVals().v.goLabel, 'Terra 로그인');
  clearTimeout(s._flyT); clearTimeout(s2._autoT); s._dead = true;
});

test('wire — 맵에 설치한 노드 자원 · 상태 화면이 보는 자원의 앱은 조타륜에서 열려 있지 않아도 다시 받는다(폴더는 그 칸의 위 칸까지)', async () => {
  const listed = [];
  const source = { mock: false, async list(node, app, ctx) { listed.push(node + '|' + app + '|' + JSON.stringify(ctx.path)); return [{ id: 'dev-1', state: 'ok' }]; }, async act() { return { kind: 'ok' }; } };
  const screen = {
    state: { rsrc: { '3-3': { app: 'io', id: 'dev-1', node: 'leaf-a' }, '5-5': { app: 'folder', id: 'share-0/docs/a.md', node: 'leaf-a' } }, hbPath: 'deep/dir',
      rst: { kind: 'res', node: 'leaf-a', app: 'job', id: 'task-1' }, winOpen: { rst: true } },
    hbSeed() { return []; }, hbAct() {}, hbPerm() { return { has: ['node.read', 'file.read'] }; }, HBAPP() { return { io: { see: 'node.read' }, folder: { see: 'file.read' } }; },
    hbApp() { return null; }, hbNode() { return 'leaf-a'; }, hbItems() { return []; },
    put: [], hbPut(node, app, list) { this.put.push(node + '|' + app + '|' + list.length); }, hbSay() {}, setState(p) { Object.assign(this.state, p); }
  };
  const unwire = wireHelm(screen, source, { pollMs: 5000 });
  await sleep(600);
  unwire();
  assert.deepEqual(listed.sort(), ['leaf-a|folder|["","share-0/docs"]', 'leaf-a|io|"deep/dir"', 'leaf-a|job|"deep/dir"']);
  assert.ok(screen.put.includes('leaf-a|io|1'));
});

test('시작 화면 — 내려가기 시작하면 아래 두 알약(게이트웨이 · 꼬리말)이 누름을 받지 않는다: 그 아래 노드 화면의 누름을 가로채지 않게', async () => {
  const s = new (realIntro(IntroScreen))({});
  assert.equal(s.renderVals().v.chromePe, 'auto');
  s.setState({ fly: true });
  assert.equal(s.renderVals().v.chromePe, 'none');
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(page.split('pointer-events: {{v.chromePe}}').length - 1, 2, 'tools/gen-pages.py 의 index 패치');
});

test('LayoutStore — 노드 이름이 바뀌어도 배치가 따라간다(node_id). 같은 이름을 얻은 다른 노드에게는 넘어가지 않는다 · 예전 저장본은 그대로', async () => {
  const TREE = 'tree · 127.0.0.1:28080';
  const saved = {
    nodeIds: { 'leaf-a': 'node-1', 'leaf-b': 'node-2', 'leaf-c': 'node-9' },
    maps: {
      'leaf-a': { fields: ['4-4', '3-3'], nodes: {}, pending: [], self: '4-4', rsrc: { '3-3': { app: 'io', id: 'dev-1', name: '키보드', node: 'leaf-a' } },
        links: [{ id: 'k1', from: '4-4', to: '3-3', start: '4-4', path: [], sel: [{ key: 'leaf-a|io|dev-1', name: '키보드' }] }] },
      [TREE]: { fields: ['4-4', '3-3', '5-5', '5-4'], nodes: { '3-3': { name: 'leaf-a', role: 'Leaf' }, '5-5': { name: 'leaf-c', role: 'Leaf' }, '5-4': { name: 'leaf-b', role: 'Leaf' } }, pending: [], rsrc: {}, links: [] }
    },
    looks: { 'leaf-a': { skin: 'sand', bid: 'tower', rot: 1 }, 'leaf-c': { skin: 'snow', bid: 'hut', rot: 0 } },
    map: 'leaf-a'
  };
  // 지금: node-1 의 이름이 leaf-a → leaf-a2, node-9(leaf-c)는 사라지고 다른 노드 node-7 이 leaf-c 라는 이름을 얻었다
  const NET = { 'leaf-a2': { id: 'node-1' }, 'leaf-b': { id: 'node-2' }, 'leaf-c': { id: 'node-7' }, [TREE]: { role: 'Tree' } };
  const out = remapNodes(saved, NET);
  assert.deepEqual(Object.keys(out.maps).sort(), ['leaf-a2', TREE].sort());
  assert.equal(out.maps['leaf-a2'].rsrc['3-3'].node, 'leaf-a2');
  assert.equal(out.maps['leaf-a2'].links[0].sel[0].key, 'leaf-a2|io|dev-1');
  assert.deepEqual(out.maps[TREE].nodes, { '3-3': { name: 'leaf-a2', role: 'Leaf' }, '5-4': { name: 'leaf-b', role: 'Leaf' } }, '사라진 node-9 의 칸은 같은 이름의 새 노드에게 넘어가지 않는다');
  assert.deepEqual(Object.keys(out.looks), ['leaf-a2']);
  assert.deepEqual([out.map, out.nodeIds], ['leaf-a2', { 'leaf-a2': 'node-1', 'leaf-b': 'node-2' }]);
  assert.equal(saved.maps['leaf-a'].rsrc['3-3'].node, 'leaf-a', '원본은 건드리지 않는다');
  // 바뀐 것이 없으면 · 예전 저장본(nodeIds 없음)이면 그대로
  const same = { nodeIds: { 'leaf-b': 'node-2' }, maps: {} };
  assert.equal(remapNodes(same, NET), same);
  const old = { maps: { 'leaf-a': { fields: [] } } };
  assert.equal(remapNodes(old, NET), old);
});

test('loadWorld — 이 노드의 이름이 바뀌어도(같은 node_id) 저장한 맵 · 노드 자원 · 연결 · 모습이 되살아난다', async () => {
  const key = layoutKey('node-1', 'renamer');
  mem.setItem(key, JSON.stringify({
    nodeIds: { 'leaf-a': 'node-1', 'leaf-b': 'node-2' },
    maps: { 'leaf-a': { fields: ['4-4', '3-3', '4-3'], mat: {}, placed: {}, nodes: {}, pending: [], self: '4-4', grounds: [], gmat: {}, grot: {}, frot: {},
      rsrc: { '3-3': { app: 'io', id: 'dev-1', name: '키보드', node: 'leaf-a', emoji: '⌨️', type: 'I/O 장치', io: null, at: '09:00' } }, links: [] } },
    looks: { 'leaf-a': { skin: 'sand', bid: 'tower', rot: 0 } }
  }));
  const c = fakeClient();
  const base = c.invoke.bind(c), baseGet = c.get.bind(c);
  c.invoke = async (op, input) => (op === 'terra.daemon.node.get' ? { kind: 'ok', data: { node_id: 'node-1', device_name: 'leaf-a2' } } : base(op, input));
  c.get = async (path) => (path === '/api/v1/agent/nodes' ? { kind: 'ok', data: { nodes: [{ nodeId: 'node-1', displayName: 'leaf-a2', status: 'online' }, { nodeId: 'node-2', displayName: 'leaf-b', status: 'online' }] } } : baseGet(path));
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  await loadWorld(s, c, { permissions: ['node.read'], principal: 'renamer' });
  assert.equal(s.state.map, 'leaf-a2');
  assert.deepEqual(Object.keys(s.state.rsrc), ['3-3']);
  assert.equal(s.state.rsrc['3-3'].node, 'leaf-a2');
  assert.deepEqual(s.state.looks['leaf-a2'], { skin: 'sand', bid: 'tower', rot: 0 });
  resetWorld(s);
});

test('시작 화면 — 다 내려간 뒤 로그아웃하면(토큰을 잃으면) 노드 화면을 걷고 판으로 돌아온다. 다시 토큰이 오면 다시 내려간다', async () => {
  const s = new (realIntro(IntroScreen))({});
  const t = fakeTerra('tsa_z', { state: 'signedIn', principal: 'u' });
  const frame = { style: { opacity: '1', pointerEvents: 'auto', transition: '' } };
  const doc = Object.assign(stubDoc(), { querySelector: (sel) => (sel === '[data-in-map]' ? frame : null) });
  await bootIntro(s, { role: 'frame', frameReady: Promise.resolve(t), doc, autoMs: 1000 });
  clearTimeout(s._autoT);
  s._fly = { done: true, p: 1 };   // 다 내려간 상태
  s.setState({ phase: 'done', fly: true, flyDone: true });
  t.set(null);
  assert.deepEqual([s.state.phase, s.state.fly, s.state.flyDone, s._fly], ['form', false, false, null]);
  assert.deepEqual([frame.style.opacity, frame.style.pointerEvents], ['0', 'none'], '노드 화면을 걷는다 — 누름도 판이 받는다');
  const v = s.renderVals().v;
  assert.deepEqual([v.cardDisp, v.chromeOp, v.chromePe, v.goLabel], ['flex', 1, 'auto', 'Terra 로그인']);
  assert.match(v.msg, /로그아웃했다/);
  t.set('tsa_z2');
  assert.equal(s.state.phase, 'auto', '다시 로그인하면 다시 내려간다');
  clearTimeout(s._autoT); clearTimeout(s._backT); s._dead = true;
});

test('노드 카드 — CPU · 메모리 · 디스크는 받은 값만 그린다. 값이 없으면 지어내지 않고 알려 주지 않는다고 말한다(MD-36)', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const self = s.state.self, name = s.state.localNode.name;
  s.setState({ sel: self });
  let insp = s.renderVals().insp;
  assert.equal(insp.isNode, true);
  assert.deepEqual(insp.meters, [], '값이 없으면 막대가 없다');
  assert.equal(insp.noMeters, true);
  assert.doesNotMatch(visible(insp), /"v":(2[0-9]|4[0-9]|8[0-9])\b.*"k":"(CPU|메모리|디스크)"/);
  // 이름이 다른 노드가 같은 값을 내지 않는다 — 이름 해시로 값을 만들던 길이 없다
  assert.equal(s.nodeMeters({ name: 'a' }), null);
  assert.equal(s.nodeMeters({ name: 'b' }), null);
  // 받은 값이 있으면 그 값 — 반올림 · 0~100 안으로 · 80% 넘으면 경고색
  s.__real = Object.assign({}, s.__real, { meters: { [name]: { cpu: 12.4, mem: 55, disk: 91.6 } } });
  insp = s.renderVals().insp;
  assert.equal(insp.noMeters, false);
  assert.deepEqual(insp.meters.map((m) => [m.k, m.v, m.c]), [['CPU', 12, '#5aa8ff'], ['메모리', 55, '#5aa8ff'], ['디스크', 92, '#f5b83d']]);
  // 일부만 와도 온 것만
  s.__real = Object.assign({}, s.__real, { meters: { [name]: { cpu: 3 } } });
  assert.deepEqual(s.renderVals().insp.meters.map((m) => m.k), ['CPU']);
});

test('창 본문 — 보드가 있는 창(설정 · 편집기)은 전체 화면으로 열게 하고, 보드가 없는 창(모듈 · 사용자)은 없다고 말한다. 깨지는 "보드에서 열기" 링크는 없다(MD-40)', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  const wins = Object.fromEntries(s.renderVals().wins.map((w) => [w.id, w]));
  for (const id of ['set', 'bld', 'rd', 'fld', 'mat']) assert.deepEqual([id, wins[id].hasBoard, wins[id].noBoard], [id, true, false]);
  for (const id of ['mod', 'user']) assert.deepEqual([id, wins[id].hasBoard, wins[id].noBoard], [id, false, true]);
  assert.equal(typeof wins.set.fsToggle, 'function', '전체 화면으로 열기');
});

test('창 요약 — 모듈 창은 화면(scene) 모듈이 실행으로 세어지지 않는 이유를, 사용자 창은 권한이 이 화면이 받은 것임을 말한다', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real = Object.assign({}, s.__real, { perms: ['node.read', 'node.control'], principal: 'admin@x', modules: [{ id: 'a', kind: 'scene', state: 'discovered' }, { id: 'b', kind: 'runtime', state: 'discovered' }, { id: 'c', kind: 'process', state: 'running' }] });
  const wins = Object.fromEntries(s.renderVals().wins.map((w) => [w.id, w]));
  assert.match(wins.mod.sum, /설치 3 · 실행 1 · 실패 0 — 화면\(scene\) 모듈 1개는 프로세스가 없어/);
  assert.match(wins.user.sum, /이 화면이 받은 권한 2개/);
});
