// 연결 적용 — 맵의 연결(links[].io)을 SVI 바인딩 · 노드 허가로 만든다 (MD-28).
// 설계: docs/data/io-link-svi-binding-design.md §4.1(시퀀스) · §4.4(상태) · §5.4(오류 상태).
//
// 순서: 엔드포인트 다시 읽기 → 미리 검사(안내일 뿐 — 판정은 Master) → 내 허가 확인 → svi.bindings.post.
//        공유(자원 → 노드)는 svi.grants.post {subject_type: node}.
// 전제: PF-1 — Master op 가 이 화면의 자격으로 닿는다(사용자 신원). 닿지 않으면(카탈로그에 없다 · 401) 아무것도 바꾸지 않고 이유만 돌려준다.
// 서버는 `client.invoke` 로 직접 부른다 — Master 의 POST 본문은 모르는 키를 거절한다(decodeJSON). node_id 를 싣지 않는다(UP-13).
import { buildIO, pairsOf, worstPhase, idempotencyKey, setEndpointChoice } from '../model/link-io.js';

const T = (op) => 'terra.master.' + op;
export const OPS = {
  endpoints: T('svi.resources.by-resource-id.endpoints.get'),
  grantsGet: T('svi.grants.get'),
  grantsPost: T('svi.grants.post'),
  bindPost: T('svi.bindings.post')
};

const arr = (d, ...keys) => { if (Array.isArray(d)) return d; for (const k of keys) if (d && Array.isArray(d[k])) return d[k]; return []; };

// ───── 미리 검사 (순수) ─────

const SCHEMA = /^terra\.([a-z0-9]+(?:[.-][a-z0-9]+)*)@([1-9][0-9]*)$/;   // core/schema_ref.go
const BAD_STATUS = /^(unavailable|disabled|unsupported)$/;
const QOS_ORDER = ['reliable_ordered', 'realtime_ordered', 'realtime_latest'];

/**
 * Master 가 거절할 것을 앞서 알려 준다 — 안내일 뿐이고 최종 판정은 Master 다(`binding_service.go` authorizeAndPlan).
 * 확실히 어긋난 것만 막는다 — 엔드포인트가 말하지 않은 것(operations · schema · qos_profiles 가 비어 있음)은 막지 않는다.
 * @param {any} src  source 엔드포인트(EndpointDescriptor) — 없으면 못 찾음
 * @param {any} dst  target 엔드포인트
 * @param {{ qos_profile?: string, compatibility_policy?: string }} [o]
 * @returns {{ ok: true } | { ok: false, step: string, reason: string }}
 */
export function precheck(src, dst, o = {}) {
  const no = (step, reason) => ({ ok: false, step, reason });
  if (!src) return no('endpoint', 'source_endpoint_not_found');
  if (!dst) return no('endpoint', 'target_endpoint_not_found');
  if (BAD_STATUS.test(String(src.status || ''))) return no('status', 'source_' + src.status);
  if (BAD_STATUS.test(String(dst.status || ''))) return no('status', 'target_' + dst.status);
  if (src.direction && src.direction !== 'source' && src.direction !== 'duplex') return no('direction', 'source_direction_' + src.direction);
  if (dst.direction && dst.direction !== 'sink' && dst.direction !== 'duplex') return no('direction', 'target_direction_' + dst.direction);
  if (Array.isArray(src.operations) && src.operations.length && src.operations.indexOf('bind.source') < 0) return no('operation', 'source_missing_bind.source');
  if (Array.isArray(dst.operations) && dst.operations.length && dst.operations.indexOf('bind.target') < 0) return no('operation', 'target_missing_bind.target');
  // 형식 — exact 정책에서 두 끝이 다 말했는데 다르면
  const policy = o.compatibility_policy || 'exact';
  if (policy === 'exact' && src.output_schema && dst.input_schema && src.output_schema !== dst.input_schema) {
    const a = SCHEMA.exec(src.output_schema), b = SCHEMA.exec(dst.input_schema);
    return no('schema', a && b && a[1] === b[1] ? 'schema_major_mismatch: ' + src.output_schema + ' → ' + dst.input_schema : 'schema_incompatible: ' + src.output_schema + ' → ' + dst.input_schema);
  }
  // QoS — 고른 것이 있으면 두 끝이 다 내야 하고, 비어 있으면 두 끝이 함께 내는 프로필이 있어야 한다(resolveQoSProfile)
  const offers = (e, p) => !Array.isArray(e.qos_profiles) || !e.qos_profiles.length || e.qos_profiles.indexOf(p) >= 0;
  const q = o.qos_profile || '';
  if (q) {
    if (q === 'reliable_ordered' && !src.resumable) return no('qos', 'source_not_resumable_for_' + q);
    if (!offers(src, q)) return no('qos', 'source_qos_unsupported');
    if (!offers(dst, q)) return no('qos', 'target_qos_unsupported');
  } else if (!QOS_ORDER.some((p) => (p !== 'reliable_ordered' || src.resumable) && offers(src, p) && offers(dst, p))) return no('qos', 'no_common_qos_profile');
  return { ok: true };
}

