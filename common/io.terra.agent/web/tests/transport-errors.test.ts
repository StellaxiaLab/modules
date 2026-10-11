import { describe, expect, it } from 'vitest';
import { normalizeResponse } from '../src/transport/errors';
import { GATEWAY_ERROR_CODES, MODULE_ERROR_CODES } from '../src/transport/types';

const MODULE_HTTP: Record<string, number> = {
  INVALID_REQUEST: 400,
  SESSION_NOT_OWNED: 403,
  CREDENTIAL_NOT_UNATTENDED: 403,
  CREDENTIAL_REJECTED: 403,
  SESSION_NOT_FOUND: 404,
  APPROVAL_NOT_FOUND: 404,
  MCP_SERVER_UNKNOWN: 404,
  SESSION_BUSY: 409,
  SESSION_FINISHED: 409,
  CREDENTIAL_MISSING: 409,
  MODEL_NOT_CONFIGURED: 409,
  MCP_UNATTENDED_CONFLICT: 409,
  MCP_SERVER_FAILED: 502,
  AGENT_UNAVAILABLE: 503,
  MODEL_UNAVAILABLE: 502,
};
const GATEWAY_HTTP: Record<string, number> = {
  MODULE_UNAVAILABLE: 503,
  MODULE_PERMISSION_DENIED: 403,
  MODULE_INVOCATION_TIMEOUT: 504,
  UNAUTHORIZED: 401,
  QUOTA_EXCEEDED: 429,
  REQUEST_TOO_LARGE: 413,
  SCOPE_TOKEN_DENIED: 403,
  BRIDGE_NO_PERMISSIONS: 403,
};

function fail(result: ReturnType<typeof normalizeResponse>) {
  if (result.ok) throw new Error('오류여야 한다');
  return result.error;
}

describe('정상 봉투', () => {
  it('2xx 는 data 를 그대로 준다', () => {
    const r = normalizeResponse<{ a: number }>('GET', { ok: true, status: 200, data: { a: 1 } });
    expect(r).toEqual({ ok: true, status: 200, data: { a: 1 } });
  });
  it('본문이 비어도(204) 정상이다', () => {
    expect(normalizeResponse('POST', { ok: true, status: 204 })).toEqual({ ok: true, status: 204, data: undefined });
  });
  it('Gateway 의 {ok,data,meta} 봉투는 data 만 꺼낸다', () => {
    const r = normalizeResponse('GET', { ok: true, status: 200, data: { ok: true, data: { x: 1 }, meta: { request_id: 'r' } } });
    expect(r).toEqual({ ok: true, status: 200, data: { x: 1 } });
  });
  it('모듈 본문이 data 키를 가져도 meta 가 없으면 건드리지 않는다', () => {
    const r = normalizeResponse('GET', { ok: true, status: 200, data: { ok: true, data: [1] } });
    expect(r).toEqual({ ok: true, status: 200, data: { ok: true, data: [1] } });
  });
  it('ok:true 라도 2xx 가 아니면 오류다', () => {
    expect(normalizeResponse('GET', { ok: true, status: 500, data: undefined }).ok).toBe(false);
  });
});

describe('모듈 오류 15개', () => {
  it('표가 계약의 15개와 같다', () => {
    expect(Object.keys(MODULE_HTTP).sort()).toEqual([...MODULE_ERROR_CODES].sort());
    expect(MODULE_ERROR_CODES).toHaveLength(15);
  });
  for (const code of MODULE_ERROR_CODES) {
    it(`${code}`, () => {
      const error = fail(normalizeResponse('POST', { ok: false, status: MODULE_HTTP[code], data: { error: { code, message: `m ${code}` } } }));
      expect(error.source).toBe('module');
      expect(error.code).toBe(code);
      expect(error.moduleCode).toBe(code);
      expect(error.gatewayCode).toBeUndefined();
      expect(error.status).toBe(MODULE_HTTP[code]);
      expect(error.message).toBe(`m ${code}`);
      // 모듈이 답했으므로 쓰기도 결과가 확정이다
      expect(error.outcomeUnknown).toBe(false);
    });
  }
  it('AGENT_UNAVAILABLE 만 retryable', () => {
    for (const code of MODULE_ERROR_CODES) {
      const e = fail(normalizeResponse('GET', { ok: false, status: MODULE_HTTP[code], data: { error: { code, message: 'x' } } }));
      expect(e.retryable).toBe(code === 'AGENT_UNAVAILABLE');
    }
  });
});

