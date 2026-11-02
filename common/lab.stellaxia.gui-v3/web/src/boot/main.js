// 앱 입구 — 캔버스 시안의 씬(Scene: 통합 화면 + 전역 틀 + 창들 + 로그인)을 그대로 띄운다.
//   보드          design/*.dc.html → 빌드 때 모듈(virtual:boards). 보드 실행기(src/ui/dc/runtime.js)가 DOM 에 붙인다
//   글자 장       씬이 매 프레임 채우는 칸 기록을 GPU 렌더러로(scene-bridge — WebGL2, 되면 Worker 의 OffscreenCanvas)
//   창            씬의 창들(제어기 · 설정 · 상태 · 자원 · 자원 상태 · Tree 로그인 · 모듈 상태 · 브라우저 · 스타메이커)은 시안의 창 관리 그대로 DOM 창
//   Terra         실행 모드(src/api/mode.js)로 길을 고른다 — A(앱: 셸 안 · 앱 토큰 · 첫 화면은 B 와 같은 로그인 보드 — 비밀번호는 셸 칸이, 이미 로그인했으면 연출 뒤 바로 워프) · B(제품 셸: 로그인 화면이 Gateway 에 로그인 · 자격 핸들) · demo(목업)
//                 노드 데이터 층(TerraNodes)은 두 모드 모두 Gateway 전송으로(src/api/transport.js)
// 주소 뒤 ?render=main — Worker 없이 · ?gl=2d — GPU 없이 · ?gpu=off — 시안의 2D 길 그대로(비교용) · ?demo — Terra 없이 시안의 목업 그대로 · ?mode=app|shell — 모드 고르기

import 'virtual:boards';
import { mountBoard, boardDef } from '../ui/dc/runtime.js';
import { useGpuField } from '../scene/scene-bridge.js';
import { createTerra, canRemote, permissionsOf } from '../api/terra.js';
import { createSession } from '../api/session.js';
import { createGatewayTransport } from '../api/transport.js';
import { loadTopology, loadTopologyState, nodeStats, fmtBytes } from '../api/topology.js';
import { startPush } from '../api/push.js';
import { pickMode, connectApp } from '../api/mode.js';
import { hostSecretOf, waitHostLogin, nextAttempt, passwordRowItems, bindHostSecret } from '../api/host-secret.js';
import * as deskAdapt from '../api/desk-adapt.js';
import { startAlarms } from '../api/alarms.js';
import * as netRead from '../api/net-read.js';
import { createNodeInfo } from '../api/node-info.js';
import * as sviRead from '../api/svi-read.js';

const q = new URLSearchParams(location.search), status = document.getElementById('status'), MODE = pickMode(q);
const appReady = MODE === 'app' ? connectApp() : Promise.resolve(null);   // A 모드 — hello 는 가장 먼저(마운트가 이벤트 루프를 붙잡기 전에)
let frame = null;
const say = (t) => { if (!status) return; status.textContent = t; status.style.opacity = ''; clearTimeout(say.t); say.t = setTimeout(() => { status.style.opacity = '0'; }, 5000); };   // 잠깐 보이고 사라진다(전역 틀 아래 줄과 겹치지 않게)

