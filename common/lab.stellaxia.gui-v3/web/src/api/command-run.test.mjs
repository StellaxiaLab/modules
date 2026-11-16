import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, planCommand, runPlan, LOCAL_OP, REMOTE_OP, EXEC_TYPE } from './command-run.js';
import { createConfirmationBook, rowOf } from './confirmations.js';

test('한 줄 → 명령 + 인자 — 따옴표는 한 낱말, 빈 줄 · 닫히지 않은 따옴표는 오류', () => {
  assert.deepEqual(parseLine('ls -la "my dir"'), { command: 'ls', args: ['-la', 'my dir'], error: '' });
  assert.equal(parseLine('  ').error, '명령을 입력');
  assert.match(parseLine('echo "x').error, /따옴표/);
  assert.deepEqual(parseLine("echo ''").args, ['']);
});

const ME = { permissions: ['process.execute'] };

test('이 노드 — T2 확인 창(실행 전 확인) · 스위치 꺼짐이면 잠금', () => {
  const p = planCommand({ line: 'hostname', local: true, switchState: 'on', who: ME });
  assert.deepEqual([p.kind, p.tier, p.op], ['confirm', 'T2', LOCAL_OP]);
  assert.deepEqual(p.input, { command: 'hostname', args: [], timeout_sec: 60 }); assert.match(p.reversible, /되돌릴 수 없음/);
  const off = planCommand({ line: 'hostname', local: true, switchState: 'off', who: ME, nodeName: 'desk' });
  assert.equal(off.kind, 'locked'); assert.match(off.why, /desk 의 '웹 앱 명령 실행'이 꺼져 있음/);
});

test('다른 노드 — T3 승인 문 · 대상 스위치 · 계정 권한 · 승인 문 유무', () => {
  const base = { line: 'df -h', local: false, nodeId: 'n-2', nodeName: 'rdk', switchState: 'on', who: ME, canApprove: true };
  const p = planCommand(base);
  assert.deepEqual([p.kind, p.tier, p.op], ['approve', 'T3', REMOTE_OP]);
  assert.deepEqual(p.input, { target_node_id: 'n-2', type: EXEC_TYPE, payload: { command: 'df', args: ['-h'], timeout_sec: 60 } });
  assert.deepEqual(planCommand({ ...base, hold: true }).input.options, { require_confirmation: true });
  assert.match(planCommand({ ...base, switchState: 'off' }).why, /rdk 의 '웹 앱 명령 실행'이 꺼져 있음/);
  assert.match(planCommand({ ...base, switchState: 'unknown' }).why, /알 수 없음/);
  assert.match(planCommand({ ...base, who: { permissions: ['node.read'] } }).why, /process\.execute/);
  assert.match(planCommand({ ...base, canApprove: false }).why, /승인 문 없음/);
  assert.equal(planCommand({ ...base, nodeId: '' }).kind, 'locked');
  assert.equal(planCommand({ ...base, who: { allPermissions: true } }).kind, 'approve');
});

test('실행 — locked 는 부르지 않고, 붙잡힌 명령은 확인 id 를 돌려준다', async () => {
  const calls = [];
  const locked = await runPlan(planCommand({ line: '', local: true }), async () => { calls.push(1); });
  assert.equal(locked.ok, false); assert.equal(calls.length, 0);
  const plan = planCommand({ line: 'rm x', local: false, nodeId: 'n', hold: true, canApprove: true, who: { allPermissions: true } });
  const r = await runPlan(plan, async (op, input) => { calls.push([op, input]); return { status: 'confirmation_required', confirmation_id: 'c-1' }; });
  assert.deepEqual([r.ok, r.held, r.confirmationId], [true, true, 'c-1']); assert.equal(calls[0][0], REMOTE_OP);
  const bad = await runPlan(plan, async () => { const e = new Error('x'); e.code = 'APPROVAL_DECLINED'; throw e; });
  assert.deepEqual([bad.ok, bad.code], [false, 'APPROVAL_DECLINED']);
});

const view = (o) => ({ confirmation_id: 'c-1', action: 'process.execute.request', target_node_id: 'n-2', payload: { command: 'rm', args: ['x'] }, status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString(), ...o });

test('확인 대기 행 — 명령 요약 · 만료는 대기에서 빠진다', () => {
  const r = rowOf(view({})); assert.deepEqual([r.summary, r.open, r.text], ['rm x', true, '대기 중']);
  const old = rowOf(view({ expires_at: new Date(Date.now() - 1000).toISOString() })); assert.deepEqual([old.status, old.open], ['expired', false]);
  assert.equal(rowOf(view({ status: 'rejected' })).open, false);
});

test('확인 대기 목록 — 읽기 · 거절(곧장) · 승인(승인 문) · 실패 문구', async () => {
  const state = { 'c-1': view({}), 'c-2': view({ confirmation_id: 'c-2' }) }, log = [];
  const book = createConfirmationBook({
    get: async (id) => { if (!state[id]) { const e = new Error('x'); e.code = 'CONFIRMATION_NOT_FOUND'; throw e; } return state[id]; },
    reject: async (id) => { log.push(['reject', id]); state[id] = view({ confirmation_id: id, status: 'rejected' }); },
    approve: async (id) => { log.push(['approve', id]); return id === 'c-2' ? { ok: false, code: 'APPROVAL_DECLINED', text: '' } : (state[id] = view({ confirmation_id: id, status: 'approved' }), { ok: true, data: { job_id: 'j' } }); },
  });
  let ticks = 0; book.onChange(() => ticks++);
  assert.equal(book.add('c-1'), true); assert.equal(book.add('c-1'), false); book.add('c-2'); book.add('c-x');
  assert.equal(book.list()[0].text, '읽는 중…');
  await book.refresh(); assert.equal(book.pending().length, 2);
  assert.match(book.list().find((r) => r.id === 'c-x').text, /읽지 못함 : CONFIRMATION_NOT_FOUND/);
  assert.deepEqual(await book.approve('c-1'), { ok: true, data: { job_id: 'j' } });
  const dec = await book.approve('c-2'); assert.deepEqual([dec.ok, dec.code], [false, 'APPROVAL_DECLINED']);
  assert.deepEqual(await book.reject('c-2'), { ok: true });
  assert.equal(book.pending().length, 0); assert.ok(ticks > 3);
  book.remove('c-x'); assert.equal(book.ids().length, 2);
  assert.deepEqual(log, [['approve', 'c-1'], ['approve', 'c-2'], ['reject', 'c-2']]);
});
