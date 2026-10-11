import { describe, expect, it } from 'vitest';
import { filterOwned, inboxOf, ownsSession } from '../src/data/owner';
import { pend, snap } from './helpers';

describe('소유자 필터(R-2 전 임시)', () => {
  const rows = [
    snap({ session_id: 'mine-1', owner: 'alice', created_ms: 3 }),
    snap({ session_id: 'theirs', owner: 'bob', answer: '남의 답', created_ms: 2, pending_approvals: [pend('apr_bob', 'op', { input: { secret: 1 } })] }),
    snap({ session_id: 'mine-2', owner: 'alice', created_ms: 1, state: 'waiting-approval', pending_approvals: [pend('apr_a')] }),
    snap({ session_id: 'via-app', owner: 'alice via io.terra.agent', created_ms: 0 }),
  ];
  it('viewer 의 것만 남긴다 — 합성 principal("alice via …")은 다른 사람이다(요구 §9)', () => {
    expect(filterOwned(rows, 'alice').map((s) => s.session_id)).toEqual(['mine-1', 'mine-2']);
  });
  it('viewer 를 모르면 아무것도 보이지 않는다(모두 보이는 쪽으로 실패하지 않는다)', () => {
    expect(filterOwned(rows, null)).toEqual([]);
    expect(filterOwned(rows, '')).toEqual([]);
  });
  it('걸러진 세션의 내용이 결과 어디에도 없다', () => {
    const json = JSON.stringify(filterOwned(rows, 'alice'));
    expect(json).not.toContain('남의 답');
    expect(json).not.toContain('apr_bob');
  });
  it('ownsSession', () => {
    expect(ownsSession(rows[0]!, 'alice')).toBe(true);
    expect(ownsSession(rows[1]!, 'alice')).toBe(false);
    expect(ownsSession(rows[0]!, null)).toBe(false);
  });
  it('인박스는 내 세션의 대기 승인만 모은다', () => {
    const inbox = inboxOf(filterOwned(rows, 'alice'));
    expect(inbox).toEqual([{ sessionId: 'mine-2', topic: undefined, approval: pend('apr_a') }]);
  });
});
