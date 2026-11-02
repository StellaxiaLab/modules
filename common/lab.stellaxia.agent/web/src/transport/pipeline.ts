// 세 전송이 함께 쓰는 한 벌: 요청 검증 → 시간 제한·중단 → (제한된) 재시도 → 오류 정규화.
// 전송마다 다른 것은 `send`(실제로 보내는 일) 하나뿐이다.

import { failure, normalizeResponse, transportFailure } from './errors';
import { pathOnly, retryNeverOperation } from './retry-guard';
import {
  HTTP_METHODS,
  realTimers,
  type HttpMethod,
  type Timers,
  type TransportRequest,
  type TransportResult,
} from './types';

/** 요청 하나의 기본 시간 제한. 계약의 timeoutMs 는 호출마다 2~35초라 하나로 20초를 둔다(`timeoutMs` 로 덮는다). */
export const DEFAULT_TIMEOUT_MS = 20_000;

export const BRIDGE_PATH_PREFIXES = ['/api/modules/', '/api/nodes/'] as const;

export interface RetryPolicy {
  /** 처음 시도 뒤 더 해 볼 횟수. 기본 0 = 재시도 없음. */
  extraAttempts: number;
  /** 재시도를 허락하는 메서드. 기본 GET 만. 설정해도 재시도 never 넷은 넘지 못한다(I17). */
  methods: readonly HttpMethod[];
  delayMs: number;
}

export const NO_RETRY: RetryPolicy = { extraAttempts: 0, methods: ['GET'], delayMs: 500 };

export interface PipelineOptions {
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  timers?: Timers;
}

/** 실제로 한 번 보낸다. 브리지의 `{ok,status,data,error}` 모양(또는 같은 모양)을 돌려준다. 던져도 된다. */
export type Send = (req: TransportRequest, signal: AbortSignal) => Promise<unknown>;

/** 셸 브리지가 거절할 요청을 앞서 거절한다 — 토큰 전송도 같은 규칙을 지켜 동작이 갈리지 않게 한다. */
export function validateRequest(req: TransportRequest): TransportResult<never> | undefined {
  const method = req.method as string;
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    return transportFailure(req.method, 'BRIDGE_METHOD_NOT_ALLOWED', `method ${String(method)} is not bridged`, { status: 405 });
  }
  const path = req.path as unknown;
  const bad = (why: string) =>
    transportFailure(req.method, 'BRIDGE_PATH_NOT_ALLOWED', why, { status: 403 });
  if (typeof path !== 'string' || !BRIDGE_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return bad('only the module namespaces (/api/modules/, /api/nodes/) are bridged');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \\]/.test(path)) return bad('path has whitespace, control characters or backslash');
  const bare = pathOnly(path);
  if (bare.split('/').some(segment => segment === '..' || segment === '.') || bare.includes('//')) {
    return bad('path must not contain dot segments or empty segments');
  }
  return undefined;
}

const RETRIABLE_CODES: ReadonlySet<string> = new Set(['NETWORK', 'BRIDGE_GATEWAY_UNREACHABLE', 'MODULE_UNAVAILABLE']);

function sleep(timers: Timers, ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    let handle: unknown;
    const onAbort = () => {
      timers.clearTimeout(handle);
      resolve(false);
    };
    handle = timers.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 한 번 보내고 결과를 정규화한다. */
async function attemptOnce(send: Send, req: TransportRequest, timeoutMs: number, timers: Timers): Promise<TransportResult> {
  const outer = req.signal;
  if (outer?.aborted) {
    return transportFailure(req.method, 'ABORTED', '요청이 보내기 전에 취소되었습니다', { outcomeUnknown: false });
  }
  const controller = new AbortController();
  let reason: 'timeout' | 'abort' | undefined;
  let timer: unknown;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<'stop'>(resolve => {
    timer = timers.setTimeout(() => {
      reason = 'timeout';
      controller.abort();
      resolve('stop');
    }, timeoutMs);
    onAbort = () => {
      reason = 'abort';
      controller.abort();
      resolve('stop');
    };
    outer?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const sent = Promise.resolve()
      .then(() => send(req, controller.signal))
      .then(
        raw => ({ raw }),
        (cause: unknown) => ({ cause }),
      );
    const won = await Promise.race([sent, stop]);
    if (won === 'stop') {
      return reason === 'timeout'
        ? transportFailure(req.method, 'REQUEST_TIMEOUT', `${Math.round(timeoutMs / 1000)}초 안에 응답이 없습니다`, {
            retryable: req.method === 'GET',
          })
        : transportFailure(req.method, 'ABORTED', '요청이 취소되었습니다');
    }
    if ('cause' in won) {
      const message = won.cause instanceof Error ? won.cause.message : String(won.cause);
      return transportFailure(req.method, 'NETWORK', message, { retryable: req.method === 'GET' });
    }
    return normalizeResponse(req.method, won.raw);
  } catch (cause: unknown) {
    // 정규화 중의 예외까지 값으로 — request 는 던지지 않는다.
    return failure(req.method, {
      source: 'unknown',
      code: 'UNKNOWN',
      status: 0,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    timers.clearTimeout(timer);
    if (onAbort) outer?.removeEventListener('abort', onAbort);
  }
}

/** 요청 한 건을 끝까지 처리한다. 던지지 않는다. */
export async function execute<T = unknown>(send: Send, req: TransportRequest, options: PipelineOptions = {}): Promise<TransportResult<T>> {
  const invalid = validateRequest(req);
  if (invalid) return invalid;

  const timers = options.timers ?? realTimers;
  const timeoutMs = req.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy: RetryPolicy = { ...NO_RETRY, ...options.retry };
  // I17: 설정이 무엇이든 재시도 never 넷은 한 번만 보낸다.
  const never = retryNeverOperation(req.method, req.path) !== undefined;
  const extra = never || !policy.methods.includes(req.method) ? 0 : Math.max(0, Math.floor(policy.extraAttempts));

  let result = await attemptOnce(send, req, timeoutMs, timers);
  for (let left = extra; left > 0 && !result.ok && RETRIABLE_CODES.has(result.error.code); left -= 1) {
    if (!(await sleep(timers, policy.delayMs, req.signal))) {
      return transportFailure(req.method, 'ABORTED', '재시도를 기다리는 동안 취소되었습니다');
    }
    result = await attemptOnce(send, req, timeoutMs, timers);
  }
  if (never && !result.ok && result.error.outcomeUnknown) {
    // 결과를 모르는 never 호출은 "다시 해 보라"고 권하지 않는다 — 먼저 확인해야 한다.
    result.error.retryable = false;
  }
  return result as TransportResult<T>;
}
