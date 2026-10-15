import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeTransport, type BridgeWindow } from '../src/transport/bridge';
import { AGENT, makeShell } from './transport-helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const STATUS = { method: 'GET', path: `${AGENT}/status` } as const;

describe('핸드셰이크', () => {
  it('hello → ready(permissions) 를 받으면 요청이 나간다', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: m => ({ ok: true, status: 200, data: { echo: m.path } }),
    });
    const t = new BridgeTransport(shell.win);
    const r = await t.request<{ echo: string }>(STATUS);
    expect(r).toEqual({ ok: true, status: 200, data: { echo: `${AGENT}/status` } });
    expect(shell.posted[0]?.message).toEqual({ type: 'terra.webapp.hello' });
    expect(t.permissions).toEqual(['agent.use']);
    expect(shell.hellos()).toBe(1);
  });

  it('핸드셰이크는 한 번만 — 두 번째 요청은 hello 를 다시 보내지 않는다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: {} }) });
    const t = new BridgeTransport(shell.win);
    await Promise.all([t.request(STATUS), t.request(STATUS)]);
    await t.request(STATUS);
    expect(shell.hellos()).toBe(1);
    expect(shell.requests()).toHaveLength(3);
  });

  it('셸이 답하지 않으면 시간 제한 후 BRIDGE_HANDSHAKE_TIMEOUT (보내지 않았음이 확실)', async () => {
    const shell = makeShell({});
    const t = new BridgeTransport(shell.win, { handshakeTimeoutMs: 3000, helloIntervalMs: 1000 });
    const p = t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'hi' } });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('BRIDGE_HANDSHAKE_TIMEOUT');
      expect(r.error.source).toBe('transport');
      expect(r.error.outcomeUnknown).toBe(false);
    }
    expect(shell.requests()).toHaveLength(0);
    // hello 는 간격대로 다시 보냈다(0s, 1s, 2s)
    expect(shell.hellos()).toBe(3);
  });

  it('ready 가 늦게 와도(두 번째 hello) 이어진다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], answerHelloFrom: 2, respond: () => ({ ok: true, status: 200, data: 'ok' }) });
    const t = new BridgeTransport(shell.win, { helloIntervalMs: 1000 });
    const p = t.request(STATUS);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ ok: true, data: 'ok' });
  });

  it('핸드셰이크가 실패해도 다음 호출이 다시 시도한다', async () => {
    const shell = makeShell({});
    const t = new BridgeTransport(shell.win, { handshakeTimeoutMs: 1000, helloIntervalMs: 5000 });
    const first = t.request(STATUS);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await first).ok).toBe(false);
    const second = t.request(STATUS);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await second).ok).toBe(false);
    expect(shell.hellos()).toBe(2);
  });

  it('최상위 창(부모가 자기 자신)이면 BRIDGE_UNAVAILABLE — hello 를 보내지 않는다', async () => {
    const win: Record<string, unknown> = { addEventListener() {}, removeEventListener() {} };
    win.parent = win;
    win.self = win;
    const t = new BridgeTransport(win as unknown as BridgeWindow);
    const r = await t.request(STATUS);
    expect(r).toMatchObject({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE', outcomeUnknown: false } });
  });

  it('권한이 비어 있으면 요청을 보내지 않고 BRIDGE_NO_PERMISSIONS', async () => {
    const shell = makeShell({ permissions: [], respond: () => ({ ok: true, status: 200, data: {} }) });
    const t = new BridgeTransport(shell.win);
    const r = await t.request(STATUS);
    expect(r).toMatchObject({ ok: false, status: 403, error: { code: 'BRIDGE_NO_PERMISSIONS', gatewayCode: 'BRIDGE_NO_PERMISSIONS' } });
    expect(shell.requests()).toHaveLength(0);
  });
});

