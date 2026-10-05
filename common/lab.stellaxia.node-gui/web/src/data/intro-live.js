// 시작 화면(Intro)의 모듈 층 — 비밀번호를 받지 않는 시작 화면.
//
// 짝 프로젝트(service)의 시작 화면은 아이디 · 비밀번호로 Gateway에 로그인한다. 모듈은 Terra 안(terra.web/frame)에서 돌고,
// 웹이 비밀번호를 받으면 모듈 JS가 사용자의 Terra 비밀번호를 보게 된다(웹 프로그램 감싸기 설계 §3.3.1). 그래서
//   입력 판   아이디 · 비밀번호 · 자동 로그인 자리에 지금 세션 줄과 단추 하나를 둔다(tools/gen-pages.py MODULE_BETWEEN).
//             단추 = terra.emit('login') → Scene 의 /login 카드가 받는다. 로그인하면 Scene 이 / 로 돌아오고 frame 이 이 화면을 다시 띄운다
//   자동 로그인  frame 토큰이 이미 있으면(셸 세션 · Scene 로그인) 서비스 판의 "자동 로그인"처럼 곧장 내려간다. 이 화면은 아무것도 기억하지 않는다
//   미리 읽기  노드 화면을 구름 뒤에서 미리 읽는다. Terra 안에서는 중첩 iframe(src)이 게이트웨이 CSP(frame-ancestors)에 막혀
//             node.html 을 받아 srcdoc 으로 넣는다(노드 화면의 보드와 같은 길). 그 문서는 같은 origin 의 자식이라
//             이 창의 frame 연결을 빌린다(frame-boot.js __terraFrameReady) — hello 는 이 화면이 한 번만 보낸다.
//   Terra 밖   (npm run dev · 정적 서버) 단추는 "둘러보기"다 — 노드 화면은 데이터 없는 빈 세계로 선다.

import { frameReady, role } from '../api/frame-boot.js';
import { TerraClient } from '../api/client.js';
import { absenceText } from './live-host.js';

const GREEN = '#5eea9a', AMBER = '#ffd479', RED = '#ff6b7d';
const OK = '#1f7a4d', WARN = '#a65f00', BAD = '#d33d52', MUTE = '#8b95a6', BLUE = '#2563eb';