describe('Gateway·브리지 오류 8개', () => {
  it('표가 요구 §6.4 의 8개와 같다', () => {
    expect(Object.keys(GATEWAY_HTTP).sort()).toEqual([...GATEWAY_ERROR_CODES].sort());
    expect(GATEWAY_ERROR_CODES).toHaveLength(8);
  });
  for (const code of GATEWAY_ERROR_CODES) {
    it(`${code} (Gateway 봉투)`, () => {
      const status = GATEWAY_HTTP[code] as number;
      const error = fail(
        normalizeResponse('GET', { ok: false, status, data: { ok: false, error: { code, message: 'gw', retryable: false }, meta: { request_id: 'r1' } } }),
      );
      expect(error.source).toBe('gateway');
      expect(error.code).toBe(code);
      expect(error.gatewayCode).toBe(code);
      expect(error.moduleCode).toBeUndefined();
      expect(error.status).toBe(status);
    });
  }
  it('브리지 모양({ok,status,error})도 읽는다 — BRIDGE_NO_PERMISSIONS', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 403, error: { code: 'BRIDGE_NO_PERMISSIONS', message: 'none' } }));
    expect(error).toMatchObject({ source: 'gateway', code: 'BRIDGE_NO_PERMISSIONS', gatewayCode: 'BRIDGE_NO_PERMISSIONS', status: 403, message: 'none' });
  });
  it('403 MODULE_PERMISSION_DENIED 는 모듈 오류가 아니라 Gateway 오류다', () => {
    const error = fail(
      normalizeResponse('GET', { ok: false, status: 403, data: { ok: false, error: { code: 'MODULE_PERMISSION_DENIED', message: 'denied' } } }),
    );
    expect(error.code).toBe('MODULE_PERMISSION_DENIED');
    expect(error.source).toBe('gateway');
    expect(error.status).toBe(403);
  });
  it('서버가 retryable 을 실으면 그대로, 없으면 기본(MODULE_UNAVAILABLE 등 true)', () => {
    const withFlag = fail(normalizeResponse('GET', { ok: false, status: 503, data: { ok: false, error: { code: 'MODULE_UNAVAILABLE', message: 'x', retryable: false } } }));
    expect(withFlag.retryable).toBe(false);
    const without = fail(normalizeResponse('GET', { ok: false, status: 503, data: { error: { code: 'MODULE_UNAVAILABLE', message: 'x' } } }));
    expect(without.retryable).toBe(true);
    expect(fail(normalizeResponse('GET', { ok: false, status: 403, data: { error: { code: 'UNAUTHORIZED', message: 'x' } } })).retryable).toBe(false);
  });
  it('details 를 보존한다', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 502, data: { ok: false, error: { code: 'X', message: 'm', details: { module_answer: 1 } } } }));
    expect(error.details).toEqual({ module_answer: 1 });
  });
});

