// 셸 쪽 브리지 규칙 — Terra 의 webAppBridge.ts(handleBridgeRequest)를 그대로 옮겼다. 호스트 페이지와 단위 시험이 함께 쓴다.
//
//   · 경로는 /api/modules/ · /api/nodes/ 만
//   · 메서드는 GET POST PUT PATCH DELETE
//   · 선언 권한이 비면 403 BRIDGE_NO_PERMISSIONS (앱이 API 를 요구하지 않았다는 선언이 의미를 갖게 한다)
//   · 선언 권한을 X-Terra-Scope-Permissions 로 실어 Gateway 가 (사용자 권한 ∩ 앱 선언)으로 좁히게 한다
//   · 응답은 {type:'terra.webapp.response', id, ok, status, data} 한 번 — 오류는 {ok:false,status,error:{code,message}}
//   · Gateway 에 닿지 못하면 502 BRIDGE_GATEWAY_UNREACHABLE
// 토큰은 앱에 넘어가지 않는다 — 여기서만 Authorization 으로 쓴다.

export const BRIDGE_HELLO = 'terra.webapp.hello';
export const BRIDGE_READY = 'terra.webapp.ready';
export const BRIDGE_REQUEST = 'terra.webapp.request';
export const BRIDGE_RESPONSE = 'terra.webapp.response';
export const BRIDGE_PATH_PREFIXES = ['/api/modules/', '/api/nodes/'];
export const BRIDGE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** 앱 iframe 의 sandbox — 디자인 §4.4 의 정확한 묶음(WebAppDock.tsx WEB_APP_SANDBOX). */
export const WEB_APP_SANDBOX = 'allow-scripts allow-forms allow-same-origin';

export function bridgeFailure(id, status, code, message) {
  return { type: BRIDGE_RESPONSE, id, ok: false, status, error: { code, message } };
}

/**
 * 한 번의 중개. 던지지 않는다 — 거절도 앱이 읽을 응답 메시지다.
 * @param {{id?:string,method?:string,path?:string,body?:unknown}} message
 * @param {{gatewayUrl:string, app:{id:string,permissions?:string[]}, getToken?:()=>string|undefined, fetchImpl?:typeof fetch}} options
 */
export async function handleBridgeRequest(message, options) {
  const id = typeof message.id === 'string' ? message.id : '';
  if (!id) return bridgeFailure('', 400, 'BRIDGE_INVALID_REQUEST', 'request id is required');
  const permissions = options.app.permissions ?? [];
  if (permissions.length === 0) {
    return bridgeFailure(id, 403, 'BRIDGE_NO_PERMISSIONS', 'this app declared no permissions, so the bridge carries nothing for it');
  }
  const method = String(message.method ?? '').toUpperCase();
  if (!BRIDGE_METHODS.has(method)) return bridgeFailure(id, 405, 'BRIDGE_METHOD_NOT_ALLOWED', `method ${message.method} is not bridged`);
  const path = String(message.path ?? '');
  if (!BRIDGE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return bridgeFailure(id, 403, 'BRIDGE_PATH_NOT_ALLOWED', 'only the module namespaces (/api/modules/, /api/nodes/) are bridged');
  }
  const headers = { Accept: 'application/json', 'X-Terra-Scope-Permissions': permissions.join(' ') };
  const token = options.getToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (message.body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(message.body);
  }
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(options.gatewayUrl.replace(/\/+$/, '') + path, init);
    let data;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    return { type: BRIDGE_RESPONSE, id, ok: response.ok, status: response.status, data };
  } catch (cause) {
    return bridgeFailure(id, 502, 'BRIDGE_GATEWAY_UNREACHABLE', cause instanceof Error ? cause.message : String(cause));
  }
}

/** 메시지를 받아들이는 두 겹: 정확한 Gateway origin 이고, 그 앱 iframe 의 contentWindow 에서 왔다. */
export function isTrustedAppMessage(event, gatewayOrigin, frameWindow) {
  if (!gatewayOrigin || !frameWindow) return false;
  return event.origin === gatewayOrigin && event.source === frameWindow;
}
