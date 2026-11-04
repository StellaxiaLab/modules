// SVI 허가의 주체(누구에게) · 작업(무엇을) · 기한 — Master 위임 가드(Terra api/delegated_grant_guard.go, ADR-GW-004 2b · D-3 · D-4 · Q14)를 화면 규칙으로 옮긴 것.
//
//   앱 자격(delegated-session)으로 만드는 허가는
//     받는 이   사람 자신(subject user · subject_id == 세션의 사용자) · 같은 클러스터의 노드(subject node) — 그 밖(남의 사용자 · application …)은 403
//     작업      사람: inspect · read · subscribe · bind.source · bind.target   노드: read · subscribe · bind.source   (write · invoke 는 누구에게도 못 준다)
//     기한      반드시 · 90일 이하(ttl_seconds 없음 · 90일 넘음은 403)
//   같은 클러스터인지는 Master 가 Registry 로 본다(NODE_NOT_FOUND) — 화면은 보이는 노드만 칩으로 내므로 따로 보지 않는다.
//   CLI · 사람의 직접 세션(Tree 웹 콘솔)은 이 가드를 지나지 않는다 — 그 길로 준 넓은 허가도 목록에는 그대로 보인다.
//
// 보드(NodeShare · NodeSvi)의 시안 사본이 이 파일과 같은지 tests/svi-grant-boards.test.mjs 가 본다.

/** 화면에 내는 작업 — 가드가 막는 것도 칩으로 그리되 잠근다 */
export const GRANT_OPS = ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target', 'write', 'invoke'];
/** 위임 가드가 주체 종류마다 허락하는 작업(delegatedGrantOperations) */
export const GUARD_OPS = { user: ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target'], node: ['read', 'subscribe', 'bind.source'] };
/** 처음 고른 작업 — 노드는 지금까지의 '읽기 · 연결 원천', 사람은 '살펴보기 · 읽기 · 구독' */
export const GRANT_DEFAULTS = { user: ['inspect', 'read', 'subscribe'], node: ['read', 'subscribe', 'bind.source'] };
export const GUARD_MAX_TTL = 90 * 86400;
/** 기한 — 위임 허가는 기한이 있어야 하고 90일 이하('기한 없음'은 내지 않는다) */
export const GRANT_TTLS = [['1시간', 3600], ['1일', 86400], ['7일', 604800], ['30일', 2592000], ['90일', 7776000]];
export const OP_KO = { discover: '찾기', inspect: '살펴보기', read: '읽기', list: '목록', watch: '지켜보기', subscribe: '구독', 'bind.source': '연결 원천', 'bind.target': '연결 대상', write: '쓰기', invoke: '호출' };
const KIND_KO = { user: '사람', node: '노드' };

/** whoami(window.TerraWho) → 사용자 id — principal 의 '… via 앱' 앞, 'user:' 뒤. 모르면 '' */
export function selfIdOf(who) {
  const p = String((who && who.principal) || '').split(/\s+via\s+/)[0].replace(/^user:/, '').trim();
  return p && p !== 'anonymous' ? p : '';
}

/**
 * 이 주체에게 지금 무엇을 줄 수 있나 — 칩 · 기한 · 잠금 이유
 * @param {'user'|'node'} type @param {string} id 주체 id @param {string} selfId 이 계정의 사용자 id
 * @returns {{ ok: boolean, why: string, ops: { op: string, label: string, ok: boolean, why: string }[], defaults: string[], ttls: [string, number][] }}
 */
export function subjectRule(type, id, selfId) {
  const allow = GUARD_OPS[type] || [];
  let why = '';
  if (!allow.length) why = '위임 가드 — 앱 자격으로는 나 자신 또는 같은 클러스터의 노드에게만';
  else if (type === 'user' && !selfId) why = '로그인한 사용자를 알 수 없다';
  else if (type === 'user' && id !== selfId) why = '위임 가드 — 앱 자격으로는 사람 가운데 나 자신에게만 줄 수 있다(ADR-GW-004 D-3)';
  return { ok: !why, why,
    ops: GRANT_OPS.map((op) => { const ok = allow.includes(op); return { op, label: OP_KO[op] || op, ok, why: ok ? '' : '앱 자격으로는 ' + (KIND_KO[type] || type) + '에게 ' + op + ' 를 줄 수 없다' }; }),
    defaults: (GRANT_DEFAULTS[type] || []).slice(), ttls: GRANT_TTLS.slice() };
}

/** 고른 작업 중 그 주체에게 줄 수 있는 것만(GRANT_OPS 순서) */
export function allowedOps(type, picked) {
  const allow = GUARD_OPS[type] || [], s = new Set(picked || []);
  return GRANT_OPS.filter((op) => allow.includes(op) && s.has(op));
}

/** 칩 하나를 누르면 — 켜거나 끈 작업 목록(못 주는 작업은 그대로) */
export function toggleOp(type, picked, op) {
  if (!(GUARD_OPS[type] || []).includes(op)) return allowedOps(type, picked);
  const s = new Set(picked || []); if (s.has(op)) s.delete(op); else s.add(op);
  return allowedOps(type, [...s]);
}

/**
 * grants.post 입력을 가드처럼 미리 본다 — 보내기 전에 403 을 화면에서
 * @param {{ subject_type: string, subject_id: string, operations: string[], ttl_seconds?: number }} g
 * @returns {{ ok: boolean, why: string }}
 */
export function checkGrant(g, selfId) {
  const no = (why) => ({ ok: false, why });
  const type = (g && g.subject_type) || 'user', allow = GUARD_OPS[type];
  if (!allow) return no('위임 가드 — 앱 자격으로는 나 자신 또는 같은 클러스터의 노드에게만');
  if (!g.subject_id) return no('받는 이가 없다');
  if (type === 'user' && g.subject_id !== selfId) return no(selfId ? '위임 가드 — 사람 가운데 나 자신에게만' : '로그인한 사용자를 알 수 없다');
  const ops = Array.isArray(g.operations) ? g.operations : [];
  if (!ops.length) return no('작업을 하나 이상 고른다');
  const bad = ops.find((o) => !allow.includes(o)); if (bad) return no('앱 자격으로는 ' + KIND_KO[type] + '에게 ' + bad + ' 를 줄 수 없다');
  if (!(g.ttl_seconds > 0)) return no('위임 허가는 기한이 있어야 한다(90일 이하)');
  if (g.ttl_seconds > GUARD_MAX_TTL) return no('위임 허가는 90일까지');
  return { ok: true, why: '' };
}

/** 이미 있는 허가의 작업 → 짧은 이름('읽기 · 구독 · 연결 원천') */
export const opsText = (ops) => (ops && ops.length ? ops.map((o) => OP_KO[o] || o).join(' · ') : '—');
