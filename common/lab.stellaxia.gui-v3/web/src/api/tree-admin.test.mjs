// node --test — Tree 관리 창(읽기) · 기록 창 · 핀 · 탐침 · 세션 닫기 (P11-5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeAdmin, nodeRows, alertRows, probeRows, sessionRows, logLines, confirmOf, OPS } from './tree-admin.js';
import MD from './master-delegated.json' with { type: 'json' };
import SCOPE from './op-scope.json' with { type: 'json' };

test('쓰는 op 는 모두 위임 표 · 계약 표에 있다(표가 어긋나면 단추가 영영 잠긴다)', () => {
  for (const [k, id] of Object.entries(OPS)) {
    const ok = id.startsWith('terra.master.') ? MD.operations[id] : SCOPE.operations[id];
    assert.ok(ok, k + ' ' + id + ' — 표에 없다');
  }
});

test('노드 줄 — 3이름 · 연결 · 하트비트 나이', () => {
  const now = Date.parse('2026-11-16T00:00:30Z');
  const r = nodeRows({ nodes: [{ node_id: 'n2', display_name: 'server', status: 'online', cluster_address: '100.80.0.2', last_heartbeat_at: '2026-11-16T00:00:00Z', parent_node_id: 'n1' }, { node_id: 'n1', display_name: 'desk' }] }, now);
  assert.deepEqual(r.map((x) => x.name), ['desk', 'server']);
  assert.equal(r[1].online, true); assert.equal(r[1].heartbeatAgo, 30); assert.equal(r[0].heartbeatAgo, null);
});

test('경보 — 최신순 · 심각도 등급 · 확인 여부', () => {
  const r = alertRows({ alerts: [{ alert_id: 'a1', node_id: 'n1', severity: 'warning', message: 'x', updated_at: '2026-11-16T00:00:00Z' }, { alert_id: 'a2', severity: 'critical', updated_at: '2026-11-16T01:00:00Z', acknowledged: true }] });
  assert.deepEqual(r.map((x) => x.id), ['a2', 'a1']); assert.equal(r[0].sev, 'bad'); assert.equal(r[0].acked, true); assert.equal(r[1].sev, 'warn');
});

test('탐침 · 세션 · 로그 모양', () => {
  assert.equal(probeRows({ probes: [{ source_node_id: 'a', target_node_id: 'b', result: { reachable: true, candidate: { latency_ms: 3 }, observed_at: '2026-11-16T00:00:00Z' } }] })[0].latency, 3);
  assert.equal(sessionRows({ sessions: [{ session_id: 's1', source_node_id: 'a', target_node_id: 'b' }] })[0].id, 's1');
  assert.deepEqual(logLines({ lines: ['a', { message: 'b' }, 'c'] }, 2), ['b', 'c']);
});

test('확인 창 문구 — 지울 핀은 이름을 한 번 더 고르게 한다', () => {
  assert.equal(confirmOf('unpin', { node: 'n1', module: 'm' }).pick, 'm');
  assert.match(confirmOf('closeSession', { id: 's1', from: 'a', to: 'b' }).undo, /다시 맺어진다/);
});

test('읽기 실패는 던지지 않고 못 봤음으로, 권한 없으면 호출 없이 잠김', async () => {
  const calls = [];
  const terra = { invoke: async (op, input) => { calls.push([op, input]); if (op === OPS.alerts) throw Object.assign(new Error('x'), { code: 'GATEWAY_UNAVAILABLE' }); return { sessions: [] }; } };
  const t = createTreeAdmin(terra, () => ({ permissions: ['node.read'] }));
  const a = await t.alerts(); assert.equal(a.ok, false); assert.equal(a.err.code, 'GATEWAY_UNAVAILABLE'); assert.deepEqual(a.rows, []);
  const s = await t.sessions(); assert.equal(s.ok, true);
  const w = await t.closeSession('s1'); assert.equal(w.ok, false); assert.equal(w.locked.needs, 'user-perm');
  assert.equal(calls.some(([op]) => op === OPS.closeSession), false);
});

test('쓰기 — node.control 이 있으면 그대로 부른다', async () => {
  const calls = [];
  const t = createTreeAdmin({ invoke: async (op, input) => { calls.push([op, input]); return {}; } }, () => ({ permissions: ['node.read', 'node.control'] }));
  assert.equal((await t.pin('n1', 'm', '1.0.0')).ok, true); assert.equal((await t.unpin('n1', 'm')).ok, true); assert.equal((await t.ack('a1')).ok, true);
  assert.deepEqual(calls[0], [OPS.pin, { node_id: 'n1', module_id: 'm', version: '1.0.0' }]);
  assert.deepEqual(calls[1], [OPS.unpin, { node_id: 'n1', module_id: 'm' }]);
});