/** 내 허가(user 주체) 가운데 이 끝점 · 이 operation 을 덮는 살아 있는 것이 있나 — Master `grantsSatisfied` · `Grant.Allows` 와 같은 규칙 */
export function grantCovers(grants, userId, resourceId, endpointId, op, now = Date.now()) {
  return arr(grants, 'items', 'grants').some((g) => {
    const s = g && g.subject || {};
    if (!g || g.resource_id !== resourceId || s.type !== 'user' || s.id !== userId) return false;
    if (g.expires_at && Date.parse(g.expires_at) <= now) return false;
    if (g.endpoint_id && g.endpoint_id !== endpointId) return false;
    return Array.isArray(g.operations) && g.operations.indexOf(op) >= 0;
  });
}

/** 바인딩 거절 글 — Master 는 `SVI binding was denied: <reason>`로 답한다. 이유(자유 글자)만 꺼낸다 */
export function deniedReason(data) {
  const m = data && data.error && typeof data.error === 'object' ? String(data.error.message || '') : '';
  const i = m.indexOf('denied:');
  return (i >= 0 ? m.slice(i + 'denied:'.length) : m).trim();
}

// ───── 적용 ─────

const phaseOf = (io, key, phase, extra) => {
  const pairs = io.pairs.map((p) => (p.key === key ? Object.assign({}, p, { phase }, extra || {}) : p));
  return Object.assign({}, io, { pairs, phase: worstPhase(pairs.map((p) => p.phase)) });
};

/**
 * 연결 하나를 적용한다. 부르는 호출은 위 OPS 뿐이다. 이미 바인딩이 있는 쌍(binding_id)은 다시 만들지 않는다(멱등 키도 같다).
 * @param {{ client: any }} source  LiveSource — `client.invoke` · `client.has` 만 쓴다
 * @param {any} link
 * @param {any[]} links  이 맵의 모든 연결(합류를 풀 때)
 * @param {import('../model/link-io.js').LinkCtx} ctx
 * @param {{ userId: string, now?: () => number }} o  userId — 내 신원(whoami principal). 허가 검사는 이 사람의 user 주체 허가만 본다
 * @returns {Promise<{ io: any, applied: number, unavailable?: string, notes: string[] }>}
 *   unavailable — 서버에 닿지 않아 아무것도 바꾸지 않았다(이유 코드) · notes — 쌍마다 한 줄(화면 글줄용)
 */
