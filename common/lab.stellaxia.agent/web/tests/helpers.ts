// 시험 도우미 — 가짜 CallFn·entry 공장. 시험 파일이 아니다(include 는 *.test.ts).
import contractJson from '../../contracts/api/terra-api.json';
import type { CallFailure, CallFn, CallRequest, CallResult } from '../src/api/client';
import type { PendingApproval, SessionSnapshot } from '../src/api/types';

export interface ContractView {
  operations: Record<string, { bindings: Array<{ method?: string; path: string; type: string }> }>;
  errors: Record<string, { httpStatus: number }>;
}

/** 계약 파일(contracts/api/terra-api.json)을 그대로 읽는다 — 시험이 계약과 어긋남을 잡는다. */
export function loadContract(): ContractView {
  return contractJson as unknown as ContractView;
}

export function raw(seq: number, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { seq, kind, author: kind === 'user' ? 'alice' : 'terra', author_label: kind === 'user' ? 'alice' : 'terra', time_ms: 1_000_000 + seq * 1000, ...extra };
}

export function snap(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    session_id: 's-1',
    state: 'idle',
    autonomy: 'plan',
    simulate: false,
    owner: 'alice',
    steps: 0,
    max_steps: 24,
    created_ms: 1_000_000,
    updated_ms: 1_000_000,
    ...over,
  };
}

export function pend(id: string, op = 'io.terra.node.modules.restart', over: Partial<PendingApproval> = {}): PendingApproval {
  return { request_id: id, operation_id: op, created_ms: 1_000_000, ...over };
}

export interface RecordedCall extends CallRequest {}

/** 요청을 기록하고 handler 가 답하는 가짜 CallFn. */
export function fakeCall(handler: (req: CallRequest) => CallResult<unknown> | Promise<CallResult<unknown>>): { call: CallFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const call: CallFn = async <T>(req: CallRequest) => {
    calls.push(req);
    return (await handler(req)) as CallResult<T>;
  };
  return { call, calls };
}

export const okResult = <T>(data: T, status = 200): CallResult<T> => ({ ok: true, status, data });
export const failResult = (status: number, code: string | undefined, message = 'fail', outcomeUnknown?: boolean): CallFailure => {
  const out: CallFailure = { ok: false, status, message };
  if (code !== undefined) out.code = code;
  if (outcomeUnknown !== undefined) out.outcomeUnknown = outcomeUnknown;
  return out;
};
