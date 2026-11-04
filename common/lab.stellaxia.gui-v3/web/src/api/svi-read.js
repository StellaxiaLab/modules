// SVI(자원 창 NodeShare · 자원 상태 창 ResStatus)의 Master 응답 → 화면 모양. 응답 모양은 node-gui web/src/api/adapters.js 가 쓰는 것과 같다
// (Master routes_svi_* 의 view):
//   svi.resources.get  { items[{ resource_id, node_id, kind, canonical_name, display_name, status, expires_at, endpoints[{ endpoint_id, direction, interaction }] }] }
//   svi.grants.get     { items[{ grant_id, subject{ type, id }, resource_id, operations[], expires_at? }] }
//   svi.bindings.get   { items[{ binding_id, source{ resource_id, endpoint_id }, target{…}, source_node_id, target_node_id, desired_state, observed_state, reason, qos_profile }] }
//   svi.handles.get    { items[{ handle_id, resource_id, endpoint_id, operation, qos_profile, state, created_at }] }
//
// 앱 자격(A 모드)의 Master 위임 표: resources · endpoints · grants(get · post · patch · delete) · bindings(get · post · delete) · handles(get · by-id.get).
// 위임 밖: handles.post(핸들 열기) · handles.by-handle-id.stream/events/write. 그래서 자원 상태 창은 값(스트림)을 보이지 못하고,
// 누가 그 자원을 열어 쓰는지(열린 핸들 목록)를 주기적으로(10초) 읽어 대신한다 — SSE 이벤트를 받을 길이 없으므로 조회로 바꾼다.

const arr = (d, ...keys) => { if (Array.isArray(d)) return d; for (const k of keys) if (d && Array.isArray(d[k])) return d[k]; return []; };

/** 화면에서 노드에게 줄 수 있는 권한 낱말 → SVI operations.
 *  Master 의 위임 입구 가드(api/delegated_grant_guard.go, ADR-GW-004 2b)가 앱 자격으로 노드에게 주는 것을 read · subscribe · bind.source 로,
 *  기한은 반드시 · 90일 이하로 묶는다(실측: discover · inspect · write · list · watch · invoke · bind.target 은 403, 기한 없음 · 100일은 403).
 *  그래서 '보기 · 쓰기 · 제어'는 내지 않는다 — 그것은 Tree 의 웹 콘솔 · CLI(사람의 직접 호출)에서 */
