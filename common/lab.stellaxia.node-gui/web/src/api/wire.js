// 화면(src/screens/node.js)과 데이터 소스를 잇는다. 화면 코드는 고치지 않고 연동 지점(seam)만 바꿔 끼운다.
//   seam: hbSeed(node, app) · hbItems(node, app) · hbPut(node, app, list) · hbAct(app, id, op) · hbSay(text, color)
//         beginSwitch(pick) (frame-session.js)
// 두 길:
//   frame 안   Terra 셸이 terra.web/frame으로 감쌌다 → frame이 준 스코프 토큰으로 이 노드의 게이트웨이를 부른다
//   단독 실행  node.html?live=1&gw=http://127.0.0.1:8790 → LiveSource (연습용 가짜 Gateway). 없으면 예시 데이터 그대로

import { TerraClient, resultText, trackJob } from './client.js';
import { LiveSource } from './source.js';
import { frameReady, role } from './frame-boot.js';
import { wireFrameSession } from './frame-session.js';
import { wireFrameBoards } from './frame-boards.js';

/**
 * @param {any} screen  mount()가 돌려준 화면 객체 (window.__screen)
 * @param {import('./source.js').HelmSource} source
 * @returns {() => void} 끊기 — 바꿔 끼운 seam과 예시 데이터를 되돌린다
 */
export function wireHelm(screen, source) {
  if (source.mock) return () => {};
  const loading = new Set();
  const orig = { hbSeed: screen.hbSeed, hbAct: screen.hbAct, io: screen.state.io };
  // 1) 예시 데이터를 끈다 — 받아 오기 전엔 빈 목록 + 글줄
  screen.hbSeed = () => [];
  // 2) 목록 받기 → 화면 저장소(hbd)에 넣는다. 화면은 hbItems로 읽으니 따로 고칠 것이 없다
  let live = true;
  const load = async (node, app, quiet) => {
    const key = node + '|' + app;
    if (loading.has(key)) return;
    loading.add(key);
    if (!quiet) screen.hbSay('불러오는 중…', '#5b6472');
    try {
      const list = await source.list(node, app);
      if (!live) return;
      screen.hbPut(node, app, list);
      if (!quiet) screen.setState({ hbMsg: null });
    } catch (r) { if (live) screen.hbSay(r && r.kind ? resultText(r) : String(r), '#d33d52'); }
    finally { loading.delete(key); }
  };
  // 3) 동작 → Gateway. 결과를 글줄로, 끝나면 목록을 다시 받는다 (작업이면 추적)
  const origAct = screen.hbAct.bind(screen);
  screen.hbAct = async (app, id, op) => {
    const node = screen.hbNode();
    if (app === 'folder' && op === 'open') return origAct(app, id, op);   // 폴더 들어가기는 화면 이동
    if (app === 'wg' && op === 'revoke' && screen.state.hbArm !== id) return origAct(app, id, op);   // 두 번 누르기 확인은 화면이 맡는다
    const item = screen.hbItems(node, app).find((x) => x.id === id);
    screen.setState({ hbBusy: id || app, hbArm: null });
    const r = await source.act(node, app, id, op, item);
    screen.setState({ hbBusy: null });
    screen.hbSay(resultText(r), r.kind === 'ok' || r.kind === 'accepted' ? '#1f7a4d' : '#d33d52');
    if (r.kind === 'accepted' && source.client) trackJob(source.client, 'terra.master.jobs.by-job-id.get', r.job).then(() => load(node, app, true));
    else load(node, app, true);
  };
  // 4) 지금 보이는 앱 · 노드가 바뀌면 받고, 열려 있는 동안 10초마다 다시 받는다 (tree는 폴링이 기본)
  let last = '', lastAt = 0;
  const t = setInterval(() => {
    const app = screen.hbApp && screen.hbApp(); if (!app) { last = ''; return; }
    const node = screen.hbNode(), key = node + '|' + app, now = Date.now();
    if (key !== last) { last = key; lastAt = now; load(node, app); }
    else if (now - lastAt > 10000) { lastAt = now; load(node, app, true); }
  }, 400);
  return () => {
    live = false;
    clearInterval(t);
    screen.hbSeed = orig.hbSeed;
    screen.hbAct = orig.hbAct;
    screen.setState({ hbd: {}, io: orig.io, hbMsg: null, hbBusy: null });
  };
}

/** node.html이 부른다: frame 안이면 frame 토큰으로, 밖이면 주소에 ?live=1 이 있을 때만 연결 */
export async function wireFromUrl(screen) {
  if (role === 'frame') return wireFrame(screen);
  const q = new URLSearchParams(location.search);
  if (q.get('live') !== '1') return null;
  const client = new TerraClient(q.get('gw') || 'http://127.0.0.1:8787');
  try { await client.refreshCatalog(); } catch (e) { console.warn('[terra] catalog 실패 — 카탈로그 없이 진행', e); }
  const source = new LiveSource(client, { localNode: screen.state.localNode.name });
  source.client = client;
  return wireHelm(screen, source);
}

/**
 * frame 안. 토큰이 있는 동안만 실데이터에 붙는다.
 *
 * 예시 맵의 로컬 노드(state.localNode)가 이 노드를 대신한다 — 조타륜 앱은 그 노드에서 이 게이트웨이의
 * Daemon operation을 부른다. 맵의 다른 노드는 예시이고, 다른 노드로 가는 operation 경로도 없다.
 */
async function wireFrame(screen) {
  const stopBoards = wireFrameBoards(screen);   // init을 기다리지 않는다 — 보드는 토큰 없이도 뜬다
  const terra = await frameReady;
  if (!terra) return stopBoards;
  screen.__terra = terra;
  const session = wireFrameSession(screen, terra);

  // 토큰이 생기고 없어지거나 권한이 달라질 때만 다시 붙는다. 정기 갱신(만료 80%)은 토큰 문자열만 바뀐다.
  let unwire = null, key = '';
  const sync = async () => {
    const token = terra.token();
    const next = token ? terra.permissions().slice().sort().join(' ') || '-' : '';
    if (next === key) return;
    key = next;
    if (unwire) { unwire(); unwire = null; }
    if (!token) return;
    const client = new TerraClient('', { fetch: terra.fetch.bind(terra), delegated: true });
    try { await client.refreshCatalog(); } catch (e) { console.warn('[terra] catalog 실패 — 카탈로그 없이 진행', e); }
    if (key !== next) return;   // 그 사이 다시 바뀌었다
    const source = new LiveSource(client, { localNode: screen.state.localNode.name });
    source.client = client;
    unwire = wireHelm(screen, source);
  };
  const offToken = terra.onToken(() => { void sync(); });
  await sync();
  return () => { offToken(); if (unwire) unwire(); session.dispose(); stopBoards(); };
}
