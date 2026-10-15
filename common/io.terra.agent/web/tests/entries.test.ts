// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { KNOWN_ENTRY_KINDS, parseEntry, type Entry } from '../src/api/types';
import { turnCallsByDone } from '../src/app/turns';
import type { ApprovalCard } from '../src/data/cards';
import { defaultEntryRenderers, entrySignature, renderEntry, type EntryContext } from '../src/views/entries';
import { raw } from './helpers';

const e = (seq: number, kind: string, extra: Record<string, unknown> = {}): Entry => parseEntry(raw(seq, kind, extra)) as Entry;

function ctx(over: Partial<EntryContext> = {}): EntryContext {
  return { viewer: 'alice', ordinals: new Map(), cards: new Map(), turnCalls: new Map(), lastDoneSeq: null, tokens: 0, ...over };
}

function card(over: Partial<ApprovalCard>): ApprovalCard {
  return {
    requestId: 'r1', operationId: 'op.restart', state: 'pending', seq: 3, createdMs: 0, contractKnown: false, actionable: true,
    outcomeKnown: false, deadline: null, remainingMs: null, deniedBefore: 0, deniedBeforeUnknownInput: 0, ...over,
  };
}

const html = (entry: Entry, c = ctx()): HTMLElement => renderEntry(entry, c);

