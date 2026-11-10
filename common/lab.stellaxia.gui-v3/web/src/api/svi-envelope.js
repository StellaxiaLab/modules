// SVI 파일 울타리(svi.runtime.file_roots)를 GUI에서 넓히고 좁히는 길 — ADR-GW-011 §2.7 (E3, 로컬만)
//   Daemon 이 내놓는 것(Terra E1·E2): 두 op 모두 scope local · 권한 node.control · 위임 호출 분당 5회(넘으면 429)
//     허용  terra.daemon.svi.envelope.file-roots.post          { path } → 200 울타리 요약
//     해제  terra.daemon.svi.envelope.file-roots.remove.post   { path } → 200 울타리 요약
//   declarations.get 의 envelope.file_root_sources: [{ path, origin: 'config' | 'runtime' }] — 설정 파일 것은 GUI 에서 못 지운다
//   오류: SVI_ENVELOPE_ROOT_REFUSED(400, detail.reason) · SVI_ENVELOPE_ROOT_FROM_CONFIG(409) · SVI_ENVELOPE_ROOT_NOT_FOUND(404)
// op id 가 다르게 나오면 아래 두 상수만 바꾼다.
// 아래 rootRows · affectedBy · sensitiveWhy · envelopeError 는 보드(design/build/parts/nodesvi/script.js)에 사본이 있다 — tests/nodesvi.test.mjs 가 같은지 본다.

export const ENVELOPE_ADD_OP = 'terra.daemon.svi.envelope.file-roots.post';
export const ENVELOPE_REMOVE_OP = 'terra.daemon.svi.envelope.file-roots.remove.post';

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
const winLike = (p) => /^[A-Za-z]:/.test(p);
/** p 가 root 와 같거나 그 안인가(Windows 경로는 대소문자 무시) */
export function under(p, root) {
  let a = norm(p), b = norm(root); if (!a || !b) return false;
  if (winLike(a) || winLike(b)) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a === b || a.startsWith(b + '/');
}

/** envelope → 줄. file_root_sources 가 없으면(옛 Terra) 전부 설정 파일 것으로 보고 해제를 닫는다 @returns {{ path: string, mode: string, origin: 'config'|'runtime', removable: boolean }[]} */
export function rootRows(env) {
  if (!env) return [];
  const A = (x) => (Array.isArray(x) ? x : []), src = new Map(A(env.file_root_sources).filter((s) => s && s.path).map((s) => [norm(s.path), s.origin]));
  return A(env.file_roots).map((r) => { const path = r.path || r, origin = src.get(norm(path)) === 'runtime' ? 'runtime' : 'config'; return { path, mode: r.mode || '', origin, removable: origin === 'runtime' }; });
}

/** 이 root 를 해제하면 울타리 밖이 되어 멈추는 파일 자원(남는 다른 root 가 품는 것은 제외) @returns {object[]} */
export function affectedBy(decls, rootPath, roots) {
  const rest = (roots || []).map((r) => r.path || r).filter((p) => norm(p) !== norm(rootPath));
  return (decls || []).filter((d) => d.family === 'file' && d.state === 'applied' && d.detail && under(d.detail, rootPath) && !rest.some((p) => under(d.detail, p)));
}

/** 홈 폴더(또는 그 위)를 고르면 강한 경고 — 모르면 '' */
export function sensitiveWhy(path) {
  const p = norm(path);
  if (/^[A-Za-z]:\/Users\/[^/]+$/i.test(p) || /^\/home\/[^/]+$/.test(p) || /^\/Users\/[^/]+$/.test(p) || p === '/root' || /^[A-Za-z]:\/Users$/i.test(p) || p === '/home' || p === '/Users')
    return '홈 폴더입니다. .ssh 키, 브라우저 프로필(저장된 로그인), 문서 같은 민감한 파일이 들어 있습니다. 가능하면 자원으로 쓸 하위 폴더만 고르세요.';
  return '';
}

