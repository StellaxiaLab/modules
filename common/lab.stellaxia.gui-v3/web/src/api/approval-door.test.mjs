import test from 'node:test';
import assert from 'node:assert/strict';
import { viaDoor, hasApproval, tierOf, approvalOf, approvalPreview, makeApproveFor, doorOps } from './approval-door.js';
import { createTerra } from './terra.js';
import { gate } from './gates.js';
import { errorLine } from './error-text.js';

// 단추 → op → 등급 (계획 §3 · P13 열). PR 본문 표의 원본이다. door = 이 앱이 승인 문으로 보내는가(false 는 이유가 있다)
const BUTTONS = [
  ['메시 다시 맞추기', 'terra.master.network.mesh.wireguard.reconcile.post', 'T3'],
  ['peer 폐기', 'terra.master.network.mesh.wireguard.peers.revoke.post', 'T3'],
  ['경로 정책 넣기', 'terra.master.route.policies.put', 'T3'],
  ['경로 정책 지우기', 'terra.master.route.policies.by-policy-id.delete', 'T3'],
  ['망 만들기 · 고치기', 'terra.master.network.networks.post', 'T3'],
  ['주소 배정', 'terra.master.network.assignments.post', 'T3'],
  ['노드 전송 desired', 'terra.master.network.nodes.by-node-id.transports.by-adapter.desired.put', 'T3'],
  ['노드 기록 만들기', 'terra.master.nodes.post', 'T3'],
  ['노드 기록 지우기', 'terra.master.nodes.by-node-id.delete', 'T3'],
  ['Gateway 자격 철회', 'terra.master.nodes.by-node-id.gateway-credential.revoke.post', 'T3'],
  ['등록 코드 발급', 'terra.master.nodes.enroll-codes.post', 'T3'],
  ['등록 코드 폐기', 'terra.master.nodes.enroll-codes.by-code-id.delete', 'T3'],
  ['장치 등록(Master)', 'terra.master.devices.register.post', 'T3'],
  ['Tree 사이 소개', 'terra.master.crossboundary.sessions.post', 'T3'],
  ['위임 보내기', 'terra.master.delegations.outbound.post', 'T3'],
  ['위임 취소', 'terra.master.delegations.outbound.cancel.post', 'T3'],
  ['fleet 지우기', 'terra.master.fleets.by-fleet-id.delete', 'T3'],
  ['fleet 고아 정리', 'terra.master.fleets.by-fleet-id.cleanup.post', 'T3'],
  ['fleet 가입 코드 발급', 'terra.master.fleets.by-fleet-id.codes.post', 'T3'],
  ['fleet 이미지 빌드 주문', 'terra.master.fleets.by-fleet-id.releases.post', 'T3'],
  ['fleet 승격', 'terra.master.fleets.by-fleet-id.releases.by-release-id.promote.post', 'T3'],
  ['fleet 자리 지우기', 'terra.master.fleets.by-fleet-id.slots.by-slot-id.delete', 'T3'],
  ['원격 명령(다른 노드)', 'terra.master.commands.post', 'T3'],
  ['job 재실행', 'terra.master.jobs.by-job-id.rerun.post', 'T3'],
  ['확인 승인', 'terra.master.confirmations.by-confirmation-id.approve.post', 'T3'],
  ['중계 사용량', 'terra.master.relay.usage.get', 'T3'],
  ['내 외부 신원 연결', 'terra.master.users.by-user-id.external-identities.post', 'T4'],
  ['내 외부 신원 풀기', 'terra.master.users.by-user-id.external-identities.delete', 'T4'],
  ['SVI 선언 적용(이 노드도 닫힘)', 'terra.daemon.svi.declarations.apply.post', 'T3'],
  ['SVI 은퇴 선언 잊기(이 노드도 닫힘)', 'terra.daemon.svi.declarations.retired.by-family.by-name.forget.post', 'T3'],
  ['Daemon 등록(액세스 토큰)', 'terra.daemon.enrollment.register.post', 'T3'],
  ['Daemon 등록(코드)', 'terra.daemon.enrollment.code.post', 'T3'],
  ['Daemon 등록 풀기', 'terra.daemon.enrollment.unenroll.post', 'T3'],
  ['agent 자격 발급', 'terra.gateway.agent.grants.post', 'T3'],
  ['agent 자격 폐기', 'terra.gateway.agent.grants.by-id.delete', 'T3'],
  ['GUI 진단 보기', 'terra.gateway.gui.diagnostics.get', 'T3'],
  ['WireGuard 적용', 'terra.daemon.wireguard.apply.post', 'T3'],
  ['WireGuard 끄기', 'terra.daemon.wireguard.down.post', 'T3'],
  ['WireGuard 설정 저장', 'terra.daemon.wireguard.managed-config.post', 'T3'],
  ['WireGuard 키 만들기 · 돌리기', 'terra.daemon.wireguard.managed-key.post', 'T4'],
];
// 승인 문으로 보내지 않는 것 — 이유가 있다
const NOT_DOOR = [
  ['설정 저장(이 노드는 앱 토큰 · 원격은 transport 가 승인 문)', 'terra.daemon.config.patch'],
  ['모듈 끄기(스위치 뒤)', 'terra.daemon.modules.by-module-id.disable.post'],
  ['/admin 사용자(P13-3 호스트 화면)', 'terra.master.admin.users.post'],
  ['모듈 승격(P14)', 'terra.master.modules.promotions.by-promotion-id.approve.post'],
  ['Master 설정(P14)', 'terra.master.config.patch'],
];

