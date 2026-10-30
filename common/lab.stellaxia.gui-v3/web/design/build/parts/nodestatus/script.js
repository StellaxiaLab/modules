// 상태 창 — 노드의 동작 상태 · 자원 · healthcheck · 최근 이벤트를 CLI 처럼. 바탕은 비친다(글자 장이 보임) — 구역 나눔 · 막대 · 지연 선은 레거시 선, 글자는 텍스트
//   값은 1초마다 갱신(시안 — 노드 이름으로 정해지는 예시 값에 흔들림). 막대의 붉은 눈금 = 경고 기준 75%
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0 }; this._ev = []; this._net = []; }   // 그리기가 마운트보다 먼저 올 수 있다
  componentDidMount() { this._live = true; this._iv = setInterval(() => { if (this._live) this.setState({ t: this.state.t + 1 }); }, 1000); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); }
  seed() { const nm = this.props.nodeName || 'node', k = this.props.nodeKind || 'leaf'; let h = 7; for (const ch of nm + k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  renderVals() {
    const t = this.state.t, nm = this.props.nodeName || 'lab-ws-02', kind = this.props.nodeKind || '리프', r = (i) => this.rnd(i), wob = (i, a) => Math.sin(t * (0.3 + r(i) * 0.5) + r(i + 9) * 6) * a;
    const res = kind === '리소스', bad = r(40) < 0.18;
    const cpu = Math.max(2, Math.min(99, 20 + r(1) * 55 + wob(2, 8))), mem = Math.max(5, Math.min(99, 30 + r(3) * 50 + wob(4, 3))), disk = 15 + r(5) * 60;
    const col = (p) => p > 85 ? '#ff9c8c' : p > 75 ? '#ffd27a' : '#60e28c';
    const net = this._net; if (net.length === 0 || net.t !== t) { net.push(Math.max(0, 0.4 + r(6) + wob(7, 0.6))); if (net.length > 22) net.shift(); net.t = t; }
    const S = '▁▂▃▄▅▆▇', mx = Math.max(0.1, ...net), spark = net.map((v) => S[Math.min(6, Math.round(v / mx * 6))]).join('');
    const hcs = res ? [['link', 8], ['driver', 14], ['owner', 22]] : [['core', 18], ['storage', 9], ['relay', 60], ['agent', 12], ['svi', 30]];
    const checks = hcs.map(([n, base], i) => { const ms = Math.max(1, Math.round(base * (0.7 + r(10 + i) * 0.8) + wob(11 + i, base * 0.2) + (bad && i === 2 ? 260 : 0))), st = ms > 250 ? 'slow' : 'ok';
      return { name: n, ms: ms + 'ms', w: Math.min(100, ms / 3), state: st, mark: st === 'ok' ? '✓' : '!', col: st === 'ok' ? '#60e28c' : '#ffd27a' }; });
    const nOk = checks.filter((c) => c.state === 'ok').length;
    if (!this._ev.length) { const now = Date.now(); for (let k = 5; k > 0; k--) this._ev.push({ at: now - k * 47000, lv: 'info', msg: ['heartbeat ok', 'config synced', 'svi lease renewed', 'job finished · backup', 'peer connected'][k % 5] }); }
    if (t > 0 && t % 9 === 0 && this._evT !== t) { this._evT = t; this._ev.push({ at: Date.now(), lv: bad && t % 18 === 0 ? 'warn' : 'info', msg: bad && t % 18 === 0 ? 'relay latency ' + checks[2 % checks.length].ms : 'heartbeat ok' }); if (this._ev.length > 8) this._ev.shift(); }
    const tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    const up = Math.floor(r(20) * 30) * 86400 + Math.floor(r(21) * 86400) + t;
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh',
      name: nm, kind, stText: bad ? '주의' : '온라인', stCol: bad ? '#ffd27a' : '#60e28c', uptime: Math.floor(up / 86400) + 'd ' + Math.floor(up % 86400 / 3600) + 'h ' + Math.floor(up % 3600 / 60) + 'm', tick: '1s',
      proc: res ? 'bound' : 'running', pid: res ? '—' : String(1000 + Math.floor(r(22) * 8000)), core: res ? '—' : '1.7.' + Math.floor(r(23) * 4), restarts: String(Math.floor(r(24) * 3)),
      role: { '계정': 'account', '트리': 'tree', '리프': 'leaf', '리소스': 'resource' }[kind] || kind, parent: this.props.parentName || '—',
      bars: (res ? [['USE', cpu, '사용 중 · 1 연결'], ['BUF', mem, '버퍼']] : [['CPU', cpu, 'load ' + (cpu / 50).toFixed(2) + ' ' + (cpu / 55).toFixed(2)], ['MEM', mem, (mem / 100 * 8).toFixed(1) + ' / 8.0 GB'], ['DISK', disk, Math.round(disk * 2) + ' / 200 GB']])
        .map(([n, p, note]) => ({ name: n, pct: p.toFixed(1), pctT: Math.round(p) + '%', col: col(p), note })),
      spark, netIn: (net[net.length - 1] || 0).toFixed(1) + ' MB/s', netOut: (0.1 + r(8) * 0.6 + wob(9, 0.1)).toFixed(1) + ' MB/s',
      checks, hcSum: nOk + ' / ' + checks.length + ' ok',
      events: this._ev.slice().reverse().map((e) => ({ t: tm(e.at), lv: e.lv, msg: e.msg, col: e.lv === 'warn' ? '#ffd27a' : '#709c80' }))
    };
  }
}