describe('요청/응답 매핑', () => {
  it('요청 메시지 모양: type·id·method·path·body, GET 에는 body 가 없다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 201, data: { created: true } }) });
    const t = new BridgeTransport(shell.win, { newId: () => 'req-1' });
    const r = await t.request({ method: 'POST', path: `${AGENT}/sessions`, body: { session_id: 's1', autonomy: 'plan' } });
    expect(r).toEqual({ ok: true, status: 201, data: { created: true } });
    expect(shell.requests()[0]).toEqual({
      type: 'terra.webapp.request',
      id: 'req-1',
      method: 'POST',
      path: `${AGENT}/sessions`,
      body: { session_id: 's1', autonomy: 'plan' },
    });
    await t.request({ method: 'GET', path: `${AGENT}/sessions`, body: { ignored: true } });
    expect(shell.requests()[1]).not.toHaveProperty('body');
  });

  it('요청마다 다른 id 를 쓰고, 응답은 id 로 짝을 찾는다(순서가 뒤바뀌어도)', async () => {
    const queue: Record<string, unknown>[] = [];
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: m => {
        queue.push(m);
        return undefined; // 나중에 손으로 답한다
      },
    });
    const t = new BridgeTransport(shell.win);
    const a = t.request({ method: 'GET', path: `${AGENT}/models` });
    const b = t.request({ method: 'GET', path: `${AGENT}/credentials` });
    await vi.advanceTimersByTimeAsync(0);
    expect(queue).toHaveLength(2);
    expect(queue[0]?.id).not.toBe(queue[1]?.id);
    shell.emit({ type: 'terra.webapp.response', id: queue[1]?.id, ok: true, status: 200, data: 'B' });
    shell.emit({ type: 'terra.webapp.response', id: queue[0]?.id, ok: true, status: 200, data: 'A' });
    expect(await a).toMatchObject({ data: 'A' });
    expect(await b).toMatchObject({ data: 'B' });
  });

  it('오류 응답은 정규화한다: 모듈 오류 본문', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: () => ({ ok: false, status: 409, data: { error: { code: 'SESSION_BUSY', message: 'a turn is running' } } }),
    });
    const t = new BridgeTransport(shell.win);
    const r = await t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'x' } });
    expect(r).toMatchObject({ ok: false, status: 409, error: { code: 'SESSION_BUSY', moduleCode: 'SESSION_BUSY', outcomeUnknown: false } });
  });

  it('오류 응답은 정규화한다: 셸의 error 필드(경로·메서드 거절)', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: () => ({ ok: false, status: 502, error: { code: 'BRIDGE_GATEWAY_UNREACHABLE', message: 'ECONNREFUSED' } }),
    });
    const t = new BridgeTransport(shell.win);
    const r = await t.request({ method: 'GET', path: `${AGENT}/status` });
    expect(r).toMatchObject({ ok: false, status: 502, error: { code: 'BRIDGE_GATEWAY_UNREACHABLE', message: 'ECONNREFUSED' } });
  });

  it('403 MODULE_PERMISSION_DENIED', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: () => ({ ok: false, status: 403, data: { ok: false, error: { code: 'MODULE_PERMISSION_DENIED', message: 'denied' }, meta: {} } }),
    });
    const t = new BridgeTransport(shell.win);
    expect(await t.request({ method: 'GET', path: `${AGENT}/sessions` })).toMatchObject({
      ok: false,
      status: 403,
      error: { code: 'MODULE_PERMISSION_DENIED', source: 'gateway' },
    });
  });

  it('응답 모양이 이상해도(ok 없음) 던지지 않고 UNKNOWN', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ weird: true }) });
    const t = new BridgeTransport(shell.win);
    const r = await t.request({ method: 'GET', path: `${AGENT}/status` });
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
  });
});

describe('경로·메서드 제한', () => {
  it('모듈 이름 공간 밖은 보내지 않고 거절한다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: {} }) });
    const t = new BridgeTransport(shell.win);
    for (const path of ['/api/v1/gui/apps', '/api/modules', 'api/modules/x', '/api/modules/../v1/sessions', '/api/modules//x', 'https://evil/api/modules/x', '/api/modules/a b']) {
      const r = await t.request({ method: 'GET', path });
      expect(r, path).toMatchObject({ ok: false, error: { code: 'BRIDGE_PATH_NOT_ALLOWED', outcomeUnknown: false } });
    }
    expect(shell.requests()).toHaveLength(0);
  });

  it('/api/nodes/ 는 통과한다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: 1 }) });
    const t = new BridgeTransport(shell.win);
    expect(await t.request({ method: 'GET', path: '/api/nodes/n1/modules/io.terra.agent/v1/status' })).toMatchObject({ ok: true });
  });

  it('다섯 메서드만 — 그 밖은 거절', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: 1 }) });
    const t = new BridgeTransport(shell.win);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect((await t.request({ method, path: `${AGENT}/x` })).ok).toBe(true);
    }
    const r = await t.request({ method: 'HEAD' as never, path: `${AGENT}/x` });
    expect(r).toMatchObject({ ok: false, error: { code: 'BRIDGE_METHOD_NOT_ALLOWED' } });
    expect(shell.requests()).toHaveLength(5);
  });
});

