// node --test — Tree 관리 창(읽기) · 기록 창 · 핀 · 탐침 · 세션 닫기 (P11-5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeAdmin, nodeRows, alertRows, probeRows, sessionRows, logLines, confirmOf, OPS, WRITES, POLICIES, STAGES, treeReason, pubRows, promoRows, coreRows, configFields, configChanges, coerceConfig, resultLine, impactOf } from './tree-admin.js';
import MD from './master-delegated.json' with { type: 'json' };
import SCOPE from './op-scope.json' with { type: 'json' };

test('쓰는 op 는 모두 위임 표 · 계약 표에 있다(표가 어긋나면 단추가 영영 잠긴다)', () => {
  // P14-4 가 새로 쓰는 읽기 op 는 위임 표(공용 · 지휘 세션이 따로 재생성)에 아직 없을 수 있다 — 그 키는 건너뛴다(표가 갱신되면 같이 검사된다)
  const NEW = new Set(['promotions', 'ceilingGet', 'mirrorBlocks', 'configGet', 'configSchema', 'configValidate']);
  for (const [k, id] of Object.entries(OPS)) {
    if (NEW.has(k) && !MD.operations[id]) continue;
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

// ── P14-4 쓰기 — 승인 문 ──
const openGate = (op) => ({ open: true, needs: '', why: '', op });

test('쓰기 표 — post/patch/delete 이고 등급은 T3 · T4, 코어 넷 · 설정 · 상한은 T4', () => {
  for (const [k, [op, tier]] of Object.entries(WRITES)) {
    assert.match(op, /^terra\.master\..*\.(post|patch|delete)$/, k);
    assert.ok(tier === 'T3' || tier === 'T4', k);
  }
  for (const k of ['corePublish', 'coreRevoke', 'coreApply', 'coreRollout', 'configPatch', 'ceiling']) assert.equal(WRITES[k][1], 'T4', k);
  for (const k of ['publish', 'revoke', 'rollout', 'promote', 'approvePromo', 'rejectPromo', 'mirrorBlock', 'mirrorUnblock']) assert.equal(WRITES[k][1], 'T3', k);
  assert.deepEqual(POLICIES, ['available', 'recommended', 'required']); assert.deepEqual(STAGES, [1, 10, 50, 100]);
});

test('Tree 노드가 아니면 이유를 준다(리프 · 계정), Tree · master 역할이면 열린다', () => {
  assert.equal(treeReason('tree'), ''); assert.equal(treeReason('leaf', ['tree']), '');
  assert.match(treeReason('leaf'), /리프 노드에는 Master 가 없어/); assert.match(treeReason('root'), /계정/);
});

test('쓰기는 승인 문으로만 — 입력을 그대로 제안하고, 문이 없으면 부르지 않는다', async () => {
  const door = []; let can = true;
  const t = createTreeAdmin({ invoke: async () => { throw new Error('직접 호출 금지'); } }, () => ({ allPermissions: true }),
    { gate: openGate, canApprove: () => can, approve: async (op, inp) => { door.push([op, inp]); return { ok: true, data: { affected_nodes: 3, cluster_nodes: 5 } }; } });
  const r = await t.act('coreRollout', { release_id: 'r1', stage: 10 });
  assert.deepEqual(door, [['terra.master.core.releases.by-release-id.rollout.post', { release_id: 'r1', stage: 10 }]]);
  assert.equal(r.ok, true); assert.equal(r.tier, 'T4'); assert.equal(r.line, '3대에 적용 (이 클러스터 5대 중)');
  can = false; door.length = 0;
  const n = await t.act('publish', { digest: 'd'.repeat(64) });
  assert.equal(n.ok, false); assert.equal(n.code, 'APPROVAL_UNAVAILABLE'); assert.equal(door.length, 0);
});

test('문(gate)이 잠기면 승인 화면을 띄우지 않고 이유만 — 표가 아직 열지 않은 op 도 그렇다', async () => {
  const door = [];
  const t = createTreeAdmin({ invoke: async () => ({}) }, () => ({ permissions: ['node.read'] }), { canApprove: () => true, approve: async (...a) => { door.push(a); return { ok: true, data: {} }; } });
  const r = await t.act('corePublish', { role: 'terra', version: '1', digests: ['x'] });
  assert.equal(r.ok, false); assert.equal(r.code, 'LOCKED'); assert.match(r.text, /잠김/); assert.equal(door.length, 0);
  assert.equal((await t.act('nope')).code, 'UNKNOWN_ACTION');
});

test('거절 · 만료는 던지지 않고 표 문구로(조용히 거절은 text 없음)', async () => {
  const t = createTreeAdmin({ invoke: async () => ({}) }, () => null, { gate: openGate, canApprove: () => true, approve: async () => ({ ok: false, code: 'APPROVAL_DENIED', text: '', hint: '' }) });
  const r = await t.act('configPatch', { changes: { log_level: 'debug' } });
  assert.equal(r.ok, false); assert.equal(r.silent, true);
});

test('"N대에 적용" — affected_nodes 가 없으면 지어내지 않는다', () => {
  assert.equal(resultLine('coreApply', { affected_nodes: 0, cluster_nodes: 4 }), '0대에 적용 (이 클러스터 4대 중)');
  assert.equal(resultLine('corePublish', { affected_nodes: 7 }), '7대에 적용');
  assert.match(resultLine('coreRevoke', { release: {} }), /적용 대수는 Master 가 알려 주지 않음/);
  assert.match(resultLine('configPatch', { restart_required: ['listen'] }), /다시 시작해야 반영 : listen/);
  assert.match(resultLine('configPatch', { restart_required: [] }), /다시 시작 없이/);
  assert.match(impactOf('coreRollout'), /적용 대수는 완료 뒤/);
});

test('게시 · 심사 · 코어 줄 — 너그럽게 읽고 최신순', () => {
  assert.deepEqual(pubRows({ publications: [{ publication_id: 'p1', module_id: 'm', version: '1', policy: 'available', published_at: '2026-11-01T00:00:00Z' }, { id: 'p2', module: 'm', stage: 10, created_at: '2026-11-02T00:00:00Z' }] }).map((x) => [x.id, x.stage]), [['p2', 10], ['p1', null]]);
  const pr = promoRows({ promotions: [{ promotion_id: 'q1', module_id: 'm', state: 'pending', permissions: { digest: 'abc', added: ['file.write'] } }, { id: 'q2', module_id: 'n' }] });
  const q1 = pr.find((x) => x.id === 'q1'); assert.equal(q1.widens, true); assert.equal(q1.digest, 'abc'); assert.equal(pr.find((x) => x.id === 'q2').widens, false);
  assert.equal(coreRows({ releases: [{ release_id: 'r', role: 'tree', version: '0.7', apply: true, rollout_stage: 50 }] })[0].stage, 50);
});

test('설정 폼 — 스키마의 칸만, 비밀 · 수정불가는 읽기 줄, 바뀐 칸만 changes, 틀린 값은 막는다', () => {
  const schema = { fields: [{ key: 'log_level', type: 'string', editable: true }, { key: 'audit.retention_days', type: 'int', editable: true, restart_required: true }, { key: 'jwt_secret', type: 'string', secret: true, editable: false }, { key: 'data_dir', type: 'string', editable: false, owner: 'installer' }] };
  const view = { config: { log_level: 'info', audit: { retention_days: 30 }, jwt_secret: 'zzz' }, pending_restart: ['audit.retention_days'] };
  const f = configFields(schema, view);
  assert.deepEqual(f.map((x) => x.key), ['audit.retention_days', 'data_dir', 'jwt_secret', 'log_level']);
  assert.equal(f.find((x) => x.key === 'jwt_secret').value, ''); assert.equal(f.find((x) => x.key === 'jwt_secret').editable, false);
  assert.equal(f.find((x) => x.key === 'audit.retention_days').pending, true);
  const r = configChanges(f, { log_level: 'debug', 'audit.retention_days': '30', jwt_secret: 'x', data_dir: '/x' });
  assert.deepEqual(r.changes, { log_level: 'debug' }); assert.deepEqual(r.errors, {});
  assert.deepEqual(configChanges(f, { 'audit.retention_days': 'abc' }).errors, { 'audit.retention_days': '숫자' });
  assert.deepEqual(coerceConfig('bool', 'true'), { v: true }); assert.ok(coerceConfig('bool', 'yes').err); assert.deepEqual(coerceConfig('list', '["a"]'), { v: ['a'] });
});

test('설정 검증은 읽기 호출(승인 없음), patch 는 승인 문', async () => {
  const calls = [], door = [];
  const t = createTreeAdmin({ invoke: async (op, i) => { calls.push([op, i]); return { valid: true, restart_required: [], errors: [] }; } }, () => ({ allPermissions: true }),
    { gate: openGate, canApprove: () => true, approve: async (op, i) => { door.push([op, i]); return { ok: true, data: { valid: true, saved: true, restart_required: ['listen'] } }; } });
  const v = await t.configValidate({ log_level: 'debug' });
  assert.equal(v.ok, true); assert.deepEqual(calls, [[OPS.configValidate, { changes: { log_level: 'debug' } }]]);
  const p = await t.act('configPatch', { changes: { log_level: 'debug' } });
  assert.equal(p.ok, true); assert.deepEqual(door, [['terra.master.config.patch', { changes: { log_level: 'debug' } }]]); assert.match(p.line, /listen/);
});
