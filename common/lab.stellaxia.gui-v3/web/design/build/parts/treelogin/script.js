// Tree 로그인 창 — 다른 Tree 로 옮겨 갈 때 그 Tree 의 세션이 없으면 뜬다(트리 진입 · 지도 · 우클릭 › 로그인).
//   CLI 꼴(전역 틀 레퍼런스 01 · 02): 프롬프트 줄 '○ 나@지금 Tree % terra login tree <이름>' · ● 상태 줄(route · master · session) · 둥근 1px 입력 상자의 '>' 줄 · 단축키 줄
//   포스터 HUD(레퍼런스 04): 코너 괄호 패널 · 흰 바탕 검은 글자 띠(TREE · ROUTE · AUTH) · 외곽선만 있는 큰 이름 · 사선 칸(상태 색) · 작은 대문자 메타 · 네 귀퉁이 '+'
//   바탕은 투명(상태 창처럼 글자 장이 비친다 — 글자에 어두운 그림자). 생성 모션은 왼쪽 → 오른쪽:
//     글자 — 로그인 씬과 같은 '랜덤 갱신 · 주기 증가': 칸마다 왼쪽부터 차례로 나타나 무작위 글자로 몇 번 바뀌며(간격이 점점 길어진다) 제 글자에 멈춘다. 값이 바뀐 줄(상태 · 알림)도 그 줄만 다시
//     GUI — 채우기: 코너 · 띠 · 사선 칸 · 테두리 · 단추 · 큰 글자가 왼쪽에서 오른쪽으로 차오른다(clip-path, CSS — 창이 열리거나 대상이 바뀔 때마다)
//   Terra 대응 — 로그인 길(Master login routing A1): 갈 곳을 알려줄 뿐 자격을 받지 않는다. 자격은 그 Tree 의 Master 로만 간다(이 Tree 를 거치지 않음)
//     목록      terra.master.crossboundary.login-routes.get → { node_id, label, direction(parent · child · sibling), login_url, reachable, tunnel_port, needs_resolve }
//     주소 묻기  …login-routes.by-node-id.resolve.post — 자식 Tree 만 자기 주소를 말할 수 있다(목록은 묻지 않는다)
//     로그인    그 Tree 의 Gateway auth.credentials.post {email, password} → 세션 핸들(토큰은 Gateway 에 남고 이름만 받는다). 'auto' 를 끄면 auth.login.post(이번만)
//     거절      401 CREDENTIAL_REJECTED — 어느 쪽이 틀렸는지 말하지 않는다(그래서 화면도 둘 다 붉게)
//   시안 — 비밀번호 'wrong' 이면 거절, 주소는 Tree 이름으로 정해지는 예시
class Component extends DCLogic {
  constructor(props) { super(props); this._g = 0; this._chg = {}; this._t0 = typeof performance !== 'undefined' ? performance.now() : 0; this.state = { email: '', pass: '', keep: (() => { try { return localStorage.getItem('terra.auto') !== '0'; } catch (e) { return true; } })(), phase: null, msg: '', bad: false, manual: false, manualUrl: '', url: null, resolved: false };
    try { window.addEventListener('terra-help', () => this.setState({})); } catch (e) {} }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  name() { return this.props.treeName || '02'; }
  // 대상이 바뀌면 처음부터 (같은 창 자리를 다른 Tree 가 쓴다)
  sync() { const k = (this.props.treeKey || '') + '|' + this.name(); if (this._k !== k) { this._k = k; this._t0 = performance.now(); this._g ^= 1; this._chg = {}; Object.assign(this.state, { email: this.lastEmail(), pass: '', phase: null, msg: '', bad: false, manual: false, manualUrl: '', url: null, resolved: false }); } }
  lastEmail() { try { return localStorage.getItem('terra.login.email') || ''; } catch (e) { return ''; } }
  route() {
    const P = this.props, dir = P.direction || 'sibling';
    const url = this.state.url || P.loginUrl || '', needs = !!P.needsResolve && !this.state.resolved && !this.state.url;
    return { dir, url, needs, reach: !!url && (P.reachable !== false || !!this.state.url), tunnel: +P.tunnelPort || 0 };
  }
  login() {
    const S = this.state;
    if (!S.email.trim() || !S.pass) { const e = !S.email.trim(); this.setState({ bad: e ? 'email' : 'pass', msg: e ? 'email 이 비었어요' : 'password 가 비었어요' }); return; }
    this.setState({ phase: 'send', msg: '확인 중…', bad: false });
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      if (S.pass === 'wrong') { this.setState({ phase: null, bad: 'both', pass: '', msg: 'email 또는 password 가 맞지 않아요' }); return; }
      try { localStorage.setItem('terra.login.email', S.email.trim()); } catch (e) {}
      this.setState({ phase: 'done', msg: '', pass: '' });
      this._t = setTimeout(() => { if (this.props.onDone) this.props.onDone(this.props.treeKey || this.name(), S.keep, S.email.trim()); }, 650);
    }, 700);
  }
  componentWillUnmount() { clearTimeout(this._t); if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
  // ── 랜덤 갱신 · 주기 증가 ──
  // 글자 i 는 (시작 + i·14ms)에 나타나 16ms 에서 시작해 1.4배씩 길어지는 간격으로 6번 무작위 글자를 거쳐 제 글자에 멈춘다(글자 하나 약 0.26초).
  // 넓은 글자(한글)는 한글로, 나머지는 기호 · 영숫자로 섞는다 — 줄 너비가 흔들리지 않는다. 아직 안 나온 칸은 같은 너비의 빈칸
  scr(str, t0, now, salt) {
    const P = 16, K = 6, RT = 1.4, A = '#%&*+=-/<>[]{}0123456789ABCDEFHKMNRSTXZ', H = '가각간갈감강거건검게경고곤골공관구국군귀그기길나남너노누다도두라로리마모무바보부사서소수시아오우이자조주지차초카타파하', out = [];
    let i = 0, end = t0;
    for (const ch of String(str)) {
      const cp = ch.codePointAt(0), wide = (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xac00 && cp <= 0xd7a3), local = now - t0 - i * 14; i++;
      if (ch === ' ' || ch === '\n') { out.push(ch); continue; }
      if (local < 0) { out.push(wide ? '\u3000' : '\u00a0'); continue; }
      let acc = 0, k = 0, p = P; while (k < K && acc + p <= local) { acc += p; p *= RT; k++; }
      if (k >= K || ch === '·' || ch === '•') out.push(ch);
      else { const hsh = (((i * 2654435761) ^ (k * 40503) ^ salt) >>> 0) % 997, set = wide ? H : A; out.push(set[hsh % set.length]); }
    }
    this._need = Math.max(this._need || 0, t0 + i * 14 + 270);
    return out.join('');
  }
  // 줄마다 — 처음엔 열린 때 + 차례(base), 그 뒤로는 값이 바뀐 때부터 다시
  tx(key, str, base, now) {
    let r = this._chg[key];
    if (!r || r.v !== str) { r = this._chg[key] = { v: str, t: r || now - this._t0 > 900 ? now : this._t0 + base, salt: (key.length * 131 + base) | 0 }; }
    return now - r.t > 14 * String(str).length + 300 ? str : this.scr(str, r.t, now, r.salt);
  }
  renderVals() {
    this.sync();
    const S = this.state, R = this.route(), H = this.help(), busy = S.phase === 'send' || S.phase === 'ask';
    const DIR = { parent: ['부모 Tree', 'up'], child: ['자식 Tree', 'down'], sibling: ['형제 Tree', 'side'], far: ['다른 Tree', ''] }[R.dir] || ['Tree', ''];
    const state = R.needs ? 'resolve' : !R.reach ? 'unreach' : S.phase === 'done' ? 'done' : 'form';
    const ST = { resolve: ['주소 모름', '#ffd27a'], unreach: ['닿지 않음', '#ff9c8c'], form: ['닿음', 'rgb(176,236,96)'], done: ['로그인됨', 'rgb(176,236,96)'] }[state];
    const O = {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', rootW: this.props.winW ? this.props.winW + 'px' : '100%', name: this.name(), wordCls: '', dirT: DIR[0], dirCls: DIR[1], stT: ST[0], stCol: ST[1],
      urlT: R.url || (R.needs ? '— 그 Tree 에 물어야 함' : '— 알려진 주소 없음'), apiT: H ? 'login-routes · ' + (R.dir === 'child' ? 'resolve' : 'listing') : '',
      isResolve: state === 'resolve', isUnreach: state === 'unreach', isForm: state === 'form', isDone: state === 'done',
      resolveNote: H ? '자식 Tree 만 자기 주소를 말한다 — 묻는 데 중계 한 번' : '', resolveT: S.phase === 'ask' ? '묻는 중…' : '주소 묻기',
      resolve: () => { this.setState({ phase: 'ask' }); clearTimeout(this._t); this._t = setTimeout(() => { const ok = !/4/.test(this.name()); this.setState({ phase: null, resolved: true, url: ok ? 'https://tree-' + this.name().replace(/[^\w]+/g, '-') + '.terra.local:8080' : null, msg: ok ? '' : '이 Tree 는 주소를 내놓지 않았어요' }); }, 800); },
      unreachNote: H ? '이 기기에서 그 주소로 직접 닿지 않는다 — 터널(A3)이나 다른 주소로' : '', hasTunnel: R.tunnel > 0, tunnel: R.tunnel,
      useTunnel: () => this.setState({ url: 'http://127.0.0.1:' + R.tunnel, msg: '터널로 연결' }),
      isManual: S.manual, manual: () => this.setState({ manual: !S.manual }), manualUrl: S.manualUrl, manualIn: (e) => this.setState({ manualUrl: e.target.value }),
      manualOk: (e) => { if (e && e.preventDefault) e.preventDefault(); const u = S.manualUrl.trim(); if (!/^https?:\/\/\S+$/.test(u)) { this.setState({ msg: 'http(s):// 주소', bad: 'url' }); return; } this.setState({ url: u, manual: false, msg: '', bad: false }); },
      email: S.email, emailPh: 'admin@', emailIn: (e) => this.setState({ email: e.target.value, bad: false, msg: '' }), pass: S.pass, passIn: (e) => this.setState({ pass: e.target.value, bad: false, msg: '' }),
      emailCls: S.bad === 'email' || S.bad === 'both' ? 'bad' : '', passCls: S.bad === 'pass' || S.bad === 'both' ? 'bad' : '',
      emailBad: S.bad ? 'true' : 'false', passBad: S.bad ? 'true' : 'false', roI: busy ? 'readonly' : null,
      keepA: S.keep ? 'true' : 'false', keepT: S.keep ? '■' : '□', keep: () => this.setState({ keep: !S.keep }),
      submit: (e) => { if (e && e.preventDefault) e.preventDefault(); if (!busy) this.login(); }, busyD: busy ? 'disabled' : null, loginT: S.phase === 'send' ? '…' : 'Login',
      doneNote: (S.keep ? '유지 · ' : '이번만 · ') + this.name() + ' 로 들어갑니다',
      msg: S.msg, msgCls: S.bad ? 'err' : S.phase === 'done' ? 'ok' : '', msgT: S.msg ? (S.bad ? 'error: ' : S.phase === 'send' || S.phase === 'ask' ? '… ' : '› ') + S.msg : '',
      who: (this.props.user || 'admin') + '@' + (this.props.current || '01'), bigT: this.name(), subT: DIR[0] + ' · ' + (R.dir === 'child' ? 'resolve required' : R.dir === 'parent' ? 'upward · direct' : R.dir === 'sibling' ? 'named by parent' : 'remembered address'),
      stripeCls: state === 'unreach' ? 'bad' : state === 'resolve' ? 'warn' : state === 'done' ? 'ok' : '', codeA: 'RT-' + ({ parent: 'UP', child: 'DN', sibling: 'SB', far: 'XT' }[R.dir] || 'XT') + ' / ' + (R.tunnel ? 'TUN ' + R.tunnel : 'DIRECT'), codeB: String(this.name()).replace(/[^\w]/g, '').slice(-3).toUpperCase() || 'T',
      dirCol: { parent: 'rgb(104,156,255)', child: 'rgb(110,236,156)', sibling: '#ffd27a' }[R.dir] || '#848eb4', dirNote: R.dir === 'child' ? '· 자식이 자기 주소를 말한다' : R.dir === 'far' ? '· 계정이 기억한 주소' : '',
      sessDot: state === 'done' ? '●' : '○', sessCol: state === 'done' ? 'rgb(176,236,96)' : '#5a6488', sessLine: state === 'done' ? (S.keep ? '유지' : '이번만') + ' · ' + S.email : '없음 — 로그인 필요',
      formCls: busy ? 'busy' : '', footT: 'TERRA // ' + (this.props.current || '01') + ' → ' + this.name(),
      key: (e) => { if (e && e.key === 'Escape') { e.preventDefault(); clearTimeout(this._t); if (this.props.onCancel) this.props.onCancel(); } },
      help: H, helpT: '# 자격은 ' + this.name() + ' 의 Master 로만 갑니다 — 지금 Tree 를 거치지 않아요. auto = 세션 핸들 저장(auth.credentials), 끄면 이번만(auth.login)',
      sessT: this.props.current ? '지금 · ' + this.props.current : '',
      cancel: () => { clearTimeout(this._t); if (this.props.onCancel) this.props.onCancel(); }
    };
    // 글자 — 랜덤 갱신 · 주기 증가 (왼쪽 · 위부터 차례로)
    const now = typeof performance !== 'undefined' ? performance.now() : this._t0 + 1e6; this._need = 0;
    const L = { cmd: 'terra login tree ' + this.name(), tree: 'TREE', meta1: 'CROSS-TREE', meta2: 'LOGIN // A1', kRoute: 'route', kMaster: 'master', kSess: 'session', noAddr: '주소 모름', unreach: '직접 닿지 않음', urlFlag: '--url', kUrl: 'url',
      kEmail: 'email', kPass: 'password', auto: 'auto', autoNote: ' · 로그인 유지', loggedIn: 'logged in', k1: 'Enter', k1t: '로그인', k2: 'Esc', k2t: '취소', k3: 'Tab', k3t: '다음 칸', cancel: '취소', tab1: 'ROUTE', tab2: 'AUTH' };
    const LB = { cmd: 60, tree: 100, meta1: 130, meta2: 150, kRoute: 380, kMaster: 420, kSess: 460, noAddr: 520, unreach: 520, urlFlag: 580, kUrl: 0, kEmail: 520, kPass: 560, auto: 600, autoNote: 620, loggedIn: 520, k1: 680, k1t: 700, k2: 720, k2t: 740, k3: 760, k3t: 780, cancel: 760, tab1: 780, tab2: 800 };
    O.L = {}; for (const k of Object.keys(L)) O.L[k] = this.tx('L.' + k, L[k], LB[k], now);
    O.tunT = 'tunnel :' + O.tunnel; O.loginT = (S.phase === 'send' ? '… ' : '⏎ ') + 'Login';
    const TB = { who: 0, bigT: 200, subT: 280, codeA: 320, codeB: 340, dirT: 400, dirNote: 430, urlT: 450, sessLine: 490, resolveNote: 540, resolveT: 560, tunT: 560, loginT: 640, doneNote: 540, msgT: 0, helpT: 700, footT: 820 };
    for (const k of Object.keys(TB)) if (typeof O[k] === 'string' && O[k]) O[k] = this.tx(k, O[k], TB[k], now);
    O.gen = 'g' + this._g;
    if (now < this._need && !this._raf && typeof requestAnimationFrame !== 'undefined') this._raf = requestAnimationFrame(() => { this._raf = 0; this.setState({ fr: performance.now() }); });
    return O;
  }
}
