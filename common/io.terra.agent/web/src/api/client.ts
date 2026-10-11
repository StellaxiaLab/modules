// operation 별 얇은 래퍼. 전송에는 직접 의존하지 않는다 — 아래 CallFn(포트)만 안다.
// WP-4 가 실제 전송(브리지·토큰·가짜)을 이 모양으로 어댑트해 넣는다.
// 경로·메서드는 contracts/api/terra-api.json 의 bindings 와 src/api.go 의 operationRoutes 에서 가져왔고,
// tests/client.test.ts 가 계약 파일과 한 줄씩 대조한다.
//
// 재시도 never 넷(messages.post · approvals.post · runs.post · mcp.put)은 여기서도 다시 보내지 않는다(I17).
// 래퍼는 한 번 부르고 결과를 그대로 돌려준다 — 응답을 못 받았으면(outcomeUnknown) 호출한 쪽이
// messages.list 로 확인하고 사람이 다시 누르게 한다.

import {
  API_PREFIX,
  type ApprovalAnswered,
  type CredentialFacts,
  type McpListResponse,
  type McpServerFacts,
  type MessagePosted,
  type MessagesListResponse,
  type ModelsListResponse,
  type ModuleStatus,
  type OpenSessionInput,
  type ProviderFacts,
  type RemovedResponse,
  type SessionCancelled,
  type SessionOpened,
  type SessionSnapshot,
  type SessionsListResponse,
} from './types';

// ── 포트 ────────────────────────────────────────────────────────────────

