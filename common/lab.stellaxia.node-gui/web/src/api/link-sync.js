// 연결 상태 맞추기 · 끊기 (MD-29 · MD-30) — 서버의 바인딩 · 허가를 읽어 links[].io 의 상태를 갱신하고, 끊은 연결의 바인딩을 닫는다.
// 설계: docs/data/io-link-svi-binding-design.md §4.2(끊기) · §4.3(상태를 받아 오는 길) · §4.4(상태).
// 권위는 서버다 — io 의 phase 는 마지막으로 본 값의 캐시. 서버가 닿지 않으면(카탈로그에 없음 · 401 · 503) 아무것도 바꾸지 않는다(lost 로 오해하지 않는다).
import { worstPhase } from '../model/link-io.js';
import { reaches } from './client.js';

const T = (op) => 'terra.master.' + op;
export const SYNC_OPS = {
  bindingsGet: T('svi.bindings.get'),
  bindingGet: T('svi.bindings.by-binding-id.get'),
  bindingDelete: T('svi.bindings.by-binding-id.delete'),
  grantsGet: T('svi.grants.get')
};
const arr = (d, ...keys) => { if (Array.isArray(d)) return d; for (const k of keys) if (d && Array.isArray(d[k])) return d[k]; return []; };

/** Master 의 observed_state(RuntimeState) → 연결 상태. 모르는 것은 null(바꾸지 않는다) */
export const OBSERVED_PHASE = { requested: 'binding', validating: 'binding', planning: 'binding', preparing: 'binding', opening: 'binding', closing: 'binding',
  active: 'active', degraded: 'degraded', failed: 'failed', closed: 'closed', denied: 'denied', expired: 'closed' };

const unreachable = (r) => r.kind === 'unauthenticated' || r.kind === 'down' || r.kind === 'unreachable' || r.kind === 'unsupported' || (r.kind === 'error' && !/^(INVALID_REQUEST|SVI_)/.test(r.reason || ''));
const goneCode = (r) => r.status === 404 || /NOT_FOUND$/.test(r.reason || '');

/**
 * 연결들의 상태를 서버에 맞춘다.
 * @param {{ has: (op: string) => boolean, invoke: (op: string, input: any) => Promise<any> }} client
 * @param {any[]} links
 * @param {{ now?: () => number }} [o]
 * @returns {Promise<{ links: any[], changed: boolean, unavailable?: string }>}  바뀐 것이 없으면 같은 배열
 */
export async function syncLinks(client, links, o = {}) {
  const now = o.now || Date.now, L = Array.isArray(links) ? links : [];
  const binds = L.filter((l) => l && l.io && l.io.kind === 'binding' && l.io.pairs.some((p) => p.binding_id));
  const shares = L.filter((l) => l && l.io && l.io.kind === 'share' && l.io.pairs.some((p) => p.grant_id));
  if (!binds.length && !shares.length) return { links: L, changed: false };

  // 바인딩 — 목록 한 번. 목록에 없으면 하나씩 확인한다(관리자 · 다른 사람이 만든 것은 목록에 없을 수 있다) — 404 일 때만 'lost'
  const found = new Map();
  if (binds.length) {
    if (!reaches(client, SYNC_OPS.bindingsGet)) return { links: L, changed: false, unavailable: 'not-in-catalog' };
    const r = await client.invoke(SYNC_OPS.bindingsGet, {});
    if (r.kind === 'ok') arr(r.data, 'items', 'bindings').forEach((b) => { if (b && b.binding_id) found.set(b.binding_id, b); });
    else if (unreachable(r)) return { links: L, changed: false, unavailable: r.kind };
    const want = new Set(binds.flatMap((l) => l.io.pairs.map((p) => p.binding_id).filter(Boolean)));
    for (const id of want) {
      if (found.has(id)) continue;
      const g = reaches(client, SYNC_OPS.bindingGet) ? await client.invoke(SYNC_OPS.bindingGet, { binding_id: id }) : { kind: 'unavailable' };
      if (g.kind === 'ok') found.set(id, (g.data && g.data.binding) || g.data);
      else if (goneCode(g)) found.set(id, null);   // 서버에 없다
      else if (unreachable(g)) return { links: L, changed: false, unavailable: g.kind };
    }
  }
  // 공유 — 자원마다 노드 허가를 읽는다(기한이 지난 것도 보려고 active 를 걸지 않는다)
  const grants = new Map();
  for (const res of new Set(shares.flatMap((l) => l.io.pairs.filter((p) => p.grant_id).map((p) => p.key.split('>')[0].replace(/^share:/, ''))))) {
    if (!reaches(client, SYNC_OPS.grantsGet)) return { links: L, changed: false, unavailable: 'not-in-catalog' };
    const r = await client.invoke(SYNC_OPS.grantsGet, { resource_id: res, subject_type: 'node', limit: 200 });
    if (r.kind === 'ok') grants.set(res, arr(r.data, 'items', 'grants'));
    else if (unreachable(r)) return { links: L, changed: false, unavailable: r.kind };
  }

  let changed = false;
  const next = L.map((l) => {
    if (!l || !l.io || (l.io.kind !== 'binding' && l.io.kind !== 'share')) return l;
    let moved = false, first = null;
    const pairs = l.io.pairs.map((p) => {
      let phase = p.phase, reason = p.reason;
      if (l.io.kind === 'binding' && p.binding_id && found.has(p.binding_id)) {
        const b = found.get(p.binding_id);
        if (!b) { phase = 'lost'; reason = 'binding_not_found'; }
        else {
          phase = OBSERVED_PHASE[b.observed_state] || phase;
          reason = b.reason || (phase === 'active' || phase === 'binding' ? '' : reason);
          if (!first && b.schema_ref) first = b.schema_ref;
        }
      } else if (l.io.kind === 'share' && p.grant_id) {
        const res = p.key.split('>')[0].replace(/^share:/, ''), list = grants.get(res);
        if (list) {
          const g = list.find((x) => x && x.grant_id === p.grant_id);
          if (!g) { phase = 'closed'; reason = 'grant_revoked'; }
          else if (g.expires_at && Date.parse(g.expires_at) <= now()) { phase = 'share-expired'; reason = ''; }
          else { phase = 'shared'; reason = ''; }
        }
      }
      if (phase === p.phase && (reason || '') === (p.reason || '')) return p;
      moved = true;
      const q = Object.assign({}, p, { phase });
      if (reason) q.reason = reason; else delete q.reason;
      return q;
    });
    const sref = first && first !== l.io.schema_ref;
    if (!moved && !sref) return l;
    changed = true;
    const phase = worstPhase(pairs.map((p) => p.phase)), io = Object.assign({}, l.io, { pairs, phase, checked_at: new Date(now()).toISOString() });
    if (sref) io.schema_ref = first;
    const bad = pairs.find((p) => p.reason && (p.phase === phase));
    if (bad) io.reason = bad.reason; else delete io.reason;
    return Object.assign({}, l, { io });
  });
  return changed ? { links: next, changed } : { links: L, changed: false };
}

