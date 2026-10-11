import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTransport, reply } from '../src/transport/fake';
import { DEFAULT_TIMEOUT_MS } from '../src/transport/pipeline';
import { AGENT } from './transport-helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const POST = { method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'x' } } as const;
const GET = { method: 'GET', path: `${AGENT}/status` } as const;

describe('시간 제한', () => {
  it('기본값은 20초', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(20_000);
  });

  it('19.9초에는 기다리고 20초에 REQUEST_TIMEOUT', async () => {
    const t = new FakeTransport();
    t.on(GET.path, reply.hang());
    let settled = false;
    const p = t.request(GET).then(r => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(19_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    expect(r).toMatchObject({ ok: false, status: 0, error: { code: 'REQUEST_TIMEOUT', source: 'transport' } });
  });

  it('쓰기 호출의 시간 초과는 outcomeUnknown, 읽기는 아니다', async () => {
    const t = new FakeTransport({ timeoutMs: 15_000 });
    t.on(POST.path, reply.hang());
    t.on(GET.path, reply.hang());
    const w = t.request(POST);
    const r = t.request(GET);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await w).toMatchObject({ error: { code: 'REQUEST_TIMEOUT', outcomeUnknown: true } });
    expect(await r).toMatchObject({ error: { code: 'REQUEST_TIMEOUT', outcomeUnknown: false, retryable: true } });
  });

  it('설정과 호출별 덮어쓰기', async () => {
    const t = new FakeTransport({ timeoutMs: 15_000 });
    t.on(GET.path, reply.hang());
    const p = t.request({ ...GET, timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toMatchObject({ error: { code: 'REQUEST_TIMEOUT' } });
  });

  it('시간 안에 오면 정상, 제한 타이머는 거둔다', async () => {
    const t = new FakeTransport();
    t.on(GET.path, reply.ok({ v: 1 }, 200, 5_000));
    const p = t.request(GET);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toMatchObject({ ok: true, data: { v: 1 } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('늦게 온 응답은 이미 낸 결과를 바꾸지 않는다', async () => {
    const t = new FakeTransport({ timeoutMs: 1_000 });
    t.on(GET.path, reply.ok({}, 200, 5_000));
    const p = t.request(GET);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await p).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000); // 던지지 않는다
  });
});

describe('AbortSignal', () => {
  it('보내는 중 취소 → ABORTED (쓰기는 outcomeUnknown)', async () => {
    const t = new FakeTransport();
    t.on(POST.path, reply.hang());
    const ctrl = new AbortController();
    const p = t.request({ ...POST, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: 'ABORTED', outcomeUnknown: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('보내기 전 취소 → 호출 기록이 없고 outcomeUnknown 아님', async () => {
    const t = new FakeTransport();
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await t.request({ ...POST, signal: ctrl.signal })).toMatchObject({ error: { code: 'ABORTED', outcomeUnknown: false } });
    expect(t.callCount()).toBe(0);
  });
});

describe('request 는 던지지 않는다', () => {
  it('전송이 던져도 NETWORK 오류 값', async () => {
    const t = new FakeTransport();
    t.on(GET.path, reply.networkError('boom'));
    expect(await t.request(GET)).toMatchObject({ ok: false, error: { code: 'NETWORK', message: 'boom' } });
  });
  it('responder 함수가 던져도', async () => {
    const t = new FakeTransport();
    t.on(GET.path, () => {
      throw new Error('handler bug');
    });
    expect(await t.request(GET)).toMatchObject({ ok: false, error: { code: 'NETWORK', message: 'handler bug' } });
  });
});