const ROOT_WHY = {
  not_absolute: '절대 경로여야 합니다. (예: C:\\공유 또는 /srv/share)',
  not_found: '이 노드에 그런 폴더가 없습니다. 경로를 확인하세요.',
  not_directory: '폴더가 아니라 파일입니다. 폴더를 고르세요.',
  filesystem_root: '드라이브나 / 전체는 허용할 수 없습니다. 더 좁은 폴더를 고르세요.',
  protected: 'Terra 의 데이터·설정 폴더(또는 그 안)는 허용할 수 없습니다.',
};
/** 오류 → 한국어 한 문장. 코드·reason 별 */
export function envelopeError(e) {
  const code = e && e.code, st = e && e.status, d = (e && (e.details || e.detail)) || {};
  if (code === 'SVI_ENVELOPE_ROOT_REFUSED') return ROOT_WHY[d.reason] || '이 폴더는 허용할 수 없습니다' + (d.reason ? ' (' + d.reason + ')' : '') + '.';
  if (code === 'SVI_ENVELOPE_ROOT_FROM_CONFIG') return '노드 설정 파일에서 온 폴더라 GUI 에서 해제할 수 없습니다. 설정 파일에서 지우고 재시작하세요.';
  if (code === 'SVI_ENVELOPE_ROOT_NOT_FOUND') return '이미 울타리에 없는 폴더입니다.';
  if (st === 429 || code === 'RATE_LIMITED' || code === 'HTTP_429') return '짧은 시간에 너무 자주 바꿨습니다(분당 5회). 잠시 뒤 다시 하세요.';
  if (code === 'FORBIDDEN' || st === 403) return '권한이 없습니다. 울타리를 바꾸려면 node.control 권한이 필요합니다.';
  if (code === 'LOCAL_ONLY' || code === 'OPERATION_NOT_REMOTE') return '이 노드에서만 바꿀 수 있습니다.';
  return (code || '오류') + (e && e.message ? ' — ' + e.message : '');
}

/** 로컬 폴더 탐색(local-fs, 읽기 전용) 결과 → 폴더만. 뿌리 + 상대 경로 → 절대 경로 */
export function joinRoot(rootPath, rel) {
  const base = String(rootPath || ''), sep = base.includes('\\') && !base.includes('/') ? '\\' : '/', r = String(rel || '').replace(/^\/+|\/+$/g, '');
  return r ? base.replace(/[\\/]+$/, '') + sep + r.split('/').join(sep) : base;
}

/**
 * @param {{ invoke: (op: string, input?: object, at?: object) => Promise<any> }} terra
 * @param {() => any} topo window.TerraTopology — localId
 */
export function createSviEnvelope(terra, topo) {
  const local = (rid) => { const T = topo(); return !rid || !!(T && T.localId === rid); };
  return {
    isLocal: local,
    /** 폴더 허용 — 로컬만(다른 노드면 부르지 않는다) */
    add: (rid, path) => { if (!local(rid)) return Promise.reject(Object.assign(new Error('이 노드에서만'), { code: 'LOCAL_ONLY' })); return terra.invoke(ENVELOPE_ADD_OP, { path }); },
    remove: (rid, path) => { if (!local(rid)) return Promise.reject(Object.assign(new Error('이 노드에서만'), { code: 'LOCAL_ONLY' })); return terra.invoke(ENVELOPE_REMOVE_OP, { path }); },
    fsRoots: () => terra.invoke('terra.daemon.local-fs.roots.get', {}),
    fsEntries: (root, rel) => terra.invoke('terra.daemon.local-fs.entries.get', rel ? { root, path: rel, limit: 500 } : { root, limit: 500 }),
    /** 그 노드의 공유 폴더(lab.stellaxia.file — 노드 데스크톱 파일 탐색기와 같은 길). 다른 노드면 Master 중계로 */
    shareRoots: (rid) => terra.invoke('lab.stellaxia.file.roots.list', {}, local(rid) ? {} : { node: rid }),
    shareEntries: (rid, root, rel) => terra.invoke('lab.stellaxia.file.entries.list', rel ? { root, path: rel } : { root }, local(rid) ? {} : { node: rid }),
  };
}
