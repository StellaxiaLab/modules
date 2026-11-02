// node --test — 네트워크 속성 창의 실제 값(주소 · 광고 전송 · 노드 간 연결). 모양은 Terra Master/Daemon 응답(origin/main 53043270)
import test from 'node:test';
import assert from 'node:assert/strict';
import { netProps, pairCandidates, createNetProps, NETP_READS } from './net-props.js';

const NOW = Date.parse('2026-11-02T08:00:00Z');
const REC = { node_id: 'n-desk', display_name: 'desk', cluster_address: '100.80.0.11', dns_label: 'desk', relay_connected: true, status: 'online' };
const D = {
  status: { route_graph_epoch: 9, nodes: [
    { node_id: 'n-desk', display_name: 'desk', status: 'online', relay_connected: true, network_generation: 4, transport_capabilities: [
      { capability: { adapter: 'tcp', reachability: 'lan', endpoint: { host: '192.168.0.21', port: 17322 }, enabled: true }, healthy: true, latency_ms: 3 },
      { capability: { adapter: 'webrtc', reachability: 'internet', requires_relay: true, endpoint: { peer_id: 'pc-n-desk-abcdef' } } }] },
    { node_id: 'n-srv', display_name: 'server' }, { node_id: 'n-rdk', display_name: 'hanium' }, { node_id: 'n-lap', display_name: 'laptop' }] },
  state: {
    networks: [{ id: 'net1', name: 'home-mesh', cidr: '10.40.0.0/16', gateway: '10.40.0.1', dns: ['10.40.0.1'] }],
    assignments: [{ node_id: 'n-desk', network_id: 'net1', assigned_ip: '10.40.2.17', status: 'active' }, { node_id: 'n-srv', network_id: 'net1', assigned_ip: '10.40.2.2' }],
    observed_transports: [
      { node_id: 'n-desk', adapter: 'wireguard-bootstrap', endpoint: { host: '121.157.70.45', port: 51820, public_key: 'Qm3xKEY' }, observed_at: '2026-11-02T07:58:00Z',
        details: { nat_identity: '121.157.70.45', nat_identity_source: 'stun', public_endpoint: '121.157.70.45:51820', public_source: 'stun_assumed', lan_endpoint: '192.168.0.21:51820', listen_port: 51820 } },
      { node_id: 'n-desk', adapter: 'wireguard', reachability: 'mesh', endpoint: { host: '10.40.2.17', port: 17323 }, observed_at: '2026-11-02T07:58:00Z' }],
  },
  graph: { route_graph_epoch: 9, edges: [
    { source_node_id: 'n-desk', target_node_id: 'n-srv', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true, latency_ms: 4 }, { route_type: 'cloud_relay', adapter: 'websocket', healthy: true }], denied_candidates: [{ route_type: 'lan_direct', reason: 'no fresh probe' }] },
    { source_node_id: 'n-srv', target_node_id: 'n-desk', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true }] },
    { source_node_id: 'n-desk', target_node_id: 'n-rdk', candidates: [{ route_type: 'webrtc_p2p', adapter: 'webrtc', healthy: false }] },
    { source_node_id: 'n-srv', target_node_id: 'n-rdk', candidates: [] }] },
  sessions: { sessions: [{ source_node_id: 'n-lap', target_node_id: 'n-desk', channel: 'service.tunnel', route_type: 'cloud_relay', adapter: 'websocket', state: 'active', health: { bytes_sent: 2048 } }] },
  probes: { probes: [{ source_node_id: 'n-desk', target_node_id: 'n-srv', adapter: 'tcp', fresh: true, result: { reachable: true, observed_at: '2026-11-02T07:50:00Z', candidate: { latency_ms: 2 } } }] },
  peers: { node_id: 'n-desk', peers: [{ node_id: 'n-srv', endpoint: '192.168.0.2:51820', endpoint_source: 'lan', health: { reachable: true, fresh: true } }] },
  wg: { interface_name: 'wg0', address_cidr: '10.40.2.17/16', listen_port: 51820, nat_mapping_mode: 'auto', nat_mapping_protocols: ['pcp', 'nat_pmp'], stun_servers: ['stun.l.google.com:19302'], ready: true },
  wgPeers: { peers: [{ node_id: 'n-srv', seconds_since_handshake: 42, healthy: true, endpoint: '192.168.0.2:51820', transfer_rx_bytes: 5 * 1048576, transfer_tx_bytes: 1024 }] },
};
const A = (v, k) => v.addrs.find((a) => a.k === k);

