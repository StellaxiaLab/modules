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
export const GRANT_TTLS = [['1h', 3600], ['1d', 86400], ['7d', 604800], ['30d', 2592000], ['90d', 7776000]];
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
  if (!allow.length) why = '위임 가드 — 나 자신 · 같은 클러스터 노드만';
  else if (type === 'user' && !selfId) why = '로그인 사용자 모름';
  else if (type === 'user' && id !== selfId) why = '위임 가드 — 사람은 나 자신만 (ADR-GW-004 D-3)';
  return { ok: !why, why,
    ops: GRANT_OPS.map((op) => { const ok = allow.includes(op); return { op, label: OP_KO[op] || op, ok, why: ok ? '' : '위임 가드 — ' + (KIND_KO[type] || type) + ' : ' + op + ' 불가' }; }),
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
  if (!allow) return no('위임 가드 — 나 자신 · 같은 클러스터 노드만');
  if (!g.subject_id) return no('받는 이 없음');
  if (type === 'user' && g.subject_id !== selfId) return no(selfId ? '위임 가드 — 사람은 나 자신만' : '로그인 사용자 모름');
  const ops = Array.isArray(g.operations) ? g.operations : [];
  if (!ops.length) return no('작업 1개 이상 선택');
  const bad = ops.find((o) => !allow.includes(o)); if (bad) return no('위임 가드 — ' + KIND_KO[type] + ' : ' + bad + ' 불가');
  if (!(g.ttl_seconds > 0)) return no('기한 필요 — 위임 허가 · 90d 이하');
  if (g.ttl_seconds > GUARD_MAX_TTL) return no('기한 : 90d 까지 (위임 허가)');
  return { ok: true, why: '' };
}

/** 이미 있는 허가의 작업 → 짧은 이름('읽기 · 구독 · 연결 원천') */
export const opsText = (ops) => (ops && ops.length ? ops.map((o) => OP_KO[o] || o).join(' · ') : '—');

// ── 허가 고치기(grants.by-grant-id.patch) — 받는 이는 그대로, 작업 · 끝점 · 기한만 ──
//   Master(routes_svi_grants.go patchSVIGrant · delegated_grant_guard.go grantOnlyNarrows, ADR-GW-004 D-4a):
//     좁히기(작업 부분집합 · 끝점 같음 또는 '전체' → 하나 · 만료 같거나 이르게)는 앱 자격으로도 그대로 통과
//     넓히기는 고친 뒤의 허가에 만들 때와 같은 가드(checkGrant)를 건다 — CLI 로 남에게 준 허가를 앱으로 넓히지 못한다
//     준 사람(grantor) · 관리자만 고친다 — 목록에는 grantor 가 없어 화면이 미리 막지 못한다(403 은 그대로 보인다)

/**
 * 고친 허가가 좁히기만인가 — Master grantOnlyNarrows 와 같은 규칙
 * @param {{ operations?: string[], endpoint_id?: string, expires_at?: string|number|null }} before
 * @param {{ operations: string[], endpoint_id: string, ttl_seconds?: number|null }} after ttl_seconds 없음(null) = 기한 그대로
 */
export function grantNarrows(before, after, now = Date.now()) {
  const had = new Set(before.operations || []);
  if ((after.operations || []).some((o) => !had.has(o))) return false;
  const be = before.endpoint_id || '', ae = after.endpoint_id || '';
  if (ae !== be && be !== '') return false;
  const bx = before.expires_at == null || before.expires_at === '' ? NaN : typeof before.expires_at === 'number' ? before.expires_at : Date.parse(before.expires_at);
  if (after.ttl_seconds != null && !Number.isNaN(bx) && (!(after.ttl_seconds > 0) || now + after.ttl_seconds * 1000 > bx)) return false;
  return true;
}

/**
 * 고치기를 가드처럼 미리 본다 — 좁히기면 통과, 넓히기면 고친 뒤의 허가에 checkGrant
 * @param {{ subject_type: string, subject_id: string, operations?: string[], endpoint_id?: string, expires_at?: string|number|null }} before
 * @param {{ operations: string[], endpoint_id: string, ttl_seconds?: number|null }} after
 * @returns {{ ok: boolean, why: string, narrows: boolean }}
 */
export function checkGrantEdit(before, after, selfId, now = Date.now()) {
  const ops = after.operations || [];
  if (!ops.length) return { ok: false, why: '작업 1개 이상 선택', narrows: false };
  const p = grantPatch(before, after);
  if (!Object.keys(p).length) return { ok: false, why: '바뀐 것 없음', narrows: true };
  if (grantNarrows(before, after, now)) return { ok: true, why: '', narrows: true };
  const bx = before.expires_at == null || before.expires_at === '' ? NaN : typeof before.expires_at === 'number' ? before.expires_at : Date.parse(before.expires_at);
  const ttl = after.ttl_seconds != null ? after.ttl_seconds : Number.isNaN(bx) ? 0 : Math.ceil((bx - now) / 1000);
  const c = checkGrant({ subject_type: before.subject_type, subject_id: before.subject_id, operations: ops, ttl_seconds: ttl }, selfId);
  return { ok: c.ok, why: c.ok ? '' : '넓히기 · ' + c.why, narrows: false };
}

/** patch 입력 — 바뀐 칸만(operations · endpoint_id · ttl_seconds). 끝점 '전체' = '' */
export function grantPatch(before, after) {
  const p = {}, a = (after.operations || []).slice().sort(), b = (before.operations || []).slice().sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) p.operations = GRANT_OPS.filter((o) => a.includes(o)).concat(a.filter((o) => !GRANT_OPS.includes(o)));
  if ((after.endpoint_id || '') !== (before.endpoint_id || '')) p.endpoint_id = after.endpoint_id || '';
  if (after.ttl_seconds != null) p.ttl_seconds = after.ttl_seconds;
  return p;
}
