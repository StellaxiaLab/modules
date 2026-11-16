// node --test — 원격 관리 스위치(P15-4): 읽기 보기 · 남은 시간 · 원격 칩 · 문(gate) · 승인 문 경유 전송 · 지도 표시 사본
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteMgmtView, remoteChip, remainText, REMOTE_MANAGE_OPS, needsRemoteManage, REMOTE_SET_HINT } from './remote-management.js';
import { createRemoteMgmtMap } from './remote-mgmt-map.js';
import { createGatewayTransport } from './transport.js';
import { gate } from './gates.js';
import { errorHint } from './error-text.js';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const on1h = { enabled: true, duration: '1h', expires_at: '2026-11-16T10:58:00Z', changed_at: '2026-11-16T09:58:00Z', changed_by: 'maru' };

test('remainText — 분 · 시간 · 계속 · 곧 꺼짐', () => {
  assert.equal(remainText(on1h, NOW), '58분 남음');
  assert.equal(remainText({ enabled: true, duration: '24h', expires_at: '2026-11-17T08:30:00Z' }, NOW), '22시간 30분 남음');
  assert.equal(remainText({ enabled: true, duration: '24h', expires_at: '2026-11-16T11:00:00Z' }, NOW), '1시간 남음');
  assert.equal(remainText({ enabled: true, duration: 'always' }, NOW), '계속');
  assert.equal(remainText({ enabled: true, duration: '1h', expires_at: '2026-11-16T10:00:30Z' }, NOW), '1분 미만 남음');
  assert.equal(remainText({ enabled: true, duration: '1h', expires_at: '2026-11-16T09:59:00Z' }, NOW), '곧 꺼짐');
  assert.equal(remainText({ enabled: false }, NOW), '');
});

test('remoteMgmtView — 켜짐 · 꺼짐 · 읽을 수 없음 · 끝난 기간 · 이전 Terra · 오류 · 받는 중 · 시안', () => {
  const v = remoteMgmtView({ data: on1h }, { now: NOW, canAsk: false });
  assert.equal(v.state, 'ok'); assert.equal(v.on, true); assert.equal(v.status, '허용 중 · 58분 남음'); assert.equal(v.statusCls, 'warn'); assert.equal(v.remain, '58분 남음');
  assert.equal(v.banner, '⚠ 원격 관리 허용 중 — 위험 영역'); assert.match(v.changed, /maru/);
  assert.equal(remoteMgmtView({ data: { enabled: true, duration: 'always' } }, { now: NOW }).status, '허용 중 · 계속');
  const off = remoteMgmtView({ data: { enabled: false, duration: '', expires_at: '' } }, { now: NOW });
  assert.equal(off.on, false); assert.equal(off.off, true); assert.equal(off.known, true); assert.equal(off.status, '꺼짐'); assert.equal(off.banner, '');
  assert.equal(remoteMgmtView({ data: { data: on1h } }, { now: NOW }).on, true);   // 봉투 안
  const un = remoteMgmtView({ data: { enabled: false, unavailable: 'permission denied' } }, { now: NOW });
  assert.equal(un.on, false); assert.match(un.note, /꺼진 것으로 처리 \(permission denied\)/);
  assert.equal(remoteMgmtView({ data: { enabled: true, unavailable: 'x' } }, { now: NOW }).on, false);   // 읽을 수 없으면 켜짐으로 보지 않는다
  const ended = remoteMgmtView({ data: { enabled: true, duration: '1h', expires_at: '2026-11-16T09:59:00Z' } }, { now: NOW });
  assert.equal(ended.on, false); assert.equal(ended.status, '꺼짐');   // 서버가 끈 뒤여도 시계 차이로 켜짐이 남지 않는다
  assert.equal(remoteMgmtView({ data: null, err: { code: 'OPERATION_NOT_FOUND' } }).state, 'unsupported');
  const er = remoteMgmtView({ data: null, err: { code: 'NODE_OFFLINE', msg: '끊김' } }); assert.equal(er.state, 'error'); assert.equal(er.known, false); assert.match(er.note, /NODE_OFFLINE — 끊김/);
  assert.equal(remoteMgmtView({ data: null }).state, 'loading');
  assert.equal(remoteMgmtView({ data: { weird: 1 } }).state, 'error');   // 낯선 응답을 꺼짐으로 읽지 않는다
  assert.equal(remoteMgmtView(null).state, 'sim');
});

