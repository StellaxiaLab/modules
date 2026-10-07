// 연결(links)의 입출력 `io` — 맵의 연결을 SVI 바인딩 · 노드 허가로 잇기 위한 데이터 모양과 순수 함수 (MD-27).
// 설계: docs/data/io-link-svi-binding-design.md §2(대응) · §3(쌍 풀기) · §5(모양). 여기에는 서버 호출이 없다 — 적용(bind · 허가)은 MD-28.
//
// 연결 한 줄은 `{ id, from, to, start, path[], road, sel? }`이고 칸 키만 가진다. 여기서 더하는 것은 `io` 하나다.
//   kind 'binding' — 끝 둘이 SVI 자원(또는 노드 + 고른 자원): 쌍마다 바인딩 하나
//   kind 'share'   — 도착이 노드: 노드 주체 허가(바인딩 끝점에는 노드를 두지 않는다 — C-3)
//   kind 'screen'  — 그 밖(SVI 아닌 자원 · 합류만 있는 연결): 화면에만 있다. 예전 저장본도 이렇게 읽는다
// 칸 키 대신 서버 id(resource_id · node_id)를 적어 둬서 칸이 옮겨져도 따라간다. 권위는 늘 서버 답이다 — 여기 `phase`는 마지막으로 본 값의 캐시다.
import { Sha256 } from '../api/sha256.js';

export const IO_VERSION = 1;
export const KINDS = ['binding', 'share', 'screen'];
export const PHASES = ['draft', 'invalid', 'needs-grant', 'binding', 'active', 'degraded', 'failed', 'denied', 'closed', 'lost', 'shared', 'share-expired'];
export const QOS_PROFILES = ['', 'realtime_latest', 'realtime_ordered', 'reliable_ordered', 'bulk_resumable'];
export const SHARE_OPS = ['read', 'subscribe', 'bind.source'];
export const SVI_APP = 'svi';

const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');

// ───── 칸 → 끝 ─────

/**
 * 칸 하나가 연결의 끝으로 무엇인가.
 * @param {LinkCtx} ctx
 * @param {string} key  칸 키
 * @returns {{ t: 'svi', key: string, resource_id: string, node: string, node_id: string }
 *   | { t: 'res', key: string, app: string, id: string, node: string }
 *   | { t: 'node', key: string, name: string, node_id: string }
 *   | { t: 'junction', key: string } | null}
 */
export function endOf(ctx, key) {
  if (!key) return null;
  const r = (ctx.rsrc || {})[key];
  if (r) return r.app === SVI_APP
    ? { t: 'svi', key, resource_id: str(r.id), node: str(r.node), node_id: nodeId(ctx, r.node) }
    : { t: 'res', key, app: str(r.app), id: str(r.id), node: str(r.node) };
  const n = (ctx.nodes || {})[key] || (ctx.self && key === ctx.self ? { name: ctx.map } : null);
  if (n) return { t: 'node', key, name: str(n.name), node_id: nodeId(ctx, n.name) };
  return { t: 'junction', key };   // 자원도 노드도 없는 칸 = 길(합류가 될 수 있다)
}

const nodeId = (ctx, name) => (ctx.nodeIdOf && name ? str(ctx.nodeIdOf(name)) : '');

/** 연결이 지나는 칸 차례 — 화면의 linkCells 와 같다 */
export const cellsOf = (l) => [l.start || l.from].concat(l.path || [], [l.to]).filter(Boolean);

/**
 * 끝 엔드포인트 하나를 고른다 — 방향이 맞는 것이 **하나뿐**이면 그것, 아니면 ''(사람이 고른다 — Q-27).
 * @param {Array<{ id: string, dir?: string }>} eps  ADAPT.svi 항목의 flow.eps
 * @param {'source'|'target'} role  source = 보내는 쪽(source · duplex), target = 받는 쪽(sink · duplex)
 */
export function pickEndpoint(eps, role) {
  const want = role === 'source' ? ['source', 'duplex'] : ['sink', 'duplex'];
  const ok = (Array.isArray(eps) ? eps : []).filter((e) => e && e.id && want.indexOf(e.dir) >= 0);
  return ok.length === 1 ? ok[0].id : '';
}

