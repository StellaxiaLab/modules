// 연결 적용(MD-28) — 엔드포인트 다시 읽기 → 미리 검사 → 내 허가 → svi.bindings.post · 공유 허가, 상태 · 오류 상태 기록
//   Master 계약 모양의 가짜 클라이언트로 시험한다(SVI 쓰기는 앱 토큰의 위임 입구에 아직 열리지 않았다 — Terra ADR-GW-003 1차는 읽기만). npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyLink, precheck, grantCovers, deniedReason, grantSelf, lacksOf, OPS, GRANT_SELF_TTL_DEFAULT } from '../src/api/link-apply.js';
import { wireLinkApply } from '../src/api/link-wire.js';
import { buildIO, setEndpointChoice, sanitizeIO, idempotencyKey, pairsOf } from '../src/model/link-io.js';

const ME = 'user_me';
const svi = (id, node) => ({ app: 'svi', id, node, name: id });
const ctx = (over = {}) => Object.assign({ rsrc: { '1-1': svi('svires_cam', 'pi'), '3-1': svi('svires_rec', 'hub') }, nodes: { '0-0': { name: 'hub' } }, self: null, map: 'pi', treeId: 'tree-a',
  nodeIdOf: (n) => ({ pi: 'node_pi', hub: 'node_hub' }[n] || null) }, over);
const L = (id, from, to, extra) => Object.assign({ id, from, to, start: from, path: [], road: 'stone' }, extra);
const ok = (data) => ({ kind: 'ok', data });
const EP_SRC = { endpoint_id: 'sviep_frames', direction: 'source', interaction: 'stream', operations: ['read', 'subscribe', 'bind.source'], output_schema: 'terra.image.frame@1', qos_profiles: ['realtime_latest', 'realtime_ordered'], status: 'available' };
const EP_DST = { endpoint_id: 'sviep_in', direction: 'sink', interaction: 'stream', operations: ['write', 'bind.target'], input_schema: 'terra.image.frame@1', status: 'available' };
const grant = (res, ops, extra) => Object.assign({ grant_id: 'g_' + res, subject: { type: 'user', id: ME }, resource_id: res, operations: ops }, extra);

/** Master 계약 모양의 가짜 클라이언트 — handlers[op](input) 가 Result 를 돌려준다. 부른 것을 calls 에 쌓는다 */
function fake(handlers = {}, catalog) {
  const calls = [], c = { calls, catalog: catalog || null,
    has(op) { return !this.catalog || this.catalog.indexOf(op) >= 0; },
    async invoke(op, input) { calls.push({ op, input }); const h = handlers[op]; if (!h) return { kind: 'error', status: 404, reason: 'NO_HANDLER' }; return typeof h === 'function' ? h(input) : h; } };
  return c;
}
const std = (over = {}) => Object.assign({
  [OPS.endpoints]: (i) => ok({ resource_id: i.resource_id, items: [i.resource_id === 'svires_cam' ? EP_SRC : EP_DST] }),
  [OPS.grantsGet]: (i) => ok({ items: i.resource_id === 'svires_cam' ? [grant('svires_cam', ['bind.source'])] : [grant('svires_rec', ['bind.target'])] }),
  [OPS.bindPost]: () => ({ kind: 'accepted', job: undefined, data: { binding_id: 'svib_1', binding: { binding_id: 'svib_1', observed_state: 'requested' } } })
}, over);
const apply = (client, link, links, c = ctx()) => applyLink({ client }, link, links, c, { userId: ME, now: () => Date.parse('2026-10-07T00:00:00Z') });

