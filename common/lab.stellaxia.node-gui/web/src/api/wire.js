// 화면(src/screens/node.js)과 데이터 소스를 잇는다. 화면 코드는 고치지 않고 연동 지점(seam)만 바꿔 끼운다.
//   seam: hbSeed(node, app) · hbItems(node, app) · hbPut(node, app, list) · hbAct(app, id, op, node) · hbFormSave() · hbDel(app, id, node) · hbSay(text, color)
// 세계(노드 · tree · 알림 · 폴더 · 네트워크 요약)는 실데이터 층(src/data/node-live.js)이 채운다.
// 길은 하나다 — frame 안: Terra 셸이 terra.web/frame으로 감쌌다 → frame이 준 스코프 토큰으로 이 노드의 게이트웨이를 부른다.
// 단독 실행(npm run dev · 정적 서버)에는 닿을 Terra가 없다 — 빈 세계(데이터 없음) 그대로 둔다. 예시로 채우지 않는다.

import { TerraClient, resultText, trackJob } from './client.js';
import { LiveSource, appFor } from './source.js';
import { TRACK, TASK_STATE } from './operations.js';
import { frameReady, role } from './frame-boot.js';
import { wireFrameSession } from './frame-session.js';
import { wireFrameBoards } from './frame-boards.js';
import { loadWorld, loadAlarms, loadNet, resetWorld } from '../data/node-live.js';
import { liveHub } from '../data/live-host.js';
import { loadConfig } from './config.js';

const GREEN = '#1f7a4d', RED = '#d33d52', GRAY = '#5b6472', AMBER = '#a65f00';

/** 보관함 칸 id('공유 폴더/상대 경로')의 위 칸 — 맨 위 칸(공유 폴더)이면 '' */
const parentOf = (id) => { const s = String(id || ''); return s.indexOf('/') < 0 ? '' : s.slice(0, s.lastIndexOf('/')); };
/** 항목의 이름 — 글줄용 */
const nameOf = (it) => (it && (it.name || it.cmd || it.who || it.from || it.id)) || '';

/**
 * @param {any} screen  mount()가 돌려준 화면 객체 (window.__screen)
 * @param {import('./source.js').HelmSource} source
 * @param {{ pollMs?: number }} [opts]  다시 받는 간격 (public/config.json pollSec)
 * @returns {() => void} 끊기 — 바꿔 끼운 seam을 되돌리고 받아 둔 목록을 지운다
 */
