// 모듈 io.terra.agent 의 응답·entry·세션·승인·오류 타입.
// 정본: contracts/api/terra-api.json 과 src/session.go·api.go(소스가 계약과 어긋나면 소스를 따른다).
// 모듈 쪽 변경(M-1~M-7)이 진행 중이라, 아직 없을 수 있는 칸은 모두 선택(optional)으로 둔다 —
// 있으면 쓰고, 없으면 data/ 의 대체 규칙을 따른다.

/** 모든 operation 이 붙는 길. 브리지는 /api/modules/ 아래만 부를 수 있다. */
export const API_PREFIX = '/api/modules/io.terra.agent/v1';

// ── 세션 ────────────────────────────────────────────────────────────────

export const SESSION_STATES = ['idle', 'running', 'waiting-approval', 'done', 'cancelled', 'failed', 'archived'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const AUTONOMIES = ['plan', 'ask', 'auto', 'unattended'] as const;
export type Autonomy = (typeof AUTONOMIES)[number];

/** 세션 누적 사용량. 토큰만 보인다(I14 — 통화 환산 없음). `model_calls` 는 계약에만 있고 코드는 내지 않는다(요구 §14.3 ⑨). */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model_calls?: number;
}

/** M-2: 계약이 말하는 것. 적지 않은 칸은 키가 **없다** — "없음"(빈 목록·`none`)과 "적지 않음"은 다른 사실이다(DC-17). */
export interface ApprovalContract {
  risk?: string;
  confirmation_mode?: string;
  idempotency_mode?: string;
  retry_mode?: string;
  output_mode?: string;
  side_effects?: Array<{ resource_id?: string; action?: string }>;
  permissions?: string[];
}

/** 대기 중인 승인 질문 하나. `contract`·`expires_ms`·`reason`·`judgement` 는 모듈 쪽 변경(M-2·M-3)에 따라 있을 수도 없을 수도 있다. */
export interface PendingApproval {
  request_id: string;
  operation_id: string;
  created_ms: number;
  /** 모델의 주장이다 — 근거가 아니다. */
  reason?: string;
  /** 모듈이 계산한 판정 근거. */
  judgement?: string;
  input?: unknown;
  contract?: ApprovalContract;
  /** M-3: 이 질문이 포기하는 시각(epoch ms). 없으면 근사한다(GAP-12). */
  expires_ms?: number;
}

/** sessions.get / sessions.list 의 한 세션. */
export interface SessionSnapshot {
  session_id: string;
  state: SessionState;
  autonomy: Autonomy;
  simulate: boolean;
  owner: string;
  steps: number;
  max_steps: number;
  created_ms: number;
  updated_ms: number;
  topic?: string;
  provider?: string;
  model?: string;
  max_seconds?: number;
  token_budget?: number;
  usage?: Usage;
  mcp_servers?: string[];
  /** 비어 있으면 `null` 이 올 수 있다. */
  answer?: string | null;
  /** 영어 문장이다(함정 5). 코드를 여기서 파싱하지 않는다. */
  last_error?: string | null;
  /** M-6: 마지막 오류의 코드. 없으면 기록의 `error` 줄에서 읽는다. */
  last_error_code?: string | null;
  pending_approvals?: PendingApproval[];
}

export interface SessionsListResponse {
  sessions: SessionSnapshot[];
}

export interface SessionOpened {
  session_id: string;
  viewer: string;
  state: SessionState;
  autonomy: Autonomy;
  simulate: boolean;
  created: boolean;
  provider?: string;
  model?: string;
}

/** sessions.post 에 보내는 것 — 전부 열 때 고정이다(I10). 이미 있는 id 면 무시된다. */
export interface OpenSessionInput {
  session_id?: string;
  autonomy?: Autonomy;
  simulate?: boolean;
  topic?: string;
  provider?: string;
  mcp_servers?: string[];
  max_steps?: number;
  max_seconds?: number;
  token_budget?: number;
}

// ── 기록(entry) ─────────────────────────────────────────────────────────

/** 모든 entry 에 있는 칸. `seq` 는 1부터 연속이고 정본이다. */
export interface EntryBase {
  seq: number;
  author: string;
  author_label: string;
  time_ms: number;
  /** 이 층이 모르는 칸 — 버리지 않고 그대로 보인다(요구 §5.2). */
  extra?: Record<string, unknown>;
}