test('미리 검사 — 확실히 어긋난 것만 막는다', () => {
  assert.deepEqual(precheck(EP_SRC, EP_DST, {}), { ok: true });
  assert.equal(precheck(null, EP_DST).reason, 'source_endpoint_not_found');
  assert.equal(precheck(EP_SRC, null).reason, 'target_endpoint_not_found');
  assert.equal(precheck(EP_DST, EP_DST).step, 'direction');                       // 보내는 쪽이 sink
  assert.equal(precheck(EP_SRC, EP_SRC).reason, 'target_direction_source');
  assert.equal(precheck(Object.assign({}, EP_SRC, { direction: 'duplex' }), Object.assign({}, EP_DST, { direction: 'duplex' })).ok, true);
  assert.equal(precheck(Object.assign({}, EP_SRC, { operations: ['read'] }), EP_DST).reason, 'source_missing_bind.source');
  assert.equal(precheck(EP_SRC, Object.assign({}, EP_DST, { operations: ['write'] })).reason, 'target_missing_bind.target');
  assert.equal(precheck(Object.assign({}, EP_SRC, { operations: [] }), EP_DST).ok, true, '말하지 않은 operation 은 막지 않는다');
  assert.equal(precheck(Object.assign({}, EP_SRC, { status: 'disabled' }), EP_DST).reason, 'source_disabled');
  assert.equal(precheck(Object.assign({}, EP_SRC, { status: 'busy' }), EP_DST).ok, true);
});

test('미리 검사 — 형식(exact)과 QoS', () => {
  const dst2 = Object.assign({}, EP_DST, { input_schema: 'terra.image.frame@2' });
  assert.match(precheck(EP_SRC, dst2, {}).reason, /^schema_major_mismatch:/);
  assert.match(precheck(EP_SRC, Object.assign({}, EP_DST, { input_schema: 'terra.text.line@1' }), {}).reason, /^schema_incompatible:/);
  assert.equal(precheck(EP_SRC, dst2, { compatibility_policy: 'compatible' }).ok, true, '호환 정책이면 Master 가 정한다');
  assert.equal(precheck(Object.assign({}, EP_SRC, { output_schema: '' }), dst2).ok, true, '한쪽이 말하지 않으면 막지 않는다');
  // QoS
  assert.equal(precheck(EP_SRC, EP_DST, { qos_profile: 'reliable_ordered' }).reason, 'source_not_resumable_for_reliable_ordered');
  assert.equal(precheck(Object.assign({}, EP_SRC, { resumable: true }), EP_DST, { qos_profile: 'reliable_ordered' }).reason, 'source_qos_unsupported');
  assert.equal(precheck(EP_SRC, Object.assign({}, EP_DST, { qos_profiles: ['bulk_resumable'] }), { qos_profile: 'realtime_latest' }).reason, 'target_qos_unsupported');
  assert.equal(precheck(EP_SRC, Object.assign({}, EP_DST, { qos_profiles: ['bulk_resumable'] }), {}).reason, 'no_common_qos_profile');
  assert.equal(precheck(EP_SRC, EP_DST, { qos_profile: 'realtime_latest' }).ok, true);
});

test('내 허가 — user 주체 · 안 지난 것 · 끝점 범위 · operation 을 모두 본다(Master grantsSatisfied 와 같다)', () => {
  const now = Date.parse('2026-10-07T00:00:00Z');
  const g = (x) => ({ items: [grant('r', ['bind.source'], x)] });
  assert.equal(grantCovers(g(), ME, 'r', 'e', 'bind.source', now), true);
  assert.equal(grantCovers(g(), ME, 'r', 'e', 'bind.target', now), false, 'operation');
  assert.equal(grantCovers(g(), 'other', 'r', 'e', 'bind.source', now), false, '다른 사람의 허가');
  assert.equal(grantCovers(g({ subject: { type: 'node', id: ME } }), ME, 'r', 'e', 'bind.source', now), false, 'node 주체는 사용자 허가가 아니다');
  assert.equal(grantCovers(g({ expires_at: '2026-10-06T00:00:00Z' }), ME, 'r', 'e', 'bind.source', now), false, '기한이 지났다');
  assert.equal(grantCovers(g({ expires_at: '2026-10-08T00:00:00Z' }), ME, 'r', 'e', 'bind.source', now), true);
  assert.equal(grantCovers(g({ endpoint_id: 'x' }), ME, 'r', 'e', 'bind.source', now), false, '다른 끝점 허가');
  assert.equal(grantCovers(g({ endpoint_id: 'e' }), ME, 'r', 'e', 'bind.source', now), true);
  assert.equal(grantCovers(g(), ME, 'other', 'e', 'bind.source', now), false, '다른 자원');
  assert.equal(grantCovers(null, ME, 'r', 'e', 'bind.source', now), false);
});

