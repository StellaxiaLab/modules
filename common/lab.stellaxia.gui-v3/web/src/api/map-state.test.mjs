// node --test — 지도 상태 한 줄: "못 봤음"과 "없음"을 구분하는지 (전에는 tests/statusbar.test.mjs 가 상단 상태 줄 보드로 보던 것)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapState } from './map-state.js';
import { buildTopology, nodeStats } from './topology.js';

const EMPTY = () => buildTopology([], { rev: 'none' }).records();
const NODES = () => buildTopology([{ node_id: 't', display_name: 'home', roles: ['tree'], status: 'online', last_heartbeat_at: new Date().toISOString() }, { node_id: 'l', display_name: 'a', parent_node_id: 't', status: 'offline' }], { rev: 'x', masterId: 't' }).records();
const S = (o) => mapState({ nodeStats, ago: () => '방금', ...o });

test('시안은 시안이라고 말한다 — 카드는 없다', () => { const v = S({ real: false }); assert.equal(v.stat, '시안 데이터'); assert.equal(v.card, ''); });

test('받기 전에는 받는 중', () => assert.match(S({ real: true, records: EMPTY() }).stat, /받는 중/));

test('받은 적 없이 실패 — 못 받음 · 다시 시도, 빈 지도로 말하지 않는다', () => {
  const v = S({ real: true, records: EMPTY(), state: { state: 'error', error: 'MASTER_UNAVAILABLE', at: 1 } });
  assert.equal(v.tone, 'err'); assert.equal(v.canRetry, true); assert.match(v.stat, /못 봤음/);
  assert.equal(v.card, 'err'); assert.equal(v.head, '노드 목록을 받지 못함'); assert.match(v.sub, /빈 지도가 아니라 못 본 상태/); assert.match(v.sub, /MASTER_UNAVAILABLE/);
});

test('사본이 있는 채 실패 — 마지막 지도라고 말한다', () => {
  const v = S({ real: true, records: NODES(), okAt: Date.now(), state: { state: 'error', error: 'X', at: 1 } });
  assert.match(v.stat, /못 봤음 · 방금 사본/); assert.equal(v.head, '마지막으로 받은 지도를 보이는 중'); assert.equal(v.canRetry, true); assert.equal(v.card, '', '사본이 있으면 장면 카드는 없다');
});

test('받았고 비었다 — 없음, 다시 시도 없음', () => {
  const v = S({ real: true, records: EMPTY(), state: { state: 'empty', at: 1 } });
  assert.equal(v.stat, '노드 없음'); assert.equal(v.card, 'empty'); assert.equal(v.head, '이 Tree 에 노드 없음'); assert.equal(v.canRetry, false);
});

test('정상 — 노드 수와 끊긴 노드 수, 받은 시각을 기억한다', () => {
  const at = Date.now(), v = S({ real: true, records: NODES(), state: { state: 'ok', at } });
  assert.equal(v.tone, 'warn'); assert.match(v.stat, /노드 2 · 연결 안 됨 1/); assert.equal(v.head, ''); assert.equal(v.card, ''); assert.equal(v.okAt, at);
});
