// 네트워크 속성 창(보드 NodeNet)의 실제 값 — 노드가 가진 주소 · 광고 중인 전송 · 다른 노드와의 연결.
//
// 근거(Terra origin/main 53043270, docs/modules/terra-gui/design/unified-gui-ux/terra-gui-network-requirements.md 를 정본으로):
//   경로 종류(route_type)   local_loopback · mesh_vpn_direct · lan_direct · webrtc_p2p · cloud_relay — terra-protocol transport.go
//                           고르는 순서 mesh_vpn_direct → lan_direct → webrtc_p2p → (정책이 허용하면) cloud_relay
//   reachability            local · lan · mesh · internet
//   주소                    cluster_address(Terra 전용 · 기본 100.80.0.0/24, "주소는 경로가 아니다") · assigned_ip(사설망) · dns_label(.terra)
//                           공인 IP = nat_identity, 공인 endpoint = public_endpoint, LAN = lan_endpoint, WireGuard 수신 포트 = listen_port
//                           — Master network.state 의 observed_transports[adapter=wireguard-bootstrap].details (그 노드가 WireGuard 보고를 했을 때만)
//
// 읽는 것(모두 A 모드에서 열림 — Master 위임 38건 · Daemon 은 node.read):
//   Master   nodes(지도) · network.status(광고 전송 · 중계 · 세대) · network.state(배정 · 관측 전송 · 사설망) · route.graph(쌍마다 후보) ·
//            route.sessions · network.probes · network.mesh.wireguard.peers{node_id}(쌍마다 고른 WireGuard endpoint · 출처 · 건강)
//            route.candidates{source_node_id, target_node_id}(한 쌍을 펼칠 때 — 후보 · 거부 사유 · 양쪽 endpoint)
//   Daemon   wireguard.status(mesh 인터페이스 주소 · NAT 매핑 설정) · wireguard.peers(handshake · 트래픽) — 로컬은 바로, 다른 노드는 Master 중계(직계 자식만)
//
// Terra 가 보고하지 않아 이 창이 보일 수 없는 것(지어내지 않는다 — 창 아래 '보고 없음'):
//   노드의 모든 IP · 인터페이스 목록과 서브넷(prefix) — Daemon 이 bootstrap 에 싣지만 Master 가 lan_endpoint 하나만 남긴다
//   WebRTC ICE 후보 · 고른 candidate pair · 연결 상태 — 노출하는 코드가 없다
//   A 모드에서 probe 새로 실행 — network.probes.post 가 위임 밖

import { NET_READS, when } from './net-read.js';

export const ROUTE = {
  local_loopback: { t: '같은 노드', rank: 0 }, mesh_vpn_direct: { t: 'mesh 직결', rank: 1 }, lan_direct: { t: 'LAN 직결', rank: 2 },
  gateway_lan: { t: 'LAN 경유', rank: 3 }, webrtc_p2p: { t: 'WebRTC P2P', rank: 4 }, cloud_relay: { t: 'Master 중계', rank: 5 },
};
export const REACH = { local: '같은 노드', lan: 'LAN', mesh: 'mesh', internet: '인터넷' };
const SRC = { stun: 'STUN', configured: '운영자 설정', nat_mapping: 'NAT 매핑', nat_pmp: 'NAT-PMP', pcp: 'PCP', upnp: 'UPnP', stun_assumed: 'STUN(포트 : 설정값 가정)',
  lan: 'LAN', public: '공인', peer_reflexive: '상대가 본 주소', reported: '노드 보고', operator: '운영자' };
/** 화면이 펼칠 때 부르는 읽기 */
export const NETP_READS = { status: NET_READS.status, state: NET_READS.state, graph: NET_READS.graph, sessions: NET_READS.sessions, probes: NET_READS.probes,
  peers: NET_READS.peers, candidates: 'terra.master.route.candidates.get', wg: 'terra.daemon.wireguard.status.get', wgPeers: 'terra.daemon.wireguard.peers.get' };