export function wireHelm(screen, source, opts = {}) {
  const every = Math.max(5000, opts.pollMs || 10000);
  if (source.mock) return () => {};
  const loading = new Set();
  const orig = { hbSeed: screen.hbSeed, hbAct: screen.hbAct, hbFormSave: screen.hbFormSave, hbDel: screen.hbDel };
  // 1) 받아 오기 전엔 빈 목록 + 글줄
  screen.hbSeed = () => [];
  // 목록을 볼 권한이 없으면 부르지 않는다 — 화면이 자물쇠와 이유를 그린다
  const canSee = (node, app) => {
    const A = screen.HBAPP ? screen.HBAPP()[app] : null;
    return !A || screen.hbPerm(node).has.indexOf(A.see) >= 0;
  };
  // 폴더 앱이 읽어야 할 경로 — 보고 있는 경로 + 맵에 설치한 폴더 · 파일 자원 · 상태 화면이 보는 항목의 위 칸.
  // 폴더 목록은 경로마다 한 겹씩이라 그 경로를 읽지 않으면 그 항목이 목록에서 빠진다("원본 목록에서 사라짐")
  const folderPaths = (node, first) => {
    const out = [first != null ? first : screen.state.hbPath || ''];
    Object.values(screen.state.rsrc || {}).forEach((o) => { if (o && o.node === node && o.app === 'folder') out.push(parentOf(o.id)); });
    const R = screen.state.rst;
    if (R && R.kind === 'res' && R.node === node && R.app === 'folder') out.push(parentOf(R.id));
    return [...new Set(out)];
  };
  // 2) 목록 받기 → 화면 저장소(hbd)에 넣는다. 화면은 hbItems로 읽으니 따로 고칠 것이 없다
  let live = true;
  const load = async (node, app, quiet, path) => {
    const key = node + '|' + app;
    if (loading.has(key) || !canSee(node, app)) return;
    loading.add(key);
    if (!quiet) screen.hbSay('불러오는 중…', GRAY);
    try {
      const list = await source.list(node, app, { path: app === 'folder' ? folderPaths(node, path) : path != null ? path : screen.state.hbPath });
      if (!live) return;
      screen.hbPut(node, app, list);
      if (!quiet) screen.setState({ hbMsg: null });
    } catch (r) { if (live) screen.hbSay(r && r.kind ? resultText(r) : String(r), RED); }
    finally { loading.delete(key); }
  };
  // 접수된 작업(202)이면 끝날 때까지 쫓고, 아니면 바로 목록을 다시 받는다
  const after = (r, node, app, item) => {
    if (r.kind === 'accepted' && r.job && source.client) {
      const T = TRACK[r.where === 'T' ? 'T' : 'L'];
      trackJob(source.client, T.op, r.job, null, T.key).then((fin) => {
        if (!live) return;
        const st = fin && fin.kind === 'ok' && fin.data ? fin.data.status || fin.data.state : null;
        if (st) screen.hbSay((nameOf(item) ? nameOf(item) + ' · ' : '') + (TASK_STATE[st] || st), /fail|dead|timed/.test(st) ? RED : GREEN);
        load(node, app, true);
      });
    } else load(node, app, true);
  };
  // 값을 적어야 하는 동작(+ 선언 · + 허가 · + 즉석 열기 · + 실행 · 다시 선언) — 앱 전체 화면을 열고 그 폼을 띄운다
  const openForm = (app, mode, id, node, preset) => {
    if (screen.state.fs !== 'hb:' + app && screen.fsEnter) screen.fsEnter('hb:' + app);
    screen.hbFormOpen(app, mode, mode === 'edit' ? id : null, node, 'fs');
    if (preset && screen.state.hbForm) Object.keys(preset).forEach((k) => screen.hbFormSet(k, preset[k]));
  };
  // 3) 동작 → Gateway. 결과를 글줄로, 끝나면 목록을 다시 받는다 (접수된 작업이면 끝날 때까지 쫓는다)
  //    node 를 주면 그 노드의 자원이다 — 상태 화면은 지금 맵이 아닌 노드의 자원도 다룬다
  const origAct = screen.hbAct.bind(screen);
  screen.hbAct = async (app, id, op, nodeArg) => {
    const node = nodeArg || screen.hbNode();
    if (app === 'folder' && op === 'open') { origAct(app, id, op, nodeArg); load(node, app, true); return; }   // 들어가기는 화면 이동 + 그 폴더 읽기
    if (app === 'wg' && op === 'revoke' && screen.state.hbArm !== id) return origAct(app, id, op, nodeArg);   // 두 번 누르기 확인은 화면이 맡는다
    if (screen.state.hbBusy) return;
    const spec = ((appFor(app, node === source.localNode) || { acts: {} }).acts || {})[op];
    if (spec && spec.form && screen.hbFormOpen) { screen.setState({ hbArm: null }); openForm(app, spec.form, id, node, spec.preset); return; }
    const item = screen.hbItems(node, app).find((x) => x.id === id);
    screen.setState({ hbBusy: id || app, hbArm: null });
    const r = await source.act(node, app, id, op, item, { path: screen.state.hbPath });
    if (!live) return;
    screen.setState({ hbBusy: null });
    screen.hbSay(r.say || resultText(r), r.kind === 'ok' || r.kind === 'accepted' ? GREEN : RED);
    after(r, node, app, item);
  };
  // 4) 추가 · 수정(폼 저장) · 삭제(두 번 누름) → Gateway (operations.js HELM_CRUD).
  //    화면은 원래 자기 목록에 항목을 지어 넣는다(디자인 시연). 여기서는 지어내지 않는다 — 서버가 받은 것만 목록을 다시 받아 보인다.
  //    서버에 길이 없는 것(⚠)은 폼에 그렇다고 적고 아무것도 바꾸지 않는다
  if (source.crud && screen.hbFormSave && screen.hbDel) {
    const origSave = screen.hbFormSave.bind(screen), origDel = screen.hbDel.bind(screen);
    const nodeIdOf = (name) => { const n = screen.NET && screen.NET[name]; return (n && n.id) || null; };
    const formErr = (F, err) => screen.setState({ hbForm: Object.assign({}, F, { err }) });
    // 맵에 설치한 자원 · 상태 화면이 고친 항목을 따라간다 — 이름(장치 별명)과 칸 id(폴더 이름 바꾸기)
    const retarget = (node, app, from, to, name) => {
      const R = screen.state.rsrc || {}, R2 = {};
      let ch = false;
      Object.keys(R).forEach((k) => {
        const o = R[k];
        if (o && o.node === node && o.app === app && o.id === from) { R2[k] = Object.assign({}, o, { id: to }, name ? { name } : {}); ch = true; } else R2[k] = o;
      });
      const st = screen.state.rst, patch = ch ? { rsrc: R2 } : {};
      if (st && st.kind === 'res' && st.node === node && st.app === app && st.id === from) patch.rst = Object.assign({}, st, { id: to }, name ? { name } : {});
      if (Object.keys(patch).length) screen.setState(patch);
    };
    screen.hbFormSave = async () => {
      const F = screen.state.hbForm;
      if (!F || screen.state.hbBusy) return;
      if (!screen.hbCan(F.app, F.node).ok) return origSave();   // 자물쇠 글줄은 화면이 맡는다
      const item = F.mode === 'edit' ? (screen.hbItems(F.node, F.app) || []).find((x) => x.id === F.id) : null;
      if (F.mode === 'edit' && !item) { formErr(F, '목록에서 사라졌다 — 다시 받는다'); load(F.node, F.app, true); return; }
      const v = formValues(screen, F, item);
      if (v.err) { formErr(F, v.err); return; }
      screen.setState({ hbBusy: 'form' });
      const r = await source.crud(F.node, F.app, F.mode === 'add' ? 'create' : 'update', v.vals, item, { path: screen.state.hbPath, nodeIdOf });
      if (!live) return;
      screen.setState({ hbBusy: null });
      if (r === null) { formErr(F, '⚠ Gateway에 아직 이 동작의 길이 없다 — 화면에 지어 넣지 않았다'); return; }
      if (r.same) { screen.setState({ hbForm: null }); screen.hbSay('바뀐 것이 없다', GRAY); return; }
      if (r.kind !== 'ok' && r.kind !== 'accepted') { formErr(F, resultText(r)); return; }
      screen.setState({ hbForm: null });
      if (F.mode === 'edit') retarget(F.node, F.app, F.id, r.id || F.id, F.app === 'io' || F.app === 'folder' ? v.vals.name : '');
      screen.hbSay(r.say || nameOf(v.vals) + (F.mode === 'add' ? ' 추가' : ' 고침') + ' — ' + resultText(r), GREEN);
      after(r, F.node, F.app, v.vals);
    };
    screen.hbDel = async (app, id, node) => {
      const nd = node || screen.hbNode();
      if (screen.state.hbArm !== 'del:' + id || !screen.hbCan(app, nd).ok) return origDel(app, id, node);   // 첫 누름(확인 준비) · 자물쇠는 화면이 맡는다
      if (screen.state.hbBusy) return;
      const item = (screen.hbItems(nd, app) || []).find((x) => x.id === id);
      if (!item) { screen.setState({ hbArm: null }); return; }
      screen.setState({ hbBusy: id });
      const r = await source.crud(nd, app, 'del', null, item, { path: screen.state.hbPath, nodeIdOf });
      if (!live) return;
      screen.setState({ hbBusy: null });
      if (r === null) { screen.setState({ hbArm: null }); screen.hbSay('⚠ Gateway에 아직 이 동작의 길이 없다 — 지우지 않았다', AMBER); return; }
      if (r.kind !== 'ok' && r.kind !== 'accepted') { screen.setState({ hbArm: null }); screen.hbSay(resultText(r), RED); return; }
      // 항목이 사라지는 것이면 화면의 두 번째 누름 처리로 목록 · 맵 자리 · 연결을 걷는다. 상태만 바뀌는 것(취소 · 철회 · 중단)은 그대로 두고 다시 받는다
      if (r.keep) screen.setState({ hbArm: null }); else origDel(app, id, node);
      screen.hbSay(nameOf(item) + ' ' + (r.verb || '삭제') + (r.screen ? ' — 화면에서만 (서버에 남은 기록이 없다)' : ' — ' + resultText(r)), r.screen ? GRAY : AMBER);
      if (!r.screen) after(r, nd, app, item);
    };
  }
  // 5) 지금 보이는 앱 · 노드(폴더 앱은 경로까지)가 바뀌면 받고, 열려 있는 동안 pollSec(기본 10초)마다 다시 받는다
  // 6) 맵에 설치한 노드 자원(state.rsrc) · 상태 화면이 보는 자원 — 그 앱이 열려 있지 않아도 상태 점 · 이벤트 · 모니터링 값이 이어지게 같은 간격으로 받는다.
  //    화면은 원본 앱 목록(hbItems)에서 그 항목을 찾아 읽는다 — 받지 않으면 "원본 목록에서 사라짐"으로 보인다
  let last = '', lastAt = 0, rsAt = 0;
  const t = setInterval(() => {
    const app = screen.hbApp && screen.hbApp(), now = Date.now();
    const open = app ? screen.hbNode() + '|' + app : '';
    if (!app) last = '';
    else {
      const node = screen.hbNode(), key = open + (app === 'folder' ? '|' + screen.state.hbPath : '');
      if (key !== last) { last = key; lastAt = now; load(node, app); }
      else if (now - lastAt > every) { lastAt = now; load(node, app, true); }
    }
    if (now - rsAt > every) {
      rsAt = now;
      const seen = new Set([open]), R = screen.state.rst;
      const want = Object.values(screen.state.rsrc || {}).concat(R && R.kind === 'res' && screen.state.winOpen && screen.state.winOpen.rst ? [R] : []);
      want.forEach((o) => {
        const k = o && o.app ? o.node + '|' + o.app : '';
        if (!k || seen.has(k)) return;
        seen.add(k);
        load(o.node, o.app, true, o.app === 'folder' ? '' : undefined);   // 폴더는 '' + 설치한 칸들의 위 칸까지(folderPaths)
      });
    }
  }, 400);
  return () => {
    live = false;
    clearInterval(t);
    screen.hbSeed = orig.hbSeed;
    screen.hbAct = orig.hbAct;
    screen.hbFormSave = orig.hbFormSave;
    screen.hbDel = orig.hbDel;
    screen.setState({ hbd: {}, io: [], hbMsg: null, hbBusy: null, hbForm: null, hbArm: null });
  };
}

