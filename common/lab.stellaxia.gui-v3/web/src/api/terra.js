// Terra operation 호출 — Gateway 의 주소 독립 입구 하나로.
//
//   이 노드      POST /api/v1/operations/{id}/invoke                 (Gateway 가 route → provider 를 푼다)
//   다른 노드    POST /api/v1/nodes/{node}/operations/{id}/invoke    (Master 중계 — 대상 Daemon 이 자기 계약의 scopes 로 다시 판정)
//   스트림       POST /api/v1/streams/tickets → WebSocket /api/v1/streams/{ticket} (30초 티켓, 브라우저가 헤더를 못 싣기 때문)
// 입력은 평평한 JSON — 경로 변수는 Gateway 가 채운다. 본문 상한 1 MiB(그래서 그림은 node-data.js 가 640 KiB 로 나눠 올린다).
//
// 잠금(원격 제어기): canRemote(id) 가 false 인 operation 은 다른 노드에서 부를 수 없다 — 버튼을 잠근다.
// 표(op-scope.json)는 tools/gen-op-scope.mjs 가 Terra Daemon 계약에서 뽑는다.

import SCOPE from './op-scope.json' with { type: 'json' };

export class TerraError extends Error {
  constructor(code, message, status, retryable, details) { super(message || code); this.name = 'TerraError'; this.code = code; this.status = status; this.retryable = !!retryable; this.details = details || null; if (details && details.via) this.via = details.via; }
}
// 상태 코드만 있고 코드가 없을 때 — 길이 끊긴 것(502 · 503 · 504)은 분할로 읽을 수 있게 이름을 준다
const STATUS_CODE = { 502: 'GATEWAY_UNREACHABLE', 503: 'UNAVAILABLE', 504: 'TIMEOUT' };

/** 그 operation 을 다른 노드에서(Master 중계로) 부를 수 있는가. 표에 없는 것(Gateway · 모듈 operation)은 막지 않는다 */
export function canRemote(id) {
  const o = SCOPE.operations[id];
  return !o || o.scopes.includes('cluster');
}

/** 그 operation 이 요구하는 권한 — 권한이 없을 때 버튼을 잠그고 이유를 보일 때 */
export const permissionsOf = (id) => (SCOPE.operations[id] && SCOPE.operations[id].permissions) || [];

/**
 * @param {{ fetch?: typeof fetch, token?: () => string|null, authorization?: () => string|null, refresh?: () => Promise<string|undefined> }} [o]
 *   refresh — A 모드: 앱 토큰으로 401 을 맞으면 셸에게 새 토큰을 받아 한 번 다시 보낸다
 *   token 은 frame 이 준 앱 토큰(상대 경로에만 Bearer — frame 규칙, A 모드) · authorization 은 그대로 실을 Authorization 값(B 모드: 'Handle <id>')
 */
export function createTerra(o = {}) {
  const f = o.fetch || globalThis.fetch.bind(globalThis);
  const headers = () => { const h = { 'content-type': 'application/json' }, a = o.authorization && o.authorization(), t = !a && o.token && o.token(); if (a) h.authorization = a; else if (t) h.authorization = 'Bearer ' + t; return h; };
  const send = async (path, init) => { try { return await f(path, init); } catch (e) { throw new TerraError('NETWORK', 'Gateway 에 닿지 못함 — ' + ((e && e.message) || e), 0, true); } };
  const unwrap = async (res) => {
    const text = await res.text(); let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { throw new TerraError(res.ok ? 'BAD_RESPONSE' : STATUS_CODE[res.status] || 'HTTP_' + res.status, text.slice(0, 200), res.status, res.status >= 502); }
    if (!res.ok || (body && body.status === 'error') || (body && body.error)) {
      const e = (body && (body.error || body)) || {};
      throw new TerraError(e.code || STATUS_CODE[res.status] || 'HTTP_' + res.status, e.message || res.statusText, res.status, e.retryable ?? res.status >= 502, e.details);
    }
    return body && 'data' in body ? body.data : body;   // Daemon · Gateway 공통 봉투 {status, data, meta}
  };
  return {
    /** @param {string} id operation id @param {object} [input] 평평한 입력 @param {{ node?: string }} [at] node 를 주면 그 노드에서 */
    async invoke(id, input = {}, at = {}) {
      if (at.node && !canRemote(id)) throw new TerraError('LOCAL_ONLY', id + ' 은 그 노드에서만 부를 수 있다', 0);
      const path = at.node ? `/api/v1/nodes/${encodeURIComponent(at.node)}/operations/${encodeURIComponent(id)}/invoke` : `/api/v1/operations/${encodeURIComponent(id)}/invoke`;
      let res = await send(path, { method: 'POST', headers: headers(), body: JSON.stringify(input) });
      if (res.status === 401 && o.refresh && o.token && o.token() && !(o.authorization && o.authorization())) { if (await o.refresh()) res = await send(path, { method: 'POST', headers: headers(), body: JSON.stringify(input) }); }
      return unwrap(res);
    },
    /** Gateway 자기 길(HTTP 바인딩) — me/documents 따위 @param {string} method @param {string} path @param {object} [body] */
    async http(method, path, body) { return unwrap(await send(path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) })); },
    /** 스트림을 연다 — onMessage(데이터) · onClose. 돌려준 함수로 닫는다 */
    async stream(id, input, onMessage, onClose) {
      const t = await unwrap(await send('/api/v1/streams/tickets', { method: 'POST', headers: headers(), body: JSON.stringify({ operationId: id, input }) }));
      const url = new URL('/api/v1/streams/' + encodeURIComponent(t.ticket), location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      ws.onmessage = (e) => { let v = e.data; try { v = JSON.parse(e.data); } catch {} onMessage(v); };
      ws.onclose = () => onClose && onClose();
      return () => ws.close();
    }
  };
}

/**
 * 명령 실행(terra.daemon.commands.execute)의 인자 — 이 operation 은 command 와 args 를 빈칸으로 이어 붙여 시스템 셸에 한 줄로 넘긴다
 * (계약 설명). 그래서 빈칸 · 셸 문자가 든 경로(패키지 경로 따위)는 여기서 셸에 맞게 감싼다.
 * @param {'posix'|'windows'} os
 */
export function shellArg(s, os) {
  s = String(s);
  if (os === 'windows') return /[\s"&|<>^%]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  return /^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
}

/** 파일에서 모듈 설치 — terra module install <파일> --grant-reviewed <요약> [--dev] [--force] [--start] (Daemon 설치 API 가 없어 명령 실행으로) */
export function moduleInstallCommand(path, o, os) {
  const a = ['module', 'install', shellArg(path, os), '--grant-reviewed', shellArg(o.digest, os)];
  if (o.dev) a.push('--dev'); if (o.force) a.push('--force'); if (o.start) a.push('--start');
  return { command: 'terra', args: a, timeout_sec: 600 };
}
