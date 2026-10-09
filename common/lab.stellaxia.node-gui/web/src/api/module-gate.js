// 모듈이 없는 노드에서 그 모듈의 operation 을 부르지 않는다 (MD-38).
//
// io.devices.get 은 io.terra.io-inventory, files.list.get 은 io.terra.file 이 뒤에서 답한다. 그 모듈이 설치되지 않은 노드에서는
// Daemon 이 503 LOCAL_API_UNAVAILABLE 로 답하고, 브라우저 콘솔에 "Failed to load resource"가 남는다 — 오류가 아니라 "없다"인데도.
// 먼저 modules.get 으로 설치 여부를 보고, 없으면 부르지 않고 { kind: 'unavailable', reason: 'no-module' } 을 준다.
// modules.get 을 못 받으면 막지 않는다(그때는 그냥 부르고 서버가 판정한다).

const TTL_MS = 15000;

/** 이 노드의 modules.get 결과 — 15초 동안 한 번만 부른다(첫 화면과 설정 보드가 함께 쓴다) */
export function modulesResult(client) {
  const c = client.__modGate;
  if (c && Date.now() - c.at < TTL_MS) return c.p;
  const p = client.invoke('terra.daemon.modules.get', {});
  client.__modGate = { at: Date.now(), p };
  return p;
}

/** 설치된 모듈 id 의 집합 — 목록을 못 받았으면 null */
export async function installedModuleIds(client) {
  const r = await modulesResult(client);
  return r && r.kind === 'ok' && r.data && Array.isArray(r.data.modules) ? new Set(r.data.modules.map((m) => m.id)) : null;
}

/** 모듈이 설치돼 있을 때만 부른다. 목록을 모르면 부른다 */
export async function invokeIfModule(client, moduleId, op, input) {
  const ids = await installedModuleIds(client);
  if (ids && !ids.has(moduleId)) return { kind: 'unavailable', reason: 'no-module', module: moduleId };
  return client.invoke(op, input);
}

/** 이 operation 이 기대는 모듈 */
export const MODULE_OF = { 'terra.daemon.io.devices.get': 'io.terra.io-inventory', 'terra.daemon.files.list.get': 'io.terra.file' };
