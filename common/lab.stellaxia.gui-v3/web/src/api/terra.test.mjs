// node --test — operation 호출 · 원격 잠금 · 셸 인자
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerra, canRemote, permissionsOf, shellArg, moduleInstallCommand, TerraError } from './terra.js';

test('canRemote — 계약 scopes 에 cluster 가 없으면 그 노드에서만', () => {
  assert.equal(canRemote('terra.daemon.commands.execute.post'), false);
  assert.equal(canRemote('terra.daemon.config.patch'), false);
  assert.equal(canRemote('terra.daemon.modules.by-module-id.start.post'), true);
  assert.equal(canRemote('lab.stellaxia.gui-v3.status.get'), true);   // 표에 없는 것은 막지 않는다
  assert.deepEqual(permissionsOf('terra.daemon.commands.execute.post'), ['process.execute']);
});

test('invoke — 이 노드 · 다른 노드 경로, 봉투 풀기, 오류', async () => {
  const calls = [];
  const fetch = async (path, init) => { calls.push([path, JSON.parse(init.body), init.headers.authorization]);
    if (path.includes('bad')) return new Response(JSON.stringify({ status: 'error', error: { code: 'NOPE', message: 'x' } }), { status: 403 });
    return new Response(JSON.stringify({ status: 'ok', data: { ok: 1 } }), { status: 200 }); };
  const T = createTerra({ fetch, token: () => 'tk' });
  assert.deepEqual(await T.invoke('terra.daemon.modules.get', { a: 1 }), { ok: 1 });
  await T.invoke('terra.daemon.modules.get', {}, { node: 'nd 1' });
  assert.deepEqual(calls.map((c) => c[0]), ['/api/v1/operations/terra.daemon.modules.get/invoke', '/api/v1/nodes/nd%201/operations/terra.daemon.modules.get/invoke']);
  assert.equal(calls[0][2], 'Bearer tk');
  await assert.rejects(T.invoke('bad.op'), (e) => e instanceof TerraError && e.code === 'NOPE' && e.status === 403);
  await assert.rejects(T.invoke('terra.daemon.config.patch', {}, { node: 'n' }), { code: 'LOCAL_ONLY' });
  assert.equal(calls.length, 3);   // 잠긴 호출은 나가지 않는다
});

test('shellArg · moduleInstallCommand — 빈칸 든 경로를 셸에 맞게 감싼다', () => {
  assert.equal(shellArg('/tmp/a.tmod', 'posix'), '/tmp/a.tmod');
  assert.equal(shellArg("/tmp/my mod's.tmod", 'posix'), "'/tmp/my mod'\\''s.tmod'");
  assert.equal(shellArg('C:\\Users\\me\\My Mods\\a.tmod', 'windows'), '"C:\\Users\\me\\My Mods\\a.tmod"');
  const c = moduleInstallCommand('/home/u/모듈 a.tmod', { digest: 'sha256:ab', dev: true, start: true }, 'posix');
  assert.equal(c.command, 'terra');
  assert.deepEqual(c.args, ['module', 'install', "'/home/u/모듈 a.tmod'", '--grant-reviewed', 'sha256:ab', '--dev', '--start']);
});