/** 시작 화면 클래스를 이어받아 로그인을 Terra 에 맡기는 클래스를 돌려준다 */
export function realIntro(Screen) {
  return class RealIntro extends Screen {
    constructor(props) {
      super(props);
      // role: 이 문서의 자리 · terra: frame 연결 · why: 토큰이 없는 이유(WAIT = 아직 init 전)
      this.__sess = { role, terra: null, token: false, principal: '', perms: 0, why: role === 'frame' ? 'WAIT' : 'STANDALONE', autoOnce: false };
      Object.assign(this.state, { username: '', password: '', auto: false, phase: 'form', msg: '' });
    }

    // 이 화면은 아무것도 기억하지 않는다 — 세션(자격 핸들)은 Terra 가 쥔다
    readAuto() { return null; }
    writeAuto() {}

    /** 단추: 세션이 있으면 들어가고, 없으면 Terra 로그인 카드를 부른다. Terra 밖이면 빈 세계로 둘러본다 */
    submit(e) {
      if (e && e.preventDefault) e.preventDefault();
      const X = this.__sess, S = this.state;
      if (S.phase !== 'form') return;
      if (X.token || X.role !== 'frame') { this.finish(false); return; }
      if (!X.terra) {
        this.fail(X.why === 'WAIT' ? 'Terra 셸에 연결하는 중이다 — 잠시 뒤 다시 누른다' : 'Terra 셸이 답하지 않는다 — 셸에서 이 화면을 다시 연다');
        return;
      }
      this.setState({ msg: 'Terra 로그인 카드로 간다 — 로그인하면 이 화면으로 돌아와 내려간다', msgC: BLUE });
      X.terra.emit('login');
    }

    /** 다른 계정으로 — 로그인 카드를 다시 부른다(이 Scene 의 로그인이면 카드에서 바꾼다) */
    otherAccount() { if (this.__sess.terra) this.__sess.terra.emit('login'); }

    /**
     * 로그아웃 · 토큰을 잃음 — 노드 화면을 걷고 판으로 돌아온다. 내려가는 중이어도 · 다 내려갔어도.
     * 노드 화면(미리 읽은 문서)은 그대로 둔다 — 그 화면은 스스로 빈 세계로 돌아갔고, 다시 로그인하면 Scene 이 frame 을 새로 띄운다
     */
    flyBack() {
      const S = this.state;
      if (!this._fly && !S.fly && !S.flyDone && S.phase !== 'done') return;
      clearTimeout(this._flyT); clearTimeout(this._autoT); clearTimeout(this._backT);
      this._fly = null;   // 그리는 루프가 하늘을 다시 그린다
      this.__sess.autoOnce = false;
      const doc = this.__doc || (typeof document !== 'undefined' ? document : null), q = (sel) => (doc && doc.querySelector ? doc.querySelector(sel) : null);
      const fr = q('[data-in-map]'), fv = q('[data-in-fly]');
      if (fr && fr.style) {
        fr.style.transition = 'opacity 500ms';
        fr.style.opacity = '0';
        fr.style.pointerEvents = 'none';
        this._backT = setTimeout(() => { if (!this._fly) fr.style.transition = ''; }, 550);   // 다음에 내려갈 때는 루프가 직접 투명도를 정한다
      }
      if (fv && fv.getContext) { const g = fv.getContext('2d'); if (g) g.clearRect(0, 0, fv.width, fv.height); }
      this.setState({ fly: false, flyDone: false, mapFail: false, phase: 'form', msg: '로그아웃했다 — 다시 들어가려면 Terra 로그인', msgC: MUTE });
    }

    renderVals() {
      const r = super.renderVals(), v = r.v, S = this.state, X = this.__sess;
      const who = X.principal || '';
      v.where = X.role === 'frame' ? 'Terra 안' : 'Terra 밖';
      // 아래 두 알약은 내려가기 시작하면 사라진다 — 누름도 끈다(그 아래의 노드 화면이 받는다. tools/gen-pages.py 의 index 패치)
      v.chromePe = S.fly ? 'none' : 'auto';
      // 왼쪽 아래 — 이 화면이 닿는 게이트웨이(frame 이 건넨 것)
      if (X.role !== 'frame') { v.gwDot = RED; v.gwText = 'Terra 밖에서 열었다 — 닿을 게이트웨이가 없다'; }
      else if (X.why === 'WAIT') { v.gwDot = AMBER; v.gwText = 'Terra 셸에 연결하는 중…'; }
      else if (X.why === 'NO_FRAME') { v.gwDot = RED; v.gwText = 'Terra 셸이 답하지 않는다'; }
      else if (X.token) { v.gwDot = GREEN; v.gwText = '이 노드의 게이트웨이 · 연결됨'; }
      else { v.gwDot = AMBER; v.gwText = '이 노드의 게이트웨이 · 로그인 전'; }
      // 판 — 지금 세션 줄
      if (X.role !== 'frame') {
        v.whoDot = MUTE; v.whoTitle = 'Terra 밖에서 열었다';
        v.whoSub = 'Terra 안(셸)에서 열어야 이 노드의 데이터가 보인다. 여기서는 데이터 없는 화면만 둘러본다';
      } else if (X.token) {
        v.whoDot = OK; v.whoTitle = (who || 'Terra 세션') + ' — 로그인됨';
        v.whoSub = '이 화면이 받은 권한 ' + X.perms + '개 — 이 노드의 값으로 맵이 채워진다';
      } else if (X.why === 'WAIT') {
        v.whoDot = AMBER; v.whoTitle = 'Terra 셸에 연결하는 중…'; v.whoSub = '셸이 이 화면의 토큰을 건네면 바로 보인다';
      } else if (X.why === 'NO_FRAME') {
        v.whoDot = BAD; v.whoTitle = 'Terra 셸이 답하지 않는다'; v.whoSub = absenceText('NO_FRAME');
      } else if (X.why === 'NO_SESSION') {
        v.whoDot = WARN; v.whoTitle = 'Terra에 로그인하지 않았다'; v.whoSub = '로그인은 Terra 로그인 카드가 받는다 — 이 화면은 비밀번호를 보지 않는다';
      } else {
        v.whoDot = BAD; v.whoTitle = '이 화면의 토큰을 받지 못했다'; v.whoSub = absenceText(X.why);
      }
      v.goLabel = X.token ? '들어가기' : X.role === 'frame' ? 'Terra 로그인' : '둘러보기 (데이터 없음)';
      v.goNote = X.role === 'frame' ? '비밀번호는 Terra가 받는다 — 이 화면은 보지 않는다' : '';
      v.busy = S.phase === 'auto';
      v.sub = S.phase === 'done' ? (who || 'Terra') + ' — 로그인됨' : 'Terra 노드';
      v.stTitle = S.phase === 'auto' ? (who || 'Terra 세션') + '(으)로 들어가는 중…' : '로그인됨';
      v.stSub = S.phase === 'auto' ? 'Terra 세션이 살아 있다 — 잠시 뒤 맵으로 내려간다' : '맵으로 내려간다…';
      v.logout = () => this.otherAccount();
      return r;
    }
  };
}