export interface UserEntry extends EntryBase {
  kind: 'user';
  text?: string;
}
export interface AssistantEntry extends EntryBase {
  kind: 'assistant';
  text?: string;
}
/** 모델 한 번 부름. `note` 는 영어 문자열이다 — 파싱하지 않는다. `provider`·`model` 은 M-7. */
export interface ModelEntry extends EntryBase {
  kind: 'model';
  sent_bytes?: number;
  note?: string;
  provider?: string;
  model?: string;
}
/** operation 호출. `status` ∈ ok·refused·error. `refused` 는 오류가 아니다. `reason`·`judgement` 는 M-4. */
export interface CallEntry extends EntryBase {
  kind: 'call';
  subject?: string;
  operation_id?: string;
  decision?: string;
  status?: string;
  error_code?: string;
  trace_id?: string;
  note?: string;
  reason?: string;
  judgement?: string;
}
/** 시뮬레이션 호출 예정 — 실행되지 않았다(I13). */
export interface PlannedEntry extends EntryBase {
  kind: 'planned';
  subject?: string;
  operation_id?: string;
  decision?: string;
  status?: string;
  error_code?: string;
  trace_id?: string;
  note?: string;
  reason?: string;
  judgement?: string;
}
/** 외부 MCP 도구 호출 — Gateway 감사에 없다(I12). */
export interface ExternalEntry extends EntryBase {
  kind: 'external';
  server?: string;
  result_bytes?: number;
  subject?: string;
  decision?: string;
  status?: string;
  error_code?: string;
  note?: string;
}
export interface ApprovalEntry extends EntryBase {
  kind: 'approval';
  request_id?: string;
  operation_id?: string;
  subject?: string;
  decision?: string;
  note?: string;
  /** CLI 안내 줄이 섞여 있다 — 그대로 쓰지 않는다. */
  text?: string;
}
export interface ApprovedEntry extends EntryBase {
  kind: 'approved';
  request_id?: string;
  operation_id?: string;
  subject?: string;
}
/** 거부. 30분 무응답이면 `note` 가 `no answer within …` 이다. */
export interface DeniedEntry extends EntryBase {
  kind: 'denied';
  request_id?: string;
  operation_id?: string;
  subject?: string;
  note?: string;
}
/** 차례 끝. 성공을 뜻하지 않는다. `note` 는 영어(`N turn(s) · X in / Y out tokens`) — 파싱하지 않는다. */
export interface DoneEntry extends EntryBase {
  kind: 'done';
  note?: string;
}
export interface ErrorEntry extends EntryBase {
  kind: 'error';
  text?: string;
  error_code?: string;
}
export interface CancelledEntry extends EntryBase {
  kind: 'cancelled';
}
/** 이 층이 모르는 종류 — 가운데 알림으로 그대로 보인다. 버리지 않는다. */
export interface UnknownEntry extends EntryBase {
  kind: 'unknown';
  /** 서버가 보낸 원래 `kind`. */
  raw_kind: string;
  text?: string;
  /** 서버가 보낸 줄 전체. */
  raw: Record<string, unknown>;
}

export type KnownEntry =
  | UserEntry
  | AssistantEntry
  | ModelEntry
  | CallEntry
  | PlannedEntry
  | ExternalEntry
  | ApprovalEntry
  | ApprovedEntry
  | DeniedEntry
  | DoneEntry
  | ErrorEntry
  | CancelledEntry;

export type Entry = KnownEntry | UnknownEntry;

export const KNOWN_ENTRY_KINDS = [
  'user',
  'assistant',
  'model',
  'call',
  'planned',
  'external',
  'approval',
  'approved',
  'denied',
  'done',
  'error',
  'cancelled',
] as const;

const KNOWN_KIND_SET: ReadonlySet<string> = new Set(KNOWN_ENTRY_KINDS);

const STRING_FIELDS = [
  'text',
  'note',
  'subject',
  'operation_id',
  'decision',
  'status',
  'error_code',
  'request_id',
  'trace_id',
  'reason',
  'judgement',
  'server',
  'provider',
  'model',
] as const;
const NUMBER_FIELDS = ['sent_bytes', 'result_bytes'] as const;
const BASE_KEYS: ReadonlySet<string> = new Set(['seq', 'kind', 'author', 'author_label', 'time_ms']);
const KNOWN_FIELD_KEYS: ReadonlySet<string> = new Set<string>([...STRING_FIELDS, ...NUMBER_FIELDS]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 서버가 준 줄 하나를 entry 로 읽는다. `seq` 가 1 이상의 정수가 아니면 null — 번호 없는 줄은 이음새에 넣을 수 없다.
 * 알 수 없는 `kind` 는 `unknown` 줄로 감싸 원본을 보존한다. 알려진 `kind` 의 모르는 칸은 `extra` 에 둔다.
 */
export function parseEntry(raw: unknown): Entry | null {
  if (!isRecord(raw)) return null;
  const seq = raw['seq'];
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  const rawKind = typeof raw['kind'] === 'string' ? raw['kind'] : '';
  const base = {
    seq,
    author: typeof raw['author'] === 'string' ? raw['author'] : '',
    author_label: typeof raw['author_label'] === 'string' ? raw['author_label'] : typeof raw['author'] === 'string' ? raw['author'] : '',
    time_ms: typeof raw['time_ms'] === 'number' ? raw['time_ms'] : 0,
  };
  if (!KNOWN_KIND_SET.has(rawKind)) {
    const unknown: UnknownEntry = { ...base, kind: 'unknown', raw_kind: rawKind, raw: { ...raw } };
    if (typeof raw['text'] === 'string') unknown.text = raw['text'];
    return unknown;
  }
  const out: Record<string, unknown> = { ...base, kind: rawKind };
  for (const key of STRING_FIELDS) {
    const value = raw[key];
    if (typeof value === 'string') out[key] = value;
  }
  for (const key of NUMBER_FIELDS) {
    const value = raw[key];
    if (typeof value === 'number') out[key] = value;
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BASE_KEYS.has(key)) continue;
    // 알려진 이름이어도 모양이 다르면(문자열이어야 할 곳에 숫자) 버리지 않고 extra 로 둔다.
    if (KNOWN_FIELD_KEYS.has(key) && key in out) continue;
    extra[key] = value;
  }
  if (Object.keys(extra).length > 0) out['extra'] = extra;
  return out as unknown as KnownEntry;
}

