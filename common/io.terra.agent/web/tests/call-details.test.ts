// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseEntry, type Entry } from '../src/api/types';
import { renderEntry, type EntryContext } from '../src/views/entries';
import { raw } from './helpers';

// M-5 — call·planned·external 줄의 접힌 상세에 입력 요약·결과 요약·결과 방식(output.mode)을 보인다.
// 없으면(이전 모듈) 그 칸은 숨긴다. 모델 텍스트는 글자로만(I7), 비밀은 다시 드러내지 않는다(I1).

const e = (seq: number, kind: string, extra: Record<string, unknown> = {}): Entry => parseEntry(raw(seq, kind, extra)) as Entry;
const ctx: EntryContext = { viewer: 'alice', ordinals: new Map(), cards: new Map(), turnCalls: new Map(), lastDoneSeq: null, tokens: 0 };
const html = (entry: Entry): HTMLElement => renderEntry(entry, ctx);
const labels = (el: HTMLElement): string[] => [...el.querySelectorAll('details dt')].map((n) => n.textContent ?? '');
const valueOf = (el: HTMLElement, label: string): string | null => {
  const dts = [...el.querySelectorAll('details dt')];
  const dt = dts.find((n) => n.textContent === label);
  return dt?.nextElementSibling?.textContent ?? null;
};

describe('M-5 읽기', () => {
  it('세 칸은 알려진 칸이라 extra 로 새지 않는다', () => {
    const entry = e(1, 'call', { subject: 'op', status: 'ok', input_summary: '{"a":1}', result_summary: '{"b":2}', output_mode: 'immediate' }) as Extract<Entry, { kind: 'call' }>;
    expect(entry.input_summary).toBe('{"a":1}');
    expect(entry.result_summary).toBe('{"b":2}');
    expect(entry.output_mode).toBe('immediate');
    expect(entry.extra).toBeUndefined();
  });

  it('문자열이 아닌 값은 버리지 않고 extra 로 둔다', () => {
    const entry = e(1, 'call', { subject: 'op', input_summary: 5 }) as Extract<Entry, { kind: 'call' }>;
    expect(entry.input_summary).toBeUndefined();
    expect(entry.extra).toEqual({ input_summary: 5 });
  });
});

describe('M-5 접힌 상세', () => {
  it('세 칸이 모두 있으면 접힌 상세에 보인다', () => {
    const line = html(e(2, 'call', { subject: 'op', status: 'ok', decision: 'run', input_summary: '{"module_id":"io.terra.sample"}', result_summary: '{"state":"running"}', output_mode: 'immediate' }));
    const detail = line.querySelector('details');
    expect(detail?.open).toBe(false);
    expect(valueOf(line, '결과 방식')).toBe('immediate');
    expect(valueOf(line, '입력 (비밀로 이름 붙은 값은 가려짐)')).toBe('{"module_id":"io.terra.sample"}');
    expect(valueOf(line, '결과 요약')).toBe('{"state":"running"}');
  });

  it('칸이 없으면(이전 모듈) 그 칸을 숨긴다 — 빈 줄도 라벨도 없다', () => {
    const line = html(e(3, 'call', { subject: 'op', status: 'ok', decision: 'run', trace_id: 'tr_1' }));
    expect(labels(line)).toEqual(['판정', 'trace id']);
    const bare = html(e(4, 'call', { subject: 'op', status: 'ok' }));
    expect(bare.querySelector('details')).toBeNull();
  });

  it('칸이 빈 문자열이어도 숨긴다', () => {
    const line = html(e(5, 'call', { subject: 'op', status: 'ok', decision: 'run', input_summary: '', result_summary: '', output_mode: '' }));
    expect(labels(line)).toEqual(['판정']);
  });

  it('planned 는 입력과 결과 방식을 보이고 결과 칸은 없다', () => {
    const line = html(e(6, 'planned', { subject: 'op', status: 'planned', input_summary: '{"module_id":"x"}', output_mode: 'immediate' }));
    expect(valueOf(line, '입력 (비밀로 이름 붙은 값은 가려짐)')).toBe('{"module_id":"x"}');
    expect(valueOf(line, '결과 방식')).toBe('immediate');
    expect(valueOf(line, '결과 요약')).toBeNull();
    expect(line.textContent).toContain('실행되지 않았습니다');
  });

  it('external 은 입력 요약을 보인다', () => {
    const line = html(e(7, 'external', { server: 'docs', subject: 'lookup', status: 'ok', result_bytes: 10, input_summary: '{"q":"terra"}' }));
    expect(valueOf(line, '입력 (비밀로 이름 붙은 값은 가려짐)')).toBe('{"q":"terra"}');
    expect(line.textContent).toContain('Gateway 감사에 없습니다');
  });

  it('가려진 값(***)은 그대로 보이고 되살리려는 처리가 없다', () => {
    const line = html(e(8, 'call', { subject: 'op', status: 'ok', input_summary: '{"api_key":"***","name":"n"}' }));
    expect(valueOf(line, '입력 (비밀로 이름 붙은 값은 가려짐)')).toBe('{"api_key":"***","name":"n"}');
  });
});

