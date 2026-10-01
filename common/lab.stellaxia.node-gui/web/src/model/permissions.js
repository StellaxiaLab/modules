// 권한 — 남의 노드 자원을 다루므로 조타륜 앱 · 폴더 보관함은 늘 권한을 같이 본다.
// 잠긴 동작은 숨기지 않고 🔒 + 이유를 단다 (lockReason). 화면 로직의 hbPerm · B()와 같은 규칙.
// 실제 연동: whoami.get 의 permissions(내 계정) + 노드 · tree 로그인 상태 + SVI 자원별 허가(grants.get)

/** 기본 권한 밖(★) — 처음엔 잠겨 있다 */
export const STAR = ['node.config', 'module.manage', 'process.cancel', 'master.admin'];

/** 권한 칸 짧은 이름 */
export const PERM_LABEL = {
  'node.read': '읽기', 'node.control': '제어', 'node.config': '설정★', 'process.execute': '실행', 'process.cancel': '취소',
  'file.read': '파일 읽기', 'file.write': '파일 쓰기', 'module.manage': '모듈 관리★'
};

/**
 * 노드 하나에 대한 내 자리와 권한.
 * @param {string} node                       대상 노드 (지금 맵의 노드)
 * @param {{ localNode: string, whoami: string[], loggedIn: (tree: string) => boolean, treeOf: (node: string) => string|null, nodePerms?: Record<string, string[]> }} ctx
 * @returns {import('./types.js').NodePerm}
 */
export function nodePerm(node, ctx) {
  if (node === ctx.localNode) return { role: '소유자', has: Object.keys(PERM_LABEL) };
  const tree = ctx.treeOf(node);
  if (tree && !ctx.loggedIn(tree)) return { role: '권한 없음', has: [], why: tree + ' 로그인 필요' };
  // 노드별로 Master가 준 권한이 있으면 그것을, 없으면 내 계정 권한(whoami)을 쓴다
  const has = (ctx.nodePerms && ctx.nodePerms[node]) || ctx.whoami || ['node.read'];
  return { role: has.includes('node.control') ? '관리자' : '읽기 전용', has };
}

/**
 * 동작 잠금 이유. 없으면 null (= 누를 수 있다)
 * @param {import('./types.js').NodePerm} perm
 * @param {string[]} need                    필요한 권한
 * @param {string|null} [other]              권한이 아닌 이유 (설정 파일 선언 · 백엔드 없음 · 위임 필요 …)
 */
export function lockReason(perm, need, other) {
  if (other) return other;
  const miss = (need || []).filter((p) => !perm.has.includes(p));
  if (!miss.length) return null;
  return miss.join(' · ') + ' 권한 없음' + (perm.why ? ' — ' + perm.why : '');
}

/**
 * SVI 자원은 노드 권한이 아니라 자원별 허가로 연다
 * @param {import('./types.js').SviResource} r
 */
export function sviOpenLock(r) {
  if (/^io\./.test(r.kind)) return '데이터 백엔드가 없다 — io 자원은 열 수 없다';
  if (r.status !== 'available') return '자원이 쓸 수 없는 상태';
  if (r.grant === 'own') return null;
  return r.grant && r.grant.includes('read') ? null : '이 자원의 허가가 없다 — 소유자 · 관리자에게 받아야';
}

/**
 * Master 명령은 로그인한 tree의 직계 자식에게만 (아니면 DELEGATION_REQUIRED)
 * @param {string} node @param {string} curTree @param {(n: string) => string|null} parentOf @param {string} localNode
 */
export function delegationLock(node, curTree, parentOf, localNode) {
  if (node === localNode || node === curTree || parentOf(node) === curTree) return null;
  return '직계 자식이 아니다 — 위임 필요 (DELEGATION_REQUIRED)';
}
