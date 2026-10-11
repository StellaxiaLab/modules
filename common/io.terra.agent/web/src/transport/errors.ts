// 오류 봉투 정규화. 정상/오류의 어떤 모양이 와도 던지지 않고 TransportResult 로 만든다.
//
// 만나는 모양:
//   모듈      {"error":{"code","message"}}                            (api.go writeAPIError)
//   Gateway   {"ok":false,"error":{"code","message","retryable","details"},"meta":{…}}
//   브리지    {ok:false,status,error:{code,message}}  (data 없음)       (webAppBridge.ts failure)
//   그 밖     문자열 오류 · 코드만 있는 최상위 · HTML 본문 · 빈 본문 → UNKNOWN

import {
  GATEWAY_ERROR_CODES,
  MODULE_ERROR_CODES,
  TRANSPORT_ERROR_CODES,
  type ErrorCode,
  type GatewayErrorCode,
  type HttpMethod,
  type ModuleErrorCode,
  type TransportError,
  type TransportFailure,
  type TransportResult,
  type TransportErrorCode,
} from './types';

const MODULE_CODES: ReadonlySet<string> = new Set(MODULE_ERROR_CODES);
const GATEWAY_CODES: ReadonlySet<string> = new Set(GATEWAY_ERROR_CODES);
const TRANSPORT_CODES: ReadonlySet<string> = new Set(TRANSPORT_ERROR_CODES);

/** 계약(terra-api.json errors)이 retryable 로 적은 모듈 코드. */
const RETRYABLE_MODULE: ReadonlySet<string> = new Set(['AGENT_UNAVAILABLE']);
/** Gateway 코드 중 서버가 retryable 을 안 실었을 때의 기본. */
const RETRYABLE_GATEWAY: ReadonlySet<string> = new Set(['MODULE_UNAVAILABLE', 'MODULE_INVOCATION_TIMEOUT', 'QUOTA_EXCEEDED']);

/** 요청이 상대에게 가기 전에 막혔음이 확실한 코드. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  'BRIDGE_HANDSHAKE_TIMEOUT',
  'BRIDGE_UNAVAILABLE',
  'BRIDGE_PATH_NOT_ALLOWED',
  'BRIDGE_METHOD_NOT_ALLOWED',
  'BRIDGE_INVALID_REQUEST',
  'INVALID_REQUEST_LOCAL',
]);

/** 브리지/전송에서 오는 원시 응답. 브리지의 `{ok,status,data|error}` 와 같은 모양이다. */
export interface RawResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ErrorFields {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
}

function readFields(value: unknown): ErrorFields {
  if (typeof value === 'string') return { message: value };
  if (!isRecord(value)) return {};
  const out: ErrorFields = {};
  if (typeof value.code === 'string' && value.code) out.code = value.code;
  if (typeof value.message === 'string' && value.message) out.message = value.message;
  if (typeof value.retryable === 'boolean') out.retryable = value.retryable;
  if (value.details !== undefined) out.details = value.details;
  return out;
}

/** 오류 객체를 응답 모양에서 찾아낸다: 브리지의 error → 본문의 error → 본문 최상위 code. */
function extractFields(raw: RawResponse): ErrorFields {
  const fromBridge = readFields(raw.error);
  const body = isRecord(raw.data) ? raw.data : undefined;
  const fromBody = body ? { ...readFields(body), ...readFields(body.error) } : {};
  // 같은 필드는 본문(서버가 쓴 것)이 브리지 요약보다 정확하다. 브리지는 code/message 만 옮긴다.
  return { ...fromBridge, ...fromBody };
}

export function isModuleCode(code: string): code is ModuleErrorCode {
  return MODULE_CODES.has(code);
}
export function isGatewayCode(code: string): code is GatewayErrorCode {
  return GATEWAY_CODES.has(code);
}

/** 쓰기 호출이 응답을 못 받았거나 서버가 처리 여부를 확정하지 못한 상태인가. */
function unknownOutcome(method: HttpMethod, status: number, code: string | undefined): boolean {
  if (method === 'GET') return false; // 읽기는 효과가 없다
  if (code && NOT_SENT_CODES.has(code)) return false; // 보내기 전에 막혔다 — 확정
  if (status === 0) return true;
  if (code && isModuleCode(code)) return false; // 모듈이 답했다 — 확정
  if (code === 'MODULE_UNAVAILABLE') return false; // 모듈에 닿기 전에 막혔다
  if (code && isGatewayCode(code) && status >= 400 && status < 500) return false; // 입구에서 거절
  if (code === 'BRIDGE_GATEWAY_UNREACHABLE') return true; // 셸이 Gateway 에 보냈는지 모른다
  return status >= 500 || status === 0; // 504·502·코드 없는 5xx — 모듈이 실행했을 수 있다
}