// ───── 판정 ─────

/**
 * 연결의 종류를 가른다. 서버는 부르지 않는다.
 * @returns {'binding'|'share'|'screen'}
 */
export function classifyLink(link, ctx) {
  const a = endOf(ctx, link && link.from), b = endOf(ctx, link && link.to);
  if (!a || !b) return 'screen';
  if (a.t === 'svi') return b.t === 'svi' || b.t === 'junction' ? 'binding' : b.t === 'node' ? 'share' : 'screen';
  if (a.t === 'node') return b.t === 'svi' ? 'binding' : b.t === 'node' ? 'share' : 'screen';   // 노드 → X 는 고른 자원(sel)마다
  return 'screen';
}

// ───── 쌍 ─────

/** 쌍의 키 — 같은 쌍을 다른 길의 연결이 또 만들어도 바인딩은 하나다 */
export const pairKey = (src, dst) => (src.resource_id || '') + '#' + (src.endpoint_id || '') + '>' + (dst.resource_id || '') + '#' + (dst.endpoint_id || '');
/** 공유 쌍의 키 — 자원 → 노드 허가 */
export const sharePairKey = (resId, nodeId_) => 'share:' + resId + '>node:' + nodeId_;

/** Master 에 두 번 눌러도 하나만 생기게 하는 키 — 쌍의 키에서 만든다(같은 tree · 같은 쌍이면 같은 값) */
export function idempotencyKey(treeId, key) {
  const hex = new Sha256().update(new TextEncoder().encode(String(treeId || '') + '|' + key)).hex();
  return 'gui-link-' + hex.slice(0, 32);
}

const ref = (e, ep) => ({ node_id: e.node_id, resource_id: e.resource_id, endpoint_id: ep || '' });

/** 사람이 고른 엔드포인트의 키 — 같은 자원이 한 연결에서 보내는 쪽과 받는 쪽일 수 있어 역할로 가른다 */
export const epChoiceKey = (role, resourceId) => (role === 'source' ? 'src:' : 'dst:') + resourceId;

/** 한 끝 자원의 엔드포인트 — 사람이 고른 것(io.endpoints)이 먼저, 없으면 ctx.endpointsOf(자원 끝)가 돌려준 목록에서 하나뿐일 때만 */
function epOf(ctx, e, role, chosen) {
  const c = chosen && chosen[epChoiceKey(role, e.resource_id)];
  if (c) return c;
  const eps = ctx.endpointsOf ? ctx.endpointsOf(e) : null;
  return eps ? pickEndpoint(eps, role) : '';
}

/** 엔드포인트 고름을 io 에 적는다 — 새 io 를 돌려준다(원본은 그대로). epId 가 비면 고름을 푼다 */
export function setEndpointChoice(io, role, resourceId, epId) {
  const base = readLinkIO(null, io), endpoints = Object.assign({}, base.endpoints), k = epChoiceKey(role, resourceId);
  if (epId) endpoints[k] = epId; else delete endpoints[k];
  const out = Object.assign({}, io && sanitizeIO(io) ? io : base);
  if (Object.keys(endpoints).length) out.endpoints = endpoints; else delete out.endpoints;
  return out;
}

/**
 * 연결 하나가 만들 쌍들 — 화면에 쓰는 규칙(설계 §3).
 *   자원 → 자원: 쌍 하나. 노드(+고른 자원 sel) → 자원: 고른 SVI 자원마다 하나.
 *   입력 더하기(도착이 합류 칸): 그 합류를 **지나는 다른 연결**의 도착(자원)마다 하나.
 *   출력 더하기(start 가 합류 칸): `from` 이 이미 그 자원이라 쌍 하나다.
 *   자원 → 노드 · 노드 → 노드: 노드 허가(공유) — 쌍 키 `share:…`.
 * @param {any} link
 * @param {any[]} links  이 맵의 모든 연결 — 합류를 풀 때 쓴다

 * @param {LinkCtx} ctx
 * @param {any} [io]  사람이 고른 엔드포인트(io.endpoints)를 읽을 io — 없으면 link.io
 * @returns {Array<{ key: string, kind: 'binding'|'share', source: any, target: any, via_node_id?: string }>}
 */