/**
 * 바인딩을 닫는다 — 이미 없으면(404) 닫힌 것으로 센다. 서버에 닿지 않은 것은 failed(다시 시도할 것).
 * @param {{ has: Function, invoke: Function }} client
 * @param {string[]} ids
 * @returns {Promise<{ closed: string[], failed: Array<{ binding_id: string, code: string }> }>}
 */
export async function closeBindings(client, ids) {
  const closed = [], failed = [];
  for (const id of [...new Set(ids)].filter(Boolean)) {
    if (!reaches(client, SYNC_OPS.bindingDelete)) { failed.push({ binding_id: id, code: 'not-in-catalog' }); continue; }
    const r = await client.invoke(SYNC_OPS.bindingDelete, { binding_id: id });
    if (r.kind === 'ok' || r.kind === 'accepted' || goneCode(r)) closed.push(id);
    else failed.push({ binding_id: id, code: r.reason || r.kind });
  }
  return { closed, failed };
}

/**
 * 끊은 연결들이 들고 있던 바인딩 가운데 **더 이상 어떤 연결도 쓰지 않는 것**(§3.3 참조 수) — 닫을 대상.
 * @param {any[]} removed  사라진 연결
 * @param {any[][]} keepLists  남은 연결 목록들(지금 맵 + 다른 맵들) — 같은 binding_id 를 다른 연결이 쓰면 닫지 않는다
 * @returns {string[]}
 */
export function orphanedBindings(removed, keepLists) {
  const used = new Set();
  (keepLists || []).forEach((ls) => (ls || []).forEach((l) => { if (l && l.io && Array.isArray(l.io.pairs)) l.io.pairs.forEach((p) => { if (p.binding_id) used.add(p.binding_id); }); }));
  const out = [];
  (removed || []).forEach((l) => { if (l && l.io && l.io.kind === 'binding' && Array.isArray(l.io.pairs)) l.io.pairs.forEach((p) => { if (p.binding_id && !used.has(p.binding_id) && out.indexOf(p.binding_id) < 0) out.push(p.binding_id); }); });
  return out;
}

/** 저장본의 orphans — 모양이 어긋난 것은 버린다 */
export function reviveOrphans(x) {
  return (Array.isArray(x) ? x : []).filter((o) => o && typeof o.binding_id === 'string' && o.binding_id).map((o) => ({ binding_id: o.binding_id, code: typeof o.code === 'string' ? o.code : '', at: typeof o.at === 'string' ? o.at : '' }));
}