test('거절 글 — "SVI binding was denied: <이유>" 에서 이유만', () => {
  assert.equal(deniedReason({ error: { code: 'SVI_BINDING_DENIED', message: 'SVI binding was denied: flow_not_allowed: target node n2 is not in the node allow-list' } }), 'flow_not_allowed: target node n2 is not in the node allow-list');
  assert.equal(deniedReason({ error: { message: 'plain' } }), 'plain');
  assert.equal(deniedReason(null), '');
});

test('적용 — 엔드포인트를 읽고 허가를 확인한 뒤 계약 본문으로 bind 한다(node_id 를 싣지 않는다)', async () => {
  const link = L('a', '1-1', '3-1'), c = fake(std());
  const r = await apply(c, link, [link]);
  const post = c.calls.filter((x) => x.op === OPS.bindPost);
  assert.equal(post.length, 1);
  assert.deepEqual(post[0].input, { source_resource_id: 'svires_cam', source_endpoint_id: 'sviep_frames', target_resource_id: 'svires_rec', target_endpoint_id: 'sviep_in',
    compatibility_policy: 'exact', qos_profile: '', idempotency_key: idempotencyKey('tree-a', 'svires_cam#sviep_frames>svires_rec#sviep_in') });
  assert.deepEqual(c.calls.map((x) => x.op).slice(0, 2), [OPS.endpoints, OPS.endpoints], '엔드포인트는 자원마다 한 번, 허가 · bind 보다 먼저');
  assert.ok(c.calls.findIndex((x) => x.op === OPS.grantsGet) < c.calls.findIndex((x) => x.op === OPS.bindPost), '허가 확인이 bind 보다 먼저');
  assert.equal(r.applied, 1); assert.equal(r.unavailable, undefined);
  assert.equal(r.io.phase, 'binding');
  assert.equal(r.io.pairs[0].binding_id, 'svib_1'); assert.equal(r.io.pairs[0].phase, 'binding');
  assert.equal(r.io.pairs[0].key, 'svires_cam#sviep_frames>svires_rec#sviep_in');
  assert.deepEqual(r.io.source, { node_id: 'node_pi', resource_id: 'svires_cam', endpoint_id: 'sviep_frames' });
  assert.ok(r.io.checked_at);
  assert.deepEqual(r.io.endpoints, { 'src:svires_cam': 'sviep_frames', 'dst:svires_rec': 'sviep_in' }, '자동으로 고른 엔드포인트도 적는다 — 쌍의 키가 안 흔들린다');
  // 허가 읽기는 내 user 주체로 거른다
  assert.deepEqual(c.calls.find((x) => x.op === OPS.grantsGet).input, { resource_id: 'svires_cam', subject_type: 'user', subject_id: ME, active: true, limit: 200 });
});

test('적용 — 고른 QoS · 호환 정책을 본문에 싣는다', async () => {
  const link = L('a', '1-1', '3-1');
  link.io = Object.assign(buildIO(link, [link], ctx()), { qos_profile: 'realtime_latest', compatibility_policy: 'compatible' });
  const c = fake(std());
  await apply(c, link, [link]);
  const b = c.calls.find((x) => x.op === OPS.bindPost).input;
  assert.equal(b.qos_profile, 'realtime_latest'); assert.equal(b.compatibility_policy, 'compatible');
});

test('적용 — 내 허가가 없으면 bind 를 부르지 않고 needs-grant 로 둔다 · lacksOf 가 만들 허가를 돌려준다', async () => {
  const link = L('a', '1-1', '3-1'), c = fake(std({ [OPS.grantsGet]: ok({ items: [] }) }));
  const r = await apply(c, link, [link]);
  assert.equal(c.calls.some((x) => x.op === OPS.bindPost), false);
  assert.equal(r.io.phase, 'needs-grant');
  assert.equal(r.io.pairs[0].reason, 'missing_bind_grant: svires_cam bind.source, svires_rec bind.target');
  assert.deepEqual(lacksOf(r.io.pairs[0]), [
    { resource_id: 'svires_cam', operation: 'bind.source', endpoint_id: 'sviep_frames' },
    { resource_id: 'svires_rec', operation: 'bind.target', endpoint_id: 'sviep_in' }]);
  assert.deepEqual(lacksOf({ key: 'x', reason: 'other' }), []);
});