/**
 * 폼 값 — 화면의 저장(hbFormSave)과 같은 규칙으로 다듬고 확인한다: 글은 앞뒤 빈칸을 떼고, 수는 수로, 열쇠 칸(이름 · 명령 …)은 비면 안 된다
 * @returns {{ vals: any } | { err: string }}
 */
export function formValues(screen, F, item) {
  const C = screen.HBCRUD()[F.app], fields = screen.hbFields(F.app, item), v = Object.assign({}, F.vals);
  fields.forEach((f) => { if (f.type === 'num') v[f.k] = parseFloat(v[f.k]) || 0; else if (f.type === 'text') v[f.k] = String(v[f.k] == null ? '' : v[f.k]).trim(); });
  const keyF = item && item.type === 'bind' ? 'from' : C.key;
  if (!v[keyF]) return { err: (fields.find((f) => f.k === keyF) || { label: keyF }).label + '을(를) 넣으세요' };
  return { vals: v };
}

/**
 * node.html이 부른다(src/boot/module.js): frame 안이면 frame 토큰으로 연결한다.
 * 시작 화면이 구름 뒤에 미리 읽은 노드 화면(보드 자리)은 시작 화면의 frame 연결을 빌린다(frame-boot.js borrowFrame).
 * 밖(단독 실행)에는 닿을 Terra 가 없다 — 빈 세계 그대로 두고, 전체 화면 보드만 연다.
 */
