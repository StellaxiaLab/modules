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
import { buildTopology, loadTopology, loadTopologyState, nodeStats, fmtBytes } from '../api/topology.js';
import { createTheme } from '../ui/theme.js';
import { startPush } from '../api/push.js';
import { pickMode, connectApp } from '../api/mode.js';
import { hostSecretOf, waitHostLogin, nextAttempt, passwordRowItems, bindHostSecret, rememberedOf, rememberedMode, rememberedRowItems } from '../api/host-secret.js';
import * as deskAdapt from '../api/desk-adapt.js';
import { startAlarms } from '../api/alarms.js';
import { createMetrics } from '../api/metrics.js';
import * as netRead from '../api/net-read.js';
import { createNodeInfo } from '../api/node-info.js';
import { createNetProps } from '../api/net-props.js';
import { createShells } from '../api/shells.js';
import { createSviMake, moduleTypes } from '../api/svi-make.js';
import { createSviEnvelope } from '../api/svi-envelope.js';
import * as sviRead from '../api/svi-read.js';
import * as sviView from '../api/svi-view.js';
import { gate, gateAll, riskOf, denyHint } from '../api/gates.js';
import { dangerView } from '../api/danger-zone.js';
import * as fileTransfer from '../api/file-transfer.js';
import * as taskFollow from '../api/task-follow.js';
import * as changes from '../api/changes.js';
import { makeTerraTreeLogin } from './tree-login.js';
import { migratePc, pcLogout as pcLogout0, setWho } from '../api/pc-state.js';

window.TerraTheme = createTheme({ root: document.documentElement, storage: (() => { try { return window.localStorage; } catch { return null; } })(), emit: () => window.dispatchEvent(new Event('terra-theme')) });   // 다크 · 라이트 — 이 브라우저의 보기 설정
const q = new URLSearchParams(location.search), status = document.getElementById('status'), MODE = pickMode(q);
const appReady = MODE === 'app' ? connectApp() : Promise.resolve(null);   // A 모드 — hello 는 가장 먼저(마운트가 이벤트 루프를 붙잡기 전에)
let frame = null;
const say = (t) => { if (!status) return; status.textContent = t; status.style.opacity = ''; clearTimeout(say.t); say.t = setTimeout(() => { status.style.opacity = '0'; }, 5000); };   // 잠깐 보이고 사라진다(전역 틀 아래 줄과 겹치지 않게)

if (q.get('gpu') !== 'off') useGpuField('Scene', { mode: q.get('render') === 'main' ? 'main' : 'worker', prefer: q.get('gl') === '2d' ? '2d' : 'webgl2', onReady: (h) => say('글자 장 : ' + h.kind + ' · ' + (h.mode === 'worker' ? 'Worker' : '메인 스레드')) });
else say('글자 장 : 시안 2D');