test('적용 — 한쪽 허가만 없으면 없는 쪽만 이유에 적는다', async () => {
  const link = L('a', '1-1', '3-1'), c = fake(std({ [OPS.grantsGet]: (i) => ok({ items: i.resource_id === 'svires_cam' ? [grant('svires_cam', ['bind.source'])] : [] }) }));
  const r = await apply(c, link, [link]);
  assert.equal(r.io.pairs[0].reason, 'missing_bind_grant: svires_rec bind.target');
});

test('적용 — [나에게 허가 주기]는 끝점 하나 · operation 하나씩 만든다', async () => {
  const c = fake({ [OPS.grantsPost]: (i) => (i.resource_id === 'bad' ? { kind: 'forbidden', status: 403, reason: 'FORBIDDEN', data: {} } : { kind: 'ok', data: { grant: { grant_id: 'g1' } } }) });
  const r = await grantSelf(c, [{ resource_id: 'svires_cam', endpoint_id: 'sviep_frames', operation: 'bind.source' }, { resource_id: 'bad', endpoint_id: 'e', operation: 'bind.target' }], ME, 0);
  assert.deepEqual(c.calls[0].input, { subject_type: 'user', subject_id: ME, resource_id: 'svires_cam', endpoint_id: 'sviep_frames', operations: ['bind.source'], ttl_seconds: 0 });
  assert.equal(r.ok, false); assert.deepEqual(r.made, ['svires_cam bind.source']); assert.deepEqual(r.failed, [{ resource_id: 'bad', operation: 'bind.target', code: 'FORBIDDEN' }]);
  assert.equal((await grantSelf(fake({}, []), [{ resource_id: 'a', endpoint_id: 'e', operation: 'bind.source' }], ME)).failed[0].code, 'not-in-catalog');
});

test('적용 — 403 SVI_BINDING_DENIED 는 이유와 함께 denied, 다른 403 은 권한 없음', async () => {
  const link = L('a', '1-1', '3-1');
  const denied = { kind: 'forbidden', status: 403, reason: 'SVI_BINDING_DENIED', data: { error: { code: 'SVI_BINDING_DENIED', message: 'SVI binding was denied: flow_not_allowed: target node node_hub is not in the node allow-list of resource svires_cam' } } };
  const r = await apply(fake(std({ [OPS.bindPost]: denied })), link, [link]);
  assert.equal(r.io.phase, 'denied'); assert.equal(r.io.code, 'SVI_BINDING_DENIED');
  assert.match(r.io.pairs[0].reason, /^flow_not_allowed: target node node_hub/);
  assert.equal(r.applied, 0);
  const r2 = await apply(fake(std({ [OPS.bindPost]: { kind: 'forbidden', status: 403, reason: 'FORBIDDEN', data: {} } })), link, [link]);
  assert.equal(r2.io.phase, 'denied'); assert.equal(r2.io.code, 'FORBIDDEN');
  const r3 = await apply(fake(std({ [OPS.bindPost]: { kind: 'error', status: 400, reason: 'INVALID_REQUEST', data: {} } })), link, [link]);
  assert.equal(r3.io.phase, 'invalid'); assert.equal(r3.io.code, 'INVALID_REQUEST');
});

