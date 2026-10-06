// 화면(src/screens/node.js)과 데이터 소스를 잇는다. 화면 코드는 고치지 않고 연동 지점(seam)만 바꿔 끼운다.
//   seam: hbSeed(node, app) · hbItems(node, app) · hbPut(node, app, list) · hbAct(app, id, op, node) · hbFormSave() · hbDel(app, id, node) · hbSay(text, color)
// 세계(노드 · tree · 알림 · 폴더 · 네트워크 요약)는 실데이터 층(src/data/node-live.js)이 채운다.
// 길은 하나다 — frame 안: Terra 셸이 terra.web/frame으로 감쌌다 → frame이 준 스코프 토큰으로 이 노드의 게이트웨이를 부른다.
// 단독 실행(npm run dev · 정적 서버)에는 닿을 Terra가 없다 — 빈 세계(데이터 없음) 그대로 둔다. 예시로 채우지 않는다.

import { TerraClient, resultText, trackJob } from './client.js';
import { LiveSource, appFor } from './source.js';
import { HELM_APPS, TRACK, TASK_STATE, logLines, cfgErrorKeys, sviOpenOp } from './operations.js';
import { wireSviStreams } from './svi-live.js';
import { frameReady, role } from './frame-boot.js';
import { wireFrameSession } from './frame-session.js';
import { wireFrameBoards } from './frame-boards.js';
import { loadWorld, loadAlarms, loadNet, resetWorld, applySignal } from '../data/node-live.js';
import { openEvents, EVENTS_OP } from './events.js';
import { liveHub } from '../data/live-host.js';
import { loadConfig } from './config.js';
import { openParts } from '../store/parts.js';

const GREEN = '#4ade80', RED = '#ff6b81', GRAY = '#8b95a6', AMBER = '#fbbf24', BLUE = '#60a5fa';

/** 보관함 칸 id('공유 폴더/상대 경로')의 위 칸 — 맨 위 칸(공유 폴더)이면 '' */
const parentOf = (id) => { const s = String(id || ''); return s.indexOf('/') < 0 ? '' : s.slice(0, s.lastIndexOf('/')); };
/** 항목의 이름 — 글줄용 */
const nameOf = (it) => (it && (it.name || it.cmd || it.who || it.from || it.id)) || '';

/**
 * @param {any} screen  mount()가 돌려준 화면 객체 (window.__screen)
 * @param {import('./source.js').HelmSource} source
 * @param {{ pollMs?: number, live?: () => boolean }} [opts]  pollMs — 다시 받는 간격 (public/config.json pollSec).
 *        live — 실시간 이벤트가 열려 있나. 열려 있으면 신호가 다시 받기를 맡고(_hbRefresh), 폴링은 여섯 배 느린 바닥으로 남는다
 * @returns {() => void} 끊기 — 바꿔 끼운 seam을 되돌리고 받아 둔 목록을 지운다
 */
