import { describe, expect, it } from 'vitest';
import { parseEntry, type Entry } from '../src/api/types';
import { APPROVAL_WAIT_MS, canonicalInputKey, emptyMemory, rememberPending, synthesizeCards } from '../src/data/cards';
import { pend, raw } from './helpers';

function entries(...rows: Array<Record<string, unknown>>): Entry[] {
  return rows.map((r) => parseEntry(r)).filter((e): e is Entry => e !== null);
}
const approval = (seq: number, id: string, op = 'io.terra.node.modules.restart') => raw(seq, 'approval', { request_id: id, operation_id: op, note: 'dangerous', text: 'Approval needed — …\nanswer: approve apr_x / deny apr_x' });

describe('승인 카드 합성 — 일곱 상태(§3.2)', () => {
  it('대기: approval 줄이 있고 pending_approvals 에 같은 request_id 가 있다 — 이때만 행동이 켜진다', () => {
    const [card] = synthesizeCards({ entries: entries(raw(1, 'user'), approval(2, 'apr_1')), pending: [pend('apr_1')], memory: emptyMemory() });
    expect(card?.state).toBe('pending');
    expect(card?.actionable).toBe(true);
    expect(card?.outcomeKnown).toBe(false);
  });
  it('승인함: 같은 request_id 의 approved 줄', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1'), raw(2, 'approved', { request_id: 'apr_1' })), pending: [], memory: emptyMemory() });
    expect(card?.state).toBe('approved');
    expect(card?.actionable).toBe(false);
    expect(card?.outcomeKnown).toBe(true);
  });
  it('거부함: denied 줄이고 note 가 no answer within 이 아니다', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1'), raw(2, 'denied', { request_id: 'apr_1' })), pending: [], memory: emptyMemory() });
    expect(card?.state).toBe('denied');
  });
  it('무응답 거부: denied 줄의 note 가 no answer within …', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1'), raw(2, 'denied', { request_id: 'apr_1', note: 'no answer within 30m0s' })), pending: [], memory: emptyMemory() });
    expect(card?.state).toBe('no-answer');
  });
  it('시간 초과: 결과 줄도 pending 도 없고 뒤이어 error(TIME_LIMIT)', () => {
    const [card] = synthesizeCards({
      entries: entries(approval(1, 'apr_1'), raw(2, 'error', { error_code: 'TIME_LIMIT', text: 'stopped: this turn ran past its limit of 900s' })),
      pending: [],
      memory: emptyMemory(),
    });
    expect(card?.state).toBe('timed-out');
    expect(card?.outcomeKnown).toBe(true);
  });
  it('취소됨: 결과 줄도 pending 도 없고 뒤이은 것이 cancelled 줄', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1'), raw(2, 'cancelled')), pending: [], memory: emptyMemory() });
    expect(card?.state).toBe('cancelled');
  });
  it('이미 처리됨: approvals.post 가 404 를 줬다(handled) — 크게 띄우지 않는다', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1')), pending: [], memory: emptyMemory(), handled: new Set(['apr_1']) });
    expect(card?.state).toBe('already-handled');
    expect(card?.actionable).toBe(false);
  });
  it('결과를 뒷받침하는 줄이 아직 없으면 이미 처리됨으로 둔다(질문은 닫혔으나 결과 줄이 늦다)', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1')), pending: [], memory: emptyMemory() });
    expect(card?.state).toBe('already-handled');
    expect(card?.outcomeKnown).toBe(false);
  });
});

describe('승인 카드 합성 — 우선순위와 경계', () => {
  it('TIME_LIMIT 이 앞선 approval 보다 먼저인 오류는 이 카드의 시간 초과가 아니다', () => {
    const cards = synthesizeCards({
      entries: entries(raw(1, 'error', { error_code: 'TIME_LIMIT' }), approval(2, 'apr_1'), raw(3, 'approved', { request_id: 'apr_1' })),
      pending: [],
      memory: emptyMemory(),
    });
    expect(cards[0]?.state).toBe('approved');
  });
  it('결과 줄(approved)이 pending 보다 앞선다 — 낡은 스냅샷이 남아도 카드는 승인함이다', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'apr_1'), raw(2, 'approved', { request_id: 'apr_1' })), pending: [pend('apr_1')], memory: emptyMemory() });
    expect(card?.state).toBe('approved');
    expect(card?.actionable).toBe(false);
  });
  it('기록이 아직 못 따라온 대기 승인도 스냅샷만으로 카드가 선다(인박스)', () => {
    const [card] = synthesizeCards({ entries: [], pending: [pend('apr_9', 'io.terra.x.y', { reason: '재시작이 필요하다' })], memory: emptyMemory() });
    expect(card?.state).toBe('pending');
    expect(card?.seq).toBeNull();
    expect(card?.reason).toBe('재시작이 필요하다');
  });
  it('카드는 approval 줄의 순서(seq)대로 나온다', () => {
    const cards = synthesizeCards({ entries: entries(approval(1, 'a'), raw(2, 'approved', { request_id: 'a' }), approval(3, 'b')), pending: [pend('b')], memory: emptyMemory() });
    expect(cards.map((c) => [c.requestId, c.state])).toEqual([['a', 'approved'], ['b', 'pending']]);
  });
  it('계약 사실이 없으면 contractKnown=false(“계약 사실을 읽지 못했다”) — 있으면 그대로 싣는다', () => {
    const none = synthesizeCards({ entries: [], pending: [pend('a', 'op', { judgement: 'dangerous write' })], memory: emptyMemory() })[0];
    expect(none?.contractKnown).toBe(false);
    expect(none?.judgement).toBe('dangerous write');
    const some = synthesizeCards({ entries: [], pending: [pend('a', 'op', { contract: { risk: 'dangerous', side_effects: [] } })], memory: emptyMemory() })[0];
    expect(some?.contractKnown).toBe(true);
    expect(some?.contract?.side_effects).toEqual([]);
  });
});

