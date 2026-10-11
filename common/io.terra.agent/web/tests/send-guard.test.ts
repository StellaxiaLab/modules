import { describe, expect, it } from 'vitest';
import { createAgentClient } from '../src/api/client';
import { evaluateSend, guardedSend, looksLikeApprovalAnswer } from '../src/data/send-guard';
import { failResult, fakeCall, okResult, pend, snap } from './helpers';

describe('승인 답으로 읽히는 글(함정 6) — loop.go answerText 와 같다', () => {
  it.each(['y', 'n', 'yes', 'no', 'approve', 'deny', 'Y', 'YES', ' Approve ', 'approve apr_1', 'deny apr_1', 'y whatever', 'n\tapr_2'])('%j 는 답으로 읽힌다', (text) => {
    expect(looksLikeApprovalAnswer(text)).toBe(true);
  });
  it.each(['ok', '네', '승인', '', '   ', 'approved', 'approve apr_1 now', 'yes, do it', 'no way jose', 'yes, please'])('%j 는 읽히지 않는다', (text) => {
    expect(looksLikeApprovalAnswer(text)).toBe(false);
  });
  it('두 토큰이면 둘째가 무엇이든 읽힌다 — "yes please" 도 승인 답이다', () => {
    expect(looksLikeApprovalAnswer('yes please')).toBe(true);
  });
});

describe('evaluateSend — 보내기 직전 가드', () => {
  it('대기 승인이 있으면 어떤 글도 막는다("y" 가 승인이 되지 않게)', () => {
    const v = evaluateSend('y', snap({ state: 'waiting-approval', pending_approvals: [pend('apr_1')] }));
    expect(v).toMatchObject({ allow: false, reason: 'pending-approval' });
  });
  it('stale 한 idle 이어도 pending 이 있으면 막는다', () => {
    expect(evaluateSend('hello', snap({ state: 'idle', pending_approvals: [pend('a')] }))).toMatchObject({ allow: false, reason: 'pending-approval' });
  });
  it('확인하지 못했으면(스냅샷 없음) 막는다', () => {
    expect(evaluateSend('hello', null)).toMatchObject({ allow: false, reason: 'unverified' });
    expect(evaluateSend('hello', undefined)).toMatchObject({ allow: false, reason: 'unverified' });
  });
  it('waiting-approval 은 pending 이 비어도 막는다(질문 시간 초과 직후 모델이 도는 구간)', () => {
    expect(evaluateSend('hello', snap({ state: 'waiting-approval', pending_approvals: [] }))).toMatchObject({ allow: false, reason: 'waiting-approval' });
  });
  it('running → busy, 종료 상태 → finished, 알 수 없는 상태 → unknown-state', () => {
    expect(evaluateSend('hi', snap({ state: 'running' }))).toMatchObject({ allow: false, reason: 'busy' });
    for (const state of ['done', 'cancelled', 'failed', 'archived'] as const) expect(evaluateSend('hi', snap({ state }))).toMatchObject({ allow: false, reason: 'finished' });
    expect(evaluateSend('hi', snap({ state: 'weird' as never }))).toMatchObject({ allow: false, reason: 'unknown-state' });
  });
  it('빈 글·20000자 초과는 막는다(코드 포인트로 센다)', () => {
    expect(evaluateSend('   ', snap())).toMatchObject({ allow: false, reason: 'empty' });
    expect(evaluateSend('가'.repeat(20001), snap())).toMatchObject({ allow: false, reason: 'too-long' });
    expect(evaluateSend('가'.repeat(20000), snap())).toMatchObject({ allow: true });
    expect(evaluateSend('😀'.repeat(20000), snap())).toMatchObject({ allow: true });
  });
  it('idle 이고 pending 이 비면 보낸다 — 답처럼 보이는 글이면 answerLike 로 알린다', () => {
    expect(evaluateSend('hello', snap({ pending_approvals: [] }))).toEqual({ allow: true, answerLike: false });
    expect(evaluateSend('y', snap({ pending_approvals: [] }))).toEqual({ allow: true, answerLike: true });
    expect(evaluateSend('y', snap())).toEqual({ allow: true, answerLike: true });
  });
});

describe('guardedSend — sessions.get 으로 확인한 뒤에만 보낸다', () => {
  const idle = snap({ state: 'idle', pending_approvals: [] });
  it('확인이 통과하면 messages.post 를 부른다(get 이 먼저)', async () => {
    const { call, calls } = fakeCall((req) => (req.method === 'GET' ? okResult(idle) : okResult({ entry: { seq: 5 } }, 201)));
    const result = await guardedSend(createAgentClient(call), 's-1', 'y');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(result.sent).toBe(true);
  });
  it('대기 승인이 있으면 post 를 부르지 않는다', async () => {
    const { call, calls } = fakeCall(() => okResult(snap({ state: 'waiting-approval', pending_approvals: [pend('apr_1')] })));
    const result = await guardedSend(createAgentClient(call), 's-1', 'y');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ sent: false, reason: 'pending-approval' });
  });
  it('sessions.get 이 실패하면 확인하지 못한 채 보내지 않는다', async () => {
    const { call, calls } = fakeCall(() => failResult(504, 'MODULE_INVOCATION_TIMEOUT'));
    const result = await guardedSend(createAgentClient(call), 's-1', 'hello');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ sent: false, reason: 'verify-failed' });
  });
  it('post 가 실패하면 그 결과를 그대로 돌려주고 다시 보내지 않는다(I17)', async () => {
    const { call, calls } = fakeCall((req) => (req.method === 'GET' ? okResult(idle) : failResult(0, undefined, 'timeout', true)));
    const result = await guardedSend(createAgentClient(call), 's-1', 'hello');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(result).toMatchObject({ sent: false, reason: 'post-failed' });
    if (!result.sent && result.reason === 'post-failed') expect(result.failure.outcomeUnknown).toBe(true);
  });
});