export function wireHelm(screen, source, opts = {}) {
  const base = Math.max(5000, opts.pollMs || 10000);
  const period = () => (opts.live && opts.live() ? base * 6 : base);
  if (source.mock) return () => {};
  const loading = new Set(), loaded = new Set();
  const orig = { hbSeed: screen.hbSeed, hbAct: screen.hbAct, hbFormSave: screen.hbFormSave, hbDel: screen.hbDel, hbOpLock: screen.hbOpLock };
  let unwireOpen = null;   // 모듈 설정 폼 열기(hbFormOpen)를 바꿔 끼웠으면 되돌리는 함수
  // 1) 받아 오기 전엔 빈 목록 + 글줄
  screen.hbSeed = () => [];
  // 길 없는 동작은 누르기 전에 🔒 + 이유 (원본 hbOpLock — 카드 · 머리 버튼마다 부른다)
  if (source.lockFor) screen.hbOpLock = (app, op, node) => source.lockFor(app, op, node || screen.hbNode());
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
      let list = await source.list(node, app, { path: app === 'folder' ? folderPaths(node, path) : path != null ? path : screen.state.hbPath });
      if (!live) return;
      // 모듈 설정 폼이 보는 칸(item.cfg)은 목록에 없다 — 다시 받아도 붙여 둔 것을 잃지 않는다(열린 폼의 칸이 바뀌지 않게)
      if (app === 'mod') { const was = new Map((screen.hbItems(node, app) || []).filter((x) => x.cfg).map((x) => [x.id, x.cfg])); if (was.size) list = list.map((x) => (was.has(x.id) ? Object.assign({}, x, { cfg: was.get(x.id) }) : x)); }
      screen.hbPut(node, app, list);
      loaded.add(key);
      if (!quiet || (screen.state.hbMsg && screen.state.hbMsg.sticky === key)) screen.setState({ hbMsg: null });
    } catch (r) {
      if (!live) return;
      const t = r && r.kind ? resultText(r) : String(r);
      // 보고 있는 앱의 목록을 받지 못했다 — 화면 원본의 글줄(hbSay)은 2.6초 뒤 지워져 이유 없는 빈 목록 · 빈 흐름도만 남는다.
      // 그 앱을 보는 동안은 이유를 남겨 둔다(Master 에만 있는 SVI 자원 · 허가 — 앱 토큰은 닿지 않는다). 다시 받으면 지운다
      if (screen.hbApp && screen.hbApp() === app && screen.hbNode() === node) { clearTimeout(screen._hbT); screen.setState({ hbMsg: { t, c: RED, sticky: key } }); }
      else screen.hbSay(t, RED);
    }
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
  // 파일 올리기 — 파일 고르기 → source.upload(조각 · 이어서 · 검사). 끝나면 전송 · 폴더 목록을 다시 받는다
  //   rec — 전송 앱 카드의 이어서: 멈춘 그 전송. 같은 파일(크기 · SHA-256)을 골라야 서버가 받은 곳부터 잇는다(MD-21)
  const pctOf = (n, of) => Math.floor(n / Math.max(1, of) * 100) + '%';
  const pickUpload = (node, rec) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f || !live) return;
      screen.setState({ hbBusy: 'xfer' });
      screen.hbSay('↑ ' + f.name + (rec ? ' 이어 올리는 중' : ' 올리는 중') + ' — ' + (rec ? pctOf(rec.off * f.size, f.size) : '0%'), BLUE);
      const r = await source.upload(node, f, '', (off) => { if (live) screen.hbSay('↑ ' + f.name + ' 올리는 중 — ' + pctOf(off, f.size), BLUE); }, rec ? { resume: rec } : {});
      if (!live) return;
      screen.setState({ hbBusy: null });
      const good = r && r.kind === 'ok' && !(r.data && r.data.verified === false);
      const at = rec ? rec.root + '/' + rec.path : 'share-0', from = r && r.from ? ' · ' + pctOf(r.from, f.size) + '부터 이어서' : '';
      screen.hbSay(good ? '↑ ' + f.name + ' 올림 — 검사 통과 (' + at + from + ')' : '↑ ' + f.name + ' — ' + (r ? resultText(r) : '실패'), good ? GREEN : RED);
      load(node, 'xfer', true);
      load(node, 'folder', true);
    };
    inp.click();
  };
  // 파일 받기 — source.download(조각 · 검사 · 이 브라우저에 받아 둔 만큼은 건너뛴다) → 브라우저 저장(a download — frame 은 allow-downloads).
  // 끝나면 전송 목록을 다시 받는다. opts.old — 전송 앱 카드의 이어서: 멈춘 그 받기(새로 열고 닫는다)
  const getFile = async (node, id, item, opts) => {
    const name = (item && item.name) || String(id).split('/').pop();
    screen.setState({ hbBusy: id });
    screen.hbSay('↓ ' + name + ' 받는 중 — 0%', BLUE);
    const r = await source.download(node, id, (off, size) => { if (live) screen.hbSay('↓ ' + name + ' 받는 중 — ' + (size ? pctOf(off, size) : Math.ceil(off / 1024) + ' KB'), BLUE); }, opts);
    if (!live) return;
    screen.setState({ hbBusy: null });
    if (r.kind !== 'ok' || !r.blob) { screen.hbSay('↓ ' + name + ' — ' + resultText(r), RED); load(node, 'xfer', true); return; }
    saveBlob(r.blob, r.name || name);
    screen.hbSay('↓ ' + name + ' 받음 — 검사 통과 (' + Math.max(1, Math.ceil(r.blob.size / 1024)) + ' KB' + (r.from ? ' · ' + pctOf(r.from, r.blob.size) + '부터 이어서' : '') + ')', GREEN);
    load(node, 'xfer', true);
  };
  // 3) 동작 → Gateway. 결과를 글줄로, 끝나면 목록을 다시 받는다 (접수된 작업이면 끝날 때까지 쫓는다)
  //    node 를 주면 그 노드의 자원이다 — 상태 화면은 지금 맵이 아닌 노드의 자원도 다룬다
  const origAct = screen.hbAct.bind(screen);
  screen.hbAct = async (app, id, op, nodeArg) => {
    const node = nodeArg || screen.hbNode();
    if (app === 'xfer' && op === 'push' && source.upload) { if (!screen.state.hbBusy) pickUpload(node); return; }
    // 멈춘 전송의 이어서 — 올리기는 같은 파일을 고르게 하고, 받기는 다시 받되 이 브라우저에 받아 둔 만큼은 건너뛴다(MD-21)
    if (app === 'xfer' && op === 'resume' && source.upload) {
      if (screen.state.hbBusy) return;
      const lock = source.lockFor ? source.lockFor(app, op, node) : null;
      if (lock) { screen.hbSay('🔒 ' + lock, AMBER); return; }
      const it = screen.hbItems(node, app).find((x) => x.id === id);
      if (!it || !it.path) return;
      if (it.dir === 'pull') void getFile(node, it.root + '/' + it.path, it, { old: it.id });
      else pickUpload(node, it);
      return;
    }
    if (app === 'folder' && op === 'get' && source.download) {
      if (screen.state.hbBusy) return;
      const lock = source.lockFor ? source.lockFor(app, op, node) : null;
      if (lock) { screen.hbSay('🔒 ' + lock, AMBER); return; }
      void getFile(node, id, screen.hbItems(node, app).find((x) => x.id === id));
      return;
    }
    if (app === 'folder' && op === 'open') { origAct(app, id, op, nodeArg); load(node, app, true); return; }   // 들어가기는 화면 이동 + 그 폴더 읽기
    if (app === 'wg' && op === 'revoke' && screen.state.hbArm !== id) return origAct(app, id, op, nodeArg);   // 두 번 누르기 확인은 화면이 맡는다
    if (screen.state.hbBusy) return;
    const spec = (((source.appFor ? source.appFor(app, node) : appFor(app, node === source.localNode)) || { acts: {} }).acts || {})[op];
    if (spec && spec.form && screen.hbFormOpen) { screen.setState({ hbArm: null }); openForm(app, spec.form, id, node, spec.preset); return; }
    const item = screen.hbItems(node, app).find((x) => x.id === id);
    screen.setState({ hbBusy: id || app, hbArm: null });
    const r = await source.act(node, app, id, op, item, { path: screen.state.hbPath });
    if (!live) return;
    screen.setState({ hbBusy: null });
    // 모듈 로그 · 작업 출력은 상태 화면의 출력 칸으로 (원본 hbShowOut)
    if (r.kind === 'ok' && screen.hbShowOut && ((app === 'mod' && op === 'log') || (app === 'job' && op === 'out'))) {
      screen.hbShowOut(node, app, id, nameOf(item) + (op === 'log' ? ' 로그' : ' 출력'), outText(op, r.data));
      screen.hbSay((op === 'log' ? '로그' : '출력') + ' — 상태 화면', GRAY);
      return;
    }
    screen.hbSay(r.say || resultText(r), r.kind === 'ok' || r.kind === 'accepted' ? GREEN : RED);
    // 흐름: 열자마자 붙는다 — read 핸들은 프레임 하나를 주고 곧 닫힌다(늦게 붙으면 상태만 받는다). svi-live.js
    if (app === 'svi' && op === 'open' && (r.kind === 'ok' || r.kind === 'accepted') && r.data && screen._sviPrime) {
      const it = item || { id };
      screen._sviPrime(node, it, r.data.handle_id || (r.data.handle || {}).handle_id, sviOpenOp(it));
    }
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
    // 모듈 설정(B-6 설정) — 수정 폼을 열기 전에 스키마 · 값을 받아 항목에 붙인다(item.cfg → 화면 hbFields 가 그 칸을 쓴다).
    // 설정을 선언하지 않은 모듈이면 붙이지 않는다 — 화면이 "설정을 선언하지 않은 모듈이다"라고 말한다.
    // 보기는 node.read, 저장은 module.manage★ — 화면 권한은 node.control 로 모듈 카드 단추를 열려고 module.manage 를 채워 넣으므로(node-live hbPerm)
    // 저장할 수 있는지는 토큰이 실제로 쥔 권한으로 본다
    const canManage = () => { const p = screen.__real && screen.__real.perms; return !Array.isArray(p) || p.indexOf('module.manage') >= 0; };
    const NO_MANAGE = '🔒 저장 — module.manage★ 권한 없음(기본 권한 밖 — 운영자가 따로 준다) · 값은 볼 수만 있다';
    if (source.modConfig && screen.hbFormOpen) {
      const origOpen = screen.hbFormOpen, ownOpen = Object.prototype.hasOwnProperty.call(screen, 'hbFormOpen');
      screen.hbFormOpen = async function (app, mode, id, node, where) {
        if (app !== 'mod' || mode !== 'edit') return origOpen.call(screen, app, mode, id, node, where);
        const nd = node || screen.hbNode();
        if (screen.state.hbBusy) return;   // 다른 동작이 도는 중 — 다른 누름처럼 기다리게 한다
        if (!screen.hbCan(app, nd).ok) return origOpen.call(screen, app, mode, id, node, where);   // 자물쇠는 화면이 말한다
        screen.setState({ hbBusy: 'cfg' });
        screen.hbSay('⚙ 설정 받는 중…', GRAY);
        const { r, cfg } = await source.modConfig(nd, id);
        if (!live) return;
        screen.setState({ hbBusy: null });
        if (!cfg && r.reason !== 'MODULE_CONFIG_UNDECLARED') { screen.hbSay('⚙ 설정 — ' + resultText(r), RED); return; }
        screen.hbPut(nd, 'mod', (screen.hbItems(nd, 'mod') || []).map((x) => (x.id === id ? Object.assign({}, x, { cfg }) : x)));
        screen.setState({ hbMsg: null });
        origOpen.call(screen, app, mode, id, node, where);
        if (cfg && cfg.invalid.length) screen.hbSay('⚠ 저장된 값이 스키마를 어긴다 — ' + cfg.invalid.map((k) => k.key).join(' · ') + ' (고치면 모듈이 시작한다)', AMBER);
        else if (cfg && cfg.restartPending) screen.hbSay('⚙ 바꾼 설정이 아직 반영되지 않았다 — 다음 시작에 반영', AMBER);
        else if (cfg && !canManage()) screen.hbSay('⚙ 설정을 볼 수만 있다 — 저장은 module.manage★ 권한이 있어야 한다', AMBER);
      };
      unwireOpen = () => { if (ownOpen) screen.hbFormOpen = origOpen; else delete screen.hbFormOpen; };
    }
    screen.hbFormSave = async () => {
      const F = screen.state.hbForm;
      if (!F || screen.state.hbBusy) return;
      if (!screen.hbCan(F.app, F.node).ok) return origSave();   // 자물쇠 글줄은 화면이 맡는다
      const item = F.mode === 'edit' ? (screen.hbItems(F.node, F.app) || []).find((x) => x.id === F.id) : null;
      if (F.mode === 'edit' && !item) { formErr(F, '목록에서 사라졌다 — 다시 받는다'); load(F.node, F.app, true); return; }
      if (F.app === 'mod' && item && item.cfg && !canManage()) { formErr(F, NO_MANAGE); return; }
      const v = formValues(screen, F, item);
      if (v.err) { formErr(F, v.err); return; }
      screen.setState({ hbBusy: 'form' });
      const r = await source.crud(F.node, F.app, F.mode === 'add' ? 'create' : 'update', v.vals, item, { path: screen.state.hbPath, nodeIdOf });
      if (!live) return;
      screen.setState({ hbBusy: null });
      if (r === null) { formErr(F, '⚠ Gateway에 아직 이 동작의 길이 없다 — 화면에 지어 넣지 않았다'); return; }
      if (r.same) { screen.setState({ hbForm: null }); screen.hbSay('바뀐 것이 없다', GRAY); return; }
      if (r.kind !== 'ok' && r.kind !== 'accepted') { const keys = cfgErrorKeys(r); formErr(F, resultText(r) + (keys ? ' — ' + keys : '')); return; }
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
    const app = screen.hbApp && screen.hbApp(), now = Date.now(), every = period();
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
  // 7) 실시간 신호(B-5) → 받아 둔 목록 다시 받기. node — 그 노드의 것만(없으면 모든 노드)
  screen._hbRefresh = (apps, node) => loaded.forEach((k) => {
    const i = k.lastIndexOf('|'), n = k.slice(0, i), a = k.slice(i + 1);
    if (apps.indexOf(a) >= 0 && (!node || node === n)) load(n, a, true);
  });
  // 8) SVI 흐름 칸 · 맵 도로 (maingui A-28 · 85e28ee) — src/api/svi-live.js. 상태 화면(SVI 자원)이 보는 자원 · 맵에서 연결된 자원에
  //    열린 핸들이 있으면 그 핸들의 status · frame SSE 를 받아 state.sviStream(흐름 칸) · state.sviFlow(도로 애니메이션)에 넣는다.
  //    예시 흐름(sviDemoTick)은 RealNode 가 껐다. SVI 목록 · 핸들은 Master op 라 앱 토큰으로는 받지 못한다(PF-1) — 열린 핸들이 없으니 열지 않는다
  const svOff = source.client ? wireSviStreams(screen, source, load) : () => {};
  return () => {
    live = false;
    clearInterval(t);
    svOff();
    delete screen.sviFlowCmd;   // svi-live 가 바꿔 끼운 흐름 칸 손잡이 — 화면 것으로 돌린다
    delete screen._sviPrime;
    delete screen._hbRefresh;
    screen.hbSeed = orig.hbSeed;
    screen.hbAct = orig.hbAct;
    screen.hbFormSave = orig.hbFormSave;
    screen.hbDel = orig.hbDel;
    screen.hbOpLock = orig.hbOpLock;
    if (unwireOpen) unwireOpen();
    screen.setState({ hbd: {}, io: [], hbMsg: null, hbBusy: null, hbForm: null, hbArm: null, hbOut: null, sviStream: null, sviFlow: {} });
  };
}

/** 받은 파일을 브라우저로 저장한다 — 이 문서에 a[download] 를 잠깐 붙여 누른다 */
export function saveBlob(blob, name, doc = globalThis.document) {
  if (!doc || !doc.createElement) return false;
  const url = URL.createObjectURL(blob), a = doc.createElement('a');
  a.href = url; a.download = name || 'download'; a.style.display = 'none';
  (doc.body || doc.documentElement).appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  return true;
}

/**
 * 출력 칸의 글 — 모듈 로그(게이트웨이 { logs } · Daemon { lines }) · 작업 기록.
 * 이 노드의 작업 기록(terra.daemon.tasks.by-task-id.get)은 명령 출력을 돌려주지 않는다 — 그렇다고 적는다(구현해야 할 것 PF-7)
 */
export function outText(op, d) {
  if (op === 'log') {
    const lines = logLines(d);
    return lines.length ? lines.join('\n') + (d.truncated ? '\n— 앞부분은 잘렸다' : '') : '(최근 로그 없음)';
  }
  const x = d || {}, o = x.output || x.result || {};
  if (o.stdout != null || o.stderr) return [o.stdout || '', o.stderr ? '— stderr —\n' + o.stderr : '', o.exit_code != null ? '— exit ' + o.exit_code : ''].filter(Boolean).join('\n');
  return [x.type ? '작업 ' + x.type : '', '상태 ' + (TASK_STATE[x.state || x.status] || x.state || x.status || '모름'),
    x.started_at ? '시작 ' + x.started_at : '', x.finished_at ? '끝 ' + x.finished_at : '',
    '— 출력: Daemon 작업 기록은 명령 출력을 돌려주지 않는다'].filter(Boolean).join('\n');
}

/**
 * 폼 값 — 화면의 저장(hbFormSave)과 같은 규칙으로 다듬고 확인한다: 글은 앞뒤 빈칸을 떼고, 수는 수로, 열쇠 칸(이름 · 명령 …)은 비면 안 된다
 * @returns {{ vals: any } | { err: string }}
 */
export function formValues(screen, F, item) {
  // 모듈 설정 폼은 칸이 스키마에서 온다 — 값은 글 그대로 cfgPatch 가 스키마 모양으로 옮긴다(비운 수 칸은 0 이 아니라 기본값으로 되돌리기다)
  if (F.app === 'mod' && item && item.cfg) return { vals: Object.assign({}, F.vals) };
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
 *  delegate — 이 토큰을 받은 앱 id. 사용자 문서 이름공간(app:<id>)이 이것으로 정해진다
 *  경로로 부른다 — invoke 로 부르면 호출자가 중계에서 빠진다(client.get) */
async function whoami(client) {
  const r = await client.get('/api/v1/agent/whoami');
  const d = r.kind === 'ok' && r.data ? r.data : {};
  return { principal: d.principal || '', permissions: Array.isArray(d.permissions) ? d.permissions : [], delegate: typeof d.delegate === 'string' ? d.delegate : '' };
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
  let unwire = null, key = '', timers = [], stopEvents = null;
  const stop = () => {
    if (stopEvents) { stopEvents(); stopEvents = null; }
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
    if (screen.__real) await loadWorld(screen, client, { permissions, principal, appId: who.delegate || (terra.appId || '') });
    if (key !== next) return;
    const cfg = await loadConfig();
    if (key !== next) return;
    // 다른 노드는 관계도의 node_id 로 노드 주소 호출(B-1)을 한다 — 그 노드 카탈로그가 오면 자물쇠를 다시 그린다
    const source = new LiveSource(client, { localNode: screen.state.localNode.name, localId: screen.state.localNode.id, idOf: (name) => (screen.NET && screen.NET[name] && screen.NET[name].id) || null, parts: openParts() });
    source.client = client;
    client.onNodeCatalog = () => { if (key === next) screen.setState({}); };
    // 실시간 이벤트(B-5)가 열려 있으면 신호가 다시 받기를 맡는다 — 폴링은 여섯 번에 한 번(바닥)만
    let ev = '';
    const live = () => ev === 'open';
    unwire = wireHelm(screen, source, { pollMs: cfg.pollSec * 1000, live });
    if (screen.__real) {
      const every = (ms, fn) => { let n = 0; timers.push(setInterval(() => { if (!live() || ++n % 6 === 0) fn(); }, ms)); };
      every(cfg.pollSec * 1000, () => { void loadAlarms(screen, client); });
      every(cfg.pollSec * 3000, () => { void loadNet(screen, client); });
      if (client.has(EVENTS_OP)) {
        stopEvents = openEvents(client, (e) => applySignal(screen, client, e), {
          onState: (st) => { ev = st; if (screen.__real && screen.__real.events !== st) { screen.__real.events = st; screen.setState({}); } }
        });
      }
    }
    hub.set({ client, terra, permissions, principal, node: Object.assign({}, screen.state.localNode) });
  };
  const offToken = terra.onToken(() => { void sync(); });
  await sync();
  return () => { offToken(); stop(); hub.set(null); session.dispose(); stopBoards(); };
}
