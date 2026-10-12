// 네트워크 보드의 Master 묶음(사설망 · 연결 진단 · 라우팅 · 조작 이력) — 위임 입구 1차 읽기(Terra ADR-GW-003).
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

/**
 * 보드에 섞는 메서드 — RealNetwork 가 this 로 쓴다(table · kv · tag · cB · cM · cT · stateBlock · banner · RT 는 보드의 것).
 * state.m = { 묶음: { kind, data } } — refresh 가 채운다
 */
export const masterBlocks = {
  /** 읽기 결과가 없을 때의 한 줄 */
  mWhy(sec) {
    const M = this.state.m || {}, bad = (SEC_OPS[sec] || []).map((k) => M[k]).find((r) => r && r.kind !== 'ok');
    if (bad) return this.stateBlock('⛓', bad.kind === 'unavailable' ? 'off' : 'bad', 'Master 읽기에 실패했습니다', this.mText(bad), []);
    if ((SEC_OPS[sec] || []).some((k) => !M[k])) return this.stateBlock('⟳', 'info', '처음 불러오는 중', (SEC_OPS[sec] || []).map((k) => NET_OPS[k]).join(' · ') + '을 기다립니다.', []);
    return null;
  },
  writeNote() {
    return this.banner('info', 'ⓘ', '여기서는 보기만 합니다.', '조정 · 계획 · 철회 · probe · 정책 저장 · 세션 닫기는 Master 쓰기입니다 — 앱 토큰의 위임 입구는 아직 읽기만 엽니다(Terra ADR-GW-003 1차). terra CLI에서 합니다.');
  },

  realMesh() {
    const M = this.state.m, why = this.mWhy('mesh');
    if (why) return { tabs: [], blocks: [why] };
    const state = M.state.data || {}, status = M.status.data || {}, rows = meshRows(state, status);
    const pushTone = { accepted: 'ok', sent: 'info', rejected: 'bad', failed: 'bad' };
    const mism = rows.filter((r) => r.observed && r.gen != null && r.obsGen != null && r.obsGen < r.gen);
    return { tabs: [], blocks: [
      this.writeNote(),
      this.table({ span: 12, title: '논리 네트워크 (CIDR)', sub: 'network.state.get · 클러스터 ' + (state.cluster_id || '—'), cols: '1fr 1.3fr 1fr 0.8fr', head: ['이름', 'CIDR', 'gateway · dns', '상태'],
        rows: arr(state.networks).map((n) => ({ cells: [this.cT(n.name || n.id, { fw: 700, sub: n.id }), this.cM(n.cidr), this.cM((n.gateway || '—') + ' · ' + (arr(n.dns).join(', ') || '—')), this.cB(n.status || '—', n.status === 'active' ? 'ok' : 'off')] })),
        empty: '이 클러스터에 논리 네트워크가 없습니다' }),
      this.table({ span: 12, title: '노드 × 네트워크', sub: 'network.state.get · network.status.get — desired와 observed를 나란히 · route_graph_epoch ' + (state.route_graph_epoch != null ? state.route_graph_epoch : '—'),
        tags: mism.length ? [this.tag('observed 세대가 옛것 ' + mism.length, 'warn')] : [],
        cols: '1.3fr 0.8fr 1.1fr 0.9fr 1.2fr 1.1fr', head: ['노드', '상태', 'IP (네트워크)', 'desired', 'observed', '배포'],
        rows: rows.map((r) => { const old = mism.indexOf(r) >= 0, off = r.status !== 'online';
          return { hl: r.push === 'rejected' || r.push === 'failed' ? 'rgba(255,93,93,0.07)' : old ? 'rgba(245,184,61,0.06)' : 'transparent', op: off ? 0.7 : 1, cells: [
            this.cM(r.name, { fw: 700, sub: r.name !== r.id ? r.id : '' }), this.cB(r.status, off ? 'off' : 'ok', { tip: 'relay_connected: ' + r.relay }),
            this.cM(r.ip, { sub: r.net !== '—' ? r.net : '' }), r.desired === '—' ? this.cT('—', { c: '#8a919b' }) : this.cB(r.desired, 'info'),
            r.observed ? this.cB(r.observed + (r.obsGen != null ? ' · gen ' + r.obsGen : ''), old ? 'warn' : 'ok', { sub: old ? 'gen ' + r.gen + ' 기다림' : '' }) : this.cT('관측 없음', { c: '#8a919b' }),
            r.push ? this.cB(r.push, pushTone[r.push] || 'off', { sub: r.pushErr }) : this.cT('—', { c: '#8a919b' })] }; }),
        empty: '노드가 없습니다', foot: '배포(wireguard_push_deliveries): sent · accepted · rejected · failed. 노란 줄 = observed의 network_generation이 노드의 세대보다 옛것.' })
    ] };
  },

  realRoute() {
    const S = this.state, M = S.m, why = this.mWhy('route'), sub = S.sub.route;
    const tabs = [['graph', '그래프 · 진단'], ['policy', '정책'], ['sessions', '세션']];
    if (why) return { tabs, blocks: [why] };
    const status = M.status.data || {}, names = nameMap(status), RT = this.RT(), out = [this.writeNote()];
    if (sub === 'policy') {
      const modeTone = { auto: 'off', prefer: 'info', only: 'vio', deny: 'bad', relay_only: 'warn' };
      out.push(this.table({ span: 12, title: '라우트 정책', sub: 'route.policies.get', cols: '0.9fr 1.6fr 0.9fr 0.8fr 1.4fr 0.7fr 1fr',
        head: ['id', 'scope', 'channel', 'mode', 'prefer · allow / deny', 'fallback', '저장'],
        rows: policyRows(M.policies.data, names).map((p) => ({ cells: [this.cM(p.id, { fw: 700 }), this.cM(p.src + ' → ' + p.dst), this.cM(p.channel), this.cB(p.mode, modeTone[p.mode] || 'off'),
          this.cM(p.prefer, { sub: [p.allow && 'allow ' + p.allow, p.deny && 'deny ' + p.deny].filter(Boolean).join(' · ') }), this.cT(p.fallback), this.cM(p.at, { c: '#9aa1ab' })] })),
        empty: '저장된 정책이 없습니다 — 모든 쌍이 기본(auto)', foot: '저장 성공 ≠ 유효 — 틀린 정책은 후보 조회 409, 그래프에서 edge가 빠지는 것으로 드러난다.' }));
      return { tabs, blocks: out };
    }
    if (sub === 'sessions') {
      const stTone = { opening: 'info', active: 'ok', draining: 'warn', closed: 'off', failed: 'bad' };
      out.push(this.table({ span: 12, title: '라우트 세션', sub: 'route.sessions.get', cols: '1fr 1.6fr 1fr 1.1fr 0.9fr 1.2fr 1fr',
        head: ['id', '경로', 'channel', 'route_type', '상태', '보냄 / 받음', '갱신'],
        rows: sessionRows(M.sessions.data, names).map((s) => ({ cells: [this.cM(s.id, { fw: 700 }), this.cM(s.src + ' → ' + s.dst), this.cM(s.channel, { c: '#9aa1ab' }), this.cM(s.rt, { c: RT[s.rt] || '#ede9e1' }),
          this.cB(s.state, stTone[s.state] || 'off', { sub: s.err }), this.cM(s.sent + ' / ' + s.recv, { c: '#b4bac3' }), this.cM(s.at, { c: '#9aa1ab' })] })),
        empty: '라우트 세션이 없습니다', foot: '연결 그룹(connection-groups.*)은 위임 입구 1차에 들지 않는다 — terra CLI에서 본다.' }));
      return { tabs, blocks: out };
    }
    const G = graphView(M.graph.data, status), P = S.pair || {};
    const onPair = (a, b) => (a === P.src && b === P.dst) || (a === P.dst && b === P.src), pos = new Map(G.nodes.map((n) => [n.id, n]));
    out.push(this.block({ span: 7, title: '라우트 그래프', sub: 'route.graph.get · epoch ' + (G.epoch != null ? G.epoch : '—') + ' — 노드를 누르면 쌍을 고른다',
      tags: [this.tag('계산에 실패한 쌍은 빠진다', 'off')] }, {
      isGraph: true, gw: 800, gh: 380,
      edges: G.edges.filter(([a, b]) => pos.has(a) && pos.has(b)).map(([a, b, t]) => ({ x1: pos.get(a).x, y1: pos.get(a).y, x2: pos.get(b).x, y2: pos.get(b).y, c: RT[t] || '#9aa1ab', w: onPair(a, b) ? 4 : 2.2, dash: t === 'cloud_relay' ? '6 5' : t === 'webrtc_p2p' ? '2 5' : 'none', op: onPair(a, b) ? 1 : 0.7 })),
      gnodes: G.nodes.map((n) => { const sel = n.id === P.src || n.id === P.dst, off = n.status !== 'online';
        return { x: n.x, y: n.y, name: n.name, r: sel ? 17 : 14, line: sel ? '#ffd84d' : off ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.38)', lw: sel ? 3 : 1.5, c: '#5aa8ff', op: off ? 0.55 : 1, ty: 30, ty2: 42, fw: sel ? 700 : 500,
          tag: n.id === P.src ? 'source' : n.id === P.dst ? 'target' : '', tagC: '#ffd84d', pick: () => this.pickPair(n.id) }; }),
      legend: Object.keys(RT).filter((k) => k !== 'local_loopback').map((k) => ({ t: k, c: RT[k], style: k === 'cloud_relay' || k === 'webrtc_p2p' ? 'dashed' : 'solid' }))
    }));
    const C = S.mCand;
    out.push(this.table({ span: 5, title: '후보 라우트', sub: 'route.candidates.get · ' + (P.src && P.dst ? (names.get(P.src) || P.src) + ' → ' + (names.get(P.dst) || P.dst) + ' · ' + (P.channel || 'service.tunnel') : '그래프에서 두 노드를 고른다'),
      tags: C && C.kind === 'ok' && C.data.source ? [this.tag('policy_source: ' + C.data.source, 'vio')] : [],
      cols: '1.5fr 0.9fr 0.8fr 0.6fr 1.3fr', head: ['route_type', 'adapter', '상태', '지연', '이유'],
      rows: C && C.kind === 'ok' ? C.data.cands.map((c, i) => ({ hl: i === 0 ? 'rgba(122,167,255,0.07)' : 'transparent', cells: [this.cM(c.rt, { c: RT[c.rt] || '#ede9e1', fw: 700, sub: c.bw !== '—' ? c.bw : '' }), this.cM(c.ad), this.cB(c.healthy ? 'healthy' : 'unhealthy', c.healthy ? 'ok' : 'bad'), this.cM(c.lat), this.cT(c.reason, { c: '#9aa1ab' })] }))
        .concat(C.data.denied.map((d) => ({ op: 0.6, cells: [this.cM(d.rt, { c: '#8a919b', sub: '거부' }), this.cM(d.ad), this.cB('denied', 'off'), this.cT('—'), this.cT(d.reason, { c: '#8a919b' })] }))) : [],
      empty: !P.src || !P.dst ? '쌍을 고르면 후보를 읽는다' : !C ? '읽는 중…' : C.kind === 'ok' ? '쓸 수 있는 후보가 없다' : this.mText(C) }));
    out.push(this.table({ span: 12, title: 'probe 기록', sub: 'network.probes.get — probe 실행은 Master 쓰기(2차)', cols: '1.6fr 0.8fr 1.4fr 1fr',
      head: ['쌍', 'adapter', '결과', '관측'],
      rows: probeRows(M.probes.data, names).map((p) => ({ cells: [this.cM(p.src + ' → ' + p.dst), this.cM(p.adapter),
        p.reachable ? this.cB(p.fresh ? 'reachable · fresh' : 'reachable', p.fresh ? 'ok' : 'warn', { sub: p.fresh ? '' : p.stale }) : this.cB('unreachable', 'bad', { sub: p.err || p.stale }), this.cM(p.at, { c: '#9aa1ab' })] })),
      empty: 'probe 기록이 없습니다', foot: 'stale_reason: unreachable · missing_observed_at · probe_expired · network_generation_mismatch' }));
    return { tabs, blocks: out };
  },

  realLog() {
    const S = this.state, why = this.mWhy('log'), F = S.logFilter;
    const tabs = [['all', '전체'], ['accepted', 'accepted'], ['created', 'created'], ['revoked', 'revoked']];
    if (why) return { tabs, tabKey: 'log', blocks: [why] };
    const rTone = { updated: 'ok', created: 'ok', success: 'ok', accepted: 'info', revoked: 'warn', deleted: 'off', send_failed: 'bad', failed: 'bad', denied: 'bad' };
    const rows = logRows(S.m.logs.data).filter((l) => F === 'all' || l.result === F);
    return { tabs, tabKey: 'log', blocks: [
      this.banner('info', 'ⓘ', '본인 조작 이력입니다.', 'network.logs.get은 호출자 본인이 한 조작만 줍니다 — 관리자도 같습니다. 클러스터 전체 기록이 아닙니다.'),
      this.table({ span: 12, title: '조작 이력', sub: 'network.logs.get · 최신순 · limit 100', cols: '1fr 1.8fr 1fr 1.4fr 0.9fr 2fr',
        head: ['시각', 'action', 'target_type', 'target', 'result', 'detail'],
        rows: rows.map((l) => ({ cells: [this.cM(l.at, { c: '#9aa1ab' }), this.cM(l.action, { fw: 700 }), this.cM(l.type, { c: '#9aa1ab' }), this.cM(l.target), this.cB(l.result, rTone[l.result] || 'off'), this.cT(l.detail, { c: '#b4bac3' })] })),
        empty: '이 결과의 조작이 없습니다' })
    ] };
  }
};
