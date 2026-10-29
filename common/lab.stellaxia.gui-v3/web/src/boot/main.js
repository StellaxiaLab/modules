// 앱 입구 — 캔버스 시안의 씬(Scene: 통합 화면 + 전역 틀 + 창들 + 로그인)을 그대로 띄운다.
//   보드          design/*.dc.html → 빌드 때 모듈(virtual:boards). 보드 실행기(src/ui/dc/runtime.js)가 DOM 에 붙인다
//   글자 장       씬이 매 프레임 채우는 칸 기록을 GPU 렌더러로(scene-bridge — WebGL2, 되면 Worker 의 OffscreenCanvas)
//   창            씬의 창들(제어기 · 설정 · 상태 · 자원 · 자원 상태 · Tree 로그인 · 모듈 상태 · 브라우저 · 스타메이커)은 시안의 창 관리 그대로 DOM 창
//   Terra         B 모드(제품 셸) — 로그인 화면이 Gateway 에 로그인(자격 핸들), 노드 데이터 층(TerraNodes)은 Gateway 전송으로(src/api/transport.js)
// 주소 뒤 ?render=main — Worker 없이 · ?gl=2d — GPU 없이 · ?gpu=off — 시안의 2D 길 그대로(비교용) · ?demo — Terra 없이 시안의 목업 그대로

import 'virtual:boards';
import { mountBoard, boardDef } from '../ui/dc/runtime.js';
import { useGpuField } from '../scene/scene-bridge.js';
import { createTerra } from '../api/terra.js';
import { createSession } from '../api/session.js';
import { createGatewayTransport } from '../api/transport.js';
import { loadTopology } from '../api/topology.js';
import { startPush } from '../api/push.js';

const q = new URLSearchParams(location.search), status = document.getElementById('status');
const say = (t) => { if (!status) return; status.textContent = t; status.style.opacity = ''; clearTimeout(say.t); say.t = setTimeout(() => { status.style.opacity = '0'; }, 5000); };   // 잠깐 보이고 사라진다(전역 틀 아래 줄과 겹치지 않게)

if (q.get('gpu') !== 'off') useGpuField('Scene', { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', onReady: (h) => say('글자 장 ' + h.kind + ' · ' + (h.mode === 'worker' ? 'Worker' : '메인 스레드')) });
else say('글자 장 시안 2D');

// B 모드 — 보드를 고치지 않고 두 자리만 잇는다: 로그인(Login.login) · 로그아웃(Scene.sceneLogout). 노드 데이터는 TerraNodes 가 window.TerraTransport 를 쓴다
let terra = null, session = null, transport = null, push = null;
if (!q.has('demo')) {
  session = createSession();
  terra = createTerra({ authorization: () => session.authorization() });
  transport = window.TerraTransport = createGatewayTransport({ terra, authed: () => !!session.handle });
  const L = boardDef('Login');
  if (L && !L.Logic.__terra) {
    class TerraLogin extends L.Logic {
      constructor(p) { super(p); TerraLogin.last = this; }
      login() {
        const S = this.state || {};
        if (!S.va || !S.vp || this._busy) return super.login();   // 빈 칸 안내는 시안 그대로
        this._busy = true; this.setState({ msg: '확인 중…' });
        session.login(S.va, S.vp)
          .then(() => Promise.race([loadTopology(terra), new Promise((r) => setTimeout(() => r(null), 4000))]))   // 실제 지도 — 전환(워프) 전에 받아 둔다(4초 넘으면 시안 지도로 들어가고 오면 바꾼다)
          .then((topo) => { this._busy = false; if (window.TerraNodes) window.TerraNodes.clear(); if (topo) setTopology(topo); else loadTopology(terra).then((t) => t && setTopology(t)); transport.ready(); loadRoutes(); if (push) push.stop(); push = startPush({ terra, store: () => window.TerraNodes }); super.login(); },   // 로그인 전의 '로그인 전' 답은 지우고 새로   // 됐으면 시안의 전환(워프)
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
  const SC = boardDef('Scene');
  if (SC && SC.Logic.prototype.sceneLogout && !SC.Logic.__terraOut) { const out = SC.Logic.prototype.sceneLogout; SC.Logic.prototype.sceneLogout = function (...a) { session.logout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; if (push) { push.stop(); push = null; } return out.apply(this, a); }; SC.Logic.__terraOut = true; }
} else say('목업 — Terra 없이 시안 데이터');

const host = mountBoard('Scene', document.getElementById('app'), {});
window.__terra = { host, scene: host.logic, terra, session, transport, login: () => { const L = boardDef('Login'); return L && L.Logic.last; } };   // 연기 시험 · 개발 도구용
