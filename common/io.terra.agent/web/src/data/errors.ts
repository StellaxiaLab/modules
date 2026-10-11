// 오류 코드 사전 (요구 §6.4). 서버 문구는 영어이고 CLI 안내가 섞여 있으므로 화면은 `code` 로 자기 문구를 고르고 원문은 접는다.
// 덮는 것: 모듈 HTTP 오류 15(계약) · Gateway·브리지 오류 8(MODULE_PERMISSION_DENIED 포함) · 기록 `error` 줄의 코드 ·
// `call`·`external` 줄의 error_code · 이 층이 만드는 클라이언트 쪽 코드 셋.
// 완전성은 tests/errors.test.ts 가 계약 파일(contracts/api/terra-api.json)과 대조한다 — 계약 오류가 늘면 거기서 깨진다.

import type { CallFailure } from '../api/client';

export type ErrorSource = 'contract' | 'gateway' | 'record' | 'call' | 'client';

/** 화면이 할 일. 문구가 아니라 행동의 종류다 — 문구는 message 에 있다. */
export type ErrorAction =
  | 'fix-form' // 폼 검증 문구. 원문은 접는다
  | 'read-only' // 읽기 전용 표시
  | 'disable-unattended' // 무인 옵션 비활성 + 발급 안내
  | 'reissue-credential' // 다시 발급
  | 'onboard-credential' // 온보딩(처음 맡기기)
  | 'renew-credential' // 갱신(다시 맡기기)
  | 'refresh-list' // 목록 새로 고침
  | 'refresh-session' // 크게 띄우지 않고 세션을 새로 읽는다
  | 'refresh-servers' // 서버 목록 새로 고침
  | 'lock-input' // 입력 비활성, 자동 재전송 금지
  | 'new-session' // 읽기 전용 + 새 세션
  | 'open-model-settings' // 모델 등록 화면으로
  | 'block-combination' // 무인 + 외부 MCP 조합 차단
  | 'show-raw' // 원문 표시
  | 'banner-backoff' // 배너 + 백오프
  | 'module-down' // 모듈이 꺼져 있다 — 코어 GUI 의 모듈 화면으로 안내
  | 'request-permission' // agent.use 권한 요청 안내
  | 'retry-later' // 잠시 뒤 다시
  | 'session-ended' // 로그인 세션 끝
  | 'reduce-request' // 요청이 너무 크다
  | 'verify-outcome' // 결과를 모른다 — messages.list 로 확인(I17)
  | 'inform'; // 기록 줄의 코드: 알려 주기만

export type Severity = 'info' | 'warn' | 'error';

export interface ErrorInfo {
  code: string;
  known: boolean;
  source: ErrorSource;
  http?: number;
  /** 한국어 문구. */
  message: string;
  action: ErrorAction;
  severity: Severity;
  /** 크게 띄우지 않는다. */
  quiet?: boolean;
  /** 서버 원문을 접어서 함께 둔다. */
  showRaw: boolean;
}

function info(code: string, source: ErrorSource, message: string, action: ErrorAction, extra: { http?: number; severity?: Severity; quiet?: boolean; showRaw?: boolean } = {}): ErrorInfo {
  const out: ErrorInfo = { code, known: true, source, message, action, severity: extra.severity ?? 'error', showRaw: extra.showRaw ?? true };
  if (extra.http !== undefined) out.http = extra.http;
  if (extra.quiet) out.quiet = true;
  return out;
}

