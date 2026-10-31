// 앱 입구 — 캔버스 시안의 씬(Scene: 통합 화면 + 전역 틀 + 창들 + 로그인)을 그대로 띄운다.
//   보드          design/*.dc.html → 빌드 때 모듈(virtual:boards). 보드 실행기(src/ui/dc/runtime.js)가 DOM 에 붙인다
//   글자 장       씬이 매 프레임 채우는 칸 기록을 GPU 렌더러로(scene-bridge — WebGL2, 되면 Worker 의 OffscreenCanvas)
//   창            씬의 창들(제어기 · 설정 · 상태 · 자원 · 자원 상태 · Tree 로그인 · 모듈 상태 · 브라우저 · 스타메이커)은 시안의 창 관리 그대로 DOM 창
//   Terra         실행 모드(src/api/mode.js)로 길을 고른다 — A(앱: 셸 안 · 앱 토큰 · 로그인 화면 건너뜀) · B(제품 셸: 로그인 화면이 Gateway 에 로그인 · 자격 핸들) · demo(목업)
//                 노드 데이터 층(TerraNodes)은 두 모드 모두 Gateway 전송으로(src/api/transport.js)
// 주소 뒤 ?render=main — Worker 없이 · ?gl=2d — GPU 없이 · ?gpu=off — 시안의 2D 길 그대로(비교용) · ?demo — Terra 없이 시안의 목업 그대로 · ?mode=app|shell — 모드 고르기

import 'virtual:boards';
import { mountBoard, boardDef } from '../ui/dc/runtime.js';
import { useGpuField } from '../scene/scene-bridge.js';
import { createTerra } from '../api/terra.js';
import { createSession } from '../api/session.js';
import { createGatewayTransport } from '../api/transport.js';
import { loadTopology, nodeStats } from '../api/topology.js';
import { startPush } from '../api/push.js';
import { pickMode, connectApp } from '../api/mode.js';
import * as deskAdapt from '../api/desk-adapt.js';
import { startAlarms } from '../api/alarms.js';

const q = new URLSearchParams(location.search), status = document.getElementById('status'), MODE = pickMode(q);
const appReady = MODE === 'app' ? connectApp() : Promise.resolve(null);   // A 모드 — hello 는 가장 먼저(마운트가 이벤트 루프를 붙잡기 전에)
let frame = null;
const say = (t) => { if (!status) return; status.textContent = t; status.style.opacity = ''; clearTimeout(say.t); say.t = setTimeout(() => { status.style.opacity = '0'; }, 5000); };   // 잠깐 보이고 사라진다(전역 틀 아래 줄과 겹치지 않게)

