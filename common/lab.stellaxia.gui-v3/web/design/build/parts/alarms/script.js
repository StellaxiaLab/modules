// 알림 창 — 이 GUI 를 띄운 노드(로컬 Daemon)의 작업 · 모듈 상태가 바뀐 것. 노드별이 아니라 전역 하나(전역 틀 설정 › 알림)
//   실제(웹 빌드): window.TerraAlarmBook — src/api/alarms.js startAlarms 의 알림 책. terra.daemon.tasks.get · terra.daemon.modules.get 을 10초마다(밀어 받기가 오면 바로)
//                  읽어 바뀐 끝 상태만 알림으로. 읽음 · 지우기는 이 브라우저 메모리에만(Terra 에 쓰지 않는다). 바뀌면 'terra-alarms' 신호로 다시 그린다
//   시안(캔버스): diff() 출력 모양 그대로의 시안 알림 — 이 창 안의 책(window.TerraAlarmDemo — 전역 틀 배지가 읽는다)
//   줄을 누르면 읽음 + 대상으로 — 작업이면 제어기 › 작업 관리자(그 작업을 고른 채), 모듈이면 모듈 상태 창
//   모두 지우기는 두 번 누르기(되돌릴 수 없다 · 이 화면의 목록만 — Terra 의 작업 · 모듈에는 영향 없음)

// ── src/api/alarms.js 와 같은 사본 (tests/alarms-board.test.mjs 가 맞춰 본다) ──
const ALARM_FILTERS = [['all', '전체'], ['task', '작업'], ['module', '모듈'], ['bad', '실패만'], ['unread', '안 읽음']];
function alarmKey(a) { return a.key || [a.kind, a.id, a.at, a.st || a.m].join('|'); }
function filterAlarms(list, f) {
  const L = list || [];
  if (f === 'task' || f === 'module') return L.filter((a) => a.kind === f);
  if (f === 'bad') return L.filter((a) => a.sev === 'bad');
  if (f === 'unread') return L.filter((a) => !a.read);
  return L.slice();
}
function countAlarms(list) { const o = {}; for (const [k] of ALARM_FILTERS) o[k] = filterAlarms(list, k).length; return o; }
function markRead(list, key) {
  const K = Array.isArray(key) ? new Set(key) : null;
  return (list || []).map((a) => (key === '*' || (K ? K.has(alarmKey(a)) : alarmKey(a) === key) ? (a.read ? a : Object.assign({}, a, { read: true })) : a));
}
function clearAlarms(list, key) {
  if (key === '*') return [];
  const K = Array.isArray(key) ? new Set(key) : new Set([key]);
  return (list || []).filter((a) => !K.has(alarmKey(a)));
}
function addAlarms(list, fresh, keep = 50) {
  const add = (fresh || []).map((a) => Object.assign({ read: false }, a, { key: alarmKey(a) })).reverse();
  return add.concat(list || []).slice(0, keep);
}
// ── 사본 끝 ──

