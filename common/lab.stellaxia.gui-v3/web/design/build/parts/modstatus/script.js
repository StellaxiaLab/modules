// 모듈 상태 창 — 노드 폴더 › 모듈 에서 모듈을 누르면. 모듈 하나의 상태 · 사용량 · GUI · 동작 · 내놓는 자원 · 권한 · 최근 로그를 CLI 처럼 (자원 상태 창과 같은 결, 바탕이 비친다)
//   GUI ↗ — 그 앱을 별도 브라우저 창으로 (onOpen('web', 'mod|노드 id|모듈 id|앱 id')). 모듈이 멈춰 있으면 못 연다
//   Terra 대응:
//     상태 · 사용량 — terra.daemon.modules.by-module-id.get (local · cluster, node.read)
//     GUI 목록 — Gateway GET /api/v1/gui/apps (이 노드) · GET /api/v1/gui/remote/{node}/apps (다른 노드 — Master 가 아는 카탈로그, 자산 cached|stale|absent)
//     동작 — …modules.by-module-id.restart.post · stop.post · start.post (local · cluster, node.control) — 원격 노드도 된다
//     로그 — …modules.by-module-id.logs.get
//   시안 — 시작 · 멈춤은 이 브라우저(terra.mod.st)에 남겨 노드 폴더 목록과 같이 바뀐다
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, busy: null }; this._log = []; this._k = '';
    try { window.addEventListener('terra-help', () => this.setState({})); window.addEventListener('terra-mod', () => this.setState({})); } catch (e) {} }
  componentDidMount() { this._live = true; this._iv = setInterval(() => { if (this._live) this.setState({ t: this.state.t + 1 }); }, 1000); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); clearTimeout(this._bt); }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  M() { const m = this.props.mod; return m && m.id ? m : { id: 'io.terra.agent', name: 'Terra Agent', ver: '0.3.0', kind: 'service', apps: [{ id: 'io.terra.agent', name: 'Terra Agent', mode: 'static', entry: 'ui/index.html' }], perms: ['coreOperations', 'storage', 'network'], svi: ['ctl/log'], st: 'run', node: '01·a', nodeId: 'L1', remote: false }; }
  stMap() { try { return JSON.parse(localStorage.getItem('terra.mod.st') || '{}') || {}; } catch (e) { return {}; } }
  st() { const m = this.M(), o = this.stMap()[m.nodeId + '|' + m.id]; return o || m.st || 'run'; }
  setSt(v) { const m = this.M(), map = this.stMap(); map[m.nodeId + '|' + m.id] = v; try { localStorage.setItem('terra.mod.st', JSON.stringify(map)); window.dispatchEvent(new Event('terra-mod')); } catch (e) {} }
  seed() { let h = 11; for (const ch of this.M().id + this.M().nodeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  log(lv, msg) { this._log.push({ at: Date.now(), lv, msg }); if (this._log.length > 7) this._log.shift(); }
  act(kind) {
    const m = this.M(); if (m.core && kind === 'stop') return;
    const to = { restart: 'run', stop: 'stop', start: 'run' }[kind], verb = { restart: '다시 시작', stop: '멈춤', start: '시작' }[kind];
    this.setState({ busy: kind }); this.log('info', verb + ' 요청 · ' + m.node);
    clearTimeout(this._bt); this._bt = setTimeout(() => { this.setSt(to); this.log(to === 'run' ? 'info' : 'warn', to === 'run' ? '실행 중' : '멈춤'); this.setState({ busy: null }); }, kind === 'restart' ? 1300 : 800);
  }
  renderVals() {
    const m = this.M(), H = this.help(), S = this.state, t = S.t, r = (i) => this.rnd(i), st = S.busy === 'restart' ? 'restart' : this.st(), run = st === 'run';
    if (this._k !== m.nodeId + '|' + m.id) { this._k = m.nodeId + '|' + m.id; this._log = []; this._cpu = []; const t0 = Date.now();
      [['info', '설치 확인 · ' + m.ver], ['info', 'manifest 검사 통과'], [st === 'fail' ? 'error' : 'info', st === 'fail' ? '시작 실패 — exit 1' : st === 'stop' ? '멈춤 (사용자)' : '시작 · pid ' + (2000 + Math.floor(r(9) * 7000))], ['info', run ? 'health ok' : 'health —']]
        .forEach((e, k) => this._log.push({ at: t0 - (4 - k) * 47000, lv: e[0], msg: e[1] })); }
    const cpu = run ? Math.max(0.3, (2 + r(1) * 18) * (0.8 + 0.4 * Math.abs(Math.sin(t * (0.4 + r(2)) + r(3) * 6)))) : 0, mem = run ? Math.round(40 + r(4) * 220 + Math.sin(t * 0.2 + r(5)) * 6) : 0;
    const C = this._cpu || (this._cpu = []); if (C.t !== t) { C.push(cpu); if (C.length > 22) C.shift(); C.t = t; }
    const sp = '▁▂▃▄▅▆▇█', spark = C.map((v) => sp[Math.min(7, Math.floor(v / 25 * 7))]).join('');
    const ST = { run: ['실행', '#60e28c'], stop: ['멈춤', '#709c80'], restart: ['다시 시작 중', '#ffd27a'], fail: ['실패', '#ff9c8c'] }[st] || ['—', '#709c80'];
    const upS = Math.floor(r(6) * 90000) + t, up = run ? (upS > 86400 ? Math.floor(upS / 86400) + '일 ' : '') + Math.floor(upS % 86400 / 3600) + '시간 ' + Math.floor(upS % 3600 / 60) + '분' : '—';
    const KIND = { service: '서비스', scene: '씬', runtime: '런타임', extension: '확장', tool: '도구', core: '코어' };
    const apps = (m.apps || []).map((a) => {
      const MODE = { static: ['static', ''], proxied: ['proxied', 'px'], window: ['window', 'wd'] }[a.mode] || [a.mode, ''];
      const where = a.mode === 'window' ? '자기 창 · 자기 origin (런처)' : m.remote ? '/gui/remote/' + m.node + '/…/' + (a.entry || '') : '/gui/apps/' + a.id + '/files/' + (a.entry || '');
      const asset = m.remote && a.mode !== 'window' ? (r(20 + a.id.length) < 0.25 ? 'stale' : 'cached') : '';
      return { mode: MODE[0], modeCls: MODE[1], name: a.name || a.id, where, state: asset ? '자산 ' + asset : a.mode === 'window' ? (run ? 'health ok' : '') : 'sandbox',
        off: run ? null : 'disabled', tip: run ? a.name + ' 을 브라우저 창으로' : '모듈이 ' + ST[0] + ' — 시작한 뒤에',
        open: () => { if (!run) return; if (this.props.onOpen) this.props.onOpen('web', 'mod|' + m.nodeId + '|' + m.id + '|' + a.id); } };
    });
    const busy = !!S.busy, tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: m.name, id: m.id, stT: ST[0], stCol: ST[1], node: m.node + (m.remote ? ' (원격)' : ''), ver: m.ver, kind: KIND[m.kind] || m.kind, up,
      path: (m.core ? '코어 내장 · ' : '~/.terra/module/') + (m.core ? m.id : m.id + '/' + m.ver), owner: m.core ? '코어 (지울 수 없음)' : m.dist ? 'Tree 배포' : '직접 설치',
      running: run, cpuP: Math.min(100, Math.round(cpu * 4)), cpuCol: cpu > 18 ? '#ffd27a' : '#60e28c', cpuT: cpu.toFixed(1) + '%', cpuS: spark, memP: Math.min(100, Math.round(mem / 4)), memT: mem + ' MB', memN: 'RSS',
      apps, noGui: !apps.length, guiNote: !!apps.length && !run, guiNoteT: '모듈이 ' + ST[0] + ' 상태라 GUI 를 열 수 없어요 — 시작하면 열 수 있어요',
      busyD: busy ? 'disabled' : null, togD: busy || (run && m.core) ? 'disabled' : null, restart: () => this.act('restart'), toggle: () => this.act(run ? 'stop' : 'start'), toggleT: run ? (m.core ? '멈춤 불가 (코어)' : '멈춤') : '시작',
      ctl: () => { if (this.props.onOpen) this.props.onOpen('ctl', m.id); }, actNote: busy ? (S.busy === 'restart' ? '다시 시작 중…' : '요청 중…') : m.remote ? '원격 노드 · node.control' : '',
      svi: (m.svi || []).map((n) => ({ name: n, open: () => { if (this.props.onOpen) this.props.onOpen('res', n + '|내 자원|' + m.node); } })), noSvi: !(m.svi || []).length,
      perms: m.perms || [], noPerm: !(m.perms || []).length,
      logs: this._log.slice().reverse().map((e) => ({ t: tm(e.at), lv: e.lv, col: e.lv === 'warn' ? '#ffd27a' : e.lv === 'error' ? '#ff9c8c' : '#709c80', msg: e.msg })),
      apiS: H ? 'modules.by-module-id.get' : '', apiG: H ? (m.remote ? 'gui/remote/{node}/apps' : 'gui/apps') : '', apiA: H ? 'restart · stop · start .post' : '', apiL: H ? '….logs.get' : ''
    };
  }
}