/** 실패 결과 한 벌을 만든다. */
export function failure(
  method: HttpMethod,
  init: {
    source: TransportError['source'];
    code: ErrorCode;
    status: number;
    message: string;
    rawCode?: string;
    retryable?: boolean;
    details?: unknown;
    outcomeUnknown?: boolean;
  },
): TransportFailure {
  const error: TransportError = {
    source: init.source,
    code: init.code,
    status: init.status,
    message: init.message,
    retryable: init.retryable ?? false,
    outcomeUnknown: init.outcomeUnknown ?? unknownOutcome(method, init.status, init.rawCode ?? init.code),
  };
  if (init.rawCode !== undefined) error.rawCode = init.rawCode;
  if (isModuleCode(init.code)) error.moduleCode = init.code;
  if (isGatewayCode(init.code)) error.gatewayCode = init.code;
  if (init.details !== undefined) error.details = init.details;
  return { ok: false, status: init.status, error };
}

/** 전송 계층 자체의 실패(시간 초과·중단·네트워크·핸드셰이크 …). */
export function transportFailure(
  method: HttpMethod,
  code: TransportErrorCode,
  message: string,
  extra: { status?: number; retryable?: boolean; outcomeUnknown?: boolean } = {},
): TransportFailure {
  return failure(method, {
    source: 'transport',
    code,
    status: extra.status ?? 0,
    message,
    retryable: extra.retryable ?? false,
    ...(extra.outcomeUnknown !== undefined ? { outcomeUnknown: extra.outcomeUnknown } : {}),
  });
}

function defaultMessage(status: number): string {
  return status > 0 ? `요청이 실패했습니다 (HTTP ${status})` : '응답을 받지 못했습니다';
}

/** 정상/오류 봉투를 하나의 판별 유니온으로. 던지지 않는다. */
export function normalizeResponse<T = unknown>(method: HttpMethod, raw: unknown): TransportResult<T> {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return failure(method, {
      source: 'unknown',
      code: 'UNKNOWN',
      status: isRecord(raw) && typeof raw.status === 'number' ? raw.status : 0,
      message: '알 수 없는 응답 모양입니다',
      details: raw,
      outcomeUnknown: method !== 'GET',
    });
  }
  const status = typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : raw.ok ? 200 : 0;
  const resp: RawResponse = { ok: raw.ok, status, data: raw.data, error: raw.error };

  // 상태 코드가 오류인데 ok:true 라고 오는 모양도 오류로 읽는다(2xx 가 아니면 정상이 아니다).
  const success = resp.ok && status >= 200 && status < 300;
  if (success) {
    return { ok: true, status, data: unwrapSuccess(resp.data) as T };
  }

  const fields = extractFields(resp);
  const rawCode = fields.code;
  let code: ErrorCode = 'UNKNOWN';
  let source: TransportError['source'] = 'unknown';
  if (rawCode !== undefined) {
    if (isModuleCode(rawCode)) {
      code = rawCode;
      source = 'module';
    } else if (isGatewayCode(rawCode)) {
      code = rawCode;
      source = 'gateway';
    } else if (TRANSPORT_CODES.has(rawCode)) {
      code = rawCode as TransportErrorCode;
      source = 'transport';
    } else if (rawCode.startsWith('BRIDGE_')) {
      // 셸 쪽이 새로 만든 BRIDGE_* — 사전에 없어도 브리지 오류로 묶는다.
      code = 'BRIDGE_INVALID_REQUEST';
      source = 'gateway';
    }
  }
  // 코드가 없는 403 은 권한 거절로 읽지 않는다 — 코드를 모르면 UNKNOWN 이다.

  const retryable = fields.retryable ?? (RETRYABLE_MODULE.has(code) || RETRYABLE_GATEWAY.has(code));

  return failure(method, {
    source,
    code,
    status,
    message: fields.message ?? defaultMessage(status),
    ...(rawCode !== undefined ? { rawCode } : {}),
    retryable,
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  });
}

/**
 * Gateway 가 `{ok:true,data,meta}` 봉투로 감쌌다면 data 만 꺼낸다. 모듈 본문은 그대로 둔다
 * (`ok`·`data`·`meta` 가 모두 있는 모양만 봉투로 본다 — 모듈 본문과 겹치지 않는다).
 */
function unwrapSuccess(data: unknown): unknown {
  if (isRecord(data) && data.ok === true && 'data' in data && 'meta' in data) return data.data;
  return data;
}