export function pairsOf(link, links, ctx, io) {
  const kind = classifyLink(link, ctx), chosen = readLinkIO(link, io).endpoints;
  if (kind === 'screen') return [];
  const a = endOf(ctx, link.from), b = endOf(ctx, link.to), out = [];
  // 출발 자원들 — 노드면 고른 자원(sel '노드|앱|id' 중 SVI 인 것)
  const sources = a.t === 'svi' ? [a] : (link.sel || []).map((s) => selEnd(ctx, s)).filter(Boolean);
  if (kind === 'share') {
    if (b.t !== 'node') return [];
    sources.forEach((s) => out.push({ key: sharePairKey(s.resource_id, b.node_id), kind: 'share', source: ref(s, ''), target: { node_id: b.node_id },
      via_node_id: a.t === 'node' ? a.node_id : undefined }));
    return out;
  }
  // binding — 도착 자원들
  let sinks = [];
  if (b.t === 'svi') sinks = [b];
  else if (b.t === 'junction') {
    (links || []).forEach((o) => {
      if (!o || o === link || o.id === link.id || o.to === b.key || cellsOf(o).indexOf(b.key) < 0) return;   // 입력 더하기끼리는 서로의 도착이 아니다
      const e = endOf(ctx, o.to); if (e && e.t === 'svi') sinks.push(e);
    });
  }
  sources.forEach((s) => sinks.forEach((t) => {
    if (s.resource_id === t.resource_id) return;   // 자기 자신으로는 잇지 않는다
    const sp = epOf(ctx, s, 'source', chosen), tp = epOf(ctx, t, 'target', chosen);
    out.push({ key: pairKey({ resource_id: s.resource_id, endpoint_id: sp }, { resource_id: t.resource_id, endpoint_id: tp }), kind: 'binding', source: ref(s, sp), target: ref(t, tp) });
  }));
  return out.filter((p, i) => out.findIndex((q) => q.key === p.key) === i);
}

/** links.sel 의 '노드|앱|id' → 끝(SVI 자원만 — 모니터링 자원은 바인딩 · 허가로 바꿀 수 없다) */
function selEnd(ctx, s) {
  const k = s && typeof s.key === 'string' ? s.key.split('|') : [];
  if (k.length < 3 || k[1] !== SVI_APP) return null;
  const node = k[0];
  return { t: 'svi', key: '', resource_id: k.slice(2).join('|'), node, node_id: nodeId(ctx, node) };
}

/** 같은 쌍을 몇 연결이 쓰는가 — 키 → 연결 id 목록. 끊을 때 0이 되는 쌍만 바인딩을 닫는다(MD-30) */
export function pairRefs(links, ctx) {
  const m = new Map();
  (links || []).forEach((l) => pairsOf(l, links, ctx).forEach((p) => { (m.get(p.key) || m.set(p.key, []).get(p.key)).push(l.id); }));
  return m;
}

// ───── io 만들기 · 읽기 ─────

/**
 * 연결의 `io` 를 만든다 — 판정 · 끝점 · 쌍. 이미 있는 값(사람이 고른 QoS · 서버가 준 binding_id · 상태)은 같은 쌍 키에서 이어받는다.
 * @param {any} link
 * @param {any[]} links
 * @param {LinkCtx} ctx
 * @param {any} [prev]  지금 있는 io — 있으면 그 설정을 지킨다
 */
