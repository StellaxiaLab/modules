import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeTransport } from '../src/transport/bridge';
import { FakeTransport, reply } from '../src/transport/fake';
import { isRetryNever, retryNeverOperation, RETRY_NEVER_OPERATIONS } from '../src/transport/retry-guard';
import type { HttpMethod, TransportRequest } from '../src/transport/types';
import { AGENT, makeShell } from './transport-helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// 일부러 가장 느슨한 재시도 설정 — 이것으로도 never 넷은 한 번만 나가야 한다.
const GENEROUS = { retry: { extraAttempts: 5, delayMs: 10, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[] } };

const NEVER: { id: string; req: TransportRequest }[] = [
  { id: 'io.terra.agent.messages.post', req: { method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'hi' } } },
  { id: 'io.terra.agent.approvals.post', req: { method: 'POST', path: `${AGENT}/approvals/req-1`, body: { approve: true } } },
  { id: 'io.terra.agent.runs.post', req: { method: 'POST', path: `${AGENT}/runs`, body: { prompt: 'p' } } },
  { id: 'io.terra.agent.mcp.put', req: { method: 'PUT', path: `${AGENT}/mcp/servers/fs`, body: { command: 'x' } } },
];

describe('재시도 never 판별', () => {
  it('넷을 정확히 가려낸다', () => {
    expect(RETRY_NEVER_OPERATIONS.map(o => o.id).sort()).toEqual(NEVER.map(n => n.id).sort());
    for (const { id, req } of NEVER) expect(retryNeverOperation(req.method, req.path)).toBe(id);
  });
  it('쿼리·끝 슬래시·원격 노드 경로에도 적용된다', () => {
    expect(isRetryNever('POST', `${AGENT}/runs?x=1`)).toBe(true);
    expect(isRetryNever('POST', `${AGENT}/sessions/s1/messages/`)).toBe(true);
    expect(isRetryNever('POST', '/api/nodes/n1/modules/io.terra.agent/v1/approvals/r1')).toBe(true);
  });
  it('같은 경로의 읽기·다른 작업은 아니다', () => {
    expect(isRetryNever('GET', `${AGENT}/sessions/s1/messages?after_seq=3`)).toBe(false);
    expect(isRetryNever('POST', `${AGENT}/sessions`)).toBe(false);
    expect(isRetryNever('POST', `${AGENT}/sessions/s1/cancel`)).toBe(false);
    expect(isRetryNever('PUT', `${AGENT}/models/anthropic`)).toBe(false);
    expect(isRetryNever('PUT', `${AGENT}/credentials`)).toBe(false);
    expect(isRetryNever('DELETE', `${AGENT}/mcp/servers/fs`)).toBe(false);
    expect(isRetryNever('POST', '/api/modules/other.module/v1/runs')).toBe(false);
  });
});

describe.each(NEVER)('$id — 느슨한 재시도 설정에서도 한 번만', ({ req }) => {
  it('네트워크 오류: 재전송하지 않고 outcomeUnknown', async () => {
    const t = new FakeTransport(GENEROUS);
    t.on(req.path, reply.networkError());
    const p = t.request(req);
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(t.callCount()).toBe(1);
    expect(r).toMatchObject({ ok: false, error: { code: 'NETWORK', outcomeUnknown: true, retryable: false } });
  });

  it('503 MODULE_UNAVAILABLE(retryable 인 오류)도 재전송하지 않는다', async () => {
    const t = new FakeTransport(GENEROUS);
    t.on(req.path, reply.gatewayFail(503, 'MODULE_UNAVAILABLE', 'down', true));
    const p = t.request(req);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(t.callCount()).toBe(1);
  });

  it('시간 초과: 재전송하지 않고 outcomeUnknown', async () => {
    const t = new FakeTransport({ ...GENEROUS, timeoutMs: 20_000 });
    t.on(req.path, reply.hang());
    const p = t.request(req);
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    expect(t.callCount()).toBe(1);
    expect(r).toMatchObject({ ok: false, error: { code: 'REQUEST_TIMEOUT', outcomeUnknown: true, retryable: false } });
  });

  it('브리지로도 한 번만 나간다(응답 없음 → 시간 초과)', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => undefined });
    const t = new BridgeTransport(shell.win, { ...GENEROUS, timeoutMs: 15_000 });
    const p = t.request(req);
    await vi.advanceTimersByTimeAsync(15_000);
    const r = await p;
    expect(shell.requests()).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, error: { code: 'REQUEST_TIMEOUT', outcomeUnknown: true } });
  });

  it('브리지: 셸이 Gateway 에 닿지 못했다(502)는 응답도 재전송 없이 outcomeUnknown', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: () => ({ ok: false, status: 502, error: { code: 'BRIDGE_GATEWAY_UNREACHABLE', message: 'x' } }),
    });
    const t = new BridgeTransport(shell.win, GENEROUS);
    const p = t.request(req);
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(shell.requests()).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, error: { outcomeUnknown: true, retryable: false } });
  });
});

describe('멱등 읽기에만 제한된 재시도(기본은 꺼짐)', () => {
  const read: TransportRequest = { method: 'GET', path: `${AGENT}/sessions/s1/messages?after_seq=3` };

  it('기본 설정은 재시도하지 않는다', async () => {
    const t = new FakeTransport();
    t.on(read.path, reply.networkError());
    expect((await t.request(read)).ok).toBe(false);
    expect(t.callCount()).toBe(1);
  });

  it('extraAttempts 를 주면 GET 네트워크 오류를 그만큼만 다시 한다', async () => {
    const t = new FakeTransport({ retry: { extraAttempts: 1, delayMs: 100 } });
    t.queue(read.path, reply.networkError(), reply.ok({ entries: [] }));
    const p = t.request(read);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ ok: true });
    expect(t.callCount()).toBe(2);
  });

  it('두 번 다 실패하면 오류를 돌려주고 더 하지 않는다', async () => {
    const t = new FakeTransport({ retry: { extraAttempts: 1, delayMs: 100 } });
    t.on(read.path, reply.networkError());
    const p = t.request(read);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).ok).toBe(false);
    expect(t.callCount()).toBe(2);
  });

  it('모듈이 답한 오류(404 등)는 다시 하지 않는다', async () => {
    const t = new FakeTransport({ retry: { extraAttempts: 3, delayMs: 10 } });
    t.on(read.path, reply.fail(404, 'SESSION_NOT_FOUND'));
    await vi.advanceTimersByTimeAsync(0);
    await t.request(read);
    expect(t.callCount()).toBe(1);
  });

  it('GET 만 허락하는 기본 메서드 목록: 일반 POST 는 설정이 있어도 다시 하지 않는다', async () => {
    const t = new FakeTransport({ retry: { extraAttempts: 3, delayMs: 10 } });
    t.on('POST /api/modules/io.terra.agent/v1/sessions/s1/cancel', reply.networkError());
    await t.request({ method: 'POST', path: `${AGENT}/sessions/s1/cancel` });
    expect(t.callCount()).toBe(1);
  });

  it('재시도 대기 중 취소하면 ABORTED', async () => {
    const t = new FakeTransport({ retry: { extraAttempts: 2, delayMs: 5_000 } });
    t.on(read.path, reply.networkError());
    const ctrl = new AbortController();
    const p = t.request({ ...read, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: 'ABORTED' } });
    expect(t.callCount()).toBe(1);
  });
});