export async function applyLink(source, link, links, ctx, o) {
  const client = source.client, now = o.now || Date.now, notes = [];
  let io = buildIO(link, links, ctx, link.io);
  if (io.kind === 'screen') return { io, applied: 0, notes: ['화면 전용 연결이다 — 데이터는 흐르지 않는다'] };
  const need = io.kind === 'share' ? [OPS.grantsPost, OPS.grantsGet] : [OPS.bindPost, OPS.grantsGet, OPS.endpoints];
  const missing = need.find((op) => !client.has(op));
  if (missing) return { io, applied: 0, unavailable: 'not-in-catalog', notes: ['이 노드의 게이트웨이에 ' + missing.replace('terra.master.', '') + ' 가 없다 — Master 위임(PF-1)'] };
  if (!o.userId) return { io, applied: 0, unavailable: 'no-user', notes: ['내 신원을 모른다 — 다시 로그인'] };

  const stamp = () => new Date(now()).toISOString();
  const fail = (r) => ({ kind: r.kind, code: r.reason || '' });
  // 서버가 닿지 않으면(401 · 503 · 오류) 거기서 멈춘다 — 상태는 그대로
  const down = (r) => r.kind === 'unauthenticated' || r.kind === 'down' || r.kind === 'unreachable' || (r.kind === 'error' && !/^(INVALID_REQUEST|SVI_)/.test(r.reason || ''));
  const stop = (r) => ({ io: Object.assign({}, io, { code: fail(r).code, checked_at: stamp() }), applied: 0, unavailable: r.kind, notes: ['서버가 답하지 않았다 — ' + r.kind + (r.reason ? ' · ' + r.reason : '')] });

  if (io.kind === 'share') return applyShare(client, link, links, ctx, io, o, { stamp, stop, down, notes });

  // 1) 엔드포인트 다시 읽기 — 자원마다 한 번
  const eps = new Map();
  const resIds = [...new Set(pairsOf(link, links, ctx, io).flatMap((p) => [p.source.resource_id, p.target.resource_id]))];
  for (const id of resIds) {
    const r = await client.invoke(OPS.endpoints, { resource_id: id });
    if (r.kind !== 'ok') {
      if (down(r)) return stop(r);
      eps.set(id, null);   // 404 SVI_RESOURCE_NOT_FOUND 등 — 그 자원은 못 본다(내 것이 아니다 · 사라졌다)
      continue;
    }
    eps.set(id, arr(r.data, 'items', 'endpoints'));
  }
  const ctx2 = Object.assign({}, ctx, { endpointsOf: (e) => (eps.get(e.resource_id) || []).map((x) => ({ id: x.endpoint_id, dir: x.direction })) });
  const pairs = pairsOf(link, links, ctx2, io);
  // 하나뿐이라 자동으로 고른 엔드포인트도 io 에 적어 둔다 — 쌍의 키가 안 흔들려야 다음에 같은 쌍의 binding_id · 상태를 찾는다
  pairs.forEach((p) => {
    if (p.source.endpoint_id) io = setEndpointChoice(io, 'source', p.source.resource_id, p.source.endpoint_id);
    if (p.target.endpoint_id) io = setEndpointChoice(io, 'target', p.target.resource_id, p.target.endpoint_id);
  });
  io = Object.assign({}, io, { pairs: pairs.map((p) => io.pairs.find((q) => q.key === p.key) || { key: p.key, phase: 'draft' }) });
  const epOf = (resId, epId) => (eps.get(resId) || []).find((x) => x.endpoint_id === epId) || null;
  const grantsOf = new Map();
  const myGrants = async (resId) => {
    if (!grantsOf.has(resId)) grantsOf.set(resId, await client.invoke(OPS.grantsGet, { resource_id: resId, subject_type: 'user', subject_id: o.userId, active: true, limit: 200 }));
    return grantsOf.get(resId);
  };

  let applied = 0;
  for (const p of pairs) {
    const key = p.key, cur = io.pairs.find((q) => q.key === key);
    if (cur && cur.binding_id && cur.phase !== 'lost' && cur.phase !== 'closed' && cur.phase !== 'denied' && cur.phase !== 'invalid') { notes.push(label(p) + ' — 이미 바인딩이 있다'); continue; }
    const s = p.source, t = p.target;
    // 자원을 못 본다 — 내 것이 아니거나 사라졌다. 관리자가 아니면 남의 자원과는 허가를 받아도 못 잇는다(Master 도 같은 이유로 거절한다 — 설계 §9 실행 확인)
    if (eps.get(s.resource_id) === null || eps.get(t.resource_id) === null) {
      const reason = (eps.get(s.resource_id) === null ? 'source' : 'target') + '_resource_not_found';
      io = phaseOf(io, key, 'invalid', { reason }); notes.push(label(p) + ' — ' + reason); continue;
    }
    // 엔드포인트를 정하지 못했다 — 사람이 고른다(Q-27)
    if (!s.endpoint_id || !t.endpoint_id) {
      io = phaseOf(io, key, 'invalid', { reason: 'endpoint_not_chosen: ' + (!s.endpoint_id ? s.resource_id + '(보내는 쪽)' : t.resource_id + '(받는 쪽)') });
      notes.push(label(p) + ' — 엔드포인트를 고른다'); continue;
    }
    // 2) 미리 검사
    const chk = precheck(epOf(s.resource_id, s.endpoint_id), epOf(t.resource_id, t.endpoint_id), io);
    if (!chk.ok) { io = phaseOf(io, key, 'invalid', { reason: chk.reason }); notes.push(label(p) + ' — ' + chk.reason); continue; }
    // 3) 내 허가 — 없으면 bind 를 부르지 않는다(Master 도 missing_bind_grant 로 거절한다)
    const gs = await myGrants(s.resource_id), gt = await myGrants(t.resource_id);
    const bad = [gs, gt].find((g) => g.kind !== 'ok');
    if (bad) { if (down(bad)) return stop(bad); io = phaseOf(io, key, 'needs-grant', { reason: 'grants_unreadable: ' + (bad.reason || bad.kind) }); notes.push(label(p) + ' — 허가를 읽지 못했다'); continue; }
    const lacks = [];
    if (!grantCovers(gs.data, o.userId, s.resource_id, s.endpoint_id, 'bind.source', now())) lacks.push({ resource_id: s.resource_id, endpoint_id: s.endpoint_id, operation: 'bind.source' });
    if (!grantCovers(gt.data, o.userId, t.resource_id, t.endpoint_id, 'bind.target', now())) lacks.push({ resource_id: t.resource_id, endpoint_id: t.endpoint_id, operation: 'bind.target' });
    if (lacks.length) {
      io = phaseOf(io, key, 'needs-grant', { reason: 'missing_bind_grant: ' + lacks.map((l) => l.resource_id + ' ' + l.operation).join(', ') });
      notes.push(label(p) + ' — 허가가 필요하다 (' + lacks.map((l) => l.operation).join(' · ') + ')'); continue;
    }
    // 4) bind
    const body = { source_resource_id: s.resource_id, source_endpoint_id: s.endpoint_id, target_resource_id: t.resource_id, target_endpoint_id: t.endpoint_id,
      compatibility_policy: io.compatibility_policy || 'exact', qos_profile: io.qos_profile || '', idempotency_key: idempotencyKey(ctx.treeId, key) };
    const r = await client.invoke(OPS.bindPost, body);
    if (r.kind === 'ok' || r.kind === 'accepted') {
      const id = r.data && (r.data.binding_id || (r.data.binding && r.data.binding.binding_id));
      io = phaseOf(io, key, 'binding', Object.assign({ idempotency_key: body.idempotency_key }, id ? { binding_id: id } : {}));
      applied++; notes.push(label(p) + ' — 연결 중');
    } else if (r.kind === 'forbidden' && r.reason === 'SVI_BINDING_DENIED') {
      const why = deniedReason(r.data);
      io = Object.assign(phaseOf(io, key, 'denied', { reason: why }), { code: 'SVI_BINDING_DENIED' });
      notes.push(label(p) + ' — 거절: ' + why);
    } else if (r.kind === 'forbidden') {
      io = Object.assign(phaseOf(io, key, 'denied', { reason: r.reason || 'forbidden' }), { code: r.reason || 'FORBIDDEN' });
      notes.push(label(p) + ' — 권한 없음');
    } else if (r.reason === 'INVALID_REQUEST') {
      io = Object.assign(phaseOf(io, key, 'invalid', { reason: 'INVALID_REQUEST' }), { code: 'INVALID_REQUEST' });
      notes.push(label(p) + ' — 요청이 맞지 않는다');
    } else return stop(r);   // 503 · 401 · 알 수 없는 오류 — 이 쌍의 상태는 그대로
  }
  const first = pairs[0];
  if (first) io = Object.assign({}, io, { source: first.source, target: first.target });
  return { io: Object.assign({}, io, { checked_at: stamp() }), applied, notes };
}

