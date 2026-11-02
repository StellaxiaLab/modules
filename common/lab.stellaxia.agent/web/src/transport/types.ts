// 전송 계층의 공개 타입. 화면·데이터층은 이 파일의 AgentTransport 하나만 안다 —
// 브리지인지 토큰인지 가짜인지 모른다(요구 §2.3).
// 여기에는 API 응답의 도메인 타입(세션·entry 등)을 두지 않는다. 응답은 제네릭 T 로 열어 둔다.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export interface TransportRequest {
  method: HttpMethod;
  /** `/api/modules/…` 또는 `/api/nodes/…` 로 시작하는 경로. 쿼리 문자열을 포함해도 된다. */
  path: string;
  /** JSON 으로 직렬화되는 본문. GET 에서는 보내지 않는다. */
  body?: unknown;
  signal?: AbortSignal;
  /** 이 호출만의 시간 제한(ms). 없으면 전송의 기본값(20초). */
  timeoutMs?: number;
}

/** 모듈 오류 계약의 15개 코드(요구 §6.4). */
export const MODULE_ERROR_CODES = [
  'INVALID_REQUEST',
  'SESSION_NOT_OWNED',
  'CREDENTIAL_NOT_UNATTENDED',
  'CREDENTIAL_REJECTED',
  'SESSION_NOT_FOUND',
  'APPROVAL_NOT_FOUND',
  'MCP_SERVER_UNKNOWN',
  'SESSION_BUSY',
  'SESSION_FINISHED',
  'CREDENTIAL_MISSING',
  'MODEL_NOT_CONFIGURED',
  'MCP_UNATTENDED_CONFLICT',
  'MCP_SERVER_FAILED',
  'AGENT_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
] as const;
export type ModuleErrorCode = (typeof MODULE_ERROR_CODES)[number];

/** Gateway·브리지 오류 8개(요구 §6.4). `MODULE_PERMISSION_DENIED` 가 403 으로 온다. */
export const GATEWAY_ERROR_CODES = [
  'MODULE_UNAVAILABLE',
  'MODULE_PERMISSION_DENIED',
  'MODULE_INVOCATION_TIMEOUT',
  'UNAUTHORIZED',
  'QUOTA_EXCEEDED',
  'REQUEST_TOO_LARGE',
  'SCOPE_TOKEN_DENIED',
  'BRIDGE_NO_PERMISSIONS',
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

/** 전송 계층이 스스로 만드는 코드 — 서버가 말한 것이 아니다. */
export const TRANSPORT_ERROR_CODES = [
  /** 셸 브리지가 hello 에 답하지 않았다(셸 밖이거나 셸이 느리다). */
  'BRIDGE_HANDSHAKE_TIMEOUT',
  /** 브리지 포트가 없다(창이 없다 · 최상위 창이다). */
  'BRIDGE_UNAVAILABLE',
  /** 경로가 모듈 이름 공간 밖이다(셸이 거절하는 것을 앞서 거절한다). */
  'BRIDGE_PATH_NOT_ALLOWED',
  'BRIDGE_METHOD_NOT_ALLOWED',
  /** 셸 쪽 요청 형식 거절 · 셸이 Gateway 에 닿지 못함 · 그 밖의 BRIDGE_* 응답. */
  'BRIDGE_INVALID_REQUEST',
  'BRIDGE_GATEWAY_UNREACHABLE',
  'REQUEST_TIMEOUT',
  'ABORTED',
  'NETWORK',
  'INVALID_REQUEST_LOCAL',
] as const;
export type TransportErrorCode = (typeof TRANSPORT_ERROR_CODES)[number];

/** 정규화된 오류 코드. 사전에 없는 서버 코드는 `UNKNOWN` 이고 원문은 `rawCode` 에 남는다. */
export type ErrorCode = ModuleErrorCode | GatewayErrorCode | TransportErrorCode | 'UNKNOWN';

export type ErrorSource = 'module' | 'gateway' | 'transport' | 'unknown';

export interface TransportError {
  /** 오류가 어디서 났는가. */
  source: ErrorSource;
  /** 정규화된 코드. 화면은 이것으로 사전을 찾는다. */
  code: ErrorCode;
  /** 서버가 보낸 코드 원문(사전 밖이어도 보존한다). 접어서 보이는 용도. */
  rawCode?: string;
  /** 모듈 오류 계약의 코드일 때만. */
  moduleCode?: ModuleErrorCode;
  /** Gateway·브리지 코드일 때만. */
  gatewayCode?: GatewayErrorCode;
  /** HTTP 상태. 응답을 받지 못했으면 0. */
  status: number;
  /** 사람이 읽을 메시지(서버 원문은 영어일 수 있다 — 화면은 code 사전을 우선한다). */
  message: string;
  /** 서버 또는 전송이 말하는 "다시 해 볼 만하다". 재전송을 허락하는 것이 아니다 — I17 가드가 위에 있다. */
  retryable: boolean;
  /**
   * 요청이 상대에게 닿아 효과가 났는지 알 수 없다(응답을 못 받음 · 시간 초과 · 중단 · 5xx 불명).
   * 쓰기 호출에서만 켜진다. 상위는 자동 재전송하지 않고 `messages.list` 등으로 확인한다(I17).
   */
  outcomeUnknown: boolean;
  details?: unknown;
}

export interface TransportOk<T = unknown> {
  ok: true;
  status: number;
  data: T;
}

export interface TransportFailure {
  ok: false;
  status: number;
  error: TransportError;
}

export type TransportResult<T = unknown> = TransportOk<T> | TransportFailure;

/** 앱의 모든 호출이 지나는 문. request 는 던지지 않는다 — 실패도 값이다. */
export interface AgentTransport {
  readonly kind: 'bridge' | 'token' | 'fake';
  request<T = unknown>(req: TransportRequest): Promise<TransportResult<T>>;
  /** 리스너·타이머를 거둔다. 이후 request 는 오류 값을 돌려준다. */
  dispose?(): void;
}

/** 시계 주입 — 시험이 가짜 타이머를 끼운다. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