if (q.get('gpu') !== 'off') useGpuField('Scene', { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', onReady: (h) => say('글자 장 ' + h.kind + ' · ' + (h.mode === 'worker' ? 'Worker' : '메인 스레드')) });
else say('글자 장 시안 2D');

// 보드를 고치지 않고 몇 자리만 잇는다: 로그인(Login.login) · Tree 로그인 · 로그아웃(Scene.sceneLogout). 노드 데이터는 TerraNodes 가 window.TerraTransport 를 쓴다
let terra = null, session = null, transport = null, push = null, alarms = null, topoTimer = 0;
if (MODE !== 'demo') {
  session = createSession();
  // 자격 — B: 자격 핸들(Handle) · A: 셸이 준 앱 토큰(Bearer), 401 이면 셸에게 새로 받아 한 번 더
  terra = createTerra({ authorization: () => (MODE === 'shell' ? session.authorization() : null), token: () => (frame ? frame.token() : null), refresh: () => (frame ? frame.refresh() : Promise.resolve(undefined)) });
  transport = window.TerraTransport = createGatewayTransport({ terra, authed: () => (MODE === 'shell' ? !!session.handle : !!(frame && frame.token())), ns: () => (MODE === 'app' ? (frame && frame.appId) || 'lab.stellaxia.gui-v3.web' : 'gui-v3') });
  const L = boardDef('Login');
  if (L && !L.Logic.__terra) {
    class TerraLogin extends L.Logic {
      constructor(p) { super(p); TerraLogin.last = this; }
      login() {
        const S = this.state || {};
        if (MODE === 'app') {   // A 모드 — 비밀번호를 받지 않는다
          if (frame && frame.token()) return this.warpStart();
          const sec = hostSecretOf(frame); if (sec) return this.hostLogin(sec);   // 셸이 비밀번호 칸을 준다(§4.9) — 이 보드가 그리고, 값은 셸 칸에서 Scene 으로
          if (frame) { frame.emit('login'); return; }   // 칸을 모르는 셸 — 감싼 Scene 의 /login 카드가(웹 프로그램 감싸기 설계 §3.3.1)
          this.setState({ msg: '셸이 응답하지 않아요 — 셸에서 로그인한 뒤 다시' }); return;
        }
        if (!S.va || !S.vp || this._busy) return super.login();   // 빈 칸 안내는 시안 그대로
        this._busy = true; this.setState({ msg: '확인 중…' });
        session.login(S.va, S.vp)
          .then(() => Promise.race([loadTopology(terra), new Promise((r) => setTimeout(() => r(null), 4000))]))   // 실제 지도 — 전환(워프) 전에 받아 둔다(4초 넘으면 시안 지도로 들어가고 오면 바꾼다)
          .then((topo) => { this._busy = false; if (window.TerraNodes) window.TerraNodes.clear(); if (topo) setTopology(topo); else loadTopology(terra).then((t) => t && setTopology(t)); afterLogin(); super.login(); },   // 로그인 전의 '로그인 전' 답은 지우고 새로   // 됐으면 시안의 전환(워프)
          (e) => { this._busy = false; this.setState({ msg: e.message || '로그인 못 함' }); this.ripAt('login', [255, 120, 110]); });
      }
      // A 모드 + 셸 비밀번호 칸 — 빈 칸 안내는 시안 그대로(비밀번호가 비었는지는 셸이 알려 준다), 보내는 것은 비밀이 아닌 값뿐
      hostLogin(sec) {
        const S = this.state || {};
        if (this._busy) return;
        if (!S.va || sec.state().empty) { this.setState({ msg: !S.va ? 'admin 을 입력하세요' : 'password 를 입력하세요' }); this.ripAt('login', [242, 244, 252]); return; }
        const attempt = nextAttempt(); this._busy = true; this.setState({ msg: '확인 중…' });
        const answer = waitHostLogin(frame, attempt);
        sec.submit({ email: S.va, auto: !!S.autoOn, node: String(S.inst ?? this.props.installed ?? 'Leaf'), attempt });
        answer.then((r) => {
          this._busy = false;
          if (r.ok) { this.warpStart(); return; }   // 토큰이 왔다 — 지도 · 밀어 받기는 frame.onToken 이 시작한다(appSignedIn)
          this.setState({ msg: r.message }); this.ripAt('login', [255, 120, 110]); sec.focus();   // 다시 칠 자리로
        });
      }
      // A 모드에서 TERRA 화면을 누르면 — 이미 로그인했으면 폼 없이 워프, 셸 칸이 없으면(이전 Terra) 폼 대신 Scene 의 /login 카드로
      openLogin() {
        if (MODE === 'app') {
          if (frame && frame.token()) return this.enterSignedIn();
          if (!hostSecretOf(frame)) { if (frame) frame.emit('login'); return; }   // 이 보드의 폼은 웹이 비밀번호를 받는 칸이다 — 셸 칸 없이는 열지 않는다(§3.3.1)
        }
        return super.openLogin();
      }
      // 이미 로그인했다 — 시안의 여는 연출(로고가 오르고 줄이 차례로)을 그대로 보이고, 줄이 다 서면 폼을 받지 않고 워프한다.
      //   워프는 열린 로그인의 글자 · 로고를 날려 보내는 전환이라 닫힌 TERRA 화면에서는 시작하지 않는다
      enterSignedIn() {
        if (this._WP || this._enter) return;
        if (!(this.state || {}).open) super.openLogin();
        this._enter = setInterval(() => {
          const S = this.state || {};
          if (this._WP || !S.open || !(frame && frame.token())) { clearInterval(this._enter); this._enter = 0; return; }
          if (S.ready) { clearInterval(this._enter); this._enter = 0; this.warpStart(); }
        }, 50);
      }
      loginItems() { const it = super.loginItems(), sec = MODE === 'app' && hostSecretOf(frame); return sec ? passwordRowItems(it, sec.state().empty) : it; }
      renderVals() {
        const v = super.renderVals();
        if (MODE === 'app') {   // A 모드에서 보드의 숨은 password 칸은 받지 않는다 — Tab 으로 오면 셸 칸으로 넘긴다(셸 칸이 없으면 놓는다)
          const sec = hostSecretOf(frame);
          v.inP = () => {}; v.focP = (e) => { if (sec) sec.focus(); else if (e && e.target && e.target.blur) e.target.blur(); };
        }
        return v;
      }
    }
    TerraLogin.__terra = true; L.Logic = TerraLogin;
  }
  // 지도가 바뀌면 씬 · 전역 틀이 다시 그린다(씬의 build · sceneMap 은 TerraTopology.rev 로 다시 짓는다)
  const setTopology = (t) => { window.TerraTopology = t; const sc = window.__terra && window.__terra.scene; if (sc && sc.gf_layout) sc.gf_layout(); };
  // 다른 Tree 로그인 — 앱 CSP(connect-src 'self') 라 그 Tree 의 Gateway 를 여기서 부를 수 없다: 그 Tree 의 GUI(login_url)로 옮겨 가 거기서 로그인
  //   길은 이 Master 의 crossboundary login-routes(부모 · 형제 · 자식, 자식은 resolve 로 주소를 묻는다)
  const loadRoutes = () => terra.invoke('terra.master.crossboundary.login-routes.get', {}).then((d) => {
    const list = Array.isArray(d) ? d : (d && (d.routes || d.items)) || [], m = {}; for (const r of list) if (r && r.node_id) m[r.node_id] = r; window.TerraLoginRoutes = m;
    const sc = window.__terra && window.__terra.scene; if (sc && sc.gf_layout) sc.gf_layout();
  }, () => { window.TerraLoginRoutes = null; });
  const TL = boardDef('TreeLogin');
  if (TL && !TL.Logic.__terra) {
    const ridOf = (key) => { const sc = window.__terra && window.__terra.scene, n = sc && sc.sceneMap && sc.sceneMap().byId[key]; return (n && n.rid) || ''; };
    class TerraTreeLogin extends TL.Logic {
      login() {
        const R = this.route(), rid = ridOf(this.props.treeKey);
        if (!rid) return super.login();   // 시안 노드(실제 지도 밖) — 시안 그대로
        if (!R.url) { this.fail(null, { http: '', code: 'NO_ROUTE', title: '로그인 주소가 없음', hint: R.needs ? '[주소 묻기] 로 그 Tree 에게 주소를 물어보세요' : '이 Tree 로 가는 길을 Master 가 모르고 있어요 — 운영자에게 주소를 받아 --url 로', act: '' }); return; }
        try { localStorage.setItem('terra.login.email', (this.state.email || '').trim()); } catch (e) {}
        this.setState({ phase: 'send', msg: R.url + ' 로 옮겨 가는 중…', bad: false, err: null });
        setTimeout(() => window.location.assign(R.url), 300);   // 그 Tree 의 GUI 에서 로그인 — 비밀번호는 그 Gateway 만 받는다
      }
      renderVals() {
        const v = super.renderVals(), rid = ridOf(this.props.treeKey);
        if (rid) v.resolve = () => { this.setState({ phase: 'ask' }); terra.invoke('terra.master.crossboundary.login-routes.by-node-id.resolve.post', { node_id: rid })
          .then((r) => { const url = r && (r.login_url || (r.route && r.route.login_url)); this.setState({ phase: null, resolved: true, url: url || null, msg: url ? '' : '이 Tree 는 주소를 내놓지 않았어요' }); },
            (e) => this.setState({ phase: null, resolved: true, url: null, msg: '주소를 묻지 못함 · ' + (e.code || '') })); };
        return v;
      }
    }
    TerraTreeLogin.__terra = true; TL.Logic = TerraTreeLogin;
  }
  // 로그인 뒤 한 번 — 지도 · Tree 길 · 보기 상태 · 밀어 받기
  // 노드 데스크톱이 쓰는 것 — 실제 응답 → 보드 모양(desk-adapt) · 이 Gateway 의 앱 목록(모듈 › 앱 탭) · 다른 모듈 앱 열기(셸에 부탁)
  window.TerraDesk = deskAdapt; window.TerraNodeStats = nodeStats; window.TerraCanRemote = canRemote; window.TerraPermissionsOf = permissionsOf; window.TerraFmtBytes = fmtBytes; window.TerraNet = netRead; window.TerraSvi = sviRead; window.TerraNodeInfo = createNodeInfo(terra, () => window.TerraTopology);   // 노드 상태 창 — 식별 · 통信 · 최근 활동   // 네트워크 창 — Master 네트워크 · 경로 읽기   // 전역 틀 대상 표 — Master 하트비트 자원 스냅샷
  window.TerraLaunch = (appId) => { if (MODE !== 'app' || !frame) return false; frame.emit('launch', appId); return true; };   // main Scene 의 gui-v3.app.launch → terra.app:launch → 셸이 화면 안 창으로
  const loadApps = () => terra.http('GET', '/api/v1/gui/apps').then((d) => { window.TerraGuiApps = (d && d.apps) || []; }, () => { window.TerraGuiApps = []; });
  // 알림 — 작업 · 모듈 상태가 바뀌면 한 줄(아래 상태 줄). 목록은 window.TerraAlarms(최근 50). 밀어 받기가 이벤트를 받으면 바로 다시 읽는다
  const stopLive = () => { if (push) { push.stop(); push = null; } if (alarms) { alarms.stop(); alarms = null; } clearInterval(topoTimer); topoTimer = 0; window.TerraAlarms = []; };
  // 노드 기록(상태 · 하트비트 · 자원)은 로그인 때 한 번만 받으면 낡는다 — 30초마다 다시(보일 때만). 노드 목록이 같으면(rev 같음) 기록만 바꿔 끼우고 씬은 다시 짓지 않는다
  //   window.TerraTopologyState = { state: 'ok'|'empty'|'error', error?, at } — 못 받았을 때 화면이 시안 지도를 실제처럼 두지 않고 "받지 못함 / 노드 없음"을 보일 신호('terra-topology-state' 이벤트도)
  const refreshTopology = () => loadTopologyState(terra).then((r) => {
    window.TerraTopologyState = { state: r.state, error: r.error || '', at: r.at }; try { window.dispatchEvent(new Event('terra-topology-state')); } catch {}
    const t = r.topo; if (!t) return; const cur = window.TerraTopology; if (cur && cur.rev === t.rev && cur.localId === t.localId) window.TerraTopology = t; else setTopology(t);
  }, () => {});
  const TOPO_MS = 30000;   // 지도 · 대상 표 갱신 주기 — 탭이 보일 때만(숨겨진 탭은 Master 를 두드리지 않고, 다시 보이면 바로 한 번)
  const topoTick = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshTopology(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (topoTimer && document.visibilityState === 'visible') refreshTopology(); });
  const afterLogin = () => {
    transport.ready(); loadRoutes(); loadApps(); stopLive();
    terra.invoke('terra.gateway.agent.whoami.get', {}).then((w) => { window.TerraWho = w; }, () => { window.TerraWho = null; });   // 계정 탭 — principal · 권한 · Terra ID 연결의 사용자 id
    alarms = startAlarms({ terra, onAlarm: (a) => say(a.g + ' ' + a.m) }); window.TerraAlarms = alarms.list;
    topoTimer = setInterval(topoTick, TOPO_MS); refreshTopology();
    push = startPush({ terra, store: () => window.TerraNodes, onEvent: () => alarms && alarms.poke() });
  };
  const SC = boardDef('Scene');
  let sceneOut = null;   // 보드의 원래 로그아웃(로그인 층을 전환을 거꾸로 해 다시 올린다)
  if (SC && SC.Logic.prototype.sceneLogout && !SC.Logic.__terraOut) { const out = sceneOut = SC.Logic.prototype.sceneLogout; SC.Logic.prototype.sceneLogout = function (...a) { if (MODE === 'app') { const back = signedIn(); appLogout(); return back ? out.apply(this, a) : undefined; } if (MODE === 'shell') session.logout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; stopLive(); return out.apply(this, a); }; SC.Logic.__terraOut = true; }
  // A 모드의 로그인 · 로그아웃 — 웹은 비밀번호를 받지 않는다. 첫 화면은 B 와 같은 로그인 보드(TERRA 연출)다:
  //   셸 칸이 있으면 보드의 폼 + 셸 칸으로 로그인(§1-2) · 없으면(이전 Terra) TERRA 를 누르면 emit('login') → Scene 의 /login 카드 → / 로 돌아와 frame 이 새로 서고 토큰이 든 init
  //   토큰이 있으면(셸 세션 · 이미 로그인) 연출을 잠깐 보인 뒤 폼 없이 워프로 트리 뷰
  //   로그아웃 → emit('logout') — 그 Scene 이 쥔 Handle 이 있을 때만(session.state, node-gui 와 같은 규칙) — 그리고 로그인 층을 거꾸로. 셸 세션의 토큰이면 셸에서 로그아웃한다
  const signedIn = () => { const v = frame && frame.value && frame.value(); return !!(v && v.state === 'signedIn'); };
  const appLogout = () => {
    if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; stopLive();
    if (frame && signedIn()) frame.emit('logout'); else say('셸의 로그인으로 열렸어요 — 로그아웃은 셸에서');
  };
  const appSignedIn = () => { loadTopology(terra).then((t) => t && setTopology(t)); afterLogin(); };
  // 토큰을 잃으면 보드의 로그인 층을 다시 올린다(이미 올라와 있으면 그대로)
  const showLogin = () => { const sc = window.__terra && window.__terra.scene; if (sc && sceneOut && sc.loginOn && !sc.loginOn()) sceneOut.call(sc); };
  // 이미 로그인한 채 왔다 — 로그인 층의 TERRA 연출을 잠깐(AUTO_WARP_MS) 보이고 폼 없이 워프. 그 사이 사용자가 누르면 openLogin 이 바로 워프한다
  const AUTO_WARP_MS = 1400;
  const autoWarp = () => setTimeout(() => {
    const T = window.__terra, lg = T && T.login(), sc = T && T.scene;
    if (lg && sc && sc.loginOn && sc.loginOn() && !lg._WP && frame && frame.token()) lg.enterSignedIn();
  }, AUTO_WARP_MS);
  // A 모드 — 셸의 init 을 받으면 지도부터. 셸이 답하지 않으면(15초) 데이터 없이 연다(로그인 보드는 "셸이 응답하지 않아요")
  if (MODE === 'app') appReady.then((f) => {
    frame = f; if (!f) { say('셸이 응답하지 않아요 — Terra 데이터 없이'); return; }
    const sec = hostSecretOf(f);
    if (sec) bindHostSecret({ secret: sec, login: () => window.__terra && window.__terra.login(), scene: () => window.__terra && window.__terra.scene, wanted: () => !f.token() });   // 토큰이 있으면(이미 로그인) 칸을 두지 않는다
    let had = !!f.token();
    if (f.onToken) f.onToken((tok) => {   // 토큰이 바뀌면(다른 사용자 · 로그인 · 로그아웃) 앞의 사본을 버린다
      if (window.TerraNodes) window.TerraNodes.clear();
      if (tok && !had) { appSignedIn(); if (!sec) autoWarp(); }   // 셸 칸으로 한 로그인은 hostLogin 이 워프한다
      else if (!tok) { stopLive(); showLogin(); }
      had = !!tok;
    });
    if (had) { appSignedIn(); autoWarp(); say('앱 모드 — 셸의 앱 토큰'); }
  });
} else say('목업 — Terra 없이 시안 데이터');

// 첫 화면은 모드와 상관없이 로그인 보드다(A 모드도 — 로그인 뒤 워프로 트리 뷰)
const host = mountBoard('Scene', document.getElementById('app'), {});
window.__terra = { mode: MODE, frame: () => frame, host, scene: host.logic, terra, session, transport, login: () => { const L = boardDef('Login'); return L && L.Logic.last; } };   // 연기 시험 · 개발 도구용
