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
const GW = { offline: new Set(), calls: [] };
const MODS = { modules: [{ id: 'io.terra.agent', name: 'Terra Agent', version: '0.3.1', kind: 'service', state: 'running', enabled: true }, { id: 'io.terra.real-only', name: 'Real Only', version: '1.0.0', kind: 'service', state: 'stopped', enabled: true }] };
const DATA = { 'terra.master.nodes.get': { nodes: [{ node_id: 'nd_b', display_name: '01.01·b' }] }, 'terra.daemon.modules.get': MODS, 'terra.daemon.config.get': { config: { daemon: { device_name: 'real-leaf' } } }, 'terra.daemon.tasks.get': { tasks: [{ ID: 't-1', Type: 'process.execute', State: 'running' }] } };
async function gw(req, res, path) {
  const send = (st, body) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; for await (const c of req) body += c; const inp = body ? JSON.parse(body) : {};
  if (path === '/api/v1/auth/credentials') { if (req.method === 'DELETE') return send(200, { status: 'ok', data: { revoked: true } }); return inp.password === 'pw' ? send(200, { status: 'ok', data: { handle: 'h-smoke', session: { principal: 'u', displayName: 'admin' } } }) : send(401, { status: 'error', error: { code: 'CREDENTIAL_REJECTED', message: 'rejected' } }); }
  if (req.headers.authorization !== 'Handle h-smoke') return send(401, { status: 'error', error: { code: 'UNAUTHENTICATED', message: 'no session' } });
  GW.calls.push(req.method + ' ' + path);
  if (path.startsWith('/api/v1/me/documents')) return send(200, { status: 'ok', data: req.method === 'GET' ? { documents: [] } : { revision: 1, created: true } });
  const m = path.match(/^\/api\/v1\/(?:nodes\/([^/]+)\/)?operations\/([^/]+)\/invoke$/); if (!m) return send(404, { status: 'error', error: { code: 'NOT_FOUND' } });
  const node = m[1] && decodeURIComponent(m[1]), op = decodeURIComponent(m[2]);
  if (node && GW.offline.has(node)) return send(409, { status: 'error', error: { code: 'NODE_OFFLINE', message: 'target node is offline', retryable: true } });
  return send(200, { status: 'ok', data: DATA[op] || {} });
}
const server = createServer(async (req, res) => {
  { const u = new URL(req.url, 'http://x').pathname; if (u.startsWith('/api/')) return gw(req, res, u); }
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
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|409)\b/.test(m.text())) errors.push(m.text()); });   // 401 · 409 는 시험이 일부러 낸 답(틀린 비밀번호 · 끊긴 노드)
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
  await page.waitForTimeout(1500);
  const msg = await page.evaluate(() => { const L = window.__terra.login(); return L && L.state.msg; });
  ok(/맞지 않아요/.test(msg || ''), 'B 모드 · 틀린 비밀번호 → ' + msg);
  await page.locator('input[name=password]').fill('pw'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
  ok(await page.evaluate(() => window.__terra.session.authorization() === 'Handle h-smoke'), 'B 모드 · 로그인 → 자격 핸들');
  const head = () => page.evaluate(() => [...document.querySelectorAll('[data-ctlwin] [role=status]')].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\n/g, ' ')).join(' | '));
  await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlOpenWin(s.gf_localNode()); });
  await page.waitForTimeout(2500);
  ok(/로컬/.test(await head()), 'B 모드 · 로컬 제어기 — ' + (await head()).slice(0, 60));
  const mods = await page.evaluate(() => { const s = window.__terra.scene; return s.gf_modsOf(s.gf_localNode()).map((m) => m.id + ':' + m.st).join(','); });
  ok(/io\.terra\.real-only:stop/.test(mods), 'B 모드 · 노드 폴더 › 모듈 = 실제 응답 — ' + mods);
  ok(GW.calls.some((c) => c === 'POST /api/v1/operations/terra.daemon.modules.get/invoke'), 'B 모드 · 로컬 길 /api/v1/operations/…');
  await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlCloseAll(); const R = s.sceneMap().all.find((n) => n.name === '01.01·b'); window.__R = R; s.gf_ctlOpenWin(R); });
  await page.waitForTimeout(2500);
  ok(/원격/.test(await head()) && GW.calls.some((c) => c.startsWith('POST /api/v1/nodes/nd_b/operations/')), 'B 모드 · 원격 제어기 — 노드 주소 호출(nd_b) · ' + (await head()).slice(0, 60));
  GW.offline.add('nd_b');
  await page.evaluate(async () => { const T = window.TerraNodes; await T.refresh(window.__R.id, 'desk'); await T.refresh(window.__R.id, 'desk'); });   // 받던 것이 있으면 그것부터 끝내고, 끊긴 뒤에 한 번 더
  await page.waitForTimeout(800);
  ok(/끊김 · .*읽기 전용/.test(await head()), 'B 모드 · 끊김(PA) — 마지막 사본 · 읽기 전용 · ' + (await head()).slice(0, 70));
  const unm = await page.evaluate(() => { const s = window.__terra.scene, C = s.sceneMap().all.find((n) => n.kind === 'leaf' && n.name === '01.01·c'); return C ? window.TerraNodes.refresh(C.id, 'modules').then(() => window.TerraNodes.linkText(C.id).t) : '없음'; });
  ok(/Terra 에 없는 노드/.test(unm), 'B 모드 · 목록에 없는 시안 노드 → ' + unm);
  await page.waitForTimeout(1200);
  ok(GW.calls.some((c) => c.startsWith('PUT /api/v1/me/documents/gui-v3/view/desk.')), 'B 모드 · 제어기 화면 배치 → 계정 문서(me/documents)');
}
if (errors.length) { fail++; console.log('오류:', errors.join(' | ')); }
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