export interface CallRequest {
  method: string;
  path: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface CallFailure {
  ok: false;
  status: number;
  /** 모듈·Gateway·브리지의 오류 코드. 없을 수 있다(네트워크 실패 등). */
  code?: string;
  /** 영어 원문이다 — 화면은 code 로 자기 문구를 고르고 이것은 접어 둔다. */
  message: string;
  /** 요청이 갔는지 알 수 없다(시간 초과·연결 끊김). 재시도 never 호출은 자동으로 다시 보내지 않는다. */
  outcomeUnknown?: boolean;
}

export type CallResult<T> = { ok: true; status: number; data: T } | CallFailure;

export type CallFn = <T>(req: CallRequest) => Promise<CallResult<T>>;

// ── 계약과 같은 제약 ────────────────────────────────────────────────────

/** 세션 id 패턴(계약·session.go validSessionID 와 같다). */
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export const MESSAGE_MAX_CHARS = 20000;
export const TOPIC_MAX_CHARS = 200;
export const MAX_STEPS_RANGE = { min: 1, max: 100 } as const;
export const MAX_SECONDS_RANGE = { min: 1, max: 7200 } as const;
export const MESSAGES_LIMIT_MAX = 5000;
export const API_KEY_MIN_CHARS = 8;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

/**
 * 새 세션 버튼 한 번에 id 하나(함정 9). 같은 id 로 다시 부르면 모듈이 `created:false` 로 답한다(멱등).
 * 순수하게 두려고 시각과 난수를 주입한다. 예: `s-lq3k2x-9fa81c`.
 */
export function generateSessionId(nowMs: number, random: () => number): string {
  const time = Math.max(0, Math.floor(nowMs)).toString(36);
  const noise = Math.floor(Math.min(0.999999999, Math.max(0, random())) * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `s-${time}-${noise}`;
}

function invalid(message: string): CallFailure {
  // 보내기 전에 막은 것이다 — 모듈의 INVALID_REQUEST 와 같은 코드로 화면이 같은 길을 타게 한다.
  return { ok: false, status: 0, code: 'INVALID_REQUEST', message };
}

/** JSON Schema 의 maxLength 는 문자(코드 포인트) 수다. UTF-16 길이로 세면 이모지가 두 번 센다. */
export function charLength(text: string): number {
  return Array.from(text).length;
}

// ── operation 표 ────────────────────────────────────────────────────────

export interface OperationRoute {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** apiPrefix 아래 경로. `{name}` 은 경로 자리표시자다. */
  path: string;
  /** 재시도 never 인가(I17). */
  retryNever?: boolean;
  /** 래퍼를 두지 않는 operation(스트림은 브리지가 못 싣고, runs.post 는 GUI 가 쓰지 않는다). */
  noWrapper?: 'stream' | 'unused';
}

/** 계약 operation 19건 전부. tests/client.test.ts 가 contracts/api/terra-api.json 과 양방향으로 대조한다. */
export const OPERATIONS: readonly OperationRoute[] = [
  { id: 'io.terra.agent.status.get', method: 'GET', path: '/status' },
  { id: 'io.terra.agent.credentials.put', method: 'PUT', path: '/credentials' },
  { id: 'io.terra.agent.credentials.get', method: 'GET', path: '/credentials' },
  { id: 'io.terra.agent.credentials.delete', method: 'DELETE', path: '/credentials' },
  { id: 'io.terra.agent.models.put', method: 'PUT', path: '/models/{provider}' },
  { id: 'io.terra.agent.models.list', method: 'GET', path: '/models' },
  { id: 'io.terra.agent.models.delete', method: 'DELETE', path: '/models/{provider}' },
  { id: 'io.terra.agent.mcp.put', method: 'PUT', path: '/mcp/servers/{server}', retryNever: true },
  { id: 'io.terra.agent.mcp.list', method: 'GET', path: '/mcp/servers' },
  { id: 'io.terra.agent.mcp.delete', method: 'DELETE', path: '/mcp/servers/{server}' },
  { id: 'io.terra.agent.runs.post', method: 'POST', path: '/runs', retryNever: true, noWrapper: 'unused' },
  { id: 'io.terra.agent.sessions.post', method: 'POST', path: '/sessions' },
  { id: 'io.terra.agent.sessions.list', method: 'GET', path: '/sessions' },
  { id: 'io.terra.agent.sessions.get', method: 'GET', path: '/sessions/{session_id}' },
  { id: 'io.terra.agent.messages.list', method: 'GET', path: '/sessions/{session_id}/messages' },
  { id: 'io.terra.agent.messages.post', method: 'POST', path: '/sessions/{session_id}/messages', retryNever: true },
  { id: 'io.terra.agent.messages.stream', method: 'GET', path: '/sessions/{session_id}/stream', noWrapper: 'stream' },
  { id: 'io.terra.agent.sessions.cancel', method: 'POST', path: '/sessions/{session_id}/cancel' },
  { id: 'io.terra.agent.approvals.post', method: 'POST', path: '/approvals/{request_id}', retryNever: true },
];

function route(id: string): OperationRoute {
  const found = OPERATIONS.find((operation) => operation.id === id);
  if (!found) throw new Error(`알 수 없는 operation: ${id}`);
  return found;
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
}

function query(params: Record<string, number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ── 클라이언트 ──────────────────────────────────────────────────────────

export interface AgentClientOptions {
  /** 기본 `/api/modules/io.terra.agent/v1`. 가짜 Gateway 가 다른 접두를 쓰면 바꾼다. */
  prefix?: string;
}

export interface CallOptions {
  signal?: AbortSignal;
}

export function createAgentClient(call: CallFn, options: AgentClientOptions = {}) {
  const prefix = options.prefix ?? API_PREFIX;

  function send<T>(id: string, params: Record<string, string>, extra: { query?: string; body?: unknown }, opts?: CallOptions): Promise<CallResult<T>> {
    const operation = route(id);
    const request: CallRequest = {
      method: operation.method,
      path: prefix + fill(operation.path, params) + (extra.query ?? ''),
    };
    if (extra.body !== undefined) request.body = extra.body;
    if (opts?.signal) request.signal = opts.signal;
    return call<T>(request);
  }

  function checkSessionId(sessionId: string): CallFailure | null {
    return isValidSessionId(sessionId) ? null : invalid(`세션 id 형식이 맞지 않는다: ${sessionId}`);
  }

  return {
    // 모듈 상태 — 권한 없이도 된다(준비 상태 1단계).
    statusGet: (opts?: CallOptions) => send<ModuleStatus>('io.terra.agent.status.get', {}, {}, opts),

    // 자격 사실 — 값은 없다.
    credentialsGet: (opts?: CallOptions) => send<CredentialFacts>('io.terra.agent.credentials.get', {}, {}, opts),
    /** 자격 맡기기. 이 호출은 발급하는 쪽이 한다(요구 §8) — 앱의 붙여넣기 칸은 임시안뿐이다. 값을 로그에 남기지 않는다(I1). */
    credentialsPut: (credential: string, opts?: CallOptions): Promise<CallResult<CredentialFacts>> => {
      if (credential.trim().length < API_KEY_MIN_CHARS) return Promise.resolve(invalid('자격 값은 8자 이상이어야 한다.'));
      return send<CredentialFacts>('io.terra.agent.credentials.put', {}, { body: { credential: credential.trim() } }, opts);
    },
    credentialsDelete: (opts?: CallOptions) => send<RemovedResponse>('io.terra.agent.credentials.delete', {}, {}, opts),

    // 모델 — 노드 전역이다.
    modelsList: (opts?: CallOptions) => send<ModelsListResponse>('io.terra.agent.models.list', {}, {}, opts),
    /** 키를 제공자에 시험하지 않는다(R-11). 본문에만 싣는다(I2). */
    modelsPut: (
      provider: string,
      input: { api_key: string; model?: string; base_url?: string; default?: boolean },
      opts?: CallOptions,
    ): Promise<CallResult<ProviderFacts>> => {
      if (input.api_key.trim().length < API_KEY_MIN_CHARS) return Promise.resolve(invalid('API key 는 8자 이상이어야 한다.'));
      const body: Record<string, unknown> = { api_key: input.api_key.trim() };
      if (input.model !== undefined) body['model'] = input.model;
      if (input.base_url !== undefined) body['base_url'] = input.base_url;
      if (input.default !== undefined) body['default'] = input.default;
      return send<ProviderFacts>('io.terra.agent.models.put', { provider }, { body }, opts);
    },
    modelsDelete: (provider: string, opts?: CallOptions) => send<RemovedResponse>('io.terra.agent.models.delete', { provider }, {}, opts),

    // MCP — 앱은 목록만 읽는다(D-4). 등록·삭제는 agent.external 이 필요해 이 앱에 두지 않는다.
    mcpList: (opts?: CallOptions) => send<McpListResponse>('io.terra.agent.mcp.list', {}, {}, opts),
    /** 이 앱의 화면은 쓰지 않는다(D-4). 재시도 never. */
    mcpPut: (server: string, input: { command: string; args?: string[]; env?: Record<string, string>; read_only?: string[] }, opts?: CallOptions): Promise<CallResult<McpServerFacts>> =>
      send<McpServerFacts>('io.terra.agent.mcp.put', { server }, { body: input }, opts),
    mcpDelete: (server: string, opts?: CallOptions) => send<RemovedResponse>('io.terra.agent.mcp.delete', { server }, {}, opts),

    // 세션
    sessionsList: (opts?: CallOptions) => send<SessionsListResponse>('io.terra.agent.sessions.list', {}, {}, opts),
    sessionsGet: (sessionId: string, opts?: CallOptions): Promise<CallResult<SessionSnapshot>> => {
      const bad = checkSessionId(sessionId);
      if (bad) return Promise.resolve(bad);
      return send<SessionSnapshot>('io.terra.agent.sessions.get', { session_id: sessionId }, {}, opts);
    },
    /**
     * 세션 열기(멱등). `session_id` 는 앱이 만든다 — 생략하면 호출마다 새 세션이 생기므로 생략하지 않는 것이 좋다.
     * 옵션은 열 때 고정이고 이미 있는 id 면 무시된다 — 응답의 실제 값을 보인다(I10).
     */
    sessionsOpen: (input: OpenSessionInput, opts?: CallOptions): Promise<CallResult<SessionOpened>> => {
      const problem = checkOpenInput(input);
      if (problem) return Promise.resolve(problem);
      return send<SessionOpened>('io.terra.agent.sessions.post', {}, { body: compact(input) }, opts);
    },
    /** 되돌릴 수 없다. 종료 상태에는 줄이 또 쌓이므로 종료 상태에서는 호출하지 않는다. */
    sessionsCancel: (sessionId: string, opts?: CallOptions): Promise<CallResult<SessionCancelled>> => {
      const bad = checkSessionId(sessionId);
      if (bad) return Promise.resolve(bad);
      return send<SessionCancelled>('io.terra.agent.sessions.cancel', { session_id: sessionId }, {}, opts);
    },

    // 기록
    /** `limit` 을 안 주면 모듈이 500줄에서 끊는다(함정 8). 쪽 넘김은 data/ledger 가 한다. */
    messagesList: (sessionId: string, params: { after_seq?: number; limit?: number } = {}, opts?: CallOptions): Promise<CallResult<MessagesListResponse>> => {
      const bad = checkSessionId(sessionId);
      if (bad) return Promise.resolve(bad);
      if (params.after_seq !== undefined && (!Number.isInteger(params.after_seq) || params.after_seq < 0)) return Promise.resolve(invalid('after_seq 는 0 이상의 정수여야 한다.'));
      if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > MESSAGES_LIMIT_MAX)) {
        return Promise.resolve(invalid(`limit 은 1~${MESSAGES_LIMIT_MAX} 의 정수여야 한다.`));
      }
      return send<MessagesListResponse>('io.terra.agent.messages.list', { session_id: sessionId }, { query: query({ after_seq: params.after_seq, limit: params.limit }) }, opts);
    },
    /**
     * 말하기 — 재시도 never. 보내기 직전 가드(data/send-guard)를 거친 뒤에 부른다.
     * "y/n/yes/no/approve/deny" 글은 승인 답으로 읽힌다(함정 6).
     */
    messagesPost: (sessionId: string, text: string, opts?: CallOptions): Promise<CallResult<MessagePosted>> => {
      const bad = checkSessionId(sessionId);
      if (bad) return Promise.resolve(bad);
      if (text.trim() === '') return Promise.resolve(invalid('보낼 글이 비어 있다.'));
      if (charLength(text) > MESSAGE_MAX_CHARS) return Promise.resolve(invalid(`글은 ${MESSAGE_MAX_CHARS}자 이하여야 한다.`));
      return send<MessagePosted>('io.terra.agent.messages.post', { session_id: sessionId }, { body: { text } }, opts);
    },

    /** 승인 답 — 재시도 never. 승인은 이것으로만 답한다(I8). 두 번째 호출의 404 APPROVAL_NOT_FOUND 는 정상이다. */
    approvalsPost: (requestId: string, decision: 'approve' | 'deny', opts?: CallOptions): Promise<CallResult<ApprovalAnswered>> => {
      if (requestId.trim() === '') return Promise.resolve(invalid('request_id 가 비어 있다.'));
      return send<ApprovalAnswered>('io.terra.agent.approvals.post', { request_id: requestId }, { body: decision === 'deny' ? { deny: true } : {} }, opts);
    },
  };
}

export type AgentClient = ReturnType<typeof createAgentClient>;

function checkOpenInput(input: OpenSessionInput): CallFailure | null {
  if (input.session_id !== undefined && !isValidSessionId(input.session_id)) return invalid(`세션 id 형식이 맞지 않는다: ${input.session_id}`);
  if (input.topic !== undefined && charLength(input.topic) > TOPIC_MAX_CHARS) return invalid(`제목은 ${TOPIC_MAX_CHARS}자 이하여야 한다.`);
  if (input.max_steps !== undefined && !inRange(input.max_steps, MAX_STEPS_RANGE)) return invalid(`max_steps 는 ${MAX_STEPS_RANGE.min}~${MAX_STEPS_RANGE.max} 의 정수여야 한다.`);
  if (input.max_seconds !== undefined && !inRange(input.max_seconds, MAX_SECONDS_RANGE)) return invalid(`max_seconds 는 ${MAX_SECONDS_RANGE.min}~${MAX_SECONDS_RANGE.max} 의 정수여야 한다.`);
  if (input.token_budget !== undefined && (!Number.isInteger(input.token_budget) || input.token_budget < 1)) return invalid('token_budget 은 1 이상의 정수여야 한다.');
  return null;
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** 모듈은 본문을 엄격히 읽는다(모르는 필드는 400) — 정의된 칸만, 값이 있는 것만 보낸다. */
function compact(input: OpenSessionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const keys = ['session_id', 'autonomy', 'simulate', 'topic', 'provider', 'mcp_servers', 'max_steps', 'max_seconds', 'token_budget'] as const;
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined) body[key] = value;
  }
  return body;
}