/** Terra 가 보고하지 않는 것 — 창 아래에 그대로 적는다 */
export const NOT_REPORTED = [
  '모든 IP · 인터페이스 목록 · 서브넷 — Daemon 보고에 있음 · Master 는 LAN 주소 하나만 보관',
  'WebRTC ICE 후보 · 고른 경로 쌍 · 연결 상태 — Terra 미제공',
  '연결 진단(probe) 새로 실행 — 위임 없음 (network.probes.post)',
];
const arr = (v) => (Array.isArray(v) ? v : []);
const ep = (e) => { if (!e) return ''; if (e.url) return e.url; if (e.host) return e.host + (e.port ? ':' + e.port : ''); if (e.peer_id) return 'peer ' + String(e.peer_id).slice(0, 12); return ''; };
const src = (s) => (s ? SRC[s] || s : '');
const rt = (r) => (r && ROUTE[r] ? ROUTE[r].t : r || '—');
const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) || /^0001-/.test(String(iso)) ? 0 : t; };
const agoT = (sec) => (sec == null || sec < 0 ? '' : sec < 60 ? Math.round(sec) + 's 전' : sec < 3600 ? Math.round(sec / 60) + 'm 전' : sec < 86400 ? Math.round(sec / 3600) + 'h 전' : Math.round(sec / 86400) + 'd 전');
const bytes = (n) => { let v = Number(n) || 0, i = 0; const U = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; while (v >= 1024 && i < U.length - 1) { v /= 1024; i += 1; } return (i ? v.toFixed(v < 10 ? 1 : 0) : String(v)) + U[i]; };
/** 후보 하나 → 화면 줄 */
const cand = (c) => ({ rt: c.route_type || '', rtT: rt(c.route_type), ad: c.adapter || '', healthy: !!c.healthy, lat: c.latency_ms != null ? c.latency_ms + 'ms' : '', reason: c.reason || '',
  from: ep(c.source && c.source.endpoint), to: ep(c.target && c.target.endpoint), probe: when(c.last_probe_at) });
/** 경로 그래프 간선 → 고를 후보(순서대로 첫 건강한 것, 없으면 첫 것) */
const pick = (e) => { const cs = arr(e && e.candidates); return cs.find((c) => c.healthy) || cs[0] || null; };

/**
 * 노드 기록 + 읽기 → 네트워크 속성 창 값. 순수(시험: net-props.test.mjs)
 * @param {Record<string, any>|null} rec terra.master.nodes.get 의 그 노드
 * @param {Record<string, any>} D 읽기 이름(NETP_READS 의 키) → 응답 data
 * @param {{ id?: string, names?: Map<string,string>, now?: number, miss?: string[] }} [o]
 */