export const PERMS = {
  읽기: ['read', 'subscribe'],
  '연결 원천': ['read', 'subscribe', 'bind.source']
};
/** 기한 — 위임 허가는 기한이 있어야 하고 90일 이하 */
export const TTLS = { '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 };
/** operations → 권한 낱말(이미 있는 허가를 보일 때 — 다른 길로 준 넓은 허가도 이름은 붙인다) */
export function permOf(ops) {
  const s = new Set(ops || []);
  if (!s.size) return '—';
  if (s.has('bind.source') || s.has('bind_source')) return '연결 원천';
  if (s.has('invoke')) return '제어';
  if (s.has('write')) return '쓰기';
  if (s.has('read') || s.has('subscribe') || s.has('list') || s.has('watch')) return '읽기';
  return '보기';
}

/** 자원 목록 @returns {{ id: string, node: string, kind: string, name: string, status: string, eps: { id: string, dir: string, interaction: string, schema: string }[] }[]} */
export { subjectRule, allowedOps, toggleOp, checkGrant, selfIdOf, opsText, GRANT_OPS, GRANT_TTLS, OP_KO } from './svi-grant.js';
export function resources(d) {
  return arr(d, 'items', 'resources').map((r) => ({ id: r.resource_id, node: r.node_id || '', kind: r.kind || '', name: r.display_name || r.canonical_name || r.resource_id, status: r.status || '',
    eps: arr(r.endpoints).map((e) => ({ id: e.endpoint_id, dir: e.direction || '', interaction: e.interaction || '', schema: (e.direction === 'sink' ? e.input_schema || e.output_schema : e.output_schema || e.input_schema) || '' })) }));
}

const ttlText = (iso, now) => { const t = Date.parse(iso || ''); if (Number.isNaN(t)) return '없음'; const h = (t - now) / 3600000; return h <= 0 ? '만료' : h < 24 ? Math.ceil(h) + 'h 남음' : Math.ceil(h / 24) + 'd 남음'; };
/** 허가 목록 → 그 자원의 줄. names: node_id → 이름, parent: 부모 Tree 의 node_id @returns {{ id: string, who: string, type: string, perm: string, ops: string, ttl: string, subject: { type: string, id: string } }[]} */
//   주체가 사람이면 type '사람', 이 계정(selfId)이면 who '나'
export function grantRows(d, resourceId, names = new Map(), parent = '', now = Date.now(), selfId = '') {
  return arr(d, 'items', 'grants').filter((g) => g.resource_id === resourceId).map((g) => {
    const s = g.subject || { type: g.subject_type, id: g.subject_id }, node = s.type === 'node', me = !node && !!selfId && s.id === selfId;
    return { id: g.grant_id, who: node ? names.get(s.id) || s.id : me ? '나 · ' + s.id : s.id, type: node ? (s.id === parent ? 'Tree' : 'Leaf') : s.type === 'user' || !s.type ? '사람' : s.type, self: me,
      perm: permOf(g.operations), ops: (g.operations || []).join(' · '), ttl: ttlText(g.expires_at, now), subject: s };
  });
}

/** 이 노드에 허가된(다른 노드의) 자원 — 외부 자원 등록 후보. 이미 이 노드로 이어진 바인딩이 있으면 bound @returns {any[]} */
export function availRows(grantsD, resD, bindD, myNode, names = new Map()) {
  const res = new Map(resources(resD).map((r) => [r.id, r])), binds = bindings(bindD);
  return arr(grantsD, 'items', 'grants').filter((g) => { const s = g.subject || {}; return s.type === 'node' && s.id === myNode; }).map((g) => {
    const r = res.get(g.resource_id) || { id: g.resource_id, name: g.resource_id, node: '', eps: [] }, b = binds.find((x) => x.srcRes === g.resource_id && x.tgtNode === myNode);
    return { grant: g.grant_id, resId: r.id, res: r.name, from: names.get(r.node) || r.node || '—', src: '지명', perm: permOf(g.operations), canBind: (g.operations || []).some((o) => o === 'bind.source' || o === 'bind_source'),
      srcEp: (r.eps.find((e) => /source/.test(e.dir)) || r.eps[0] || {}).id || '', bound: b ? b.tgtRes + (b.tgtEp ? '#' + b.tgtEp : '') : '', bindId: b ? b.id : '', qos: b ? b.qos : '' };
  });
}

/** 바인딩 @returns {{ id: string, srcRes: string, srcEp: string, tgtRes: string, tgtEp: string, srcNode: string, tgtNode: string, state: string, reason: string, qos: string }[]} */
export function bindings(d) {
  return arr(d, 'items', 'bindings').map((b) => { const s = b.source || {}, t = b.target || {};
    return { id: b.binding_id, srcRes: s.resource_id || '', srcEp: s.endpoint_id || '', tgtRes: t.resource_id || '', tgtEp: t.endpoint_id || '', srcNode: b.source_node_id || '', tgtNode: b.target_node_id || '',
      state: b.observed_state || b.desired_state || '', reason: b.reason || '', qos: b.qos_profile || '' }; });
}

/** 이 노드의 받는 끝점(sink) — 등록할 때 이어 받을 곳 @returns {{ label: string, resId: string, epId: string }[]} */
export function sinks(resD, myNode) {
  return resources(resD).filter((r) => r.node === myNode).flatMap((r) => r.eps.filter((e) => /sink/.test(e.dir)).map((e) => ({ label: r.name + '#' + e.id, resId: r.id, epId: e.id })));
}

/** 열린 핸들 → 자원 상태 창의 사건 줄(누가 열어 쓰는지) */
export function handleRows(d, resourceId) {
  const p = (n) => String(n).padStart(2, '0'), tm = (iso) => { const x = new Date(iso || ''); return Number.isNaN(x.getTime()) ? '' : p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds()); };
  return arr(d, 'items', 'handles').filter((h) => !resourceId || h.resource_id === resourceId).map((h) => ({ id: h.handle_id, t: tm(h.created_at), lv: /fail|error|closed|expired/.test(h.state || '') ? 'warn' : 'info',
    msg: (h.operation || '?') + (h.endpoint_id ? ' · ' + h.endpoint_id : '') + (h.qos_profile ? ' · ' + h.qos_profile : '') + ' — ' + (h.state || '열림') }));
}

/** 바인딩 만들기 본문(idempotency_key 는 부를 때마다 새로) */
export function bindBody(av, sink, qos) {
  return { source_resource_id: av.resId, source_endpoint_id: av.srcEp, target_resource_id: sink.resId, target_endpoint_id: sink.epId, qos_profile: qos || 'reliable_ordered', idempotency_key: 'gui-v3-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
}
