// 오류 코드 표와 오류 봉투.
//
// 모듈 오류 15개는 계약(contracts/api/terra-api.json errors)의 httpStatus·retryable 과 같아야 하고,
// 그 일치는 server/contract.test.mjs 가 매번 대조한다 — 여기를 손으로 고치면 시험이 알려 준다.
//
// 봉투 두 가지(전송 어댑터 errors.ts 가 읽는 모양):
//   모듈     {"error":{"code","message"}}                                       (api.go writeAPIError)
//   Gateway  {"error":{"code","message","traceId"[,"details","retryable"]}}      (실제: terra-gateway-service writeError·
//            writeErrorDetails — ok·meta 가 없고, retryable 은 true 일 때만 싣는다)
// 성공은 모듈 본문 그대로(기본) 이거나, envelope='gateway' 설정일 때 {"ok":true,"data":…,"meta":{…}} 로 감싼다.

export const MODULE_ERRORS = {
  INVALID_REQUEST: { status: 400, retryable: false },
  SESSION_NOT_OWNED: { status: 403, retryable: false },
  CREDENTIAL_NOT_UNATTENDED: { status: 403, retryable: false },
  CREDENTIAL_REJECTED: { status: 403, retryable: false },
  SESSION_NOT_FOUND: { status: 404, retryable: false },
  APPROVAL_NOT_FOUND: { status: 404, retryable: false },
  MCP_SERVER_UNKNOWN: { status: 404, retryable: false },
  SESSION_BUSY: { status: 409, retryable: true },
  SESSION_FINISHED: { status: 409, retryable: false },
  CREDENTIAL_MISSING: { status: 409, retryable: false },
  MODEL_NOT_CONFIGURED: { status: 409, retryable: false },
  MCP_UNATTENDED_CONFLICT: { status: 409, retryable: false },
  MCP_SERVER_FAILED: { status: 502, retryable: true },
  AGENT_UNAVAILABLE: { status: 503, retryable: true },
  MODEL_UNAVAILABLE: { status: 502, retryable: true },
};

/** Gateway·브리지가 만드는 오류(요구 §6.4). 상태는 이 가짜가 쓰는 기본값이다. */
export const GATEWAY_ERRORS = {
  MODULE_UNAVAILABLE: { status: 503, retryable: true },
  MODULE_PERMISSION_DENIED: { status: 403, retryable: false },
  MODULE_INVOCATION_TIMEOUT: { status: 504, retryable: true },
  UNAUTHORIZED: { status: 401, retryable: false },
  QUOTA_EXCEEDED: { status: 429, retryable: true },
  REQUEST_TOO_LARGE: { status: 413, retryable: false },
  SCOPE_TOKEN_DENIED: { status: 403, retryable: false },
};

/** 주입으로 만들 수는 없고 서버가 스스로 내는 Gateway 코드(실제 Gateway 의 errors.go). */
export const GATEWAY_ROUTING_ERRORS = {
  MODULE_ROUTE_NOT_FOUND: { status: 404, retryable: false },
};

/** 모듈 코드를 가진 HTTP 오류. 핸들러는 던지고, 바깥 계층이 봉투로 만든다. */
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status ?? MODULE_ERRORS[code]?.status ?? 500;
  }
}

export const moduleError = (code, message, status) => new ApiError(code, message ?? code, status);

/** api.go 의 sentinel 오류 문구(영어 원문 그대로 — 화면은 code 사전을 우선하고 원문은 접는다). */
export const MESSAGES = {
  sessionNotFound: 'session not found',
  notOwner: 'this session belongs to someone else; sessions run as their owner\'s credential and cannot be shared',
  busy: 'the model\'s turn is in progress; watch the stream for it to end, then send again',
  finished: 'this session is finished and takes no more messages',
  approvalMissing: 'no such approval request, or it was already answered',
  credentialMissing: 'no delegated credential is registered for this person; run `terra agent grant` and `terra agent credential set --token-stdin`',
  modelNotConfigured: 'no model provider is registered; run `terra agent model add anthropic --api-key-stdin`',
  mcpUnknown: 'no such external MCP server is registered on this node; register it with `terra agent mcp add <name> -- <command>`',
  mcpUnattended: 'an unattended session does not use external MCP servers: nobody is present, third-party text enters the context, and write consent was given in advance — open it with a different autonomy, or without mcp_servers (설계 §7.10 R5)',
  noDoor: 'the host offers no core capability plane; terra.gateway.delegate is unreachable',
  noPrincipal: 'the caller\'s principal is missing; this surface is reached through the Gateway',
};

export function moduleBody(code, message) {
  return { error: { code, message } };
}

/** 실제 Gateway 의 오류 본문. retryable 은 true 일 때만 싣는다(writeError 는 아예 싣지 않는다) — 앱이 코드별 기본을 쓴다. */
export function gatewayBody(code, message, { retryable, details, traceId = 'trace-fake' } = {}) {
  const error = { code, message, traceId };
  if (details !== undefined) error.details = details;
  if (retryable === true) error.retryable = true;
  return { error };
}

/** 호출자가 누구인지 묻는 문구와 권한 부족 문구 — 실제 Gateway server.go admitInvocation 의 것이다. 토큰이 무효·만료인 403 은 앞의 것이다. */
export const LOGIN_REQUIRED_MESSAGE = (operationId) => `이 operation은 로그인한 호출자가 필요합니다: ${operationId}`;
export const PERMISSION_DENIED_MESSAGE = (operationId) => `호출에 필요한 권한이 없습니다: ${operationId}`;
