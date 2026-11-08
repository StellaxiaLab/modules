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
  assert.equal(gate('io.terra.file.transfers.create').open, true);
  assert.equal(gateAll(['terra.master.jobs.get', 'terra.master.svi.handles.post']).op, 'terra.master.svi.handles.post');
  assert.equal(gateAll(['terra.master.jobs.get']).open, true);
  assert.equal(riskOf('terra.daemon.commands.execute.post'), 'dangerous');
});

test('denyHint — 계정 권한 없음(module.manage), Master 표 조회', () => {
  const up = 'terra.daemon.modules.by-module-id.uninstall.post';
  assert.equal(denyHint(up, { code: 'MODULE_PERMISSION_DENIED' }), '계정 권한 없음 : module.manage — Tree 관리자에게 요청');
  assert.equal(denyHint(up, { status: 403 }), '계정 권한 없음 : module.manage — Tree 관리자에게 요청');
  assert.equal(denyHint(up, { code: 'FORBIDDEN' }), '계정 권한 없음 : module.manage — Tree 관리자에게 요청');
  const mop = Object.keys(JSON.parse(readFileSync(fileURLToPath(new URL('./master-delegated.json', import.meta.url)), 'utf8')).operations).find((o) => !o.startsWith('terra.daemon.'));
  const perms = JSON.parse(readFileSync(fileURLToPath(new URL('./master-delegated.json', import.meta.url)), 'utf8')).operations[mop].permissions || [];
  if (perms.length) assert.equal(denyHint(mop, { code: 'FORBIDDEN' }), '계정 권한 없음 : ' + perms.join(' · ') + ' — Tree 관리자에게 요청');
});

test('denyHint — 위임 안 됨 / 표에 없는 403 / 그 밖은 비어 있다', () => {
  assert.equal(denyHint('terra.master.network.probes.post', { code: 'DELEGATION_NOT_OPEN' }), '앱에 위임 안 됨 — 터미널(terra CLI)에서 가능');
  assert.equal(denyHint('io.terra.unknown.op', { code: 'MODULE_PERMISSION_DENIED' }), '');
  assert.equal(denyHint('io.terra.unknown.op', { status: 403 }), '');
  assert.equal(denyHint('terra.daemon.modules.by-module-id.uninstall.post', { code: 'MODULE_NOT_FOUND' }), '');
  assert.equal(denyHint('terra.daemon.modules.by-module-id.uninstall.post', null), '');
  assert.equal(denyHint('terra.daemon.modules.by-module-id.uninstall.post', new Error('x')), '');
});
