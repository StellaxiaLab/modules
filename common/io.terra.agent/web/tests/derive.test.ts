import { describe, expect, it } from 'vitest';
import { parseEntry, type Entry } from '../src/api/types';
import { bytesToKB, lastErrorOf, modelOrdinals, tokenTotal, totalSentBytes, turnCallCount } from '../src/data/derive';
import { raw, snap } from './helpers';

const E = (...rows: Array<Record<string, unknown>>): Entry[] => rows.map((r) => parseEntry(r)).filter((e): e is Entry => e !== null);

describe('차례 호출 수·나간 바이트', () => {
  const rows = E(
    raw(1, 'user'), raw(2, 'model', { sent_bytes: 12_000 }), raw(3, 'call'), raw(4, 'model', { sent_bytes: 13_000 }), raw(5, 'assistant'), raw(6, 'done'),
    raw(7, 'user'), raw(8, 'model', { sent_bytes: 14_000 }), raw(9, 'assistant'),
  );
  it('차례 호출 수는 마지막 user 줄 이후 model 줄의 수다', () => {
    expect(turnCallCount(rows)).toBe(1);
    expect(turnCallCount(rows.slice(0, 6))).toBe(2);
    expect(turnCallCount([])).toBe(0);
  });
  it('user 줄이 없으면 전체 model 줄 수', () => {
    expect(turnCallCount(E(raw(1, 'model'), raw(2, 'model')))).toBe(2);
  });
  it('model 줄의 번호는 차례 안의 순번이다', () => {
    const map = modelOrdinals(rows);
    expect([...map.entries()]).toEqual([[2, 1], [4, 2], [8, 1]]);
  });
  it('나간 바이트는 모든 model 줄의 sent_bytes 합이고 KB 는 1024 로 나눈다', () => {
    expect(totalSentBytes(rows)).toBe(39_000);
    expect(bytesToKB(2048)).toBe(2);
    expect(totalSentBytes(E(raw(1, 'model')))).toBe(0);
  });
});

describe('마지막 오류 코드', () => {
  it('M-6 last_error_code 가 있으면 그것을 쓴다', () => {
    const r = lastErrorOf(snap({ last_error: 'stopped: …', last_error_code: 'TIME_LIMIT' }), []);
    expect(r).toMatchObject({ code: 'TIME_LIMIT', source: 'snapshot', hasError: true });
  });
  it('없으면 기록의 마지막 error 줄의 error_code', () => {
    const rows = E(raw(1, 'error', { error_code: 'STEP_LIMIT', text: 'a' }), raw(2, 'user'), raw(3, 'error', { error_code: 'TOKEN_BUDGET', text: 'b' }));
    expect(lastErrorOf(snap({ last_error: 'x' }), rows)).toMatchObject({ code: 'TOKEN_BUDGET', source: 'record', text: 'b' });
  });
  it('기록을 못 읽었고 코드도 없으면 영어 문장을 파싱하지 않고 코드를 모른다고 답한다(GAP-7)', () => {
    const r = lastErrorOf(snap({ last_error: 'stopped: this turn ran past its limit of 900s' }), []);
    expect(r.code).toBeNull();
    expect(r.hasError).toBe(true);
    expect(r.source).toBe('sentence');
    expect(r.text).toBe('stopped: this turn ran past its limit of 900s');
  });
  it('오류가 없으면 hasError=false', () => {
    expect(lastErrorOf(snap(), [])).toMatchObject({ code: null, hasError: false, source: 'none' });
    expect(lastErrorOf(snap({ last_error: null }), [])).toMatchObject({ hasError: false });
  });
});

describe('토큰', () => {
  it('입력+출력 합이고 캐시는 따로다(token_budget 규칙)', () => {
    expect(tokenTotal(snap({ usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 500, cache_write_tokens: 5 } }))).toBe(120);
    expect(tokenTotal(snap())).toBe(0);
  });
});