test('단추표 — 모두 계약에 approval 이 있고 등급이 맞고, 승인 문으로 나간다', () => {
  for (const [name, op, tier] of BUTTONS) {
    assert.ok(hasApproval(op), name + ' — 계약에 approval 없음 : ' + op);
    assert.equal(tierOf(op), tier, name);
    assert.ok(viaDoor(op), name + ' — 승인 문으로 안 나감');
  }
});

test('승인 문으로 보내지 않는 것 — 이 노드 쓰기(스위치 뒤) · /admin · P14', () => {
  for (const [name, op] of NOT_DOOR) { assert.ok(hasApproval(op), name); assert.equal(viaDoor(op), false, name); }
  assert.equal(viaDoor('terra.master.nodes.get'), false);   // 표에 없으면 그냥
});

test('승인 표 전체 — 승인 문 대상은 스위치 없는 것 + 닫힌 둘, 원격 관리 스위치 뒤는 transport 몫', () => {
  for (const op of doorOps()) {
    const a = approvalOf(op);
    if (a.switch === 'remote-manage') assert.match(op, /svi\.declarations\.(apply|retired)/, op);
    assert.match(a.tier, /^T[34]$/);
  }
  assert.ok(doorOps().length >= 40);
});

function mk({ mode = 'app', frame, fetchCalls = [] } = {}) {
  const fetch = async (path, init) => { fetchCalls.push([path, JSON.parse(init.body)]); return new Response(JSON.stringify({ status: 'ok', data: { direct: true } }), { status: 200 }); };
  return createTerra({ fetch, token: () => 't', approveFor: makeApproveFor({ frame: () => frame, mode: () => mode }) });
}

test('앱 모드 — 단추마다 approve 로 나가고 fetch 는 안 나간다(op · 입력 그대로)', async () => {
  for (const [name, op] of BUTTONS) {
    const sent = [], fetchCalls = [];
    const frame = { approve: async (r) => { sent.push(r); return { ok: true, status: 200, data: { done: name } }; } };
    const t = mk({ frame, fetchCalls });
    const r = await t.invoke(op, { x: 1 });
    assert.deepEqual(r, { done: name }, name); assert.equal(fetchCalls.length, 0, name + ' 가 앱 토큰으로 나갔다');
    assert.deepEqual(sent, [{ operationId: op, inputs: { x: 1 } }], name);
  }
});

test('앱 모드 — 다른 노드로 가는 승인은 node 를 싣는다', async () => {
  const sent = [];
  const t = mk({ frame: { approve: async (r) => { sent.push(r); return { ok: true, data: 1 }; } } });
  await t.invoke('terra.daemon.svi.declarations.apply.post', { declarations: [] }, { node: 'n-2' });
  assert.equal(sent[0].node, 'n-2');
});

test('앱 모드 — 승인 문 대상이 아닌 op 는 앱 토큰으로 곧장', async () => {
  const fetchCalls = [], t = mk({ frame: { approve: async () => { throw new Error('부르면 안 됨'); } }, fetchCalls });
  assert.deepEqual(await t.invoke('terra.master.nodes.get', {}), { direct: true });
  assert.deepEqual(await t.invoke('terra.daemon.config.patch', { set: {} }), { direct: true });
  assert.equal(fetchCalls.length, 2);
});

