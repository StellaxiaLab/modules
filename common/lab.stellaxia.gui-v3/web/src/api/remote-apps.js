// 다른 노드의 GUI 앱 목록 — GET /api/v1/gui/remote/{node}/apps (Terra #385: 앱 토큰으로도 읽힌다, 위임 세션 문)
//   노드마다 캐시한다 — 읽은 것은 TTL_OK, 못 읽은 것은 TTL_ERR 동안 다시 묻지 않는다(그리는 때마다 두드리지 않게).
//   get(node) 은 동기로 지금의 사본을 돌려주고, 없거나 낡았으면 뒤에서 한 번만 받는다. 받으면 onChange() 로 화면을 다시 그린다.
//   항목: { state: 'loading' } | { state: 'ok', apps, at } | { state: 'err', why, code, at } — 못 읽은 것은 "없음"이 아니라 "못 봤음 + 이유"
export const TTL_OK = 60000;
export const TTL_ERR = 20000;

/** 실패 → 사람이 읽는 이유(코드 포함) */
export function remoteAppsWhy(e) {
  const code = (e && (e.code || (e.status && 'HTTP_' + e.status))) || 'UNKNOWN', status = e && e.status;
  if (code === 'GUI_REMOTE_DENIED' || status === 403) return '이 노드의 앱 목록을 볼 권한이 없음 (' + code + ')' + (e && e.message ? ' — ' + e.message : '');
  if (status === 501 || code === 'GUI_REMOTE_UNAVAILABLE' && status === 501) return 'Gateway 가 Master 에 연결되어 있지 않아 원격 앱 목록을 못 받음 (501)';
  if (code === 'NETWORK' || status === 0) return 'Gateway 에 닿지 못함 (' + code + ')';
  return '원격 앱 목록을 읽지 못함 (' + code + ')';
}

/** @param {{ http: (m: string, p: string) => Promise<any>, now?: () => number, onChange?: () => void }} o */
export function createRemoteApps(o) {
  const now = o.now || Date.now, C = new Map(), inflight = new Set();
  const fetchOne = (node) => {
    if (inflight.has(node)) return; inflight.add(node);
    const done = (ent) => { inflight.delete(node); C.set(node, ent); if (o.onChange) try { o.onChange(); } catch {} };
    Promise.resolve().then(() => o.http('GET', '/api/v1/gui/remote/' + encodeURIComponent(node) + '/apps')).then(
      (d) => done(Array.isArray(d && d.apps) ? { state: 'ok', apps: d.apps, at: now() } : { state: 'err', why: '원격 앱 목록 응답이 낯섦 (BAD_RESPONSE)', code: 'BAD_RESPONSE', at: now() }),
      (e) => done({ state: 'err', why: remoteAppsWhy(e), code: (e && e.code) || '', at: now() }));
  };
  return {
    get(node) {
      if (!node) return undefined;
      const c = C.get(node), t = now();
      if (!c) { C.set(node, { state: 'loading', at: t }); fetchOne(node); return C.get(node); }
      if (c.state !== 'loading' && t - c.at >= (c.state === 'ok' ? TTL_OK : TTL_ERR)) fetchOne(node);   // 낡은 사본은 새로 받는 동안 그대로 보인다
      return c;
    },
    clear() { C.clear(); },
  };
}
