// 연결 상태 맞추기 · 끊기 (MD-29 · MD-30) — 서버의 바인딩 · 허가 → links[].io 상태, 연결이 사라지면 바인딩 닫기 · orphans · 이유 글
//   Master 계약 모양의 가짜 클라이언트. npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { syncLinks, closeBindings, orphanedBindings, reviveOrphans, OBSERVED_PHASE, SYNC_OPS } from '../src/api/link-sync.js';
import { wireLinkApply } from '../src/api/link-wire.js';
import { reasonLine, phaseLabel, phaseEvent } from '../src/model/link-text.js';
import { reviveMaps, pickLayout } from '../src/store/layout.js';
import { emptyWorld } from '../src/data/node-live.js';

const ok = (data) => ({ kind: 'ok', data });
const bl = (id, from, to, io) => ({ id, from, to, start: from, path: [], road: 'stone', io });
const bindIO = (...pairs) => ({ v: 1, kind: 'binding', qos_profile: '', compatibility_policy: 'exact', direction: 'forward', phase: 'binding', pairs: pairs.map((p) => Object.assign({ phase: 'binding' }, p)) });
const shareIO = (...pairs) => ({ v: 1, kind: 'share', qos_profile: '', compatibility_policy: 'exact', direction: 'forward', phase: 'shared', pairs: pairs.map((p) => Object.assign({ phase: 'shared' }, p)) });
const fake = (handlers = {}, catalog = null) => { const calls = []; return { calls, has: (op) => !catalog || catalog.indexOf(op) >= 0,
  async invoke(op, input) { calls.push({ op, input }); const h = handlers[op]; return !h ? { kind: 'error', status: 404, reason: 'NO_HANDLER' } : typeof h === 'function' ? h(input) : h; } }; };
const NOW = Date.parse('2026-10-07T00:00:00Z');

test('상태 — Master observed_state 를 연결 상태로 옮긴다', () => {
  assert.equal(OBSERVED_PHASE.active, 'active'); assert.equal(OBSERVED_PHASE.requested, 'binding'); assert.equal(OBSERVED_PHASE.preparing, 'binding');
  assert.equal(OBSERVED_PHASE.degraded, 'degraded'); assert.equal(OBSERVED_PHASE.failed, 'failed'); assert.equal(OBSERVED_PHASE.closed, 'closed');
  assert.equal(OBSERVED_PHASE.closing, 'binding'); assert.equal(OBSERVED_PHASE.bogus, undefined);
});

test('맞추기 — 목록에서 읽어 상태 · 이유 · 형식을 맞춘다. 바뀐 연결만 새 객체', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k1', binding_id: 'b1' })), b = bl('b', '1', '3', bindIO({ key: 'k2', binding_id: 'b2', phase: 'active' })), c = bl('c', '1', '4', undefined);
  const cl = fake({ [SYNC_OPS.bindingsGet]: ok({ items: [{ binding_id: 'b1', observed_state: 'active', schema_ref: 'terra.image.frame@1' }, { binding_id: 'b2', observed_state: 'active' }] }) });
  const r = await syncLinks(cl, [a, b, c], { now: () => NOW });
  assert.equal(r.changed, true);
  assert.equal(r.links[0].io.pairs[0].phase, 'active'); assert.equal(r.links[0].io.phase, 'active'); assert.equal(r.links[0].io.schema_ref, 'terra.image.frame@1');
  assert.equal(r.links[0].io.checked_at, '2026-10-07T00:00:00.000Z');
  assert.equal(r.links[1], b, '바뀐 것 없으면 같은 객체'); assert.equal(r.links[2], c);
  assert.equal(cl.calls.length, 1, '목록 한 번');
  // 다시 맞춰도 바뀐 것이 없으면 같은 배열 — 저장을 일으키지 않는다
  const again = await syncLinks(cl, r.links, { now: () => NOW });
  assert.equal(again.changed, false); assert.equal(again.links, r.links);
});

