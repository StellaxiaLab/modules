// 자원 상태 창 — 자원 하나의 상태 · 값 모니터링 · 끝점 · 연결 · 최근 이벤트를 CLI 처럼 (상태 창과 같은 결, 바탕이 비친다)
//   열기 — 자원 이름을 누르면(자원 창 · 설정 › Leaf › 자원) · 위성 우클릭 › 상태. 자원마다 창 하나, 같은 자원이면 앞으로
//   Terra 대응 (트리 Master):
//     정보 · 상태 — terra.master.svi.resources.by-resource-id.get · 끝점 — …endpoints.get
//     값 — terra.master.svi.handles.post { resource_id, endpoint_id, operations: [subscribe] } → handles.by-handle-id.stream.get (닫을 때 handles.by-handle-id.delete)
//     연결 — terra.master.svi.bindings.get (source · target = 이 자원)
//   시안 — 값은 1초마다 (자원 이름으로 정해지는 예시 값에 흔들림). 일시정지하면 그래프만 멈춘다
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, metric: 0, paused: false }; this._hist = {}; this._ev = []; try { window.addEventListener('terra-help', () => this.setState({})); } catch (e) {} }
  componentDidMount() { this._live = true; this._iv = setInterval(() => { if (this._live) this.setState({ t: this.state.t + 1 }); }, 1000); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  name() { return this.props.resName || 'gpio'; }
  seed() { let h = 7; for (const ch of this.name() + (this.props.nodeName || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  // 자원 종류 — 이름에서 (시안). 실제로는 SVI 자원 설명의 kind · 끝점 스키마
  profile() {
    const n = this.name().toLowerCase();
    const P = (type, metrics, eps) => ({ type, metrics, eps });
    if (/^ssh|:22/.test(n)) return P('service · ssh', [['세션', '개', 2, 1, 0], ['수신', 'KB/s', 40, 30, 1], ['송신', 'KB/s', 12, 10, 1]], [['session', 'source · sink', 'terra.stream.bytes@1']]);
    if (/^tty|serial/.test(n)) return P('serial', [['수신', 'B/s', 900, 400, 0], ['송신', 'B/s', 120, 80, 0]], [['rx', 'source', 'terra.serial.bytes@1'], ['tx', 'sink', 'terra.serial.bytes@1']]);
    if (/gpio/.test(n)) return P('gpio', [['pin 17', '', 0.5, 0.5, 2], ['pin 27', '', 0.5, 0.5, 2], ['pin 22', '', 0.5, 0.5, 2]], [['pins', 'source · sink', 'terra.gpio.level@1']]);
    if (/camera|frame/.test(n)) return P('camera', [['fps', 'fps', 29, 2, 1], ['지연', 'ms', 38, 12, 0]], [['frames', 'source', 'terra.video.frame@1']]);
    if (/sensor|stat/.test(n)) return P('sensor', [['온도', '°C', 41, 4, 1], ['습도', '%', 46, 6, 0]], [['stats', 'source', 'terra.sensor.sample@1']]);
    if (/gpu|infer/.test(n)) return P('compute · gpu', [['사용률', '%', 62, 25, 0], ['대기열', '개', 3, 3, 0], ['메모리', 'GB', 9.4, 1.5, 1]], [['infer', 'source · sink', 'terra.infer.request@1']]);
    if (/log/.test(n)) return P('log', [['줄', '줄/s', 140, 90, 0]], [['lines', 'source', 'terra.log.line@1']]);
    return P('resource', [['처리량', 'KB/s', 50, 30, 1]], [['data', 'source', 'terra.bytes@1']]);
  }
  value(m, i, t) { const [, , base, amp, dec] = m, r = (k) => this.rnd(k + i * 7), w = Math.sin(t * (0.25 + r(1) * 0.6) + r(2) * 6) + Math.sin(t * (0.9 + r(3)) + r(4) * 3) * 0.35;
    if (dec === 2) return w + r(5) * 0.6 - 0.3 > 0 ? 1 : 0;   // 디지털 — 0 / 1
    return Math.max(0, base + w * amp * 0.75); }
  fmt(v, m) { return m[4] === 2 ? (v ? 'HIGH' : 'LOW') : v.toFixed(m[4]) + (m[1] ? ' ' + m[1] : ''); }
  renderVals() {
    const S = this.state, t = S.t, P = this.profile(), H = this.help(), r = (i) => this.rnd(i), src = this.props.src || '내 자원';
    const down = r(40) < 0.12, busy = r(41) < 0.5;
    // 값 기록 — 지표마다 60칸. 일시정지면 그래프는 멈추고 지금 값만 흐른다
    P.metrics.forEach((m, i) => { const h = this._hist[i] || (this._hist[i] = []); if (!h.length) for (let k = 59; k >= 0; k--) h.push(down ? 0 : this.value(m, i, t - k)); if (!S.paused && h.t !== t) { h.push(down ? 0 : this.value(m, i, t)); if (h.length > 60) h.shift(); h.t = t; } });
    const mi = Math.min(S.metric, P.metrics.length - 1), M = P.metrics[mi], hist = this._hist[mi], now = down ? 0 : this.value(M, mi, t);
    const mx = Math.max(...hist, M[4] === 2 ? 1 : 0.0001), mn = Math.min(...hist), avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    if (!this._ev.length) { const t0 = Date.now(); [['info', '선언됨 · 승인'], ['info', '연결 → store/data'], ['info', 'lease 갱신'], [down ? 'warn' : 'info', down ? 'presence missing' : 'presence ok']].forEach((e, k) => this._ev.push({ at: t0 - (4 - k) * 61000, lv: e[0], msg: e[1] })); }
    if (t > 0 && t % 11 === 0 && this._evT !== t) { this._evT = t; this._ev.push({ at: Date.now(), lv: 'info', msg: M[0] + ' ' + this.fmt(now, M) }); if (this._ev.length > 6) this._ev.shift(); }
    const tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    const peer = ['02·a', '02·c', '02', '01·a'][Math.floor(r(30) * 4)];
    const binds = down ? [] : busy ? [[peer, 'store/data', '신뢰 순서', Math.round(20 + r(31) * 80) + ' KB/s']] : [];
    const stT = down ? '끊김' : binds.length ? '사용 중' : '사용 가능', stCol = down ? '#ff9c8c' : binds.length ? '#ffd27a' : '#60e28c';
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.name(), type: P.type, stT, stCol, src, srcCls: { 지명: 'nd', 전체: 'sc', 외부: 'ex' }[src] || 'tr',
      node: this.props.nodeName || '02·b', approve: down ? '승인 · 없음' : '승인', presence: down ? 'missing' : 'present', seen: down ? Math.floor(40 + r(32) * 200) + '초 전' : '방금', lease: Math.floor(20 + r(33) * 40) + '분 남음',
      metrics: P.metrics.map((m, i) => ({ name: m[0], cls: i === mi ? 'on' : '', on: i === mi ? 'true' : 'false', pick: () => this.setState({ metric: i }) })), hasMetrics: P.metrics.length > 1,
      nowT: down ? '—' : this.fmt(now, M), unitT: M[0], minT: this.fmt(mn, M), avgT: M[4] === 2 ? Math.round(avg * 100) + '% HIGH' : this.fmt(avg, M), maxT: this.fmt(mx, M),
      bars: hist.map((v) => ({ h: Math.max(2, Math.round((v - (M[4] === 2 ? 0 : mn * 0.8)) / Math.max(0.0001, mx - (M[4] === 2 ? 0 : mn * 0.8)) * 100)), col: down ? '#ff9c8c' : '#60e28c' })),
      pauseT: S.paused ? '재개' : '일시정지', pause: () => this.setState({ paused: !S.paused }), liveT: S.paused ? '멈춤' : '1s',
      eps: P.eps.map(([id, dir, schema]) => ({ id, dir, schema: H ? schema : '' })),
      binds: binds.map(([to, ep, q, rate]) => ({ to: to + ' › ' + ep, q, rate })), noBinds: binds.length === 0,
      events: this._ev.slice().reverse().map((e) => ({ t: tm(e.at), lv: e.lv, col: e.lv === 'warn' ? '#ffd27a' : '#709c80', msg: e.msg })),
      apiR: H ? 'svi.resources' : '', apiV: H ? 'svi.handles · stream' : '', apiB: H ? 'svi.bindings' : ''
    };
  }
}