export async function wireFromUrl(screen) {
  if (role === 'frame' || role === 'board') return wireFrame(screen);
  return wireFrameBoards(screen, { direct: true });   // 단독 — 데이터는 없고, 보드는 src 로 그대로 연다
}

/** 지금 자격이 실제로 쥔 권한과 주체 (게이트웨이 whoami — 요청한 것이 아니라 교집합의 결과).
 *  경로로 부른다 — invoke 로 부르면 호출자가 중계에서 빠진다(client.get) */
async function whoami(client) {
  const r = await client.get('/api/v1/agent/whoami');
  const d = r.kind === 'ok' && r.data ? r.data : {};
  return { principal: d.principal || '', permissions: Array.isArray(d.permissions) ? d.permissions : [] };
}

/**
 * frame 안. 토큰이 있는 동안만 실데이터에 붙는다.
 *
 * 토큰을 받으면: 카탈로그 → 이 노드 · tree · 자원(loadWorld) → 조타륜 앱(wireHelm, 진짜 로컬 노드 이름으로) → 알림 · 네트워크 폴링.
 * 토큰을 잃으면: 받아 둔 것을 다 지우고 빈 세계로 돌아간다 — 예시로 돌아가지 않는다.
 * 같은 창의 보드(네트워크 · 설정)는 liveHub 로 같은 클라이언트를 빌려 쓴다.
 */
