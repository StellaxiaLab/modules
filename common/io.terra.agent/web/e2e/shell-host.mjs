// 가짜 셸 호스트 — 실제 셸(WebAppDock.tsx)처럼 앱을 sandbox iframe 에 올리고 브리지 프로토콜을 구현한다.
//
//   앱 ──terra.webapp.hello──▶ 셸        앱 ◀──terra.webapp.ready {permissions}── 셸
//   앱 ──terra.webapp.request {id,method,path,body}──▶ 셸 ──fetch(Authorization, X-Terra-Scope-Permissions)──▶ 가짜 Gateway
//   앱 ◀──terra.webapp.response {id,ok,status,data|error}── 셸
//
// 이 페이지는 앱과 **다른 origin** 에서 서빙된다(앱 origin = Gateway origin). 메시지는 정확한 Gateway origin +
// 그 iframe 의 contentWindow 에서 온 것만 받는다. 규칙 본체는 shell-bridge.mjs(웹앱 브리지 소스의 옮김).
//
// 주소 질의(?…):
//   app=<경로>              앱 진입점. 기본 /api/v1/gui/apps/io.terra.agent/files/ui/index.html
//   principal=<이름>        로그인한 사용자(Authorization: Bearer fake.<이름>). 기본 alice
//   permissions=a,b         앱 매니페스트가 선언한 권한. 기본 agent.use. `permissions=` 로 비우면 BRIDGE_NO_PERMISSIONS
//   login=0                 토큰 없이 부른다 — strict_gateway 일 때 401 UNAUTHORIZED
//   hello=ignore            hello 에 답하지 않는다(BRIDGE_HANDSHAKE_TIMEOUT 시험)
//   hello_delay_ms=<ms>     ready 를 늦춘다
//   response_delay_ms=<ms>  모든 response 를 늦춘다
//   drop_responses=<n>      처음 n 개 요청은 Gateway 로 보내되 앱에 응답하지 않는다(응답 유실)
//
// 시험은 window.__shell.log 로 오간 메시지를 본다.

import {
  BRIDGE_HELLO,
  BRIDGE_READY,
  BRIDGE_REQUEST,
  BRIDGE_RESPONSE,
  WEB_APP_SANDBOX,
  handleBridgeRequest,
  isTrustedAppMessage,
} from './shell-bridge.mjs';

const query = new URLSearchParams(location.search);
const config = await (await fetch('./shell-config.json')).json();
const gatewayOrigin = config.gatewayOrigin;
const principal = query.get('principal') ?? 'alice';
const permissions = query.has('permissions') ? query.get('permissions').split(',').map((p) => p.trim()).filter(Boolean) : ['agent.use'];
const appPath = query.get('app') ?? config.defaultAppPath;
const token = query.get('login') === '0' ? undefined : `fake.${principal}`;
const helloMode = query.get('hello');
const helloDelayMs = Number(query.get('hello_delay_ms') ?? 0);
const responseDelayMs = Number(query.get('response_delay_ms') ?? 0);
let dropResponses = Number(query.get('drop_responses') ?? 0);

const frame = document.getElementById('app-frame');
const log = [];
let requestCount = 0;
window.__shell = { config: { gatewayOrigin, principal, permissions, appPath }, log, frame };

document.getElementById('who').textContent = principal;
document.getElementById('perms').textContent = permissions.length ? permissions.join(' ') : '(없음)';

function record(entry) {
  log.push({ at: Date.now(), ...entry });
}

function reply(message) {
  frame.contentWindow?.postMessage(message, gatewayOrigin);
  record({ dir: 'out', type: message.type, id: message.id, ok: message.ok, status: message.status, code: message.error?.code });
}

window.addEventListener('message', (event) => {
  if (!isTrustedAppMessage(event, gatewayOrigin, frame.contentWindow)) {
    // 다른 창·다른 origin 의 메시지는 조용히 무시된다 — 기록만 남긴다.
    record({ dir: 'rejected', origin: event.origin, type: event.data?.type });
    return;
  }
  const message = event.data ?? {};
  if (message.type === BRIDGE_HELLO) {
    record({ dir: 'in', type: BRIDGE_HELLO });
    if (helloMode === 'ignore') return;
    setTimeout(() => {
      reply({ type: BRIDGE_READY, appId: config.appId, permissions });
      document.getElementById('bridge').textContent = '연결됨';
    }, helloDelayMs);
    return;
  }
  if (message.type === BRIDGE_REQUEST) {
    requestCount += 1;
    document.getElementById('count').textContent = String(requestCount);
    record({ dir: 'in', type: BRIDGE_REQUEST, id: message.id, method: message.method, path: message.path });
    const drop = dropResponses > 0;
    if (drop) dropResponses -= 1;
    handleBridgeRequest(message, { gatewayUrl: gatewayOrigin, app: { id: config.appId, permissions }, getToken: () => token }).then((response) => {
      if (drop) {
        record({ dir: 'dropped', type: BRIDGE_RESPONSE, id: response.id, status: response.status });
        return;
      }
      if (responseDelayMs > 0) setTimeout(() => reply(response), responseDelayMs);
      else reply(response);
    });
    return;
  }
  record({ dir: 'in', type: message.type ?? '(type 없음)', ignored: true });
});

frame.setAttribute('sandbox', WEB_APP_SANDBOX);
frame.src = gatewayOrigin + appPath;
window.__shell.ready = true;