test('맞추기 — 실패 · 저하 · 닫힘은 이유와 함께, 되살아나면 이유를 지운다', async () => {
  const l = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  const mk = (state, reason) => fake({ [SYNC_OPS.bindingsGet]: ok({ items: [{ binding_id: 'b1', observed_state: state, reason }] }) });
  const f = await syncLinks(mk('failed', 'target_prepare_failed: boom'), [l], { now: () => NOW });
  assert.equal(f.links[0].io.phase, 'failed'); assert.equal(f.links[0].io.pairs[0].reason, 'target_prepare_failed: boom'); assert.equal(f.links[0].io.reason, 'target_prepare_failed: boom');
  const d = await syncLinks(mk('degraded', 'participant_disconnected'), f.links, { now: () => NOW });
  assert.equal(d.links[0].io.phase, 'degraded');
  const c = await syncLinks(mk('closed', 'grant_revoked'), d.links, { now: () => NOW });
  assert.equal(c.links[0].io.phase, 'closed'); assert.equal(c.links[0].io.reason, 'grant_revoked');
  const back = await syncLinks(mk('active', ''), c.links, { now: () => NOW });
  assert.equal(back.links[0].io.phase, 'active'); assert.equal(back.links[0].io.pairs[0].reason, undefined); assert.equal(back.links[0].io.reason, undefined);
});

test('맞추기 — 목록에 없으면 하나씩 확인하고 404 일 때만 lost(관리자 · 남이 만든 것은 목록에 없을 수 있다)', async () => {
  const l = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' })), m = bl('m', '1', '3', bindIO({ key: 'k2', binding_id: 'b2' }));
  const cl = fake({ [SYNC_OPS.bindingsGet]: ok({ items: [] }),
    [SYNC_OPS.bindingGet]: (i) => (i.binding_id === 'b1' ? { kind: 'error', status: 404, reason: 'SVI_BINDING_NOT_FOUND', data: {} } : ok({ binding: { binding_id: 'b2', observed_state: 'active' } })) });
  const r = await syncLinks(cl, [l, m], { now: () => NOW });
  assert.equal(r.links[0].io.phase, 'lost'); assert.equal(r.links[0].io.pairs[0].reason, 'binding_not_found');
  assert.equal(r.links[1].io.phase, 'active', '목록에 없어도 따로 읽히면 그 값');
});

test('맞추기 — 서버에 닿지 않으면(카탈로그에 없음 · 401 · 503) 아무것도 바꾸지 않는다 — lost 로 오해하지 않는다', async () => {
  const l = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1', phase: 'active' }));
  const none = await syncLinks(fake({}, ['x']), [l]);
  assert.equal(none.unavailable, 'not-in-catalog'); assert.equal(none.links[0], l);
  for (const kind of ['unauthenticated', 'down']) {
    const r = await syncLinks(fake({ [SYNC_OPS.bindingsGet]: { kind, status: 0, data: {} } }), [l]);
    assert.equal(r.unavailable, kind); assert.equal(r.changed, false); assert.equal(r.links[0].io.phase, 'binding');
  }
  const mid = await syncLinks(fake({ [SYNC_OPS.bindingsGet]: ok({ items: [] }), [SYNC_OPS.bindingGet]: { kind: 'down', data: {} } }), [l]);
  assert.equal(mid.unavailable, 'down'); assert.equal(mid.links[0], l);
  assert.deepEqual(await syncLinks(fake({}), []), { links: [], changed: false });
});