async function wireFrame(screen) {
  const stopBoards = wireFrameBoards(screen);   // init을 기다리지 않는다 — 보드는 토큰 없이도 뜬다
  const hub = liveHub(window);
  const terra = await frameReady;
  if (!terra) return stopBoards;
  screen.__terra = terra;
  const session = wireFrameSession(screen, terra);

  // 토큰이 생기고 없어지거나 권한이 달라질 때만 다시 붙는다. 정기 갱신(만료 80%)은 토큰 문자열만 바뀐다.
  let unwire = null, key = '', timers = [];
  const stop = () => {
    if (unwire) { unwire(); unwire = null; }
    timers.forEach(clearInterval); timers = [];
  };
  const sync = async () => {
    const token = terra.token();
    const next = token ? terra.permissions().slice().sort().join(' ') || '-' : '';
    if (next === key) return;
    key = next;
    stop();
    if (!token) {
      if (screen.__real) resetWorld(screen);
      hub.set(null);
      return;
    }
    const client = new TerraClient('', { fetch: terra.fetch.bind(terra), delegated: true });
    try { await client.refreshCatalog(); } catch (e) { console.warn('[terra] catalog 실패 — 카탈로그 없이 진행', e); }
    if (key !== next) return;   // 그 사이 다시 바뀌었다
    const value = terra.value();
    const who = await whoami(client);
    const principal = (value && typeof value === 'object' && value.principal) || who.principal;
    const permissions = terra.permissions().slice();
    if (screen.__real) await loadWorld(screen, client, { permissions, principal });
    if (key !== next) return;
    const cfg = await loadConfig();
    if (key !== next) return;
    const source = new LiveSource(client, { localNode: screen.state.localNode.name, localId: screen.state.localNode.id });
    source.client = client;
    unwire = wireHelm(screen, source, { pollMs: cfg.pollSec * 1000 });
    if (screen.__real) timers.push(setInterval(() => { void loadAlarms(screen, client); }, cfg.pollSec * 1000), setInterval(() => { void loadNet(screen, client); }, cfg.pollSec * 3000));
    hub.set({ client, terra, permissions, principal, node: Object.assign({}, screen.state.localNode) });
  };
  const offToken = terra.onToken(() => { void sync(); });
  await sync();
  return () => { offToken(); stop(); hub.set(null); session.dispose(); stopBoards(); };
}