const label = (p) => p.source.resource_id + ' → ' + (p.target.resource_id || p.target.node_id);

/** 공유 — 자원 → 노드: 노드 주체 허가(C-3 흐름 허용 목록). 같은 (자원, 노드)의 살아 있는 허가가 이미 있으면 그것을 쓴다 */
async function applyShare(client, link, links, ctx, io0, o, h) {
  let io = io0, applied = 0;
  const pairs = pairsOf(link, links, ctx, io);
  for (const p of pairs) {
    const nodeId = p.target.node_id, res = p.source.resource_id;
    if (!nodeId) { io = phaseOf(io, p.key, 'invalid', { reason: 'no_node_id: 그 노드의 node_id 를 모른다' }); h.notes.push(label(p) + ' — 노드 id 를 모른다'); continue; }
    const have = await client.invoke(OPS.grantsGet, { resource_id: res, subject_type: 'node', subject_id: nodeId, active: true, limit: 200 });
    if (have.kind !== 'ok') { if (h.down(have)) return h.stop(have); io = phaseOf(io, p.key, 'invalid', { reason: 'grants_unreadable: ' + (have.reason || have.kind) }); continue; }
    const live = arr(have.data, 'items', 'grants').find((g) => g && g.resource_id === res && g.subject && g.subject.type === 'node' && g.subject.id === nodeId && (!g.expires_at || Date.parse(g.expires_at) > (o.now || Date.now)()));
    if (live) { io = phaseOf(io, p.key, 'shared', { grant_id: live.grant_id }); h.notes.push(label(p) + ' — 이미 공유 중'); continue; }
    const ops = io.share_ops && io.share_ops.length ? io.share_ops : ['read', 'subscribe', 'bind.source'];
    const body = { subject_type: 'node', subject_id: nodeId, resource_id: res, operations: ops, ttl_seconds: io.share_ttl_seconds || 0 };
    if (p.via_node_id) body.via_node_id = p.via_node_id;
    const r = await client.invoke(OPS.grantsPost, body);
    if (r.kind === 'ok' || r.kind === 'accepted') {
      const g = r.data && (r.data.grant || r.data);
      io = phaseOf(io, p.key, 'shared', g && g.grant_id ? { grant_id: g.grant_id } : {});
      applied++; h.notes.push(label(p) + ' — 공유함');
    } else if (r.kind === 'forbidden' || r.reason === 'SVI_RESOURCE_NOT_FOUND') {
      io = Object.assign(phaseOf(io, p.key, 'denied', { reason: r.reason || 'forbidden' }), { code: r.reason || 'FORBIDDEN' });
      h.notes.push(label(p) + ' — 공유할 수 없다 (내 자원이 아니거나 권한이 없다)');
    } else if (r.reason === 'INVALID_REQUEST') {
      io = Object.assign(phaseOf(io, p.key, 'invalid', { reason: 'INVALID_REQUEST' }), { code: 'INVALID_REQUEST' });
    } else return h.stop(r);
  }
  return { io: Object.assign({}, io, { checked_at: h.stamp() }), applied, notes: h.notes };
}