describe('신뢰와 정리', () => {
  it('부모가 아닌 창이 보낸 ready·response 는 무시한다', async () => {
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: m => {
        // 공격자 창이 먼저 가짜 응답을 보낸다
        shell.emit({ type: 'terra.webapp.response', id: m.id, ok: true, status: 200, data: 'FORGED' }, {});
        return { ok: true, status: 200, data: 'REAL' };
      },
    });
    const t = new BridgeTransport(shell.win);
    expect(await t.request(STATUS)).toMatchObject({ data: 'REAL' });
  });

  it('모르는 id 의 응답과 메시지가 아닌 data 는 무시한다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: 'x' }) });
    const t = new BridgeTransport(shell.win);
    await t.request(STATUS);
    expect(() => {
      shell.emit({ type: 'terra.webapp.response', id: 'nope', ok: true, status: 200 });
      shell.emit(null);
      shell.emit('string');
      shell.emit({ type: 42 });
    }).not.toThrow();
  });

  it('AbortSignal: 응답 전에 취소하면 ABORTED, 늦은 응답은 무시한다', async () => {
    const seen: Record<string, unknown>[] = [];
    const shell = makeShell({ permissions: ['agent.use'], respond: m => void seen.push(m) });
    const t = new BridgeTransport(shell.win);
    const ctrl = new AbortController();
    const p = t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'x' }, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(0);
    ctrl.abort();
    const r = await p;
    expect(r).toMatchObject({ ok: false, error: { code: 'ABORTED', outcomeUnknown: true } });
    expect(() => shell.emit({ type: 'terra.webapp.response', id: seen[0]?.id, ok: true, status: 200 })).not.toThrow();
  });

  it('이미 취소된 signal 이면 아무것도 보내지 않는다', async () => {
    const shell = makeShell({ permissions: ['agent.use'] });
    const t = new BridgeTransport(shell.win);
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await t.request({ ...STATUS, signal: ctrl.signal });
    expect(r).toMatchObject({ ok: false, error: { code: 'ABORTED', outcomeUnknown: false } });
    expect(shell.posted).toHaveLength(0);
  });

  it('dispose: 리스너를 거두고 대기 중 요청을 끝내며 이후 요청은 오류 값', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => undefined });
    const t = new BridgeTransport(shell.win);
    const p = t.request({ method: 'GET', path: `${AGENT}/status` });
    await vi.advanceTimersByTimeAsync(0);
    expect(shell.listenerCount()).toBe(1);
    t.dispose();
    expect(shell.listenerCount()).toBe(0);
    expect(await p).toMatchObject({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE' } });
    expect(await t.request(STATUS)).toMatchObject({ ok: false });
  });

  it('targetOrigin 기본은 * 이고 바꿀 수 있다', async () => {
    const shell = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: 1 }) });
    const t = new BridgeTransport(shell.win, { targetOrigin: 'https://shell.example' });
    await t.request(STATUS);
    expect(shell.posted.every(p => p.targetOrigin === 'https://shell.example')).toBe(true);
    const shell2 = makeShell({ permissions: ['agent.use'], respond: () => ({ ok: true, status: 200, data: 1 }) });
    await new BridgeTransport(shell2.win).request(STATUS);
    expect(shell2.posted.every(p => p.targetOrigin === '*')).toBe(true);
  });
});

// 컴파일 시점 확인: 진짜 window 가 BridgeWindow 에 들어간다(런타임에는 실행하지 않는다).
export function _windowFits(): BridgeWindow | undefined {
  return typeof window === 'undefined' ? undefined : window;
}
