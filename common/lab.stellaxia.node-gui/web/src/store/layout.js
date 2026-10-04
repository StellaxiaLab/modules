// LayoutStore — API에 자리가 없는 사용자 데이터(노드 모습 · 맵 배치 · 노드 자원 · 연결 · 표시 설정 · 메모)를 저장한다.
// 지금 구현: 브라우저 localStorage (기기마다 따로). 짝 프로젝트(service)와 같은 모양이다.
//   service 키 = terra.gui.layout|<gateway>|<user>
//   module  키 = terra.gui.layout|<node_id>|<주체>  — 앱 origin 이 게이트웨이마다 따로라 저장소가 이미 게이트웨이로 갈린다
// 바꿀 때: loadLayout · saveLayout 두 함수만 다른 저장소(GUI 모듈 API 등)로 — docs/guides/module-profile.md §저장
const KEYS = ['looks', 'maps', 'map', 'roadsOn', 'markStyle', 'roadPick', 'memos', 'wins', 'utilItems', 'ovhHide'];

export function layoutKey(gateway, user) { return 'terra.gui.layout|' + gateway + '|' + (user || '-'); }

export function loadLayout(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}

/** 화면 상태 → 저장할 모양 (지금 맵은 snapshotMap으로 maps에 넣는다) */
export function pickLayout(screen) {
  const S = screen.state, out = {};
  KEYS.forEach((k) => { if (S[k] !== undefined) out[k] = S[k]; });
  out.maps = Object.assign({}, S.maps, { [S.map]: screen.snapshotMap() });
  return out;
}

export function saveLayout(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}

/** setState를 감싸 바뀔 때마다(0.8초 모아서) 저장 */
export function autoSave(screen, key) {
  let t = 0;
  const orig = screen.setState.bind(screen);
  screen.setState = (p) => { orig(p); clearTimeout(t); t = setTimeout(() => { if (!screen.state.mt) saveLayout(key, pickLayout(screen)); }, 800); };
  window.addEventListener('pagehide', () => saveLayout(key, pickLayout(screen)));
}

// ───── 모듈: 끊을 수 있는 자동 저장 · 저장본 되살리기 ─────

/**
 * autoSave 와 같되 끊을 수 있다. 모듈은 로그아웃 · 토큰을 잃으면 빈 세계로 돌아가는데,
 * 그때 저장을 끊지 않으면 빈 세계가 저장본을 덮는다.
 * @returns {() => void} 끊기 — 감싼 setState 를 되돌린다
 */
export function bindLayout(screen, key, win = globalThis.window) {
  let t = 0, on = true;
  const own = Object.prototype.hasOwnProperty.call(screen, 'setState');
  const orig = screen.setState;
  const save = () => { if (on && !screen.state.mt) saveLayout(key, pickLayout(screen)); };
  screen.setState = function (p) { orig.call(screen, p); if (!on) return; clearTimeout(t); t = setTimeout(save, 800); };
  const hide = () => { if (on) saveLayout(key, pickLayout(screen)); };
  if (win && win.addEventListener) win.addEventListener('pagehide', hide);
  return () => {
    if (!on) return;
    on = false; clearTimeout(t);
    if (own) screen.setState = orig; else delete screen.setState;
    if (win && win.removeEventListener) win.removeEventListener('pagehide', hide);
  };
}

/**
 * 저장된 맵들을 지금 노드 관계(NET)에 맞춘다 — 짝 프로젝트 boot 의 규칙을 모든 맵에:
 *   주인이 사라진 맵은 버리고, 사라진 노드는 칸에서 빼고, 칸이 없는 tree 의 자식은 "새 노드"(pending)로.
 * 자원(rsrc) · 연결(links)은 그대로 둔다 — 원본 항목이 사라지면 화면이 "원본 목록에서 사라짐"으로 보인다.
 * @param {Record<string, any>} maps  저장된 maps
 * @param {Record<string, { role: string, kids?: string[] }>} NET
 * @param {(role: string) => boolean} isTree
 */
export function reviveMaps(maps, NET, isTree) {
  const out = {};
  const alive = new Set(Object.keys(NET || {}));
  Object.keys(maps || {}).forEach((owner) => {
    const m0 = maps[owner];
    if (!alive.has(owner) || !m0 || typeof m0 !== 'object' || !Array.isArray(m0.fields)) return;
    const m = Object.assign({}, m0);
    m.nodes = Object.fromEntries(Object.entries(m.nodes || {}).filter(([, n]) => n && alive.has(n.name)));
    const net = NET[owner];
    if (isTree(net.role)) {
      const placed = new Set(Object.values(m.nodes).map((n) => n.name));
      const before = new Map((Array.isArray(m.pending) ? m.pending : []).map((p) => [p.name, p]));
      m.pending = (net.kids || []).filter((k) => !placed.has(k) && k !== owner)
        .map((k) => before.get(k) || { name: k, role: (NET[k] || { role: 'Leaf' }).role, at: '새로' });
    } else m.pending = [];
    m.rsrc = m.rsrc && typeof m.rsrc === 'object' ? m.rsrc : {};
    m.links = Array.isArray(m.links) ? m.links : [];
    m.sel = null;
    out[owner] = m;
  });
  return out;
}

/** 창 자리 — 저장본에 없는 새 창(도로 편집기 · 자원 설정 …)은 기본 자리로, 모르는 창은 버린다 */
export function reviveWins(defaults, saved) {
  const out = Object.assign({}, defaults);
  Object.keys(saved || {}).forEach((k) => {
    const w = saved[k];
    if (defaults && defaults[k] && w && Number.isFinite(w.x) && Number.isFinite(w.y)) out[k] = Object.assign({}, defaults[k], w);
  });
  return out;
}