test('B 모드(자격 핸들 · 사람 세션) — 승인 문 없이 곧장 (사람이 곧 호출자)', async () => {
  const fetchCalls = [], t = mk({ mode: 'shell', frame: null, fetchCalls });
  assert.deepEqual(await t.invoke('terra.master.nodes.post', { device_name: 'x' }), { direct: true });
  assert.equal(fetchCalls.length, 1);
});

test('거절 분기 — 사람이 거절 · 만료 · 문 없음 · 권한 없음이 §2.5 문구로', async () => {
  const run = async (reply, frame = { approve: async () => reply }) => { try { await mk({ frame }).invoke('terra.master.nodes.post', {}); return null; } catch (e) { return e; } };
  const declined = await run({ ok: false, code: 'APPROVAL_DECLINED', message: '' });
  assert.equal(declined.code, 'APPROVAL_DECLINED'); assert.equal(errorLine('terra.master.nodes.post', declined), '');   // 조용히
  const expired = await run({ ok: false, code: 'APPROVAL_EXPIRED', message: '' });
  assert.match(errorLine('terra.master.nodes.post', expired), /만료/);
  const none = await run(null, null);   // frame 없음
  assert.equal(none.code, 'APPROVAL_UNAVAILABLE'); assert.match(errorLine('terra.master.nodes.post', none), /승인 문 없음/);
  const noPerm = await run({ ok: false, code: 'MODULE_PERMISSION_DENIED', status: 403, message: '' });
  assert.match(errorLine('terra.master.nodes.post', noPerm), /계정 권한 없음 : node\.control/);
  const rate = await run({ ok: false, code: 'APPROVAL_RATE_LIMITED', message: '' });
  assert.match(errorLine('terra.master.nodes.post', rate), /너무 잦음/);
  const recent = await run({ ok: false, code: 'RECENT_AUTH_REQUIRED', message: '' });
  assert.match(errorLine('terra.master.nodes.post', recent), /비밀번호를 다시/);
});

test('미리 알림 — 권한 없는 사람은 승인해도 거절된다고 미리 말한다', () => {
  const op = 'terra.master.nodes.post';
  const ok = approvalPreview(op, { who: { permissions: ['node.control'] }, app: true, canApprove: true });
  assert.deepEqual([ok.door, ok.tier, ok.ok, ok.why], [true, 'T3', true, '']);
  const no = approvalPreview(op, { who: { permissions: ['node.read'] }, app: true, canApprove: true });
  assert.equal(no.ok, false); assert.deepEqual(no.missing, ['node.control']); assert.match(no.why, /계정 권한 없음 : node\.control — 승인해도 거절/);
  assert.equal(approvalPreview(op, { who: { allPermissions: true }, app: true, canApprove: true }).ok, true);
  const t4 = approvalPreview('terra.daemon.wireguard.managed-key.post', { who: { permissions: ['node.control'] }, app: true, canApprove: true });
  assert.match(t4.tierText, /비밀번호/);
  assert.match(approvalPreview(op, { who: { allPermissions: true }, app: true, canApprove: false }).why, /승인 문 없음/);
  assert.equal(approvalPreview('terra.master.nodes.get', {}).door, false);
});

test('문(gate) — 승인 문이 있으면 위임 표 · 앱 토큰 닫힘과 무관하게 열리고, 권한 없으면 잠긴다', () => {
  const o = (x) => Object.assign({ app: true, door: true, who: { permissions: ['node.control', 'node.config'] } }, x);
  for (const [name, op] of [['노드 기록 만들기', 'terra.master.nodes.post'], ['SVI 적용', 'terra.daemon.svi.declarations.apply.post'], ['등록 코드', 'terra.master.nodes.enroll-codes.post']]) {
    const g = gate(op, o()); assert.equal(g.open, true, name); assert.equal(g.door, true);
  }
  const closed = gate('terra.master.nodes.post', o({ who: { permissions: ['node.read'] } }));
  assert.deepEqual([closed.open, closed.needs], [false, 'user-perm']); assert.match(closed.why, /node\.control/);
  assert.equal(gate('terra.master.nodes.post', o({ who: { allPermissions: true } })).open, true);
  assert.match(gate('terra.master.nodes.post', o({ who: undefined, ...{ who: {} } })).why, /알 수 없음/);
  // 승인 문이 없는 셸 — 옛 길(위임 표에 없으면 잠금)
  const old = gate('terra.master.nodes.post', o({ door: false })); assert.equal(old.open, false);
  // 다른 노드를 가리킬 수 없는 셸
  assert.equal(gate('terra.daemon.svi.declarations.apply.post', o({ remote: true, approveNode: false })).open, false);
});