export function netProps(rec, D = {}, o = {}) {
  const r = rec || {}, id = r.node_id || o.id || '', now = o.now ?? Date.now();
  const names = new Map(o.names || []); arr(D.status && D.status.nodes).forEach((n) => { if (n.node_id && n.display_name) names.set(n.node_id, n.display_name); });
  const nm = (x) => (x ? names.get(x) || String(x).slice(0, 10) : '—');
  const S = D.state || {}, st = arr(D.status && D.status.nodes).find((n) => n.node_id === id) || {};
  const nets = new Map(arr(S.networks).map((n) => [n.id, n]));
  const obs = arr(S.observed_transports).filter((x) => x.node_id === id);
  const boot = obs.filter((x) => x.adapter === 'wireguard-bootstrap').sort((a, b) => ts(b.observed_at) - ts(a.observed_at))[0] || null, det = (boot && boot.details) || {};
  const asg = arr(S.assignments).filter((a) => a.node_id === id);
  const wg = D.wg || null;

  // 주소 — 무엇인지 · 값 · 어디서 왔나. 없는 칸은 줄째 빼지 않고 '—'(무엇이 비었는지 보이게)
  const addrs = [
    { k: 'Terra 주소', v: r.cluster_address || '', src: '클러스터 안 노드 주소 · Master 배정', hint: 'Terra 전용 — 경로 아닌 이름' },
    { k: '.terra 이름', v: r.dns_label ? r.dns_label + '.terra' : '', src: 'Terra DNS' },
    ...asg.map((a) => { const n = nets.get(a.network_id) || {}; return { k: '사설망 IP', v: a.assigned_ip || '', src: (n.name || a.network_id || '사설망') + (n.cidr ? ' · ' + n.cidr : '') + (a.status && a.status !== 'active' ? ' · ' + a.status : ''), hint: 'WireGuard 인터페이스 주소 · 상대의 AllowedIPs' }; }),
    { k: 'mesh 인터페이스', v: wg && wg.address_cidr ? wg.address_cidr : '', src: wg ? 'WireGuard ' + (wg.interface_name || '') + (wg.ready === false ? ' · 준비 안 됨' + (wg.reason ? '(' + wg.reason + ')' : '') : '') : 'Daemon 읽기' },
    { k: '로컬(LAN)', v: det.lan_endpoint || '', src: det.lan_endpoint ? 'WireGuard 보고' : '' },
    { k: '공인 IP', v: det.nat_identity || '', src: src(det.nat_identity_source), hint: '나가는 공인 IPv4 — 같음 : 같은 NAT 뒤' },
    { k: '공인 endpoint', v: det.public_endpoint || '', src: src(det.public_source), hint: 'NAT 밖 상대의 접속 주소' },
    { k: 'WG 수신 포트', v: det.listen_port ? String(det.listen_port) : wg && wg.listen_port ? String(wg.listen_port) : '', src: det.listen_port ? 'WireGuard 보고' : wg && wg.listen_port ? '설정' : '' },
    { k: 'WG 공개키', v: (boot && boot.endpoint && boot.endpoint.public_key) || (wg && wg.public_key) || '', src: '' },
  ].map((a) => ({ ...a, v: a.v || '—' }));
  const natT = wg && wg.nat_mapping_mode ? wg.nat_mapping_mode + (arr(wg.nat_mapping_protocols).length ? ' · ' + wg.nat_mapping_protocols.join('/') : '') : '';
  const stunT = wg && arr(wg.stun_servers).length ? arr(wg.stun_servers).join(', ') + (wg.stun_source ? ' (' + wg.stun_source + ')' : '') : '';

  // 광고 중인 전송 — Master 메모리(TTL 2분). 관측 기록(24시간)은 같은 adapter 가 광고에 없을 때만 더한다
  const caps = arr(st.transport_capabilities).map((x) => { const c = x.capability || x; return { ad: c.adapter || '—', reach: REACH[c.reachability] || c.reachability || '—', ep: ep(c.endpoint) || '—',
    relay: !!c.requires_relay, on: c.enabled !== false, healthy: x.healthy, lat: x.latency_ms != null ? x.latency_ms + 'ms' : '', at: when(x.last_probe_at || c.updated_at), from: '광고' }; });
  for (const x of obs) if (x.adapter !== 'wireguard-bootstrap' && !caps.some((c) => c.ad === x.adapter)) caps.push({ ad: x.adapter, reach: REACH[x.reachability] || x.reachability || '—', ep: ep(x.endpoint) || '—', relay: !!x.requires_relay, on: true, healthy: undefined, lat: '', at: when(x.observed_at), from: '관측' });
  if (r.relay_connected || st.relay_connected) { if (!caps.some((c) => c.ad === 'websocket')) caps.push({ ad: 'websocket', reach: '인터넷', ep: 'Master 중계', relay: true, on: true, healthy: true, lat: '', at: '', from: 'relay 연결' }); }

  // 다른 노드와의 연결 — 경로 그래프의 두 방향 + WireGuard 쌍(Master 가 고른 endpoint · Daemon handshake) + probe 지연 + 열린 세션
  const L = new Map(), get = (p) => { if (!L.has(p)) L.set(p, { peerId: p, peer: nm(p), out: null, inn: null, denied: 0, wg: null, hs: null, probe: null, sess: [] }); return L.get(p); };
  for (const e of arr(D.graph && D.graph.edges)) {
    if (e.source_node_id === id) { const x = get(e.target_node_id); x.out = pick(e); x.denied += arr(e.denied_candidates).length; }
    else if (e.target_node_id === id) { const x = get(e.source_node_id); x.inn = pick(e); }
  }
  for (const p of arr(D.peers && D.peers.peers)) { const x = get(p.node_id), h = p.health || {}; x.wg = { ep: p.endpoint || '—', src: src(p.endpoint_source), ok: h.reachable, fresh: h.fresh, err: h.error_code || '', at: when(h.observed_at) }; }
  for (const p of arr(D.wgPeers && D.wgPeers.peers)) { if (!p.node_id) continue; const x = get(p.node_id); x.hs = { ago: agoT(p.seconds_since_handshake), healthy: !!p.healthy, stale: !!p.stale, never: !!p.never_seen, seen: p.endpoint || '', rx: bytes(p.transfer_rx_bytes), tx: bytes(p.transfer_tx_bytes) }; }
  for (const p of arr(D.probes && D.probes.probes)) {
    if (p.source_node_id !== id && p.target_node_id !== id) continue; const x = get(p.source_node_id === id ? p.target_node_id : p.source_node_id), q = p.result || {};
    if (!x.probe || ts(q.observed_at) > x.probe.t) x.probe = { t: ts(q.observed_at), ad: p.adapter || '', ok: !!q.reachable, fresh: !!p.fresh, lat: q.candidate && q.candidate.latency_ms != null ? q.candidate.latency_ms + 'ms' : '', err: q.error_code || '', at: when(q.observed_at) };
  }
  for (const s of arr(D.sessions && D.sessions.sessions)) {
    if (s.source_node_id !== id && s.target_node_id !== id) continue; const x = get(s.source_node_id === id ? s.target_node_id : s.source_node_id), h = s.health || {};
    x.sess.push({ dir: s.source_node_id === id ? '→' : '←', ch: s.channel || '—', rt: rt(s.route_type), ad: s.adapter || '', state: s.state || '—', err: h.last_error || '', sent: bytes(h.bytes_sent), recv: bytes(h.bytes_received), at: when(s.updated_at) });
  }
  L.delete(id); L.delete('');
  const links = [...L.values()].map((x) => {
    const c = x.out || x.inn, active = x.sess.find((s) => /active|open/i.test(s.state));
    // 지금 어떤 연결인가 — 열린 세션이 쓰는 경로 > 고를 후보 > WireGuard 쌍만 있으면 mesh
    const via = active ? { rtT: active.rt, ad: active.ad, from: '열린 세션' } : c ? { rtT: rt(c.route_type), ad: c.adapter || '', from: c.healthy ? '고를 경로' : '후보(건강하지 않음)' } : x.wg ? { rtT: 'mesh 직결', ad: 'wireguard', from: 'WireGuard 쌍' } : { rtT: '—', ad: '', from: '경로 없음' };
    const ok = active ? true : c ? !!c.healthy : x.wg ? !!x.wg.ok : false;
    return { ...x, via, ok, out: x.out && cand(x.out), inn: x.inn && cand(x.inn), lat: (c && c.latency_ms != null ? c.latency_ms + 'ms' : '') || (x.probe && x.probe.lat) || '' };
  }).sort((a, b) => (a.ok === b.ok ? a.peer.localeCompare(b.peer) : a.ok ? -1 : 1));

  return {
    real: true, miss: o.miss || [], id, name: r.display_name || nm(id),
    status: st.status || r.status || '—', relay: !!(r.relay_connected || st.relay_connected), gen: st.network_generation != null ? String(st.network_generation) : '—',
    epoch: D.graph && D.graph.route_graph_epoch != null ? String(D.graph.route_graph_epoch) : '—',
    addrs, nat: natT || '—', stun: stunT || '—', reported: boot ? when(boot.observed_at) : '—',
    nets: asg.map((a) => { const n = nets.get(a.network_id) || {}; return { name: n.name || a.network_id || '—', cidr: n.cidr || '—', gw: n.gateway || '—', dns: arr(n.dns).join(', ') || (typeof n.dns === 'string' ? n.dns : '') || '—', ip: a.assigned_ip || '—' }; }),
    caps, links, notReported: NOT_REPORTED,
  };
}