/**
 * [나에게 허가 주기] — 연결이 막힌 쌍의 bind.source · bind.target 을 내 user 주체에게 준다(소유자만 만들 수 있다 — node.control · 자원 소유).
 * 사람이 눌렀을 때만 부른다(Q-22). 끝점 하나 · operation 하나씩, 기한은 ttlSeconds(0 = 없음 — Q-23).
 * @returns {Promise<{ ok: boolean, made: string[], failed: Array<{ resource_id: string, operation: string, code: string }> }>}
 */
export async function grantSelf(client, lacks, userId, ttlSeconds = 0) {
  const made = [], failed = [];
  if (!client.has(OPS.grantsPost)) return { ok: false, made, failed: lacks.map((l) => ({ resource_id: l.resource_id, operation: l.operation, code: 'not-in-catalog' })) };
  for (const l of lacks) {
    const r = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: l.resource_id, endpoint_id: l.endpoint_id, operations: [l.operation], ttl_seconds: ttlSeconds });
    if (r.kind === 'ok' || r.kind === 'accepted') made.push(l.resource_id + ' ' + l.operation);
    else failed.push({ resource_id: l.resource_id, operation: l.operation, code: r.reason || r.kind });
  }
  return { ok: failed.length === 0, made, failed };
}

/** 막힌 쌍의 `needs-grant` 이유(`missing_bind_grant: res op, res op`)에서 만들어야 할 허가를 꺼낸다 — 끝점은 쌍 키에서 */
export function lacksOf(pair) {
  const m = /^missing_bind_grant: (.+)$/.exec(pair && pair.reason || '');
  const k = /^(.*)#(.*)>(.*)#(.*)$/.exec(pair && pair.key || '');
  if (!m || !k) return [];
  return m[1].split(', ').map((x) => {
    const [res, op] = x.split(' ');
    return { resource_id: res, operation: op, endpoint_id: op === 'bind.source' ? k[2] : k[4] };
  }).filter((l) => l.resource_id && l.operation);
}
