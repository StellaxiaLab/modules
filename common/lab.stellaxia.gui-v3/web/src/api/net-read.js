// 네트워크 창(읽기 전용)의 Master 읽기 → 행. lab.stellaxia.node-gui 의 web/src/data/network-master.js 의 순수 함수를 그대로 옮겼다
// (보드에 섞는 masterBlocks 는 빼고). 시험도 같은 것을 옮겼다(tests/net-read.test.mjs).
// 앱 자격(A 모드)의 Master 위임 표에는 아래 읽기가 모두 있다. 쓰기(조정 · 계획 · 피어 철회 · probe 실행 · 정책 저장 · 세션 닫기 · 연결 그룹 닫기)는
// 위임 밖이라 이 창은 보기만 한다 — docs/analysis/replacement-readiness.md §3-1.
//
// (원본 머리말) 네트워크 보드의 Master 묶음(사설망 · 연결 진단 · 라우팅 · 조작 이력) — 위임 입구 1차 읽기(Terra ADR-GW-003).
//
// 보드(src/screens/network.js)의 이 묶음은 디자인 캔버스의 시연 코드라 예시 노드 · 세대 번호 · 후보를 품고 있다.
// 그대로 쓰지 않고 여기서 읽기 전용 블록을 새로 짓는다. 값은 Master 응답 그대로 — 모르는 것은 '—'.
//   읽는 것  network.state.get · network.status.get · route.graph.get · route.candidates.get · route.policies.get ·
//           route.sessions.get · network.probes.get · network.logs.get (모두 GET · node.read)
//   쓰지 않는 것  자동 조정 · 계획 · 피어 철회 · probe 실행 · 정책 저장 · 세션 닫기 · 연결 그룹 — Master 쓰기라 위임 입구 2차다
//   부르는 길  tree 는 operation id, leaf 는 /api/upstream 경로(client.js invokeUpstream) — 이 파일은 모른다

/** 이 파일이 부르는 Master 읽기 */
export const NET_OPS = {
  state: 'terra.master.network.state.get',
  status: 'terra.master.network.status.get',
  graph: 'terra.master.route.graph.get',
  candidates: 'terra.master.route.candidates.get',
  policies: 'terra.master.route.policies.get',
  sessions: 'terra.master.route.sessions.get',
  probes: 'terra.master.network.probes.get',
  logs: 'terra.master.network.logs.get'
};
/** 묶음마다 필요한 읽기 */
export const SEC_OPS = { mesh: ['state', 'status'], route: ['status', 'graph', 'policies', 'sessions', 'probes'], log: ['logs'] };

const arr = (v) => (Array.isArray(v) ? v : []);
/** Go 의 빈 time(0001-…)과 없는 값은 '—' */
export function when(iso) {
  if (!iso || /^0001-/.test(String(iso))) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
const bytes = (n) => { let v = Number(n) || 0, i = 0; const U = ['B', 'KB', 'MB', 'GB', 'TB']; while (v >= 1024 && i < U.length - 1) { v /= 1024; i += 1; } return (i ? v.toFixed(v < 10 ? 1 : 0) : String(v)) + ' ' + U[i]; };
const bps = (n) => (n ? (n >= 1e9 ? (n / 1e9).toFixed(1) + ' Gbps' : n >= 1e6 ? Math.round(n / 1e6) + ' Mbps' : Math.round(n / 1e3) + ' kbps') : '—');

/** network.status.get → node_id → 이름 */
export function nameMap(status) {
  const m = new Map();
  arr(status && status.nodes).forEach((n) => m.set(n.node_id, n.display_name || n.node_id));
  return m;
}

/** network.state.get · network.status.get → 노드 × 네트워크 행. desired · observed · 배포는 노드마다 마지막 것 */
export function meshRows(state, status) {
  const S = state || {}, names = nameMap(status), net = new Map(arr(S.networks).map((n) => [n.id, n.name || n.cidr || n.id]));
  const by = (list, key = 'node_id') => { const m = new Map(); arr(list).forEach((x) => { const k = x[key]; const old = m.get(k); if (!old || String(x.updated_at || '') >= String(old.updated_at || '')) m.set(k, x); }); return m; };
  const asg = by(S.assignments), des = by(S.desired_transports), obs = by(S.observed_transports), push = by(S.wireguard_push_deliveries);
  const ids = new Set([...arr(status && status.nodes).map((n) => n.node_id), ...asg.keys(), ...des.keys(), ...obs.keys(), ...push.keys()]);
  const st = new Map(arr(status && status.nodes).map((n) => [n.node_id, n]));
  return [...ids].filter(Boolean).map((id) => {
    const a = asg.get(id), d = des.get(id), o = obs.get(id), p = push.get(id), s = st.get(id) || {};
    return {
      id, name: names.get(id) || id, status: s.status || '—', relay: !!s.relay_connected, gen: s.network_generation,
      ip: a ? a.assigned_ip : '—', net: a ? net.get(a.network_id) || a.network_id : '—',
      desired: d ? d.adapter + (d.enabled ? '' : ' (꺼짐)') : '—',
      observed: o ? o.reachability || o.adapter : null, obsGen: o ? o.network_generation : null,
      push: p ? p.status : null, pushErr: p ? p.last_error || '' : ''
    };
  }).sort((x, y) => (x.name < y.name ? -1 : 1));
}

/** route.graph.get · network.status.get → 그래프(원 위에 노드, 가장 좋은 건강한 후보의 route_type 으로 선) */
export function graphView(graph, status, w = 800, h = 380) {
  const names = nameMap(status), ids = new Set(arr(status && status.nodes).map((n) => n.node_id));
  const edges = [], seen = new Set();
  arr(graph && graph.edges).forEach((e) => {
    ids.add(e.source_node_id); ids.add(e.target_node_id);
    const key = [e.source_node_id, e.target_node_id].sort().join('|');
    const best = arr(e.candidates).find((c) => c.healthy) || arr(e.candidates)[0];
    if (!best || seen.has(key)) return;
    seen.add(key);
    edges.push([e.source_node_id, e.target_node_id, best.route_type]);
  });
  const list = [...ids].filter(Boolean).sort(), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 50;
  const st = new Map(arr(status && status.nodes).map((n) => [n.node_id, n]));
  const nodes = list.map((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, list.length) - Math.PI / 2;
    return { id, name: names.get(id) || id, status: (st.get(id) || {}).status || 'unknown', x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) };
  });
  return { epoch: graph ? graph.route_graph_epoch : null, nodes, edges };
}