class Component extends DCLogic {
  constructor(props) { super(props); this.state = { t: 0, f: 'all', arm: false };
    this._sig = () => this._live !== false && this.setState({});
    try { window.addEventListener('terra-alarms', this._sig); } catch (e) {} }
  componentDidMount() {
    this._live = true;
    this._iv = setInterval(() => { if (!this._live) return; const t = this.state.t + 1; this.setState({ t }); if (!this.real() && t % 40 === 0) this.demoTick(); }, 1000);   // 시각('n분 전')을 다시 · 시안은 40초마다 하나씩 들어온다
  }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); clearTimeout(this._armT); try { window.removeEventListener('terra-alarms', this._sig); } catch (e) {} }
  real() { return typeof window !== 'undefined' && !!window.TerraTransport; }
  // 책 — 실제: main.js 의 알림 책(로그인 뒤에만 있다) · 시안: 이 창의 책
  book() { if (this.real()) return window.TerraAlarmBook || null; return this.demo(); }
  demo() {
    if (this._demo) return this._demo;
    const list = [], put = (next) => { list.splice(0, list.length, ...next); try { window.dispatchEvent(new Event('terra-alarms')); } catch (e) {} };
    const now = Date.now(), A = (sec, kind, id, st, name, extra) => this.sampleOne(now - sec * 1000, kind, id, st, name, extra);
    put(addAlarms([], [A(5400, 'task', 't_51c0', 'succeeded', 'module.install'), A(3100, 'module', 'io.terra.nodetalk', 'failed', '노드 대화', ' · exit 1'), A(2900, 'module', 'io.terra.nodetalk', 'running', '노드 대화'),
      A(1500, 'task', 't_6a2e', 'canceled', 'process.execute'), A(840, 'task', 't_7f13', 'timed_out', 'svi.bind'), A(420, 'module', 'io.terra.ext.metrics', 'config_invalid', 'Metrics'), A(95, 'task', 't_8d04', 'failed', 'module.install'), A(30, 'task', 't_8d11', 'succeeded', 'core.update.check')]));
    for (const a of list.slice(4)) a.read = true;   // 오래된 것 몇은 읽은 채로
    this._demo = { list, add(f) { put(addAlarms(list, f)); }, read(k) { put(markRead(list, k)); }, clear(k) { put(clearAlarms(list, k)); }, unread() { return list.filter((a) => !a.read).length; }, sample: true };
    try { window.TerraAlarmDemo = this._demo; setTimeout(() => { try { window.dispatchEvent(new Event('terra-alarms')); } catch (e) {} }, 0); } catch (e) {}   // 전역 틀 배지가 시안에서도 수를 읽게
    return this._demo;
  }
  // 시안 알림 하나 — src/api/alarms.js diff() 가 내는 모양 그대로
  sampleOne(at, kind, id, st, name, extra) {
    const T = { succeeded: ['완료', '●', '#4ade80', 'ok'], failed: ['실패', '■', '#ff6b81', 'bad'], timed_out: ['시간 초과', '■', '#ff6b81', 'bad'], canceled: ['취소됨', '◐', '#fbbf24', 'warn'] };
    if (kind === 'task') { const K = T[st]; return { at, kind, id, g: K[1], c: K[2], m: '작업 ' + name + ' ' + K[0], sev: K[3], st, name }; }
    if (st === 'running') return { at, kind, id, g: '●', c: '#4ade80', m: '모듈 ' + name + ' — 재가동', sev: 'ok', st, name };
    return { at, kind, id, g: '■', c: '#ff6b81', m: '모듈 ' + name + ' — ' + st + (extra || ''), sev: 'bad', st, name };
  }
  demoTick() { const D = this.demo(), n = (this._dn = (this._dn || 0) + 1), ok = n % 3 !== 0; D.add([this.sampleOne(Date.now(), 'task', 't_9' + String(n).padStart(3, '0'), ok ? 'succeeded' : 'failed', ok ? 'svi.declare' : 'process.execute')]); }
  go(a) {
    const B = this.book(); if (B && !a.read) B.read(a.key);
    const on = this.props.onOpen; if (!on) return;
    if (a.kind === 'task') on('ctl', 'jobs:' + a.id); else if (a.kind === 'module') on('mod', a.id);
  }
  clearAll(keys) {
    const B = this.book(); if (!B || !keys.length) return;
    if (!this.state.arm) { this.setState({ arm: true }); clearTimeout(this._armT); this._armT = setTimeout(() => this._live && this.setState({ arm: false }), 4000); return; }
    clearTimeout(this._armT); B.clear(this.state.f === 'all' ? '*' : keys); this.setState({ arm: false });
  }
  renderVals() {
    const R = this.real(), B = this.book(), S = this.state, f = S.f, L = B ? B.list : [], C = countAlarms(L), shown = filterAlarms(L, f), now = Date.now(), D = '—';
    const pad = (x) => String(x).padStart(2, '0'), hms = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
    const ago = (ms) => { const s = Math.max(0, (now - ms) / 1000); return s < 60 ? '방금' : s < 3600 ? Math.round(s / 60) + 'm 전' : s < 86400 ? Math.round(s / 3600) + 'h 전' : Math.round(s / 86400) + 'd 전'; };
    const fName = (ALARM_FILTERS.find((x) => x[0] === f) || [0, '전체'])[1], keys = shown.map(alarmKey), unShown = shown.filter((a) => !a.read).map(alarmKey);
    const note = R && !B ? '로그인 뒤에 수신 — 이 노드 Daemon 아직 안 읽음' : '';
    const items = shown.map((a) => ({
      cls: a.read ? 'rd' : '', dot: a.read ? '○' : '●', dotCol: a.read ? '#4f6e5a' : a.sev === 'bad' ? '#ff9c8c' : '#96f0aa',
      t: now - a.at < 86400000 ? hms(a.at) : ago(a.at), full: new Date(a.at).toLocaleString() + ' · ' + ago(a.at), g: a.g, c: a.c,
      kindT: a.kind === 'task' ? '작업' : a.kind === 'module' ? '모듈' : a.kind, kindCls: a.kind === 'module' ? 'md' : '', m: a.m, id: a.id || D,
      tgt: (a.kind === 'task' ? a.id : a.name || a.id) || D, goTip: a.kind === 'task' ? '읽음 · 제어기 › 작업 관리자 — ' + a.id : '읽음 · 모듈 상태 창 — ' + (a.name || a.id),
      go: () => this.go(a), readOff: a.read ? 'disabled' : null, read: () => B && B.read(a.key), clear: () => B && B.clear(a.key) }));
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.props.nodeName || D,
      unread: C.unread, total: C.all, unCol: C.unread ? '#96f0aa' : '#4f6e5a',
      srcT: R ? '출처 : terra.daemon.tasks.get · modules.get · 갱신 : 10s + 밀어 받기 · 최근 50 · 읽음 : 이 브라우저만' : '시안 값 · diff() 모양 · 갱신 : 40s',
      noteOn: !!note, note,
      filters: ALARM_FILTERS.map(([k, nm]) => ({ name: nm, n: C[k], on: f === k ? 'true' : 'false', cls: f === k ? 'on' : '', pick: () => this.setState({ f: k, arm: false }) })),
      readT: f === 'all' ? '모두 읽음' : fName + ' 읽음', readOff: unShown.length ? null : 'disabled', readTip: '읽음 : ' + unShown.length + '개',
      readAll: () => B && B.read(f === 'all' ? '*' : unShown),
      clrT: S.arm ? '한 번 더 : ' + keys.length + '개 지움' : f === 'all' ? '모두 지우기' : fName + ' 지우기', clrCls: S.arm ? 'arm' : '', clrOff: keys.length ? null : 'disabled',
      clrTip: '알림 ' + keys.length + '개 · 되돌리기 : 불가', clearAll: () => this.clearAll(keys),
      armOn: !!S.arm, armT: '무엇 : ' + (f === 'all' ? '알림 전부' : fName) + ' ' + keys.length + '개 · 어디 : 이 목록 (Terra 작업 · 모듈 그대로) · 되돌리기 : 불가 · 4s 안에 다시',
      listSum: f === 'all' ? C.all + '개' : fName + ' ' + shown.length + ' / ' + C.all,
      items, empty: !items.length,
      emptyT: !B ? (R ? '받는 중…' : D) : C.all ? fName + ' 알림 없음' : '알림 없음 — 작업 종료 · 모듈 상태 변화 시 표시',
      gaps: [{ t: '첫 상태 — 열기 전 끝난 작업 · 실패 모듈 알림 없음 (변화만)' }, { t: '다른 노드 — 이 노드 Daemon 만 (그 밖 : 그 노드 제어기 › 작업 관리자)' },
        { t: '읽음 · 지움 — 이 브라우저 메모리만 (Terra 에 알림 상태 없음 · 새로고침 시 초기화)' }],
    };
  }
}