// 보드를 고치지 않고 몇 자리만 잇는다: 로그인(Login.login) · Tree 로그인 · 로그아웃(Scene.sceneLogout). 노드 데이터는 TerraNodes 가 window.TerraTransport 를 쓴다
let terra = null, session = null, transport = null, push = null, alarms = null, topoTimer = 0;
if (MODE !== 'demo') {
  session = createSession();
  try { migratePc(window.localStorage); } catch {}   // 처음 한 번 — 옛 제어기 키(terra.view.desk.* · terra.wall.*)를 지운다(바탕 구성은 이제 그 노드가 원본 — 설계 node-owned-desk.md §14)
  // 자격 — B: 자격 핸들(Handle) · A: 셸이 준 앱 토큰(Bearer), 401 이면 셸에게 새로 받아 한 번 더
  terra = createTerra({ authorization: () => (MODE === 'shell' ? session.authorization() : null), token: () => (frame ? frame.token() : null), refresh: () => (frame ? frame.refresh() : Promise.resolve(undefined)) });
  window.TerraTopology = buildTopology([], { rev: 'none' });   // 실제 모드의 첫 지도는 빈 지도 — 시안 지도(01 · 02 …)를 실제처럼 보이지 않는다. 받으면 바뀌고, 못 받으면 상단 줄이 '못 봤음'을 보인다
  transport = window.TerraTransport = createGatewayTransport({ terra, localRid: () => (window.TerraTopology && window.TerraTopology.localId) || '', authed: () => (MODE === 'shell' ? !!session.handle : !!(frame && frame.token())) });
  const L = boardDef('Login');
  if (L && !L.Logic.__terra) {
    class TerraLogin extends L.Logic {
      constructor(p) { super(p); TerraLogin.last = this; }
      login() {
        const S = this.state || {};
        if (MODE === 'app') {   // A 모드 — 비밀번호를 받지 않는다
          if (frame && frame.token()) return this.warpStart();
          if (rememberedMode(frame, S)) return this.rememberedLogin();   // auto — 기억된 id 로, 비밀번호 없이
          const sec = hostSecretOf(frame); if (sec) return this.hostLogin(sec);   // 셸이 비밀번호 칸을 준다(§4.9) — 이 보드가 그리고, 값은 셸 칸에서 Scene 으로
          if (frame) { frame.emit('login'); return; }   // 칸을 모르는 셸 — 감싼 Scene 의 /login 카드가(웹 프로그램 감싸기 설계 §3.3.1)
          this.setState({ msg: '셸 응답 없음 — 셸에서 로그인 후 재시도' }); return;
        }
        if (!S.va || !S.vp || this._busy) return super.login();   // 빈 칸 안내는 시안 그대로
        this._busy = true; this.setState({ msg: '확인 중…' });
        session.login(S.va, S.vp)
          .then(() => Promise.race([loadTopology(terra), new Promise((r) => setTimeout(() => r(null), 4000))]))   // 실제 지도 — 전환(워프) 전에 받아 둔다(4초 넘으면 빈 지도로 들어가고 오면 바꾼다)
          .then((topo) => { this._busy = false; if (window.TerraNodes) window.TerraNodes.clear(); if (topo) setTopology(topo); else loadTopology(terra).then((t) => t && setTopology(t)); afterLogin(); super.login(); },   // 로그인 전의 '로그인 전' 답은 지우고 새로   // 됐으면 시안의 전환(워프)
          (e) => { this._busy = false; this.setState({ msg: e.message || '로그인 실패' }); this.ripAt('login', [255, 120, 110]); });
      }
      // A 모드 + 셸 비밀번호 칸 — 빈 칸 안내는 시안 그대로(비밀번호가 비었는지는 셸이 알려 준다), 보내는 것은 비밀이 아닌 값뿐
      hostLogin(sec) {
        const S = this.state || {};
        if (this._busy) return;
        if (!S.va || sec.state().empty) { this.setState({ msg: !S.va ? 'admin 입력 필요' : 'password 입력 필요' }); this.ripAt('login', [242, 244, 252]); return; }
        const attempt = nextAttempt(); this._busy = true; this.setState({ msg: '확인 중…' });
        const answer = waitHostLogin(frame, attempt);
        sec.submit({ email: S.va, auto: !!S.autoOn, node: String(S.inst ?? this.props.installed ?? 'Leaf'), attempt });
        answer.then((r) => {
          this._busy = false;
          if (r.ok) { this.warpStart(); return; }   // 토큰이 왔다 — 지도 · 밀어 받기는 frame.onToken 이 시작한다(appSignedIn)
          this.setState({ msg: r.message }); this.ripAt('login', [255, 120, 110]); sec.focus();   // 다시 칠 자리로
        });
      }
      // 기억된 로그인(auto) — Gateway 가 기억한 refresh token 으로 들어간다. 이 웹은 id 만 보낸다.
      //   거절되면(만료 · 폐기 · 다른 곳에서 로그아웃) Gateway 가 기억을 지웠다 — 이쪽도 잊고 일반 로그인(셸 칸)으로
      rememberedLogin() {
        const S = this.state || {};
        if (this._busy) return;
        const attempt = nextAttempt(); this._busy = true; this.setState({ msg: '확인 중…' });
        const answer = waitHostLogin(frame, attempt);
        frame.remember.resume({ email: S.va, attempt });
        answer.then((r) => {
          this._busy = false;
          if (r.ok) { this.warpStart(); return; }
          frame.remember.forget();
          this.setState({ msg: '기억된 로그인 만료 — 비밀번호 입력 필요' }); this.ripAt('login', [255, 120, 110]);
          const sec = hostSecretOf(frame); if (sec) sec.focus();
        });
      }
      // A 모드에서 TERRA 화면을 누르면 — 이미 로그인했으면 폼 없이 워프, 셸 칸이 없으면(이전 Terra) 폼 대신 Scene 의 /login 카드로
      openLogin() {
        if (MODE === 'app') {
          if (frame && frame.token()) return this.enterSignedIn();
          if (!hostSecretOf(frame)) { if (frame) frame.emit('login'); return; }   // 이 보드의 폼은 웹이 비밀번호를 받는 칸이다 — 셸 칸 없이는 열지 않는다(§3.3.1)
          const R = rememberedOf(frame), S = this.state || {};
          if (R && !S.va) this.setState({ va: R.email, autoOn: true });   // auto — 기억된 id 를 채우고 고정 점으로
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
      loginItems() {
        const it = super.loginItems();
        if (MODE === 'app' && rememberedMode(frame, this.state)) return rememberedRowItems(it);
        const sec = MODE === 'app' && hostSecretOf(frame); return sec ? passwordRowItems(it, sec.state().empty) : it;
      }
      renderVals() {
        const v = super.renderVals();
        if (MODE === 'app') {   // A 모드에서 보드의 숨은 password 칸은 받지 않는다 — Tab 으로 오면 셸 칸으로 넘긴다(셸 칸이 없으면 놓는다)
          const sec = hostSecretOf(frame);
          v.inP = () => {}; v.focP = (e) => { if (sec && !rememberedMode(frame, this.state)) sec.focus(); else if (e && e.target && e.target.blur) e.target.blur(); };
          // auto 를 끄면 기억을 지운다(Gateway 의 봉한 refresh token 까지) — 다음부터는 비밀번호로
          const S0 = this.state || {};
          v.auto = () => { const on = !S0.autoOn; if (!on && rememberedOf(frame)) frame.remember.forget(); this.setState({ autoOn: on }); };
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
    const list = Array.isArray(d) ? d : (d && (d.routes || d.items)) || [], m = {}; for (const r of list) if (r && r.node_id) m[r.node_id] = r; window.TerraLoginRoutes = m; window.TerraLoginRoutesErr = '';
    const sc = window.__terra && window.__terra.scene; if (sc && sc.gf_layout) sc.gf_layout();
  }, (e) => { window.TerraLoginRoutes = null; window.TerraLoginRoutesErr = (e && (e.code || e.status)) || 'UNKNOWN'; });   // 못 받은 것은 '알 수 없음' + 코드(지어낸 주소 없음)
  const TL = boardDef('TreeLogin');
  if (TL && !TL.Logic.__terra) {
    const ridOf = (key) => { const sc = window.__terra && window.__terra.scene, n = sc && sc.sceneMap && sc.sceneMap().byId[key]; return (n && n.rid) || ''; };
    const TerraTreeLogin = makeTerraTreeLogin(TL.Logic, { terra, ridOf });
    TerraTreeLogin.__terra = true; TL.Logic = TerraTreeLogin;
  }
  // 로그인 뒤 한 번 — 지도 · Tree 길 · 보기 상태 · 밀어 받기
  // 노드 데스크톱이 쓰는 것 — 실제 응답 → 보드 모양(desk-adapt) · 이 Gateway 의 앱 목록(모듈 › 앱 탭) · 다른 모듈 앱 열기(셸에 부탁)
  window.TerraDesk = deskAdapt; window.TerraNodeStats = nodeStats; window.TerraCanRemote = canRemote; window.TerraPermissionsOf = permissionsOf; window.TerraFmtBytes = fmtBytes; window.TerraNet = netRead; window.TerraSvi = sviRead; window.TerraNodeInfo = createNodeInfo(terra, () => window.TerraTopology); window.TerraNetProps = createNetProps(terra, () => window.TerraTopology); window.TerraShells = createShells(terra, () => window.TerraTopology); window.TerraSviMake = createSviMake(terra, () => window.TerraTopology, () => window.TerraWho); window.TerraSviEnvelope = createSviEnvelope(terra, () => window.TerraTopology); window.TerraSviTypes = () => moduleTypes(window.TerraSviMods || []); window.TerraSviView = sviView; window.TerraSviWatch = sviView.createSviWatch(terra);   // 자원 상태 창 값 보기 — 형식 → 뷰어 · 구독(핸들 열기 → events, 지금은 위임 밖이라 문이 잠근다)   // SVI 창 — 선언 · 허가 · 연결, 모듈이 내놓은 유형(contributions.svi.types — 코어 대기)   // 제어기의 노드 터미널(commands.execute · 이 노드에서만) · Terra 터미널(terra shell 낱말 → operation)   // 네트워크 속성 창 — 주소 · 광고 전송 · 노드 간 연결   // 노드 상태 창 — 식별 · 통信 · 최근 활동   // 네트워크 창 — Master 네트워크 · 경로 읽기   // 전역 틀 대상 표 — Master 하트비트 자원 스냅샷
  // 문 — 코어가 앱 토큰에 열지 않은 단추를 잠그고 이유를 적는다(src/api/gates.js). 사람 권한은 whoami 로. 보드는 window.TerraGate 가 없으면(시안) 연다
  window.TerraGate = (op, o = {}) => gate(op, Object.assign({ who: window.TerraWho }, o)); window.TerraGateAll = (ops, o = {}) => gateAll(ops, Object.assign({ who: window.TerraWho }, o)); window.TerraRisk = riskOf; window.TerraDenyHint = denyHint;
  // 제어기의 파일 · 작업 · 밀어 받기 — 공유 폴더 내용 · 전송(lab.stellaxia.file), 작업 출력 따라가기(이 노드 SSE · 다른 노드 폴링), 바뀐 줄 찾기
  window.TerraFileTransfer = Object.assign({ create: (invoke) => fileTransfer.createFileTransfer({ invoke }) }, fileTransfer);
  window.TerraTaskFollow = Object.assign((n, taskId, onUpdate) => taskFollow.followTask({ taskId, onUpdate, sse: n === transport.localId() ? (op, i, h) => terra.sse(op, i, h) : null, poll: (i) => transport.invoke(n, 'terra.daemon.tasks.by-task-id.output.get', i) }), taskFollow);
  window.TerraChanges = changes;
  window.TerraLaunch = (appId) => { if (MODE !== 'app' || !frame) return false; frame.emit('launch', appId); return true; };   // main Scene 의 gui-v3.app.launch → terra.app:launch → 셸이 화면 안 창으로
  // 위험 영역 — 설정창 단추는 Scene 에 'danger' 이벤트만 보낸다(값을 싣지 않는다). 켜기 · 끄기는 Scene 의 /danger 확인 화면이 한다 — 이 페이지는 스위치 쓰기를 부르지 않는다(ADR-GW-012 §6.1)
  window.TerraDangerView = dangerView; window.TerraDangerAsk = () => { if (!(MODE === 'app' && frame)) return false; frame.emit('danger'); return true; }; window.TerraDangerAsk.can = () => MODE === 'app' && !!frame;   // 늘 정의 — frame 은 호출 때 본다(앱 모드의 frame 은 나중에 선다)
  const loadApps = () => terra.http('GET', '/api/v1/gui/apps').then((d) => { window.TerraGuiApps = (d && d.apps) || []; }, () => { window.TerraGuiApps = null; })
    .then(() => terra.invoke('terra.daemon.modules.get', {}).then((d) => { window.TerraSviMods = Array.isArray(d) ? d : (d && (d.modules || d.items)) || []; }, () => { window.TerraSviMods = []; }))
    .then(() => { try { window.dispatchEvent(new Event('terra-apps')); } catch {} });   // 앱 목록이 모듈 목록보다 늦게 와도 화면이 다시 그린다(AUD-89)   // SVI 유형을 내놓는 모듈(contributions.svi.types)
  // 알림 — 작업 · 모듈 상태가 바뀌면 한 줄(아래 상태 줄). 목록은 window.TerraAlarms(최근 50), 읽음 · 지우기는 window.TerraAlarmBook(src/api/alarms.js).
  //   바뀌면 'terra-alarms' 신호 — 알림 창 · 전역 틀 배지가 다시 그린다. 밀어 받기가 이벤트를 받으면 바로 다시 읽는다
  const alarmSig = () => { try { window.dispatchEvent(new Event('terra-alarms')); } catch {} };
  const stopLive = () => { whoSeq++; clearTimeout(whoT); if (push) { push.stop(); push = null; } if (alarms) { alarms.stop(); alarms = null; } clearInterval(topoTimer); topoTimer = 0; window.TerraAlarms = []; window.TerraAlarmBook = null; if (window.TerraMetrics) window.TerraMetrics.clear(); alarmSig(); };
  // 노드 기록(상태 · 하트비트 · 자원)은 로그인 때 한 번만 받으면 낡는다 — 30초마다 다시(보일 때만). 노드 목록이 같으면(rev 같음) 기록만 바꿔 끼우고 씬은 다시 짓지 않는다
  //   window.TerraTopologyState = { state: 'ok'|'empty'|'error', error?, at } — 못 받았을 때 화면이 시안 지도를 실제처럼 두지 않고 "받지 못함 / 노드 없음"을 보일 신호('terra-topology-state' 이벤트도)
  const refreshTopology = () => loadTopologyState(terra).then((r) => {
    window.TerraTopologyState = { state: r.state, error: r.error || '', at: r.at }; try { window.dispatchEvent(new Event('terra-topology-state')); } catch {}
    const t = r.topo; if (!t) { if (r.state === 'empty' && window.TerraTopology.count) setTopology(buildTopology([], { rev: 'none' })); return; }   // 받았고 비었다 — 옛 노드를 지운다(못 받음이면 마지막 사본을 둔다)
    if (t.records && window.TerraMetrics.ingest(t.records(), r.at) > 0) { try { window.dispatchEvent(new Event('terra-metrics')); } catch {} }   // 자원 추이 — 받은 하트비트 스냅샷을 노드마다 쌓는다(같은 하트비트는 하나로). 새 점이 없으면 알리지 않는다(다시 그릴 것이 없다)
    const cur = window.TerraTopology; if (cur && cur.rev === t.rev && cur.localId === t.localId) window.TerraTopology = t; else setTopology(t);
  }, () => {});
  window.TerraTopologyRetry = refreshTopology;   // 상단 줄의 '다시 시도'
  const TOPO_MS = 30000;   // 지도 · 대상 표 갱신 주기 — 탭이 보일 때만(숨겨진 탭은 Master 를 두드리지 않고, 다시 보이면 바로 한 번)
  window.TerraMetrics = createMetrics({ pollMs: TOPO_MS });   // 전역 틀 대상 표의 그래프 — 하트비트 스냅샷 점열(src/api/metrics.js). 실시간 지표 op 는 코어에 없다
  const topoTick = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshTopology(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (topoTimer && document.visibilityState === 'visible') refreshTopology(); });
  const pcLogout = () => { try { pcLogout0(window, window.localStorage); } catch {} };   // 로그아웃 세 길 공용 — 타이머 취소 신호 → 터미널 기록 삭제 → TerraWho = null (토큰 갱신은 부르지 않는다)
  // whoami — 일시 실패하면 쓰기 단추가 세션 내내 잠기므로(권한을 모르면 닫는다) 3 · 10 · 30초 뒤 다시 묻고, 받으면 'terra-who' 로 화면을 다시 그리게 한다
  const WHO_RETRY = [3000, 10000, 30000]; let whoT = 0, whoSeq = 0;
  const askWho = (n) => {
    clearTimeout(whoT); const my = ++whoSeq;
    terra.invoke('terra.gateway.agent.whoami.get', {}).then((w) => { if (my !== whoSeq) return; try { setWho(window, window.localStorage, w, () => window.TerraNodes && window.TerraNodes.clear && window.TerraNodes.clear()); } catch { window.TerraWho = w; } try { window.dispatchEvent(new Event('terra-who')); } catch {} },
      () => { if (my !== whoSeq) return; window.TerraWho = null; if (n < WHO_RETRY.length) whoT = setTimeout(() => askWho(n + 1), WHO_RETRY[n]); });
  };
  const afterLogin = () => {
    loadRoutes(); loadApps(); stopLive();
    askWho(0);   // 계정 탭 — principal · 권한 · Terra ID 연결의 사용자 id
    alarms = startAlarms({ terra, onAlarm: (a) => say(a.g + ' ' + a.m), onChange: alarmSig }); window.TerraAlarms = alarms.list; window.TerraAlarmBook = alarms.book; alarmSig();
    topoTimer = setInterval(topoTick, TOPO_MS); refreshTopology();
    push = startPush({ terra, store: () => window.TerraNodes, onEvent: () => alarms && alarms.poke() });
  };
  const SC = boardDef('Scene');
  let sceneOut = null;   // 보드의 원래 로그아웃(로그인 층을 전환을 거꾸로 해 다시 올린다)
  if (SC && SC.Logic.prototype.sceneLogout && !SC.Logic.__terraOut) { const out = sceneOut = SC.Logic.prototype.sceneLogout; SC.Logic.prototype.sceneLogout = function (...a) { if (MODE === 'app') { const back = signedIn(); appLogout(); return back ? out.apply(this, a) : undefined; } if (MODE === 'shell') session.logout(); pcLogout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; window.TerraLoginRoutesErr = ''; stopLive(); return out.apply(this, a); }; SC.Logic.__terraOut = true; }
  // A 모드의 로그인 · 로그아웃 — 웹은 비밀번호를 받지 않는다. 첫 화면은 B 와 같은 로그인 보드(TERRA 연출)다:
  //   셸 칸이 있으면 보드의 폼 + 셸 칸으로 로그인(§1-2) · 없으면(이전 Terra) TERRA 를 누르면 emit('login') → Scene 의 /login 카드 → / 로 돌아와 frame 이 새로 서고 토큰이 든 init
  //   토큰이 있으면(셸 세션 · 이미 로그인) 연출을 잠깐 보인 뒤 폼 없이 워프로 트리 뷰
  //   로그아웃 → emit('logout') — 그 Scene 이 쥔 Handle 이 있을 때만(session.state, node-gui 와 같은 규칙) — 그리고 로그인 층을 거꾸로. 셸 세션의 토큰이면 셸에서 로그아웃한다
  const signedIn = () => { const v = frame && frame.value && frame.value(); return !!(v && v.state === 'signedIn'); };
  const appLogout = () => {
    pcLogout(); if (window.TerraNodes && window.TerraNodes.clear) window.TerraNodes.clear(); window.TerraTopology = null; window.TerraLoginRoutes = null; window.TerraLoginRoutesErr = ''; stopLive();
    if (frame && signedIn()) { frame.emit('logout'); if (rememberedOf(frame)) frame.remember.forget(); }   // 로그아웃은 기억도 지운다(Gateway 는 그 세션의 기억을 이미 지운다 — 여기는 이 웹이 쥔 id 사본)
    else say('셸 로그인 세션 — 로그아웃 : 셸에서');
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
    frame = f; if (!f) { say('셸 응답 없음 — Terra 데이터 없음'); return; }
    const sec = hostSecretOf(f);
    if (sec) bindHostSecret({ secret: sec, login: () => window.__terra && window.__terra.login(), scene: () => window.__terra && window.__terra.scene, wanted: () => { const lg = window.__terra && window.__terra.login(); return !f.token() && !rememberedMode(f, lg && lg.state); } });   // 토큰이 있으면(이미 로그인) · 기억으로 들어갈 자리면 칸을 두지 않는다
    let had = !!f.token();
    if (f.onToken) f.onToken((tok) => {   // 토큰이 바뀌면 — 로그아웃 · 처음 로그인은 앞의 사본을 버린다. 같은 사람의 갱신은 버리지 않는다(저장 중인 바탕 구성이 사라지지 않게): 사람이 달라졌을 때만
      if (tok && had) {
        const prev = window.TerraWho && window.TerraWho.principal, v = f.value && f.value(), vp = v && typeof v.principal === 'string' ? v.principal : '';
        const swap = () => { if (window.TerraNodes) window.TerraNodes.clear(); };
        if (vp) { if (prev && vp !== prev) { swap(); terra.invoke('terra.gateway.agent.whoami.get', {}).then((w) => { window.TerraWho = w; }, () => {}); } }
        else terra.invoke('terra.gateway.agent.whoami.get', {}).then((w) => { if (!w) return; if (prev && w.principal && w.principal !== prev) swap(); window.TerraWho = w; }, () => {});   // 못 물으면 지우지 않는다
        return;
      }
      if (window.TerraNodes) window.TerraNodes.clear();
      if (tok && !had) { appSignedIn(); if (!sec) autoWarp(); }
      else if (tok && !window.TerraWho) askWho(0);   // 토큰 갱신 때 TerraWho 가 비어 있으면 다시 묻는다   // 셸 칸으로 한 로그인은 hostLogin 이 워프한다
      else if (!tok) { pcLogout(); stopLive(); showLogin(); }
      had = !!tok;
    });
    if (had) { appSignedIn(); autoWarp(); say('앱 모드 · 셸 앱 토큰'); }
  });
} else say('목업 · 시안 데이터 (Terra 없음)');

// 첫 화면은 모드와 상관없이 로그인 보드다(A 모드도 — 로그인 뒤 워프로 트리 뷰)
const host = mountBoard('Scene', document.getElementById('app'), {});
window.__terra = { mode: MODE, frame: () => frame, host, scene: host.logic, terra, session, transport, login: () => { const L = boardDef('Login'); return L && L.Logic.last; } };   // 연기 시험 · 개발 도구용