describe('화면 3 — 줄 렌더 12종 + 모르는 종류', () => {
  it('렌더러가 알려진 12종과 unknown 모두에 있다', () => {
    expect(Object.keys(defaultEntryRenderers).sort()).toEqual([...KNOWN_ENTRY_KINDS, 'unknown'].sort());
  });

  it('user: 본인은 오른쪽 말풍선, 다른 사람은 이름과 함께', () => {
    expect(html(e(1, 'user', { text: '안녕', author: 'alice' })).querySelector('.me')?.textContent).toBe('안녕');
    const other = html(e(1, 'user', { text: '안녕', author: 'bob', author_label: 'Bob' }));
    expect(other.querySelector('.me')).toBeNull();
    expect(other.querySelector('.other .author')?.textContent).toBe('Bob');
  });

  it('assistant: 왼쪽 말풍선', () => {
    expect(html(e(2, 'assistant', { text: '답입니다' })).querySelector('.ai .tx')?.textContent).toBe('답입니다');
  });

  it('model: 나간 양(KB)과 차례 안 순번, note 는 파싱하지 않고 그대로', () => {
    const line = html(e(3, 'model', { sent_bytes: 12698, note: 'x/test · 12698 B · 2 tool result(s) carried' }), ctx({ ordinals: new Map([[3, 2]]) }));
    expect(line.textContent).toContain('모델을 불렀습니다');
    expect(line.textContent).toContain('12.4 KB 노드 밖으로');
    expect(line.textContent).toContain('#2');
    expect(line.textContent).toContain('2 tool result(s) carried');
  });

  it('model: M-7 의 provider/model 이 있으면 보인다', () => {
    expect(html(e(3, 'model', { provider: 'anthropic', model: 'test-model' })).textContent).toContain('anthropic/test-model');
  });

  it('call: ok · refused(plan 의 제안은 오류가 아니다) · error', () => {
    const ok = html(e(4, 'call', { subject: 'terra.gateway.agent.whoami.get', status: 'ok' }));
    expect(ok.querySelector('.op')?.textContent).toBe('terra.gateway.agent.whoami.get');
    expect(ok.querySelector('.chip.ok')?.textContent).toBe('ok');
    const plan = html(e(5, 'call', { subject: 'op', status: 'refused', decision: 'plan', error_code: 'TERRA_APPROVAL_REQUIRED' }));
    expect(plan.querySelector('.chip.warn')?.textContent).toBe('제안 · 실행 안 됨');
    expect(plan.querySelector('.chip.err')).toBeNull(); // refused 는 오류가 아니다
    expect(plan.textContent).toContain('TERRA_APPROVAL_REQUIRED');
    const refused = html(e(6, 'call', { subject: 'op', status: 'refused', decision: 'refuse' }));
    expect(refused.querySelector('.chip.warn')?.textContent).toBe('거절됨 · 실행 안 됨');
    const err = html(e(7, 'call', { subject: 'op', status: 'error', error_code: 'HTTP_500' }));
    expect(err.querySelector('.chip.err')?.textContent).toBe('error');
    expect(err.querySelector('details')?.textContent).toContain('HTTP 500');
  });

  it('call: error_code 가 MODULE_PERMISSION_DENIED 면 위임 자격의 권한 부족으로 말하고 사용자 계정의 agent.use 를 탓하지 않는다(B3)', () => {
    const line = html(e(9, 'call', { subject: 'terra.daemon.modules.by-module-id.restart.post', status: 'error', decision: 'approved', error_code: 'MODULE_PERMISSION_DENIED' }));
    const text = line.querySelector('details')?.textContent ?? '';
    expect(text).toContain('MODULE_PERMISSION_DENIED');
    expect(text).toContain('위임 자격');
    expect(text).not.toContain('agent.use 권한이 없');
  });

  it('call: 이유(M-4)는 "주장이며 근거가 아니다"로 판정 근거와 갈라 접어 둔다', () => {
    const line = html(e(4, 'call', { subject: 'op', status: 'ok', reason: '재시작이 필요합니다', judgement: 'risk=dangerous', trace_id: 'tr_1' }));
    const detail = line.querySelector('details');
    expect(detail?.open).toBe(false);
    expect(detail?.textContent).toContain('모델이 말한 이유 (주장이며 근거가 아닙니다)');
    expect(detail?.textContent).toContain('재시작이 필요합니다');
    expect(detail?.textContent).toContain('모듈의 판정 근거');
    expect(detail?.textContent).toContain('tr_1');
  });

  it('planned: "호출 예정 (시뮬레이션) — 실행되지 않았습니다"', () => {
    const line = html(e(8, 'planned', { subject: 'terra.daemon.modules.by-module-id.restart.post', status: 'planned' }));
    expect(line.textContent).toContain('호출 예정 (시뮬레이션)');
    expect(line.textContent).toContain('실행되지 않았습니다');
    expect(line.querySelector('.ev.plan')).not.toBeNull();
  });

  it('external: Gateway 감사에 없다고 줄에 그대로 쓴다', () => {
    const line = html(e(9, 'external', { server: 'filesystem', subject: 'read_file', result_bytes: 2048, status: 'ok' }));
    expect(line.textContent).toContain('Gateway 감사에 없습니다');
    expect(line.textContent).toContain('filesystem');
    expect(line.textContent).toContain('2,048 B');
  });

  it('approval: 대기 중이면 "승인이 필요합니다" 자리표시(카드는 G2) — 승인 컨트롤을 그리지 않는다', () => {
    const c = ctx({ cards: new Map([['r1', card({})]]) });
    const line = html(e(10, 'approval', { request_id: 'r1', operation_id: 'op.restart', text: 'CLI: run terra agent approve' }), c);
    expect(line.textContent).toContain('승인이 필요합니다');
    expect(line.textContent).toContain('op.restart');
    expect(line.textContent).not.toContain('terra agent approve'); // CLI 안내 줄은 그대로 쓰지 않는다
    expect(line.querySelector('button')).toBeNull();
    expect(line.querySelector('[data-card-state=pending]')).not.toBeNull();
  });

  it('approval: 카드 상태 일곱이 모두 다른 글로 나온다', () => {
    const states = ['pending', 'approved', 'denied', 'no-answer', 'timed-out', 'cancelled', 'already-handled'] as const;
    const texts = states.map((state) => html(e(10, 'approval', { request_id: 'r1', operation_id: 'op' }), ctx({ cards: new Map([['r1', card({ state })]]) })).textContent);
    expect(new Set(texts).size).toBe(7);
  });

  it('approved / denied(무응답은 따로)', () => {
    expect(html(e(11, 'approved', { request_id: 'r1' })).textContent).toContain('Gateway 판정 대기');
    expect(html(e(12, 'denied', { request_id: 'r1', note: 'denied by alice' })).textContent).toContain('거부했습니다');
    expect(html(e(12, 'denied', { request_id: 'r1', note: 'no answer within 30m0s' })).textContent).toContain('응답이 없어 거부되었습니다');
  });

  it('done: 호출은 차례 몫, 토큰은 세션 누적 — 누적은 마지막 차례 줄에만', () => {
    const entries = [e(1, 'user'), e(2, 'model'), e(3, 'model'), e(4, 'done'), e(5, 'user'), e(6, 'model'), e(7, 'done')];
    const c = ctx({ turnCalls: turnCallsByDone(entries), lastDoneSeq: 7, tokens: 18_200 });
    const first = html(e(4, 'done', { note: '1 turn(s) · 100 in / 50 out tokens' }), c);
    const last = html(e(7, 'done'), c);
    expect(first.textContent).toContain('모델 호출 2회');
    expect(first.textContent).not.toContain('토큰');
    expect(last.textContent).toContain('모델 호출 1회');
    expect(last.textContent).toContain('세션 누적 18.2k 토큰');
    expect(last.textContent).toContain('성공을 뜻하지 않음');
    expect(first.textContent).not.toContain('100 in'); // note 는 파싱하지 않는다
  });

  it('error: 코드는 사전으로 풀고 영어 원문은 접는다', () => {
    const line = html(e(13, 'error', { text: 'stopped: this turn ran past its limit of 900s', error_code: 'TIME_LIMIT' }));
    expect(line.querySelector('.chip.err')?.textContent).toBe('TIME_LIMIT');
    expect(line.querySelector('b')?.textContent).toContain('시간 한도');
    const raw = line.querySelector('details');
    expect(raw?.open).toBe(false);
    expect(raw?.textContent).toContain('stopped: this turn ran past its limit of 900s');
  });

  it('error: 모르는 코드나 코드 없음은 원문을 머리로 쓴다', () => {
    expect(html(e(13, 'error', { text: 'something broke', error_code: 'WEIRD' })).querySelector('b')?.textContent).toBe('something broke');
    expect(html(e(13, 'error', { text: 'plain' })).querySelector('b')?.textContent).toBe('plain');
  });

  it('cancelled', () => {
    expect(html(e(14, 'cancelled')).textContent).toContain('세션이 취소되었습니다');
  });

  it('모르는 kind 는 unknown 줄로 접어서 보이고 원본을 버리지 않는다', () => {
    const unknown = e(15, 'future-kind', { text: '새로운 글', mystery: { a: 1 } });
    expect(unknown.kind).toBe('unknown');
    const line = html(unknown);
    expect(line.textContent).toContain('알 수 없는 종류의 줄');
    expect(line.textContent).toContain('future-kind');
    expect(line.textContent).toContain('새로운 글');
    const detail = line.querySelector('details');
    expect(detail?.open).toBe(false);
    expect(detail?.querySelector('pre')?.textContent).toContain('"mystery"');
  });

  it('모든 줄에 data-seq · data-kind 가 있다', () => {
    const line = html(e(2, 'assistant', { text: 'x' }));
    expect(line.getAttribute('data-seq')).toBe('2');
    expect(line.getAttribute('data-kind')).toBe('assistant');
  });
});