test('주소 — Terra 주소 · 사설망 · mesh 인터페이스 · LAN · 공인 IP/endpoint 와 출처', () => {
  const v = netProps(REC, D, { now: NOW });
  assert.equal(A(v, 'Terra 주소').v, '100.80.0.11'); assert.equal(A(v, '.terra 이름').v, 'desk.terra');
  assert.equal(A(v, '사설망 IP').v, '10.40.2.17'); assert.match(A(v, '사설망 IP').src, /home-mesh · 10\.40\.0\.0\/16/);
  assert.equal(A(v, 'mesh 인터페이스').v, '10.40.2.17/16'); assert.equal(A(v, '로컬(LAN)').v, '192.168.0.21:51820');
  assert.equal(A(v, '공인 IP').v, '121.157.70.45'); assert.equal(A(v, '공인 IP').src, 'STUN');
  assert.equal(A(v, '공인 endpoint').src, 'STUN(포트는 설정값 가정)'); assert.equal(A(v, 'WG 수신 포트').v, '51820');
  assert.equal(v.nat, 'auto · pcp/nat_pmp'); assert.deepEqual(v.nets[0], { name: 'home-mesh', cidr: '10.40.0.0/16', gw: '10.40.0.1', dns: '10.40.0.1', ip: '10.40.2.17' });
});

test('광고 전송 — Master 광고 + 관측만 있는 adapter + relay', () => {
  const v = netProps(REC, D, { now: NOW });
  assert.deepEqual(v.caps.map((c) => [c.ad, c.reach, c.ep, c.from]), [['tcp', 'LAN', '192.168.0.21:17322', '광고'], ['webrtc', '인터넷', 'peer pc-n-desk-ab', '광고'], ['wireguard', 'mesh', '10.40.2.17:17323', '관측'], ['websocket', '인터넷', 'Master 중계', 'relay 연결']]);
});

test('노드 간 연결 — 세션 > 고를 경로 > WireGuard 쌍, 지연 · 거부 수 · handshake', () => {
  const v = netProps(REC, D, { now: NOW }), by = Object.fromEntries(v.links.map((l) => [l.peer, l]));
  assert.equal(by.server.via.rtT, 'mesh 직결'); assert.equal(by.server.via.ad, 'wireguard'); assert.equal(by.server.ok, true); assert.equal(by.server.lat, '4ms'); assert.equal(by.server.denied, 1);
  assert.equal(by.server.wg.src, 'LAN'); assert.equal(by.server.hs.ago, '42초 전'); assert.equal(by.server.hs.rx, '5.0 MB'); assert.equal(by.server.inn.rtT, 'mesh 직결');
  assert.equal(by.laptop.via.rtT, 'Master 중계'); assert.equal(by.laptop.via.from, '열린 세션'); assert.equal(by.laptop.sess[0].dir, '←');
  assert.equal(by.hanium.via.rtT, 'WebRTC P2P'); assert.equal(by.hanium.ok, false);
  assert.deepEqual(v.links.map((l) => l.peer), ['laptop', 'server', 'hanium']);   // 닿는 것 먼저
  assert.equal(v.epoch, '9'); assert.equal(v.gen, '4');
});

test('보고가 없으면 — 주소 칸은 — (지어내지 않는다), 연결 없음', () => {
  const v = netProps({ node_id: 'x' }, {}, { now: NOW });
  assert.ok(v.addrs.every((a) => a.v === '—')); assert.equal(v.links.length, 0); assert.equal(v.caps.length, 0); assert.ok(v.notReported.length >= 3);
});

test('pairCandidates — 후보 · 거부 사유 · 양쪽 endpoint', () => {
  const p = pairCandidates({ route_graph_epoch: 9, policy_source: 'default', candidates: [{ route_type: 'lan_direct', adapter: 'tcp', healthy: true, latency_ms: 2, reason: 'fresh pairwise tcp/lan probe', source: { endpoint: { host: '192.168.0.21', port: 17322 } }, target: { endpoint: { host: '192.168.0.2', port: 17322 } } }], denied_candidates: [{ route_type: 'webrtc_p2p', reason: 'policy deny' }] });
  assert.equal(p.cands[0].rtT, 'LAN 직결'); assert.equal(p.cands[0].from, '192.168.0.21:17322'); assert.equal(p.denied[0].reason, 'policy deny'); assert.equal(p.policy, 'default');
});

test('createNetProps — 로컬은 Daemon 을 바로, 다른 노드는 중계 · 실패는 miss · 캐시', async () => {
  const calls = [];
  const terra = { invoke: (op, input, at = {}) => { calls.push([op, at.node || '']); const k = Object.keys(NETP_READS).find((x) => NETP_READS[x] === op); if (k === 'wgPeers' && at.node) return Promise.reject(Object.assign(new Error('x'), { code: 'DELEGATION_REQUIRED' })); return Promise.resolve(D[k]); } };
  const get = createNetProps(terra, () => ({ localId: 'n-desk', node: (id) => (id === 'n-desk' ? REC : { node_id: id }) }));
  const v = await get('n-desk'); assert.deepEqual(v.miss, []); assert.ok(calls.some(([op, n]) => op === NETP_READS.wg && n === ''));
  const w = await get('n-srv'); assert.deepEqual(w.miss, ['wgPeers DELEGATION_REQUIRED']); assert.ok(calls.some(([op, n]) => op === NETP_READS.wg && n === 'n-srv'));
  const before = calls.length; await get('n-desk'); assert.equal(calls.length, before);
  assert.equal(await get(''), null);
});