test('맞추기 — 공유: 허가가 살아 있으면 shared · 기한이 지나면 share-expired · 철회됐으면 closed', async () => {
  const mk = (grants) => fake({ [SYNC_OPS.grantsGet]: ok({ items: grants }) });
  const l = bl('s', '1', '2', shareIO({ key: 'share:r1>node:n2', grant_id: 'g1' }));
  const live = await syncLinks(mk([{ grant_id: 'g1', expires_at: '2026-10-08T00:00:00Z' }]), [l], { now: () => NOW });
  assert.equal(live.changed, false, '살아 있으면 그대로');
  const exp = await syncLinks(mk([{ grant_id: 'g1', expires_at: '2026-10-06T00:00:00Z' }]), [l], { now: () => NOW });
  assert.equal(exp.links[0].io.phase, 'share-expired');
  const gone = await syncLinks(mk([]), [l], { now: () => NOW });
  assert.equal(gone.links[0].io.phase, 'closed'); assert.equal(gone.links[0].io.reason, 'grant_revoked');
  const cl = mk([{ grant_id: 'g1' }]); await syncLinks(cl, [l], { now: () => NOW });
  assert.deepEqual(cl.calls[0].input, { resource_id: 'r1', subject_type: 'node', limit: 200 }, '기한이 지난 것도 보려고 active 를 걸지 않는다');
  const back = await syncLinks(mk([{ grant_id: 'g1' }]), exp.links, { now: () => NOW });
  assert.equal(back.links[0].io.phase, 'shared', '다시 살아나면 돌아온다');
});

test('끊기 — 이미 없는 바인딩(404)은 닫힌 것, 닿지 않은 것은 실패로 남긴다', async () => {
  const cl = fake({ [SYNC_OPS.bindingDelete]: (i) => ({ b1: ok({}), b2: { kind: 'error', status: 404, reason: 'SVI_BINDING_NOT_FOUND', data: {} }, b3: { kind: 'down', status: 503, reason: 'SVI_UNAVAILABLE', data: {} } }[i.binding_id]) });
  const r = await closeBindings(cl, ['b1', 'b2', 'b3', 'b1', '']);
  assert.deepEqual(r.closed, ['b1', 'b2']); assert.deepEqual(r.failed, [{ binding_id: 'b3', code: 'SVI_UNAVAILABLE' }]);
  assert.deepEqual(cl.calls.map((c) => c.input), [{ binding_id: 'b1' }, { binding_id: 'b2' }, { binding_id: 'b3' }], '본문 없이 경로 id 만');
  assert.equal((await closeBindings(fake({}, []), ['x'])).failed[0].code, 'not-in-catalog');
});

test('끊기 — 같은 바인딩을 쓰는 연결이 남아 있으면(이 맵 · 다른 맵) 닫지 않는다', () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }, { key: 'k2', binding_id: 'b2' })), keep = bl('k', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  assert.deepEqual(orphanedBindings([a], [[], []]), ['b1', 'b2']);
  assert.deepEqual(orphanedBindings([a], [[keep]]), ['b2'], '이 맵의 다른 연결이 b1 을 쓴다');
  assert.deepEqual(orphanedBindings([a], [[], [keep]]), ['b2'], '다른 맵의 연결이 b1 을 쓴다');
  assert.deepEqual(orphanedBindings([bl('s', '1', '2', shareIO({ key: 'share:r>node:n', grant_id: 'g' })), bl('p', '1', '2', undefined), null], [[]]), [], '공유 · 화면 전용은 닫을 바인딩이 없다');
  assert.deepEqual(reviveOrphans([{ binding_id: 'b', code: 5 }, { x: 1 }, null, { binding_id: '' }]), [{ binding_id: 'b', code: '', at: '' }]);
  assert.deepEqual(reviveOrphans('x'), []);
});

// ── 화면에 잇기 ──
class Screen {
  constructor(links, extra = {}) { this.state = Object.assign({ links, maps: {}, map: 'pi', rsrc: {}, nodes: {}, linkOrphans: [] }, extra); this.said = []; this.NET = {}; }
  setState(p) { this.state = Object.assign({}, this.state, p); }
  hbSay(t, c) { this.said.push([t, c]); }
  hbItems() { return []; }
}
const wire = (s, client, extra) => wireLinkApply(s, { client, principal: 'u' }, Object.assign({ firstMs: 1e9, intervalMs: 1e9 }, extra));
const tick = () => new Promise((r) => setTimeout(r, 5));

