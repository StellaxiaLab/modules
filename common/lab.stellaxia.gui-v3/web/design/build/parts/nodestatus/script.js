// 상태 창 — 노드의 식별 · 통신 · 자원 · 최근 활동을 CLI 처럼. 바탕은 비친다(글자 장이 보임) — 구역 나눔 · 막대는 레거시 선, 글자는 텍스트
//   실제(웹 빌드): window.TerraNodeInfo(rid) — Master 노드 기록 + 네트워크 · 경로 · 조작 이력 읽기(src/api/node-info.js). 10초마다 다시 읽는다
//   시안(캔버스): 같은 모양의 예시 값(노드 이름으로 정해지는 값에 흔들림) — 실제 값과 칸 · 순서가 같아야 한다(시안 ↔ 운영이 어긋나지 않게)
//   pid · 재시작 · healthcheck 는 Terra 가 내놓지 않는 값이라 시안에서도 뺐다(Sheet '상태 창')
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, info: null, copied: false }; this._net = []; this._rx = null; }   // 그리기가 마운트보다 먼저 올 수 있다
  componentDidMount() {
    this._live = true;
    this._iv = setInterval(() => { if (!this._live) return; const t = this.state.t + 1; this.setState({ t }); if (t % 10 === 0) this.pull(); }, 1000);
    this.pull();
  }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); }
  componentDidUpdate(prev) { if (prev && prev.nodeRid !== this.props.nodeRid) { this._net = []; this._rx = null; this.setState({ info: null }); this.pull(); } }
  real() { return typeof window !== 'undefined' && typeof window.TerraNodeInfo === 'function'; }
  pull() {
    const rid = this.props.nodeRid; if (!this.real() || !rid) return;
    window.TerraNodeInfo(rid).then((info) => { if (!this._live || this.props.nodeRid !== rid || !info) return;
      // NET — 하트비트 사이 바이트 차이로 속도(스냅샷이 누적값이라)
      const R = info.res, at = info.recent.hbAt; if (this._rx && at > this._rx.at && R.rx >= this._rx.rx) { const dt = (at - this._rx.at) / 1000; this._net.push({ i: (R.rx - this._rx.rx) / dt, o: (R.tx - this._rx.tx) / dt }); if (this._net.length > 22) this._net.shift(); }
      if (!this._rx || at !== this._rx.at) this._rx = { rx: R.rx, tx: R.tx, at };
      this.setState({ info }); }, () => {});
  }
  seed() { const nm = this.props.nodeName || 'node', k = this.props.nodeKind || 'leaf'; let h = 7; for (const ch of nm + k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  /** 시안 값 — src/api/node-info.js nodeInfo() 와 같은 모양 */
  sample() {
    const t = this.state.t, r = (i) => this.rnd(i), wob = (i, a) => Math.sin(t * (0.3 + r(i) * 0.5) + r(i + 9) * 6) * a, nm = this.props.nodeName || 'lab-ws-02', kind = this.props.nodeKind || '리프';
    const hex = (i, n) => { let s = ''; for (let k = 0; k < n; k++) s += '0123456789abcdef'[Math.floor(this.rnd(i + k) * 16)]; return s; };
    const bad = r(40) < 0.18, now = Date.now(), peers = ['01·a', '02', '03·c', 'nas-01'].filter((p) => p !== nm);
    const ev = [['heartbeat · 온라인', 'info', 40], ['session ← ' + peers[0] + ' · open', 'info', 95], ['probe ' + peers[1] + ' · wireguard ' + (bad ? '닿지 않음 · TIMEOUT' : 'ok'), bad ? 'warn' : 'info', 240], ['network.plan · ok', 'info', 1900], ['peer.connect · ok', 'info', 7400]];
    if (!this._net.length || this._net.t !== t) { this._net.push({ i: Math.max(0, (0.4 + r(6) + wob(7, 0.6)) * 1048576), o: Math.max(0, (0.1 + r(8) * 0.6 + wob(9, 0.1)) * 1048576) }); if (this._net.length > 22) this._net.shift(); this._net.t = t; }
    return {
      real: false, miss: [], name: nm, status: bad ? '◐ 저하' : '● 온라인', online: true, seen: Math.floor(r(30) * 50 + 5) + 's 전',
      ident: { nodeId: 'nd_' + hex(50, 4) + '-' + hex(60, 12), deviceId: 'dev_' + hex(80, 10), roles: { '계정': 'Master', '트리': 'Tree', '리프': 'Leaf', '리소스': '자원' }[kind] || kind, parent: this.props.parentName || '— (맨 위)', depth: kind === '트리' ? '0' : '1',
        address: '10.80.' + Math.floor(r(70) * 9) + '.' + Math.floor(r(71) * 200 + 10), dns: nm.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.terra', version: '1.7.' + Math.floor(r(23) * 4), created: '10-0' + (1 + Math.floor(r(24) * 8)) + ' 09:12:40', tags: 'lab', caps: 'exec, files, svi' },
      comm: { via: bad ? 'relay' : 'direct', relay: true, net: 'lab-mesh', desired: 'wireguard', observed: bad ? 'relay' : 'direct', gen: String(3 + Math.floor(r(72) * 6)),
        routes: peers.slice(0, 2).map((p, i) => ({ dir: '→', peer: p, rt: bad && i === 1 ? 'relay' : 'direct', ad: 'wireguard', healthy: !(bad && i === 1), lat: Math.round(3 + r(73 + i) * 20 + wob(74 + i, 2)) + 'ms' })),
        sessions: [{ peer: peers[0], dir: '←', channel: 'svi', rt: 'direct', state: 'open', err: '' }] },
      res: { cpu: Math.max(0.02, Math.min(0.99, 0.2 + r(1) * 0.55 + wob(2, 0.08))), mem: Math.max(0.05, Math.min(0.99, 0.3 + r(3) * 0.5 + wob(4, 0.03))), disk: 0.15 + r(5) * 0.6 },
      recent: { heartbeat: '방금', events: ev.map(([msg, lv, ago]) => ({ at: now - ago * 1000, lv, msg })) },
    };
  }
  renderVals() {
    const R = this.real(), rid = this.props.nodeRid || '', I = R ? this.state.info : this.sample(), kind = this.props.nodeKind || '리프';
    const col = (p) => p > 0.85 ? 'var(--t-err2,#ff9c8c)' : p > 0.75 ? 'var(--t-warn,#ffd27a)' : 'var(--t-ok,#60e28c)', D = '—';
    const tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    const rate = (v) => v >= 1048576 ? (v / 1048576).toFixed(1) + 'MB/s' : v >= 1024 ? Math.round(v / 1024) + 'KB/s' : Math.round(v) + 'B/s';
    const note = R && !rid ? 'Terra 노드 목록에 없는 노드' : R && !I ? '이 노드 기록을 받는 중' : I && I.miss && I.miss.length ? I.miss.join(' · ') : '', bandK = R && !rid ? 'none' : R && !I ? 'load' : 'fail', bandSub = bandK === 'fail' ? '읽지 못한 칸은 — 로 표시' : '';
    const id = (I && I.ident) || {}, cm = (I && I.comm) || {}, rs = (I && I.res) || {}, net = this._net, S = '▁▂▃▄▅▆▇', mx = Math.max(1, ...net.map((x) => x.i)), last = net[net.length - 1];
    const bar = (n, p, note2) => ({ name: n, pct: p == null ? '0' : (p * 100).toFixed(1), pctT: p == null ? D : Math.round(p * 100) + '%', col: p == null ? 'transparent' : /^마지막 보고/.test(note2) ? 'var(--t-key,#709c80)' : col(p), note: note2 });
    const evs = ((I && I.recent && I.recent.events) || []).map((e) => ({ t: e.at ? tm(e.at) : D, lv: e.lv, msg: e.msg, col: e.lv === 'warn' ? 'var(--t-warn,#ffd27a)' : 'var(--t-key,#709c80)' }));
    const routes = (cm.routes || []), sess = (cm.sessions || []);
    const copyId = () => { const v = id.nodeId; if (!v || v === D) return; try { navigator.clipboard.writeText(v).then(() => { this.setState({ copied: true }); setTimeout(() => this._live && this.setState({ copied: false }), 1500); }, () => failCopy()); } catch (e) { failCopy(); } };
    const failCopy = () => { this.setState({ copyFail: true }); setTimeout(() => this._live && this.setState({ copyFail: false }), 4000); };   // 복사 권한이 없으면(iframe 정책) 조용히 넘기지 않고 알린다
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh',
      name: (I && I.name) || this.props.nodeName || D, kind, stText: I ? I.status : D, stCol: I && I.online ? (/저하/.test(I.status) ? 'var(--t-warn,#ffd27a)' : 'var(--t-ok,#60e28c)') : 'var(--t-err2,#ff9c8c)', seen: I && I.seen ? I.seen : '',
      noteOn: !!note, note, bandK, bandSub, src: R ? 'Master 노드 기록' : '시안 값',
      nodeId: id.nodeId || D, copyT: this.state.copied ? '복사됨' : this.state.copyFail ? '복사 못 함 — 직접 선택' : '복사', copyOff: !id.nodeId || id.nodeId === D, copyId,
      ident: [['장치', id.deviceId], ['역할', id.roles], ['부모', id.parent], ['깊이', id.depth], ['주소', id.address], ['DNS', id.dns], ['버전', id.version], ['등록', id.created]].map(([k, v]) => ({ k, v: v || D })),
      via: cm.via || D, viaCol: cm.via === 'direct' ? 'var(--t-ok,#60e28c)' : cm.via && cm.via !== D ? 'var(--t-warn,#ffd27a)' : 'var(--t-key,#709c80)', relayT: I ? (cm.relay ? '연결됨' : '끊김') : D, relayCol: cm.relay ? 'var(--t-ok,#60e28c)' : 'var(--t-err2,#ff9c8c)', gen: cm.gen || D,
      comm: [['네트워크', cm.net], ['원하는', cm.desired], ['관측', cm.observed], ['태그', id.tags]].map(([k, v]) => ({ k, v: v || D })),
      routes: routes.map((x) => ({ mark: x.healthy ? '✓' : '!', col: x.healthy ? 'var(--t-ok,#60e28c)' : 'var(--t-warn,#ffd27a)', dir: x.dir || '', peer: x.peer, rt: x.rt, ad: x.ad, lat: x.lat })), routeSum: (() => { const np = new Set(routes.map((x) => x.peer)).size; return !routes.length ? '없음' : np === routes.length ? routes.length + '개' : '상대 ' + np + '개 · 방향별 ' + routes.length + '개'; })(),
      sessions: sess.map((x) => ({ dir: x.dir, peer: x.peer, channel: x.channel, rt: x.rt, state: x.state + (x.err ? ' · ' + x.err : ''), col: x.err ? 'var(--t-warn,#ffd27a)' : 'var(--t-text,#d6f4de)' })), sessSum: sess.length ? sess.length + '개' : '없음',
      // 총량은 Master 가 실어 준 것만(지어내지 않는다), 꺼진 노드는 '마지막 보고 · N 전' — 지금 값처럼 보이지 않게
      bars: (() => { const fb = (typeof window !== 'undefined' && window.TerraFmtBytes) || (() => ''), sz = (u, t) => (t && fb(t) ? (fb(u) || '?') + ' / ' + fb(t) : R && I ? '총량 보고 없음' : ''), old = R && rs.stale ? '마지막 보고 · ' + ((I && I.seen) || '') : '';
        return [bar('CPU', rs.cpu, old), bar('MEM', rs.mem, old || sz(rs.memUsed, rs.memTotal)), bar('DISK', rs.disk, old || sz(rs.diskUsed, rs.diskTotal))]; })(),
      spark: net.length ? net.map((x) => S[Math.min(6, Math.round(x.i / mx * 6))]).join('') : R ? '하트비트 2회 후 표시' : '', netIn: last ? rate(last.i) : D, netOut: last ? rate(last.o) : (rs.txT && rs.txT !== D ? '누적 ' + rs.txT : D),
      hb: (I && I.recent && I.recent.heartbeat) || D, events: evs, noEv: !!I && evs.length === 0,
    };
  }
}