test('적용 — 서버가 닿지 않으면(503 · 401 · 카탈로그에 없음) 상태를 바꾸지 않고 이유만', async () => {
  const link = L('a', '1-1', '3-1');
  const down = await apply(fake(std({ [OPS.bindPost]: { kind: 'down', status: 503, reason: 'SVI_UNAVAILABLE', data: {} } })), link, [link]);
  assert.equal(down.unavailable, 'down'); assert.equal(down.applied, 0);
  assert.equal(down.io.pairs[0].phase, 'draft', '이 쌍의 상태는 그대로');
  assert.equal((await apply(fake(std({ [OPS.endpoints]: { kind: 'unauthenticated', status: 401, data: {} } })), link, [link])).unavailable, 'unauthenticated');
  const c = fake(std(), []);   // 카탈로그가 비어 있지 않게 — 아무 것도 없는 카탈로그
  c.catalog = ['terra.master.nodes.get'];
  const r = await apply(c, link, [link]);
  assert.equal(r.unavailable, 'not-in-catalog'); assert.equal(c.calls.length, 0, '부르지 않는다');
  assert.match(r.notes[0], /^svi\.bindings\.post — 이 노드의 게이트웨이에 없다/);
  assert.equal((await applyLink({ client: fake(std()) }, link, [link], ctx(), { userId: '' })).unavailable, 'no-user');
});

test('적용 — 엔드포인트가 둘이면 고르게 하고(invalid), 고른 뒤에는 통과한다', async () => {
  const link = L('a', '1-1', '3-1');
  const two = std({ [OPS.endpoints]: (i) => ok({ items: i.resource_id === 'svires_cam' ? [EP_SRC, Object.assign({}, EP_SRC, { endpoint_id: 'sviep_snap' })] : [EP_DST] }) });
  const c = fake(two), r = await apply(c, link, [link]);
  assert.equal(c.calls.some((x) => x.op === OPS.bindPost), false);
  assert.equal(r.io.phase, 'invalid');
  assert.match(r.io.pairs[0].reason, /^endpoint_not_chosen: svires_cam/);
  const picked = Object.assign({}, link, { io: setEndpointChoice(r.io, 'source', 'svires_cam', 'sviep_snap') });
  const c2 = fake(two), r2 = await apply(c2, picked, [picked]);
  assert.equal(c2.calls.find((x) => x.op === OPS.bindPost).input.source_endpoint_id, 'sviep_snap');
  assert.equal(r2.io.endpoints['src:svires_cam'], 'sviep_snap', '고름이 io 에 남는다');
  assert.equal(r2.io.phase, 'binding');
});

test('적용 — 미리 검사에 걸리면 bind 를 부르지 않는다', async () => {
  const link = L('a', '1-1', '3-1'), c = fake(std({ [OPS.endpoints]: (i) => ok({ items: [i.resource_id === 'svires_cam' ? EP_SRC : Object.assign({}, EP_DST, { input_schema: 'terra.image.frame@2' })] }) }));
  const r = await apply(c, link, [link]);
  assert.equal(c.calls.some((x) => x.op === OPS.bindPost), false);
  assert.equal(r.io.phase, 'invalid'); assert.match(r.io.pairs[0].reason, /^schema_major_mismatch:/);
});

test('적용 — 내 것이 아닌 자원(엔드포인트 404)은 *_resource_not_found 로', async () => {
  const link = L('a', '1-1', '3-1');
  const c = fake(std({ [OPS.endpoints]: (i) => (i.resource_id === 'svires_rec' ? { kind: 'error', status: 404, reason: 'SVI_RESOURCE_NOT_FOUND', data: {} } : ok({ items: [EP_SRC] })) }));
  const r = await apply(c, link, [link]);
  assert.equal(r.unavailable, undefined);
  assert.equal(r.io.phase, 'invalid');
  assert.equal(r.io.pairs[0].reason, 'target_resource_not_found', 'Master 가 거절하는 이유와 같은 말 — 허가를 받아도 남의 자원과는 못 잇는다');
  assert.equal(c.calls.some((x) => x.op === OPS.bindPost || x.op === OPS.grantsGet), false, '보이지 않는 자원이면 허가 · bind 를 부르지 않는다');
});

