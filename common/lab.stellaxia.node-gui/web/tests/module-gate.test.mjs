// MD-38 — 모듈이 없는 노드에서 그 모듈의 operation 을 부르지 않는다 (src/api/module-gate.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { modulesResult, installedModuleIds, invokeIfModule, MODULE_OF } from '../src/api/module-gate.js';
import { resultText } from '../src/api/client.js';

function fakeClient(modules) {
  const calls = [];
  return {
    calls,
    async invoke(op, input) {
      calls.push(op);
      if (op === 'terra.daemon.modules.get') return modules ? { kind: 'ok', data: { modules: modules.map((id) => ({ id })) } } : { kind: 'down', status: 503, reason: 'LOCAL_API_UNAVAILABLE' };
      return { kind: 'ok', data: { devices: [] } };
    }
  };
}

test('모듈이 없으면 부르지 않고 no-module 로 답한다', async () => {
  const c = fakeClient(['io.terra.scene.terra']);
  const r = await invokeIfModule(c, MODULE_OF['terra.daemon.io.devices.get'], 'terra.daemon.io.devices.get', {});
  assert.deepEqual([r.kind, r.reason], ['unavailable', 'no-module']);
  assert.deepEqual(c.calls, ['terra.daemon.modules.get'], 'io.devices.get 은 나가지 않았다');
  assert.match(resultText(r), /설치되어 있지 않다/);
});

test('모듈이 있으면 부른다', async () => {
  const c = fakeClient(['io.terra.io-inventory', 'io.terra.file']);
  const a = await invokeIfModule(c, 'io.terra.io-inventory', 'terra.daemon.io.devices.get', {});
  const b = await invokeIfModule(c, 'io.terra.file', 'terra.daemon.files.list.get', {});
  assert.deepEqual([a.kind, b.kind], ['ok', 'ok']);
  assert.deepEqual(c.calls, ['terra.daemon.modules.get', 'terra.daemon.io.devices.get', 'terra.daemon.files.list.get']);
});

test('modules.get 은 15초 동안 한 번만 — 첫 화면과 설정 보드가 함께 쓴다', async () => {
  const c = fakeClient(['io.terra.file']);
  await Promise.all([invokeIfModule(c, 'io.terra.file', 'terra.daemon.files.list.get', {}), invokeIfModule(c, 'io.terra.io-inventory', 'terra.daemon.io.devices.get', {}), modulesResult(c)]);
  assert.equal(c.calls.filter((x) => x === 'terra.daemon.modules.get').length, 1);
  const real = Date.now;
  try {
    Date.now = () => real() + 16000;
    await modulesResult(c);
  } finally { Date.now = real; }
  assert.equal(c.calls.filter((x) => x === 'terra.daemon.modules.get').length, 2, '15초가 지나면 다시 본다');
});

test('modules.get 을 못 받으면 막지 않는다 — 부르고 서버가 판정한다', async () => {
  const c = fakeClient(null);
  assert.equal(await installedModuleIds(c), null);
  const r = await invokeIfModule(c, 'io.terra.file', 'terra.daemon.files.list.get', {});
  assert.equal(r.kind, 'ok');
  assert.ok(c.calls.includes('terra.daemon.files.list.get'));
});

test('LOCAL_API_UNAVAILABLE 503 은 모듈이 시작하지 않았거나 없다고 말한다', () => {
  assert.match(resultText({ kind: 'down', status: 503, reason: 'LOCAL_API_UNAVAILABLE' }), /시작하지 않았거나 설치되어 있지 않다/);
});
