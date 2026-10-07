// 연결(links)의 입출력 io — 판정 · 쌍 풀기 · 저장 모양 · 화면에 끼우기 (MD-27, docs/data/io-link-svi-binding-design.md §2 · §3 · §5)
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyLink, pairsOf, pairRefs, pairKey, idempotencyKey, pickEndpoint, buildIO, readLinkIO, sanitizeIO, reviveLinks, rebuildLinks, worstPhase, screenLinkCtx, endOf } from '../src/model/link-io.js';
import { reviveMaps } from '../src/store/layout.js';
import { applyFixes } from '../src/boot/fixes.js';

const svi = (id, node = 'pi', extra = {}) => Object.assign({ app: 'svi', id, node, name: id }, extra);
const IDS = { pi: 'node_pi', hub: 'node_hub' };
const ctx = (over = {}) => Object.assign({
  rsrc: { '1-1': svi('svires_cam'), '3-1': svi('svires_rec', 'hub'), '5-1': svi('svires_mic'), '2-4': { app: 'io', id: 'dev1', node: 'pi', name: 'cam dev' } },
  nodes: { '0-0': { name: 'hub' }, '6-6': { name: 'pi' } },
  self: null, map: 'pi', treeId: 'tree-a', nodeIdOf: (n) => IDS[n] || null
}, over);
const L = (id, from, to, extra = {}) => Object.assign({ id, from, to, start: from, path: [], road: 'stone' }, extra);

test('판정 — SVI → SVI 는 바인딩, → 노드는 공유, 노드 → 자원은 바인딩, SVI 아닌 자원은 화면 전용', () => {
  const c = ctx();
  assert.equal(classifyLink(L('a', '1-1', '3-1'), c), 'binding');
  assert.equal(classifyLink(L('b', '1-1', '0-0'), c), 'share');
  assert.equal(classifyLink(L('c', '0-0', '3-1'), c), 'binding');
  assert.equal(classifyLink(L('d', '0-0', '6-6'), c), 'share');
  assert.equal(classifyLink(L('e', '2-4', '3-1'), c), 'screen', 'I/O 장치(SVI 아님)가 출발');
  assert.equal(classifyLink(L('f', '1-1', '2-4'), c), 'screen', 'SVI 아닌 자원이 도착');
  assert.equal(classifyLink(L('g', '1-1', '9-9'), c), 'binding', '도착이 길(합류) 칸이면 바인딩 후보');
  assert.equal(classifyLink(L('h', '2-4', '9-9'), c), 'screen');
  assert.equal(classifyLink(null, c), 'screen');
});

test('leaf 맵의 자기 칸(self)은 노드다', () => {
  const c = ctx({ self: '4-4', nodes: {} });
  assert.deepEqual(endOf(c, '4-4'), { t: 'node', key: '4-4', name: 'pi', node_id: 'node_pi' });
  assert.equal(classifyLink(L('a', '1-1', '4-4'), c), 'share');
});

test('쌍 — 자원 → 자원은 서버 id 로 하나, 엔드포인트를 모르면 빈 채', () => {
  const ps = pairsOf(L('a', '1-1', '3-1'), [], ctx());
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].source, { node_id: 'node_pi', resource_id: 'svires_cam', endpoint_id: '' });
  assert.deepEqual(ps[0].target, { node_id: 'node_hub', resource_id: 'svires_rec', endpoint_id: '' });
  assert.equal(ps[0].key, 'svires_cam#>svires_rec#');
});

test('엔드포인트 — 방향이 맞는 것이 하나뿐일 때만 자동으로 고른다(Q-27)', () => {
  const eps = [{ id: 'e_frames', dir: 'source' }, { id: 'e_ctl', dir: 'sink' }];
  assert.equal(pickEndpoint(eps, 'source'), 'e_frames');
  assert.equal(pickEndpoint(eps, 'target'), 'e_ctl');
  assert.equal(pickEndpoint([{ id: 'a', dir: 'source' }, { id: 'b', dir: 'duplex' }], 'source'), '', '둘이면 사람이 고른다');
  assert.equal(pickEndpoint([{ id: 'a', dir: 'duplex' }], 'target'), 'a');
  assert.equal(pickEndpoint(null, 'source'), '');
  const c = ctx({ endpointsOf: (e) => (e.resource_id === 'svires_cam' ? [{ id: 'e_frames', dir: 'source' }] : [{ id: 'e_in', dir: 'sink' }]) });
  assert.equal(pairsOf(L('a', '1-1', '3-1'), [], c)[0].key, 'svires_cam#e_frames>svires_rec#e_in');
});