test('적용 — 이미 바인딩이 있는 쌍은 다시 만들지 않는다 · 닫힌 쌍은 다시 만든다', async () => {
  const link = L('a', '1-1', '3-1'), c0 = ctx();
  const first = await apply(fake(std()), link, [link]);
  const live = Object.assign({}, link, { io: first.io });
  const c = fake(std()), r = await apply(c, live, [live]);
  assert.equal(c.calls.some((x) => x.op === OPS.bindPost), false); assert.equal(r.applied, 0);
  assert.match(r.notes[0], /이미 바인딩/);
  const closed = Object.assign({}, link, { io: Object.assign({}, first.io, { pairs: first.io.pairs.map((p) => Object.assign({}, p, { phase: 'closed' })) }) });
  const c2 = fake(std({ [OPS.bindPost]: { kind: 'accepted', data: { binding_id: 'svib_2' } } })), r2 = await apply(c2, closed, [closed]);
  assert.equal(c2.calls.filter((x) => x.op === OPS.bindPost).length, 1);
  assert.equal(r2.io.pairs[0].binding_id, 'svib_2');
  assert.ok(c0);
});

test('적용 — 합류(입력 더하기)는 쌍마다 한 번씩 bind 한다', async () => {
  const c0 = ctx({ rsrc: { '1-1': svi('svires_cam', 'pi'), '3-1': svi('svires_rec', 'hub'), '5-1': svi('svires_mic', 'pi') } });
  const main = L('main', '1-1', '3-1', { path: ['2-1', '2-2'] }), join = L('join', '5-1', '2-2', { path: ['4-1'] }), links = [main, join];
  const c = fake(std({ [OPS.endpoints]: (i) => ok({ items: [i.resource_id === 'svires_rec' ? EP_DST : EP_SRC] }),
    [OPS.grantsGet]: (i) => ok({ items: [grant(i.resource_id, ['bind.source', 'bind.target'])] }) }));
  const r = await apply(c, join, links, c0);
  const posts = c.calls.filter((x) => x.op === OPS.bindPost);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].input.source_resource_id, 'svires_mic'); assert.equal(posts[0].input.target_resource_id, 'svires_rec');
  assert.equal(r.io.pairs.length, 1);
});

test('공유 — 자원 → 노드는 노드 주체 허가를 만든다(없을 때만 · 이미 있으면 그것을 쓴다)', async () => {
  const link = L('s', '1-1', '0-0');
  const c = fake({ [OPS.grantsGet]: ok({ items: [] }), [OPS.grantsPost]: ok({ grant: { grant_id: 'g_new' } }) });
  const r = await apply(c, link, [link]);
  assert.deepEqual(c.calls.find((x) => x.op === OPS.grantsPost).input, { subject_type: 'node', subject_id: 'node_hub', resource_id: 'svires_cam', operations: ['read', 'subscribe', 'bind.source'], ttl_seconds: 0 });
  assert.equal(r.io.phase, 'shared'); assert.equal(r.io.pairs[0].grant_id, 'g_new'); assert.equal(r.applied, 1);
  // 이미 있다
  const have = { grant_id: 'g_old', subject: { type: 'node', id: 'node_hub' }, resource_id: 'svires_cam', operations: ['read'] };
  const c2 = fake({ [OPS.grantsGet]: ok({ items: [have] }), [OPS.grantsPost]: ok({}) }), r2 = await apply(c2, link, [link]);
  assert.equal(c2.calls.some((x) => x.op === OPS.grantsPost), false);
  assert.equal(r2.io.pairs[0].grant_id, 'g_old'); assert.equal(r2.io.phase, 'shared'); assert.equal(r2.applied, 0);
  // 기한이 지난 것은 세지 않는다
  const c3 = fake({ [OPS.grantsGet]: ok({ items: [Object.assign({}, have, { expires_at: '2026-10-01T00:00:00Z' })] }), [OPS.grantsPost]: ok({ grant: { grant_id: 'g3' } }) });
  assert.equal((await apply(c3, link, [link])).io.pairs[0].grant_id, 'g3');
});