// ── 그 밖의 응답 ────────────────────────────────────────────────────────

export interface MessagesListResponse {
  session_id: string;
  entries: unknown[];
}
export interface MessagePosted {
  entry: unknown;
}
export interface ApprovalAnswered {
  request_id: string;
  session_id: string;
  operation_id: string;
  decision: 'approved' | 'denied';
}
export interface SessionCancelled {
  session_id: string;
  state: SessionState;
}
/** status.get — 권한 없이도 된다(`agent.use` 불필요). 코드는 `degraded` 를 내지 않는다(요구 §14.3 ⑧). */
export interface ModuleStatus {
  status: 'ok' | 'degraded';
  version: string;
  sessions?: number;
  models_registered?: number;
  delegate_door?: boolean;
}
/** credentials.get — 값은 없다. `registered:false` 면 나머지 칸이 없다. `pre_approved` 는 비면 키가 없다. */
export interface CredentialFacts {
  registered: boolean;
  principal?: string;
  delegate?: string;
  permissions?: string[];
  reach?: string;
  expires_at?: string;
  expired?: boolean;
  unattended?: boolean;
  pre_approved?: string[];
}
export interface ProviderFacts {
  provider: string;
  model: string;
  base_url?: string;
  registered: boolean;
  default: boolean;
}
export interface ModelsListResponse {
  default?: string;
  providers: ProviderFacts[];
}
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  read_only?: boolean;
}
export interface McpServerFacts {
  name?: string;
  command?: string;
  args?: string[];
  /** 환경 변수의 **이름**뿐이다. 값은 어떤 응답에도 없다(I1). */
  env?: string[];
  tools?: McpTool[];
  registered_ms?: number;
  dropped?: string[];
}
export interface McpListResponse {
  servers: McpServerFacts[];
}
export interface RemovedResponse {
  removed: boolean;
  provider?: string;
  name?: string;
}

// ── 오류 ────────────────────────────────────────────────────────────────

/** 계약의 오류 15개(모듈 HTTP). */
export const CONTRACT_ERROR_CODES = [
  'AGENT_UNAVAILABLE',
  'APPROVAL_NOT_FOUND',
  'CREDENTIAL_MISSING',
  'CREDENTIAL_NOT_UNATTENDED',
  'CREDENTIAL_REJECTED',
  'INVALID_REQUEST',
  'MCP_SERVER_FAILED',
  'MCP_SERVER_UNKNOWN',
  'MCP_UNATTENDED_CONFLICT',
  'MODEL_NOT_CONFIGURED',
  'MODEL_UNAVAILABLE',
  'SESSION_BUSY',
  'SESSION_FINISHED',
  'SESSION_NOT_FOUND',
  'SESSION_NOT_OWNED',
] as const;
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

/** Gateway·브리지가 내는 오류 8개(요구 §6.4). `MODULE_PERMISSION_DENIED` 를 포함한다. */
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

/** 기록의 `error` 줄이 싣는 코드. */
export const RECORD_ERROR_CODES = ['STEP_LIMIT', 'TIME_LIMIT', 'TOKEN_BUDGET', 'MODEL_REFUSED', 'MODEL_TRUNCATED', 'MODEL_UNAVAILABLE', 'MCP_SERVER_UNKNOWN'] as const;
export type RecordErrorCode = (typeof RECORD_ERROR_CODES)[number];

/** `call`·`external` 줄의 `error_code`(이 줄에는 오류 본문이 없다). `HTTP_<n>` 과 Gateway 코드 그대로도 온다. */
export const CALL_ERROR_CODES = [
  'TERRA_APPROVAL_REQUIRED',
  'TERRA_APPROVAL_DENIED',
  'TERRA_STREAM_UNSUPPORTED',
  'TERRA_RETRY_REFUSED',
  'TERRA_REACH_EXCEEDED',
  'TERRA_EXTERNAL_FAILED',
  'GATEWAY_UNREACHABLE',
] as const;
export type CallErrorCode = (typeof CALL_ERROR_CODES)[number];
