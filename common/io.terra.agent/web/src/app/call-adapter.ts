// AgentTransport → CallFn. 화면·데이터층은 CallFn(포트)만 안다 — 어느 전송인지 모른다(요구 §2.3).
// 전송의 TransportError 를 데이터층이 쓰는 CallFailure 로 옮긴다:
//   - 모듈·Gateway 코드는 그대로 `code` 가 된다(오류 사전이 푼다).
//   - 사전에 없는 서버 코드(UNKNOWN)는 원문 코드를 `code` 로 둔다 — 사전이 "알 수 없는 오류 + 원문"으로 접는다.
//   - 전송 계층이 스스로 만든 코드(시간 초과·핸드셰이크 …)는 `code` 를 비운다 — 상태·outcomeUnknown 으로 푼다(describeFailure).

import type { CallFn, CallFailure, CallRequest, CallResult } from '../api/client';
import type { AgentTransport, HttpMethod } from '../transport';

const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function callFromTransport(transport: AgentTransport): CallFn {
  return async <T>(req: CallRequest): Promise<CallResult<T>> => {
    if (!METHODS.has(req.method)) return { ok: false, status: 0, code: 'INVALID_REQUEST', message: `지원하지 않는 메서드: ${req.method}` };
    const result = await transport.request<T>({
      method: req.method as HttpMethod,
      path: req.path,
      ...(req.body !== undefined ? { body: req.body } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (result.ok) return { ok: true, status: result.status, data: result.data };
    const { error } = result;
    const failure: CallFailure = { ok: false, status: result.status, message: error.message };
    if (error.source === 'module' || error.source === 'gateway') failure.code = error.code;
    else if (error.source === 'unknown' && error.rawCode) failure.code = error.rawCode;
    if (error.outcomeUnknown) failure.outcomeUnknown = true;
    return failure;
  };
}