export function buildIO(link, links, ctx, prev) {
  const kind = classifyLink(link, ctx), keep = readLinkIO(link, prev);
  const base = { v: IO_VERSION, kind, qos_profile: keep.qos_profile, compatibility_policy: keep.compatibility_policy, direction: 'forward', pairs: [] };
  if (kind === 'screen') return base;
  const ps = pairsOf(link, links, ctx, keep), old = new Map(keep.pairs.map((p) => [p.key, p]));
  base.pairs = ps.map((p) => {
    const o = old.get(p.key);
    const pr = { key: p.key, phase: o && PHASES.indexOf(o.phase) >= 0 ? o.phase : 'draft' };
    if (p.kind === 'binding') pr.idempotency_key = idempotencyKey(ctx.treeId, p.key);
    ['binding_id', 'grant_id', 'reason'].forEach((f) => { if (o && typeof o[f] === 'string' && o[f]) pr[f] = o[f]; });
    return pr;
  });
  const first = ps[0], a = endOf(ctx, link.from), b = endOf(ctx, link.to);
  if (first) { base.source = first.source; base.target = first.target; }
  else if (kind === 'share' && b && b.t === 'node') base.target = { node_id: b.node_id };
  if (kind === 'share') {
    base.share_ops = keep.share_ops && keep.share_ops.length ? keep.share_ops : SHARE_OPS.slice();
    base.share_ttl_seconds = Number.isFinite(keep.share_ttl_seconds) && keep.share_ttl_seconds >= 0 ? keep.share_ttl_seconds : 0;
    if (a && a.t === 'node' && a.node_id) base.via_node_id = a.node_id;
  }
  // 연결 전체의 상태 — 쌍들 중 가장 나쁜 것(마지막으로 본 값)
  if (keep.endpoints) base.endpoints = keep.endpoints;
  base.phase = worstPhase(base.pairs.map((p) => p.phase));
  ['reason', 'code', 'checked_at', 'schema_ref', 'encoding'].forEach((f) => { if (keep[f] !== undefined && keep[f] !== '') base[f] = keep[f]; });
  return base;
}

/** 쌍들의 상태 → 연결 전체. 나쁜 쪽이 이긴다 */
const ORDER = ['denied', 'invalid', 'failed', 'lost', 'closed', 'share-expired', 'needs-grant', 'degraded', 'binding', 'draft', 'shared', 'active'];
export function worstPhase(phases) {
  const ps = (phases || []).filter((p) => PHASES.indexOf(p) >= 0);
  if (!ps.length) return 'draft';
  return ps.slice().sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y))[0];
}

/** 연결 하나의 io 를 **바꾸지 않고** 읽는다 — 없거나 모양이 어긋나면 화면 전용으로 */
export function readLinkIO(link, io0) {
  const io = sanitizeIO(io0 !== undefined ? io0 : link && link.io);
  return io || { v: IO_VERSION, kind: 'screen', qos_profile: '', compatibility_policy: 'exact', direction: 'forward', pairs: [] };
}

/**
 * 저장본에서 온 io 를 다듬는다 — 다른 기기 · 다른 판의 사용자 문서가 모양이 어긋나도 화면이 멈추지 않게.
 * 못 읽는 것(다른 판 · 모르는 종류)은 null — 그 연결은 화면 전용으로 읽힌다.
 */
export function sanitizeIO(io) {
  if (!obj(io) || io.v !== IO_VERSION || KINDS.indexOf(io.kind) < 0) return null;
  const out = { v: IO_VERSION, kind: io.kind, qos_profile: QOS_PROFILES.indexOf(io.qos_profile) >= 0 ? io.qos_profile : '',
    compatibility_policy: str(io.compatibility_policy) || 'exact', direction: 'forward',
    pairs: (Array.isArray(io.pairs) ? io.pairs : []).filter((p) => obj(p) && typeof p.key === 'string' && p.key).map((p) => {
      const o = { key: p.key, phase: PHASES.indexOf(p.phase) >= 0 ? p.phase : 'draft' };
      ['binding_id', 'grant_id', 'idempotency_key', 'reason'].forEach((f) => { if (typeof p[f] === 'string' && p[f]) o[f] = p[f]; });
      return o;
    }) };
  if (io.kind === 'screen') return out;
  ['source', 'target'].forEach((f) => { if (obj(io[f])) out[f] = ['node_id', 'resource_id', 'endpoint_id'].reduce((o, k) => (typeof io[f][k] === 'string' ? Object.assign(o, { [k]: io[f][k] }) : o), {}); });
  out.phase = PHASES.indexOf(io.phase) >= 0 ? io.phase : 'draft';
  ['reason', 'code', 'checked_at', 'schema_ref', 'encoding', 'via_node_id'].forEach((f) => { if (typeof io[f] === 'string' && io[f]) out[f] = io[f]; });
  if (io.kind === 'share') {
    out.share_ops = (Array.isArray(io.share_ops) ? io.share_ops : []).filter((o) => SHARE_OPS.indexOf(o) >= 0);
    if (Number.isFinite(io.share_ttl_seconds) && io.share_ttl_seconds >= 0) out.share_ttl_seconds = Math.floor(io.share_ttl_seconds);
  }
  if (obj(io.endpoints)) {
    const e = {};
    Object.keys(io.endpoints).forEach((k) => { if (/^(src|dst):./.test(k) && typeof io.endpoints[k] === 'string' && io.endpoints[k]) e[k] = io.endpoints[k]; });
    if (Object.keys(e).length) out.endpoints = e;
  }
  if (Array.isArray(io.grant_ids)) out.grant_ids = io.grant_ids.filter((g) => typeof g === 'string' && g);
  return out;
}