/** route.candidates.get → 후보 · 거부된 후보 행 */
export function candidateRows(expl) {
  const row = (c) => ({ rt: c.route_type, ad: c.adapter, healthy: !!c.healthy, lat: c.latency_ms != null ? c.latency_ms + 'ms' : '—', bw: bps(c.bandwidth_bps), probe: when(c.last_probe_at), reason: c.reason || '' });
  return { cands: arr(expl && expl.candidates).map(row), denied: arr(expl && expl.denied_candidates).map(row), source: (expl && expl.policy_source) || '' };
}

/** route.policies.get → 정책 행 */
export function policyRows(d, names = new Map()) {
  const n = (id) => (id ? names.get(id) || id : '*');
  return arr(d && d.policies).map((p) => {
    const s = p.scope || {}, P = p.policy || {};
    return { id: p.id, src: n(s.source_node_id), dst: n(s.target_node_id), channel: s.channel || '*', mode: P.mode || 'auto',
      prefer: arr(P.prefer).join(', ') || '—', allow: arr(P.allow).join(', '), deny: arr(P.deny).join(', '), fallback: P.fallback ? '예' : '아니오', at: when(p.updated_at) };
  });
}

/** route.sessions.get → 세션 행 */
export function sessionRows(d, names = new Map()) {
  const n = (id) => names.get(id) || id || '—';
  return arr(d && d.sessions).map((s) => ({ id: s.id, src: n(s.source_node_id), dst: n(s.target_node_id), channel: s.channel || '—', rt: s.route_type || '—', state: s.state || '—',
    sent: s.health ? bytes(s.health.bytes_sent) : '—', recv: s.health ? bytes(s.health.bytes_received) : '—', err: s.health && s.health.last_error ? s.health.last_error : '', at: when(s.updated_at) }));
}

/** network.probes.get → probe 행 */
export function probeRows(d, names = new Map()) {
  const n = (id) => names.get(id) || id || '—';
  return arr(d && d.probes).map((p) => {
    const r = p.result || {};
    return { id: p.id, src: n(p.source_node_id), dst: n(p.target_node_id), adapter: p.adapter || '—', reachable: !!r.reachable, fresh: !!p.fresh, stale: p.stale_reason || '', at: when(r.observed_at), err: r.error_code || '' };
  }).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** network.logs.get → 조작 이력 행 (최신순으로 온다) */
export function logRows(d) {
  return arr(d && d.logs).map((l) => ({ at: when(l.created_at), action: l.action || '—', type: l.target_type || '—', target: l.target_id || '—', result: l.result || '—',
    detail: l.detail == null ? '' : typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail) }));
}