test('remoteMgmtView — 단추: 원격이면 이 노드에서만 · 확인 화면이 없으면 터미널 문구, 쓰기 호출 없음', () => {
  const ok = { data: on1h };
  assert.equal(remoteMgmtView(ok, { remote: true, now: NOW }).btnOff, true);
  assert.match(remoteMgmtView(ok, { remote: true, now: NOW }).why, /이 노드에서만/);
  const noScene = remoteMgmtView(ok, { now: NOW, canAsk: false });
  assert.equal(noScene.btnOff, true); assert.ok(noScene.why.includes(REMOTE_SET_HINT));
  assert.ok(REMOTE_SET_HINT.includes('"enabled":true') && REMOTE_SET_HINT.includes('"duration":"1h"'));
  assert.equal(remoteMgmtView(ok, { now: NOW, canAsk: true }).btnOff, false);
});

test('remoteChip — 꺼짐은 잠금 칩 + 이유, 켜짐은 남은 시간, 모르면 잠그지 않는다', () => {
  const off = remoteChip(remoteMgmtView({ data: { enabled: false } }), 'lab-ws-02');
  assert.equal(off.lock, true); assert.equal(off.chip, '원격 관리 꺼짐'); assert.equal(off.why, '잠김 : lab-ws-02 의 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기');
  const on = remoteChip(remoteMgmtView({ data: on1h }, { now: NOW }), 'lab-ws-02');
  assert.equal(on.lock, false); assert.equal(on.chip, '원격 관리 켜짐 · 58분 남음'); assert.equal(on.cls, 'warn');
  for (const rd of [{ data: null, err: { code: 'NODE_OFFLINE' } }, { data: null }, { data: null, err: { code: 'OPERATION_NOT_FOUND' } }, null]) {
    const c = remoteChip(remoteMgmtView(rd)); assert.equal(c.lock, false); assert.equal(c.chip, '');
  }
});

test('REMOTE_MANAGE_OPS — 계약(op-scope.json)의 remote-manage op, 설정 · 재시작 · WireGuard 보고 · 장치', () => {
  assert.ok(REMOTE_MANAGE_OPS.size >= 30, 'size ' + REMOTE_MANAGE_OPS.size);
  for (const op of ['terra.daemon.config.patch', 'terra.daemon.restart.post', 'terra.daemon.wireguard.sync.post', 'terra.daemon.io.scan.post', 'terra.daemon.modules.by-module-id.stop.post']) assert.ok(needsRemoteManage(op), op);
  for (const op of ['terra.daemon.config.get', 'terra.daemon.commands.execute.post', 'terra.daemon.wireguard.apply.post']) assert.ok(!needsRemoteManage(op), op);
});

test('gate — 원격 + 스위치 꺼짐이면 잠김(switch), 켜짐 · 모름이면 열림, 승인 문이 노드를 못 가리키면 잠김(core), 이 노드는 그대로', () => {
  const op = 'terra.daemon.config.patch';
  const off = gate(op, { remote: true, remoteSwitch: 'off', node: 'lab-ws-02' });
  assert.equal(off.open, false); assert.equal(off.needs, 'switch'); assert.equal(off.why, '잠김 : lab-ws-02 의 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기');
  assert.equal(gate(op, { remote: true, remoteSwitch: 'on' }).open, true);
  assert.equal(gate(op, { remote: true }).open, true);   // 모르면 서버가 가른다
  const noNode = gate(op, { remote: true, remoteSwitch: 'on', approveNode: false });
  assert.equal(noNode.open, false); assert.equal(noNode.needs, 'core'); assert.match(noNode.why, /승인 문이 다른 노드를 가리키지 못함/);
  assert.equal(gate(op, { remote: false, remoteSwitch: 'off', approveNode: false }).open, true);   // 이 노드의 쓰기는 스위치와 무관
  assert.equal(gate('terra.daemon.config.get', { remote: true, remoteSwitch: 'off', approveNode: false }).open, true);   // 읽기는 스위치와 무관
  assert.equal(gate('terra.daemon.wireguard.apply.post', { remote: true }).needs, 'local');   // cluster 가 없는 것은 그 노드에서만
});

test('errorHint — REMOTE_MANAGEMENT_DISABLED · APP_REFUSED 문구(§2.5)', () => {
  assert.equal(errorHint('terra.daemon.restart.post', { code: 'REMOTE_MANAGEMENT_DISABLED' }, { node: 'lab-ws-02' }), 'lab-ws-02 의 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기');
  assert.equal(errorHint('terra.daemon.restart.post', { code: 'REMOTE_MANAGEMENT_APP_REFUSED' }), '원격 관리는 사람만 — 승인 문으로');
});

