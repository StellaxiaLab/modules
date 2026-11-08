// 노드 상태 창(보드 NodeStatus)의 실제 값 — 식별 · 통신 · 최근 활동 · 자원.
//
// 읽는 것(모두 Master 위임 표의 GET — 앱 자격 A 모드에서도 열린다, tests/master-delegated.test.mjs):
//   노드 기록            terra.master.nodes.get 의 그 노드(지도 TerraTopology.node(rid) 가 이미 들고 있다)
//                        node_id · device_id · cluster_address · dns_label · roles · capabilities · tags · parent_node_id · depth ·
//                        status · relay_connected · daemon_version · last_heartbeat_at · resource{cpu,memory,disk %, network rx/tx 바이트} · created_at
//   통신                 network.status(중계 · 세대) · network.state(배정 주소 · 원하는/관측 전송) · route.graph(이 노드가 낀 경로) ·
//                        route.sessions(이 노드가 낀 세션) · network.probes(이 노드가 낀 진단)
//   최근 활동            network.logs(대상이 이 노드인 조작) + 하트비트 · 세션 · probe 의 때
// 하나가 실패해도 나머지는 그린다 — 실패한 읽기는 miss 에 이름으로(화면은 '—' 와 "읽지 못함 · 이름").

import { NET_READS, meshRows, nameMap, when } from './net-read.js';
import { nodeStats } from './topology.js';

/** 상태 창이 부르는 Master 읽기 */
export const INFO_READS = ['status', 'state', 'graph', 'sessions', 'probes', 'logs'];
const arr = (v) => (Array.isArray(v) ? v : []);
const ROLE = { tree: 'Tree', leaf: 'Leaf', master: 'Master', relay: '중계', gateway: 'Gateway' };
const bytes = (n) => { let v = Number(n) || 0, i = 0; const U = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; while (v >= 1024 && i < U.length - 1) { v /= 1024; i += 1; } return (i ? v.toFixed(v < 10 ? 1 : 0) : String(v)) + U[i]; };
const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) || /^0001-/.test(String(iso)) ? 0 : t; };

/**
 * 노드 기록 + Master 읽기 → 상태 창 값. 순수 함수(시험: node-info.test.mjs)
 * @param {Record<string, any>|null} rec terra.master.nodes.get 의 그 노드
 * @param {Record<string, any>} D 읽기 이름(INFO_READS) → 응답 data. 없는 것은 undefined
 * @param {{ id?: string, names?: Map<string,string>, now?: number, miss?: string[] }} [o]
 */
