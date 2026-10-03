// 화면(src/screens/node.js)과 데이터 소스를 잇는다. 화면 코드는 고치지 않고 연동 지점(seam)만 바꿔 끼운다.
//   seam: hbSeed(node, app) · hbItems(node, app) · hbPut(node, app, list) · hbAct(app, id, op) · hbSay(text, color)
// 세계(노드 · tree · 알림 · 폴더 · 네트워크 요약)는 실데이터 층(src/data/node-live.js)이 채운다.
// 길은 하나다 — frame 안: Terra 셸이 terra.web/frame으로 감쌌다 → frame이 준 스코프 토큰으로 이 노드의 게이트웨이를 부른다.
// 단독 실행(npm run dev · 정적 서버)에는 닿을 Terra가 없다 — 빈 세계(데이터 없음) 그대로 둔다. 예시로 채우지 않는다.

import { TerraClient, resultText, trackJob } from './client.js';
import { LiveSource } from './source.js';
import { TRACK, TASK_STATE } from './operations.js';
import { frameReady, role } from './frame-boot.js';
import { wireFrameSession } from './frame-session.js';
import { wireFrameBoards } from './frame-boards.js';
import { loadWorld, loadAlarms, loadNet, resetWorld } from '../data/node-live.js';
import { liveHub } from '../data/live-host.js';

const GREEN = '#1f7a4d', RED = '#d33d52', GRAY = '#5b6472';

/**
 * @param {any} screen  mount()가 돌려준 화면 객체 (window.__screen)
 * @param {import('./source.js').HelmSource} source
 * @returns {() => void} 끊기 — 바꿔 끼운 seam을 되돌리고 받아 둔 목록을 지운다
 */
export function wireHelm(screen, source) {
  if (source.mock) return () => {};
  const loading = new Set();
  const orig = { hbSeed: screen.hbSeed, hbAct: screen.hbAct };
  // 1) 받아 오기 전엔 빈 목록 + 글줄
  screen.hbSeed = () => [];
  // 목록을 볼 권한이 없으면 부르지 않는다 — 화면이 자물쇠와 이유를 그린다
  const canSee = (node, app) => {
    const A = screen.HBAPP ? screen.HBAPP()[app] : null;
    return !A || screen.hbPerm(node).has.indexOf(A.see) >= 0;
  };
  // 2) 목록 받기 → 화면 저장소(hbd)에 넣는다. 화면은 hbItems로 읽으니 따로 고칠 것이 없다
  let live = true;
  const load = async (node, app, quiet) => {
    const key = node + '|' + app;
    if (loading.has(key) || !canSee(node, app)) return;
    loading.add(key);
    if (!quiet) screen.hbSay('불러오는 중…', GRAY);
    try {
      const list = await source.list(node, app, { path: screen.state.hbPath });
      if (!live) return;
      screen.hbPut(node, app, list);
      if (!quiet) screen.setState({ hbMsg: null });
    } catch (r) { if (live) screen.hbSay(r && r.kind ? resultText(r) : String(r), RED); }
    finally { loading.delete(key); }
  };
  // 3) 동작 → Gateway. 결과를 글줄로, 끝나면 목록을 다시 받는다 (접수된 작업이면 끝날 때까지 쫓는다)
  const origAct = screen.hbAct.bind(screen);
  screen.hbAct = async (app, id, op) => {
    const node = screen.hbNode();
    if (app === 'folder' && op === 'open') { origAct(app, id, op); load(node, app, true); return; }   // 들어가기는 화면 이동 + 그 폴더 읽기
    if (app === 'wg' && op === 'revoke' && screen.state.hbArm !== id) return origAct(app, id, op);   // 두 번 누르기 확인은 화면이 맡는다
    if (screen.state.hbBusy) return;
    const item = screen.hbItems(node, app).find((x) => x.id === id);
    screen.setState({ hbBusy: id || app, hbArm: null });
    const r = await source.act(node, app, id, op, item, { path: screen.state.hbPath });
    if (!live) return;
    screen.setState({ hbBusy: null });
    screen.hbSay(r.say || resultText(r), r.kind === 'ok' || r.kind === 'accepted' ? GREEN : RED);
    if (r.kind === 'accepted' && r.job && source.client) {
      const T = TRACK[r.where === 'T' ? 'T' : 'L'];
      trackJob(source.client, T.op, r.job, null, T.key).then((fin) => {
        if (!live) return;
        const st = fin && fin.kind === 'ok' && fin.data ? fin.data.status || fin.data.state : null;
        if (st) screen.hbSay((item && (item.name || item.cmd) ? (item.name || item.cmd) + ' · ' : '') + (TASK_STATE[st] || st), /fail|dead|timed/.test(st) ? RED : GREEN);
        load(node, app, true);
      });
    } else load(node, app, true);
  };
  // 4) 지금 보이는 앱 · 노드(폴더 앱은 경로까지)가 바뀌면 받고, 열려 있는 동안 10초마다 다시 받는다
  let last = '', lastAt = 0;
  const t = setInterval(() => {
    const app = screen.hbApp && screen.hbApp(); if (!app) { last = ''; return; }
    const node = screen.hbNode(), key = node + '|' + app + (app === 'folder' ? '|' + screen.state.hbPath : ''), now = Date.now();
    if (key !== last) { last = key; lastAt = now; load(node, app); }
    else if (now - lastAt > 10000) { lastAt = now; load(node, app, true); }
  }, 400);
  return () => {
    live = false;
    clearInterval(t);
    screen.hbSeed = orig.hbSeed;
    screen.hbAct = orig.hbAct;
    screen.setState({ hbd: {}, io: [], hbMsg: null, hbBusy: null });
  };
}

/** node.html이 부른다: frame 안이면 frame 토큰으로 연결한다. 밖(단독 실행)에서는 할 일이 없다 */
export async function wireFromUrl(screen) {
  if (role === 'frame') return wireFrame(screen);
  return null;
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
    const source = new LiveSource(client, { localNode: screen.state.localNode.name, localId: screen.state.localNode.id });
    source.client = client;
    unwire = wireHelm(screen, source);
    if (screen.__real) timers.push(setInterval(() => { void loadAlarms(screen, client); }, 10000), setInterval(() => { void loadNet(screen, client); }, 30000));
    hub.set({ client, terra, permissions, principal, node: Object.assign({}, screen.state.localNode) });
  };
  const offToken = terra.onToken(() => { void sync(); });
  await sync();
  return () => { offToken(); stop(); hub.set(null); session.dispose(); stopBoards(); };
}