test('입력 더하기 — 합류로 들어오는 연결은 그 합류를 지나는 다른 연결의 도착마다 쌍이 된다', () => {
  const c = ctx();
  const main = L('main', '1-1', '3-1', { path: ['2-1', '2-2'] });          // 카메라 → 녹화
  const join = L('join', '5-1', '2-2', { path: ['4-1'] });                 // 마이크 → 합류(2-2)
  const links = [main, join];
  assert.equal(classifyLink(join, c), 'binding');
  assert.deepEqual(pairsOf(join, links, c).map((p) => p.key), ['svires_mic#>svires_rec#']);
  assert.deepEqual(pairsOf(main, links, c).map((p) => p.key), ['svires_cam#>svires_rec#'], '입력 더하기는 서로의 도착이 아니다');
});

test('출력 더하기 — 합류에서 나가는 연결은 from 이 정해져 있어 쌍 하나', () => {
  const c = ctx();
  const main = L('main', '1-1', '3-1', { path: ['2-1', '2-2'] });
  const out = L('out', '1-1', '5-1', { start: '2-2', path: ['2-3'] });     // 카메라가 합류(2-2)에서 마이크 쪽으로도
  assert.deepEqual(pairsOf(out, [main, out], c).map((p) => p.key), ['svires_cam#>svires_mic#']);
});

test('자기 자신으로는 쌍을 만들지 않는다', () => {
  const c = ctx();
  const main = L('main', '1-1', '3-1', { path: ['2-2'] });
  const loop = L('loop', '1-1', '2-2', {});                                // 카메라 → 합류 → (카메라 → 녹화의 도착 = 녹화)
  assert.deepEqual(pairsOf(loop, [main, loop], c).map((p) => p.key), ['svires_cam#>svires_rec#']);
  const back = L('back', '3-1', '2-2', {});                                // 녹화 → 합류 — 도착도 녹화라 자기 자신
  assert.deepEqual(pairsOf(back, [main, back], c), []);
});

test('노드가 출발이면 고른 SVI 자원마다 — 모니터링 자원 · 형식 어긋난 키는 뺀다', () => {
  const c = ctx();
  const l = L('n', '0-0', '3-1', { sel: [{ key: 'hub|svi|svires_x', name: 'x' }, { key: 'hub|io|dev9', name: 'dev' }, { key: '??', name: 'bad' }, null] });
  assert.deepEqual(pairsOf(l, [], c).map((p) => p.key), ['svires_x#>svires_rec#']);
  assert.equal(pairsOf(l, [], c)[0].source.node_id, 'node_hub');
  assert.deepEqual(pairsOf(L('e', '0-0', '3-1', {}), [], c), [], '고른 자원이 없으면 쌍도 없다');
});

test('공유 — 자원 → 노드는 노드 허가 하나, 노드 → 노드는 고른 자원마다 + via', () => {
  const c = ctx();
  const a = pairsOf(L('a', '1-1', '0-0'), [], c);
  assert.deepEqual(a.map((p) => [p.kind, p.key, p.target]), [['share', 'share:svires_cam>node:node_hub', { node_id: 'node_hub' }]]);
  const b = pairsOf(L('b', '6-6', '0-0', { sel: [{ key: 'pi|svi|svires_cam', name: 'cam' }] }), [], c);
  assert.equal(b.length, 1);
  assert.equal(b[0].via_node_id, 'node_pi');
});

test('같은 쌍을 다른 길의 연결 둘이 만들면 참조가 둘이고 바인딩 키는 하나다', () => {
  const c = ctx();
  const a = L('a', '1-1', '3-1', { path: ['2-1'] }), b = L('b', '1-1', '3-1', { path: ['2-3'] });
  const refs = pairRefs([a, b], c);
  assert.deepEqual([...refs.entries()], [['svires_cam#>svires_rec#', ['a', 'b']]]);
});

test('멱등 키 — 같은 tree · 같은 쌍이면 같고, 다르면 다르다', () => {
  const k = idempotencyKey('tree-a', 'x#>y#');
  assert.match(k, /^gui-link-[0-9a-f]{32}$/);
  assert.equal(k, idempotencyKey('tree-a', 'x#>y#'));
  assert.notEqual(k, idempotencyKey('tree-b', 'x#>y#'));
  assert.notEqual(k, idempotencyKey('tree-a', 'x#>z#'));
  assert.equal(k.length, 'gui-link-'.length + 32);
  assert.equal(pairKey({ resource_id: 'a', endpoint_id: 'e' }, { resource_id: 'b', endpoint_id: 'f' }), 'a#e>b#f');
});

