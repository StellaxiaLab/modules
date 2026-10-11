import { describe, expect, it, vi } from 'vitest';
import { createDevTokenTransport, TokenTransport } from '../src/transport/token';
import { AGENT } from './transport-helpers';

const SECRET = 'tsa_super_secret_value';

function okFetch(body: unknown = { ok: 1 }, status = 200) {
  return vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('TokenTransport', () => {
  it('Bearer 토큰과 JSON 본문으로 Gateway 에 보낸다', async () => {
    const fetchImpl = okFetch({ created: true }, 201);
    const t = new TokenTransport({ token: SECRET, gatewayUrl: 'https://gw.example/', fetchImpl });
    const r = await t.request({ method: 'POST', path: `${AGENT}/sessions`, body: { session_id: 's1' } });
    expect(r).toEqual({ ok: true, status: 201, data: { created: true } });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://gw.example${AGENT}/sessions`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(init.body).toBe('{"session_id":"s1"}');
  });

  it('GET 에는 본문이 없다', async () => {
    const fetchImpl = okFetch();
    await new TokenTransport({ token: SECRET, fetchImpl }).request({ method: 'GET', path: `${AGENT}/status`, body: { x: 1 } });
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body).toBeUndefined();
  });

  it('오류 응답을 모듈 오류로 정규화한다', async () => {
    const fetchImpl = okFetch({ error: { code: 'SESSION_NOT_FOUND', message: 'no' } }, 404);
    const r = await new TokenTransport({ token: SECRET, fetchImpl }).request({ method: 'GET', path: `${AGENT}/sessions/x` });
    expect(r).toMatchObject({ ok: false, status: 404, error: { code: 'SESSION_NOT_FOUND', moduleCode: 'SESSION_NOT_FOUND' } });
  });

  it('JSON 이 아닌 본문(HTML 502)도 죽지 않는다', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>bad</html>', { status: 502 }));
    const r = await new TokenTransport({ token: SECRET, fetchImpl }).request({ method: 'POST', path: `${AGENT}/runs`, body: {} });
    expect(r).toMatchObject({ ok: false, status: 502, error: { code: 'UNKNOWN', outcomeUnknown: true } });
  });

  it('fetch 가 던지면 NETWORK, 오류 값에 토큰이 없다', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await new TokenTransport({ token: SECRET, fetchImpl }).request({ method: 'POST', path: `${AGENT}/sessions/s/messages`, body: { text: 'x' } });
    expect(r).toMatchObject({ ok: false, error: { code: 'NETWORK', outcomeUnknown: true } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('경로 제한은 브리지와 같다', async () => {
    const fetchImpl = okFetch();
    const r = await new TokenTransport({ token: SECRET, fetchImpl }).request({ method: 'GET', path: '/api/v1/sessions' });
    expect(r).toMatchObject({ ok: false, error: { code: 'BRIDGE_PATH_NOT_ALLOWED' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('재시도 never 는 토큰 전송에서도 한 번만', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('reset');
    });
    const t = new TokenTransport({ token: SECRET, fetchImpl, retry: { extraAttempts: 3, delayMs: 1, methods: ['GET', 'POST'] } });
    await t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'x' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('토큰은 JSON·inspect·열거에 나오지 않고 저장소에도 쓰지 않는다', () => {
    const t = new TokenTransport({ token: SECRET, fetchImpl: okFetch() });
    expect(JSON.stringify(t)).not.toContain(SECRET);
    expect(String(Reflect.ownKeys(t).map(String))).not.toContain('token');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(t) as object).join()).not.toContain('token');
    expect(Object.keys(t).join()).not.toContain('token');
    expect(Object.values(t).some(v => v === SECRET)).toBe(false);
  });

  it('빈 토큰은 만들지 못한다', () => {
    expect(() => new TokenTransport({ token: '' })).toThrow();
  });
});

describe('createDevTokenTransport', () => {
  it('환경 변수가 없으면 만들지 않는다', () => {
    // 시험 환경에는 VITE_TERRA_DEV_TOKEN 이 없다
    expect(createDevTokenTransport()).toBeUndefined();
  });
  it('개발 서버에서 VITE_TERRA_DEV_TOKEN 이 있을 때만 만든다', async () => {
    vi.stubEnv('VITE_TERRA_DEV_TOKEN', '  ' + SECRET + ' ');
    vi.stubEnv('VITE_TERRA_GATEWAY_URL', 'https://gw.example');
    try {
      const t = createDevTokenTransport({ });
      expect(t?.kind).toBe('token');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('공백뿐인 토큰은 없는 것으로 본다', () => {
    vi.stubEnv('VITE_TERRA_DEV_TOKEN', '   ');
    try {
      expect(createDevTokenTransport()).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
