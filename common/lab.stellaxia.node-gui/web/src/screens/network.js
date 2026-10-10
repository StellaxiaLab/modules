// 네트워크 — 디자인 캔버스 원본 design/Network.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    // ── 예시 데이터 (필드 이름은 요구사항 §5의 응답 필드를 따른다) ──
    this.NODES = [
      { id: 'tree-home', role: 'Tree · Leaf', status: 'online', relay: true, ip: '10.60.0.1', net: 'net_home', desired: 'wireguard', observed: 'internet', obsGen: 42, push: 'accepted', lat: null, x: 380, y: 60 },
      { id: 'edge-01', role: 'Leaf', status: 'online', relay: true, ip: '10.60.0.11', net: 'net_home', desired: 'wireguard', observed: 'lan', obsGen: 42, push: 'accepted', lat: 12, x: 150, y: 170 },
      { id: 'nas-01', role: 'Leaf', status: 'online', relay: true, ip: '10.60.0.12', net: 'net_home', desired: 'wireguard', observed: 'lan', obsGen: 42, push: 'accepted', lat: 8, x: 290, y: 230 },
      { id: 'tree-lab', role: 'Tree', status: 'online', relay: true, ip: '10.60.0.20', net: 'net_home', desired: 'wireguard', observed: 'internet', obsGen: 42, push: 'accepted', lat: 24, x: 520, y: 180 },
      { id: 'gpu-01', role: 'Leaf', status: 'online', relay: true, ip: '10.60.0.31', net: 'net_home', desired: 'wireguard', observed: 'mesh', obsGen: 41, push: 'sent', lat: 31, x: 440, y: 300 },
      { id: 'gpu-02', role: 'Leaf', status: 'online', relay: true, ip: '10.60.0.32', net: 'net_home', desired: 'wireguard', observed: 'mesh', obsGen: 41, push: 'rejected', lat: 46, x: 580, y: 310 },
      { id: 'bench-pi', role: 'Leaf', status: 'online', relay: true, ip: '10.60.0.33', net: 'net_home', desired: 'wireguard', observed: 'mesh', obsGen: 42, push: 'accepted', lat: 19, x: 700, y: 250 },
      { id: 'laptop-03', role: 'Leaf', status: 'offline', relay: false, ip: '10.60.0.40', net: 'net_home', desired: 'wireguard', observed: null, obsGen: 0, push: 'deferred_offline', lat: null, x: 90, y: 300 }
    ];
    // 라우트 그래프 edges — 가장 좋은 후보의 route_type
    this.EDGES = [['tree-home', 'edge-01', 'lan_direct'], ['tree-home', 'nas-01', 'lan_direct'], ['edge-01', 'nas-01', 'lan_direct'], ['tree-home', 'tree-lab', 'mesh_vpn_direct'],
      ['tree-lab', 'gpu-01', 'lan_direct'], ['tree-lab', 'gpu-02', 'lan_direct'], ['tree-lab', 'bench-pi', 'lan_direct'], ['tree-home', 'gpu-01', 'mesh_vpn_direct'], ['tree-home', 'bench-pi', 'webrtc_p2p'],
      ['tree-home', 'laptop-03', 'cloud_relay'], ['nas-01', 'gpu-02', 'cloud_relay']];
    this.state = {
      help: this.readHelp(),
      role: 'tree', demo: 'ok', sec: 'mesh', sub: { route: 'graph', tunnel: 'sessions' }, polledAt: Date.now() - 4000, now: Date.now(),
      dlg: null, toasts: [], busy: {},
      reconcile: { status: 'updated', reason: '데몬이 보고한 키 · endpoint로 desired를 다시 만들었습니다', at: '18:52', eligible: 7, updated: 2, removed: 0 },
      networks: [
        { id: 'net_home', name: 'home-lan', cidr: '10.60.0.0/24', gateway: '10.60.0.1', dns: '10.60.0.1', status: 'active' },
        { id: 'net_lab', name: 'lab-net', cidr: '10.61.0.0/24', gateway: '10.61.0.1', dns: '—', status: 'active' }
      ],
      pair: { src: 'tree-home', dst: 'gpu-01', channel: 'service.tunnel' },
      probes: [
        { id: 'probe_7a1', src: 'tree-home', dst: 'edge-01', adapter: 'tcp', reachable: true, fresh: true, stale: '', at: '18:57:40', err: '' },
        { id: 'probe_7a4', src: 'tree-home', dst: 'gpu-01', adapter: 'wireguard', reachable: true, fresh: false, stale: 'network_generation_mismatch', at: '18:31:02', err: '' },
        { id: 'probe_6f0', src: 'tree-home', dst: 'laptop-03', adapter: 'tcp', reachable: false, fresh: false, stale: 'unreachable', at: '18:44:19', err: 'TCP_PROBE_FAILED' }
      ],
      waitProbe: null,
      policies: [
        { id: 'rp-01', src: 'tree-home', dst: 'gpu-01', channel: 'service.tunnel', mode: 'prefer', prefer: 'mesh_vpn_direct', fallback: 'cloud_relay', at: '어제 21:10', checked: 'ok' },
        { id: 'rp-02', src: '*', dst: 'laptop-03', channel: '*', mode: 'relay_only', prefer: '—', fallback: '—', at: '09-27 14:02', checked: 'ok' },
        { id: 'rp-03', src: 'edge-01', dst: 'gpu-02', channel: 'stream', mode: 'only', prefer: 'lan_direct', fallback: '—', at: '방금', checked: 'bad' }
      ],
      sessions: [
        { id: 'rt_8f2c', src: 'tree-home', dst: 'nas-01', channel: 'service.tunnel', rt: 'lan_direct', state: 'active', sent: '1.8 GB', recv: '42 MB', trace: '' },
        { id: 'rt_91ad', src: 'edge-01', dst: 'tree-home', channel: 'service.tunnel', rt: 'lan_direct', state: 'active', sent: '310 MB', recv: '6 MB', trace: '' },
        { id: 'rt_a07e', src: 'tree-home', dst: 'gpu-01', channel: 'service.tunnel', rt: 'mesh_vpn_direct', state: 'opening', sent: '—', recv: '—', trace: 'plan' },
        { id: 'rt_b33f', src: 'tree-home', dst: 'gpu-02', channel: 'service.tunnel', rt: 'cloud_relay', state: 'failed', sent: '0 B', recv: '0 B', trace: '' }
      ],
      groups: [{ id: 'cg_19', name: '야간 백업', sessions: ['rt_8f2c', 'rt_91ad'], state: 'opening' }],
      decls: [
        { id: 'stdecl_01', src: 'nas-01', dst: 'tree-home', service: 'nas-01.smb', lport: 4450, tport: 445, policy: 'lan-preferred', enabled: true },
        { id: 'stdecl_02', src: 'bench-pi', dst: 'tree-home', service: 'bench-pi.web', lport: 3000, tport: 3000, policy: 'auto', enabled: true }
      ],
      plan: { src: 'tree-home', dst: 'gpu-01', service: 'gpu-01.jupyter', tport: '8888', lport: '0', policy: 'secure-mesh-only' },
      // leaf (edge-01) — 로컬 터널 · WireGuard
      ltunnels: [
        { id: 'tun_4b1', service: 'edge-01.rtsp', src: 'edge-01', dst: 'tree-home', local: '127.0.0.1:8554', target: '127.0.0.1:554', status: 'active', act: 2, total: 31, failed: 0, sent: '310 MB', recv: '6 MB', err: '' },
        { id: 'tun_4c7', service: 'tree-home.ssh', src: 'edge-01', dst: 'tree-home', local: '127.0.0.1:2222', target: '127.0.0.1:22', status: 'listening', act: 0, total: 4, failed: 1, sent: '2 MB', recv: '1 MB', err: '' }
      ],
      wg: { enabled: true, installed: true, ready: true, mode: 'managed', iface: 'terra0', addr: '10.60.0.11/24', port: 51820, pub: 'mE3kQ9…t2Zq=', helper: true, observed: true, keyAt: '09-12' },
      peers: [
        { name: 'tree-home', pub: 'Hq1x…9aB=', ep: '203.0.113.20:51820', allowed: '10.60.0.1/32', hs: 12, rx: '1.2 GB', tx: '310 MB' },
        { name: 'nas-01', pub: 'Zp8m…Lk0=', ep: '192.168.0.30:51820', allowed: '10.60.0.12/32', hs: 41, rx: '48 MB', tx: '12 MB' },
        { name: 'tree-lab', pub: 'Ua3v…Qw7=', ep: '203.0.113.7:51820', allowed: '10.60.0.20/32, 10.61.0.0/24', hs: 262, rx: '6 MB', tx: '5 MB' },
        { name: 'laptop-03', pub: 'Rt5c…Jn2=', ep: '(없음)', allowed: '10.60.0.40/32', hs: null, rx: '0 B', tx: '0 B' }
      ],
      logs: [
        { at: '18:52:10', action: 'mesh.wireguard.reconcile', type: 'cluster', target: 'home', result: 'updated', detail: '2개 노드 갱신' },
        { at: '18:47:33', action: 'route.policy.put', type: 'route_policy', target: 'rp-03', result: 'created', detail: 'edge-01 → gpu-02 · only lan_direct' },
        { at: '18:44:19', action: 'network.probe', type: 'probe', target: 'tree-home → laptop-03', result: 'accepted', detail: 'message msg_91f2' },
        { at: '18:31:55', action: 'service_tunnel.plan', type: 'route_session', target: 'rt_a07e', result: 'created', detail: 'gpu-01.jupyter — 열지 않음' },
        { at: '18:12:06', action: 'mesh.wireguard.peer.revoke', type: 'peer', target: 'bench-pi ↔ laptop-03', result: 'revoked', detail: '양방향' }
      ],
      logFilter: 'all'
    };
  }
  componentDidMount() { this._tick = setInterval(() => this.setState({ now: Date.now() }), 1000); this._onStore = (e) => { if (e.key === 'terra.gui.innerHelp') this.setState({ help: e.newValue === '1' }); }; try { window.addEventListener('storage', this._onStore); } catch (e) { /* 무시 */ } }
  componentWillUnmount() { clearInterval(this._tick); (this._ts || []).forEach(clearTimeout); try { window.removeEventListener('storage', this._onStore); } catch (e) { /* 무시 */ } }
  // 이너 도움말(설정 › 일반) — 끄면 회색 설명 글(부제 · 꼬리말 · 안내 배너 · 입력 힌트)을 숨긴다. 경고 · 오류 · 상태는 남긴다
  readHelp() { try { return window.localStorage.getItem('terra.gui.innerHelp') === '1'; } catch (e) { return false; } }
  later(ms, f) { this._ts = this._ts || []; this._ts.push(setTimeout(f, ms)); }
  hm(t) { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':'); }
  toast(g, c, title, text) { const id = Math.random(); this.setState({ toasts: this.state.toasts.concat([{ id, g, c, title, text }]).slice(-3) }); this.later(4200, () => this.setState({ toasts: this.state.toasts.filter((t) => t.id !== id) })); }
  setBusy(k, v) { this.setState({ busy: Object.assign({}, this.state.busy, { [k]: v }) }); }
  confirm(o) { this.setState({ dlg: o }); }
  // 색 · 배지 사전
  T() {
    return {
      ok: ['rgba(62,207,142,0.10)', '#3ecf8e'], warn: ['rgba(245,184,61,0.10)', '#f5b83d'], bad: ['rgba(255,93,93,0.10)', '#ff5d5d'], info: ['rgba(122,167,255,0.10)', '#7aa7ff'], off: ['rgba(255,255,255,0.04)', '#9aa1ab'], vio: ['rgba(180,140,255,0.10)', '#b48cff']
    };
  }
  RT() { return { local_loopback: '#9aa1ab', lan_direct: '#3ecf8e', mesh_vpn_direct: '#5aa8ff', webrtc_p2p: '#b48cff', cloud_relay: '#b4bac3' }; }
  // 표 셀 만들기
  cT(t, o) { return Object.assign({ isT: true, isB: false, isBtn: false, t: String(t), c: '#ede9e1', fw: 400, cls: '', sub: '', tip: '' }, o || {}); }
  cM(t, o) { return this.cT(t, Object.assign({ cls: 'mono' }, o || {})); }
  cB(t, tone, o) { const x = this.T()[tone] || this.T().off; return Object.assign({ isT: false, isB: true, isBtn: false, t: String(t), bb: x[0], bf: x[1], g: '', cls: '', sub: '', tip: '' }, o || {}); }
  cBtn(btns) { return { isT: false, isB: false, isBtn: true, btns: btns.map((b) => Object.assign({ tip: '', dis: 'false', cur: 'pointer', op: 1, line: b.danger ? 'rgba(255,93,93,0.45)' : 'rgba(255,255,255,0.18)', fg: b.danger ? '#ff5d5d' : '#ede9e1' }, b)) }; }
  table(o) {
    // o: title, sub, span, cols, head[], rows[{cells[], hl}], empty, foot, tags, acts
    const cells = [];
    (o.rows || []).forEach((r) => r.cells.forEach((c) => cells.push(Object.assign({ rowBg: r.hl || 'transparent', op: r.op == null ? 1 : r.op, pad: c.isBtn ? '5px 10px' : '8px 12px' }, c))));
    return this.block(o, { isTable: true, cols: o.cols, head: o.head.map((t) => ({ t })), cells, isEmpty: !(o.rows || []).length, empty: o.empty || '없음' });
  }
  block(o, extra) {
    const H = this.state.help;
    const r = Object.assign({ span: o.span || 12, bg: 'rgba(13,15,19,0.70)', line: 'rgba(255,255,255,0.10)', hasHead: !!o.title, title: o.title || '', sub: H ? o.sub || '' : '', tags: o.tags || [], acts: (o.acts || []).map((a) => this.act(a)),
      isBanner: false, isTable: false, isKv: false, isGraph: false, isForm: false, isSteps: false, isState: false, isActs: false, running: false, runText: '', runPct: 0, rows: [], hasFoot: !!o.foot, foot: o.foot || '', isEmpty: false, bActs: [] }, extra || {});
    if (!H && r.hasFoot && String(r.foot).charAt(0) !== '⟳') { r.hasFoot = false; }
    if (!H && r.fields) r.fields = r.fields.map((f) => Object.assign({}, f, { hint: /^(⚠|서로)/.test(f.hint || '') ? f.hint : '' }));
    return r;
  }
  act(a) {
    const k = a.kind || 'normal', busy = a.busy;
    const P = { primary: ['#ede9e1', '#ede9e1', '#111111'], danger: ['rgba(255,93,93,0.45)', 'rgba(255,93,93,0.06)', '#ff5d5d'], normal: ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.04)', '#ede9e1'], warn: ['rgba(245,184,61,0.5)', 'rgba(245,184,61,0.08)', '#f5b83d'] }[k];
    return { label: busy ? a.busyLabel || '실행 중…' : a.label, tip: a.tip || '', run: a.dis || busy ? () => {} : a.run, line: P[0], bg: P[1], fg: P[2], dis: a.dis || busy ? 'true' : 'false', cur: a.dis ? 'not-allowed' : busy ? 'wait' : 'pointer', op: a.dis ? 0.5 : 1, g: busy ? '⟳' : a.g || '', spin: busy ? 'spin' : '' };
  }
  tag(t, tone, tip) { const x = this.T()[tone] || this.T().off; return { t, bg: x[0], fg: x[1], tip: tip || '' }; }
  banner(tone, icon, title, text, acts, span) {
    if (tone === 'info' && !this.state.help && !(acts || []).length) return null; // 안내 배너는 도움말과 함께 숨긴다
    const x = this.T()[tone];
    return this.block({ span: span || 12 }, { hasHead: false, isBanner: true, bg: x[0], line: 'color-mix(in srgb, ' + x[1] + ' 40%, transparent)', tint: x[0], fg: x[1], icon, bTitle: title, text, bActs: (acts || []).map((a) => ({ label: a.label, run: a.run, line: 'rgba(255,255,255,0.18)', fg: '#ede9e1' })) });
  }
  kv(o, items, cols) { return this.block(o, { isKv: true, kvCols: cols || 4, items: items.map((i) => Object.assign({ bg: 'rgba(255,255,255,0.04)', line: 'rgba(255,255,255,0.07)', c: '#ede9e1', cls: '', tip: '' }, i)) }); }
  stateBlock(icon, tone, title, text, acts) {
    const x = this.T()[tone];
    return this.block({ span: 12 }, { hasHead: false, isState: true, tint: x[0], fg: x[1], icon, sTitle: title, text, bActs: (acts || []).map((a) => ({ label: a.label, run: a.run, line: 'rgba(255,255,255,0.18)', fg: '#ede9e1' })) });
  }
  // 접수형 · 실행 중 흉내
  runSync(key, ms, done, fail) {
    this.setBusy(key, true);
    this.later(ms, () => { this.setBusy(key, false); if (fail) fail(); else done(); });
  }
  // ───── 묶음별 화면 ─────
  meshBlocks() {
    const S = this.state, st = this.T(), R = S.reconcile;
    const pushTone = { accepted: 'ok', sent: 'info', pending: 'off', deferred_offline: 'warn', rejected: 'bad', failed: 'bad' };
    const pushT = { accepted: '적용됨', sent: '보냄', pending: '대기', deferred_offline: '오프라인 — 미룸', rejected: '거절', failed: '실패' };
    const bad = this.NODES.filter((n) => n.push === 'rejected' || n.push === 'failed');
    const mism = this.NODES.filter((n) => n.observed && n.obsGen < 42);
    const recTone = { updated: 'ok', unchanged: 'off', waiting_for_nodes: 'warn', manual_override: 'warn' }[R.status];
    const out = [];
    if (bad.length) out.push(this.banner('bad', 'warn', '일부 배포 실패 (degraded)', '배포 ' + this.NODES.length + '개 중 ' + bad.length + '개가 거절됐습니다 — ' + bad.map((n) => n.id).join(', ') + '. 나머지 노드는 정상입니다. 노드 행에서 원인을 보고, 자동 조정을 다시 실행하세요.', [{ label: '거절된 노드만 보기', run: () => this.toast('◇', '#7aa7ff', '거르기', '시연 화면에서는 표에 빨간 줄로 표시됩니다') }]));
    out.push(this.kv({ span: 7, title: 'mesh 자동 조정', sub: '데몬이 보고한 키 · endpoint로 desired를 다시 만든다',
      tags: [this.tag(R.status, recTone, 'waiting_for_nodes · manual_override · unchanged · updated')],
      acts: [{ label: '자동 조정 실행', kind: 'danger', busy: S.busy.reconcile, busyLabel: '조정 중…', run: () => this.confirm({ op: 'terra.master.network.mesh.wireguard.reconcile.post', title: 'mesh 자동 조정을 실행할까요?', rows: [['대상', 'home 클러스터 · 적격 노드 ' + R.eligible + '개'], ['결과', '바뀐 노드에 새 desired를 배포'], ['되돌리기', '없음 — 다시 조정하거나 수동 계획']], warn: '수동 계획을 적용한 뒤에는 manual_override로 답하고 아무것도 바꾸지 않습니다.', okLabel: '조정 실행',
          ok: () => this.runSync('reconcile', 1300, () => { this.setState({ reconcile: Object.assign({}, R, { status: 'unchanged', reason: '바뀐 키 · endpoint가 없습니다', at: this.hm(Date.now()).slice(0, 5), updated: 0 }) }); this.toast('●', '#3ecf8e', '자동 조정 — unchanged', '적격 7 · 갱신 0 · 제거 0'); }) }) },
        { label: '수동 계획 적용…', kind: 'warn', tip: '미리보기가 아니라 적용이다', run: () => this.confirm({ op: 'terra.master.network.mesh.wireguard.plan.post', title: '수동 계획은 곧바로 적용됩니다', rows: [['동작', '네트워크 · 할당 · desired를 저장하고 노드에 배포'], ['이후', '자동 조정이 manual_override로 멈춤'], ['되돌리기', '없음 — 미리보기 API가 없다']], warn: '이름은 plan이지만 미리보기가 아닙니다. 노드와 공개 키를 넣는 폼은 이 확인 다음 단계에 둡니다(시연에서는 생략).', okLabel: '이해했음 — 폼 열기', ok: () => this.toast('◇', '#7aa7ff', '수동 계획', '시연 화면 — 폼은 아직 없습니다') }) }] },
      [{ k: '마지막 결과', v: R.status, c: st[recTone][1], cls: 'mono' }, { k: '실행 시각', v: R.at, cls: 'mono' }, { k: '적격 노드', v: R.eligible, cls: 'mono' }, { k: '갱신 · 제거', v: R.updated + ' · ' + R.removed, cls: 'mono' }], 4));
    out[out.length - 1].foot = R.reason;
    out[out.length - 1].hasFoot = true;
    out.push(this.table({ span: 5, title: '논리 네트워크 (CIDR)', sub: 'network.networks.*', cols: '1fr 1.3fr 0.8fr',
      acts: [{ label: '+ CIDR', run: () => this.toast('!', '#f5b83d', '같은 CIDR은 통째로 바꿉니다', '생성 폼에 이 경고를 붙입니다 (시연에서는 폼 생략)') }],
      head: ['이름', 'CIDR', '상태'],
      rows: S.networks.map((n) => ({ cells: [this.cT(n.name, { fw: 700, sub: n.id }), this.cM(n.cidr, { sub: 'gw ' + n.gateway }), this.cB(n.status, n.status === 'active' ? 'ok' : 'off')] })),
      foot: '관리자 계정만 클러스터 선택 칸이 붙는다 — 일반 사용자는 로그인 때 받은 자기 클러스터로 정해진다.' }));
    out.push(this.table({ span: 12, title: '노드 × 네트워크', sub: 'network.state.get · network.status.get — desired와 observed를 나란히',
      tags: mism.length ? [this.tag('desired ≠ observed ' + mism.length, 'warn', '적용 전 · 적용 중 · 어긋남')] : [],
      cols: '1.2fr 0.8fr 1fr 0.9fr 1.3fr 1.2fr 0.9fr',
      head: ['노드', '상태', 'IP (home-lan)', 'desired', 'observed', '배포', ''],
      rows: this.NODES.map((n) => {
        const mis = n.observed && n.obsGen < 42, off = n.status === 'offline';
        return { hl: n.push === 'rejected' ? 'rgba(255,93,93,0.07)' : mis ? 'rgba(245,184,61,0.06)' : 'transparent', op: off ? 0.7 : 1, cells: [
          this.cM(n.id, { fw: 700, sub: /tree/i.test(n.role) ? 'tree' : '' }),
          this.cB(off ? 'offline' : 'online', off ? 'off' : 'ok', { tip: 'relay_connected: ' + n.relay }),
          this.cM(n.ip),
          this.cB(n.desired, 'info', { tip: 'desired transport' }),
          n.observed ? this.cB(n.observed + (mis ? ' · gen ' + n.obsGen : ''), mis ? 'warn' : 'ok', { tip: 'observed reachability · network_generation', sub: mis ? '42 기다림' : '' }) : this.cT('관측 없음', { c: '#8a919b' }),
          this.cB(pushT[n.push], pushTone[n.push], { tip: 'wireguard_push_deliveries[].status = ' + n.push, sub: n.push === 'rejected' ? '키 불일치' : '' }),
          this.cBtn(n.id === 'tree-home' ? [] : [{ label: '철회', danger: true, tip: 'peer 철회 — 위험', run: () => this.confirm({ op: 'terra.master.network.mesh.wireguard.peers.revoke.post', title: n.id + ' peer를 철회할까요?', rows: [['source', 'tree-home'], ['target', n.id], ['방향', '양방향 (bidirectional: true)'], ['되돌리기', '다시 조정해야 복구 — 즉시 끊긴다']], warn: '철회는 바뀐 노드에 바로 배포됩니다. 오프라인 노드는 다음 연결 때 받습니다.', okLabel: '철회',
            ok: () => this.toast('●', '#3ecf8e', 'peer 철회 — revoked', 'tree-home ↔ ' + n.id + ' · 배포 2건 sent') }) }])
        ] };
      }),
      foot: '배포 결과(wireguard_push_deliveries): pending · deferred_offline · sent · accepted · rejected · failed. 노란 줄 = observed의 network_generation이 desired보다 옛것(적용 중 또는 어긋남). 빨간 줄 = 배포 거절.' }));
    return out;
  }
  routeBlocks() {
    const S = this.state, sub = S.sub.route, RT = this.RT();
    const tabs = [['graph', '그래프 · 진단'], ['policy', '정책'], ['sessions', '세션 · 연결 그룹']];
    const out = [];
    if (sub === 'graph') {
      const pos = {}; this.NODES.forEach((n) => { pos[n.id] = n; });
      const P = S.pair;
      const onPair = (a, b) => (a === P.src && b === P.dst) || (a === P.dst && b === P.src);
      out.push(this.block({ span: 7, title: '라우트 그래프', sub: 'route.graph.get · epoch 42', tags: [this.tag('partial', 'warn', '계산에 실패한 쌍은 오류 없이 빠진다 — gpu-02 ↔ bench-pi 없음')] }, {
        isGraph: true, gw: 800, gh: 380,
        edges: this.EDGES.map(([a, b, t]) => ({ x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y, c: RT[t], w: onPair(a, b) ? 4 : 2.2, dash: t === 'cloud_relay' ? '6 5' : t === 'webrtc_p2p' ? '2 5' : 'none', op: onPair(a, b) ? 1 : 0.7 })),
        gnodes: this.NODES.map((n) => { const sel = n.id === P.src || n.id === P.dst;
          return { x: n.x, y: n.y, name: n.id, r: sel ? 17 : 14, line: sel ? '#ffd84d' : n.status === 'offline' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.38)', lw: sel ? 3 : 1.5, c: /tree/i.test(n.role) ? '#f0a63a' : '#5aa8ff', op: n.status === 'offline' ? 0.55 : 1, ty: 30, ty2: 42, fw: sel ? 700 : 500,
            tag: n.id === P.src ? 'source' : n.id === P.dst ? 'target' : '', tagC: '#ffd84d',
            pick: () => this.setState({ pair: n.id === P.src ? P : Object.assign({}, P, n.id === P.dst ? { src: P.dst, dst: P.src } : { dst: n.id }) }) }; }),
        legend: Object.keys(RT).filter((k) => k !== 'local_loopback').map((k) => ({ t: k, c: RT[k], style: k === 'cloud_relay' || k === 'webrtc_p2p' ? 'dashed' : 'solid' }))
      }));
      // 노드 쌍 · probe
      const nodeOpts = (v) => this.NODES.map((n) => ({ v: n.id, t: n.id + (n.status === 'offline' ? ' (offline)' : ''), sel: n.id === v ? 'selected' : null }));
      const set = (k) => (e) => this.setState({ pair: Object.assign({}, this.state.pair, { [k]: e.target.value }) });
      const waiting = S.waitProbe && S.waitProbe.src === P.src && S.waitProbe.dst === P.dst;
      const tgt = this.NODES.find((n) => n.id === P.dst), off = tgt && tgt.status === 'offline';
      const pf = this.block({ span: 5, title: '노드 쌍', sub: '그래프에서 누르면 target이 바뀐다',
        acts: [{ label: 'probe 실행', kind: 'primary', busy: S.busy.probe, busyLabel: '보내는 중…', dis: P.src === P.dst, tip: 'network.probes.post — 접수만 한다(202). probe id는 오지 않는다',
          run: () => this.runSync('probe', 700, () => {
            if (off) { this.toast('■', '#ff5d5d', '409 PROBE_TARGET_UNAVAILABLE', P.dst + '에 relay 없이 닿는 건강한 capability가 없습니다 · 다시 시도할 수 있음'); return; }
            this.setState({ waitProbe: { src: P.src, dst: P.dst, since: Date.now() } });
            this.toast('◇', '#7aa7ff', 'accepted — 결과를 기다리는 중', 'message_id msg_' + Math.floor(Math.random() * 9000 + 1000) + ' · 결과는 목록의 observed_at이 바뀌면 옵니다');
            this.later(3200, () => {
              const pr = { id: 'probe_' + Math.floor(Math.random() * 900 + 100).toString(16), src: P.src, dst: P.dst, adapter: 'wireguard', reachable: true, fresh: true, stale: '', at: this.hm(Date.now()), err: '' };
              this.setState({ waitProbe: null, probes: [pr].concat(this.state.probes.filter((x) => !(x.src === P.src && x.dst === P.dst))) });
              this.toast('●', '#3ecf8e', 'probe 결과 도착', P.src + ' → ' + P.dst + ' reachable · fresh');
            });
          }) }] }, { isForm: true, fCols: 3, fields: [
        { label: 'source', req: '*', isSel: true, isIn: false, opts: nodeOpts(P.src), set: set('src'), hint: '' },
        { label: 'target', req: '*', isSel: true, isIn: false, opts: nodeOpts(P.dst), set: set('dst'), hint: P.src === P.dst ? '서로 달라야 한다' : '' },
        { label: 'channel', req: '', isSel: true, isIn: false, opts: ['service.tunnel', 'command', 'file', 'stream', 'control'].map((c) => ({ v: c, t: c, sel: c === P.channel ? 'selected' : null })), set: set('channel'), hint: '' }
      ], hasFoot: true, foot: waiting ? '⟳ 접수됨 — 결과 목록을 폴링하며 기다리는 중 (' + Math.round((S.now - S.waitProbe.since) / 1000) + '초). 대기 상태를 따로 주지 않아 화면이 기다림을 그린다.' : '경로 진단 = probe 실행 + 후보 조회를 화면이 조합한다 (전용 operation 없음).' });
      out.push(pf);
      // 후보
      const cands = P.dst === 'laptop-03' ? [] : [
        { rt: 'mesh_vpn_direct', ad: 'wireguard', healthy: true, lat: 31, bw: '410 Mbps', probe: '18:31', reason: '정책 rp-01 prefer' },
        { rt: 'cloud_relay', ad: 'websocket', healthy: true, lat: 88, bw: '40 Mbps', probe: '18:50', reason: 'fallback' }
      ];
      const denied = P.dst === 'laptop-03' ? [{ rt: 'lan_direct', reason: '대상 offline' }, { rt: 'mesh_vpn_direct', reason: '대상 offline' }] : [{ rt: 'lan_direct', reason: '같은 LAN이 아님' }, { rt: 'webrtc_p2p', reason: '정책이 허용하지 않음' }];
      out.push(this.table({ span: 7, title: '후보 라우트', sub: 'route.candidates.get · ' + P.src + ' → ' + P.dst + ' · ' + P.channel, tags: [this.tag('policy_source: ' + (P.dst === 'gpu-01' ? 'stored:rp-01' : P.dst === 'laptop-03' ? 'stored:rp-02' : 'default'), 'vio')],
        cols: '1.6fr 0.9fr 0.8fr 0.6fr 0.8fr 1.3fr', head: ['route_type', 'adapter', '상태', '지연', '대역폭', '이유'],
        rows: cands.map((c, i) => ({ hl: i === 0 ? 'rgba(122,167,255,0.07)' : 'transparent', cells: [this.cM(c.rt, { c: RT[c.rt], fw: 700, sub: i === 0 ? '선택' : '' }), this.cM(c.ad), this.cB(c.healthy ? 'healthy' : 'unhealthy', c.healthy ? 'ok' : 'bad'), this.cM(c.lat + 'ms'), this.cM(c.bw), this.cT(c.reason, { c: '#9aa1ab' })] }))
          .concat(denied.map((d) => ({ op: 0.6, cells: [this.cM(d.rt, { c: '#8a919b', sub: '거부' }), this.cT('—'), this.cB('denied', 'off'), this.cT('—'), this.cT('—'), this.cT(d.reason, { c: '#8a919b' })] }))),
        empty: '409 ROUTE_UNAVAILABLE — 쓸 수 있는 후보가 없습니다 (다시 시도 가능)', foot: cands.length ? '' : '대상이 offline이면 후보가 비고 거부된 후보만 남는다.' }));
      out.push(this.table({ span: 5, title: 'probe 기록', sub: 'network.probes.get', cols: '1.5fr 1.6fr 0.8fr',
        head: ['쌍', '결과', '시각'],
        rows: (waiting ? [{ hl: 'rgba(122,167,255,0.07)', cells: [this.cM(P.src + ' → ' + P.dst), this.cB('기다림', 'info', { g: '⟳', cls: 'spin' }), this.cM('—')] }] : []).concat(S.probes.map((p) => ({ cells: [
          this.cM(p.src + ' → ' + p.dst, { sub: p.adapter }),
          p.reachable ? this.cB(p.fresh ? 'reachable · fresh' : 'reachable', p.fresh ? 'ok' : 'warn', { sub: p.fresh ? '' : p.stale }) : this.cB('unreachable', 'bad', { sub: p.err }),
          this.cM(p.at, { c: '#9aa1ab' })] }))),
        foot: 'stale_reason: unreachable · missing_observed_at · probe_expired · network_generation_mismatch' }));
    } else if (sub === 'policy') {
      const modeTone = { auto: 'off', prefer: 'info', only: 'vio', deny: 'bad', relay_only: 'warn' };
      out.push(this.banner('warn', 'warn', '저장 성공 ≠ 유효.', '정책 저장은 내용을 검증하지 않습니다. 저장한 뒤 그 쌍의 후보를 조회해 유효한지 보여 줍니다 — 틀린 정책은 후보 조회 409, 그래프에서 edge가 조용히 빠지는 것으로 드러납니다.'));
      out.push(this.table({ span: 12, title: '라우트 정책', sub: 'route.policies.* — 같은 scope면 덮어쓴다(저장 = 새로 만들기 + 고치기)', acts: [{ label: '+ 정책', kind: 'primary', run: () => this.toast('◇', '#7aa7ff', '정책 폼', '시연 화면 — scope(source · target · channel · resource) + policy(mode · prefer · allow · deny · fallback)') }],
        cols: '0.8fr 1.6fr 0.9fr 0.8fr 1.3fr 1fr 1.2fr 0.9fr', head: ['id', 'scope', 'channel', 'mode', 'prefer → fallback', '저장', '후보 확인', ''],
        rows: S.policies.map((p) => ({ hl: p.checked === 'bad' ? 'rgba(255,93,93,0.07)' : 'transparent', cells: [
          this.cM(p.id, { fw: 700 }), this.cM(p.src + ' → ' + p.dst), this.cM(p.channel), this.cB(p.mode, modeTone[p.mode]), this.cM(p.prefer + ' → ' + p.fallback, { c: '#b4bac3' }), this.cT(p.at, { c: '#9aa1ab' }),
          p.checked === 'ok' ? this.cB('후보 있음', 'ok') : this.cB('409 ROUTE_UNAVAILABLE', 'bad', { tip: 'edge-01과 gpu-02는 같은 LAN이 아니다 — only lan_direct는 성립하지 않음' }),
          this.cBtn([{ label: '삭제', danger: true, run: () => this.toast('●', '#3ecf8e', '정책 삭제', p.id + ' — route.policies.by-policy-id.delete') }])] })),
        foot: 'mode: auto · prefer · only · deny · relay_only. 목록 값은 route_type. 빨간 줄 = 저장은 됐지만 후보 조회가 실패한 정책.' }));
    } else {
      const stTone = { opening: 'info', active: 'ok', draining: 'warn', closed: 'off', failed: 'bad' };
      out.push(this.table({ span: 12, title: '라우트 세션', sub: 'route.sessions.*', cols: '0.8fr 1.5fr 1fr 1.1fr 2fr 1fr 0.6fr',
        head: ['id', '경로', 'channel', 'route_type', '상태', '보냄 / 받음', ''],
        rows: S.sessions.map((s) => ({ cells: [
          this.cM(s.id, { fw: 700 }), this.cM(s.src + ' → ' + s.dst), this.cM(s.channel, { c: '#9aa1ab' }), this.cM(s.rt, { c: this.RT()[s.rt] }),
          this.cB(s.state, stTone[s.state], { sub: s.trace === 'plan' ? '남은 흔적 — 열지 않은 계획' : '', tip: s.trace === 'plan' ? '터널 계획(plan)이 만든 opening 세션. 실패한 연결이 아니다 — 지우는 API는 없다' : '' }),
          this.cM(s.sent + ' / ' + s.recv, { c: '#b4bac3' }),
          this.cBtn(s.state === 'closed' ? [] : [{ label: '닫기', danger: true, run: () => this.confirm({ op: 'terra.master.route.sessions.by-session-id.close.post', title: s.id + ' 세션을 닫을까요?', rows: [['경로', s.src + ' → ' + s.dst], ['실제로 하는 일', 'Master 기록만 closed로 바꾼다'], ['되돌리기', '없음']], warn: '데몬에 알리지 않습니다. 이미 열린 연결은 바로 끊기지 않고, 이후 티켓 갱신만 거부됩니다. "닫힘"을 연결 종료로 보지 마세요.', okLabel: '기록 닫기',
            ok: () => { this.setState({ sessions: this.state.sessions.map((x) => x.id === s.id ? Object.assign({}, x, { state: 'closed' }) : x) }); this.toast('●', '#3ecf8e', s.id + ' — closed (Master 기록)', '연결 자체는 티켓이 끝날 때까지 남을 수 있습니다'); } }) }])] })),
        foot: 'state: opening · active · draining · closed · failed. expires_at은 첫 티켓의 만료(2분)라 세션 만료로 그리지 않는다. health(트래픽)는 데몬 보고가 있을 때만.' }));
      out.push(this.table({ span: 12, title: '연결 그룹', sub: 'connection-groups.* — 상태는 opening · closed 둘뿐', acts: [{ label: '+ 그룹', run: () => this.toast('◇', '#7aa7ff', '그룹 만들기', 'name + session_ids[]') }],
        cols: '0.8fr 1.2fr 2fr 0.8fr 0.8fr', head: ['id', '이름', '세션', '상태', ''],
        rows: S.groups.map((g) => ({ cells: [this.cM(g.id, { fw: 700 }), this.cT(g.name, { fw: 700 }), this.cM(g.sessions.join(', ')), this.cB(g.state, g.state === 'closed' ? 'off' : 'info'),
          this.cBtn(g.state === 'closed' ? [] : [{ label: '닫기', danger: true, run: () => this.confirm({ op: 'terra.master.connection-groups.by-group-id.close.post', title: '"' + g.name + '" 그룹을 닫을까요?', rows: [['함께 닫힘', '속한 세션 ' + g.sessions.length + '개 (' + g.sessions.join(', ') + ')'], ['되돌리기', '없음']], warn: '그룹을 닫으면 속한 세션도 Master 기록에서 함께 닫힙니다.', okLabel: '그룹 닫기',
            ok: () => { this.setState({ groups: this.state.groups.map((x) => x.id === g.id ? Object.assign({}, x, { state: 'closed' }) : x), sessions: this.state.sessions.map((x) => g.sessions.indexOf(x.id) >= 0 ? Object.assign({}, x, { state: 'closed' }) : x) }); this.toast('●', '#3ecf8e', g.name + ' — closed', '세션 ' + g.sessions.length + '개도 closed'); } }) }])] })) }));
    }
    return { tabs, blocks: out };
  }
  tunnelBlocks() {
    const S = this.state, leaf = S.role === 'leaf', out = [];
    if (leaf) {
      const stTone = { listening: 'info', active: 'ok', failed: 'bad', draining: 'warn' };
      out.push(this.table({ span: 12, title: '로컬 터널', sub: 'terra.daemon.service-tunnels.get — 순서가 매번 달라 화면이 이름순으로 정렬', tags: [this.tag('선언 여부 필드 없음', 'off', '선언 터널과 구분하는 필드가 없다')],
        cols: '1.3fr 2fr 1.2fr 0.9fr 1.1fr 1.1fr 0.6fr', head: ['service_id', 'local → target', '상대', '상태', '세션 (활성/전체/실패)', '보냄 / 받음', ''],
        rows: S.ltunnels.slice().sort((a, b) => a.service < b.service ? -1 : 1).map((t) => ({ cells: [
          this.cM(t.service, { fw: 700, sub: t.id }), this.cM(t.local + ' → ' + t.target), this.cM(t.src + ' → ' + t.dst, { c: '#9aa1ab' }), this.cB(t.status, stTone[t.status] || 'off'),
          this.cM(t.act + ' / ' + t.total + ' / ' + t.failed, { c: t.failed ? '#f5b83d' : '#ede9e1' }), this.cM(t.sent + ' / ' + t.recv, { c: '#b4bac3' }),
          this.cBtn([{ label: '닫기', danger: true, run: () => this.confirm({ op: 'terra.daemon.service-tunnels.by-tunnel-id.close.post', title: t.service + ' 터널을 닫을까요?', rows: [['터널', t.id + ' · ' + t.local], ['활성 세션', t.act + '개 — 끊긴다'], ['되돌리기', '다시 열려면 tree 화면에서 계획 · 열기']], warn: '선언된 터널이면 약 60초 안에 다시 열립니다 — 선언을 지워야 닫힙니다. 없는 id도 closed: true라서, 닫혔는지는 목록을 다시 읽어 확인합니다.', okLabel: '닫기',
            ok: () => this.runSync('tclose', 900, () => { this.setState({ ltunnels: this.state.ltunnels.filter((x) => x.id !== t.id) }); this.toast('●', '#3ecf8e', '닫힘 — 목록을 다시 읽어 확인했습니다', t.service + ' · 선언 터널이면 곧 다시 나타납니다'); }) }) }])] })),
        empty: '열린 터널이 없습니다', foot: '터널 status: listening · active · failed · draining. 세션 state: dialing · active.' }));
      out.push(this.banner('info', 'info', '새 터널은 tree 화면에서 엽니다.', 'leaf 화면만으로는 새 터널을 열 수 없습니다 — 입력이 Master의 계획인데, leaf GUI의 카탈로그에는 Master operation이 없습니다(/api/upstream/… 경로에는 operation id가 없다).'));
      return { tabs: [], blocks: out };
    }
    const sub = S.sub.tunnel, tabs = [['sessions', '열린 터널'], ['decl', '고정 포트 선언'], ['new', '새 터널']];
    const stTone = { opening: 'info', active: 'ok', draining: 'warn', closed: 'off', failed: 'bad' };
    if (sub === 'sessions') {
      const tun = S.sessions.filter((s) => s.channel === 'service.tunnel');
      out.push(this.table({ span: 12, title: '서비스 터널 세션', sub: 'route.sessions.get (channel = service.tunnel) — 터널 열기의 결과는 여기서 확인', cols: '0.9fr 1.6fr 1.3fr 1.5fr 1.2fr',
        head: ['세션', '경로', 'route_type', '상태', '보냄 / 받음'],
        rows: tun.map((s) => ({ cells: [this.cM(s.id, { fw: 700 }), this.cM(s.src + ' → ' + s.dst), this.cM(s.rt, { c: this.RT()[s.rt] }),
          this.cB(s.state, stTone[s.state], { g: s.state === 'opening' && s.trace === 'opening' ? '⟳' : '', cls: s.state === 'opening' && s.trace === 'opening' ? 'spin' : '', sub: s.trace === 'plan' ? '남은 흔적 — 열지 않은 계획' : s.state === 'failed' ? '사유는 Master에 남지 않음' : '' }),
          this.cM(s.sent + ' / ' + s.recv, { c: '#b4bac3' })] })),
        foot: '열기(open)는 접수만 한다(202 · message_id). 세션이 opening → active 또는 failed로 바뀌는 것을 폴링으로 본다. 409가 나도 opening 세션이 남는다.' }));
    } else if (sub === 'decl') {
      out.push(this.table({ span: 12, title: '고정 포트 선언', sub: 'service-tunnels.declarations.* — 데몬이 약 60초마다 맞춰 연다', acts: [{ label: '+ 선언', kind: 'primary', run: () => this.toast('!', '#f5b83d', '409 DECLARATION_EXISTS', '같은 노드에 service_id나 local_port가 겹치면 거절됩니다 — 폼에서 먼저 막습니다') }],
        cols: '0.9fr 1.3fr 1.3fr 0.9fr 0.9fr 1fr 0.8fr 0.7fr', head: ['id', '노드', 'service_id', 'local', 'target', '정책', '상태', ''],
        rows: S.decls.map((d) => ({ cells: [this.cM(d.id, { fw: 700 }), this.cM(d.src + ' → ' + d.dst), this.cM(d.service), this.cM(':' + d.lport), this.cM('127.0.0.1:' + d.tport, { c: '#9aa1ab' }), this.cM(d.policy), this.cB(d.enabled ? 'enabled' : 'disabled', d.enabled ? 'ok' : 'off'),
          this.cBtn([{ label: '지우기', danger: true, run: () => { this.setState({ decls: this.state.decls.filter((x) => x.id !== d.id) }); this.toast('●', '#3ecf8e', '선언 삭제', d.id + ' — 해당 노드의 터널은 다음 재조정 때 닫힙니다'); } }])] })),
        foot: 'target_host · local_bind_host는 loopback만 된다. 선언 터널은 leaf에서 닫아도 다시 열린다 — 닫으려면 여기서 지운다.' }));
    } else {
      const P = S.plan, set = (k) => (e) => this.setState({ plan: Object.assign({}, this.state.plan, { [k]: e.target.value }) });
      const nodeOpts = (v) => this.NODES.map((n) => ({ v: n.id, t: n.id, sel: n.id === v ? 'selected' : null }));
      const pol = ['auto', 'lan-only', 'lan-preferred', 'secure-mesh-only', 'webrtc-only', 'webrtc-preferred', 'relay-only'];
      out.push(this.block({ span: 7, title: '새 터널', sub: 'service-tunnels.plan.post → service-tunnels.open.post',
        acts: [{ label: '경로 계획', run: () => this.runSync('plan', 800, () => { this.setState({ planned: { at: this.hm(Date.now()), rt: P.policy === 'relay-only' ? 'cloud_relay' : 'mesh_vpn_direct' } }); this.toast('◇', '#7aa7ff', '계획됨 — 티켓은 2분 뒤 만료', '열지 않으면 opening 세션이 목록에 남습니다'); }), busy: S.busy.plan },
          { label: '열기', kind: 'danger', dis: !S.planned, tip: S.planned ? '' : '먼저 경로 계획', busy: S.busy.open, run: () => this.confirm({ op: 'terra.master.service-tunnels.open.post', title: P.service + ' 터널을 열까요?', rows: [['source', P.src + ' (여기서 127.0.0.1:' + (P.lport === '0' ? '임의 포트' : P.lport) + ')'], ['target', P.dst + ' 127.0.0.1:' + P.tport], ['경로', (S.planned || {}).rt + ' · 정책 ' + P.policy], ['되돌리기', '세션을 닫거나 source 노드에서 터널 닫기']], warn: 'Master가 source 노드의 데몬에 열라고 보냅니다. 응답은 접수(202)뿐이고, 결과는 세션 상태(opening → active · failed)로 확인합니다.', okLabel: '열기',
            ok: () => this.runSync('open', 600, () => {
              const id = 'rt_' + Math.floor(Math.random() * 60000 + 4096).toString(16);
              this.setState({ planned: null, sessions: [{ id, src: P.src, dst: P.dst, channel: 'service.tunnel', rt: 'mesh_vpn_direct', state: 'opening', sent: '—', recv: '—', trace: 'opening' }].concat(this.state.sessions), sub: Object.assign({}, this.state.sub, { tunnel: 'sessions' }) });
              this.toast('◇', '#7aa7ff', 'accepted — 세션 ' + id + ' opening', '세션 상태를 폴링합니다');
              this.later(3000, () => { this.setState({ sessions: this.state.sessions.map((x) => x.id === id ? Object.assign({}, x, { state: 'active', trace: '', sent: '0 B', recv: '0 B' }) : x) }); this.toast('●', '#3ecf8e', id + ' — active', P.service + ' 터널이 열렸습니다'); });
            }) }) }] },
      { isForm: true, fCols: 3, fields: [
        { label: 'source (로컬)', req: '*', isSel: true, isIn: false, opts: nodeOpts(P.src), set: set('src'), hint: '' },
        { label: 'target', req: '*', isSel: true, isIn: false, opts: nodeOpts(P.dst), set: set('dst'), hint: '' },
        { label: 'route_policy_name', req: '', isSel: true, isIn: false, opts: pol.map((p) => ({ v: p, t: p, sel: p === P.policy ? 'selected' : null })), set: set('policy'), hint: '' },
        { label: 'service_id', req: '', isSel: false, isIn: true, val: P.service, set: set('service'), hint: '기본 <target>.ssh' },
        { label: 'target_port', req: '', isSel: false, isIn: true, val: P.tport, set: set('tport'), hint: 'target_host는 loopback만' },
        { label: 'local_port', req: '', isSel: false, isIn: true, val: P.lport, set: set('lport'), hint: '0이면 임의 포트' }
      ], hasFoot: true, foot: '계획은 미리보기가 아니다 — 서명된 티켓(2분)과 opening 세션을 만든다. 응답의 비밀값(ticket.signature · TURN credential)은 화면에 보이지 않는다.' }));
      out.push(this.table({ span: 5, title: '계획 결과', sub: S.planned ? S.planned.at + ' · 비밀값은 숨김' : '아직 계획하지 않음', cols: '1.3fr 1fr 0.8fr', head: ['후보', 'adapter', ''],
        rows: S.planned ? [{ hl: 'rgba(122,167,255,0.07)', cells: [this.cM(S.planned.rt, { fw: 700, c: this.RT()[S.planned.rt], sub: '선택' }), this.cM(S.planned.rt === 'cloud_relay' ? 'websocket' : 'wireguard'), this.cB('decision', 'info')] },
          { cells: [this.cM('cloud_relay', { c: '#8a919b' }), this.cM('websocket'), this.cB('후보', 'off')] }, { op: 0.6, cells: [this.cM('lan_direct', { c: '#8a919b' }), this.cT('—'), this.cB('denied', 'off')] }] : [],
        empty: '경로 계획을 누르면 선택된 경로와 후보가 여기에 나옵니다', foot: S.planned ? '티켓 id · 만료 · max_uses만 보여 준다. 열지 않으면 이 계획의 세션은 "남은 흔적"으로 남는다.' : '' }));
    }
    return { tabs, blocks: out };
  }
  wgBlocks() {
    const S = this.state, W = S.wg, out = [], demo = S.demo;
    if (demo === 'wgoff') {
      out.push(this.stateBlock('shield', 'off', 'WireGuard가 꺼져 있습니다', '로컬 노드의 설정에서 WireGuard 사용(enabled)이 꺼져 있습니다(기본값). 설치(installed) ✓ · 준비(ready) ✓ — ready는 꺼져 있어도 true라서, 배지는 enabled · installed · ready를 함께 봅니다. 이것은 빈 상태이지 오류가 아닙니다.', [{ label: '설치 안내 보기', run: () => this.setState({ demo: 'noinst' }) }]));
      return { tabs: [], blocks: out };
    }
    if (demo === 'noinst') {
      out.push(this.banner('warn', 'warn', 'WireGuard 도구가 없습니다.', 'installed: false · reason: "wireguard tools not found". 설치를 실행하는 API는 없습니다 — 아래 단계를 로컬 기기에서 직접 실행하세요.'));
      out.push(this.block({ span: 12, title: '설치 계획', sub: 'wireguard.install-plan.get · Linux (ubuntu) · 지원됨' }, { isSteps: true, steps: [
        { n: 1, d: '패키지 목록 갱신', admin: '관리자 권한', cmd: 'sudo apt-get update' },
        { n: 2, d: 'WireGuard 도구 설치', admin: '관리자 권한', cmd: 'sudo apt-get install -y wireguard-tools' },
        { n: 3, d: '커널 모듈이 없으면 wireguard-go', admin: '관리자 권한', cmd: 'sudo apt-get install -y wireguard-go' }
      ], hasFoot: true, foot: '다른 OS: Windows — winget install WireGuard.WireGuard · macOS — brew install wireguard-tools. 설치 정책이 required인데 도구가 없으면 데몬이 시작에 실패해 이 화면 자체가 뜨지 않는다 — 그 경우는 설치 안내 문서의 몫.' }));
      return { tabs: [], blocks: out };
    }
    const fresh = (p) => p.hs == null ? 'never_seen' : p.hs > 180 ? 'stale' : 'healthy';
    const cnt = { healthy: 0, stale: 0, never_seen: 0 }; S.peers.forEach((p) => { cnt[fresh(p)]++; });
    const on = W.observed;
    out.push(this.kv({ span: 8, title: '로컬 WireGuard', sub: 'wireguard.status.get · 설정값은 데몬 기동 시점 값',
      tags: [this.tag(W.enabled ? 'enabled' : 'disabled', W.enabled ? 'ok' : 'off'), this.tag(W.installed ? 'installed' : '미설치', W.installed ? 'ok' : 'bad'), this.tag(W.ready ? 'ready' : 'not ready', W.ready ? 'ok' : 'warn'),
        this.tag(on ? '인터페이스 켜짐 (간접)' : '인터페이스 꺼짐 (간접)', on ? 'info' : 'off', '켜짐 여부 필드가 없다 — peers 조회 성공 · sync의 interface_observed로 판단')] },
      [{ k: 'mode', v: W.mode, cls: 'mono' }, { k: 'interface', v: W.iface, cls: 'mono' }, { k: 'address_cidr', v: W.addr, cls: 'mono' }, { k: 'listen_port', v: W.port, cls: 'mono' },
        { k: 'public_key', v: W.pub, cls: 'mono' }, { k: '권한 helper', v: W.helper ? '설정됨' : '없음', c: W.helper ? '#3ecf8e' : '#f5b83d' }, { k: '관리형 키 만든 날', v: W.keyAt, cls: 'mono' }, { k: 'mesh_vpn', v: 'managed · on', cls: 'mono' }], 4));
    const b = S.busy;
    const run = (name, ms, after) => () => {
      this.setState({ busy: Object.assign({}, this.state.busy, { running: name, runSince: Date.now() }) });
      this.later(ms, () => { this.setState({ busy: Object.assign({}, this.state.busy, { running: null }) }); after(); });
    };
    const dg = (op, title, rows, warn, okLabel, go) => () => this.confirm({ op, title, rows, warn, okLabel, ok: go });
    const upDown = W.observed
      ? dg('terra.daemon.wireguard.down.post', '인터페이스를 내릴까요?', [['대상', W.iface + ' · ' + W.addr], ['영향', '로컬 노드의 mesh 연결이 모두 끊긴다'], ['되돌리기', '올리기로 다시 켬']], '현재 GUI가 mesh를 통해 열려 있었다면 연결이 끊길 수 있습니다. 15초 안에 답이 없으면 504 — 끝났는지 모르므로 상태를 다시 읽습니다.', '내리기', run('내리기', 2200, () => { this.setState({ wg: Object.assign({}, this.state.wg, { observed: false }) }); this.toast('●', '#3ecf8e', '내리기 — executed', 'wg-quick down terra0 · peers 조회는 이제 422'); }))
      : dg('terra.daemon.wireguard.apply.post', '인터페이스를 올릴까요?', [['대상', W.iface + ' · ' + W.addr], ['되돌리기', '내리기']], '성공은 명령이 끝났다는 뜻입니다 — 섰는지는 이어서 동기화로 확인합니다.', '올리기', run('올리기', 1800, () => { this.setState({ wg: Object.assign({}, this.state.wg, { observed: true }) }); this.toast('●', '#3ecf8e', '올리기 — executed', 'wg-quick up terra0'); }));
    const A = [
      ['동기화', '쓰기', 'Master의 desired를 당겨 와 설정에 반영 · interface_observed로 켜짐을 확인', '동기화', false, run('동기화', 1400, () => { this.setState({ wg: Object.assign({}, this.state.wg, { observed: true }) }); this.toast('●', '#3ecf8e', '동기화 — skipped', 'reason: desired_config_unchanged · interface_observed: true'); })],
      ['보고', '쓰기', 'peer 스냅숏을 Master에 보고 — 401·403·404면 데몬이 로컬 등록을 지운다', '보고', false, run('보고', 900, () => this.toast('●', '#3ecf8e', '보고 — reported', 'Master reported_peers 4 · recorded 4 · unresolved 0'))],
      [W.observed ? '인터페이스 내리기' : '인터페이스 올리기', '위험', W.observed ? '내리면 로컬 노드의 mesh 연결이 끊긴다' : '성공 = 명령이 끝남. 섰는지는 동기화로 확인', W.observed ? '내리기…' : '올리기…', true, upDown],
      ['관리형 키 교체', '위험', '기본은 "없으면 만들고 있으면 읽기". rotate일 때만 교체 — 교체 뒤 설정을 다시 적용', '교체…', true, dg('terra.daemon.wireguard.managed-key.post', '관리형 키를 교체할까요?', [['rotate', 'true'], ['지금 공개 키', W.pub], ['이후', '설정을 다시 적용해야 peer와 다시 붙는다']], '교체 뒤 Master 보고가 실패하면 성공 응답 안에 bootstrap_report_error로 옵니다. 그 경우 보고를 다시 누르세요.', '키 교체', run('키 교체', 1300, () => { this.setState({ wg: Object.assign({}, this.state.wg, { pub: 'Qn7w2L…a9Xc=', keyAt: '방금' }) }); this.toast('!', '#f5b83d', '키 교체됨 — 설정을 다시 적용하세요', 'previous_public_key ' + W.pub + ' · bootstrap_report ok'); }))],
      ['관리형 설정 기록', '위험', '주소 · peer를 설정 파일에 쓴다. dry_run도 파일을 쓴다 — 미리보기 아님', '기록…', true, dg('terra.daemon.wireguard.managed-config.post', '관리형 설정을 기록할까요?', [['address_cidr', W.addr], ['peers', S.peers.length + '개'], ['dry_run', '쓰지 않음 — dry_run도 파일을 쓴다']], 'dry_run은 미리보기가 아닙니다. 설정 파일과 데몬 설정을 쓰고 명령 실행만 건너뜁니다.', '기록', run('설정 기록', 1500, () => this.toast('●', '#3ecf8e', '설정 기록 — restart_required: false', 'content_sha256 3f9a…c1 · peer_count 4')))]
    ];
    const el = b.running ? (S.now - b.runSince) / 1000 : 0;
    const acts = this.block({ span: 4, title: '동작', sub: '데몬이 요청 안에서 끝까지 실행' }, { isActs: true, running: !!b.running, runText: (b.running || '') + ' — 실행 중 ' + Math.round(el) + '초 / 15초', runPct: Math.min(100, Math.round(el / 15 * 100)),
      rows: A.map(([label, kind, desc, btn, danger, go]) => ({ label, kind, desc, btn, kBg: danger ? 'rgba(255,93,93,0.10)' : 'rgba(255,255,255,0.04)', kFg: danger ? '#ff5d5d' : '#9aa1ab', line: danger ? 'rgba(255,93,93,0.45)' : 'rgba(255,255,255,0.18)', fg: danger ? '#ff5d5d' : '#ede9e1',
        run: b.running ? () => {} : go, dis: b.running ? 'true' : 'false', cur: b.running ? 'wait' : 'pointer', op: b.running ? 0.5 : 1 })),
      hasFoot: false });
    out.push(acts);
    const last = { bActs: [null, null, { run: upDown }] };
    if (!on) {
      out.push(this.stateBlock('shield', 'off', 'peer를 읽을 수 없습니다', '인터페이스가 없어 wireguard.peers.get이 422를 냈습니다 — 이것이 "꺼짐"의 간접 신호입니다. 원인은 오지 않으므로 status · enrollment를 함께 읽어 가릅니다: installed ✓ · 등록 ✓ → 인터페이스가 내려가 있음.', [{ label: '올리기…', run: last.bActs[2].run }]));
    } else {
      out.push(this.table({ span: 12, title: 'peer handshake', sub: 'wireguard.peers.get · 기준 180초', tags: [this.tag('healthy ' + cnt.healthy, 'ok'), this.tag('stale ' + cnt.stale, cnt.stale ? 'warn' : 'off'), this.tag('never_seen ' + cnt.never_seen, cnt.never_seen ? 'bad' : 'off', '본 적 없는 peer는 stale에도 센다')],
        cols: '1fr 1.1fr 1.4fr 1.5fr 1.2fr 1.2fr', head: ['peer', 'public_key', 'endpoint', 'allowed_ips', '마지막 handshake', '받음 / 보냄'],
        rows: S.peers.map((p) => { const f = fresh(p); return { op: f === 'never_seen' ? 0.7 : 1, hl: f === 'stale' ? 'rgba(245,184,61,0.06)' : 'transparent', cells: [
          this.cM(p.name, { fw: 700 }), this.cM(p.pub, { c: '#9aa1ab' }), this.cM(p.ep), this.cM(p.allowed, { c: '#b4bac3' }),
          this.cB(f === 'never_seen' ? '본 적 없음' : p.hs + '초 전', f === 'healthy' ? 'ok' : f === 'stale' ? 'warn' : 'bad', { sub: f }), this.cM(p.rx + ' / ' + p.tx, { c: '#b4bac3' })] }; }),
        foot: '표의 peer 이름은 allowed_ips로 맞춘 것이다 — 응답에는 public_key만 온다.' }));
    }
    return { tabs: [], blocks: out };
  }
  logBlocks() {
    const S = this.state, F = S.logFilter, rTone = { updated: 'ok', created: 'ok', accepted: 'info', revoked: 'warn', deleted: 'off', send_failed: 'bad' };
    const rows = S.logs.filter((l) => F === 'all' || l.result === F);
    return { tabs: [['all', '전체'], ['accepted', 'accepted'], ['created', 'created'], ['revoked', 'revoked']], tabKey: 'log', blocks: [
      this.banner('info', 'info', '본인 조작 이력입니다.', 'network.logs.get은 호출자 본인이 한 조작만 줍니다 — 관리자도 같습니다. 클러스터 전체 기록이 아닙니다. 실시간 스트림(logs.stream)은 Gateway가 게시하지 않아 폴링합니다.'),
      this.table({ span: 12, title: '조작 이력', sub: 'network.logs.get · 최신순 · limit 100', cols: '0.9fr 1.8fr 1fr 1.4fr 0.9fr 2fr',
        head: ['시각', 'action', 'target_type', 'target', 'result', 'detail'],
        rows: rows.map((l) => ({ cells: [this.cM(l.at, { c: '#9aa1ab' }), this.cM(l.action, { fw: 700 }), this.cM(l.type, { c: '#9aa1ab' }), this.cM(l.target), this.cB(l.result, rTone[l.result] || 'off'), this.cT(l.detail, { c: '#b4bac3' })] })),
        empty: '이 결과의 조작이 없습니다' })
    ] };
  }
  renderVals() {
    const S = this.state, st = this.T(), leaf = S.role === 'leaf';
    // 묶음 — 카탈로그에 있는지로 연다 (tree GUI: Master op · leaf GUI: Daemon op)
    const SECS = [
      { id: 'mesh', icon: 'net', label: '사설망', role: 'T', sub: 'mesh · CIDR · IP · 배포' },
      { id: 'route', icon: 'route', label: '연결 진단 · 라우팅', role: 'T', sub: 'probe · 그래프 · 정책 · 세션' },
      { id: 'tunnel', icon: 'tunnel', label: '서비스 터널', role: 'T+L', sub: leaf ? '로컬 터널' : '세션 · 선언 · 새 터널' },
      { id: 'wg', icon: 'shield', label: '로컬 WireGuard', role: 'L', sub: '상태 · peer · 올리기/내리기' },
      { id: 'log', icon: 'doc', label: '조작 이력', role: 'T', sub: '본인 네트워크 조작' }
    ];
    const avail = (s) => s.role === 'T+L' || (leaf ? s.role === 'L' : s.role === 'T');
    const cur = SECS.find((s) => s.id === S.sec) || SECS[0];
    const nav = SECS.map((s) => { const ok = avail(s), on = s.id === S.sec;
      return { subDisp: S.help || !ok ? 'block' : 'none', icon: s.icon, label: s.label, role: s.role, sub: ok ? s.sub : (leaf ? 'leaf GUI에는 Master operation이 없다' : 'tree GUI에는 Daemon operation이 없다'),
        cur: on ? 'page' : 'false', bg: on ? 'rgba(255,255,255,0.07)' : 'transparent', ring: on ? 'rgba(255,255,255,0.14)' : 'transparent', fg: ok ? '#ede9e1' : '#6b7280', subFg: ok ? '#9aa1ab' : '#6b7280', tint: on ? 'rgba(240,166,58,0.12)' : 'rgba(255,255,255,0.04)', tintLine: on ? 'rgba(240,166,58,0.5)' : 'rgba(255,255,255,0.10)', ic: on ? '#f0a63a' : ok ? '#b4bac3' : '#6b7280', gray: ok ? 'none' : 'grayscale(1)',
        roleFg: s.role === 'L' ? '#5aa8ff' : s.role === 'T' ? '#f0a63a' : '#3ecf8e', roleLine: s.role === 'L' ? 'rgba(90,168,255,0.5)' : s.role === 'T' ? 'rgba(240,166,58,0.5)' : 'rgba(62,207,142,0.45)',
        pick: () => this.setState({ sec: s.id }) }; });
    // 본문
    let view = { tabs: [], blocks: [] }, title = cur.label, subt = '';
    const lockedMsg = () => this.stateBlock('lock', 'off', cur.label + '은(는) 로컬 노드에서 부를 수 없습니다', leaf
      ? '현재 GUI는 leaf(edge-01)의 Gateway가 서빙합니다. leaf 카탈로그에는 terra.master.* operation이 없어 mesh · CIDR · 라우트를 다룰 수 없습니다. tree 노드의 GUI에서 여세요. (화면은 역할을 선언하지 않고 health · catalog로 관측한다)'
      : '현재 GUI는 tree(tree-home)의 Gateway가 서빙합니다. 로컬 WireGuard는 leaf 데몬의 operation이라 tree 카탈로그에 없습니다. 해당 노드의 GUI에서 여세요.', [{ label: leaf ? 'tree GUI로 보기 (시연)' : 'leaf GUI로 보기 (시연)', run: () => this.setState({ role: leaf ? 'tree' : 'leaf' }) }]);
    if (S.demo === 'loading') view.blocks = [this.stateBlock('loader', 'info', '처음 불러오는 중', (leaf ? 'terra.daemon.' : 'terra.master.') + '… 첫 조회를 기다립니다. 새로고침(폴링)과 달리 아직 보여 줄 값이 없습니다.', [])];
    else if (S.demo === 'down') view.blocks = [this.stateBlock('warn', 'bad', leaf ? '데몬에 닿지 못했습니다' : 'Master에 닿지 못했습니다', leaf ? 'Gateway는 살아 있지만 데몬 제공자가 응답하지 않습니다(503). 상대 노드 오프라인 · Master 실패와 다른 상황입니다 — 로컬 기기의 terra 데몬을 확인하세요.' : 'tree Gateway가 Master 호출에 503/504를 받았습니다. 마지막으로 받은 값은 ' + this.hm(S.polledAt) + ' 것입니다. 상대 노드가 오프라인인 것과는 다릅니다.', [{ label: '다시 시도', run: () => this.setState({ demo: 'ok', polledAt: Date.now() }) }])];
    else if (S.demo === 'unenrolled' && leaf && (cur.id === 'wg' || cur.id === 'tunnel')) view.blocks = [this.stateBlock('link', 'warn', '로컬 노드는 Master에 등록되지 않았습니다', '세션 상태 unavailable — 동기화 · 보고가 실패합니다. 등록은 GUI 버튼이 아니라 로컬 기기에서 terra daemon enroll 명령으로 합니다(또는 설치 마법사).', [])];
    else if (!avail(cur)) view.blocks = [lockedMsg()];
    else if (cur.id === 'mesh') { view.blocks = this.meshBlocks(); subt = 'home 클러스터 · WireGuard mesh — 네트워크 · 할당 · desired가 노드마다 배포된다'; }
    else if (cur.id === 'route') { view = this.routeBlocks(); subt = '노드 쌍을 골라 probe · 후보를 본다. 경로 진단은 화면이 두 호출을 조합한다'; }
    else if (cur.id === 'tunnel') { view = this.tunnelBlocks(); subt = leaf ? 'edge-01에서 열린 터널 — 닫기만 여기서, 열기는 tree에서' : 'Master가 계획 · 열기 · 선언을 맡는다'; }
    else if (cur.id === 'wg') { view = this.wgBlocks(); subt = 'edge-01 · 데몬이 직접 실행하는 동작은 응답이 올 때까지 기다린다'; }
    else if (cur.id === 'log') { view = this.logBlocks(); subt = '호출자 본인의 조작만'; }
    const tabKey = cur.id === 'route' ? 'route' : cur.id === 'tunnel' ? 'tunnel' : cur.id === 'log' ? 'log' : null;
    const curTab = tabKey === 'log' ? S.logFilter : tabKey ? S.sub[tabKey] : null;
    const polledSec = Math.round((S.now - S.polledAt) / 1000), next = Math.max(0, 10 - (polledSec % 10));
    const pollBad = S.demo === 'down';
    const DEMOS = [['ok', '상태: 정상'], ['loading', '상태: 처음 불러오는 중'], ['down', leaf ? '상태: 데몬 실패' : '상태: Master 실패'], ['wgoff', '상태: WireGuard 꺼짐 (leaf)'], ['noinst', '상태: 도구 미설치 (leaf)'], ['unenrolled', '상태: 미등록 (leaf)']];
    const D = S.dlg;
    return {
      hdr: {
        roleText: leaf ? 'edge-01 · leaf GUI' : 'tree-home · tree GUI', gwTip: leaf ? 'Gateway 127.0.0.1:8787 — terra.gateway.* + terra.daemon.*' : 'Gateway 127.0.0.1:8788 — terra.gateway.* + terra.master.*',
        roleBg: leaf ? 'rgba(90,168,255,0.10)' : 'rgba(240,166,58,0.10)', roleFg: leaf ? '#5aa8ff' : '#f0a63a', roleDot: leaf ? '#5aa8ff' : '#f0a63a',
        pollText: pollBad ? '갱신 실패 — 마지막 값 ' + this.hm(S.polledAt) : '폴링 · ' + polledSec + '초 전 갱신 · 다음 ' + next + '초', pollFg: pollBad ? '#ff7a7a' : '#b4bac3', pollDot: pollBad ? '#ff5d5d' : '#3ecf8e', pollCls: pollBad ? '' : 'pulse',
        refresh: () => this.setState({ polledAt: Date.now() }),
        roles: [['tree', 'tree에서 연 GUI'], ['leaf', 'leaf에서 연 GUI']].map(([k, label]) => ({ label, on: S.role === k ? 'true' : 'false', bg: S.role === k ? '#ede9e1' : 'transparent', fg: S.role === k ? '#111111' : '#9aa1ab', sh: S.role === k ? '0 1px 2px rgba(0,0,0,0.35)' : 'none',
          pick: () => this.setState({ role: k, sec: SECS.find((s) => s.id === S.sec && (s.role === 'T+L' || s.role === (k === 'leaf' ? 'L' : 'T'))) ? S.sec : (k === 'leaf' ? 'wg' : 'mesh') }) })),
        demos: DEMOS.map(([v, label]) => ({ v, label, sel: S.demo === v ? 'selected' : null })),
        setDemo: (e) => { const v = e.target.value; this.setState({ demo: v, role: ['wgoff', 'noinst', 'unenrolled'].indexOf(v) >= 0 ? 'leaf' : S.role, sec: ['wgoff', 'noinst'].indexOf(v) >= 0 ? 'wg' : S.sec }); }
      },
      sess: { who: 'admin · 만료 21:40 · ' + (leaf ? 'leaf' : 'home 클러스터') },
      nav,
      page: { subDisp: S.help && subt ? 'inline' : 'none', title, sub: subt, tabDisp: view.tabs.length ? 'flex' : 'none',
        tabs: view.tabs.map(([k, label]) => ({ label, on: curTab === k ? 'true' : 'false', bg: curTab === k ? '#ede9e1' : 'transparent', fg: curTab === k ? '#111111' : '#9aa1ab', sh: curTab === k ? '0 1px 2px rgba(0,0,0,0.35)' : 'none',
          pick: () => tabKey === 'log' ? this.setState({ logFilter: k }) : this.setState({ sub: Object.assign({}, S.sub, { [tabKey]: k }) }) })) },
      helpBlock: S.help ? 'block' : 'none',
      blocks: view.blocks.filter(Boolean),
      dlg: D ? { open: true, title: D.title, op: D.op, rows: D.rows.map(([k, v]) => ({ k, v, c: '#ede9e1' })), warn: D.warn, okLabel: D.okLabel || '확인',
        cancel: () => this.setState({ dlg: null }), ok: () => { this.setState({ dlg: null }); D.ok(); } } : { open: false, title: '', op: '', rows: [], warn: '', okLabel: '', cancel: () => {}, ok: () => {} },
      toasts: S.toasts
    };
  }
}
