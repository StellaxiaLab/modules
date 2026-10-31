// 실제 노드 지도 — Master 노드 목록(terra.master.nodes.get)을 씬이 읽는 꼴(window.TerraTopology)로.
//
// 씬(보드 Scene)은 트리를 중첩 배열(spec)로 놓고 항성계를 그린다. 시안은 고정 예시(SPECS · 트리마다 행성 6개)였고,
// TerraTopology 가 있으면 그것으로 그린다:
//   트리 = 다른 노드의 부모이거나 roles 에 tree 가 든 노드. 트리끼리 parent_node_id 로 잇는다 — 부모가 목록에 없으면 맨 위
//   리프 = 나머지. 그 부모(parent_node_id) 트리의 행성 — 트리마다 12 개까지(항성계 배치가 받는 만큼, 넘는 것은 개수로만)
//   부모가 목록에 없는 리프 — 그 부모 id 로 이름 없는 트리를 하나 세운다(이 Master 자신일 때가 많다)
//   localId — 이 GUI 를 띄운 노드(로컬 daemon status 의 node_id). 씬의 '로컬'
// 경로 = 1 부터 센 자식 번호들 — [1] 맨 위 첫 트리 · [1, 2] 그 트리의 둘째 자식 트리.

export const MAX_LEAVES = 12;
const clean = (s) => String(s || '').replace(/\//g, '∕').trim();   // 경로 구분자와 겹치지 않게

/**
 * @param {Array<{ node_id: string, display_name?: string, parent_node_id?: string, roles?: string[], depth?: number }>} nodes
 * @param {{ localId?: string, rev?: string|number }} [o]
 */
export function buildTopology(nodes, o = {}) {
  const byId = new Map(), kids = new Map();
  for (const n of nodes || []) if (n && n.node_id) byId.set(n.node_id, n);
  const parentOf = (n) => n.parent_node_id || '';
  for (const n of byId.values()) { const p = parentOf(n); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); } }
  // 목록에 없는 부모 — 이름 없는 트리로 세운다
  for (const p of kids.keys()) if (!byId.has(p)) byId.set(p, { node_id: p, display_name: '', roles: ['tree'], synthetic: true });
  const isTree = (n) => (n.roles || []).some((r) => /tree|master/i.test(r)) || kids.has(n.node_id);
  const trees = [...byId.values()].filter(isTree), byName = (a, b) => String(a.display_name || a.node_id).localeCompare(String(b.display_name || b.node_id));
  const top = trees.filter((t) => !byId.has(parentOf(t)) || !isTree(byId.get(parentOf(t)))).sort(byName);
  const P = new Map();   // 경로 키 → { tree, leaves }
  const walk = (t, path) => {
    const sub = (kids.get(t.node_id) || []).filter(isTree).sort(byName);
    const lv = (kids.get(t.node_id) || []).filter((n) => !isTree(n)).sort(byName);
    P.set(path.join('.'), { tree: t, leaves: lv, more: Math.max(0, lv.length - MAX_LEAVES) });
    return sub.map((c, i) => walk(c, path.concat(i + 1)));
  };
  const spec = top.map((t, i) => walk(t, [i + 1]));
  const at = (path) => P.get(path.join('.'));
  return {
    rev: String(o.rev ?? Date.now()), localId: o.localId || '', spec, count: byId.size,
    label(path) { const e = at(path); if (!e) return ''; const t = e.tree; return clean(t.display_name) || (t.synthetic ? 'Tree' : t.node_id.slice(0, 10)); },
    rid(path) { const e = at(path); return e ? e.tree.node_id : ''; },
    leaves(path) { const e = at(path); return e ? e.leaves.slice(0, MAX_LEAVES).map((n) => ({ name: clean(n.display_name) || n.node_id.slice(0, 10), id: n.node_id, status: n.status || '', relay: !!n.relay_connected })) : null; },
    more(path) { const e = at(path); return e ? e.more : 0; },
    /** Master 의 노드 기록 그대로(상태 · resource · last_heartbeat_at) — 없으면 null */
    node(rid) { return (rid && byId.get(rid)) || null; },
  };
}

const STATUS = { online: ['● 온라인', true], offline: ['○ 꺼짐', false], degraded: ['◐ 저하', true], pending: ['◇ 대기', false] };
/**
 * Master 노드 기록 → 전역 틀 대상 표의 값. 하트비트의 자원 스냅샷(resource)을 쓰고, 없는 칸은 null(화면은 '—')
 * @returns {{ status: string, online: boolean, cpu: number|null, mem: number|null, disk: number|null, seen: string }}
 */
export function nodeStats(n, now = Date.now()) {
  const r = (n && n.resource) || {}, pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : null);
  const s = STATUS[String((n && n.status) || '').toLowerCase()] || [n && n.status ? '◇ ' + n.status : '—', false];
  const hb = Date.parse((n && n.last_heartbeat_at) || ''), sec = Number.isNaN(hb) ? -1 : Math.max(0, (now - hb) / 1000);
  const seen = sec < 0 ? '' : sec < 60 ? '방금' : sec < 3600 ? Math.round(sec / 60) + '분 전' : sec < 86400 ? Math.round(sec / 3600) + '시간 전' : Math.round(sec / 86400) + '일 전';
  return { status: s[0], online: s[1], cpu: pct(r.cpu_percent), mem: pct(r.memory_percent), disk: pct(r.disk_percent), seen };
}

/**
 * Master 노드 목록 · 로컬 노드 id 를 받아 지도를 만든다. 실패하면 null(씬은 시안 그대로)
 * @param {ReturnType<import('./terra.js').createTerra>} terra
 */
export async function loadTopology(terra) {
  const [list, st] = await Promise.all([
    terra.invoke('terra.master.nodes.get', {}).then((d) => (Array.isArray(d) ? d : (d && d.nodes) || []), () => null),
    terra.invoke('terra.daemon.status.get', {}).catch(() => null),
  ]);
  if (!list || !list.length) return null;
  const localId = (st && ((st.enrollment && st.enrollment.node_id) || (st.daemon && st.daemon.node_id))) || '';
  return buildTopology(list, { localId, rev: list.map((n) => n.node_id).join(',').length + ':' + list.length });
}