describe('M-5 접수 ≠ 완료 (DC-18)', () => {
  it('accepted-job 이고 status ok 이면 줄에 accepted-job 칩과 "접수 ≠ 완료"가 있고 ok 칩은 없다', () => {
    const line = html(e(9, 'call', { subject: 'terra.daemon.modules.by-module-id.restart.post', status: 'ok', output_mode: 'accepted-job' }));
    expect(line.querySelector('.ev .chip.info')?.textContent).toBe('accepted-job');
    expect(line.querySelector('.ev')?.textContent).toContain('접수 ≠ 완료');
    expect(line.querySelector('.ev .chip.ok')).toBeNull();
    expect(valueOf(line, '결과 방식')).toBe('accepted-job — 접수이지 완료가 아닙니다');
  });

  it('immediate 는 ok 칩 그대로이고 accepted-job 표시가 없다', () => {
    const line = html(e(10, 'call', { subject: 'op', status: 'ok', output_mode: 'immediate' }));
    expect(line.querySelector('.ev .chip.ok')?.textContent).toBe('ok');
    expect(line.querySelector('.ev .chip.info')).toBeNull();
    expect(line.querySelector('.ev')?.textContent).not.toContain('접수');
  });

  it('output_mode 가 없는 이전 줄은 지금처럼 ok 칩이다', () => {
    const line = html(e(11, 'call', { subject: 'op', status: 'ok' }));
    expect(line.querySelector('.ev .chip.ok')?.textContent).toBe('ok');
  });

  it('accepted-job 이어도 오류·거절이면 접수가 아니다 — 상태 칩을 그대로 둔다', () => {
    const err = html(e(12, 'call', { subject: 'op', status: 'error', error_code: 'HTTP_500', output_mode: 'accepted-job' }));
    expect(err.querySelector('.ev .chip.err')?.textContent).toBe('error');
    expect(err.querySelector('.ev .chip.info')).toBeNull();
    const refused = html(e(13, 'call', { subject: 'op', status: 'refused', decision: 'refuse', output_mode: 'accepted-job' }));
    expect(refused.querySelector('.ev')?.textContent).not.toContain('접수 ≠ 완료');
  });

  it('planned 의 accepted-job 은 줄에 접수 표시를 달지 않는다 — 실행되지 않았다', () => {
    const line = html(e(14, 'planned', { subject: 'op', status: 'planned', output_mode: 'accepted-job' }));
    expect(line.querySelector('.ev .chip.info')).toBeNull();
    expect(line.querySelector('.ev')?.textContent).not.toContain('접수 ≠ 완료');
  });

  it('모르는 output_mode 값도 글자 그대로 보인다', () => {
    const line = html(e(15, 'call', { subject: 'op', status: 'ok', output_mode: 'future-mode' }));
    expect(valueOf(line, '결과 방식')).toBe('future-mode');
    expect(line.querySelector('.ev .chip.ok')).not.toBeNull();
  });
});

describe('M-5 텍스트 삽입 안전 (I7)', () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> {{constructor.constructor("alert(3)")()}} <b>굵게</b>';
  for (const kind of ['call', 'planned', 'external']) {
    it(`${kind} 의 세 칸은 글자로만 나온다`, () => {
      const line = html(e(1, kind, { subject: 'op', status: 'ok', input_summary: evil, result_summary: evil, output_mode: evil }));
      expect(line.querySelector('img')).toBeNull();
      expect(line.querySelector('script')).toBeNull();
      expect(line.querySelector('[onerror]')).toBeNull();
      expect(line.querySelector('details b')).toBeNull();
      expect(line.querySelector('a')).toBeNull();
      expect(line.querySelector('details')?.textContent).toContain(evil);
    });
  }
});