const entries: ErrorInfo[] = [
  // ── 모듈 HTTP 오류 15 (계약) ───────────────────────────────────────────
  info('INVALID_REQUEST', 'contract', '요청 형식이 맞지 않습니다. 입력을 확인해 주세요. (Gateway 를 거치지 않은 호출이면 개발 환경입니다.)', 'fix-form', { http: 400 }),
  info('SESSION_NOT_OWNED', 'contract', '다른 사람이 연 세션입니다. 읽기만 할 수 있습니다.', 'read-only', { http: 403 }),
  info('CREDENTIAL_NOT_UNATTENDED', 'contract', '무인 세션은 무인으로 발급된 자격(사전 승인 목록 포함)이 있어야 열 수 있습니다.', 'disable-unattended', { http: 403 }),
  info('CREDENTIAL_REJECTED', 'contract', 'Gateway 가 이 자격을 받아들이지 않았습니다. 다시 발급해 맡겨 주세요.', 'reissue-credential', { http: 403 }),
  info('SESSION_NOT_FOUND', 'contract', '세션을 찾을 수 없습니다. 목록을 새로 고칩니다.', 'refresh-list', { http: 404 }),
  info('APPROVAL_NOT_FOUND', 'contract', '이미 답했거나 만료된 승인입니다.', 'refresh-session', { http: 404, severity: 'info', quiet: true }),
  info('MCP_SERVER_UNKNOWN', 'contract', '등록되지 않은 외부 서버입니다. 서버 목록을 새로 고칩니다.', 'refresh-servers', { http: 404 }),
  info('SESSION_BUSY', 'contract', '모델이 답하는 중입니다. 끝난 뒤에 보내 주세요.', 'lock-input', { http: 409, severity: 'warn' }),
  info('SESSION_FINISHED', 'contract', '끝난 세션입니다. 새 세션을 여세요.', 'new-session', { http: 409, severity: 'warn' }),
  info('CREDENTIAL_MISSING', 'contract', '위임 자격이 맡겨져 있지 않습니다. 자격을 맡겨 주세요.', 'onboard-credential', { http: 409 }),
  info('MODEL_NOT_CONFIGURED', 'contract', '등록된 모델이 없습니다. 모델을 먼저 등록해 주세요.', 'open-model-settings', { http: 409 }),
  info('MCP_UNATTENDED_CONFLICT', 'contract', '무인 세션은 외부 MCP 서버와 함께 열 수 없습니다.', 'block-combination', { http: 409 }),
  info('MCP_SERVER_FAILED', 'contract', '외부 서버가 실행되지 않았거나 응답하지 않았습니다. 원문을 확인해 주세요.', 'show-raw', { http: 502 }),
  info('MODEL_UNAVAILABLE', 'contract', '모델 호출이 실패했습니다. 이 세션은 실패 상태가 되어 이어 갈 수 없습니다. 새 세션을 여세요.', 'new-session', { http: 502 }),
  info('AGENT_UNAVAILABLE', 'contract', '에이전트 모듈이 지금 처리할 수 없습니다. 잠시 뒤 다시 시도합니다.', 'banner-backoff', { http: 503 }),

  // ── Gateway·브리지 오류 8 ──────────────────────────────────────────────
  info('MODULE_UNAVAILABLE', 'gateway', '에이전트 모듈이 꺼져 있습니다. 코어 GUI 의 모듈 화면에서 시작해 주세요.', 'module-down', { http: 503 }),
  info('MODULE_PERMISSION_DENIED', 'gateway', '이 계정에 agent.use 권한이 없거나 도달 범위 밖입니다. (권한 부족과 범위 밖은 같은 문구로 옵니다 — 관리자에게 agent.use 부여를 요청해 주세요.)', 'request-permission', { http: 403 }),
  info('MODULE_INVOCATION_TIMEOUT', 'gateway', '모듈이 제때 답하지 않았습니다. 요청이 처리됐는지 확인한 뒤 다시 시도해 주세요.', 'verify-outcome', { http: 504, severity: 'warn' }),
  info('UNAUTHORIZED', 'gateway', '로그인 세션이 끝났습니다. 다시 로그인해 주세요.', 'session-ended', { http: 401 }),
  info('QUOTA_EXCEEDED', 'gateway', '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.', 'retry-later', { http: 429, severity: 'warn' }),
  info('REQUEST_TOO_LARGE', 'gateway', '요청이 너무 큽니다. 내용을 줄여 주세요.', 'reduce-request', { http: 413 }),
  info('SCOPE_TOKEN_DENIED', 'gateway', '앱 토큰 발급이 거절되었습니다.', 'request-permission', { http: 403 }),
  info('BRIDGE_NO_PERMISSIONS', 'gateway', '이 앱에 선언된 권한이 없어 셸이 요청을 막았습니다.', 'request-permission', { http: 403 }),

  // ── 기록의 `error` 줄 ──────────────────────────────────────────────────
  info('STEP_LIMIT', 'record', '한 차례의 모델 호출 한도에 닿아 멈췄습니다. 실패가 아닙니다 — 이어서 말할 수 있습니다.', 'inform', { severity: 'warn' }),
  info('TIME_LIMIT', 'record', '한 차례의 시간 한도에 닿아 멈췄습니다. 승인을 기다린 시간도 포함됩니다. 실패가 아닙니다.', 'inform', { severity: 'warn' }),
  info('TOKEN_BUDGET', 'record', '세션의 토큰 예산을 다 썼습니다. 이어서 말하려면 새 세션이 필요할 수 있습니다.', 'inform', { severity: 'warn' }),
  info('MODEL_REFUSED', 'record', '모델이 계속하기를 거절했습니다. 다른 모델로 넘기지 않습니다.', 'inform', { severity: 'warn' }),
  info('MODEL_TRUNCATED', 'record', '모델 응답이 토큰 한도에서 잘렸습니다.', 'inform', { severity: 'warn' }),

  // ── `call`·`external` 줄의 error_code (이 줄에는 오류 본문이 없다) ─────
  info('TERRA_APPROVAL_REQUIRED', 'call', '사람의 승인이 필요해 실행되지 않았습니다. (plan 의 제안이거나 거절·무응답·시간 초과입니다.)', 'inform', { severity: 'info' }),
  info('TERRA_APPROVAL_DENIED', 'call', '사람이 거부해 실행되지 않았습니다.', 'inform', { severity: 'info' }),
  info('TERRA_STREAM_UNSUPPORTED', 'call', '스트림 operation 이라 에이전트가 부를 수 없습니다.', 'inform', { severity: 'info' }),
  info('TERRA_RETRY_REFUSED', 'call', '재시도가 안전하지 않은 호출이라 다시 보내지 않았습니다. 사람이 실행 여부를 확인해 주세요.', 'inform', { severity: 'warn' }),
  info('TERRA_REACH_EXCEEDED', 'call', '자격의 도달 범위 밖이라 부르지 않았습니다.', 'inform', { severity: 'warn' }),
  info('TERRA_EXTERNAL_FAILED', 'call', '외부 도구 호출이 실패했습니다.', 'inform', { severity: 'warn' }),
  info('GATEWAY_UNREACHABLE', 'call', 'Gateway 에 닿지 못했습니다. 턴 도중 자격을 지우거나 자격이 만료돼도 이렇게 보입니다.', 'inform', { severity: 'warn' }),

  // ── 이 층이 만드는 코드 ─────────────────────────────────────────────────
  info('OUTCOME_UNKNOWN', 'client', '요청이 처리됐는지 알 수 없습니다. 다시 보내기 전에 기록에서 확인해 주세요. 자동으로 다시 보내지 않습니다.', 'verify-outcome', { severity: 'warn' }),
  info('NETWORK_ERROR', 'client', '연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.', 'retry-later', { severity: 'warn' }),
  info('INVALID_RESPONSE', 'client', '모듈의 응답을 읽을 수 없습니다.', 'show-raw'),
];