/** network.networks.get → 네트워크 행 */
export function networkRows(d) {
  return arr(d && (d.networks || d)).map((n) => ({ id: n.id, name: n.name || n.id, cidr: n.cidr || '—', adapter: n.adapter || '—', at: when(n.updated_at || n.created_at) }));
}

/** network.mesh.wireguard.peers.get {node_id} → 그 노드가 받을 피어 행 */
export function peerRows(d, names = new Map()) {
  return arr(d && (d.peers || d)).map((p) => ({ node: names.get(p.node_id) || p.node_id || '—', ip: arr(p.allowed_ips).join(', ') || p.assigned_ip || '—', endpoint: p.endpoint || '—', key: p.public_key ? String(p.public_key).slice(0, 8) + '…' : '—' }));
}

// ── 네트워크 창의 탭 — 탭마다 부를 Master 읽기와 표(열 · 행) ──
/** 탭 → 그 탭이 쓰는 읽기 이름(아래 NET_READS 의 키) */
export const NET_TABS = [
  ['mesh', '노드 · 메시', ['state', 'status']], ['peers', '피어', ['peers', 'status']], ['nets', '네트워크', ['networks']],
  ['graph', '경로 그래프', ['graph', 'status']], ['sessions', '경로 세션', ['sessions', 'status']], ['policies', '경로 정책', ['policies', 'status']],
  ['probes', 'probe', ['probes', 'status']], ['logs', '조작 이력', ['logs']]
];
/** 읽기 이름 → Master op (모두 위임 표에 있다 — tests/master-delegated.test.mjs 가 본다) */
export const NET_READS = {
  state: 'terra.master.network.state.get', status: 'terra.master.network.status.get', networks: 'terra.master.network.networks.get',
  peers: 'terra.master.network.mesh.wireguard.peers.get', graph: 'terra.master.route.graph.get', sessions: 'terra.master.route.sessions.get',
  policies: 'terra.master.route.policies.get', probes: 'terra.master.network.probes.get', logs: 'terra.master.network.logs.get'
};
const ok = (b) => (b ? '예' : '아니오');
/** @param {string} tab @param {Record<string, any>} D 읽기 이름 → 응답 data @returns {{ cols: string[], rows: string[][] }} */
export function netTable(tab, D) {
  const names = nameMap(D.status);
  if (tab === 'mesh') return { cols: ['노드', '상태', '중계', '주소', '네트워크', '원하는 전송', '관측', '배포'], rows: meshRows(D.state, D.status).map((r) => [r.name, r.status, ok(r.relay), r.ip, r.net, r.desired, r.observed || '—', r.push ? r.push + (r.pushErr ? ' · ' + r.pushErr : '') : '—']) };
  if (tab === 'peers') return { cols: ['피어 노드', '허용 주소', 'endpoint', '공개키'], rows: peerRows(D.peers, names).map((r) => [r.node, r.ip, r.endpoint, r.key]) };
  if (tab === 'nets') return { cols: ['이름', 'CIDR', '어댑터', '바뀐 때'], rows: networkRows(D.networks).map((r) => [r.name, r.cidr, r.adapter, r.at]) };
  if (tab === 'graph') { const G = graphView(D.graph, D.status), nm = new Map(G.nodes.map((n) => [n.id, n.name])); return { cols: ['출발', '도착', '경로 종류'], rows: G.edges.map(([a, b, rt]) => [nm.get(a) || a, nm.get(b) || b, rt || '—']) }; }
  if (tab === 'sessions') return { cols: ['세션', '출발', '도착', '채널', '경로', '상태', '보냄', '받음', '오류'], rows: sessionRows(D.sessions, names).map((r) => [r.id, r.src, r.dst, r.channel, r.rt, r.state, r.sent, r.recv, r.err || '—']) };
  if (tab === 'policies') return { cols: ['출발', '도착', '채널', '방식', '선호', '대체 경로', '바뀐 때'], rows: policyRows(D.policies, names).map((r) => [r.src, r.dst, r.channel, r.mode, r.prefer, r.fallback, r.at]) };
  if (tab === 'probes') return { cols: ['출발', '도착', '어댑터', '닿음', '새것', '관측', '오류'], rows: probeRows(D.probes, names).map((r) => [r.src, r.dst, r.adapter, ok(r.reachable), r.fresh ? '예' : r.stale || '아니오', r.at, r.err || '—']) };
  if (tab === 'logs') return { cols: ['때', '조작', '대상', '결과', '내용'], rows: logRows(D.logs).map((r) => [r.at, r.action, r.type + ' ' + r.target, r.result, r.detail]) };
  return { cols: [], rows: [] };
}
