// 재시도 never 가드 (요구 I17, 계약 retry.mode = never).
// messages.post · approvals.post · runs.post · mcp.put 은 같은 요청을 두 번 보내면 두 번 일어난다
// (글이 두 번 가고, 승인이 두 번 눌리고, 실행이 두 번 돈다). 전송층의 어떤 재시도 설정도 이 넷을 넘지 못한다.
// 응답을 못 받았으면 재전송하지 않고 outcomeUnknown 으로 올려 상위가 messages.list 로 확인한다.

import type { HttpMethod } from './types';

const MODULE = String.raw`/api/(?:modules|nodes/[^/]+/modules)/io\.terra\.agent/v1`;

export const RETRY_NEVER_OPERATIONS: readonly { id: string; method: HttpMethod; pattern: RegExp }[] = [
  { id: 'io.terra.agent.messages.post', method: 'POST', pattern: new RegExp(`^${MODULE}/sessions/[^/]+/messages$`) },
  { id: 'io.terra.agent.approvals.post', method: 'POST', pattern: new RegExp(`^${MODULE}/approvals/[^/]+$`) },
  { id: 'io.terra.agent.runs.post', method: 'POST', pattern: new RegExp(`^${MODULE}/runs$`) },
  { id: 'io.terra.agent.mcp.put', method: 'PUT', pattern: new RegExp(`^${MODULE}/mcp/servers/[^/]+$`) },
];

/** 쿼리·해시와 끝 슬래시를 뗀 경로. */
export function pathOnly(path: string): string {
  const cut = path.search(/[?#]/);
  const bare = cut === -1 ? path : path.slice(0, cut);
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/** 이 호출이 재시도 never 넷 중 하나인가. 해당하면 그 operation id 를 돌려준다. */
export function retryNeverOperation(method: HttpMethod, path: string): string | undefined {
  const bare = pathOnly(path);
  return RETRY_NEVER_OPERATIONS.find(op => op.method === method && op.pattern.test(bare))?.id;
}

export function isRetryNever(method: HttpMethod, path: string): boolean {
  return retryNeverOperation(method, path) !== undefined;
}