describe('마감 시각', () => {
  const T0 = 1_000_000;
  it('expires_ms 가 있으면 그것이 정확한 마감이다', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'a')), pending: [pend('a', 'op', { expires_ms: T0 + 123_000 })], memory: emptyMemory(), nowMs: T0 + 3_000 });
    expect(card?.deadline).toEqual({ ms: T0 + 123_000, approximate: false });
    expect(card?.remainingMs).toBe(120_000);
  });
  it('없으면 근사(GAP-12): min(마지막 user + max_seconds, approval + 30분), 틀릴 수 있음 표시', () => {
    const [card] = synthesizeCards({
      entries: entries(raw(1, 'user'), approval(2, 'a')),
      pending: [pend('a')],
      memory: emptyMemory(),
      maxSeconds: 900,
      nowMs: T0,
    });
    const userAt = 1_000_000 + 1 * 1000;
    expect(card?.deadline).toEqual({ ms: userAt + 900_000, approximate: true });
  });
  it('max_seconds 가 길면 approval + 30분이 작은 값이다', () => {
    const [card] = synthesizeCards({ entries: entries(raw(1, 'user'), approval(2, 'a')), pending: [pend('a')], memory: emptyMemory(), maxSeconds: 7200 });
    expect(card?.deadline).toEqual({ ms: 1_000_000 + 2 * 1000 + APPROVAL_WAIT_MS, approximate: true });
  });
  it('max_seconds·user 줄이 없으면 approval + 30분', () => {
    const [card] = synthesizeCards({ entries: [], pending: [pend('a', 'op', { created_ms: 5000 })], memory: emptyMemory() });
    expect(card?.deadline).toEqual({ ms: 5000 + APPROVAL_WAIT_MS, approximate: true });
  });
  it('대기가 아닌 카드는 마감이 없다', () => {
    const [card] = synthesizeCards({ entries: entries(approval(1, 'a'), raw(2, 'approved', { request_id: 'a' })), pending: [], memory: emptyMemory() });
    expect(card?.deadline).toBeNull();
  });
});

describe('I18 — 이전에 거부한 같은 호출', () => {
  const input = { module: 'chat', force: true };
  it('같은 세션에서 같은 (operation_id, input)이 거부된 뒤 다시 오면 횟수를 센다', () => {
    let memory = emptyMemory();
    memory = rememberPending(memory, [pend('a', 'io.terra.m.stop', { input })]);
    memory = rememberPending(memory, [pend('b', 'io.terra.m.stop', { input: { force: true, module: 'chat' } })]);
    const cards = synthesizeCards({
      entries: entries(approval(1, 'a', 'io.terra.m.stop'), raw(2, 'denied', { request_id: 'a' }), approval(3, 'b', 'io.terra.m.stop'), raw(4, 'denied', { request_id: 'b' }), approval(5, 'c', 'io.terra.m.stop')),
      pending: [pend('c', 'io.terra.m.stop', { input })],
      memory,
    });
    expect(cards.map((c) => c.deniedBefore)).toEqual([0, 1, 2]);
  });
  it('입력이 다르면 세지 않는다', () => {
    let memory = rememberPending(emptyMemory(), [pend('a', 'io.terra.m.stop', { input: { module: 'chat' } })]);
    memory = rememberPending(memory, [pend('c', 'io.terra.m.stop', { input: { module: 'other' } })]);
    const cards = synthesizeCards({
      entries: entries(approval(1, 'a', 'io.terra.m.stop'), raw(2, 'denied', { request_id: 'a' }), approval(3, 'c', 'io.terra.m.stop')),
      pending: [pend('c', 'io.terra.m.stop', { input: { module: 'other' } })],
      memory,
    });
    expect(cards[1]?.deniedBefore).toBe(0);
    expect(cards[1]?.deniedBeforeUnknownInput).toBe(0);
  });
  it('이전 거부의 입력을 본 적이 없으면 같은 operation 의 거부를 따로 센다(같은 호출이라고 단정하지 않는다)', () => {
    const cards = synthesizeCards({
      entries: entries(approval(1, 'a', 'io.terra.m.stop'), raw(2, 'denied', { request_id: 'a' }), approval(3, 'c', 'io.terra.m.stop')),
      pending: [pend('c', 'io.terra.m.stop', { input })],
      memory: emptyMemory(),
    });
    expect(cards[1]?.deniedBefore).toBe(0);
    expect(cards[1]?.deniedBeforeUnknownInput).toBe(1);
  });
  it('무응답 거부·승인은 거부 횟수에 들지 않는다', () => {
    const memory = rememberPending(emptyMemory(), [pend('a', 'op', { input }), pend('b', 'op', { input })]);
    const cards = synthesizeCards({
      entries: entries(approval(1, 'a', 'op'), raw(2, 'denied', { request_id: 'a', note: 'no answer within 30m0s' }), approval(3, 'b', 'op'), raw(4, 'approved', { request_id: 'b' }), approval(5, 'c', 'op')),
      pending: [pend('c', 'op', { input })],
      memory,
    });
    expect(cards[2]?.deniedBefore).toBe(0);
  });
  it('canonicalInputKey 는 키 순서와 빈 입력의 차이를 지운다', () => {
    expect(canonicalInputKey({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalInputKey({ a: { c: 2, d: 1 }, b: 1 }));
    expect(canonicalInputKey(undefined)).toBe(canonicalInputKey({}));
    expect(canonicalInputKey(null)).toBe(canonicalInputKey({}));
    expect(canonicalInputKey([1, 2])).not.toBe(canonicalInputKey([2, 1]));
  });
});
