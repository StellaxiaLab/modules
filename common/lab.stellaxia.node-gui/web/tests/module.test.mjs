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
const { reviveMaps, reviveWins, bindLayout, layoutKey, loadLayout } = await import('../src/store/layout.js');
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
  const once = NodeScreen.prototype.connPass;
  prep('node', NodeScreen);
  assert.equal(NodeScreen.prototype.connPass, once);
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
  assert.match(s.FBMODES().memo.desc, /이 브라우저에 저장/);
  // 바꾸면 저장된다
  s.setState({ markStyle: 'none' });
  await sleep(900);
  assert.equal(loadLayout(key).markStyle, 'none');
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