test('io 만들기 — 바인딩 · 공유 · 화면 전용의 모양', () => {
  const c = ctx(), links = [L('a', '1-1', '3-1'), L('b', '1-1', '0-0'), L('c', '2-4', '3-1')];
  const [a, b, d] = links.map((l) => buildIO(l, links, c));
  assert.equal(a.v, 1); assert.equal(a.kind, 'binding'); assert.equal(a.phase, 'draft'); assert.equal(a.direction, 'forward');
  assert.equal(a.qos_profile, ''); assert.equal(a.compatibility_policy, 'exact');
  assert.deepEqual(a.source, { node_id: 'node_pi', resource_id: 'svires_cam', endpoint_id: '' });
  assert.equal(a.pairs.length, 1); assert.equal(a.pairs[0].idempotency_key, idempotencyKey('tree-a', a.pairs[0].key));
  assert.equal(b.kind, 'share'); assert.deepEqual(b.share_ops, ['read', 'subscribe', 'bind.source']); assert.equal(b.share_ttl_seconds, 0);
  assert.deepEqual(b.target, { node_id: 'node_hub' });
  assert.equal(b.pairs[0].idempotency_key, undefined, '공유 쌍에는 바인딩 멱등 키가 없다');
  assert.deepEqual(d, { v: 1, kind: 'screen', qos_profile: '', compatibility_policy: 'exact', direction: 'forward', pairs: [] });
});

test('다시 만들어도 사람이 고른 설정 · 서버 id · 상태는 같은 쌍에서 이어받는다', () => {
  const c = ctx(), l = L('a', '1-1', '3-1');
  const first = buildIO(l, [l], c);
  const edited = Object.assign({}, first, { qos_profile: 'reliable_ordered', compatibility_policy: 'compatible', reason: 'x', code: 'SVI_BINDING_DENIED',
    pairs: [Object.assign({}, first.pairs[0], { binding_id: 'svib_1', phase: 'active' })] });
  const again = buildIO(l, [l], c, edited);
  assert.equal(again.qos_profile, 'reliable_ordered'); assert.equal(again.compatibility_policy, 'compatible');
  assert.equal(again.pairs[0].binding_id, 'svib_1'); assert.equal(again.phase, 'active');
  assert.equal(again.code, 'SVI_BINDING_DENIED');
  // 쌍이 바뀌면(도착이 다른 자원) 옛 쌍의 binding_id 는 따라오지 않는다
  const moved = buildIO(L('a', '1-1', '5-1'), [], c, edited);
  assert.equal(moved.pairs[0].binding_id, undefined); assert.equal(moved.pairs[0].phase, 'draft');
});

test('연결 전체 상태는 쌍들 가운데 가장 나쁜 것이다', () => {
  assert.equal(worstPhase(['active', 'failed', 'binding']), 'failed');
  assert.equal(worstPhase(['active', 'draft']), 'draft');
  assert.equal(worstPhase(['active', 'active']), 'active');
  assert.equal(worstPhase([]), 'draft');
  assert.equal(worstPhase(['denied', 'failed']), 'denied');
  assert.equal(worstPhase(['??']), 'draft');
});

test('읽기 — io 가 없거나 어긋나면 화면 전용, 저장본은 바꾸지 않는다', () => {
  const old = L('o', '1-1', '3-1'), snap = JSON.stringify(old);
  assert.equal(readLinkIO(old).kind, 'screen');
  assert.equal(JSON.stringify(old), snap);
  assert.equal(readLinkIO({ io: 'x' }).kind, 'screen');
  assert.equal(readLinkIO({ io: { v: 2, kind: 'binding' } }).kind, 'screen', '다른 판');
  assert.equal(readLinkIO({ io: { v: 1, kind: 'wormhole' } }).kind, 'screen', '모르는 종류');
});