if (q.get('gpu') !== 'off') useGpuField('Scene', { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', onReady: (h) => say('글자 장 ' + h.kind + ' · ' + (h.mode === 'worker' ? 'Worker' : '메인 스레드')) });
else say('글자 장 시안 2D');

// 보드를 고치지 않고 몇 자리만 잇는다: 로그인(Login.login) · Tree 로그인 · 로그아웃(Scene.sceneLogout). 노드 데이터는 TerraNodes 가 window.TerraTransport 를 쓴다
let terra = null, session = null, transport = null, push = null, alarms = null;
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
        if (MODE === 'app') { if (frame && frame.token()) return this.warpStart(); if (frame) { frame.emit('login'); return; } this.setState({ msg: '셸이 응답하지 않아요 — 셸에서 로그인한 뒤 다시' }); return; }   // A 모드 — 비밀번호를 받지 않는다: 로그인은 감싼 Scene 의 /login 카드가(웹 프로그램 감싸기 설계 §3.3.1)
        if (!S.va || !S.vp || this._busy) return super.login();   // 빈 칸 안내는 시안 그대로
        this._busy = true; this.setState({ msg: '확인 중…' });
        session.login(S.va, S.vp)
          .then(() => Promise.race([loadTopology(terra), new Promise((r) => setTimeout(() => r(null), 4000))]))   // 실제 지도 — 전환(워프) 전에 받아 둔다(4초 넘으면 시안 지도로 들어가고 오면 바꾼다)
          .then((topo) => { this._busy = false; if (window.TerraNodes) window.TerraNodes.clear(); if (topo) setTopology(topo); else loadTopology(terra).then((t) => t && setTopology(t)); afterLogin(); super.login(); },   // 로그인 전의 '로그인 전' 답은 지우고 새로   // 됐으면 시안의 전환(워프)
          (e) => { this._busy = false; this.setState({ msg: e.message || '로그인 못 함' }); this.ripAt('login', [255, 120, 110]); });
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
  window.TerraDesk = deskAdapt; window.TerraNodeStats = nodeStats;   // 전역 틀 대상 표 — Master 하트비트 자원 스냅샷
  window.TerraLaunch = (appId) => { if (MODE !== 'app' || !frame) return false; frame.emit('launch', appId); return true; };   // main Scene 의 gui-v3.app.launch → terra.app:launch → 셸이 화면 안 창으로
  const loadApps = () => terra.http('GET', '/api/v1/gui/apps').then((d) => { window.TerraGuiApps = (d && d.apps) || []; }, () => { window.TerraGuiApps = []; });
  // 알림 — 작업 · 모듈 상태가 바뀌면 한 줄(아래 상태 줄). 목록은 window.TerraAlarms(최근 50). 밀어 받기가 이벤트를 받으면 바로 다시 읽는다
  const stopLive = () => { if (push) { push.stop(); push = null; } if (alarms) { alarms.stop(); alarms = null; } window.TerraAlarms = []; };
  const afterLogin = () => {
    transport.ready(); loadRoutes(); loadApps(); stopLive();
    alarms = startAlarms({ terra, onAlarm: (a) => say(a.g + ' ' + a.m) }); window.TerraAlarms = alarms.list;
    push = startPush({ terra, store: () => window.TerraNodes, onEvent: () => alarms && alarms.poke() });
  };
  const SC = boardDef('Scene');
  if (SC && SC.Logic.prototype.sceneLogout && !SC.Logic.__terraOut) { const out = SC.Logic.prototype.sceneLogout; SC.Logic.prototype.sceneLogout = function (...a) { if (MODE === 'app') return appLogout(); if (MODE === 'shell') session.logout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; stopLive(); return out.apply(this, a); }; SC.Logic.__terraOut = true; }
  // A 모드의 로그인 · 로그아웃 — 웹은 비밀번호를 받지 않는다. main Scene(scene/)이 감쌌으면 그 껍데기가 로그인을 맡는다:
  //   토큰이 없으면 [로그인] → emit('login') → Scene 의 /login 카드 → Handle → 호스트가 frame 에 새 토큰(또는 / 로 돌아와 frame 을 새로 띄운다)
  //   로그아웃 → emit('logout') — 그 Scene 이 쥔 Handle 이 있을 때만(session.state, node-gui 와 같은 규칙). 셸 세션의 토큰이면 셸에서 로그아웃한다
  const signedIn = () => { const v = frame && frame.value && frame.value(); return !!(v && v.state === 'signedIn'); };
  let gate = null;
  const showGate = (on) => {
    if (!on) { if (gate) { gate.remove(); gate = null; } return; }
    if (gate) return;
    gate = document.createElement('div'); gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-label', 'Terra 로그인 필요'); gate.dataset.gate = 'login';
    gate.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99;display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:10px;background:rgba(10,16,28,.88);color:#dfe8f5;font:14px/1.4 Pretendard,system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.4)';
    const msg = document.createElement('span'); msg.textContent = 'Terra 로그인이 필요해요 — 노드 · 트리의 실데이터는 로그인 뒤에 보여요';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '로그인'; b.dataset.act = 'login';
    b.style.cssText = 'padding:6px 14px;border-radius:8px;border:0;background:#3d7bfd;color:#fff;font:inherit;cursor:pointer';
    b.onclick = () => frame && frame.emit('login');
    gate.append(msg, b); document.body.appendChild(gate);
  };
  const appLogout = () => {
    if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; stopLive();
    if (frame && signedIn()) frame.emit('logout'); else say('셸의 로그인으로 열렸어요 — 로그아웃은 셸에서');
  };
  const appSignedIn = () => { showGate(false); loadTopology(terra).then((t) => t && setTopology(t)); afterLogin(); };
  // A 모드 — 셸의 init 을 받으면 지도부터. 토큰 없이 왔으면 로그인 문을 띄운다. 셸이 답하지 않으면(15초) 데이터 없이 연다
  if (MODE === 'app') appReady.then((f) => {
    frame = f; if (!f) { say('셸이 응답하지 않아요 — Terra 데이터 없이'); return; }
    let had = !!f.token();
    if (f.onToken) f.onToken((tok) => {   // 토큰이 바뀌면(다른 사용자 · 로그인 · 로그아웃) 앞의 사본을 버린다
      if (window.TerraNodes) window.TerraNodes.clear();
      if (tok && !had) appSignedIn(); else if (!tok) { stopLive(); showGate(true); }
      had = !!tok;
    });
    if (had) { appSignedIn(); say('앱 모드 — 셸의 앱 토큰'); } else showGate(true);
  });
} else say('목업 — Terra 없이 시안 데이터');

const host = mountBoard('Scene', document.getElementById('app'), MODE === 'app' ? { login: false } : {});   // A 모드는 로그인 층 없이 바로 트리 뷰
window.__terra = { mode: MODE, frame: () => frame, host, scene: host.logic, terra, session, transport, login: () => { const L = boardDef('Login'); return L && L.Logic.last; } };   // 연기 시험 · 개발 도구용
