// 연기 시험 — 구운 ../ui 를 Chromium 으로 열어 씬 보드가 서는지(보드 · 렌더러 세 길 · 오류 없음), 로그인 · 창(제어기 · 모듈 상태 · 브라우저)이 도는지 본다.
//   B 모드는 가짜 Gateway(아래 gw)에 붙여 본다 — 자격 핸들 로그인 · 로컬/원격 노드 호출 · 끊김(PA) · 노드별 보기 상태
//   node tests/smoke.mjs   (npm run build 뒤에. 브라우저가 필요해 npm test 에 넣지 않는다)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('../../ui/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'";   // Gateway 앱 CSP(appAssetCSP) 와 같게
// 가짜 Gateway — 실제 길과 같은 주소 · 봉투. 핸들 없이 부르면 401
const GW = { offline: new Set(), calls: [], bodies: [], auth: [] };
const MODS = { modules: [{ id: 'io.terra.agent', name: 'Terra Agent', version: '0.3.1', kind: 'service', state: 'running', enabled: true }, { id: 'io.terra.real-only', name: 'Real Only', version: '1.0.0', kind: 'service', state: 'stopped', enabled: true }] };
const NODES = [{ node_id: 'tr_home', display_name: 'home', roles: ['tree'] }, { node_id: 'tr_lab', display_name: 'lab', roles: ['tree'], parent_node_id: 'tr_home' }, { node_id: 'nd_a', display_name: 'ws-a', roles: ['leaf'], parent_node_id: 'tr_home' }, { node_id: 'nd_b', display_name: 'ws-b', roles: ['leaf'], parent_node_id: 'tr_home' }, { node_id: 'nd_c', display_name: 'cam', roles: ['leaf'], parent_node_id: 'tr_lab' }];
const DATA = { 'terra.master.nodes.get': { nodes: NODES }, 'terra.daemon.status.get': { daemon: { node_id: 'nd_a' } }, 'terra.master.crossboundary.login-routes.get': { routes: [{ node_id: 'tr_lab', direction: 'child', needs_resolve: true }] }, 'terra.master.crossboundary.login-routes.by-node-id.resolve.post': { login_url: '/index.html?demo&tree=lab' }, 'terra.daemon.modules.get': MODS, 'terra.daemon.config.get': { config: { daemon: { device_name: 'real-leaf' } } }, 'terra.daemon.tasks.get': { tasks: [{ ID: 't-1', Type: 'process.execute', State: 'running' }] } };
async function gw(req, res, path) {
  const send = (st, body) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; for await (const c of req) body += c; const inp = body ? JSON.parse(body) : {};
  if (path === '/api/v1/auth/credentials') { if (req.method === 'DELETE') return send(200, { status: 'ok', data: { revoked: true } }); return inp.password === 'pw' ? send(200, { status: 'ok', data: { handle: 'h-smoke', session: { principal: 'u', displayName: 'admin' } } }) : send(401, { status: 'error', error: { code: 'CREDENTIAL_REJECTED', message: 'rejected' } }); }
  GW.auth.push(req.headers.authorization || '');
  if (req.headers.authorization !== 'Handle h-smoke' && req.headers.authorization !== 'Bearer tsa_smoke') return send(401, { status: 'error', error: { code: 'UNAUTHENTICATED', message: 'no session' } });
  GW.calls.push(req.method + ' ' + path);
  if (path.startsWith('/api/v1/streams/')) return send(501, { status: 'error', error: { code: 'STREAM_UNAVAILABLE', message: 'no streams here' } });   // 밀어 받기 없이 — TTL 로 돈다
  GW.bodies.push([path, inp]);
  if (path.startsWith('/api/v1/me/documents')) return send(200, { status: 'ok', data: req.method === 'GET' ? { documents: [] } : { revision: 1, created: true } });
  const m = path.match(/^\/api\/v1\/(?:nodes\/([^/]+)\/)?operations\/([^/]+)\/invoke$/); if (!m) return send(404, { status: 'error', error: { code: 'NOT_FOUND' } });
  const node = m[1] && decodeURIComponent(m[1]), op = decodeURIComponent(m[2]);
  if (node && GW.offline.has(node)) return send(409, { status: 'error', error: { code: 'NODE_OFFLINE', message: 'target node is offline', retryable: true } });
  return send(200, { status: 'ok', data: DATA[op] || {} });
}
const server = createServer(async (req, res) => {
  { const u = new URL(req.url, 'http://x').pathname; if (u.startsWith('/api/')) return gw(req, res, u);
    // 가짜 셸(A 모드) — localhost 의 이 문서가 127.0.0.1(다른 origin)의 앱을 감싸고, hello 에 init(앱 토큰)으로 답한다
    if (u === '/__shell.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<!doctype html><body style="margin:0"><iframe id="f" src="http://127.0.0.1:${server.address().port}/index.html" style="border:0;width:1280px;height:800px"></iframe><script>addEventListener('message',(e)=>{if(e.data&&e.data.type==='terra.frame.hello'){window.__hello=true;e.source.postMessage({type:'terra.frame.init',token:'tsa_smoke',appId:'lab.stellaxia.gui-v3.web',moduleId:'lab.stellaxia.gui-v3',apiBase:'/api/modules/lab.stellaxia.gui-v3',permissions:['node.read']},e.origin);}if(e.data&&e.data.type==='terra.frame.refresh'){e.source.postMessage({type:'terra.frame.token',token:'tsa_smoke',permissions:[]},e.origin);}});</script></body>`); } }
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  try { const body = await readFile(join(root, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'content-security-policy': CSP }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409|501)\b/.test(m.text())) errors.push(m.text()); });   // 401 · 409 · 501 은 시험이 일부러 낸 답(틀린 비밀번호 · 끊긴 노드 · 스트림 없음)
let fail = 0;
const ok = (c, msg) => { if (!c) fail++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + msg); };
// 렌더러 세 길 — 기본(Worker · WebGL2) · 메인 스레드 · GPU 없이
for (const qs of ['?demo', '?demo&render=main', '?demo&gl=2d&render=main']) {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html${qs}`);
  await page.waitForFunction(() => window.__terra && window.__terra.scene.__gpu && window.__terra.scene.__gpu.host, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const H = window.__terra.scene.__gpu.host; return { kind: H.kind, mode: H.mode, boards: document.querySelectorAll('.sc-host').length }; });
  ok(r.kind !== 'none' && r.boards >= 11, `${qs || '(기본)'} → ${r.kind} · ${r.mode} · 보드 ${r.boards}개`);
}
// 목업(?demo): 로그인 → 트리 뷰 → 창 (제어기 · 모듈 상태 · 브라우저)
await page.mouse.click(640, 420); await page.waitForTimeout(3500);
await page.locator('input[name=admin]').fill('admin'); await page.locator('input[name=password]').fill('pw'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
ok(true, '로그인 → 트리 뷰');
await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlOpenWin(s.gf_localNode()); });
await page.waitForTimeout(2500);
ok(await page.evaluate(() => getComputedStyle(document.querySelector('[data-ctlwin][data-slot="0"]')).display !== 'none'), '제어기 창');
await page.evaluate(() => { const s = window.__terra.scene, L = s.gf_localNode(), m = s.gf_modsOf(L).find((q) => q.apps.length && q.st === 'run'); s.gf_ctlOpenWin(L, undefined, 'mod', m.id); });
await page.waitForTimeout(2000);
await page.locator('[data-ctlwin][data-slot="16"] .ms-gui').first().click();
await page.waitForTimeout(3000);
ok(await page.evaluate(() => !!document.querySelector('[data-ctlwin][data-slot="19"] iframe')), '모듈 상태 › GUI ↗ → 브라우저 창');
// B 모드 — 가짜 Gateway 에 자격 핸들로
{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => window.__terra && window.__terra.transport && window.__terra.scene.__gpu && window.__terra.scene.__gpu.host, null, { timeout: 30000 });
  await page.waitForTimeout(800); await page.mouse.click(640, 420); await page.waitForTimeout(3500);
  await page.locator('input[name=admin]').fill('admin'); await page.locator('input[name=password]').fill('nope'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const L = window.__terra.login(); return L && L.state.msg && L.state.msg !== '확인 중…'; }, null, { timeout: 8000 }).catch(() => {});
  const msg = await page.evaluate(() => { const L = window.__terra.login(); return L && L.state.msg; });
  ok(/맞지 않아요/.test(msg || ''), 'B 모드 · 틀린 비밀번호 → ' + msg);
  await page.locator('input[name=password]').fill('pw'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
  ok(await page.evaluate(() => window.__terra.session.authorization() === 'Handle h-smoke'), 'B 모드 · 로그인 → 자격 핸들');
  const map = await page.evaluate(() => { const s = window.__terra.scene, M = s.sceneMap(); return { trees: M.all.filter((n) => n.kind === 'tree').map((n) => n.name + ':' + n.rid).join(','), leaves: M.all.filter((n) => n.kind === 'leaf').map((n) => n.name).join(','), local: s.gf_localNode().name }; });
  ok(map.trees === 'home:tr_home,lab:tr_lab' && map.leaves.split(',').sort().join(',') === 'cam,ws-a,ws-b' && map.local === 'ws-a', 'B 모드 · 지도 = Master 노드 목록 — ' + JSON.stringify(map));
  const head = () => page.evaluate(() => [...document.querySelectorAll('[data-ctlwin] [role=status]')].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\n/g, ' ')).join(' | '));
  await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlOpenWin(s.gf_localNode()); });
  await page.waitForTimeout(2500);
  ok(/로컬/.test(await head()), 'B 모드 · 로컬 제어기 — ' + (await head()).slice(0, 60));
  const mods = await page.evaluate(() => { const s = window.__terra.scene; return s.gf_modsOf(s.gf_localNode()).map((m) => m.id + ':' + m.st).join(','); });
  ok(/io\.terra\.real-only:stop/.test(mods), 'B 모드 · 노드 폴더 › 모듈 = 실제 응답 — ' + mods);
  ok(GW.calls.some((c) => c === 'POST /api/v1/operations/terra.daemon.modules.get/invoke'), 'B 모드 · 로컬 길 /api/v1/operations/…');
  await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlCloseAll(); const R = s.sceneMap().all.find((n) => n.name === 'ws-b'); window.__R = R; s.gf_ctlOpenWin(R); });
  await page.waitForTimeout(2500);
  ok(/원격/.test(await head()) && GW.calls.some((c) => c.startsWith('POST /api/v1/nodes/nd_b/operations/')), 'B 모드 · 원격 제어기 — 노드 주소 호출(nd_b) · ' + (await head()).slice(0, 60));
  GW.offline.add('nd_b');
  await page.evaluate(async () => { const T = window.TerraNodes; await T.refresh(window.__R.id, 'desk'); await T.refresh(window.__R.id, 'desk'); });   // 받던 것이 있으면 그것부터 끝내고, 끊긴 뒤에 한 번 더
  await page.waitForTimeout(800);
  ok(/끊김 · .*읽기 전용/.test(await head()), 'B 모드 · 끊김(PA) — 마지막 사본 · 읽기 전용 · ' + (await head()).slice(0, 70));
  // 제어기 편집 → operation — 로컬 노드 제어기 › 모듈 › 멈춤
  GW.offline.delete('nd_b');
  await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlCloseAll(); s.gf_ctlOpenWin(s.gf_localNode()); });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-ctlwin][data-slot]')) { if (el.style.display === 'none') continue; } });
  const stopped = await page.evaluate(async () => { const T = window.TerraNodes, s = window.__terra.scene, L = s.gf_localNode(); await T.refresh(L.id, 'desk'); const d = T.read(L.id, 'desk').data, m = d && d.mods.find((q) => q.st === 'run');
    if (!m) return 'no-run'; await T.write(L.id, 'terra.daemon.modules.by-module-id.stop.post', { module_id: m.id }, { res: 'desk', apply: (x) => x, refresh: true }); return m.id; });
  ok(GW.bodies.some(([p, b]) => p === '/api/v1/operations/terra.daemon.modules.by-module-id.stop.post/invoke' && b.module_id === stopped), 'B 모드 · 모듈 멈춤 → modules.by-module-id.stop.post(' + stopped + ')');
  await page.waitForTimeout(1200);
  ok(GW.calls.some((c) => c.startsWith('PUT /api/v1/me/documents/gui-v3/view/desk.')), 'B 모드 · 제어기 화면 배치 → 계정 문서(me/documents)');
  // 다른 Tree 로그인 — 자식 Tree(lab)는 주소를 물은 뒤 그 Tree 의 GUI 로 옮겨 간다
  await page.evaluate(() => { const s = window.__terra.scene, t = s.sceneMap().all.find((n) => n.rid === 'tr_lab'); s.gf_ctlCloseAll(); s.gf_loginOpen(t); });
  await page.waitForTimeout(2500);
  await page.locator('[data-ctlwin][data-slot="15"] button', { hasText: '주소 묻기' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const tl = '[data-ctlwin][data-slot="15"] ';
  await page.locator(tl + 'input[name=email]').fill('me@lab').catch(() => {}); await page.locator(tl + 'input[name=password]').fill('pw').catch(() => {});
  await page.locator(tl + 'button', { hasText: '⏎ Login' }).first().click();
  await page.waitForURL(/tree=lab/, { timeout: 8000 }).catch(() => {});
  ok(/tree=lab/.test(page.url()) && GW.calls.some((c) => c.includes('login-routes.by-node-id.resolve.post')), 'B 모드 · 다른 Tree 로그인 → 주소 묻기 → 그 Tree 의 GUI 로 (' + page.url().replace(/^.*\//, '') + ')');
}
// A 모드 — 셸 안의 모듈 앱: 로그인 층 없이, 앱 토큰(Bearer)으로, 보기 상태는 app 이름공간
{
  GW.auth.length = 0; GW.calls.length = 0;
  await page.goto(`http://localhost:${server.address().port}/__shell.html`);
  const app = page.frames().find((f) => f.url().includes('127.0.0.1')) || page.frameLocator('#f');
  let fr = null; for (let i = 0; i < 40 && !fr; i++) { await page.waitForTimeout(500); fr = page.frames().find((f) => /127\.0\.0\.1.*index\.html/.test(f.url())); }
  await fr.waitForFunction(() => window.__terra && window.__terra.frame() && window.__terra.scene, null, { timeout: 30000 });
  const st = await fr.evaluate(() => ({ mode: window.__terra.mode, login: window.__terra.scene.loginOn(), app: window.__terra.frame().appId }));
  ok(st.mode === 'app' && st.login === false && st.app === 'lab.stellaxia.gui-v3.web', 'A 모드 · 셸 안 → 로그인 층 없이 · 앱 ' + JSON.stringify(st));
  await page.waitForTimeout(2500);
  await fr.evaluate(() => { const s = window.__terra.scene; s.gf_ctlOpenWin(s.gf_localNode()); });
  await page.waitForTimeout(2500);
  ok(GW.auth.includes('Bearer tsa_smoke') && !GW.auth.some((a) => a.startsWith('Handle')), 'A 모드 · 앱 토큰(Bearer)으로만 부른다 — ' + [...new Set(GW.auth)].join(','));
  const map = await fr.evaluate(() => window.__terra.scene.gf_localNode().name);
  ok(map === 'ws-a', 'A 모드 · 지도 = 노드 목록, 로컬 ' + map);
  await page.waitForTimeout(1200);
  ok(GW.calls.some((c) => /^(GET|PUT) \/api\/v1\/me\/documents\/lab\.stellaxia\.gui-v3\.web/.test(c)) && !GW.calls.some((c) => c.includes('/me/documents/gui-v3')), 'A 모드 · 보기 상태 → 앱 이름공간 문서(app:<앱 id>)');
}
if (errors.length) { fail++; console.log('오류:', errors.join(' | ')); }
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