test('다듬기 — 모르는 값은 기본으로, 쌍 · 끝점 모양은 걸러낸다', () => {
  const io = sanitizeIO({ v: 1, kind: 'binding', qos_profile: 'warp', compatibility_policy: 7, phase: 'zzz', checked_at: 5, reason: 'r',
    source: { node_id: 'n', resource_id: 'r', endpoint_id: 3, junk: 1 }, target: 'x',
    pairs: [{ key: 'k', phase: 'active', binding_id: 'b', extra: 1 }, { phase: 'active' }, null, { key: 'k2', phase: 'nope' }] });
  assert.equal(io.qos_profile, ''); assert.equal(io.compatibility_policy, 'exact'); assert.equal(io.phase, 'draft');
  assert.deepEqual(io.source, { node_id: 'n', resource_id: 'r' }); assert.equal(io.target, undefined);
  assert.deepEqual(io.pairs, [{ key: 'k', phase: 'active', binding_id: 'b' }, { key: 'k2', phase: 'draft' }]);
  assert.equal(io.checked_at, undefined); assert.equal(io.reason, 'r');
  const sh = sanitizeIO({ v: 1, kind: 'share', share_ops: ['read', 'fly'], share_ttl_seconds: 90.7 });
  assert.deepEqual(sh.share_ops, ['read']); assert.equal(sh.share_ttl_seconds, 90);
  assert.equal(sanitizeIO(null), null);
});

test('저장본 — io 가 어긋난 연결은 io 만 떼고, 없는 것 · 나머지 필드는 그대로', () => {
  const ok = Object.assign(L('a', '1-1', '3-1'), { io: buildIO(L('a', '1-1', '3-1'), [], ctx()) });
  const links = [L('plain', '1-1', '3-1'), Object.assign(L('bad', '1-1', '3-1'), { io: { v: 9 } }), ok, 'junk', null];
  const out = reviveLinks(links);
  assert.equal(out[0], links[0], 'io 가 없으면 같은 객체');
  assert.equal('io' in out[1], false); assert.equal(out[1].id, 'bad'); assert.equal(out[1].road, 'stone');
  assert.equal(out[2].io.kind, 'binding');
  assert.equal(out[3], 'junk'); assert.equal(out[4], null);
  assert.deepEqual(reviveLinks('x'), []);
});

test('reviveMaps — 저장된 맵의 연결을 다듬는다', () => {
  const NET = { pi: { role: 'Leaf', kids: [] } };
  const maps = { pi: { fields: ['0-0'], nodes: {}, links: [Object.assign(L('bad', '1-1', '3-1'), { io: 'oops' }), L('old', '1-1', '3-1')] } };
  const out = reviveMaps(maps, NET, () => false);
  assert.equal('io' in out.pi.links[0], false);
  assert.equal(out.pi.links.length, 2);
});

test('rebuildLinks — 바뀐 것이 없으면 같은 배열(저장을 일으키지 않는다), only 가 아닌 연결은 그대로', () => {
  const c = ctx(), a = L('a', '1-1', '3-1'), b = L('b', '1-1', '0-0');
  const once = rebuildLinks([a, b], c, (l) => l.id === 'a');
  assert.equal(once[0].io.kind, 'binding'); assert.equal(once[1], b, 'only 밖은 같은 객체');
  assert.equal(rebuildLinks(once, c, (l) => l.id === 'a'), once, '다시 풀어도 같으면 같은 배열');
  assert.equal(rebuildLinks('x', c), 'x');
});

test('screenLinkCtx — 화면 상태 · 관계도 · 조타륜 앱 목록에서', () => {
  const screen = { state: { rsrc: { '1-1': svi('svires_cam') }, nodes: {}, self: null, map: 'pi', curTree: { name: 'tree-a' } }, NET: { pi: { id: 'node_pi' } },
    hbItems: (node, app) => (node === 'pi' && app === 'svi' ? [{ id: 'svires_cam', flow: { eps: [{ id: 'e1', dir: 'source' }] } }, { id: 'other' }] : []) };
  const c = screenLinkCtx(screen);
  assert.equal(c.treeId, 'tree-a'); assert.equal(c.nodeIdOf('pi'), 'node_pi'); assert.equal(c.nodeIdOf('zz'), null);
  assert.deepEqual(c.endpointsOf({ node: 'pi', resource_id: 'svires_cam' }), [{ id: 'e1', dir: 'source' }]);
  assert.equal(c.endpointsOf({ node: 'pi', resource_id: 'other' }), null, 'flow 가 없으면 모른다');
  assert.equal(c.endpointsOf({ node: 'hub', resource_id: 'x' }), null);
});