export function nodeInfo(rec, D = {}, o = {}) {
  const r = rec || {}, id = r.node_id || o.id || '', now = o.now ?? Date.now();
  const names = new Map([...(o.names || []), ...nameMap(D.status)]), nm = (x) => (x ? names.get(x) || x.slice(0, 10) : '—');
  const st = nodeStats(r, now);
  const mesh = meshRows(D.state, D.status).find((m) => m.id === id) || null;
  const stRow = arr(D.status && D.status.nodes).find((n) => n.node_id === id) || {};
  const relay = typeof r.relay_connected === 'boolean' ? r.relay_connected : !!stRow.relay_connected;

  // 이 노드가 낀 경로 — Master 경로 그래프는 방향 있는 간선(A→B 와 B→A 가 따로)이라 상대 한 노드가 두 줄로 온다. 합치지 않고 dir(→ 나가는 · ← 들어오는)로 구분해 싣는다. 줄마다 가장 좋은 건강한 후보
  const routes = arr(D.graph && D.graph.edges).filter((e) => e.source_node_id === id || e.target_node_id === id).map((e) => {
    const best = arr(e.candidates).find((c) => c.healthy) || arr(e.candidates)[0] || {};
    return { peer: nm(e.source_node_id === id ? e.target_node_id : e.source_node_id), dir: e.source_node_id === id ? '→' : '←', rt: best.route_type || '—', ad: best.adapter || '', healthy: !!best.healthy, lat: best.latency_ms != null ? best.latency_ms + 'ms' : '' };
  });
  const mine = (x) => x.source_node_id === id || x.target_node_id === id;
  const sessions = arr(D.sessions && D.sessions.sessions).filter(mine).map((s) => ({ peer: nm(s.source_node_id === id ? s.target_node_id : s.source_node_id), dir: s.source_node_id === id ? '→' : '←', channel: s.channel || '—', rt: s.route_type || '—', state: s.state || '—', err: (s.health && s.health.last_error) || '', at: s.updated_at }));
  const probes = arr(D.probes && D.probes.probes).filter(mine).map((p) => { const q = p.result || {}; return { peer: nm(p.source_node_id === id ? p.target_node_id : p.source_node_id), adapter: p.adapter || '—', ok: !!q.reachable, err: q.error_code || '', at: q.observed_at }; });

  // 연결 방식 한 줄 — 관측된 전송이 있으면 그것, 없으면 경로 그래프의 가장 좋은 것, 그다음 중계
  const via = (mesh && mesh.observed) || (routes.find((x) => x.healthy) || {}).rt || (relay ? 'relay' : '');
  // 최근 활동 — 조작 이력(대상이 이 노드) · 하트비트 · 세션 · probe 를 때로 섞어 최근 8
  const ev = [];
  if (ts(r.last_heartbeat_at)) ev.push({ at: ts(r.last_heartbeat_at), lv: 'info', msg: 'heartbeat' + (st.status ? ' · ' + st.status.replace(/^\S+\s/, '') : '') });
  for (const l of arr(D.logs && D.logs.logs)) {
    const det = l.detail == null ? '' : typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail);
    if (l.target_id !== id && !det.includes(id)) continue;
    ev.push({ at: ts(l.created_at), lv: /fail|error|denied/i.test(l.result || '') ? 'warn' : 'info', msg: (l.action || '조작') + (l.result ? ' · ' + l.result : '') });
  }
  for (const s of sessions) if (ts(s.at)) ev.push({ at: ts(s.at), lv: s.err ? 'warn' : 'info', msg: 'session ' + s.dir + ' ' + s.peer + ' · ' + s.state + (s.err ? ' · ' + s.err : '') });
  for (const p of probes) if (ts(p.at)) ev.push({ at: ts(p.at), lv: p.ok ? 'info' : 'warn', msg: 'probe ' + p.peer + ' · ' + p.adapter + (p.ok ? ' ok' : ' 닿지 않음' + (p.err ? ' · ' + p.err : '')) });
  ev.sort((a, b) => b.at - a.at);

  const res = r.resource || {};
  return {
    real: true, miss: o.miss || [],
    name: r.display_name || nm(id), status: st.status, online: st.online, seen: st.seen,
    ident: {
      nodeId: id || '—', deviceId: r.device_id || '—',
      roles: arr(r.roles).map((x) => ROLE[x] || x).join(' · ') || '—', parent: r.parent_node_id ? nm(r.parent_node_id) : '— (맨 위)', parentId: r.parent_node_id || '',
      depth: Number.isFinite(r.depth) ? String(r.depth) : '—', address: r.cluster_address || (mesh && mesh.ip !== '—' ? mesh.ip : '') || '—',
      dns: r.dns_label ? r.dns_label + '.terra' : '—', version: r.daemon_version || '—', created: when(r.created_at), tags: arr(r.tags).join(', ') || '—',
      caps: arr(r.capabilities).join(', ') || '—',
    },
    comm: {
      via: via || '—', relay, net: mesh ? mesh.net : '—', desired: mesh ? mesh.desired : '—', observed: (mesh && mesh.observed) || '—',
      gen: mesh && mesh.gen != null ? String(mesh.gen) : stRow.network_generation != null ? String(stRow.network_generation) : '—',
      routes, sessions: sessions.map((s) => ({ ...s, at: when(s.at) })),
    },
    res: { cpu: st.cpu, mem: st.mem, disk: st.disk, memUsed: st.memUsed, memTotal: st.memTotal, diskUsed: st.diskUsed, diskTotal: st.diskTotal,   // 총량 — Master 가 실어 준 바이트만(없으면 null)
      stale: !st.online && !!st.seen,   // 꺼진 · 응답 없는 노드 — 자원 값은 마지막 보고
      rx: Number(res.network_rx_bytes) || 0, tx: Number(res.network_tx_bytes) || 0, rxT: res.network_rx_bytes ? bytes(res.network_rx_bytes) : '—', txT: res.network_tx_bytes ? bytes(res.network_tx_bytes) : '—' },
    recent: { heartbeat: when(r.last_heartbeat_at), hbAt: ts(r.last_heartbeat_at), events: ev.slice(0, 8) },
  };
}

/**
 * 창이 부르는 것 — rid 의 상태 창 값. 읽기는 10초 동안 나눠 쓴다(창 여러 개 · 1 초 그리기가 Master 를 두드리지 않게)
 * @param {{ invoke: (op: string, input: object) => Promise<any> }} terra
 * @param {() => any} topo 지금 지도(window.TerraTopology)
 */
export function createNodeInfo(terra, topo, ttl = 10000) {
  const cache = new Map();
  const read = (k) => {
    const c = cache.get(k);
    if (c && Date.now() - c.t < ttl) return c.p;
    const p = terra.invoke(NET_READS[k], {}).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e }));
    cache.set(k, { t: Date.now(), p }); return p;
  };
  return async (rid) => {
    if (!rid) return null;
    const T = topo(), rec = (T && T.node && T.node(rid)) || null, D = {}, miss = [];
    const got = await Promise.all(INFO_READS.map(read));
    INFO_READS.forEach((k, i) => { if (got[i].ok) D[k] = got[i].d; else miss.push(k); });
    return nodeInfo(rec, D, { id: rid, miss });
  };
}
