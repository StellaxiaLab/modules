import { describe, expect, it } from 'vitest';
import { PAGE_LIMIT, emptyLedger, ingest, syncLedger, type FetchPage } from '../src/data/ledger';
import { parseEntry } from '../src/api/types';
import { failResult, okResult, raw } from './helpers';

/** 서버 흉내: seq 1..n, limit 이 없으면 500 에서 끊긴다(함정 8). */
function serverOf(total: number, opts: { skip?: number[]; capIgnoresLimit?: boolean } = {}): { fetchPage: FetchPage; reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = [];
  const all = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !(opts.skip ?? []).includes(n));
  const fetchPage: FetchPage = async (afterSeq, limit) => {
    reads.push([afterSeq, limit]);
    const cap = opts.capIgnoresLimit ? 500 : limit;
    const entries = all.filter((n) => n > afterSeq).slice(0, cap).map((n) => raw(n, 'assistant', { text: `줄 ${n}` }));
    return okResult({ session_id: 's-1', entries });
  };
  return { fetchPage, reads };
}

describe('parseEntry', () => {
  it('알려진 종류는 읽고 모르는 칸은 extra 에 둔다', () => {
    const e = parseEntry(raw(3, 'call', { status: 'ok', operation_id: 'x', future_field: 7 }));
    expect(e?.kind).toBe('call');
    expect(e?.extra).toEqual({ future_field: 7 });
  });
  it('알 수 없는 종류는 unknown 줄로 감싸고 원본을 보존한다', () => {
    const e = parseEntry(raw(4, 'telepathy', { text: '안녕', weird: { a: 1 } }));
    expect(e?.kind).toBe('unknown');
    if (e?.kind === 'unknown') {
      expect(e.raw_kind).toBe('telepathy');
      expect(e.text).toBe('안녕');
      expect(e.raw['weird']).toEqual({ a: 1 });
    }
  });
  it('seq 가 없거나 1 미만이면 버린다', () => {
    expect(parseEntry({ kind: 'user' })).toBeNull();
    expect(parseEntry(raw(0, 'user'))).toBeNull();
    expect(parseEntry('x')).toBeNull();
    expect(parseEntry(null)).toBeNull();
  });
  it('모양이 틀린 알려진 칸(문자열 자리의 숫자)은 버리지 않고 extra 로 둔다', () => {
    const e = parseEntry(raw(1, 'user', { text: 5 }));
    expect(e && 'text' in e && e.text).toBeFalsy();
    expect(e?.extra).toEqual({ text: 5 });
  });
});