// ── 화면에 끼우기 — 연결을 놓는 connEnd · 고른 자원을 바꾸는 nodeSelToggle ──
class FakeScreen {
  constructor() { this.state = { links: [], rsrc: { '1-1': svi('svires_cam'), '3-1': svi('svires_rec', 'hub') }, nodes: { '0-0': { name: 'hub' } }, self: null, map: 'pi', curTree: { name: 'tree-a' } }; this.NET = { pi: { id: 'node_pi' }, hub: { id: 'node_hub' } }; this.renders = 0; }
  setState(p) { this.state = Object.assign({}, this.state, p); this.renders++; }
  hbItems() { return []; }
  connEnd() { this.state.pending = null; this.setState({ links: this.state.links.concat([L('n' + this.state.links.length, this.next[0], this.next[1])]) }); }
  nodeSelToggle(id, it) { this.setState({ links: this.state.links.map((l) => (l.id === id ? Object.assign({}, l, { sel: (l.sel || []).concat([it]) }) : l)) }); }
}
applyFixes('node', FakeScreen);

test('화면 — 연결을 놓으면 새 연결에만 io 가 붙고, 예전 연결은 그대로다', () => {
  const s = new FakeScreen();
  s.state.links = [L('old', '1-1', '3-1')];
  s.next = ['1-1', '0-0'];
  s.connEnd();
  assert.equal(s.state.links.length, 2);
  assert.equal('io' in s.state.links[0], false, '예전 연결은 건드리지 않는다');
  assert.equal(s.state.links[1].io.kind, 'share');
  assert.equal(s.state.links[1].io.pairs[0].key, 'share:svires_cam>node:node_hub');
  s.next = ['1-1', '3-1'];
  s.connEnd();
  assert.equal(s.state.links[2].io.kind, 'binding');
  assert.equal(s.state.links[2].io.pairs[0].idempotency_key, idempotencyKey('tree-a', 'svires_cam#>svires_rec#'));
});

test('화면 — 연결이 늘지 않으면(그만둠 · 중복) io 를 더하지 않고 다시 그리지도 않는다', () => {
  const s = new FakeScreen();
  s.connEnd = function () { this.setState({ conn: null }); };   // 그만둔 경우를 흉내
  applyFixes('node', FakeScreen);                                 // 같은 클래스에 두 번 끼우지 않는다
  const before = s.renders;
  s.connEnd();
  assert.equal(s.renders, before + 1);
});

test('화면 — 노드가 내보낼 자원을 고르면 그 연결의 쌍이 바뀐다', () => {
  const s = new FakeScreen();
  s.state.links = [L('x', '0-0', '3-1'), L('y', '1-1', '3-1')];
  s.nodeSelToggle('x', { key: 'hub|svi|svires_x', name: 'x' });
  assert.deepEqual(s.state.links[0].io.pairs.map((p) => p.key), ['svires_x#>svires_rec#']);
  assert.equal('io' in s.state.links[1], false, '다른 연결은 그대로');
});

test('도로 이벤트 — linkEv 는 연결 상태를 이벤트로, 화면 전용은 null · 화면 스크립트가 그것을 본다(UP-26 · MD-31)', async () => {
  const s = new FakeScreen();
  const ev = (io) => s.linkEv({ id: 'x', io });
  assert.equal(s.linkEv(L('old', '1-1', '3-1')), null, '예전 연결(io 없음)은 그대로');
  assert.equal(ev({ v: 1, kind: 'screen', pairs: [] }), null);
  assert.equal(ev({ v: 1, kind: 'binding', phase: 'draft', pairs: [] }), 'wait');
  assert.equal(ev({ v: 1, kind: 'binding', phase: 'active', pairs: [] }), 'run');
  assert.equal(ev({ v: 1, kind: 'binding', phase: 'failed', pairs: [] }), 'fail');
  assert.equal(ev({ v: 1, kind: 'binding', phase: 'denied', pairs: [] }), 'fail');
  assert.equal(ev({ v: 1, kind: 'share', phase: 'share-expired', pairs: [] }), 'stop');
  assert.equal(ev({ v: 9, kind: 'binding', phase: 'failed' }), null, '어긋난 io 는 화면 전용으로 읽는다');
  // 생성된 화면 스크립트가 도로 이벤트에서 연결 상태를 본다 — gen-pages MODULE_JS 가 한 곳만 바꾼다
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/screens/node.js', import.meta.url), 'utf8');
  assert.equal(src.split('this.linkEv(l)').length - 1, 1);
  assert.match(src, /\[l\.from, l\.to, l\]\.forEach\(\(q\) => \{ const x = q === l \?/);
});