test('화면 — 연결이 사라지면 더 이상 쓰는 연결이 없는 바인딩만 닫는다', async () => {
  const keep = bl('keep', '1', '2', bindIO({ key: 'k', binding_id: 'b1' })), gone = bl('gone', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }, { key: 'k2', binding_id: 'b2' }));
  const s = new Screen([keep, gone]), cl = fake({ [SYNC_OPS.bindingDelete]: ok({}) }), off = wire(s, cl);
  s.setState({ links: [keep], fieldNote: '끊었다' });
  await tick();
  assert.deepEqual(cl.calls.map((c) => c.input.binding_id), ['b2'], 'b1 은 남은 연결이 쓴다');
  assert.match(s.said.at(-1)[0], /닫았다/);
  assert.deepEqual(s.state.linkOrphans, []);
  off();
});

test('화면 — 맵 이동 · 세계 교체(map · maps 가 같이 온다)로 연결이 사라져 보여도 닫지 않는다', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  const s = new Screen([a]), cl = fake({ [SYNC_OPS.bindingDelete]: ok({}) }), off = wire(s, cl);
  s.setState({ map: 'hub', links: [] });
  s.setState({ maps: {}, links: [bl('z', '1', '2')] });
  s.setState({ links: [bl('z', '1', '2')], fieldNote: 'x', map: 'pi' });
  await tick();
  assert.equal(cl.calls.length, 0);
  off();
});

test('화면 — 닫지 못하면 orphans 에 남기고 다음 맞추기에서 다시 닫는다', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  let up = false;
  const cl = fake({ [SYNC_OPS.bindingDelete]: () => (up ? ok({}) : { kind: 'down', status: 503, reason: 'SVI_UNAVAILABLE', data: {} }), [SYNC_OPS.bindingsGet]: ok({ items: [] }) });
  const s = new Screen([a]), off = wire(s, cl, { now: () => NOW });
  s.setState({ links: [] });
  await tick();
  assert.deepEqual(s.state.linkOrphans, [{ binding_id: 'b1', code: 'SVI_UNAVAILABLE', at: '2026-10-07T00:00:00.000Z' }]);
  assert.match(s.said.at(-1)[0], /닫지 못했다/);
  up = true;
  await s.linkSync();
  assert.deepEqual(s.state.linkOrphans, []);
  assert.equal(cl.calls.filter((c) => c.op === SYNC_OPS.bindingDelete).length, 2);
  off();
});

test('화면 — linkSync 는 읽는 사이 바뀐 연결을 덮어쓰지 않고, 동시에 둘 돌지 않는다', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  let release;
  const cl = fake({ [SYNC_OPS.bindingsGet]: () => new Promise((r) => { release = () => r(ok({ items: [{ binding_id: 'b1', observed_state: 'active' }] })); }) });
  const s = new Screen([a]), off = wire(s, cl);
  const p = s.linkSync(), q = s.linkSync();
  assert.equal(await q, null, '이미 돌고 있다');
  s.setState({ links: s.state.links.map((l) => Object.assign({}, l, { road: 'dirt' })) });   // 읽는 사이 사람이 길 종류를 바꿨다
  release();
  await p;
  assert.equal(s.state.links[0].road, 'dirt', '다른 필드는 지키고');
  assert.equal(s.state.links[0].io.phase, 'active', 'io 만 새로');
  off();
});

test('화면 — 신호(_hbRefresh)가 오면 맞춘다 · 걷으면 되돌린다', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  const s = new Screen([a]), seen = []; s._hbRefresh = (apps, node) => seen.push([apps, node]);
  const cl = fake({ [SYNC_OPS.bindingsGet]: ok({ items: [{ binding_id: 'b1', observed_state: 'failed', reason: 'flow_not_allowed: x' }] }) });
  const orig = s._hbRefresh, off = wire(s, cl);
  s._hbRefresh(['grant', 'svi'], 'pi');
  s._hbRefresh(['mod'], 'pi');
  assert.equal(seen.length, 2, '원래 다시 받기도 그대로 돈다');
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(s.state.links[0].io.phase, 'failed');
  assert.match(s.said.at(-1)[0], /흐름 허용 목록/);
  off();
  assert.equal(s._hbRefresh, orig); assert.equal(s.linkSync, undefined);
});

