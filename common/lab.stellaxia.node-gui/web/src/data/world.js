// 진짜 노드 목록 → 화면이 쓰는 관계도(NET)와 이름.
//
// 화면(src/screens/node.js)은 노드를 "이름"으로 다룬다 — 맵 칸 · 관계도 · 권한표가 전부 이름을 키로 쓴다.
// 진짜 노드는 node_id 와 표시 이름을 가지므로, 여기서 겹치지 않는 이름을 정하고 id 와 잇는다.
// 순수 함수만 둔다 — 브라우저 없이 시험한다(tests/data.test.mjs).

/** 이 노드가 붙은 tree — Master 주소의 host:port 를 이름으로 쓴다. 주소가 없으면 null */
export function treeFromMaster(masterUrl) {
  if (!masterUrl) return null;
  try {
    const u = new URL(masterUrl);
    return { name: 'tree · ' + u.host, role: 'Tree', bid: null, url: u.origin };
  } catch {
    return null;
  }
}

/**
 * 진짜 노드 목록에 겹치지 않는 이름을 붙인다. 표시 이름이 겹치면 node_id 끝 네 글자를 붙인다.
 * @param {{ nodeId: string, displayName?: string, status?: string, roles?: string[] }[]} nodes
 * @returns {{ id: string, name: string, status: string, roles: string[] }[]}
 */
export function nameNodes(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.nodeId);
  const base = (n) => String(n.displayName || n.nodeId).trim() || n.nodeId;
  const count = new Map();
  for (const n of list) count.set(base(n), (count.get(base(n)) || 0) + 1);
  return list.map((n) => {
    const b = base(n);
    const name = count.get(b) > 1 ? b + ' · ' + n.nodeId.slice(-4) : b;
    return { id: n.nodeId, name, status: n.status || 'unknown', roles: Array.isArray(n.roles) ? n.roles : [] };
  });
}

/**
 * 관계도. tree 하나 아래에 보이는 노드들을 둔다 — 화면의 defaultMap(tree)가 이것으로 가운데에 tree,
 * 둘레에 자식 노드를 놓는다. tree 를 모르면(등록 전 · Master 없음) 로컬 노드 하나만 둔다.
 *
 * @param {{ tree: { name: string, role?: string, bid?: string|null } | null,
 *           nodes: { id: string, name: string, status: string, roles: string[] }[],
 *           local: { id?: string, name: string } }} input
 * @returns {{ NET: Record<string, any>, mapOwner: string, localName: string }}
 */
export function buildNet({ tree, nodes, local }) {
  const NET = {};
  // auth 'offline' = Master 가 오프라인으로 본 노드 — 화면은 이것으로 그 노드 필드의 건물에 "정지" 이벤트를 입힌다(UI 명세 §2.11)
  const leaf = (n) => Object.assign({ role: 'Leaf', kids: [], res: [], id: n.id || null, status: n.status || 'unknown' }, n.status === 'offline' ? { auth: 'offline' } : {});
  const known = Array.isArray(nodes) ? nodes : [];
  // 로컬 노드는 목록에 없어도(아직 Master 가 모른다) 맵에 있어야 한다
  const localEntry = known.find((n) => local.id && n.id === local.id) || { id: local.id || null, name: local.name, status: 'online', roles: [] };
  const all = known.some((n) => n === localEntry) ? known : [localEntry].concat(known);
  for (const n of all) NET[n.name] = leaf(n);
  if (!tree) return { NET, mapOwner: localEntry.name, localName: localEntry.name };
  NET[tree.name] = { role: tree.role || 'Tree', kids: all.map((n) => n.name), bid: tree.bid || null, auth: 'saved', url: tree.url || null };
  return { NET, mapOwner: tree.name, localName: localEntry.name };
}

/** 로컬 노드의 자원 요약 — 속성 창 등이 NET[노드].res 로 읽는다. 진짜 개수만 싣는다 */
export function resourceSummary({ devices, roots, modules }) {
  const out = [];
  if (Number.isFinite(devices)) out.push(['I/O 장치 ' + devices, '장치']);
  if (Number.isFinite(roots)) out.push(['공유 폴더 ' + roots, '파일']);
  if (Number.isFinite(modules)) out.push(['모듈 ' + modules, '모듈']);
  return out;
}