test('공유 — 노드 → 노드는 via_node_id 를 싣고, 소유자가 아니면 denied · node_id 를 모르면 invalid', async () => {
  const c0 = ctx({ nodes: { '0-0': { name: 'hub' }, '6-6': { name: 'pi' } } });
  const link = L('s', '6-6', '0-0', { sel: [{ key: 'pi|svi|svires_cam', name: 'cam' }] });
  const c = fake({ [OPS.grantsGet]: ok({ items: [] }), [OPS.grantsPost]: ok({ grant: { grant_id: 'g' } }) });
  await apply(c, link, [link], c0);
  assert.equal(c.calls.find((x) => x.op === OPS.grantsPost).input.via_node_id, 'node_pi');
  const c2 = fake({ [OPS.grantsGet]: ok({ items: [] }), [OPS.grantsPost]: { kind: 'error', status: 404, reason: 'SVI_RESOURCE_NOT_FOUND', data: {} } });
  const r2 = await apply(c2, link, [link], c0);
  assert.equal(r2.io.phase, 'denied'); assert.equal(r2.io.code, 'SVI_RESOURCE_NOT_FOUND');
  const r3 = await apply(fake({ [OPS.grantsGet]: ok({ items: [] }) }), link, [link], ctx({ nodeIdOf: () => null, nodes: { '0-0': { name: 'hub' }, '6-6': { name: 'pi' } } }));
  assert.equal(r3.io.phase, 'invalid'); assert.match(r3.io.pairs[0].reason, /^no_node_id/);
});

test('화면 전용 연결은 아무것도 부르지 않는다', async () => {
  const link = L('d', '2-4', '3-1'), c0 = ctx({ rsrc: { '2-4': { app: 'io', id: 'dev', node: 'pi' }, '3-1': svi('svires_rec', 'hub') } }), c = fake(std());
  const r = await apply(c, link, [link], c0);
  assert.equal(c.calls.length, 0); assert.equal(r.io.kind, 'screen'); assert.equal(r.applied, 0);
});

test('model — 엔드포인트 고름은 새 io 로 적고 푼다 · 어긋난 값은 다듬는다 · 다시 만들어도 남는다', () => {
  const link = L('a', '1-1', '3-1'), io = buildIO(link, [link], ctx());
  const set = setEndpointChoice(io, 'source', 'svires_cam', 'e9');
  assert.equal(set.endpoints['src:svires_cam'], 'e9'); assert.equal(io.endpoints, undefined, '원본은 그대로');
  assert.equal(pairsOf(link, [link], ctx(), set)[0].key, 'svires_cam#e9>svires_rec#');
  const again = buildIO(link, [link], ctx(), set);
  assert.equal(again.endpoints['src:svires_cam'], 'e9'); assert.equal(again.pairs[0].key, 'svires_cam#e9>svires_rec#');
  assert.equal(setEndpointChoice(set, 'source', 'svires_cam', '').endpoints, undefined, '비우면 고름을 푼다');
  const dirty = sanitizeIO(Object.assign({}, again, { endpoints: { 'src:r': 'e', 'dst:r': '', bad: 'x', 'src:q': 3 } }));
  assert.deepEqual(dirty.endpoints, { 'src:r': 'e' });
});

// ── 화면에 잇기 ──
class Screen {
  constructor(links) { this.state = { links, rsrc: ctx().rsrc, nodes: ctx().nodes, self: null, map: 'pi', curTree: { name: 'tree-a' } }; this.NET = { pi: { id: 'node_pi' }, hub: { id: 'node_hub' } }; this.said = []; }
  setState(p) { this.state = Object.assign({}, this.state, p); }
  hbSay(t, c) { this.said.push([t, c]); }
  hbItems() { return []; }
}

test('화면 — linkApply 는 결과의 io 를 그 연결에 쓰고 글줄로 알린다 · 같은 연결 동시 적용은 막는다', async () => {
  const link = L('a', '1-1', '3-1'), s = new Screen([link, L('other', '1-1', '0-0')]), client = fake(std());
  const off = wireLinkApply(s, { client, principal: ME });
  const p1 = s.linkApply('a'), p2 = s.linkApply('a');
  assert.equal(await p2, null, '진행 중이면 null');
  const r = await p1;
  assert.equal(r.io.phase, 'binding');
  assert.equal(s.state.links[0].io.pairs[0].binding_id, 'svib_1');
  assert.equal('io' in s.state.links[1], false, '다른 연결은 그대로');
  assert.match(s.said.at(-1)[0], /연결 중/); assert.equal(s.said.at(-1)[1], '#3ecf8e');
  assert.equal(await s.linkApply('nope'), null);
  off();
  assert.equal(s.linkApply, undefined);
});

