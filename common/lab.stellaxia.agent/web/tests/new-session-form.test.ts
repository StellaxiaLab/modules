import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_SECONDS, DEFAULT_MAX_STEPS } from '../src/api/client';
import { defaultValues, validateNewSession, type NewSessionContext, type NewSessionValues } from '../src/data/new-session-form';

const ctx = (over: Partial<NewSessionContext> = {}): NewSessionContext => ({
  providers: [
    { provider: 'anthropic', model: 'test-model', default: true },
    { provider: 'other', model: 'm2', default: false },
  ],
  defaultProvider: 'anthropic',
  mcpNames: ['filesystem', 'weather'],
  ...over,
});
const values = (over: Partial<NewSessionValues> = {}): NewSessionValues => ({ ...defaultValues(ctx()), ...over });

describe('새 세션 폼 검증 (GAP-9)', () => {
  it('기본값은 plan · 시뮬레이션 끔 · 기본 provider · 한도 24/900/무제한이고, 그대로 열면 autonomy 만 보낸다 (D-7)', () => {
    const v = defaultValues(ctx());
    expect(v).toMatchObject({ autonomy: 'plan', simulate: false, provider: 'anthropic', mcp: [], maxSteps: String(DEFAULT_MAX_STEPS), maxSeconds: String(DEFAULT_MAX_SECONDS), tokenBudget: '' });
    expect(validateNewSession(v, ctx())).toEqual({ ok: true, input: { autonomy: 'plan' } });
  });

  it('ask·auto 는 열 수 있고 unattended 는 G4 까지 열 수 없다', () => {
    expect(validateNewSession(values({ autonomy: 'ask' }), ctx())).toEqual({ ok: true, input: { autonomy: 'ask' } });
    expect(validateNewSession(values({ autonomy: 'auto' }), ctx())).toEqual({ ok: true, input: { autonomy: 'auto' } });
    const r = validateNewSession(values({ autonomy: 'unattended' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.first).toBe('autonomy');
      expect(r.errors.autonomy).toContain('G4');
    }
  });

  it('topic 은 앞뒤 공백을 떼고 200자까지, 비면 보내지 않는다', () => {
    expect(validateNewSession(values({ topic: '  새벽 점검  ' }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan', topic: '새벽 점검' } });
    expect(validateNewSession(values({ topic: '   ' }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan' } });
    expect(validateNewSession(values({ topic: 'x'.repeat(200) }), ctx()).ok).toBe(true);
    const long = validateNewSession(values({ topic: 'x'.repeat(201) }), ctx());
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.topic).toContain('200');
  });

  it('simulate 는 켰을 때만 보낸다', () => {
    expect(validateNewSession(values({ simulate: true }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan', simulate: true } });
  });

  it('한도는 기본값과 같으면 보내지 않고, 다르면 정수로 보낸다', () => {
    expect(validateNewSession(values({ maxSteps: '40', maxSeconds: '1800', tokenBudget: '50000' }), ctx())).toEqual({
      ok: true,
      input: { autonomy: 'plan', max_steps: 40, max_seconds: 1800, token_budget: 50000 },
    });
    expect(validateNewSession(values({ maxSteps: '024', maxSeconds: ' 900 ' }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan' } });
    // 비우면 기본값(차례당 호출·시간) / 무제한(토큰)
    expect(validateNewSession(values({ maxSteps: '', maxSeconds: '', tokenBudget: '' }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan' } });
  });

  it('경계: max_steps 1~100, max_seconds 1~7200, token_budget 1 이상', () => {
    for (const [field, ok, bad] of [
      ['maxSteps', ['1', '100'], ['0', '101']],
      ['maxSeconds', ['1', '7200'], ['0', '7201']],
      ['tokenBudget', ['1', '9007199254740991'], ['0', '9007199254740992']],
    ] as const) {
      for (const text of ok) expect(validateNewSession(values({ [field]: text }), ctx()).ok, `${field}=${text}`).toBe(true);
      for (const text of bad) {
        const r = validateNewSession(values({ [field]: text }), ctx());
        expect(r.ok, `${field}=${text}`).toBe(false);
        if (!r.ok) expect(r.errors[field]).toBeTruthy();
      }
    }
  });

  it('정수가 아닌 글은 모두 거절한다 (소수·지수·부호·글자)', () => {
    for (const text of ['1.5', '1e3', '-3', '+3', '٣', 'abc', '12abc', '0x10', '１２']) {
      const r = validateNewSession(values({ maxSteps: text }), ctx());
      expect(r.ok, text).toBe(false);
    }
  });

  it('오류가 여럿이면 화면 순서대로 첫 칸을 알려 준다', () => {
    const r = validateNewSession(values({ topic: 'x'.repeat(201), maxSeconds: '0', tokenBudget: 'x' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors)).toEqual(['topic', 'maxSeconds', 'tokenBudget']);
      expect(r.first).toBe('topic');
    }
  });

  it('provider: 기본이면 보내지 않고, 다른 등록된 것을 고르면 이름을 보낸다. 모르는 이름은 거절한다', () => {
    expect(validateNewSession(values({ provider: 'other' }), ctx())).toEqual({ ok: true, input: { autonomy: 'plan', provider: 'other' } });
    const r = validateNewSession(values({ provider: 'ghost' }), ctx());
    expect(r.ok).toBe(false);
    // 모델 목록을 못 읽었으면 provider 를 정하지 않는다(모듈이 기본을 쓴다)
    expect(validateNewSession(values({ provider: '' }), ctx({ providers: null, defaultProvider: null }))).toEqual({ ok: true, input: { autonomy: 'plan' } });
  });

  it('MCP: 고른 서버만 이름 순서가 아니라 목록 순서대로, 중복 없이 보낸다. 목록에 없는 이름은 거절한다', () => {
    expect(validateNewSession(values({ mcp: ['weather', 'filesystem', 'weather'] }), ctx())).toEqual({
      ok: true,
      input: { autonomy: 'plan', mcp_servers: ['filesystem', 'weather'] },
    });
    const r = validateNewSession(values({ mcp: ['ghost'] }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.mcp).toContain('ghost');
  });

  it('무인 + 외부 MCP 는 함께 못 쓴다 (I6) — 무인이 막혀 있어도 조합 자체를 따로 막는다', () => {
    const r = validateNewSession(values({ autonomy: 'unattended', mcp: ['filesystem'] }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.mcp).toContain('무인');
      expect(r.errors.autonomy).toBeTruthy();
    }
  });
});