test('화면 — 걷은 뒤에는 연결이 사라져도 닫지 않고, 저장 층이 먼저 setState 를 되돌렸으면 되살리지 않는다', async () => {
  const a = bl('a', '1', '2', bindIO({ key: 'k', binding_id: 'b1' }));
  const s = new Screen([a]), cl = fake({ [SYNC_OPS.bindingDelete]: ok({}) }), proto = s.setState;
  const off = wire(s, cl);
  assert.notEqual(s.setState, proto);
  off();
  s.setState({ links: [] }); await tick();
  assert.equal(cl.calls.length, 0);
  // 다른 층(bindLayout)이 먼저 자기 것으로 되돌렸다 — 우리 걷기가 그것을 덮지 않는다
  const s2 = new Screen([a]); wire(s2, cl);
  const theirs = function (p) { Screen.prototype.setState.call(this, p); };
  s2.setState = theirs;
  const off2 = wireLinkApply(s2, { client: cl }, { firstMs: 1e9, intervalMs: 1e9 });
  off2();
  assert.notEqual(s2.setState, undefined);
});

test('저장 — linkOrphans 는 저장본에 들어가고, 로그아웃(emptyWorld)은 비운다', () => {
  const screen = { state: { linkOrphans: [{ binding_id: 'b1', code: 'x', at: '' }], map: 'pi', maps: {}, looks: {} }, snapshotMap() { return {}; }, NET: {} };
  assert.deepEqual(pickLayout(screen).linkOrphans, [{ binding_id: 'b1', code: 'x', at: '' }]);
  const fakeScreen = { NET: {}, defaultMap: () => ({ links: [] }) };
  assert.deepEqual(emptyWorld(fakeScreen, { name: 'pi' }).linkOrphans, []);
  // 연결 io 가 어긋난 저장본도 맵을 되살릴 때 다듬어진다(MD-27)
  assert.equal(reviveMaps({ pi: { fields: ['0-0'], links: [{ id: 'a', io: 'x' }] } }, { pi: { role: 'Leaf' } }, () => false).pi.links[0].io, undefined);
});

test('글 — 이유를 사람 말로: 알려진 것만 풀고, 모르는 것은 그대로, 없는 코드 이름은 만들지 않는다', () => {
  assert.match(reasonLine('flow_not_allowed: target node n2 is not in the node allow-list'), /^이 자원이 내보낼 수 있는 노드가 아니다.* — target node n2/);
  assert.match(reasonLine('missing_bind_grant: svires_cam bind.source'), /^허가가 없다.* — svires_cam bind.source/);
  assert.equal(reasonLine('no_common_qos_profile'), '두 끝이 함께 내는 QoS 가 없다');
  assert.equal(reasonLine('source_endpoint_exclusive'), '보내는 쪽 엔드포인트가 이미 쓰이고 있다(단독)');
  assert.equal(reasonLine('target_endpoint_consumer_limit'), '받는 쪽 엔드포인트가 받을 수 있는 수를 넘었다');
  assert.match(reasonLine('target_prepare_failed: boom'), /^받는 쪽 준비에 실패했다 — boom/);
  assert.equal(reasonLine('source_resource_unavailable'), '보내는 쪽 자원을 쓸 수 없다');
  assert.match(reasonLine('compatibility_incompatible: a → b'), /^호환되지 않는다 — incompatible: a → b/);
  assert.equal(reasonLine('grant_revoked'), '허가가 철회됐다');
  assert.equal(reasonLine('something_new: x'), 'something_new: x');
  assert.equal(reasonLine(''), ''); assert.equal(reasonLine(null), '');
  assert.equal(phaseLabel('needs-grant'), '허가 필요'); assert.equal(phaseLabel('zzz'), 'zzz');
  // 도로 이벤트 대응(설계 §4.4)
  assert.deepEqual(['active', 'binding', 'needs-grant', 'draft', 'degraded', 'failed', 'denied', 'invalid', 'closed', 'lost', 'shared', 'share-expired'].map(phaseEvent),
    ['run', 'wait', 'wait', 'wait', 'wait', 'fail', 'fail', 'fail', 'stop', 'stop', 'run', 'stop']);
});
