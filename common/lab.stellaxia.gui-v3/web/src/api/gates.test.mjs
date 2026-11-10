// node --test — 문(gate): 코어가 열어 준 것만 열리고, 닫힌 것은 누가 무엇을 열어야 하는지 적는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gate, gateAll, APP_PERMS, riskOf, denyHint } from './gates.js';

test('APP_PERMS = module.json 의 앱 권한', () => {
  const M = JSON.parse(readFileSync(fileURLToPath(new URL('../../../module.json', import.meta.url)), 'utf8'));
  const app = M.contributions.gui.apps.find((a) => a.id === 'lab.stellaxia.gui-v3.web');
  assert.deepEqual([...APP_PERMS].sort(), [...app.permissions].sort());
});

test('Master — 위임 표에 있으면 열림, 없으면 코어', () => {
  assert.equal(gate('terra.master.jobs.get').open, true);
  const g = gate('terra.master.network.probes.post'); assert.equal(g.open, false); assert.equal(g.needs, 'core'); assert.equal(g.why, '잠김 : 위임 없음 — terra.master.network.probes.post');
  assert.equal(gate('terra.master.service-tunnels.open.post').needs, 'core');
  assert.equal(gate('terra.master.svi.handles.post').needs, 'core');
});

test('Daemon — 앱 권한 · 이 노드에서만 · 사람 권한', () => {
  const e = gate('terra.daemon.enrollment.code.post'); assert.equal(e.needs, 'app-perm'); assert.equal(e.why, '잠김 : 앱 권한 없음 — node.enroll');
  assert.equal(gate('terra.daemon.tasks.by-task-id.output.events.get').open, true);
  assert.equal(gate('terra.daemon.tasks.by-task-id.output.events.get', { remote: true }).needs, 'local');
  assert.equal(gate('terra.daemon.tasks.by-task-id.output.events.get', { remote: true }).why, '잠김 : 이 노드에서만');
  assert.equal(gate('terra.daemon.tasks.get', { remote: true }).open, true);
  const u = gate('terra.daemon.config.patch', { who: { permissions: ['node.read'] } }); assert.equal(u.needs, 'user-perm'); assert.equal(u.why, '잠김 : 계정 권한 없음 — node.config');
  assert.equal(gate('terra.daemon.nope.get').needs, 'core'); assert.equal(gate('terra.daemon.nope.get').why, '잠김 : 계약 없음 — terra.daemon.nope.get');
});

test('모듈 op 는 막지 않는다 · gateAll 은 처음 닫힌 이유', () => {
  assert.equal(gate('lab.stellaxia.file.transfers.create').open, true);
  assert.equal(gateAll(['terra.master.jobs.get', 'terra.master.svi.handles.post']).op, 'terra.master.svi.handles.post');
  assert.equal(gateAll(['terra.master.jobs.get']).open, true);
  assert.equal(riskOf('terra.daemon.commands.execute.post'), 'dangerous');
});

test('denyHint — 계정 권한 없음(module.manage), Master 표 조회', () => {
  const up = 'terra.daemon.modules.by-module-id.uninstall.post', W = '계정 권한 없음 : module.manage — Tree 관리자에게 요청';
  assert.equal(denyHint(up, { code: 'MODULE_PERMISSION_DENIED' }), W);
  assert.equal(denyHint(up, { code: 'FORBIDDEN', message: 'permission module.manage is required' }), W);
  assert.equal(denyHint(up, { code: 'HTTP_403', status: 403 }), W);
  assert.equal(denyHint(up, { status: 403 }), W);
  const ops = JSON.parse(readFileSync(fileURLToPath(new URL('./master-delegated.json', import.meta.url)), 'utf8')).operations;
  const mop = Object.keys(ops).find((o) => o.startsWith('terra.master.') && (ops[o].permissions || []).length);
  assert.ok(mop, 'permissions 가 있는 Master op');
  assert.equal(denyHint(mop, { code: 'MODULE_PERMISSION_DENIED' }), '계정 권한 없음 : ' + ops[mop].permissions.join(' · ') + ' — Tree 관리자에게 요청');
});

test('denyHint — 위임 안 됨 / 정책·소유권 거부 / 표에 없는 403 / 그 밖은 비어 있다', () => {
  const up = 'terra.daemon.modules.by-module-id.uninstall.post';
  assert.equal(denyHint('terra.master.network.probes.post', { code: 'DELEGATION_NOT_OPEN' }), '앱에 위임 안 됨 — 터미널(terra CLI)에서 가능');
  assert.equal(denyHint(up, { code: 'FORBIDDEN', message: 'master administrator access is required' }), '');
  assert.equal(denyHint(up, { code: 'SVI_DECLARATION_OUTSIDE_ENVELOPE', status: 403 }), '');
  assert.equal(denyHint('io.terra.unknown.op', { code: 'MODULE_PERMISSION_DENIED' }), '');
  assert.equal(denyHint('io.terra.unknown.op', { status: 403 }), '');
  assert.equal(denyHint(up, { code: 'MODULE_NOT_FOUND' }), '');
  assert.equal(denyHint(up, null), '');
  assert.equal(denyHint(up, new Error('x')), '');
});

test('Terra 에 구현 없는 op · 앱 토큰에 닫힌 위임 문 · 없는 권한 — 잠금 + 이유(호출하지 않는다)', () => {
  for (const [op, re] of [['enable', /구현 없음/], ['disable', /구현 없음/], ['rollback', /구현 없음/]]) { const g = gate('terra.gateway.modules.by-id.' + op + '.post'); assert.equal(g.open, false); assert.match(g.why, re); }
  assert.match(gate('terra.gateway.modules.by-id.disable.post').why, /멈춤/);
  assert.equal(gate('terra.daemon.svi.declarations.apply.post').open, false);
  assert.equal(gate('terra.daemon.svi.declarations.retired.by-family.by-name.forget.post').open, false);
  assert.equal(gate('terra.daemon.svi.declarations.post', { family: 'file' }).open, true);
  assert.equal(gate('terra.daemon.svi.declarations.post', { family: 'net' }).open, false);
  assert.equal(gate('terra.daemon.svi.declarations.post', { family: 'file', remote: true }).open, false);
  const r = gate('terra.master.jobs.by-job-id.rerun.post'); assert.equal(r.open, false); assert.match(r.why, /앱 토큰에 없는 권한 — process\.execute\.delegated/);
});

test('AUD-81 — 사람 권한(whoami)을 모르면 쓰기는 닫는다(who 키를 준 호출만 · 읽기는 연다)', () => {
  assert.equal(gate('terra.daemon.config.patch', { who: null }).open, false);
  assert.equal(gate('terra.daemon.config.patch', { who: {} }).open, false);
  assert.match(gate('terra.daemon.config.patch', { who: null }).why, /whoami/);
  assert.equal(gate('terra.daemon.tasks.get', { who: null }).open, true);
  assert.equal(gate('terra.master.nodes.by-node-id.modules.assignments.post', { who: null }).open, false);
  assert.equal(gate('terra.daemon.config.patch', { who: { permissions: ['node.config'] } }).open, true);
  assert.equal(gate('terra.daemon.config.patch').open, true, 'who 키가 없으면(시안 · 시험) 조회하지 않는다');
});