/** route.candidates.get → 펼친 쌍의 후보 · 거부 사유 */
export function pairCandidates(d) {
  return { cands: arr(d && d.candidates).map(cand), denied: arr(d && d.denied_candidates).map(cand), policy: (d && d.policy_source) || '', epoch: d && d.route_graph_epoch != null ? String(d.route_graph_epoch) : '' };
}

/**
 * 창이 부르는 것. Master 읽기는 15초 나눠 쓰고(창 여러 개가 두드리지 않게), Daemon 읽기는 노드마다
 * @param {{ invoke: (op: string, input?: object, at?: { node?: string }) => Promise<any> }} terra
 * @param {() => any} topo 지금 지도(window.TerraTopology) — node(rid) · localId
 */
export function createNetProps(terra, topo, ttl = 15000) {
  const cache = new Map();
  const once = (key, f) => { const c = cache.get(key); if (c && Date.now() - c.t < ttl) return c.p; const p = f().then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })); cache.set(key, { t: Date.now(), p }); return p; };
  const get = async (rid) => {
    if (!rid) return null;
    const T = topo(), rec = (T && T.node && T.node(rid)) || null, local = !!(T && T.localId && T.localId === rid), at = local ? {} : { node: rid };
    const jobs = {
      status: once('status', () => terra.invoke(NETP_READS.status, {})), state: once('state', () => terra.invoke(NETP_READS.state, {})),
      graph: once('graph', () => terra.invoke(NETP_READS.graph, {})), sessions: once('sessions', () => terra.invoke(NETP_READS.sessions, {})),
      probes: once('probes', () => terra.invoke(NETP_READS.probes, {})), peers: once('peers:' + rid, () => terra.invoke(NETP_READS.peers, { node_id: rid })),
      wg: once('wg:' + rid, () => terra.invoke(NETP_READS.wg, {}, at)), wgPeers: once('wgp:' + rid, () => terra.invoke(NETP_READS.wgPeers, {}, at)),
    };
    const K = Object.keys(jobs), got = await Promise.all(K.map((k) => jobs[k])), D = {}, miss = [];
    K.forEach((k, i) => { if (got[i].ok) D[k] = got[i].d; else miss.push(k + (got[i].e && got[i].e.code ? ' ' + got[i].e.code : '')); });
    return netProps(rec, D, { id: rid, miss });
  };
  get.pair = (a, b) => terra.invoke(NETP_READS.candidates, { source_node_id: a, target_node_id: b }).then(pairCandidates);
  get.clear = () => cache.clear();
  return get;
}