/** 저장본의 연결 목록을 다듬는다 — io 가 어긋난 연결은 io 를 떼고(화면 전용으로 읽힌다) 나머지는 그대로 둔다 */
export function reviveLinks(links) {
  return (Array.isArray(links) ? links : []).map((l) => {
    if (!obj(l) || !('io' in l)) return l;
    const io = sanitizeIO(l.io), c = Object.assign({}, l);
    if (io) c.io = io; else delete c.io;
    return c;
  });
}

/**
 * 맵의 모든 연결에 io 를 (다시) 만든다 — 연결을 더하거나 고른 자원이 바뀐 뒤. 판정 · 끝점 · 쌍을 새로 풀고 사람이 고른 설정과 서버 id 는 지킨다.
 * 바뀐 것이 없으면 같은 배열을 돌려준다(저장을 괜히 일으키지 않는다).
 * @param {any[]} links
 * @param {LinkCtx} ctx
 * @param {(l: any) => boolean} [only]  이 연결만 — 나머지는 합류 풀이용으로만 본다
 */
export function rebuildLinks(links, ctx, only) {
  const L = Array.isArray(links) ? links : [];
  let changed = false;
  const next = L.map((l) => {
    if (!obj(l) || (only && !only(l))) return l;
    const io = buildIO(l, L, ctx, l.io);
    if (obj(l.io) && JSON.stringify(l.io) === JSON.stringify(io)) return l;
    changed = true;
    return Object.assign({}, l, { io });
  });
  return changed ? next : links;
}

/**
 * @typedef {Object} LinkCtx 칸 → 끝을 풀 때 필요한 화면 상태
 * @property {Record<string, any>} rsrc  칸 → 설치한 자원 `{ app, id, node, … }`
 * @property {Record<string, any>} nodes  칸 → 노드 `{ name }`
 * @property {string|null} [self]  leaf 맵의 자기 칸
 * @property {string} [map]  지금 맵의 주인 노드 이름(자기 칸의 이름)
 * @property {(name: string) => string|null} [nodeIdOf]  노드 이름 → node_id
 * @property {(end: { resource_id: string, node: string }) => Array<{ id: string, dir?: string }>|null} [endpointsOf]  SVI 자원의 엔드포인트
 * @property {string} [treeId]  멱등 키에 섞는 tree 구분
 */

/**
 * 화면 객체(node.js)에서 LinkCtx 를 만든다 — 화면의 상태 · 관계도(NET) · 조타륜 앱 목록(hbItems)만 읽는다.
 * 엔드포인트는 ADAPT.svi 항목의 flow.eps — 앱 토큰으로 SVI 가 닿지 않으면(PF-1) 목록이 비어 엔드포인트를 모르는 채('')로 남는다.
 */
export function screenLinkCtx(screen) {
  const S = screen.state || {}, NET = screen.NET || {};
  return {
    rsrc: S.rsrc || {}, nodes: S.nodes || {}, self: S.self || null, map: S.map,
    treeId: S.curTree && S.curTree.name ? String(S.curTree.name) : '',
    nodeIdOf: (name) => (NET[name] && NET[name].id) || null,
    endpointsOf: (e) => {
      const items = screen.hbItems ? screen.hbItems(e.node, SVI_APP) : null;
      const it = Array.isArray(items) ? items.find((x) => x && x.id === e.resource_id) : null;
      return it && it.flow && Array.isArray(it.flow.eps) ? it.flow.eps : null;
    }
  };
}