describe('ingest — 이음새', () => {
  it('순서대로 이어 붙이고 lastSeq 를 올린다', () => {
    const r = ingest(emptyLedger('s-1'), [raw(1, 'user'), raw(2, 'assistant')]);
    expect(r.state.lastSeq).toBe(2);
    expect(r.state.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(r.hole).toBe(false);
  });
  it('이미 본 seq 는 버리고 한 번만 센다(중복)', () => {
    const a = ingest(emptyLedger('s-1'), [raw(1, 'user'), raw(2, 'assistant')]);
    const b = ingest(a.state, [raw(2, 'assistant', { text: '다른 내용' }), raw(2, 'assistant'), raw(3, 'done')]);
    expect(b.duplicates).toBe(2);
    expect(b.state.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    // 목록이 정본이다 — 먼저 들어온 줄을 지키고 덮어쓰지 않는다.
    expect(b.state.entries[1]).toEqual(a.state.entries[1]);
  });
  it('같은 묶음 안의 중복과 뒤섞인 순서도 처리한다', () => {
    const r = ingest(emptyLedger('s-1'), [raw(2, 'assistant'), raw(1, 'user'), raw(2, 'assistant')]);
    expect(r.state.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(r.duplicates).toBe(1);
  });
  it('구멍이 있으면 그 뒤 줄은 보이는 목록에 넣지 않고 붙들어 둔다', () => {
    const r = ingest(emptyLedger('s-1'), [raw(1, 'user'), raw(3, 'done')]);
    expect(r.state.entries.map((e) => e.seq)).toEqual([1]);
    expect(r.state.lastSeq).toBe(1);
    expect(r.hole).toBe(true);
    expect(r.state.held.map((e) => e.seq)).toEqual([3]);
  });
  it('구멍이 메워지면 붙들어 둔 줄이 이어서 나온다', () => {
    const a = ingest(emptyLedger('s-1'), [raw(1, 'user'), raw(3, 'done')]);
    const b = ingest(a.state, [raw(2, 'assistant')]);
    expect(b.state.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(b.state.held).toEqual([]);
    expect(b.hole).toBe(false);
  });
  it('번호 없는 줄은 세어서 버린다', () => {
    const r = ingest(emptyLedger('s-1'), [{ kind: 'user' }, raw(1, 'user')]);
    expect(r.invalid).toBe(1);
    expect(r.state.entries).toHaveLength(1);
  });
  it('입력 상태를 바꾸지 않는다(순수)', () => {
    const a = ingest(emptyLedger('s-1'), [raw(1, 'user')]).state;
    const snapshot = JSON.stringify(a);
    ingest(a, [raw(2, 'user')]);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('syncLedger — 쪽 넘김·구멍·재개', () => {
  it('limit 을 항상 명시해 500줄을 넘는 기록을 끝까지 읽는다', async () => {
    const server = serverOf(1203, { capIgnoresLimit: true });
    const r = await syncLedger(emptyLedger('s-1'), server.fetchPage);
    expect(r.ok).toBe(true);
    expect(r.state.entries).toHaveLength(1203);
    expect(r.state.lastSeq).toBe(1203);
    expect(server.reads.every(([, limit]) => limit === PAGE_LIMIT)).toBe(true);
    expect(server.reads.map(([after]) => after)).toEqual([0, 500, 1000, 1203].slice(0, server.reads.length));
  });
  it('정확히 500줄이면 한 번 더 읽어 끝을 확인한다', async () => {
    const server = serverOf(500);
    const r = await syncLedger(emptyLedger('s-1'), server.fetchPage);
    expect(r.state.lastSeq).toBe(500);
    expect(server.reads).toEqual([[0, 500], [500, 500]]);
  });
  it('새 줄이 없으면 한 번만 읽고 끝낸다', async () => {
    const server = serverOf(3);
    const first = await syncLedger(emptyLedger('s-1'), server.fetchPage);
    server.reads.length = 0;
    const second = await syncLedger(first.state, server.fetchPage);
    expect(server.reads).toEqual([[3, 500]]);
    expect(second.ok && second.added).toEqual([]);
  });
  it('재개 — 중간에 실패해도 받은 데까지 남고 다음 호출이 lastSeq 부터 이어 읽는다', async () => {
    const server = serverOf(1200);
    let n = 0;
    const flaky: FetchPage = async (after, limit) => {
      n += 1;
      if (n === 2) return failResult(504, 'MODULE_INVOCATION_TIMEOUT');
      return server.fetchPage(after, limit);
    };
    const first = await syncLedger(emptyLedger('s-1'), flaky);
    expect(first.ok).toBe(false);
    expect(first.state.lastSeq).toBe(500);
    server.reads.length = 0;
    const second = await syncLedger(first.state, server.fetchPage);
    expect(second.ok).toBe(true);
    expect(second.state.lastSeq).toBe(1200);
    expect(server.reads[0]).toEqual([500, 500]);
    expect(new Set(second.state.entries.map((e) => e.seq)).size).toBe(1200);
  });
  it('스트림이 놓친 구멍은 after_seq=lastSeq 로 다시 읽어 메운다', async () => {
    const server = serverOf(10);
    const streamed = ingest(emptyLedger('s-1'), [raw(1, 'user'), raw(2, 'assistant'), raw(5, 'done')]);
    expect(streamed.hole).toBe(true);
    const r = await syncLedger(streamed.state, server.fetchPage);
    expect(server.reads[0]).toEqual([2, 500]);
    expect(r.state.lastSeq).toBe(10);
    expect(r.state.held).toEqual([]);
  });
  it('서버에도 구멍이 있으면 끝없이 읽지 않고 구멍을 알린다', async () => {
    const server = serverOf(10, { skip: [4] });
    const r = await syncLedger(emptyLedger('s-1'), server.fetchPage);
    expect(r.ok).toBe(true);
    expect(r.state.lastSeq).toBe(3);
    if (r.ok) expect(r.hole).toEqual({ afterSeq: 3, nextSeq: 5 });
    expect(server.reads.length).toBeLessThanOrEqual(3);
  });
  it('쪽 수 상한(maxPages)이 있다', async () => {
    const server = serverOf(5000);
    const r = await syncLedger(emptyLedger('s-1'), server.fetchPage, { limit: 10, maxPages: 3 });
    expect(r.state.lastSeq).toBe(30);
    expect(server.reads).toHaveLength(3);
  });
  it('entries 가 배열이 아니면 오류로 다룬다', async () => {
    const r = await syncLedger(emptyLedger('s-1'), async () => okResult({ session_id: 's-1', entries: 'x' as unknown as unknown[] }));
    expect(r.ok).toBe(false);
  });
});
