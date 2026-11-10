// 모듈 상태 창 — 노드 폴더 › 모듈 에서 모듈을 누르면. 모듈 하나의 상태 · 사용량 · GUI · 동작 · 내놓는 자원 · 권한 · 최근 로그를 CLI 처럼 (자원 상태 창과 같은 결, 바탕이 비친다)
//   GUI ↗ — 그 앱을 별도 브라우저 창으로 (onOpen('web', 'mod|노드 id|모듈 id|앱 id')). 모듈이 멈춰 있으면 못 연다
//   Terra 대응:
//     상태 · 사용량 — terra.daemon.modules.by-module-id.get (local · cluster, node.read)
//     GUI 목록 — Gateway GET /api/v1/gui/apps (이 노드) · GET /api/v1/gui/remote/{node}/apps (다른 노드 — Master 가 아는 카탈로그, 자산 cached|stale|absent)
//     동작 — …modules.by-module-id.restart.post · stop.post · start.post (local · cluster, node.control) — 원격 노드도 된다
//     로그 — …modules.by-module-id.logs.get { module_id, tail } — 그 노드 Daemon 의 모듈 stdout · stderr 고리 버퍼(제어기 › 모듈 › 로그 와 같은 길 · 노드 데이터 층 TTL 5초)
//     CPU · 메모리 — 코어에 모듈별 자원 op 가 없다 → 실제 모드는 '—' 와 그 까닭. 가동 = 모듈 상태의 started_at(있으면)
//   값은 노드 데이터 층(window.TerraNodes)에서 — 그 노드의 모듈 사본을 읽고(EL: 바로 · 낡으면 뒤에서), 시작 · 멈춤은 그 층으로 쓴다(낙관 반영 · 실패하면 되돌림).
//   노드와 끊기면(PA) 마지막 사본을 그대로 보여 주고 동작은 막는다 — '끊김 · N분 전 사본 · 읽기 전용'
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, busy: null }; this._log = []; this._k = '';
    try { window.addEventListener('terra-help', () => this.setState({})); window.addEventListener('terra-mod', () => this.setState({})); } catch (e) {} }
  componentDidMount() { this._live = true; this._iv = setInterval(() => { if (this._live) this.setState({ t: this.state.t + 1 }); }, 1000); const T = this.TN(); if (T) this._un = T.subscribe((n) => { if (this._live && n === this.M().nodeId) this.setState({}); }); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); clearTimeout(this._bt); if (this._un) this._un(); }
  TN() { return typeof window !== 'undefined' ? window.TerraNodes || null : null; }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  // 실제 모드(Gateway 전송) — 모듈 목록 · 상태 · 버전 · 가동 시각(started_at) · pid 는 실제다. CPU · 메모리는 코어에 모듈별 op 가 없어 '—'(지어내지 않는다)
  real() { const T = this.TN(); return !!(T && T.t && T.t.kind !== 'mock'); }
  M() { const m0 = this.props.mod, T = this.TN(); if (m0 && m0.id && T) { const d = T.read(m0.nodeId, 'modules').data, live = d && d.find((q) => q.id === m0.id); if (live) return Object.assign({}, m0, live); } const m = m0; if (!(m && m.id) && this.real()) return { id: '—', name: '모듈 정보 없음', ver: '—', kind: '', apps: [], perms: [], svi: [], node: '—', nodeId: '', st: 'stop' }; return m && m.id ? m : { id: 'io.terra.agent', name: 'Terra Agent', ver: '0.3.0', kind: 'service', apps: [{ id: 'io.terra.agent', name: 'Terra Agent', mode: 'static', entry: 'ui/index.html' }], perms: ['coreOperations', 'storage', 'network'], svi: ['ctl/log'], st: 'run', node: '01·a', nodeId: 'L1', remote: false }; }
  stMap() { try { return JSON.parse(localStorage.getItem('terra.mod.st') || '{}') || {}; } catch (e) { return {}; } }
  st() { const m = this.M(); if (this.TN()) return m.st || 'run'; const o = this.stMap()[m.nodeId + '|' + m.id]; return o || m.st || 'run'; }
  setSt(v) { const m = this.M(), map = this.stMap(); map[m.nodeId + '|' + m.id] = v; try { localStorage.setItem('terra.mod.st', JSON.stringify(map)); window.dispatchEvent(new Event('terra-mod')); } catch (e) {} }
  seed() { let h = 11; for (const ch of this.M().id + this.M().nodeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  log(lv, msg) { this._log.push({ at: Date.now(), lv, msg }); if (this._log.length > 7) this._log.shift(); }
  act(kind) {
    const m = this.M(); if (m.core && kind === 'stop') return;
    const to = { restart: 'run', stop: 'stop', start: 'run' }[kind], verb = { restart: '다시 시작', stop: '멈춤', start: '시작' }[kind];
    this.setState({ busy: kind }); this.log('info', verb + ' 요청 · ' + m.node);
    const T = this.TN();
    if (T) {   // 노드 데이터 층으로 — daemon modules.by-module-id.{restart|stop|start}.post (cluster 범위라 원격도), 사본에 먼저 반영
      const op = 'terra.daemon.modules.by-module-id.' + kind + '.post', id = m.id;
      T.write(m.nodeId, op, { module_id: id }, { res: 'modules', apply: (d) => (d || []).map((q) => (q.id === id ? Object.assign({}, q, { st: to }) : q)) })
        .then(() => { this.log(to === 'run' ? 'info' : 'warn', to === 'run' ? '실행 중' : '멈춤'); this.setState({ busy: null, err: null }); },
          (e) => { this.log('warn', verb + ' 실패 — ' + ((e && e.message) || (e && e.code) || '오류')); this.setState({ busy: null, err: (e && e.code) || 'ERROR' }); });
      return; }
    clearTimeout(this._bt); this._bt = setTimeout(() => { this.setSt(to); this.log(to === 'run' ? 'info' : 'warn', to === 'run' ? '실행 중' : '멈춤'); this.setState({ busy: null }); }, kind === 'restart' ? 1300 : 800);
  }
  // 실제 로그 — 노드 데이터 층으로 logs.get(입력마다 따로 · 5초 TTL). [{ t, lv, col, msg }] 또는 null(시안)
  realLogs(m) {
    const T = this.TN(), A = typeof window !== 'undefined' ? window.TerraDesk : null; if (!this.real() || !T || !m.id || m.id === '—' || !m.nodeId) return null;
    const r = T.read(m.nodeId, 'terra.daemon.modules.by-module-id.logs.get', { input: { module_id: m.id, tail: 40 }, ttl: 5000 }), CL = { err: ['error', 'var(--t-err2,#ff9c8c)'], warn: ['warn', 'var(--t-warn,#ffd27a)'], info: ['info', 'var(--t-key,#709c80)'] };
    const rows = r.data && A && A.logLines ? A.logLines(r.data).slice(-12).reverse().map((x) => ({ t: x.t, lv: CL[x.cls] ? CL[x.cls][0] : 'info', col: CL[x.cls] ? CL[x.cls][1] : 'var(--t-key,#709c80)', msg: x.msg })) : [];
    if (rows.length) return rows;
    return [{ t: '', lv: '', col: r.err ? 'var(--t-warn,#ffd27a)' : 'var(--t-key,#709c80)', msg: r.err ? '로그 미수신 · ' + r.err.code : r.loading || !r.data ? '받는 중…' : '로그 없음 — 모듈 출력 없음' }];
  }
  upOf(m, run) {   // 가동 — 모듈 상태의 started_at 부터. 없으면 '—' 와 까닭
    const t0 = Date.parse(m.startedAt || ''); if (!run) return { t: '—', why: '' }; if (Number.isNaN(t0) || t0 <= 0) return { t: '—', why: '모듈 상태에 시작 시각 없음' };
    const s = Math.max(0, (Date.now() - t0) / 1000); return { t: (s >= 86400 ? Math.floor(s / 86400) + 'd ' : '') + (s >= 3600 ? Math.floor(s % 86400 / 3600) + 'h ' : '') + (s < 60 ? '<1m' : Math.floor(s % 3600 / 60) + 'm'), why: '' };
  }
  renderVals() {
    const m = this.M(), H = this.help(), S = this.state, t = S.t, r = (i) => this.rnd(i), st = S.busy === 'restart' ? 'restart' : this.st(), run = st === 'run';
    const RL = this.real(), NO = '보고 없음';
    if (this._k !== m.nodeId + '|' + m.id) { this._k = m.nodeId + '|' + m.id; this._log = []; this._cpu = []; const t0 = Date.now();
      if (!RL) [['info', '설치 확인 · ' + m.ver], ['info', 'manifest 검사 통과'], [st === 'fail' ? 'error' : 'info', st === 'fail' ? '시작 실패 — exit 1' : st === 'stop' ? '멈춤 (사용자)' : '시작 · pid ' + (2000 + Math.floor(r(9) * 7000))], ['info', run ? 'health ok' : 'health —']]
        .forEach((e, k) => this._log.push({ at: t0 - (4 - k) * 47000, lv: e[0], msg: e[1] })); }
    const cpu = run && !RL ? Math.max(0.3, (2 + r(1) * 18) * (0.8 + 0.4 * Math.abs(Math.sin(t * (0.4 + r(2)) + r(3) * 6)))) : 0, mem = run && !RL ? Math.round(40 + r(4) * 220 + Math.sin(t * 0.2 + r(5)) * 6) : 0;
    const C = this._cpu || (this._cpu = []); if (C.t !== t) { C.push(cpu); if (C.length > 22) C.shift(); C.t = t; }
    const sp = '▁▂▃▄▅▆▇█', spark = C.map((v) => sp[Math.min(7, Math.floor(v / 25 * 7))]).join('');
    const ST = { run: ['실행', 'var(--t-ok,#60e28c)'], stop: ['멈춤', 'var(--t-key,#709c80)'], restart: ['다시 시작 중', 'var(--t-warn,#ffd27a)'], fail: ['실패', 'var(--t-err2,#ff9c8c)'] }[st] || ['—', 'var(--t-key,#709c80)'];
    const UP = RL ? this.upOf(m, run) : null, upS = Math.floor(r(6) * 90000) + t, up = RL ? UP.t + (UP.why ? ' · ' + UP.why : '') + (run && m.pid ? ' · pid ' + m.pid : '') + (m.restarts ? ' · 재시작 ' + m.restarts + '회' : '') : run ? (upS > 86400 ? Math.floor(upS / 86400) + 'd ' : '') + Math.floor(upS % 86400 / 3600) + 'h ' + Math.floor(upS % 3600 / 60) + 'm' : '—';
    const KIND = { service: '서비스', scene: '씬', runtime: '런타임', extension: '확장', tool: '도구', core: '코어' };
    const apps = (m.apps || []).map((a) => {
      const MODE = { static: ['static', ''], proxied: ['proxied', 'px'], window: ['window', 'wd'] }[a.mode] || [a.mode, ''];
      const where = a.mode === 'window' ? '자기 창 · 자기 origin (런처)' : m.remote ? '/gui/remote/' + m.node + '/…/' + (a.entry || '') : '/gui/apps/' + a.id + '/files/' + (a.entry || '');
      const asset = m.remote && a.mode !== 'window' && !RL ? (r(20 + a.id.length) < 0.25 ? 'stale' : 'cached') : '';
      return { mode: MODE[0], modeCls: MODE[1], name: a.name || a.id, where, state: asset ? '자산 ' + asset : a.mode === 'window' ? (run ? 'health ok' : '') : 'sandbox',
        off: run ? null : 'disabled', tip: run ? a.name + ' — 브라우저 창 열기' : '모듈 ' + ST[0] + ' — 시작 후 가능',
        open: () => { if (!run) return; if (this.props.onOpen) this.props.onOpen('web', 'mod|' + m.nodeId + '|' + m.id + '|' + a.id); } };
    });
    const T = this.TN(), RD = T ? T.read(m.nodeId, 'modules') : null, LK = T ? T.linkText(m.nodeId, RD && RD.at) : { t: '', cls: '', ro: false }, ro = !!LK.ro;
    const busy = !!S.busy || ro, tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: m.name, id: m.id, stT: ST[0], stCol: ST[1], node: m.node + (m.remote ? ' (원격)' : ''), ver: m.ver, kind: KIND[m.kind] || m.kind, up,
      path: (m.core ? '코어 내장 · ' : '~/.terra/module/') + (m.core ? m.id : m.id + '/' + m.ver), owner: m.core ? '코어 (지울 수 없음)' : m.dist ? 'Tree 배포' : '직접 설치',
      running: run, cpuP: Math.min(100, Math.round(cpu * 4)), cpuCol: cpu > 18 ? 'var(--t-warn,#ffd27a)' : 'var(--t-ok,#60e28c)', cpuT: RL ? '—' : cpu.toFixed(1) + '%', cpuS: RL ? '코어 : 모듈별 CPU op 없음' : spark, memP: Math.min(100, Math.round(mem / 4)), memT: RL ? '—' : mem + 'MB', memN: RL ? '코어 : 모듈별 메모리 op 없음' : 'RSS',
      apps, noGui: !apps.length, guiNote: !!apps.length && !run, guiNoteT: 'GUI 열기 불가 : 모듈 ' + ST[0] + ' — 시작 후 가능',
      cutOn: ro, cutH: LK.t.replace(/^끊김 · /, ''),
      linkT: LK.t ? '[' + LK.t + ']' : '', linkCol: LK.cls === 'off' ? 'var(--t-warn,#ffd27a)' : LK.cls === 'local' ? 'var(--t-key,#709c80)' : 'var(--t-acc2,#96f0aa)',
      busyD: busy ? 'disabled' : null, togD: busy || (run && m.core) ? 'disabled' : null, restart: () => this.act('restart'), toggle: () => this.act(run ? 'stop' : 'start'), toggleT: run ? (m.core ? '멈춤 불가 (코어)' : '멈춤') : '시작',
      ctl: () => { if (this.props.onOpen) this.props.onOpen('ctl', m.id); }, actNote: S.busy ? (S.busy === 'restart' ? '다시 시작 중…' : '요청 중…') : S.err ? '실패 · ' + S.err : m.remote ? '원격 노드 · node.control' : '',
      svi: (m.svi || []).map((n) => ({ name: n, open: () => { if (this.props.onOpen) this.props.onOpen('res', n + '|내 자원|' + m.node); } })), noSvi: !(m.svi || []).length,
      perms: m.perms || [], noPerm: !(m.perms || []).length,
      logs: this._log.slice().reverse().map((e) => ({ t: tm(e.at), lv: e.lv, col: e.lv === 'warn' ? 'var(--t-warn,#ffd27a)' : e.lv === 'error' ? 'var(--t-err2,#ff9c8c)' : 'var(--t-key,#709c80)', msg: e.msg })).concat(this.realLogs(m) || []),   // 이 창에서 한 요청 · 그 아래 Daemon 모듈 로그(실제)
      apiS: H ? 'modules.by-module-id.get' : '', apiG: H ? (m.remote ? 'gui/remote/{node}/apps' : 'gui/apps') : '', apiA: H ? 'restart · stop · start .post' : '', apiL: H ? '….logs.get' : RL ? 'Daemon 모듈 로그 · 최근 12줄 · 갱신 : 5s' : ''
    };
  }
}
