// node --test — 이벤트 스트림 → 사본 다시 받기
import test from 'node:test';
import assert from 'node:assert/strict';
import { resourcesFor, startPush } from './push.js';

test('resourcesFor — 이벤트 이름으로 다시 받을 자원', () => {
  assert.deepEqual(resourcesFor({ type: 'module.state_changed' }).sort(), ['desk', 'modules']);
  assert.deepEqual(resourcesFor({ type: 'io.device.added' }).sort(), ['desk', 'devices']);
  assert.deepEqual(resourcesFor({}), ['desk']);
});

test('startPush — 몰려온 이벤트는 한 번에, 사본이 있는 자원만, 끊기면 다시 연다', async () => {
  const calls = [], refreshed = []; let onMsg, onClose, opens = 0;
  const terra = { stream: async (id, input, m, c) => { opens++; calls.push(id); onMsg = m; onClose = c; return () => {}; } };
  const store = { t: { localId: () => 'L' }, cache: new Map([['L|modules', {}], ['L|desk', {}]]), refresh: (n, r) => refreshed.push(n + '|' + r) };
  const P = startPush({ terra, store: () => store, delayMs: 5 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['terra.daemon.events.get']);
  onMsg({ type: 'module.started' }); onMsg({ type: 'module.stopped' }); onMsg({ type: 'task.done' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(refreshed.sort(), ['L|desk', 'L|modules']);   // tasks 는 사본이 없어 부르지 않는다
  P.stop(); onClose(); assert.equal(opens, 1);   // 멈춘 뒤엔 다시 열지 않는다
});