test('화면 — 서버가 닿지 않으면 연결을 바꾸지 않고 이유를 알린다 · 그 사이 연결이 사라지면 쓰지 않는다', async () => {
  const s = new Screen([L('a', '1-1', '3-1')]);
  wireLinkApply(s, { client: fake(std(), ['terra.master.nodes.get']), principal: ME });
  const before = s.state.links[0], r = await s.linkApply('a');
  assert.equal(r.unavailable, 'not-in-catalog');
  assert.equal(s.state.links[0], before);
  assert.equal(s.said.at(-1)[1], '#ff6b81');
  const s2 = new Screen([L('a', '1-1', '3-1')]);
  const client = fake(std({ [OPS.bindPost]: async () => { s2.setState({ links: [] }); return { kind: 'accepted', data: { binding_id: 'b' } }; } }));
  wireLinkApply(s2, { client, principal: ME });
  await s2.linkApply('a');
  assert.deepEqual(s2.state.links, []);
});

test('화면 — linkGrantSelf 는 막힌 쌍의 허가를 만들고 다시 적용한다', async () => {
  const s = new Screen([L('a', '1-1', '3-1')]);
  let have = false;
  const client = fake(std({
    [OPS.grantsGet]: (i) => ok({ items: have ? [grant(i.resource_id, ['bind.source', 'bind.target'])] : [] }),
    [OPS.grantsPost]: () => { have = true; return ok({ grant: { grant_id: 'gx' } }); }
  }));
  wireLinkApply(s, { client, principal: ME });
  await s.linkApply('a');
  assert.equal(s.state.links[0].io.phase, 'needs-grant');
  const r = await s.linkGrantSelf('a');
  const made = client.calls.filter((x) => x.op === OPS.grantsPost).map((x) => x.input);
  assert.deepEqual(made.map((m) => [m.resource_id, m.operations[0], m.endpoint_id, m.subject_id]), [['svires_cam', 'bind.source', 'sviep_frames', ME], ['svires_rec', 'bind.target', 'sviep_in', ME]]);
  assert.deepEqual(made.map((m) => m.ttl_seconds), [GRANT_SELF_TTL_DEFAULT, GRANT_SELF_TTL_DEFAULT], '고르지 않으면 30일 — 무기한 허가가 쌓이지 않게(Q-23)');
  assert.equal(GRANT_SELF_TTL_DEFAULT, 30 * 86400);
  assert.equal(r.grant.ok, true); assert.equal(r.apply.io.phase, 'binding');
  assert.equal(s.state.links[0].io.pairs[0].binding_id, 'svib_1');
  assert.equal(await s.linkGrantSelf('a'), null, '막힌 쌍이 없으면 하지 않는다');
});

test('화면 — linkGrantSelf 는 설정 창에서 고른 기한을 쓴다(0 = 기한 없음 · 어긋난 값은 기본)', async () => {
  for (const [opt, want] of [[{ ttlSeconds: 3600 }, 3600], [{ ttlSeconds: 0 }, 0], [{ ttlSeconds: -5 }, GRANT_SELF_TTL_DEFAULT], [{ ttlSeconds: 'x' }, GRANT_SELF_TTL_DEFAULT], [undefined, GRANT_SELF_TTL_DEFAULT]]) {
    const s = new Screen([L('a', '1-1', '3-1')]);
    const client = fake(std({ [OPS.grantsGet]: ok({ items: [] }), [OPS.grantsPost]: ok({ grant: { grant_id: 'g' } }) }));
    wireLinkApply(s, { client, principal: ME });
    await s.linkApply('a');
    await s.linkGrantSelf('a', opt);
    const ttls = client.calls.filter((x) => x.op === OPS.grantsPost).map((x) => x.input.ttl_seconds);
    assert.deepEqual(ttls, [want, want], JSON.stringify(opt));
  }
});
