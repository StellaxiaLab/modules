// 네트워크 속성 창 — 노드가 가진 주소 · 광고 중인 전송 · 다른 노드와 어떤 연결로 붙어 있는지. 상태 창과 같은 CLI 결, 바탕은 제어기 창처럼 불투명
//   실제(웹 빌드): window.TerraNetProps(rid) — src/api/net-props.js. Master network.status/state · route.graph/sessions · probes ·
//                  mesh.wireguard.peers + Daemon wireguard.status/peers(로컬은 바로, 다른 노드는 중계). 15초마다 다시 읽는다
//                  줄을 펼쳐 [후보 보기] → window.TerraNetProps.pair(rid, 상대) = route.candidates(후보 · 거부 사유 · 양쪽 endpoint)
//   시안(캔버스): 같은 모양의 예시 값 — net-props.js netProps() 와 칸 · 순서가 같다
//   근거: Terra docs/modules/terra-gui/design/unified-gui-ux/terra-gui-network-requirements.md · terra-protocol transport.go(route_type · reachability)
//   Terra 가 보고하지 않는 것(모든 IP · 서브넷 · WebRTC ICE 상태 · probe 실행)은 지어내지 않고 맨 아래에 그대로 적는다
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, info: null, open: '', pair: {} }; }
  componentDidMount() {
    this._live = true;
    this._iv = setInterval(() => { if (!this._live) return; const t = this.state.t + 1; this.setState({ t }); if (t % 15 === 0) this.pull(); }, 1000);
    this.pull();
  }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); }
  componentDidUpdate(prev) { if (prev && prev.nodeRid !== this.props.nodeRid) { this.setState({ info: null, open: '', pair: {} }); this.pull(); } }
  real() { return typeof window !== 'undefined' && typeof window.TerraNetProps === 'function'; }
  pull() {
    const rid = this.props.nodeRid; if (!this.real() || !rid) return;
    window.TerraNetProps(rid).then((info) => { if (this._live && this.props.nodeRid === rid && info) this.setState({ info }); }, () => {});
  }
  loadPair(peerId) {
    const rid = this.props.nodeRid, put = (v) => this._live && this.props.nodeRid === rid && this.setState({ pair: Object.assign({}, this.state.pair, { [peerId]: v }) });
    put({ busy: true });
    if (!this.real()) { setTimeout(() => put(this.samplePair(peerId)), 400); return; }
    window.TerraNetProps.pair(rid, peerId).then((v) => put(v), (e) => put({ err: (e && (e.code || e.message)) || '못 받음' }));
  }
  seed() { const nm = this.props.nodeName || 'node'; let h = 7; for (const ch of nm) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  /** 시안 값 — src/api/net-props.js netProps() 와 같은 모양 */
  sample() {
    const r = (i) => this.rnd(i), nm = this.props.nodeName || 'lab-ws-02', b = Math.floor(r(1) * 200) + 20, lanB = 10 + Math.floor(r(2) * 80), pub = '121.' + (100 + Math.floor(r(3) * 90)) + '.' + Math.floor(r(4) * 250) + '.' + Math.floor(r(5) * 250);
    const lan = '192.168.' + Math.floor(r(6) * 3) + '.' + lanB, behind = r(7) < 0.35, peers = ['01·a', '02', '03·c', 'nas-01', 'hanium'].filter((p) => p !== nm);
    const A = (k, v, src, hint) => ({ k, v: v || '—', src: src || '', hint: hint || '' });
    const L = (peer, rtT, ad, ok, lat, from, extra) => Object.assign({ peerId: 'nd_' + peer, peer, via: { rtT, ad, from }, ok, lat, denied: 0, out: null, inn: null, wg: null, hs: null, probe: null, sess: [] }, extra || {});
    return {
      real: false, miss: [], id: 'nd_' + nm, name: nm, status: 'online', relay: true, gen: String(3 + Math.floor(r(8) * 5)), epoch: String(10 + Math.floor(r(9) * 30)), reported: '11-02 13:58:20',
      addrs: [A('Terra 주소', '100.80.0.' + (10 + Math.floor(r(10) * 40)), '클러스터 안 노드 주소 · Master 배정', 'Terra 전용 — 경로 아닌 이름'), A('.terra 이름', nm.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.terra', 'Terra DNS'),
        A('사설망 IP', '10.40.2.' + b, 'home-mesh · 10.40.0.0/16', 'WireGuard 인터페이스 주소 · 상대의 AllowedIPs'), A('mesh 인터페이스', '10.40.2.' + b + '/16', 'WireGuard wg0'),
        A('로컬(LAN)', lan + ':51820', 'WireGuard 보고'), A('공인 IP', pub, 'STUN', '나가는 공인 IPv4 — 같음 : 같은 NAT 뒤'),
        A('공인 endpoint', behind ? '' : pub + ':51820', behind ? '' : 'UPnP', 'NAT 밖 상대의 접속 주소'), A('WG 수신 포트', '51820', 'WireGuard 보고'), A('WG 공개키', 'Qm3x' + Math.floor(r(11) * 1e6).toString(36) + '…', '')],
      nat: 'auto · pcp/nat_pmp/upnp', stun: 'stun.l.google.com:19302 (default)',
      nets: [{ name: 'home-mesh', cidr: '10.40.0.0/16', gw: '10.40.0.1', dns: '10.40.0.1', ip: '10.40.2.' + b }],
      caps: [{ ad: 'tcp', reach: 'LAN', ep: lan + ':17322', relay: false, on: true, healthy: true, lat: '2ms', from: '광고' }, { ad: 'wireguard', reach: 'mesh', ep: '10.40.2.' + b + ':17323', relay: false, on: true, healthy: true, lat: '', from: '광고' },
        { ad: 'webrtc', reach: '인터넷', ep: 'peer pc-' + nm.slice(0, 8), relay: true, on: true, healthy: undefined, lat: '', from: '광고' }, { ad: 'websocket', reach: '인터넷', ep: 'Master 중계', relay: true, on: true, healthy: true, lat: '', from: 'relay 연결' }],
      links: [
        L(peers[0], 'mesh 직결', 'wireguard', true, Math.round(3 + r(12) * 8) + 'ms', '고를 경로', { wg: { ep: '192.168.0.' + (lanB + 7) + ':51820', src: 'LAN', ok: true, fresh: true, err: '', at: '11-02 13:57:40' }, hs: { ago: Math.round(10 + r(13) * 90) + 's 전', healthy: true, stale: false, never: false, rx: '48MiB', tx: '12MiB' }, out: { rtT: 'mesh 직결', ad: 'wireguard', healthy: true, lat: '4ms' }, inn: { rtT: 'mesh 직결', ad: 'wireguard', healthy: true, lat: '' } }),
        L(peers[1], 'LAN 직결', 'tcp', true, Math.round(1 + r(14) * 3) + 'ms', '고를 경로', { probe: { ad: 'tcp', ok: true, fresh: true, lat: '2ms', err: '', at: '11-02 13:50:02' }, denied: 1, out: { rtT: 'LAN 직결', ad: 'tcp', healthy: true, lat: '2ms' } }),
        L(peers[2], 'Master 중계', 'websocket', true, '', '열린 세션', { sess: [{ dir: '←', ch: 'service.tunnel', rt: 'Master 중계', ad: 'websocket', state: 'active', err: '', sent: '2.0KiB', recv: '18KiB', at: '11-02 13:59:01' }] }),
        L(peers[3], 'WebRTC P2P', 'webrtc', false, '', '후보(건강하지 않음)', { wg: { ep: pub + ':51820', src: '공인', ok: false, fresh: false, err: 'WIREGUARD_HANDSHAKE_UNHEALTHY', at: '11-01 22:10:12' }, hs: { ago: '3d 전', healthy: false, stale: true, never: false, rx: '0B', tx: '1.2KiB' } }),
      ],
      notReported: ['모든 IP · 인터페이스 목록 · 서브넷 — Daemon 보고에 있음 · Master 는 LAN 주소 하나만 보관', 'WebRTC ICE 후보 · 고른 경로 쌍 · 연결 상태 — Terra 미제공', '연결 진단(probe) 새로 실행 — 위임 없음 (network.probes.post)'],
    };
  }
  samplePair(peerId) {
    const lan = peerId.length % 2 === 0;
    return { policy: 'default', epoch: '', cands: [{ rtT: 'mesh 직결', ad: 'wireguard', healthy: true, lat: '4ms', reason: 'mesh endpoints on same network', from: '10.40.2.17:17323', to: '10.40.2.2:17323' }].concat(lan ? [{ rtT: 'LAN 직결', ad: 'tcp', healthy: true, lat: '2ms', reason: 'fresh pairwise tcp/lan probe', from: '192.168.0.21:17322', to: '192.168.0.2:17322' }] : []).concat([{ rtT: 'Master 중계', ad: 'websocket', healthy: true, lat: '', reason: 'fallback allowed by policy', from: '', to: '' }]),
      denied: lan ? [] : [{ rtT: 'LAN 직결', ad: 'tcp', healthy: false, lat: '', reason: 'no fresh pairwise tcp probe' }] };
  }
  renderVals() {
    const R = this.real(), rid = this.props.nodeRid || '', I = R ? this.state.info : this.sample(), D = '—', S = this.state, kind = this.props.nodeKind || '노드';
    const OK = '#60e28c', WARN = '#ffd27a', BAD = '#ff9c8c', DIM = '#709c80';
    const note = R && !rid ? 'Terra 노드 목록에 없는 노드(시안 지도) — 값 없음' : R && !I ? '불러오는 중…' : I && I.miss && I.miss.length ? '읽지 못함 · ' + I.miss.join(' · ') + ' — 그 칸은 —' : '';
    const links = ((I && I.links) || []).map((l) => {
      const open = S.open === l.peerId, P = S.pair[l.peerId], col = l.ok ? OK : l.via.rtT === D ? DIM : WARN;
      const rows = [];
      if (l.out) rows.push({ k: '→ 보낼 때', v: l.out.rtT + ' · ' + (l.out.ad || D) + (l.out.lat ? ' · ' + l.out.lat : '') + (l.out.healthy ? '' : ' · 건강하지 않음'), col: l.out.healthy ? '' : WARN });
      if (l.inn) rows.push({ k: '← 받을 때', v: l.inn.rtT + ' · ' + (l.inn.ad || D) + (l.inn.lat ? ' · ' + l.inn.lat : '') + (l.inn.healthy ? '' : ' · 건강하지 않음'), col: l.inn.healthy ? '' : WARN });
      if (l.denied) rows.push({ k: '거부된 후보', v: l.denied + '개 — 사유 : [후보 보기]', col: DIM });
      if (l.wg) rows.push({ k: 'WireGuard', v: l.wg.ep + (l.wg.src ? ' (' + l.wg.src + ')' : '') + ' · ' + (l.wg.ok ? '닿음' : '닿지 않음') + (l.wg.err ? ' · ' + l.wg.err : '') + (l.wg.fresh === false ? ' · 오래됨' : ''), col: l.wg.ok ? '' : WARN });
      if (l.hs) rows.push({ k: 'handshake', v: (l.hs.never ? '한 번도 없음' : l.hs.ago || D) + ' · ↓ ' + l.hs.rx + ' ↑ ' + l.hs.tx + (l.hs.stale ? ' · 오래됨' : ''), col: l.hs.healthy ? '' : WARN });
      if (l.probe) rows.push({ k: '진단(probe)', v: l.probe.ad + ' · ' + (l.probe.ok ? '닿음' : '닿지 않음') + (l.probe.lat ? ' · ' + l.probe.lat : '') + (l.probe.err ? ' · ' + l.probe.err : '') + ' · ' + l.probe.at + (l.probe.fresh ? '' : ' · 오래됨'), col: l.probe.ok ? '' : WARN });
      for (const s of l.sess || []) rows.push({ k: '세션 ' + s.dir, v: s.ch + ' · ' + s.rt + (s.ad ? '/' + s.ad : '') + ' · ' + s.state + ' · ↑ ' + s.sent + ' ↓ ' + s.recv + (s.err ? ' · ' + s.err : ''), col: s.err ? WARN : '' });
      if (!rows.length) rows.push({ k: '기록', v: '이 쌍의 경로 · WireGuard · 세션 기록 없음', col: DIM });
      const cands = P && !P.busy && !P.err ? P.cands.map((q) => ({ mark: q.healthy ? '✓' : '!', col: q.healthy ? OK : WARN, rt: q.rtT, ad: q.ad, lat: q.lat, why: (q.from || q.to ? (q.from || '?') + ' → ' + (q.to || '?') + ' · ' : '') + q.reason }))
        .concat(P.denied.map((q) => ({ mark: '×', col: BAD, rt: q.rtT, ad: q.ad, lat: '', why: '거부 · ' + (q.reason || '사유 없음') }))) : [];
      return { peer: l.peer, mark: l.ok ? '●' : l.via.rtT === D ? '○' : '◐', col, rt: l.via.rtT, ad: l.via.ad || D, lat: l.lat || D, from: l.via.from, exp: open ? 'true' : 'false', open,
        toggle: () => this.setState({ open: open ? '' : l.peerId }), rows, cands,
        candT: P && P.busy ? '받는 중…' : P && !P.err ? '후보 다시' : '후보 보기', candOff: !!(P && P.busy), loadCand: () => this.loadPair(l.peerId),
        candNote: P && P.err ? '받지 못함 · ' + P.err : P && !P.busy ? '정책 ' + (P.policy || D) + ' · 후보 ' + P.cands.length + ' · 거부 ' + P.denied.length : 'route.candidates — 이 노드 → ' + l.peer };
    });
    const caps = ((I && I.caps) || []).map((c) => ({ ad: c.ad, reach: c.reach, ep: c.ep, from: c.from + (c.relay ? ' · 중계 필요' : ''), st: c.on === false ? '꺼짐' : c.healthy === true ? '✓' + (c.lat ? ' ' + c.lat : '') : c.healthy === false ? '!' : D, col: c.on === false ? DIM : c.healthy === true ? OK : c.healthy === false ? WARN : DIM }));
    const nOk = links.filter((l) => l.mark === '●').length;
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh',
      name: (I && I.name) || this.props.nodeName || D, kind, status: I ? I.status : D, stCol: I && /online/i.test(I.status) ? OK : I ? WARN : DIM,
      relayT: I ? (I.relay ? '연결됨' : '끊김') : D, relayCol: I && I.relay ? OK : BAD, gen: (I && I.gen) || D, epoch: (I && I.epoch) || D, reported: (I && I.reported) || D,
      src: R ? 'Master · Daemon 보고' : '시안 값', noteOn: !!note, note,
      addrs: ((I && I.addrs) || []).map((a) => ({ k: a.k, v: a.v, src: a.src || '', hint: a.hint || '', col: a.v === D ? '#4f6e5a' : '' })),
      nat: (I && I.nat) || D, stun: (I && I.stun) || D,
      nets: (I && I.nets) || [], netSum: I && I.nets && I.nets.length ? I.nets.length + '개' : '배정 없음',
      caps, capSum: caps.length ? caps.length + '개' : '광고 없음',
      links, linkSum: links.length ? nOk + ' / ' + links.length + ' 닿음' : '', noLinks: !!I && links.length === 0,
      gaps: ((I && I.notReported) || []).map((t) => ({ t })),
    };
  }
}
