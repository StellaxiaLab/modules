// 사용자 문서 저장소 (Terra C-1 · /api/v1/me/documents) — 맵 배치(LayoutStore)와 편집기 자산을 서버에도 둔다.
// 브라우저(localStorage)에는 지금처럼 바로, 서버에는 뒤따라(3초 모아서) — 다른 기기 · 다른 브라우저에서 같은 맵이 보인다.
//
//   이름공간  app:<앱 id> — 앱 토큰이면 Gateway 가 이 이름공간으로 고정한다(다른 이름공간은 403)
//   키        layout/<node_id>  맵 배치 · 노드 모습 · 노드 자원 · 연결 · 메모 · 표시 설정 · 창 자리 (노드마다)
//             assets            건물 · 도로 설계(localStorage terra.gui.buildings · terra.gui.roads — 사람마다)
//   값        { version: 1, savedAt, data } — 읽을 때 savedAt 이 새 쪽이 이긴다(브라우저 저장본은 _savedAt)
//   쓰기마다  base_revision — 다른 창 · 기기가 먼저 썼으면 409. 한 번 알리고 지금 것으로 덮는다(마지막에 고친 화면이 이긴다)
//
// 경로로 부른다(client.request). 게이트웨이 자기 op 를 invoke 로 부르면 앱 토큰의 호출자가 빠진다 — 구현해야 할 것 PF-10 (Terra#118)

const OP = 'terra.gateway.me.documents.by-namespace.by-key.put';
export const ASSET_KEYS = ['terra.gui.buildings', 'terra.gui.roads'];
const ASSET_AT = 'terra.gui.assetsAt';

export class DocStore {
  /** 모아서 쓰는 시간(ms) — 시험은 줄여 쓴다 */
  static WAIT = 3000;
  /** @param {import('../api/client.js').TerraClient} client @param {string} appId 앱 id (whoami 의 delegate) */
  constructor(client, appId) {
    this.c = client; this.ns = 'app:' + appId; this.rev = {}; this.timers = {}; this.pending = {};
    this.state = 'idle'; this.warned = false; this.onNote = () => {};
  }
  /** 이 게이트웨이에 사용자 문서 저장소가 있나 (카탈로그를 못 받았으면 해 본다) */
  available() { const cat = this.c.catalog; return !cat || cat.size === 0 || this.c.has(OP); }
  path(key) { return '/api/v1/me/documents/' + encodeURIComponent(this.ns) + '/' + String(key).split('/').map(encodeURIComponent).join('/'); }

  /** 없거나 못 읽으면 null. 없음(404)이 아닌 실패(Master 연결 없음 501 · 막힘 403 …)면 state 'off' — 이 세션은 브라우저에만 둔다
   *  @returns {Promise<{ version: number, savedAt: number, data: any } | null>} */
  async read(key) {
    const r = await this.c.request('GET', this.path(key));
    if (r.kind !== 'ok' || !r.data) {
      if (r.status !== 404) { this.state = 'off'; this.why = r.reason || r.kind; }
      return null;
    }
    this.rev[key] = r.data.revision;
    const v = r.data.value;
    return v && typeof v === 'object' ? v : null;
  }

  /** 모아서 쓰기 — 같은 키는 마지막 것만 */
  later(key, get, wait = DocStore.WAIT) {
    clearTimeout(this.timers[key]);
    this.pending[key] = get;
    this.timers[key] = setTimeout(() => { delete this.pending[key]; void this.write(key, get()); }, wait);
  }

  async write(key, data) {
    if (this.state === 'off') return false;
    const value = { version: 1, savedAt: Date.now(), data };
    const put = (base) => this.c.request('PUT', this.path(key), Object.assign({ value }, base != null ? { base_revision: base } : {}));
    let r = await put(this.rev[key]);
    if (r.status === 409) {   // 다른 창 · 기기가 먼저 썼다 — 한 번 알리고 지금 것으로 덮는다
      if (!this.warned) { this.warned = true; this.onNote('다른 창 · 기기에서 ' + key + '이(가) 바뀌었다 — 이 화면의 것으로 덮는다(새로 고치면 그쪽 것을 받는다)', '#a65f00'); }
      const cur = await this.c.request('GET', this.path(key));
      r = await put(cur.kind === 'ok' && cur.data ? cur.data.revision : undefined);
    }
    if (r.kind === 'ok') { this.rev[key] = r.data && r.data.revision; this.state = 'ok'; return true; }
    if (this.state !== 'error') { this.state = 'error'; this.onNote('서버(사용자 문서)에 저장하지 못했다 (' + (r.reason || r.kind) + ') — 이 브라우저에만 저장한다', '#a65f00'); }
    return false;
  }

  /** 끊기 — 모아 둔 쓰기를 버린다(로그아웃 · 토큰을 잃었다. 브라우저 저장본은 남아 다음 로그인에 다시 올린다) */
  stop() { Object.values(this.timers).forEach(clearTimeout); this.timers = {}; this.pending = {}; }
}

/** 브라우저 저장본과 서버 문서 가운데 새 것 — 서버 것이 새로우면 그 data, 아니면 null(브라우저 것을 쓴다) */
export function newerDoc(local, doc) {
  return doc && doc.data && typeof doc.data === 'object' && (Number(doc.savedAt) || 0) > (Number(local && local._savedAt) || 0) ? doc.data : null;
}

// ───── 편집기 자산 — 건물 · 도로 편집기가 내보내면 localStorage 에 쓴다. 노드 화면은 storage 이벤트로 받는다 ─────

/**
 * 서버의 자산이 이 브라우저 것보다 새로우면 localStorage 에 쓰고 onChange(key, value) — 노드 화면이 다시 읽게(_onStore)
 * @returns {Promise<boolean>} 바꿨으면 true
 */
export async function pullAssets(docs, onChange, ls = globalThis.localStorage) {
  if (!ls) return false;
  const f = await docs.read('assets');
  if (!f || !f.data) return false;
  if ((Number(f.savedAt) || 0) <= (Number(ls.getItem(ASSET_AT)) || 0)) return false;
  let changed = false;
  ASSET_KEYS.forEach((k) => {
    const v = f.data[k];
    if (v == null) return;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (ls.getItem(k) !== s) { ls.setItem(k, s); changed = true; if (onChange) onChange(k, s); }
  });
  ls.setItem(ASSET_AT, String(f.savedAt));
  return changed;
}

/** 편집기가 내보내면(다른 문서의 storage 이벤트) 서버로. @returns {() => void} 그만 듣기 */
export function watchAssets(docs, win = globalThis.window, ls = globalThis.localStorage) {
  if (!win || !ls || !win.addEventListener) return () => {};
  const push = () => docs.later('assets', () => { const d = {}; ASSET_KEYS.forEach((k) => { d[k] = ls.getItem(k); }); return d; }, DocStore.WAIT * 2 / 3);
  const on = (e) => { if (e && ASSET_KEYS.indexOf(e.key) >= 0) { try { ls.setItem(ASSET_AT, String(Date.now())); } catch { /* 저장 못 함 */ } push(); } };
  win.addEventListener('storage', on);
  return () => win.removeEventListener('storage', on);
}