describe('알 수 없는 모양은 죽지 않고 UNKNOWN', () => {
  const cases: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['문자열', 'boom'],
    ['숫자', 42],
    ['배열', [1, 2]],
    ['ok 가 없는 객체', { status: 500 }],
    ['ok 가 문자열', { ok: 'yes', status: 200 }],
  ];
  for (const [name, raw] of cases) {
    it(`전체 응답이 ${name}`, () => {
      const r = normalizeResponse('GET', raw);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('UNKNOWN');
        expect(r.error.source).toBe('unknown');
        expect(typeof r.error.message).toBe('string');
      }
    });
  }
  it('코드가 사전 밖이면 UNKNOWN + rawCode 보존', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 400, data: { error: { code: 'INVALID_INPUT', message: 'bad' } } }));
    expect(error).toMatchObject({ code: 'UNKNOWN', rawCode: 'INVALID_INPUT', message: 'bad', status: 400, source: 'unknown' });
  });
  it('error 가 문자열이면 메시지로 쓴다', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 500, data: { error: 'it broke' } }));
    expect(error).toMatchObject({ code: 'UNKNOWN', message: 'it broke' });
  });
  it('HTML 본문 · 빈 본문 · 코드 없는 403', () => {
    expect(fail(normalizeResponse('GET', { ok: false, status: 502, data: '<html>bad gateway</html>' })).code).toBe('UNKNOWN');
    const empty = fail(normalizeResponse('GET', { ok: false, status: 500 }));
    expect(empty.code).toBe('UNKNOWN');
    expect(empty.message).toContain('500');
    expect(fail(normalizeResponse('GET', { ok: false, status: 403, data: {} })).code).toBe('UNKNOWN');
  });
  it('최상위 {code,message} 도 읽는다', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 404, data: { code: 'SESSION_NOT_FOUND', message: 'gone' } }));
    expect(error).toMatchObject({ code: 'SESSION_NOT_FOUND', source: 'module' });
  });
  it('모르는 BRIDGE_* 는 브리지 오류로 묶고 원문을 남긴다', () => {
    const error = fail(normalizeResponse('GET', { ok: false, status: 400, error: { code: 'BRIDGE_REMOTE_INVALID', message: 'x' } }));
    expect(error).toMatchObject({ code: 'BRIDGE_INVALID_REQUEST', rawCode: 'BRIDGE_REMOTE_INVALID', source: 'gateway' });
  });
  it('status 가 숫자가 아니어도 죽지 않는다', () => {
    expect(normalizeResponse('GET', { ok: false, status: 'x', data: { error: { code: 'SESSION_BUSY', message: 'b' } } }).ok).toBe(false);
  });
});

describe('outcomeUnknown', () => {
  it('읽기는 어떤 실패에도 false', () => {
    expect(fail(normalizeResponse('GET', { ok: false, status: 504, data: { error: { code: 'MODULE_INVOCATION_TIMEOUT', message: 't' } } })).outcomeUnknown).toBe(false);
  });
  it('쓰기에서 Gateway 504·코드 없는 5xx·BRIDGE_GATEWAY_UNREACHABLE 은 true', () => {
    expect(fail(normalizeResponse('POST', { ok: false, status: 504, data: { error: { code: 'MODULE_INVOCATION_TIMEOUT', message: 't' } } })).outcomeUnknown).toBe(true);
    expect(fail(normalizeResponse('POST', { ok: false, status: 500, data: 'oops' })).outcomeUnknown).toBe(true);
    expect(fail(normalizeResponse('PUT', { ok: false, status: 502, error: { code: 'BRIDGE_GATEWAY_UNREACHABLE', message: 'u' } })).outcomeUnknown).toBe(true);
  });
  it('쓰기에서도 모듈이 답했거나 입구에서 거절되면 false', () => {
    expect(fail(normalizeResponse('POST', { ok: false, status: 409, data: { error: { code: 'SESSION_BUSY', message: 'b' } } })).outcomeUnknown).toBe(false);
    expect(fail(normalizeResponse('POST', { ok: false, status: 403, data: { error: { code: 'MODULE_PERMISSION_DENIED', message: 'd' } } })).outcomeUnknown).toBe(false);
    expect(fail(normalizeResponse('POST', { ok: false, status: 503, data: { error: { code: 'MODULE_UNAVAILABLE', message: 'u' } } })).outcomeUnknown).toBe(false);
    expect(fail(normalizeResponse('POST', { ok: false, status: 403, error: { code: 'BRIDGE_NO_PERMISSIONS', message: 'n' } })).outcomeUnknown).toBe(false);
  });
});
