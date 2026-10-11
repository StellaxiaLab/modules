import { describe, expect, it } from 'vitest';
import { SESSION_STATES } from '../src/api/types';
import { TERMINAL_STATES, isTerminal, screenFor, sessionTab, stateRule } from '../src/data/status';
import { pend, snap } from './helpers';

describe('상태→화면 규칙 7종(요구 §6.1)', () => {
  it('규칙이 상태 7종을 모두 덮는다', () => {
    expect(SESSION_STATES).toHaveLength(7);
    for (const s of SESSION_STATES) expect(stateRule(s).state).toBe(s);
  });
  it('종료 판정은 done·cancelled·failed·archived 넷이다(GAP-1)', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['archived', 'cancelled', 'done', 'failed']);
    for (const s of ['done', 'cancelled', 'failed', 'archived']) expect(isTerminal(s)).toBe(true);
    for (const s of ['idle', 'running', 'waiting-approval']) expect(isTerminal(s)).toBe(false);
  });
  it('idle: 입력 켬, 취소 가능, 마지막 오류를 상태 옆에(I20)', () => {
    expect(stateRule('idle')).toMatchObject({ inputEnabled: true, canCancel: true, showLastError: true, tab: 'mine', canStartNew: false });
  });
  it('running: 입력 끔("모델이 답하는 중"), 취소 가능', () => {
    expect(stateRule('running')).toMatchObject({ inputEnabled: false, inputLock: 'running', canCancel: true, tab: 'mine' });
  });
  it('waiting-approval: 입력 끔, 카드는 pending 이 있을 때만, 취소 가능', () => {
    expect(stateRule('waiting-approval')).toMatchObject({ inputEnabled: false, inputLock: 'waiting-approval', canCancel: true, cardsNeedPending: true, tab: 'mine' });
  });
  it('done: 입력 끔, 취소 숨김, 새 세션, 성공이 아니니 last_error 를 본다', () => {
    expect(stateRule('done')).toMatchObject({ inputEnabled: false, inputLock: 'finished', canCancel: false, canStartNew: true, showLastError: true, tab: 'ended' });
  });
  it('cancelled: 입력 끔, 취소 숨김(종료 상태에 줄이 또 쌓인다), 새 세션', () => {
    expect(stateRule('cancelled')).toMatchObject({ inputEnabled: false, canCancel: false, canStartNew: true, tab: 'ended' });
  });
  it('failed: 사유를 보인다', () => {
    expect(stateRule('failed')).toMatchObject({ inputEnabled: false, canCancel: false, canStartNew: true, showLastError: true, tab: 'ended' });
  });
  it('archived: 기록뿐 — 입력 끔, 새 세션, 종료됨 탭', () => {
    expect(stateRule('archived')).toMatchObject({ inputEnabled: false, canCancel: false, canStartNew: true, tab: 'ended' });
  });
  it('어떤 상태도 성공을 뜻하지 않는다(I20)', () => {
    for (const s of SESSION_STATES) expect(stateRule(s).impliesSuccess).toBe(false);
  });
  it('알 수 없는 상태는 입력을 잠그고 취소·새 세션 모두 보수적으로 둔다', () => {
    const rule = stateRule('hibernating');
    expect(rule).toMatchObject({ known: false, inputEnabled: false, canCancel: false });
    expect(sessionTab('hibernating')).toBe('mine');
  });
});

describe('screenFor — 상태 + 대기 승인', () => {
  it('waiting-approval 이고 pending 이 있으면 카드를 켠다', () => {
    const view = screenFor(snap({ state: 'waiting-approval', pending_approvals: [pend('a')] }));
    expect(view.showApprovalCards).toBe(true);
    expect(view.activity).toBe('awaiting-approval');
  });
  it('waiting-approval 인데 pending 이 비면(시간 초과 직후) 카드를 켜지 않고 모델이 도는 중으로 본다', () => {
    const view = screenFor(snap({ state: 'waiting-approval', pending_approvals: [] }));
    expect(view.showApprovalCards).toBe(false);
    expect(view.activity).toBe('model-working');
    expect(view.inputEnabled).toBe(false);
  });
  it('pending 이 있으면 상태가 달라도(stale) 입력을 잠근다', () => {
    const view = screenFor(snap({ state: 'idle', pending_approvals: [pend('a')] }));
    expect(view.inputEnabled).toBe(false);
    expect(view.showApprovalCards).toBe(true);
  });
  it('종료 상태에서는 카드를 켜지 않는다', () => {
    expect(screenFor(snap({ state: 'archived', pending_approvals: [pend('a')] })).showApprovalCards).toBe(false);
  });
});
