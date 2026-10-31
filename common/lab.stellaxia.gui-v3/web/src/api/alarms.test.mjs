// node --test — 알림: 작업 · 모듈 상태가 바뀐 것만, 처음 읽은 것은 알리지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, startAlarms } from './alarms.js';

test('diff — 처음은 조용히, 바뀐 끝 상태만 알림', () => {
  const a = diff(null, { tasks: [{ id: 't1', type: 'module.install', state: 'running' }] }, { modules: [{ id: 'm', state: 'running' }] });
  assert.deepEqual(a.alarms, []);
  const b = diff(a.next, { tasks: [{ id: 't1', type: 'module.install', state: 'failed' }, { id: 't2', state: 'succeeded' }] }, { modules: [{ id: 'm', name: '에이전트', state: 'failed', last_error: 'exit 1' }] }, 5);
  assert.deepEqual(b.alarms.map((x) => x.m), ['작업 module.install 실패', '작업 t2 완료', '모듈 에이전트 — failed · exit 1']);
  assert.equal(b.alarms[0].at, 5);
  const c = diff(b.next, { tasks: [{ id: 't1', state: 'failed' }] }, { modules: [{ id: 'm', name: '에이전트', state: 'running' }] });
  assert.deepEqual(c.alarms.map((x) => x.m), ['모듈 에이전트 다시 돈다']);   // 같은 실패는 다시 알리지 않는다
});

test('diff — 새로 생긴 모듈이 처음부터 실패면 알리지 않는다(앞 상태가 없다)', () => {
  const a = diff(diff(null, [], { modules: [] }).next, [], { modules: [{ id: 'n', state: 'failed' }] });
  assert.deepEqual(a.alarms, []);
});

test('startAlarms — 주기적으로 읽고 onAlarm 으로, 한쪽을 못 받으면 그쪽은 앞 상태 그대로', async () => {
  let st = 'running', modsFail = false; const got = [];
  const terra = { invoke: async (op) => { if (op === 'terra.daemon.tasks.get') return { tasks: [{ id: 't', state: st }] }; if (modsFail) throw { code: 'X' }; return { modules: [{ id: 'm', state: 'running' }] }; } };
  const A = startAlarms({ terra, onAlarm: (a) => got.push(a.m), intervalMs: 5 });
  await new Promise((r) => setTimeout(r, 15));
  st = 'succeeded'; modsFail = true; A.poke();
  await new Promise((r) => setTimeout(r, 20));
  modsFail = false; await new Promise((r) => setTimeout(r, 20));
  A.stop();
  assert.deepEqual(got, ['작업 t 완료']);
  assert.equal(A.list[0].m, '작업 t 완료');
});
