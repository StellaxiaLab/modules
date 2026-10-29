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

const q = new URLSearchParams(location.search), status = document.getElementById('status');
const say = (t) => { if (!status) return; status.textContent = t; status.style.opacity = ''; clearTimeout(say.t); say.t = setTimeout(() => { status.style.opacity = '0'; }, 5000); };   // 잠깐 보이고 사라진다(전역 틀 아래 줄과 겹치지 않게)

if (q.get('gpu') !== 'off') useGpuField('Scene', { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', onReady: (h) => say('글자 장 ' + h.kind + ' · ' + (h.mode === 'worker' ? 'Worker' : '메인 스레드')) });
else say('글자 장 시안 2D');

// B 모드 — 보드를 고치지 않고 두 자리만 잇는다: 로그인(Login.login) · 로그아웃(Scene.sceneLogout). 노드 데이터는 TerraNodes 가 window.TerraTransport 를 쓴다
let terra = null, session = null, transport = null;
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
        session.login(S.va, S.vp).then(() => { this._busy = false; if (window.TerraNodes) window.TerraNodes.clear(); transport.ready(); super.login(); },   // 로그인 전의 '로그인 전' 답은 지우고 새로   // 됐으면 시안의 전환(워프)
          (e) => { this._busy = false; this.setState({ msg: e.message || '로그인 못 함' }); this.ripAt('login', [255, 120, 110]); });
      }
    }
    TerraLogin.__terra = true; L.Logic = TerraLogin;
  }
  const SC = boardDef('Scene');
  if (SC && SC.Logic.prototype.sceneLogout && !SC.Logic.__terraOut) { const out = SC.Logic.prototype.sceneLogout; SC.Logic.prototype.sceneLogout = function (...a) { session.logout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); return out.apply(this, a); }; SC.Logic.__terraOut = true; }
} else say('목업 — Terra 없이 시안 데이터');

const host = mountBoard('Scene', document.getElementById('app'), {});
window.__terra = { host, scene: host.logic, terra, session, transport, login: () => { const L = boardDef('Login'); return L && L.Logic.last; } };   // 연기 시험 · 개발 도구용