describe('텍스트 삽입 안전 (I1·I7)', () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> {{constructor.constructor("alert(3)")()}} <b>굵게</b>';
  const fields: Array<[string, Record<string, unknown>]> = [
    ['user', { text: evil }],
    ['assistant', { text: evil }],
    ['model', { note: evil }],
    ['call', { subject: evil, status: 'ok', note: evil, reason: evil, judgement: evil, error_code: evil }],
    ['planned', { subject: evil, note: evil }],
    ['external', { server: evil, subject: evil, note: evil }],
    ['approval', { request_id: 'r', operation_id: evil, text: evil }],
    ['denied', { note: evil }],
    ['done', { note: evil }],
    ['error', { text: evil, error_code: evil }],
    ['future', { text: evil, other: evil }],
  ];
  for (const [kind, extra] of fields) {
    it(`${kind} 줄의 HTML·{{…}} 는 글자로 나온다`, () => {
      const line = html(e(1, kind, extra));
      expect(line.querySelector('img')).toBeNull();
      expect(line.querySelector('script')).toBeNull();
      expect(line.querySelector('[onerror]')).toBeNull();
      expect(line.querySelector('b')?.textContent === '굵게').toBe(false);
      expect(line.querySelector('a')).toBeNull(); // 링크를 만들지 않는다
      if (['user', 'assistant', 'error'].includes(kind)) expect(line.textContent).toContain('{{constructor.constructor("alert(3)")()}}');
      if (kind === 'user') expect(line.textContent).toContain('<img src=x onerror="alert(1)"><script>alert(2)</script>');
    });
  }
  it('모델이 쓴 "승인하겠습니다"를 버튼으로 그리지 않는다', () => {
    const line = html(e(2, 'assistant', { text: '[승인] 버튼을 눌러 주세요 <button>승인</button>' }));
    expect(line.querySelector('button')).toBeNull();
  });
});

describe('다시 그릴 줄 (signature)', () => {
  it('승인 자리표시는 카드 상태가 바뀔 때, 차례 줄은 누적 토큰이 바뀔 때만 서명이 바뀐다', () => {
    const approval = e(10, 'approval', { request_id: 'r1' });
    const a = entrySignature(approval, ctx({ cards: new Map([['r1', card({ state: 'pending' })]]) }));
    const b = entrySignature(approval, ctx({ cards: new Map([['r1', card({ state: 'approved', actionable: false })]]) }));
    expect(a).not.toBe(b);
    const done = e(7, 'done');
    const s1 = entrySignature(done, ctx({ lastDoneSeq: 7, tokens: 100, turnCalls: new Map([[7, 1]]) }));
    const s2 = entrySignature(done, ctx({ lastDoneSeq: 7, tokens: 200, turnCalls: new Map([[7, 1]]) }));
    const s3 = entrySignature(done, ctx({ lastDoneSeq: 9, tokens: 200, turnCalls: new Map([[7, 1]]) }));
    expect(s1).not.toBe(s2);
    expect(s3).not.toBe(s2);
    expect(entrySignature(e(1, 'user'), ctx())).toBe('');
  });
});
