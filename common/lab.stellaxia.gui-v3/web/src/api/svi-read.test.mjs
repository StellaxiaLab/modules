// node --test — SVI 응답 → 자원 창 · 자원 상태 창 모양
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMS, TTLS, permOf, resources, grantRows, availRows, bindings, sinks, handleRows, bindBody } from './svi-read.js';

const RES = { items: [
  { resource_id: 'r-cam', node_id: 'nB', kind: 'camera', display_name: 'camera/frames', status: 'available', endpoints: [{ endpoint_id: 'frames', direction: 'source' }] },
  { resource_id: 'r-store', node_id: 'nA', kind: 'store', canonical_name: 'store/data', status: 'available', endpoints: [{ endpoint_id: 'in', direction: 'sink' }, { endpoint_id: 'meta', direction: 'source' }] }] };
const GR = { items: [
  { grant_id: 'g1', subject: { type: 'node', id: 'nA' }, resource_id: 'r-cam', operations: ['read', 'subscribe', 'bind.source'] },
  { grant_id: 'g2', subject: { type: 'user', id: 'u1' }, resource_id: 'r-store', operations: PERMS['읽기'], expires_at: '2026-11-02T12:00:00Z' },
  { grant_id: 'g3', subject: { type: 'node', id: 'nT' }, resource_id: 'r-store', operations: ['discover', 'inspect'] }] };
const BI = { items: [{ binding_id: 'b1', source: { resource_id: 'r-cam', endpoint_id: 'frames' }, target: { resource_id: 'r-store', endpoint_id: 'in' }, source_node_id: 'nB', target_node_id: 'nA', observed_state: 'active', qos_profile: 'realtime_latest' }] };
const names = new Map([['nA', 'leaf-a'], ['nB', 'leaf-b'], ['nT', 'tree']]);

test('permOf — operations → 권한 낱말', () => {
  assert.equal(permOf(PERMS['읽기']), '읽기'); assert.equal(permOf(PERMS['연결 원천']), '연결 원천');
  assert.equal(permOf(['discover', 'inspect']), '보기'); assert.equal(permOf(['read', 'write']), '쓰기'); assert.equal(permOf(['invoke']), '제어'); assert.equal(permOf([]), '—');
  // 위임 입구 가드: 노드에게는 read · subscribe · bind.source 만, 기한은 90일 이하
  const allowed = new Set(['read', 'subscribe', 'bind.source']);
  for (const ops of Object.values(PERMS)) for (const o of ops) assert.ok(allowed.has(o), o);
  for (const s of Object.values(TTLS)) assert.ok(s > 0 && s <= 90 * 86400);
});

test('resources · grantRows — 이름 · 끝점, 허가는 주체(Tree · Leaf · 계정)와 기한으로', () => {
  assert.deepEqual(resources(RES)[1], { id: 'r-store', node: 'nA', kind: 'store', name: 'store/data', status: 'available', eps: [{ id: 'in', dir: 'sink', interaction: '' }, { id: 'meta', dir: 'source', interaction: '' }] });
  const g = grantRows(GR, 'r-store', names, 'nT', Date.parse('2026-11-01T12:00:00Z'));
  assert.deepEqual(g.map((x) => [x.who, x.type, x.perm, x.ttl]), [['u1', '계정', '읽기', '1일 남음'], ['tree', 'Tree', '보기', '없음']]);
});

test('availRows · bindings · sinks — 이 노드에 지명된 자원과 이미 이은 바인딩, 받는 끝점', () => {
  const a = availRows(GR, RES, BI, 'nA', names);
  assert.deepEqual(a, [{ grant: 'g1', resId: 'r-cam', res: 'camera/frames', from: 'leaf-b', src: '지명', perm: '연결 원천', canBind: true, srcEp: 'frames', bound: 'r-store#in', bindId: 'b1', qos: 'realtime_latest' }]);
  assert.equal(bindings(BI)[0].state, 'active');
  assert.deepEqual(sinks(RES, 'nA'), [{ label: 'store/data#in', resId: 'r-store', epId: 'in' }]);
  assert.deepEqual(availRows(GR, RES, BI, 'nX'), []);
});

test('handleRows · bindBody — 열린 핸들은 사건 줄로, 바인딩 본문은 계약의 필수 칸을 다 채운다', () => {
  const h = handleRows({ items: [{ handle_id: 'h1', resource_id: 'r-cam', operation: 'subscribe', endpoint_id: 'frames', state: 'open', created_at: '2026-11-01T01:02:03Z' }, { handle_id: 'h2', resource_id: 'x' }] }, 'r-cam');
  assert.equal(h.length, 1); assert.match(h[0].msg, /subscribe · frames — open/); assert.match(h[0].t, /^\d\d:02:03$/);
  const b = bindBody({ resId: 'r-cam', srcEp: 'frames' }, { resId: 'r-store', epId: 'in' }, 'realtime_latest');
  for (const k of ['source_resource_id', 'source_endpoint_id', 'target_resource_id', 'target_endpoint_id', 'idempotency_key']) assert.ok(b[k], k);
  assert.notEqual(bindBody({}, {}, '').idempotency_key, bindBody({}, {}, '').idempotency_key);
});