test('전송 — 원격 관리 op 를 다른 노드에 쓰면 승인 문으로, 이 노드 · 읽기는 앱 토큰 그대로', async () => {
  const calls = [], approvals = [];
  const terra = { invoke: async (op, inp, at) => { calls.push([op, inp, at]); return op.includes('nodes.get') ? [{ node_id: 'nd-b', display_name: 'B' }] : { ok: true }; } };
  const mk = (approveRemote) => { const t = createGatewayTransport({ terra, approveRemote, localRid: () => 'nd-a' }); t.bindScene('A', [{ id: 'A', name: 'A', rid: 'nd-a' }, { id: 'B', name: 'B', rid: 'nd-b' }]); return t; };
  const t = mk(async (op, inp, node) => { approvals.push([op, inp, node]); return { ok: true, status: 200, data: { saved: 1 }, withheld: [] }; });
  assert.deepEqual(await t.invoke('B', 'terra.daemon.config.patch', { set: { a: 1 } }), { saved: 1 });
  assert.deepEqual(approvals, [['terra.daemon.config.patch', { set: { a: 1 } }, 'nd-b']]);
  assert.equal(calls.some((c) => c[0] === 'terra.daemon.config.patch'), false, '앱 토큰으로 보내지 않는다');
  await t.invoke('A', 'terra.daemon.config.patch', { set: {} });   // 이 노드 — 승인 문 없이
  await t.invoke('B', 'terra.daemon.config.get', {});             // 읽기 — 승인 문 없이
  assert.equal(approvals.length, 1);
  assert.deepEqual(calls.filter((c) => c[0] === 'terra.daemon.config.patch')[0][2], {}); assert.deepEqual(calls.filter((c) => c[0] === 'terra.daemon.config.get')[0][2], { node: 'nd-b' });
  // 거절 · 만료 · 문 없음 — TerraError 로(화면이 §2.5 문구로, 거절은 조용히)
  for (const code of ['APPROVAL_DECLINED', 'APPROVAL_EXPIRED', 'APPROVAL_UNAVAILABLE', 'REMOTE_MANAGEMENT_DISABLED']) {
    const t2 = mk(async () => ({ ok: false, code, message: 'm', status: 403 }));
    await assert.rejects(t2.invoke('B', 'terra.daemon.restart.post', {}), (e) => e.code === code);
  }
  // 승인 문 연결이 없으면 앱 토큰으로 그대로(Gateway 가 REMOTE_MANAGEMENT_APP_REFUSED 로 답한다)
  const n0 = calls.length; await mk(undefined).invoke('B', 'terra.daemon.restart.post', {}); assert.equal(calls.length > n0, true);
});

test('지도 표시 사본 — 켜짐만 표시, 모름 · 끊김은 표시하지 않고, TTL 안에서는 다시 묻지 않는다', async () => {
  let t = NOW, asked = [], changes = 0; const data = { 'nd-1': on1h, 'nd-2': { enabled: false }, 'nd-4': { weird: 1 } };
  const m = createRemoteMgmtMap({ now: () => t, onChange: () => { changes++; }, read: async (rid) => { asked.push(rid); if (rid === 'nd-3') throw Object.assign(new Error('x'), { code: 'NODE_OFFLINE' }); return data[rid]; } });
  assert.equal(m.on('nd-1'), false); assert.equal(m.get('nd-1').state, 'loading');   // 받는 동안은 표시하지 않는다
  for (const r of ['nd-2', 'nd-3', 'nd-4']) m.get(r);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(m.on('nd-1'), true); assert.equal(m.on('nd-2'), false);
  assert.equal(m.get('nd-3').state, 'err'); assert.equal(m.on('nd-3'), false);
  assert.equal(m.get('nd-4').state, 'err');   // 낯선 응답은 꺼짐이 아니라 모름
  assert.equal(m.get('nd-1').remain, '58분 남음'); assert.ok(changes >= 4);
  const n = asked.length; t += 30000; m.on('nd-1'); await new Promise((r) => setTimeout(r, 5)); assert.equal(asked.length, n);
  t += 31000; m.on('nd-1'); await new Promise((r) => setTimeout(r, 5)); assert.equal(asked.filter((x) => x === 'nd-1').length, 2);   // 낡으면 다시
  assert.equal(m.get(''), undefined);
});

test('웹 코드 — 원격 관리 스위치 쓰기(.post)를 부르지 않는다(안내 문구 한 곳만)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url)), hits = [];
  const scan = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['build', 'archive', 'node_modules', 'dist', 'tests'].includes(e.name)) scan(p); continue; }
    if (/\.test\.mjs$/.test(e.name) || !/\.(js|mjs|html)$/.test(e.name)) continue;
    if (readFileSync(p, 'utf8').includes('remote-management.post')) hits.push(p.slice(root.length).replace(/\\/g, '/'));
  } };
  scan(join(root, 'src')); scan(join(root, 'design'));
  assert.deepEqual(hits, ['src/api/remote-management.js']);
});