export const ERROR_DICTIONARY: Readonly<Record<string, ErrorInfo>> = Object.fromEntries(entries.map((e) => [e.code, e]));

const GENERIC: Omit<ErrorInfo, 'code'> = {
  known: false,
  source: 'client',
  message: '알 수 없는 오류입니다. 원문을 확인해 주세요.',
  action: 'show-raw',
  severity: 'error',
  showRaw: true,
};

/** 코드로 사전을 찾는다. `HTTP_<n>` 은 상태로 풀고, 모르는 코드는 일반 문구 + 원문 접기. */
export function describeCode(code: string | undefined): ErrorInfo {
  if (code === undefined || code === '') return { ...GENERIC, code: 'UNKNOWN' };
  const known = ERROR_DICTIONARY[code];
  if (known) return known;
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) {
    const status = Number(http[1]);
    return { code, known: true, source: 'call', http: status, message: `호출이 HTTP ${status} 로 끝났습니다.`, action: 'inform', severity: 'warn', showRaw: true };
  }
  return { ...GENERIC, code };
}

export interface FailureContext {
  /** credentials.get 의 expired — CREDENTIAL_MISSING 의 미등록과 만료는 같은 코드라 이것으로 가른다. */
  credentialExpired?: boolean;
}

export type FailureInfo = ErrorInfo & { raw: string; status: number };

const STATUS_CODES: Readonly<Record<number, string>> = { 401: 'UNAUTHORIZED', 413: 'REQUEST_TOO_LARGE', 429: 'QUOTA_EXCEEDED', 504: 'MODULE_INVOCATION_TIMEOUT' };

/** 전송이 준 실패를 화면 행동으로 푼다. 원문은 `raw` 에 접어 둔다. */
export function describeFailure(failure: Pick<CallFailure, 'status' | 'code' | 'message' | 'outcomeUnknown'>, context: FailureContext = {}): FailureInfo {
  let base: ErrorInfo;
  if (failure.code !== undefined && failure.code !== '') {
    base = describeCode(failure.code);
    if (failure.code === 'CREDENTIAL_MISSING' && context.credentialExpired === true) {
      base = { ...base, action: 'renew-credential', message: '맡겨 둔 위임 자격이 만료되었습니다. 다시 맡겨 주세요.' };
    }
  } else if (failure.outcomeUnknown) {
    base = describeCode('OUTCOME_UNKNOWN');
  } else if (STATUS_CODES[failure.status] !== undefined) {
    base = describeCode(STATUS_CODES[failure.status]);
  } else if (failure.status === 0) {
    base = describeCode('NETWORK_ERROR');
  } else {
    base = { ...GENERIC, code: `HTTP_${failure.status}`, message: `요청이 HTTP ${failure.status} 로 실패했습니다. 원문을 확인해 주세요.` };
  }
  return { ...base, raw: failure.message, status: failure.status };
}
