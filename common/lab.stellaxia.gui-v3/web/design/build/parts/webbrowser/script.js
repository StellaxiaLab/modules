// 브라우저 창 — 모듈 GUI(모듈 상태 창 › GUI ↗)를 별도 창으로, 그리고 제어기 › 웹 브라우저 앱의 몸통(같은 보드)
//   주소: terra://start (이 노드의 모듈 화면 목록) · 모듈 앱(Gateway 가 내주는 주소) · http(s) 주소
//   Terra 대응 (Gateway, WebApp Host 설계):
//     static · proxied 앱 — POST /api/v1/gui/apps/{id}/token(앱 스코프 토큰) → GET /api/v1/gui/apps/{id}/files/{entry} — 늘 sandbox iframe, 인라인 스크립트 금지 CSP
//     다른 노드의 앱 — GET /api/v1/gui/remote/{node}/apps(Master 카탈로그 · 자산 cached|stale|absent) → stale · absent 면 POST …/{node}/{module}/{app}/sync → …/files/{entry}
//     window 앱 — 자산을 내주지 않는다. GET /api/v1/gui/apps/{id}/window/health 뒤 그 앱의 자기 origin(런처가 띄운 창)
//   시안 — 모듈 화면은 앱마다 정해 둔 예시 화면(스크립트 없는 HTML), http(s) 는 실제 iframe (사이트가 창 안 표시를 막으면 비어 보인다 → ↗ 새 탭)
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { hist: [], idx: -1, input: '', t0: 0, synced: {}, fr: 0 }; this._u0 = null;
    try { window.addEventListener('terra-help', () => this.setState({})); window.addEventListener('terra-mod', () => this.setState({})); } catch (e) {} }
  componentWillUnmount() { cancelAnimationFrame(this._raf); this._raf = 0; }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  GW() { return 'http://127.0.0.1:8787'; }
  cat() { return Array.isArray(this.props.catalog) ? this.props.catalog : []; }
  stOf(e) { try { const o = (JSON.parse(localStorage.getItem('terra.mod.st') || '{}') || {})[e.nodeId + '|' + e.modId]; return o || e.st || 'run'; } catch (x) { return e.st || 'run'; } }
  urlOf(e) { if (e.mode === 'window') return 'http://127.0.0.1:' + (e.port || 17440) + '/';
    return this.GW() + (e.remote ? '/api/v1/gui/remote/' + e.nodeId + '/' + e.modId + '/' + e.appId : '/api/v1/gui/apps/' + e.appId) + '/files/' + (e.entry || ''); }
  // 주소 → 무엇을 열지
  resolve(u) {
    u = String(u || '').trim(); if (!u || u === 'terra://start') return { kind: 'start', url: 'terra://start' };
    const C = this.cat();
    if (u.startsWith('mod|')) { const e = C.find((q) => q.arg === u); return e ? { kind: 'mod', e, url: this.urlOf(e) } : { kind: 'err', url: u, err: '이 창이 모르는 모듈 화면', note: '노드 폴더 › 모듈 에서 다시 열어 주세요' }; }
    const e = C.find((q) => this.urlOf(q) === u || u.startsWith(this.urlOf(q).replace(/\/files\/.*$/, '/files/')) || q.appId === u || q.modId === u || (q.appName || '').toLowerCase() === u.toLowerCase() || (q.modName || '').toLowerCase() === u.toLowerCase());
    if (e) return { kind: 'mod', e, url: this.urlOf(e) };
    if (/^https?:\/\/\S+$/i.test(u)) return { kind: 'web', url: u };
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) return { kind: 'web', url: 'https://' + u };
    return { kind: 'err', url: u, err: '열 수 없는 주소', note: 'http(s):// 주소, terra://start, 또는 이 노드의 모듈 이름' };
  }
  nav(u) { const S = this.state, H = S.hist.slice(0, S.idx + 1); H.push(u); this.setState({ hist: H, idx: H.length - 1, input: '', t0: performance.now(), typing: false }); }
  syncFrame() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.setState({ fr: performance.now() }); }); }
  steps(R) {
    const e = R.e, S = this.state, run = this.stOf(e) === 'run';
    if (!run) return { err: '모듈이 ' + ({ stop: '멈춰', fail: '실패해', restart: '다시 시작 중이라' }[this.stOf(e)] || '멈춰') + ' 있어요', note: e.modName + ' 을 시작한 뒤에 다시 — 노드 폴더 › 모듈 › 상태 창에서 시작' };
    const L = [];
    if (e.mode === 'window') { L.push(['health 확인', 'window/health'], ['자기 origin 열기 · 런처가 띄운 창', '']); return { L }; }
    if (e.remote) { L.push(['Master 카탈로그에서 찾기', 'gui/remote/' + e.nodeId + '/apps']);
      if (e.asset !== 'cached' && !S.synced[e.arg]) return { L, sync: true };
      if (S.synced[e.arg]) L.push(['자산 동기화됨', '…/sync']); }
    L.push(['앱 스코프 토큰', (e.remote ? 'gui/remote/…/' : 'gui/apps/' + e.appId + '/') + 'token'], [e.mode === 'proxied' ? '모듈 웹서버로 중계 (loopback)' : '자산 받기 · ' + (e.entry || 'index'), 'files/' + (e.entry || '')], ['sandbox 로 띄우기', 'CSP: 인라인 스크립트 금지']);
    return { L };
  }
  renderVals() {
    const P = this.props, S = this.state, H = this.help();
    if (this._u0 !== (P.url || '')) { this._u0 = P.url || ''; S.hist = [this._u0 || 'terra://start']; S.idx = 0; S.t0 = performance.now(); S.input = ''; S.typing = false; }
    const cur = S.hist[S.idx] || 'terra://start', R = this.resolve(cur), now = performance.now(), el = now - S.t0;
    const O = { rootW: P.winW ? P.winW + 'px' : '100%', rootH: P.winH ? P.winH + 'px' : '100vh', isStart: false, isLoad: false, isSync: false, isErr: false, isDoc: false, isWeb: false, steps: [], cards: [], chips: [], extD: 'none', extHref: '#' };
    O.input = S.typing ? S.input : R.url; O.inp = (ev) => this.setState({ input: ev.target.value, typing: true }); O.selAll = (ev) => { try { ev.target.select(); } catch (x) {} };
    O.go = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); const v = (this.state.typing ? this.state.input : O.input).trim(); if (v) this.nav(v); };
    O.backD = S.idx > 0 ? null : 'disabled'; O.fwdD = S.idx < S.hist.length - 1 ? null : 'disabled';
    O.back = () => { if (this.state.idx > 0) this.setState({ idx: this.state.idx - 1, t0: performance.now(), typing: false }); };
    O.fwd = () => { if (this.state.idx < this.state.hist.length - 1) this.setState({ idx: this.state.idx + 1, t0: performance.now(), typing: false }); };
    O.reload = () => this.setState({ t0: performance.now(), typing: false }); O.home = () => this.nav('terra://start');
    O.lockT = R.kind === 'mod' ? 'TERRA' : R.kind === 'web' ? (/^https:/i.test(R.url) ? 'https' : 'http') : R.kind === 'start' ? '⌂' : '?'; O.lockTip = R.kind === 'mod' ? 'Gateway 가 내준 모듈 화면' : '';
    O.addrCls = R.kind === 'mod' ? 'mod' : ''; O.apiT = ''; O.noteT = ''; O.statusT = '';
    if (R.kind === 'start') {
      const C = this.cat(); O.isStart = true; O.startNote = (P.nodeName || '이 노드') + ' — 화면이 있는 모듈 ' + C.length + '개'; O.noCards = !C.length;
      O.cards = C.map((e) => { const st = this.stOf(e), on = st === 'run', MD = { static: '', proxied: 'px', window: 'wd' }[e.mode] || '';
        return { app: e.appName, mod: e.modName, mode: e.mode, modeCls: MD, node: e.node + (e.remote ? ' · 원격' : ''), st: on ? '● 실행' : '○ ' + ({ stop: '멈춤', fail: '실패', restart: '다시 시작 중' }[st] || st), cls: on ? '' : 'off', off: on ? null : 'disabled', open: () => this.nav(e.arg) }; });
      O.statusT = '시작 페이지'; O.chips = [{ t: 'terra://start', cls: '' }];
    } else if (R.kind === 'err') { O.isErr = true; O.errT = R.err; O.errNote = R.note; O.statusT = '열지 못함'; }
    else if (R.kind === 'web') { O.isWeb = true; O.src = R.url; O.frameTitle = R.url; O.extD = 'inline-flex'; O.extHref = R.url; O.chips = [{ t: 'web', cls: '' }, { t: 'sandbox', cls: 'sb' }];
      O.statusT = '외부 사이트'; O.noteT = '사이트가 창 안 표시를 막으면 비어 보여요 — ↗ 새 탭'; }
    else {
      const e = R.e, MD = { static: ['static', 'ok'], proxied: ['proxied', 'px'], window: ['window', 'wd'] }[e.mode] || [e.mode, ''];
      O.chips = [{ t: MD[0], cls: MD[1] }, { t: e.mode === 'window' ? '자기 origin' : 'sandbox · CSP', cls: 'sb' }, { t: e.node + (e.remote ? ' · 원격' : ''), cls: '' }, { t: e.modId + ' ' + (e.ver || ''), cls: '' }];
      const st = this.steps(R);
      if (st.err) { O.isErr = true; O.errT = st.err; O.errNote = st.note; O.statusT = 'GUI_APP_UNAVAILABLE'; }
      else if (st.sync) { O.isSync = true; O.syncT = e.node + ' 의 자산이 ' + (e.asset === 'absent' ? '아직 없어요 (absent)' : '오래됐어요 (stale)'); O.syncNote = '다른 노드의 화면은 버전마다 한 번 이 Gateway 로 받아 둬야 열려요 — POST /api/v1/gui/remote/' + e.nodeId + '/' + e.modId + '/' + e.appId + '/sync';
        O.sync = () => this.setState({ synced: { ...this.state.synced, [e.arg]: true }, t0: performance.now() }); O.statusT = '동기화 필요'; }
      else { const STEP = 230, k = Math.floor(el / STEP);
        if (k < st.L.length) { O.isLoad = true; O.steps = st.L.map(([t, api], i) => ({ t, api: H ? api : '', mark: i < k ? '✓' : i === k ? '›' : '·', cls: i < k ? 'ok' : i === k ? 'on' : '' })); O.statusT = '불러오는 중…'; this.syncFrame(); }
        else { O.isDoc = true; O.doc = this.page(e); O.frameTitle = e.appName; O.statusT = '완료 · ' + (st.L.length * STEP / 1000).toFixed(2) + 's'; O.noteT = e.mode === 'window' ? '런처가 띄운 창 — 자산은 Gateway 를 거치지 않아요' : 'Gateway 가 내준 화면 · sandbox iframe'; } }
      O.apiT = H ? (e.mode === 'window' ? 'gui/apps/' + e.appId + '/window/health' : e.remote ? 'gui/remote/{node}/{module}/{app}/files' : 'gui/apps/{id}/files') : '';
    }
    return O;
  }
  // 예시 모듈 화면 — 앱마다. 스크립트 없는 HTML(모듈 화면은 인라인 스크립트가 금지된 CSP 로 온다)
  page(e) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const base = '*{box-sizing:border-box}body{margin:0;font:13px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif;color:#e8ecf6;background:#11151f}header{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #262c3c;background:#161b28}header b{font-size:14px}header span{color:#8c95ad;font-size:12px}.dim{color:#8c95ad}.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;border:1px solid #3a4258;color:#b9c2da}';
    const wrap = (title, css, body) => '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + base + css + '</style></head><body><header><b>' + esc(title) + '</b><span>' + esc(e.modId + ' ' + (e.ver || '')) + ' · ' + esc(e.node) + '</span></header>' + body + '</body></html>';
    const id = e.appId;
    if (/agent/.test(id)) return wrap(e.appName, '.g{display:grid;grid-template-columns:200px 1fr;height:calc(100vh - 45px)}.l{border-right:1px solid #262c3c;padding:10px}.l div{padding:6px 8px;border-radius:6px;margin-bottom:4px}.l .on{background:#1f2738}.m{display:flex;flex-direction:column;padding:14px;gap:10px}.b{max-width:70%;padding:8px 12px;border-radius:10px;background:#1b2232}.u{align-self:flex-end;background:#2a3b6a}.in{margin-top:auto;border:1px solid #333b52;border-radius:8px;padding:9px 12px;color:#7c86a0}',
      '<div class="g"><div class="l"><div class="dim">세션</div><div class="on">노드 점검</div><div>로그 요약</div><div>모듈 배포</div></div><div class="m"><div class="b u">이 노드 디스크 상태 알려줘</div><div class="b">/ 는 62% 사용 중이고, ~/.terra/module 이 3.1 GB 예요. 최근 7일 증가량은 0.4 GB.</div><div class="b u">로그 묶어서 보내줘</div><div class="b">작업을 만들었어요 — <span class="pill">process.execute</span> 승인이 필요해요.</div><div class="in">메시지 입력…</div></div></div>');
    if (/nodetalk/.test(id)) return wrap(e.appName, '.g{display:grid;grid-template-columns:180px 1fr;height:calc(100vh - 45px)}.l{border-right:1px solid #262c3c;padding:10px}.l div{padding:5px 8px}.l i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5bd68a;margin-right:6px}.m{padding:14px;display:flex;flex-direction:column;gap:8px}.r{display:grid;grid-template-columns:70px 1fr;gap:10px}.r b{color:#9cc0ff}',
      '<div class="g"><div class="l"><div class="dim">노드</div><div><i></i>01·a</div><div><i></i>01·b</div><div><i style="background:#888"></i>02</div></div><div class="m"><div class="r"><b>01·a</b><span>camera/frames 다시 열었어요</span></div><div class="r"><b>01·b</b><span>확인 — 30fps 로 받는 중</span></div><div class="r"><b>' + esc(e.node) + '</b><span>sensor/stats 기록 시작</span></div></div></div>');
    if (/scene-studio/.test(id)) return wrap(e.appName, '.g{display:grid;grid-template-columns:180px 1fr 200px;height:calc(100vh - 45px)}.p{padding:10px;border-right:1px solid #262c3c}.p:last-child{border-right:0;border-left:1px solid #262c3c}.c{position:relative;background:#0c0f17;background-image:linear-gradient(#1a2030 1px,transparent 1px),linear-gradient(90deg,#1a2030 1px,transparent 1px);background-size:24px 24px}.bx{position:absolute;border:1px solid #6f8cff;background:rgba(111,140,255,.12);font-size:11px;padding:4px}.row{display:flex;justify-content:space-between;padding:3px 0;color:#b9c2da}',
      '<div class="g"><div class="p"><div class="dim">씬</div><div>▾ main</div><div>&nbsp;&nbsp;title</div><div>&nbsp;&nbsp;status-bar</div><div>&nbsp;&nbsp;node-list</div></div><div class="c"><div class="bx" style="left:40px;top:30px;width:240px;height:40px">title</div><div class="bx" style="left:40px;top:90px;width:340px;height:160px">node-list</div><div class="bx" style="left:40px;top:270px;width:340px;height:28px">status-bar</div></div><div class="p"><div class="dim">속성</div><div class="row"><span>x</span><span>40</span></div><div class="row"><span>y</span><span>90</span></div><div class="row"><span>w</span><span>340</span></div><div class="row"><span>source</span><span>daemon.nodes</span></div></div></div>');
    if (/gui-v3/.test(id)) return wrap(e.appName, '.f{height:calc(100vh - 45px);display:flex;align-items:center;justify-content:center;background:#05070f;color:#2c3a66;font:12px/1.2 monospace;overflow:hidden;position:relative;letter-spacing:2px}.f pre{margin:0}.t{position:absolute;color:#e6eaf7;font:700 54px/1 system-ui;letter-spacing:12px}',
      '<div class="f"><pre>' + Array.from({ length: 30 }, (_, r) => Array.from({ length: 90 }, (_, c) => '·:;+=*#%'[(r * 7 + c * 13 + r * c) % 8]).join('')).join('\n') + '</pre><div class="t">TERRA</div></div>');
    if (/node-gui/.test(id)) return wrap(e.appName, '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px}.k{border:1px solid #262c3c;border-radius:10px;padding:12px;background:#161b28}.k b{display:block;font-size:22px;margin-top:4px}.bar{height:6px;border-radius:3px;background:#262c3c;margin-top:8px}.bar i{display:block;height:100%;border-radius:3px;background:#5bd68a}',
      '<div class="g"><div class="k"><span class="dim">CPU</span><b>23%</b><div class="bar"><i style="width:23%"></i></div></div><div class="k"><span class="dim">모듈</span><b>5 실행</b><span class="dim">1 멈춤</span></div><div class="k"><span class="dim">자원</span><b>4</b><span class="dim">내놓음 3 · 받음 1</span></div></div>');
    if (/sample\.window/.test(id)) return wrap(e.appName, '.c{height:calc(100vh - 45px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}.c b{font-size:24px}', '<div class="c"><b>Hello from a window app</b><span class="dim">자기 프로세스 · 자기 UI origin — 런처가 띄운 창</span><span class="pill">singleInstance</span></div>');
    return wrap(e.appName, '.c{padding:20px}', '<div class="c"><p>' + esc(e.appName) + '</p><p class="dim">' + esc(this.urlOf(e)) + '</p></div>');
  }
}
