// 연기 시험 — 구운 ../ui 를 Chromium 으로 열어 씬 보드가 서는지(보드 · 렌더러 세 길 · 오류 없음), 로그인 · 창(제어기 · 모듈 상태 · 브라우저)이 도는지 본다.
//   B 모드는 가짜 Gateway(아래 gw)에 붙여 본다 — 자격 핸들 로그인 · 로컬/원격 노드 호출 · 끊김(PA) · 노드가 원본인 바탕 구성(가짜 Gateway 는 node-desk.get/patch 를 서버 규칙대로 상태를 들고 답한다: 노드별 revision · 키별 revs · 409 · 첫 쓰기 형태) — 브라우저 컨텍스트 둘(A · B)
//   node tests/smoke.mjs   (npm run build 뒤에. 브라우저가 필요해 npm test 에 넣지 않는다)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../../ui/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'";   // Gateway 앱 CSP(appAssetCSP) 와 같게
// 가짜 Gateway — 실제 길과 같은 주소 · 봉투. 핸들 없이 부르면 401
const GW = { offline: new Set(), calls: [], bodies: [], auth: [], patchDelay: 0, patchFail: 0, desk: {} };   // patchDelay — PATCH 응답을 늦춘다(서버는 먼저 적용) · patchFail — PATCH 가 이 HTTP 상태로 실패
// 가짜 노드 저장소 — 설계 §7 규칙 그대로(S1): 노드별 revision · 키별 revs · base 가 앞서면 409 · 첫 쓰기는 prefs 여섯 + icons
const deskOf = (rid) => GW.desk[rid] || (GW.desk[rid] = { revision: 0, doc: null, revs: {}, floor: 0 });
const PREFS = ['dark', 'wall', 'wallFit', 'dock', 'snap', 'anim'];
const deskApply = (N, set) => { const rev = ++N.revision; N.doc = N.doc || { icons: {}, prefs: {} }; for (const k of Object.keys(set)) { N.revs[k] = rev; if (k === 'wall') { if (set[k] === null) delete N.doc.wall; else N.doc.wall = set[k]; continue; } const i = k.indexOf('.'), g = k.slice(0, i), f = k.slice(i + 1); if (set[k] === null) delete N.doc[g][f]; else N.doc[g][f] = set[k]; } };
GW.other = (rid, set) => deskApply(deskOf(rid), set);   // 다른 PC 가 바꾼 것처럼 — 서버에 직접
function deskServe(rid, op, inp) {
  const N = deskOf(rid), err = (status, code, details) => ({ status, body: { status: 'error', error: { code, message: code, details } } });
  if (op.endsWith('node-desk.get')) return { status: 200, body: { status: 'ok', data: N.revision === 0 ? { revision: 0, doc: null } : inp.since_revision === N.revision ? { revision: N.revision, unchanged: true } : { revision: N.revision, doc: N.doc } } };
  const keys = Object.keys(inp.set || {}), bad = keys.filter((k) => (N.revs[k] ?? N.floor) > inp.base_revision);
  if (typeof inp.base_revision !== 'number') return err(400, 'INVALID_REQUEST');
  if (inp.base_revision > N.revision || bad.length) return err(409, 'REVISION_CONFLICT', { keys: bad.length ? bad : keys });
  if (N.revision === 0 && !(PREFS.every((f) => 'prefs.' + f in inp.set) && keys.some((k) => k.startsWith('icons.')))) return err(400, 'INVALID_REQUEST');
  deskApply(N, inp.set); return { status: 200, body: { status: 'ok', data: { revision: N.revision, doc: N.doc } } };
}
const MODS = { modules: [{ id: 'io.terra.agent', name: 'Terra Agent', version: '0.3.1', kind: 'service', state: 'running', enabled: true }, { id: 'io.terra.real-only', name: 'Real Only', version: '1.0.0', kind: 'service', state: 'stopped', enabled: true }] };
const NODES = [{ node_id: 'tr_home', display_name: 'home', roles: ['tree'] }, { node_id: 'tr_lab', display_name: 'lab', roles: ['tree'], parent_node_id: 'tr_home' }, { node_id: 'nd_a', display_name: 'ws-a', roles: ['leaf'], parent_node_id: 'tr_home' }, { node_id: 'nd_b', display_name: 'ws-b', roles: ['leaf'], parent_node_id: 'tr_home' }, { node_id: 'nd_c', display_name: 'cam', roles: ['leaf'], parent_node_id: 'tr_lab' }];
const DATA = { 'terra.master.nodes.get': { nodes: NODES, master_node_id: 'tr_home' }, 'terra.daemon.status.get': { daemon: { node_id: 'nd_a' } }, 'terra.master.crossboundary.login-routes.get': { routes: [{ node_id: 'tr_lab', direction: 'child', needs_resolve: true }] }, 'terra.master.crossboundary.login-routes.by-node-id.resolve.post': { login_url: '/index.html?demo&tree=lab' }, 'terra.daemon.modules.get': MODS, 'terra.daemon.config.get': { config: { daemon: { device_name: 'real-leaf' } } }, 'terra.daemon.tasks.get': { tasks: [{ ID: 't-1', Type: 'process.execute', State: 'running' }] }, 'terra.gateway.agent.whoami.get': { principal: 'user:smoke' } };
async function gw(req, res, path) {
  const send = (st, body) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; for await (const c of req) body += c; const inp = body ? JSON.parse(body) : {};
  if (path === '/api/v1/auth/credentials') { if (req.method === 'DELETE') return send(200, { status: 'ok', data: { revoked: true } }); return inp.password === 'pw' ? send(200, { status: 'ok', data: { handle: { id: 'h-smoke', issuer: 'gateway', expiresAt: '2099-01-01T00:00:00Z' }, session: { principal: 'u', displayName: 'admin' } } }) : send(401, { status: 'error', error: { code: 'CREDENTIAL_REJECTED', message: 'rejected' } }); }
  GW.auth.push(req.headers.authorization || '');
  if (req.headers.authorization !== 'Handle h-smoke' && req.headers.authorization !== 'Bearer tsa_smoke') return send(401, { status: 'error', error: { code: 'UNAUTHENTICATED', message: 'no session' } });
  GW.calls.push(req.method + ' ' + path);
  if (path.startsWith('/api/v1/streams/')) return send(501, { status: 'error', error: { code: 'STREAM_UNAVAILABLE', message: 'no streams here' } });   // 밀어 받기 없이 — TTL 로 돈다
  GW.bodies.push([path, inp]);
  if (path.startsWith('/api/v1/me/documents')) return send(200, { status: 'ok', data: req.method === 'GET' ? { documents: [] } : { revision: 1, created: true } });
  const m = path.match(/^\/api\/v1\/(?:nodes\/([^/]+)\/)?operations\/([^/]+)\/invoke$/); if (!m) return send(404, { status: 'error', error: { code: 'NOT_FOUND' } });
  const node = m[1] && decodeURIComponent(m[1]), op = decodeURIComponent(m[2]);
  if (node && GW.offline.has(node)) return send(409, { status: 'error', error: { code: 'NODE_OFFLINE', message: 'target node is offline', retryable: true } });
  if (op.startsWith('lab.stellaxia.gui-v3.node-desk.')) {   // 바탕 구성 — 노드마다 상태를 들고(로컬 길은 이 Gateway 의 노드 nd_a)
    const rid = node || 'nd_a', patch = op.endsWith('.patch');
    if (patch && GW.patchFail) return send(GW.patchFail, { status: 'error', error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    const r = deskServe(rid, op, inp);   // 서버는 먼저 적용하고
    if (patch && GW.patchDelay) await new Promise((ok) => setTimeout(ok, GW.patchDelay));   // 응답만 늦는다
    return send(r.status, r.body);
  }
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
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409|500|501)\b/.test(m.text())) errors.push(m.text()); });   // 401 · 409 · 500 · 501 은 시험이 일부러 낸 답(틀린 비밀번호 · 끊긴 노드 · 저장 실패 · 스트림 없음)
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
// 로그아웃 — 사람처럼: 로고에 올려 기본 정보를 펼치고, 아래 '로그아웃' 줄로 내려가 누른다(로고만 호버 자리이던 때는 내려가는 순간 접혀 누르기가 버려졌다)
{
  const at = await page.evaluate(() => { const s = window.__terra.scene, Z = s._q_zones.logo, cw = s._q_cw, ch = s._q_ch; return { lx: (Z.c0 + 2) * cw, ly: (Z.r0 + 1) * ch }; });
  await page.mouse.move(at.lx, at.ly); await page.waitForTimeout(1500);
  const lo = await page.evaluate(() => { const s = window.__terra.scene, Q = s._q_lo; return Q && { x: (Q.x0 + Q.x1) / 2, y: (Q.row + 0.5) * s._q_ch }; });
  await page.mouse.move(lo.x, at.ly, { steps: 3 }); await page.mouse.move(lo.x, lo.y, { steps: 6 }); await page.waitForTimeout(300);
  await page.mouse.click(lo.x, lo.y);
  await page.waitForFunction(() => window.__terra.scene.state.loginOn === true, null, { timeout: 8000 }).catch(() => {});
  ok(await page.evaluate(() => window.__terra.scene.state.loginOn === true), '로그아웃 줄 누르기 → 로그인 층');
  // 아래 창 시험은 로그인한 트리 뷰에서 — 새로 열어 다시 로그인한다
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?demo`);
  await page.waitForFunction(() => window.__terra && window.__terra.scene.__gpu && window.__terra.scene.__gpu.host, null, { timeout: 30000 });
  await page.waitForTimeout(800); await page.mouse.click(640, 420); await page.waitForTimeout(3500);
  await page.locator('input[name=admin]').fill('admin'); await page.locator('input[name=password]').fill('pw'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
}
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
  ok(/불일치/.test(msg || ''), 'B 모드 · 틀린 비밀번호 → ' + msg);
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
  ok(!GW.calls.some((c) => c.includes('/me/documents')), 'B 모드 · 제어기는 계정 문서(me/documents)를 부르지 않는다 — 창 배치는 이 브라우저(terra.pc.*) · 바탕 구성은 그 노드');
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
// 바탕 구성 — 노드가 원본(설계 node-owned-desk.md §7 · §10 · §11 · §12 · §14 · V1 · V2 · V3 · V4 · V5 · V10). 브라우저 컨텍스트 둘(A · B)이 같은 노드(nd_b)의 제어기를 연다.
//   가짜 Gateway 는 node-desk.get/patch 를 서버 규칙대로 들고 답한다 — 노드별 revision · 키별 revs · 409 · 첫 쓰기 형태
{
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409|500|501)\b/.test(m.text())) errors.push(m.text()); });
    return { ctx, pg };
  };
  const boot = (pg) => pg.waitForFunction(() => window.__terra && window.__terra.transport && window.__terra.scene.__gpu && window.__terra.scene.__gpu.host, null, { timeout: 30000 });
  const login = async (pg) => {
    await pg.goto(url); await boot(pg); await pg.waitForTimeout(800); await pg.mouse.click(640, 420); await pg.waitForTimeout(3500);
    await pg.locator('input[name=admin]').fill('admin'); await pg.locator('input[name=password]').fill('pw'); await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
  };
  const openCtl = async (pg) => { await pg.evaluate(() => { const s = window.__terra.scene, R = s.sceneMap().all.find((n) => n.name === 'ws-b'); s.gf_ctlOpenWin(R); }); await pg.waitForTimeout(2500); };
  const ico = (pg, name) => pg.evaluate((n) => { for (const sp of document.querySelectorAll('[data-ctlwin] [aria-label="바탕화면 아이콘"] span')) { const w = sp.closest('[data-ctlwin]'); if (w.style.display === 'none' || sp.textContent.trim() !== n) continue; const d = sp.parentElement, r = d.getBoundingClientRect(); return { left: d.style.left, top: d.style.top, op: getComputedStyle(d).opacity, x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; }, name);
  const bar = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-ctlwin] [role=status]')].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\n/g, ' ')).join(' | '));
  const cacheRev = (pg) => pg.evaluate(() => { try { const e = JSON.parse(localStorage.getItem('terra.cache') || '{}')['nd_b|nodedesk']; return e ? e.data.revision : null; } catch { return 'err'; } });
  const drag = async (pg, name, dx, dy) => { const a = await ico(pg, name); await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(a.x + dx / 2, a.y + dy / 2, { steps: 4 }); await pg.mouse.move(a.x + dx, a.y + dy, { steps: 4 }); await pg.mouse.up(); return a; };
  const patches = () => GW.calls.filter((c) => c.includes('node-desk.patch')).length;
  const A = await mk(), B = await mk(), pa = A.pg, pb = B.pg;
  try {
    // 이행(§14) — 옛 제어기 키 삭제는 처음 한 번
    await pa.goto(url); await boot(pa);
    await pa.evaluate(() => { localStorage.removeItem('terra.pc.migrated'); localStorage.setItem('terra.view.desk.T1', '{}'); localStorage.setItem('terra.view.desk.P1:ws', '{}'); localStorage.setItem('terra.wall.ws-a', 'x'); localStorage.setItem('terra.theme', 'dark'); });
    await pa.reload(); await boot(pa);
    const mg = await pa.evaluate(() => ({ old: Object.keys(localStorage).filter((k) => k.startsWith('terra.view.desk.') || k.startsWith('terra.wall.')), mig: localStorage.getItem('terra.pc.migrated'), theme: localStorage.getItem('terra.theme') }));
    ok(mg.old.length === 0 && mg.mig === '1' && mg.theme === 'dark', '이행 · 옛 terra.view.desk.* · terra.wall.* 삭제 + terra.pc.migrated, 다른 키는 그대로 — ' + JSON.stringify(mg));
    await pa.evaluate(() => localStorage.setItem('terra.view.desk.T9', 'again')); await pa.reload(); await boot(pa);
    ok(await pa.evaluate(() => localStorage.getItem('terra.view.desk.T9') === 'again'), '이행 · 두 번째부터는 지우지 않는다');
    await pa.evaluate(() => localStorage.removeItem('terra.view.desk.T9'));   // 아래 'PC 상태에 옛 키가 없다' 확인을 흐리지 않게
    await login(pa); await login(pb); await openCtl(pa); await openCtl(pb);
    await pa.waitForFunction(() => window.TerraNodes.deskRead('nd_b').state === 'empty', null, { timeout: 10000 }); await pb.waitForFunction(() => window.TerraNodes.deskRead('nd_b').state === 'empty', null, { timeout: 10000 });
    ok(/이 노드에 아직 저장 안 됨/.test(await bar(pa)) && deskOf('nd_b').revision === 0, 'V0 · 처음 쓰는 노드 — 기본값 · "이 노드에 아직 저장 안 됨" · 서버는 비어 있다 — ' + (await bar(pa)).slice(0, 80));
    ok(!!(await ico(pa, '내 폴더')) && !(await ico(pa, 'backup.tar')), 'V0 · 기본 아이콘은 보이고 시안 아이콘(backup.tar)은 없다');
    // V1 — 노드 먼저: 응답을 늦춰 놓고 아이콘을 옮긴다
    GW.patchDelay = 2500; const before = await ico(pa, '내 폴더'), p0 = patches();
    await pa.evaluate(() => window.TerraNodes.deskStop());   // 5초 폴링을 잠깐 멈춘다 — 서버가 이미 적용한 값을 폴링이 읽어 오면(그것은 노드 값이라 정당하다) '응답 전 사본 불변' 을 가를 수 없다
    await drag(pa, '내 폴더', 260, 150); await pa.waitForTimeout(900);
    const mid = await ico(pa, '내 폴더');
    ok(patches() === p0 + 1 && deskOf('nd_b').revision === 1, 'V1 · 드롭 한 번에 PATCH 하나, 서버가 먼저 적용(revision 1) — 응답은 아직');
    ok(mid.op === '0.5' && (mid.left !== before.left || mid.top !== before.top), 'V1 · 응답 전: 아이콘은 새 자리에 반투명(opacity ' + mid.op + ')');
    ok(await cacheRev(pa) === 0 && /그 노드에 저장 중…/.test(await bar(pa)), 'V1 · 응답 전: terra.cache 의 nodedesk 는 그대로(revision ' + await cacheRev(pa) + ') · "그 노드에 저장 중…"');
    await pa.waitForFunction(() => window.TerraNodes.deskRead('nd_b').save.state === 'saved', null, { timeout: 8000 }); await pa.waitForTimeout(700);
    const done = await ico(pa, '내 폴더'), t0 = Date.now();
    ok(done.op === '1' && done.left === mid.left && done.top === mid.top && /그 노드에 저장됨 · \d\d:\d\d:\d\d/.test(await bar(pa)) && await cacheRev(pa) === 1, 'V1 · 응답 뒤: 확정 · 반투명 해제 · "그 노드에 저장됨 · 시각" · 사본 revision 1 — ' + (await bar(pa)).slice(0, 70));
    GW.patchDelay = 0; await pa.evaluate(() => window.TerraNodes.deskStart());   // 폴링 다시
    // V2 — B 가 5초 안에 같은 값(첫 값이 빈 노드였다가 바뀐다)
    await pb.bringToFront();
    const ms = await pb.waitForFunction(([l, t]) => { for (const sp of document.querySelectorAll('[data-ctlwin] [aria-label="바탕화면 아이콘"] span')) { const w = sp.closest('[data-ctlwin]'); if (w.style.display === 'none' || sp.textContent.trim() !== '내 폴더') continue; return sp.parentElement.style.left === l && sp.parentElement.style.top === t; } return false; }, [done.left, done.top], { timeout: 8000, polling: 200 }).then(() => Date.now() - t0, () => -1);
    ok(ms >= 0 && ms <= 6500, 'V2 · B 도 같은 자리 — A 확정 뒤 ' + ms + 'ms (5초 + 왕복 안)');
    // V3 — 저장 실패(500): "저장 못 함 — 코드" 가 남고 원래 자리, 서버 revision 불변
    await pa.bringToFront(); GW.patchFail = 500;
    const jb = await ico(pa, '작업 관리자'), rev1 = deskOf('nd_b').revision;
    await drag(pa, '작업 관리자', 200, 120); await pa.waitForTimeout(1500);
    const ja = await ico(pa, '작업 관리자');
    ok(/저장 못 함 — \S+ · 다시 시도/.test(await bar(pa)) && ja.left === jb.left && ja.top === jb.top && ja.op === '1' && deskOf('nd_b').revision === rev1, 'V3 · 패치 실패 — "저장 못 함" · 원래 자리 · 서버 불변 — ' + (await bar(pa)).slice(0, 70));
    await pa.waitForTimeout(3000);
    ok(/저장 못 함 — \S+ · 다시 시도/.test(await bar(pa)), 'V3 · 실패 표시는 저절로 사라지지 않는다');
    GW.patchFail = 0; await pa.locator('[data-ctlwin] [role=status] >> text=다시 시도').first().click(); await pa.waitForFunction(() => window.TerraNodes.deskRead('nd_b').save.state === 'saved', null, { timeout: 8000 });
    await pa.waitForTimeout(500); const jr = await ico(pa, '작업 관리자');
    ok(/그 노드에 저장됨/.test(await bar(pa)) && (jr.left !== jb.left || jr.top !== jb.top), 'V3 · "다시 시도" — 같은 변경이 노드에 닿아 저장됨');
    // V4 — 노드가 끊김: 읽기 전용 · 드래그 잠김 · 요청이 쌓이지 않는다 · 창 같은 PC 항목은 계속
    GW.offline.add('nd_b');
    await pa.waitForFunction(() => window.TerraNodes.deskRead('nd_b').state === 'offline', null, { timeout: 15000 });
    const sb = await ico(pa, '노드 터미널'), pn = patches(); await drag(pa, '노드 터미널', 220, 140); await pa.waitForTimeout(600);
    const sa = await ico(pa, '노드 터미널');
    ok(/끊김 · 읽기 전용 · .*사본/.test(await bar(pa)) && sa.left === sb.left && sa.top === sb.top && patches() === pn, 'V4 · 끊김 — "끊김 · 읽기 전용 · 사본" · 드래그 잠김 · PATCH 0 — ' + (await bar(pa)).slice(0, 80));
    const fb = await ico(pa, '내 폴더'); await pa.mouse.dblclick(fb.x, fb.y); await pa.waitForTimeout(1200);
    const pc = await pa.evaluate(() => { try { return JSON.parse(localStorage.getItem('terra.pc.desk.nd_b') || 'null'); } catch { return null; } });
    ok(!!pc && !!pc.wins && Object.keys(pc.wins).length > 0 && !('icons' in pc) && !('prefs' in pc) && !(await pa.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('terra.view.desk.')))), 'V4 · 창 열기는 끊겨도 된다 — PC 상태는 terra.pc.desk.<node_id> 에(아이콘 · 모양 없음) — ' + JSON.stringify(pc && Object.keys(pc)));
    // V5 — 재연결: 끊긴 동안 다른 곳에서 바뀐 값이 13초 안에 온다
    GW.other('nd_b', { 'icons.shell': { c: 7, r: 6, name: '노드 터미널', k: 'short', app: 'term', src: 'Terra 기능' } }); const t1 = Date.now();
    GW.offline.delete('nd_b');
    const rc = await pa.waitForFunction(() => { const r = window.TerraNodes.deskRead('nd_b'); return r.state === 'ok' && r.doc && r.doc.icons.shell && r.doc.icons.shell.c === 7; }, null, { timeout: 16000, polling: 250 }).then(() => Date.now() - t1, () => -1);
    ok(rc >= 0 && rc <= 14000, 'V5 · 재연결 — ' + rc + 'ms 만에 노드 값으로(5초 + 폴링 제한 8초 = 13초 안)');
    await pa.waitForTimeout(400); const ra = await ico(pa, '노드 터미널');
    ok(ra.left !== sb.left || ra.top !== sb.top, 'V5 · 화면의 아이콘도 노드 값 자리로 — ' + sb.left + ',' + sb.top + ' → ' + ra.left + ',' + ra.top);
    // V10 — 로그아웃: 그 계정의 터미널 기록 삭제 · TerraWho = null · watch 해제, PC 창 상태는 남는다
    await pa.evaluate(() => { localStorage.setItem('terra.pc.term.user%3Asmoke.nd_b', '{"tterm":[],"ttHist":["api x"]}'); localStorage.setItem('terra.pc.term.user%3Aother.nd_b', '{}'); });
    const who = await pa.evaluate(() => window.TerraWho && window.TerraWho.principal);
    await pa.evaluate(() => window.__terra.scene.sceneLogout()); await pa.waitForTimeout(600);
    const lo = await pa.evaluate(() => ({ term: localStorage.getItem('terra.pc.term.user%3Asmoke.nd_b'), other: localStorage.getItem('terra.pc.term.user%3Aother.nd_b'), desk: !!localStorage.getItem('terra.pc.desk.nd_b'), who: window.TerraWho, watched: window.TerraNodes.watched.size, cache: localStorage.getItem('terra.cache') }));
    ok(who === 'user:smoke' && lo.term === null && lo.other === '{}' && lo.desk && lo.who === null && lo.watched === 0, 'V10 · 로그아웃 — 그 계정(' + who + ')의 터미널 기록 삭제 · 다른 계정 · PC 창 상태는 남김 · TerraWho = null · watch 0 — ' + JSON.stringify({ term: lo.term, desk: lo.desk, who: lo.who, watched: lo.watched }));
  } finally { await A.ctx.close(); await B.ctx.close(); }
}
// A 모드 — 셸 안의 모듈 앱: 로그인 층 없이, 앱 토큰(Bearer)으로, 바탕 구성은 그 노드에
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
  ok(!GW.calls.some((c) => c.includes('/me/documents')) && GW.calls.some((c) => c.includes('node-desk.get')), 'A 모드 · 계정 문서 없이 — 바탕 구성은 앱 토큰으로 그 노드에(node-desk.get)');
}
if (errors.length) { fail++; console.log('오류:', errors.join(' | ')); }
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
