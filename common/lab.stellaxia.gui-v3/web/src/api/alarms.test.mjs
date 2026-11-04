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

test('읽음 · 지우기 · 거르기 — 순수 함수', async () => {
  const { addAlarms, filterAlarms, countAlarms, markRead, clearAlarms, alarmKey } = await import('./alarms.js');
  const A = [{ at: 1, kind: 'task', id: 't1', st: 'failed', sev: 'bad', m: 'a' }, { at: 2, kind: 'module', id: 'm', st: 'running', sev: 'ok', m: 'b' }, { at: 3, kind: 'task', id: 't2', st: 'succeeded', sev: 'ok', m: 'c' }];
  let L = addAlarms([], A, 2);
  assert.deepEqual(L.map((a) => a.id), ['t2', 'm']);   // 나중 것이 위 · keep 개까지
  assert.equal(L[0].read, false); assert.equal(L[0].key, alarmKey(A[2]));
  L = addAlarms(L, [A[0]], 5);
  assert.deepEqual(countAlarms(L), { all: 3, task: 2, module: 1, bad: 1, unread: 3 });
  assert.deepEqual(filterAlarms(L, 'bad').map((a) => a.id), ['t1']);
  const L2 = markRead(L, L[0].key);
  assert.equal(L[0].read, false); assert.equal(L2[0].read, true);   // 원본은 그대로
  assert.equal(countAlarms(L2).unread, 2);
  assert.equal(countAlarms(markRead(L, '*')).unread, 0);
  assert.equal(countAlarms(markRead(L, filterAlarms(L, 'task').map((a) => a.key))).unread, 1);
  assert.deepEqual(clearAlarms(L, L[1].key).map((a) => a.id), ['t1', 'm']);
  assert.deepEqual(clearAlarms(L, '*'), []);
  assert.notEqual(alarmKey({ kind: 'task', id: 'x', at: 1, st: 'failed' }), alarmKey({ kind: 'task', id: 'x', at: 1, st: 'succeeded' }));
});

test('알림 책 — 같은 배열을 고쳐 쓰고, 바뀌면 onChange', async () => {
  const { createAlarmBook } = await import('./alarms.js');
  let n = 0; const B = createAlarmBook({ keep: 3, onChange: () => n++ }), ref = B.list;
  B.add([{ at: 1, kind: 'task', id: 'a', st: 'failed', sev: 'bad', m: 'x' }, { at: 1, kind: 'task', id: 'b', st: 'failed', sev: 'bad', m: 'y' }]);
  assert.equal(B.list, ref); assert.equal(ref.length, 2); assert.equal(B.unread(), 2); assert.equal(n, 1);
  B.read(ref[0].key); assert.equal(B.unread(), 1); assert.equal(n, 2);
  B.clear('*'); assert.equal(ref.length, 0); assert.equal(n, 3);
  B.add([]); assert.equal(n, 3);   // 새 것이 없으면 조용히
});

test('diff — 심각도 · 상태 · 대상 이름을 단다', () => {
  const a = diff(null, { tasks: [{ id: 't', type: 'svi.bind', state: 'running' }] }, { modules: [{ id: 'm', name: 'Agent', state: 'running' }] });
  const b = diff(a.next, { tasks: [{ id: 't', type: 'svi.bind', state: 'canceled' }] }, { modules: [{ id: 'm', name: 'Agent', state: 'failed' }] });
  assert.deepEqual(b.alarms.map((x) => [x.kind, x.sev, x.st, x.name]), [['task', 'warn', 'canceled', 'svi.bind'], ['module', 'bad', 'failed', 'Agent']]);
});