/** 미리 읽는 노드 화면 창([data-in-map])에 문서를 넣는다 — Terra 안은 srcdoc, 밖은 src */
export function watchMapFrame(screen, doc = document, opts = {}) {
  const stage = doc.getElementById('stage') || doc.body;
  const inFrame = (opts.role || role) === 'frame';
  const fetchText = opts.fetchText || ((page) => fetch('./' + page, { headers: { Accept: 'text/html' } })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))));
  const fill = (fr) => {
    if (!fr || fr.__terraMap) return;
    fr.__terraMap = true;
    const page = fr.getAttribute('data-src') || 'node.html';
    if (!inFrame) { fr.setAttribute('src', page); return; }
    fetchText(page)
      .then((html) => { fr.srcdoc = html; })
      .catch((e) => console.warn('[terra] 노드 화면을 미리 읽지 못했다 — 구름이 걷히면 "노드 화면으로" 길이 보인다', e));
  };
  const scan = () => stage.querySelectorAll('iframe[data-in-map]').forEach(fill);
  const MO = (doc.defaultView && doc.defaultView.MutationObserver) || globalThis.MutationObserver;
  scan();
  if (!MO) return () => {};
  const mo = new MO(scan);
  mo.observe(stage, { subtree: true, childList: true });
  return () => mo.disconnect();
}

/** 지금 자격의 주체 — 셸 세션으로 받은 토큰이면 Scene 의 session 값에 주체가 없다. 경로로 부른다(client.get — wire.js 와 같다) */
async function principalOf(terra) {
  try {
    const client = new TerraClient('', { fetch: terra.fetch.bind(terra), delegated: true });
    const r = await client.get('/api/v1/agent/whoami');
    return r.kind === 'ok' && r.data && r.data.principal ? String(r.data.principal) : '';
  } catch { return ''; }
}

/**
 * 띄운 직후(src/boot/module.js boot('intro')): 예시 Gateway 응답 흉내를 끄고, frame 의 세션을 본다.
 * 토큰이 있으면 잠깐 "들어가는 중"을 보인 뒤 내려간다. 없으면 판에 Terra 로그인 단추가 선다.
 */
export async function bootIntro(screen, opts = {}) {
  clearTimeout(screen._gwT);
  const stopMap = watchMapFrame(screen, opts.doc || document, opts);
  const X = screen.__sess;
  const ready = opts.frameReady || frameReady;
  X.role = opts.role || role;
  if (X.role !== 'frame') { screen.forceUpdate(); return stopMap; }
  const terra = await ready;
  if (!terra) { X.why = 'NO_FRAME'; screen.forceUpdate(); return stopMap; }
  X.terra = terra;
  screen.__doc = opts.doc || document;
  let asked = false;
  const sync = () => {
    const token = !!terra.token(), value = terra.value();
    X.token = token;
    X.why = token ? '' : (terra.absence() || 'NO_SESSION');
    X.perms = token ? terra.permissions().length : 0;
    if (value && typeof value === 'object' && value.principal) X.principal = String(value.principal);
    if (token && !X.principal && !asked) { asked = true; void principalOf(terra).then((p) => { if (p && !X.principal) { X.principal = p; screen.forceUpdate(); } }); }
    if (!token) { X.principal = ''; asked = false; }
    const S = screen.state;
    if (token && S.phase === 'form' && !X.autoOnce) {
      X.autoOnce = true;   // 한 번만 — 취소한 뒤 토큰이 갱신돼도 다시 내려가지 않는다
      clearTimeout(screen._autoT);
      screen.setState({ phase: 'auto', msg: '' });
      screen._autoT = setTimeout(() => { if (screen.state.phase === 'auto') screen.finish(true); }, opts.autoMs != null ? opts.autoMs : 1400);
    } else if (!token && S.phase === 'auto') {
      clearTimeout(screen._autoT);
      X.autoOnce = false;
      screen.setState({ phase: 'form' });
    } else if (!token && (S.phase === 'done' || S.fly || S.flyDone || screen._fly)) {
      screen.flyBack();   // 로그아웃 — 내려간 노드 화면(이제 빈 세계)을 걷고 판으로
    } else screen.forceUpdate();
  };
  const offToken = terra.onToken(sync);
  const offValue = terra.onValue(sync);
  sync();
  return () => { offToken(); offValue(); stopMap(); };
}
